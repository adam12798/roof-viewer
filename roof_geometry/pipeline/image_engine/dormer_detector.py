"""
Dormer candidate detection for the image engine pipeline.

Detects likely dormer subregions using structural evidence:
boundary protrusions backed by line segments, within promoted roof planes.
Shadow-only detection is disabled to avoid false positives.
"""

from __future__ import annotations

import logging
import math

import numpy as np

from models.schemas import ImageInput, RegistrationTransform
from pipeline.image_engine.edge_detector import px_to_local
from pipeline.image_engine.schemas import (
    DormerCandidate,
    ExtractedLine,
    ImageEngineConfig,
    PreprocessedImage,
    SegmentedRegion,
)

logger = logging.getLogger(__name__)

try:
    import cv2
    HAS_CV2 = True
except ImportError:
    cv2 = None  # type: ignore[assignment]
    HAS_CV2 = False


def detect_dormers(
    preprocessed: PreprocessedImage,
    regions: list[SegmentedRegion],
    lines: list[ExtractedLine],
    image_input: ImageInput,
    registration: RegistrationTransform,
    config: ImageEngineConfig,
) -> list[DormerCandidate]:
    """
    Detect candidate dormers within promoted roof regions.

    Requirements for a valid dormer candidate:
      1. Must be inside or tightly adjacent to a promoted roof plane
      2. Must be bounded by strong line segments (≥2 supporting lines)
      3. Must be a clear subregion inside a larger roof region
      4. Must have reasonable dormer-sized area (1–20 m²)
      5. Must NOT be just a shadow or boundary irregularity

    Returns DormerCandidate objects with diagnostics.
    """
    if not HAS_CV2:
        return []

    scale = _get_scale(image_input, registration)
    w, h = preprocessed.width_px, preprocessed.height_px
    candidates: list[DormerCandidate] = []

    promoted = [r for r in regions if r.promoted_to_plane]
    if not promoted:
        return []

    for region in promoted:
        protrusions = _find_boundary_protrusions(region, w, h, scale, config)
        for protrusion in protrusions:
            candidate = _classify_protrusion(
                protrusion, region, lines, preprocessed, w, h, scale, config,
            )
            if candidate is not None:
                candidates.append(candidate)

    logger.info("Dormer detection: %d candidates from %d promoted regions",
        len(candidates), len(promoted))
    return candidates


def _get_scale(image_input: ImageInput, registration: RegistrationTransform) -> float:
    if registration.scale > 0:
        return registration.scale
    return image_input.resolution_m_per_px


def _find_boundary_protrusions(
    region: SegmentedRegion,
    img_w: int,
    img_h: int,
    scale: float,
    config: ImageEngineConfig,
) -> list[dict]:
    """
    Find protruding sub-shapes along a region's boundary using convexity defects.

    Tighter filtering than before:
      - depth must be 0.8–4.0 m (not 0.5–5.0)
      - width must be 1.5–6.0 m (not 1.0–8.0)
      - aspect ratio (width/depth) must be 0.5–3.0
    """
    if len(region.boundary_px) < 5:
        return []

    pts = np.array(region.boundary_px, dtype=np.int32).reshape(-1, 1, 2)
    hull = cv2.convexHull(pts, returnPoints=False)

    try:
        defects = cv2.convexityDefects(pts, hull)
    except cv2.error:
        return []

    if defects is None:
        return []

    protrusions = []
    for i in range(defects.shape[0]):
        s, e, f, d = defects[i, 0]
        depth_px = d / 256.0
        depth_m = depth_px * scale

        if depth_m < 0.8 or depth_m > 4.0:
            continue

        start = tuple(pts[s][0])
        end = tuple(pts[e][0])
        far = tuple(pts[f][0])

        width_px = math.sqrt((end[0] - start[0]) ** 2 + (end[1] - start[1]) ** 2)
        width_m = width_px * scale

        if width_m < 1.5 or width_m > 6.0:
            continue

        # Aspect ratio filter
        aspect = width_m / depth_m if depth_m > 0 else 99
        if aspect < 0.5 or aspect > 3.0:
            continue

        protrusions.append({
            "start_px": start,
            "end_px": end,
            "far_px": far,
            "depth_m": depth_m,
            "depth_px": depth_px,
            "width_m": width_m,
            "width_px": width_px,
        })

    return protrusions


def _count_supporting_lines(
    protrusion: dict,
    lines: list[ExtractedLine],
    proximity_px: float = 15.0,
) -> list[str]:
    """
    Count how many extracted line segments are near the protrusion boundary.

    A line "supports" a protrusion if at least one endpoint is within
    proximity_px of any protrusion vertex (start, end, far).
    """
    vertices = [protrusion["start_px"], protrusion["end_px"], protrusion["far_px"]]
    supporting_ids = []

    for ln in lines:
        for lp in [ln.start_px, ln.end_px]:
            for vx, vy in vertices:
                dist = math.sqrt((lp[0] - vx) ** 2 + (lp[1] - vy) ** 2)
                if dist < proximity_px:
                    supporting_ids.append(ln.id)
                    break
            else:
                continue
            break

    return supporting_ids


def _is_inside_region(
    cx: int, cy: int,
    region: SegmentedRegion,
    img_w: int, img_h: int,
) -> bool:
    """Check if a point is inside or tightly adjacent to a region's mask."""
    if region.mask is not None:
        # Check the point itself + small neighborhood
        for dx in range(-5, 6, 5):
            for dy in range(-5, 6, 5):
                px = max(0, min(img_w - 1, cx + dx))
                py = max(0, min(img_h - 1, cy + dy))
                if region.mask[py, px] > 0:
                    return True
        return False

    # Fallback: point-in-polygon on boundary
    if len(region.boundary_px) < 3:
        return False
    pts = np.array(region.boundary_px, dtype=np.int32).reshape(-1, 1, 2)
    result = cv2.pointPolygonTest(pts, (float(cx), float(cy)), False)
    return result >= 0


def _classify_protrusion(
    protrusion: dict,
    region: SegmentedRegion,
    lines: list[ExtractedLine],
    preprocessed: PreprocessedImage,
    img_w: int,
    img_h: int,
    scale: float,
    config: ImageEngineConfig,
) -> DormerCandidate | None:
    """
    Classify a boundary protrusion as a dormer candidate.

    Requires:
      - Area within dormer range
      - Centroid inside parent region
      - At least 2 supporting line segments nearby
      - Not just a shadow (brightness check)
    """
    width_m = protrusion["width_m"]
    depth_m = protrusion["depth_m"]
    area_m2 = width_m * depth_m

    if area_m2 < config.min_dormer_area_m2 or area_m2 > config.max_dormer_area_m2:
        return None

    start = protrusion["start_px"]
    end = protrusion["end_px"]
    far = protrusion["far_px"]

    cx = (start[0] + end[0] + far[0]) // 3
    cy = (start[1] + end[1] + far[1]) // 3

    # Must be inside or adjacent to parent region
    if not _is_inside_region(cx, cy, region, img_w, img_h):
        logger.debug("Dormer rejected: centroid outside parent region %s", region.id)
        return None

    # Require supporting line segments (structural evidence)
    supporting = _count_supporting_lines(protrusion, lines)
    if len(supporting) < 2:
        logger.debug("Dormer rejected: only %d supporting lines (need ≥2)", len(supporting))
        return None

    # Shadow rejection: check that the protrusion area is not abnormally dark
    # (shadows cause false protrusions)
    gray = preprocessed.gray
    if region.mask is not None:
        region_mean = cv2.mean(gray, mask=region.mask)[0]
    else:
        region_mean = float(np.mean(gray))

    # Sample brightness at protrusion centroid (small patch)
    patch_r = 5
    py0 = max(0, cy - patch_r)
    py1 = min(img_h, cy + patch_r + 1)
    px0 = max(0, cx - patch_r)
    px1 = min(img_w, cx + patch_r + 1)
    patch_mean = float(np.mean(gray[py0:py1, px0:px1]))

    if region_mean > 0 and patch_mean < region_mean * 0.45:
        logger.debug("Dormer rejected: shadow region (%.0f vs parent mean %.0f)",
            patch_mean, region_mean)
        return None

    boundary_px = [start, end, far]
    boundary_local = [px_to_local(px, py, img_w, img_h, scale) for px, py in boundary_px]
    centroid_local = px_to_local(cx, cy, img_w, img_h, scale)

    # Classify type by shape
    aspect = width_m / depth_m if depth_m > 0 else 1.0
    if aspect > 2.0:
        dormer_type = "shed"
    elif aspect < 0.8:
        dormer_type = "hip"
    else:
        dormer_type = "gable"

    # Confidence based on evidence strength
    conf = 0.20
    conf += min(len(supporting), 4) * 0.05  # +0.05 per line, max +0.20
    if 2.0 < area_m2 < 10.0:
        conf += 0.10  # sweet-spot area bonus
    conf = min(0.55, conf)

    logger.info(
        "Dormer candidate: %s type=%s area=%.1f m² lines=%d conf=%.2f parent=%s",
        dormer_type, dormer_type, area_m2, len(supporting), conf, region.id,
    )

    return DormerCandidate(
        boundary_px=boundary_px,
        boundary_local=boundary_local,
        centroid_px=(cx, cy),
        centroid_local=centroid_local,
        width_m=width_m,
        depth_m=depth_m,
        dormer_type=dormer_type,
        confidence=conf,
        parent_region_id=region.id,
    )
