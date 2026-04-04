"""
Region segmentation for the image engine pipeline.

Segments the image into candidate roof regions using watershed/contour
methods, then filters, tightens, and promotes qualifying regions into
RoofPlane objects with non-max suppression.
"""

from __future__ import annotations

import logging
import math
import uuid

import numpy as np

from models.schemas import (
    ImageInput,
    PlaneEquation,
    PlaneType,
    Point2D,
    Point3D,
    RegistrationTransform,
    RoofPlane,
)
from pipeline.image_engine.edge_detector import px_to_local
from pipeline.image_engine.schemas import (
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


# Flat placeholder for image-only planes (no 3D data available)
_FLAT_PLANE_EQ = PlaneEquation(a=0.0, b=1.0, c=0.0, d=0.0)


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def segment_regions(
    preprocessed: PreprocessedImage,
    lines: list[ExtractedLine],
    edge_map: np.ndarray,
    image_input: ImageInput,
    registration: RegistrationTransform,
    config: ImageEngineConfig,
) -> tuple[list[SegmentedRegion], list[RoofPlane], dict[str, int]]:
    """
    Segment the image into candidate roof regions and promote qualifying
    regions into RoofPlane objects.

    Flow:
      1. Build combined edge/line mask → contours → SegmentedRegion objects
      2. Rejection filter (vegetation, texture, size, shape)
      3. Tighten boundaries on promoted regions (edge snap, smooth, clip)
      4. Non-max suppression (remove overlapping duplicates)
      5. Convert final survivors to RoofPlane

    Returns (all_regions, promoted_planes, rejection_counts).
    """
    empty_counts: dict[str, int] = {
        "rejected_too_small": 0,
        "rejected_too_large": 0,
        "rejected_aspect_ratio": 0,
        "rejected_compactness": 0,
        "rejected_centrality": 0,
        "rejected_vertex_count": 0,
        "rejected_vegetation": 0,
        "rejected_texture": 0,
        "rejected_roof_mask_overlap": 0,
        "suppressed_nms": 0,
    }
    if not HAS_CV2:
        return [], [], empty_counts

    scale = _get_scale(image_input, registration)
    w, h = preprocessed.width_px, preprocessed.height_px

    # Scale diagnostic — log prominently so we can verify
    scale_src = "registration" if registration.scale > 0 else "image_input"
    logger.info("=== SCALE CHECK ===")
    logger.info("  source: %s", scale_src)
    logger.info("  scale: %.6f m/px", scale)
    logger.info("  image: %d x %d px", w, h)
    logger.info("  footprint: %.1f x %.1f m (%.0f m²)",
        w * scale, h * scale, w * h * scale * scale)
    logger.info("  1000 px² region = %.2f m²", 1000 * scale * scale)
    logger.info("===================")

    # Build combined mask from edges + drawn lines
    combined_mask = _build_combined_mask(edge_map, lines, w, h)

    # Morphological closing to bridge small gaps
    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    closed = cv2.morphologyEx(combined_mask, cv2.MORPH_CLOSE, kernel, iterations=2)

    # Dilate edges slightly to ensure clean boundaries
    dilated = cv2.dilate(closed, kernel, iterations=1)

    # Invert: regions are the non-edge areas
    inverted = cv2.bitwise_not(dilated)

    # Find contours of the closed regions
    contours, _ = cv2.findContours(inverted, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    # --- Pass 1: Build SegmentedRegion objects ---
    all_regions: list[SegmentedRegion] = []
    for contour in contours:
        region = _contour_to_region(contour, w, h, scale, preprocessed.hsv, preprocessed.gray, preprocessed.roof_mask, config)
        if region is not None:
            all_regions.append(region)

    # Sort by area descending
    all_regions.sort(key=lambda r: r.area_m2, reverse=True)

    # --- Pass 2: Rejection filter (mark promoted, don't convert yet) ---
    rejection_counts = dict(empty_counts)
    for region in all_regions:
        reason = _rejection_reason(region, w, h, config)
        if reason is None:
            region.promoted_to_plane = True
        else:
            rejection_counts[reason] += 1

    # --- Pass 3: Tighten boundaries on promoted regions ---
    for region in all_regions:
        if not region.promoted_to_plane:
            continue
        pre_area_px = region.area_px
        original_boundary = list(region.boundary_px)

        region.boundary_px = _snap_boundary_to_edges(
            region.boundary_px, edge_map, config.edge_snap_radius_px,
        )
        region.boundary_px = _smooth_boundary(
            region.boundary_px, config.min_boundary_edge_length_px,
        )
        region.boundary_px = _clip_to_roof_mask(
            region.boundary_px, preprocessed.roof_mask, w, h,
        )
        region.boundary_px = _clip_dark_zones(
            region.boundary_px, preprocessed.gray, w, h,
        )

        # Build mask from tightened boundary
        new_mask = np.zeros((h, w), dtype=np.uint8)
        pts = np.array(region.boundary_px, dtype=np.int32).reshape(-1, 1, 2)
        cv2.drawContours(new_mask, [pts], -1, 255, -1)
        pre_erode_px = float(np.count_nonzero(new_mask))

        # Aggressive erosion: strip boundary inflation + bleed
        erode_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
        new_mask = cv2.erode(new_mask, erode_k, iterations=2)
        post_erode_px = float(np.count_nonzero(new_mask))

        # Also AND with edge_map complement — cut at strong internal edges
        # This splits regions that span multiple roof faces
        edge_dilated = cv2.dilate(edge_map, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)), iterations=1)
        edge_barrier = cv2.bitwise_not(edge_dilated)
        new_mask = cv2.bitwise_and(new_mask, edge_barrier)
        post_barrier_px = float(np.count_nonzero(new_mask))

        # Take only the largest connected component (drop fragments)
        split_contours, _ = cv2.findContours(new_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if split_contours:
            largest_c = max(split_contours, key=cv2.contourArea)
            new_mask = np.zeros((h, w), dtype=np.uint8)
            cv2.drawContours(new_mask, [largest_c], -1, 255, -1)
        post_cc_px = float(np.count_nonzero(new_mask))

        logger.debug(
            "Erosion %s: pre_erode=%d → post_erode=%d → post_barrier=%d → post_cc=%d",
            region.id, int(pre_erode_px), int(post_erode_px),
            int(post_barrier_px), int(post_cc_px),
        )

        post_area_px = post_cc_px

        # Mask preservation guard: if aggressive erosion destroyed > 80% of the
        # mask, fall back to lighter erosion to avoid silently keeping a dead mask
        _MIN_RETAIN_RATIO = 0.20
        _MIN_ABSOLUTE_PX = 100
        if pre_erode_px > 0 and post_area_px < max(pre_erode_px * _MIN_RETAIN_RATIO, _MIN_ABSOLUTE_PX):
            logger.warning(
                "MASK NEARLY DESTROYED %s: %d → %d px (%.1f%% retained) — "
                "falling back to lighter erosion",
                region.id, int(pre_erode_px), int(post_area_px),
                100.0 * post_area_px / pre_erode_px if pre_erode_px > 0 else 0,
            )
            # Rebuild from tightened boundary with lighter erosion
            new_mask = np.zeros((h, w), dtype=np.uint8)
            pts = np.array(region.boundary_px, dtype=np.int32).reshape(-1, 1, 2)
            cv2.drawContours(new_mask, [pts], -1, 255, -1)
            erode_k_small = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            new_mask = cv2.erode(new_mask, erode_k_small, iterations=1)
            post_area_px = float(np.count_nonzero(new_mask))
            logger.info(
                "Lighter erosion %s: %d → %d px",
                region.id, int(pre_erode_px), int(post_area_px),
            )

        # Guard: if tightening INCREASED area, revert to original boundary
        if post_area_px > pre_area_px:
            logger.warning(
                "Tightening inflated %s: %.0f → %.0f px — reverting",
                region.id, pre_area_px, post_area_px,
            )
            region.boundary_px = original_boundary
            new_mask = np.zeros((h, w), dtype=np.uint8)
            pts = np.array(region.boundary_px, dtype=np.int32).reshape(-1, 1, 2)
            cv2.drawContours(new_mask, [pts], -1, 255, -1)
            new_mask = cv2.erode(new_mask, erode_k, iterations=2)
            post_area_px = float(np.count_nonzero(new_mask))

        # If erosion destroyed the region, keep original mask but eroded
        if post_area_px < 100:
            logger.warning(
                "Erosion fallback %s: %d px < 100 — using original boundary with light erode",
                region.id, int(post_area_px),
            )
            new_mask = np.zeros((h, w), dtype=np.uint8)
            pts = np.array(original_boundary, dtype=np.int32).reshape(-1, 1, 2)
            cv2.drawContours(new_mask, [pts], -1, 255, -1)
            erode_k_small = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            new_mask = cv2.erode(new_mask, erode_k_small, iterations=1)
            post_area_px = float(np.count_nonzero(new_mask))
            logger.info(
                "Erosion fallback result %s: %d px",
                region.id, int(post_area_px),
            )

        region.mask = new_mask
        region.area_px = post_area_px
        region.area_m2 = post_area_px * scale * scale

        # Recompute boundary from final mask (tightest possible polygon)
        tight_contours, _ = cv2.findContours(new_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if tight_contours:
            largest = max(tight_contours, key=cv2.contourArea)
            perim = cv2.arcLength(largest, True)
            if perim > 0:
                simplified = cv2.approxPolyDP(largest, 0.012 * perim, True)
                region.boundary_px = [(int(p[0][0]), int(p[0][1])) for p in simplified]

        region.boundary_local = [
            px_to_local(px, py, w, h, scale) for px, py in region.boundary_px
        ]

        logger.info(
            "Tighten %s: %.0f → %.0f px (%.1f → %.1f m²) scale=%.6f",
            region.id, pre_area_px, region.area_px,
            pre_area_px * scale * scale, region.area_m2, scale,
        )

    # --- Pass 3b: Re-reject planes that became too large/small after tightening ---
    for region in all_regions:
        if not region.promoted_to_plane:
            continue
        if region.area_m2 > config.max_region_area_m2:
            region.promoted_to_plane = False
            rejection_counts["rejected_too_large"] += 1
            logger.warning("Post-tighten reject %s: %.1f m² > max %.1f",
                region.id, region.area_m2, config.max_region_area_m2)
        elif region.area_m2 < config.min_region_area_m2:
            region.promoted_to_plane = False
            rejection_counts["rejected_too_small"] += 1

    # --- Pass 4: Non-max suppression ---
    promoted = [r for r in all_regions if r.promoted_to_plane]
    survivors, suppressed = _non_max_suppress(promoted, overlap_threshold=0.15)
    rejection_counts["suppressed_nms"] = len(suppressed)
    for s in suppressed:
        s.promoted_to_plane = False

    # --- Pass 5: Convert final survivors to RoofPlane ---
    planes = [_region_to_plane(r) for r in survivors]

    logger.info(
        "Segmentation: %d contours → %d regions → %d promoted → %d after NMS",
        len(contours), len(all_regions), len(promoted), len(planes),
    )
    return all_regions, planes, rejection_counts


# ---------------------------------------------------------------------------
# Region construction
# ---------------------------------------------------------------------------

def _get_scale(image_input: ImageInput, registration: RegistrationTransform) -> float:
    if registration.scale > 0:
        return registration.scale
    return image_input.resolution_m_per_px


def _build_combined_mask(
    edge_map: np.ndarray,
    lines: list[ExtractedLine],
    w: int,
    h: int,
) -> np.ndarray:
    """Combine Canny edge map with drawn line segments."""
    mask = edge_map.copy()
    for ln in lines:
        cv2.line(mask, ln.start_px, ln.end_px, 255, thickness=2)
    return mask


def _contour_to_region(
    contour: np.ndarray,
    img_w: int,
    img_h: int,
    scale: float,
    hsv: np.ndarray,
    gray: np.ndarray,
    roof_mask: np.ndarray,
    config: ImageEngineConfig,
) -> SegmentedRegion | None:
    """Convert a single contour into a SegmentedRegion with quality metrics."""
    area_px = cv2.contourArea(contour)
    if area_px < 200:
        return None

    area_m2 = area_px * scale * scale
    perimeter = cv2.arcLength(contour, True)

    compactness = (4 * math.pi * area_px) / (perimeter * perimeter) if perimeter > 0 else 0

    rect = cv2.minAreaRect(contour)
    box_w, box_h = rect[1]
    if box_w == 0 or box_h == 0:
        return None
    aspect_ratio = max(box_w, box_h) / min(box_w, box_h)

    # Bounding box
    bx, by, bw, bh = cv2.boundingRect(contour)

    # Simplify contour
    epsilon = 0.02 * perimeter
    simplified = cv2.approxPolyDP(contour, epsilon, True)

    boundary_px = [(int(pt[0][0]), int(pt[0][1])) for pt in simplified]
    boundary_local = [px_to_local(px, py, img_w, img_h, scale) for px, py in boundary_px]

    # Centroid
    M = cv2.moments(contour)
    if M["m00"] > 0:
        cx = int(M["m10"] / M["m00"])
        cy = int(M["m01"] / M["m00"])
    else:
        cx, cy = int(rect[0][0]), int(rect[0][1])

    centroid_local = px_to_local(cx, cy, img_w, img_h, scale)

    # Build pixel mask (stored for overlap analysis + NMS)
    region_mask = np.zeros(hsv.shape[:2], dtype=np.uint8)
    cv2.drawContours(region_mask, [contour], -1, 255, -1)
    mask_pixels = np.count_nonzero(region_mask)
    if mask_pixels == 0:
        return None

    material_hint = _classify_material_from_mask(region_mask, hsv)

    # Green/vegetation fraction
    h_ch = hsv[:, :, 0]
    s_ch = hsv[:, :, 1]
    green_pixels = np.count_nonzero(
        (region_mask == 255)
        & (h_ch >= config.vegetation_hue_low)
        & (h_ch <= config.vegetation_hue_high)
        & (s_ch >= config.vegetation_sat_min)
    )
    green_fraction = green_pixels / mask_pixels

    # Texture variance
    gray_vals = gray[region_mask == 255].astype(np.float32)
    texture_variance = float(np.var(gray_vals)) if len(gray_vals) > 0 else 0.0

    # Roof mask overlap
    roof_overlap = np.count_nonzero((region_mask == 255) & (roof_mask == 255))
    roof_mask_overlap = roof_overlap / mask_pixels

    # Confidence
    base_conf = compactness * 0.4 + min(area_m2 / 100, 0.2)
    confidence = min(0.7, base_conf * roof_mask_overlap)

    region = SegmentedRegion(
        boundary_px=boundary_px,
        boundary_local=boundary_local,
        mask=region_mask,
        area_px=area_px,
        area_m2=area_m2,
        centroid_px=(cx, cy),
        centroid_local=centroid_local,
        compactness=compactness,
        aspect_ratio=aspect_ratio,
        perimeter_px=perimeter,
        bounding_box=(bx, by, bw, bh),
        scale_used=scale,
        material_hint=material_hint,
        confidence=confidence,
    )
    # Roof-veto score: how structurally roof-like is this region?
    roof_veto = _compute_roof_veto_score(contour, boundary_px, compactness, area_px)

    # Tree evidence signals (count how many are true)
    tree_signals = _count_tree_signals(
        contour, boundary_px, green_fraction, texture_variance,
        compactness, region_mask, gray,
    )

    # Quality metrics for rejection checks
    region._green_fraction = green_fraction  # type: ignore[attr-defined]
    region._texture_variance = texture_variance  # type: ignore[attr-defined]
    region._roof_mask_overlap = roof_mask_overlap  # type: ignore[attr-defined]
    region._roof_veto_score = roof_veto  # type: ignore[attr-defined]
    region._tree_signals = tree_signals  # type: ignore[attr-defined]
    return region


def _classify_material_from_mask(region_mask: np.ndarray, hsv: np.ndarray) -> str:
    """Simple material classification from mean HSV within the region mask."""
    mean_hsv = cv2.mean(hsv, mask=region_mask)[:3]
    h, s, v = mean_hsv

    if s < 30:
        return "grey_shingle" if v > 120 else "dark_shingle"
    if 10 < h < 25:
        return "brown_shingle"
    if 35 < h < 85:
        return "green_material"
    if 100 < h < 130:
        return "blue_material"
    return "unknown"


# ---------------------------------------------------------------------------
# Roof-veto and tree-evidence scoring
# ---------------------------------------------------------------------------

def _compute_roof_veto_score(
    contour: np.ndarray,
    boundary_px: list[tuple[int, int]],
    compactness: float,
    area_px: float,
) -> float:
    """
    Score how structurally roof-like a region is (0.0–1.0).

    High score = straight edges, regular polygon, dominant orientation,
    large contiguous area. A high score should VETO tree classification.
    """
    score = 0.0
    n = len(boundary_px)
    if n < 3:
        return 0.0

    # 1. Straight-edge ratio: fraction of perimeter that is long straight edges
    edges = []
    for i in range(n):
        p1 = boundary_px[i]
        p2 = boundary_px[(i + 1) % n]
        dx = p2[0] - p1[0]
        dy = p2[1] - p1[1]
        edges.append(math.sqrt(dx * dx + dy * dy))
    total_perim = sum(edges)
    if total_perim > 0:
        long_edges = sum(e for e in edges if e > total_perim * 0.08)
        straight_edge_ratio = long_edges / total_perim
        score += straight_edge_ratio * 0.25  # max 0.25

    # 2. Boundary regularity: low vertex count = regular polygon
    if n <= 6:
        score += 0.20
    elif n <= 10:
        score += 0.10

    # 3. Dominant orientation consistency: edges should cluster in 1-2 directions
    if len(edges) >= 3:
        angles = []
        for i in range(n):
            p1 = boundary_px[i]
            p2 = boundary_px[(i + 1) % n]
            a = math.degrees(math.atan2(p2[1] - p1[1], p2[0] - p1[0])) % 180
            angles.append(a)
        # Bin into 15-degree buckets
        bins = [0] * 12
        for a in angles:
            bins[int(a / 15) % 12] += 1
        top_two = sorted(bins, reverse=True)[:2]
        if n > 0:
            orientation_concentration = sum(top_two) / n
            score += orientation_concentration * 0.20  # max 0.20

    # 4. Compactness bonus: rectangles score 0.7-0.8
    if compactness > 0.5:
        score += 0.15
    elif compactness > 0.3:
        score += 0.08

    # 5. Large area bonus: big contiguous regions are more likely roof
    if area_px > 5000:
        score += 0.10
    elif area_px > 2000:
        score += 0.05

    # 6. Convexity: convex hull area vs contour area
    hull = cv2.convexHull(contour)
    hull_area = cv2.contourArea(hull)
    if hull_area > 0:
        solidity = area_px / hull_area
        if solidity > 0.85:
            score += 0.10

    return min(1.0, score)


def _count_tree_signals(
    contour: np.ndarray,
    boundary_px: list[tuple[int, int]],
    green_fraction: float,
    texture_variance: float,
    compactness: float,
    region_mask: np.ndarray,
    gray: np.ndarray,
) -> int:
    """
    Count positive tree evidence signals. TREE classification requires >= 3.

    Signals:
      1. Rounded/blob boundary (high compactness + high vertex count)
      2. Irregular edge directions (no dominant orientation)
      3. Vegetation color evidence (green fraction)
      4. Fragmented internal texture (high local variance patchiness)
      5. Canopy-like shape (nearly circular, high solidity)
    """
    signals = 0
    n = len(boundary_px)

    # Signal 1: Rounded/blob — many vertices with high compactness = circle-like
    if compactness > 0.55 and n > 8:
        signals += 1

    # Signal 2: Irregular edge directions — no 2 directions dominate
    if n >= 4:
        angles = []
        for i in range(n):
            p1 = boundary_px[i]
            p2 = boundary_px[(i + 1) % n]
            a = math.degrees(math.atan2(p2[1] - p1[1], p2[0] - p1[0])) % 180
            angles.append(a)
        bins = [0] * 12
        for a in angles:
            bins[int(a / 15) % 12] += 1
        top_two = sorted(bins, reverse=True)[:2]
        if n > 0 and sum(top_two) / n < 0.5:
            signals += 1

    # Signal 3: Vegetation color
    if green_fraction > 0.25:
        signals += 1

    # Signal 4: Fragmented internal texture (high variance)
    if texture_variance > 700:
        signals += 1

    # Signal 5: Canopy shape — nearly circular
    hull = cv2.convexHull(contour)
    hull_area = cv2.contourArea(hull)
    contour_area = cv2.contourArea(contour)
    if hull_area > 0:
        solidity = contour_area / hull_area
        if solidity > 0.80 and compactness > 0.6:
            signals += 1

    return signals


# ---------------------------------------------------------------------------
# Rejection filter
# ---------------------------------------------------------------------------

def _rejection_reason(
    region: SegmentedRegion,
    img_w: int,
    img_h: int,
    config: ImageEngineConfig,
) -> str | None:
    """
    Return the rejection reason, or None if region qualifies for promotion.

    TREE rejection requires >= 3 positive tree signals AND the roof-veto
    score must be low. A structurally roof-like region is never rejected
    as vegetation/texture — only by geometric filters.
    """
    roof_veto = getattr(region, "_roof_veto_score", 0.0)
    tree_signals = getattr(region, "_tree_signals", 0)
    green_frac = getattr(region, "_green_fraction", 0.0)
    tex_var = getattr(region, "_texture_variance", 0.0)
    roof_overlap = getattr(region, "_roof_mask_overlap", 1.0)

    # TREE rejection: requires 3+ signals AND low roof-veto
    # A high roof-veto score (>= 0.45) blocks tree classification entirely
    if roof_veto < 0.45 and tree_signals >= 3:
        if green_frac > config.max_green_fraction:
            return "rejected_vegetation"
        if tex_var > config.max_texture_variance:
            return "rejected_texture"

    # Roof mask overlap (still applies — region must be on roof-like surface)
    # But relax threshold for high-veto regions
    overlap_threshold = config.min_roof_mask_overlap
    if roof_veto >= 0.45:
        overlap_threshold = min(overlap_threshold, 0.30)
    if roof_overlap < overlap_threshold:
        return "rejected_roof_mask_overlap"

    # Size bounds
    if region.area_m2 < config.min_region_area_m2:
        return "rejected_too_small"
    if region.area_m2 > config.max_region_area_m2:
        return "rejected_too_large"

    if region.aspect_ratio > config.max_aspect_ratio:
        return "rejected_aspect_ratio"

    if region.compactness < config.min_compactness:
        return "rejected_compactness"

    margin_x = int(img_w * config.central_margin_fraction)
    margin_y = int(img_h * config.central_margin_fraction)
    cx, cy = region.centroid_px
    if cx < margin_x or cx > img_w - margin_x:
        return "rejected_centrality"
    if cy < margin_y or cy > img_h - margin_y:
        return "rejected_centrality"

    if len(region.boundary_local) < 3:
        return "rejected_vertex_count"

    return None


# ---------------------------------------------------------------------------
# Region tightening
# ---------------------------------------------------------------------------

def _snap_boundary_to_edges(
    boundary_px: list[tuple[int, int]],
    edge_map: np.ndarray,
    snap_radius: int,
) -> list[tuple[int, int]]:
    """Snap each boundary vertex to the nearest strong edge pixel within radius."""
    h, w = edge_map.shape[:2]
    snapped: list[tuple[int, int]] = []
    for vx, vy in boundary_px:
        x0 = max(0, vx - snap_radius)
        y0 = max(0, vy - snap_radius)
        x1 = min(w, vx + snap_radius + 1)
        y1 = min(h, vy + snap_radius + 1)
        patch = edge_map[y0:y1, x0:x1]
        edge_pts = np.argwhere(patch > 0)  # (row, col) = (dy, dx)
        if len(edge_pts) == 0:
            snapped.append((vx, vy))
            continue
        # Find nearest edge pixel
        dists = (edge_pts[:, 1] - (vx - x0)) ** 2 + (edge_pts[:, 0] - (vy - y0)) ** 2
        nearest = edge_pts[np.argmin(dists)]
        snapped.append((x0 + int(nearest[1]), y0 + int(nearest[0])))
    return snapped


def _smooth_boundary(
    boundary_px: list[tuple[int, int]],
    min_edge_length: int,
) -> list[tuple[int, int]]:
    """Remove degenerate short edges and re-simplify the polygon."""
    if len(boundary_px) < 3:
        return boundary_px

    # Collapse vertices that are too close together
    cleaned: list[tuple[int, int]] = [boundary_px[0]]
    min_sq = min_edge_length * min_edge_length
    for pt in boundary_px[1:]:
        dx = pt[0] - cleaned[-1][0]
        dy = pt[1] - cleaned[-1][1]
        if dx * dx + dy * dy >= min_sq:
            cleaned.append(pt)
    if len(cleaned) < 3:
        return boundary_px

    # Re-simplify with tighter epsilon
    arr = np.array(cleaned, dtype=np.int32).reshape(-1, 1, 2)
    perimeter = cv2.arcLength(arr, True)
    if perimeter <= 0:
        return cleaned
    epsilon = 0.015 * perimeter
    simplified = cv2.approxPolyDP(arr, epsilon, True)
    result = [(int(pt[0][0]), int(pt[0][1])) for pt in simplified]
    return result if len(result) >= 3 else cleaned


def _clip_to_roof_mask(
    boundary_px: list[tuple[int, int]],
    roof_mask: np.ndarray,
    img_w: int,
    img_h: int,
) -> list[tuple[int, int]]:
    """Clip polygon to roof mask. Keep original if clipping removes too much area."""
    if len(boundary_px) < 3:
        return boundary_px

    pts = np.array(boundary_px, dtype=np.int32).reshape(-1, 1, 2)
    poly_mask = np.zeros((img_h, img_w), dtype=np.uint8)
    cv2.drawContours(poly_mask, [pts], -1, 255, -1)
    original_area = np.count_nonzero(poly_mask)
    if original_area == 0:
        return boundary_px

    # AND with roof mask
    clipped = cv2.bitwise_and(poly_mask, roof_mask)
    clipped_area = np.count_nonzero(clipped)

    # Only use clipped version if >=80% of area is retained
    if clipped_area < original_area * 0.80:
        return boundary_px

    contours, _ = cv2.findContours(clipped, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return boundary_px

    # Take the largest contour from the clipped result
    largest = max(contours, key=cv2.contourArea)
    perimeter = cv2.arcLength(largest, True)
    if perimeter <= 0:
        return boundary_px
    simplified = cv2.approxPolyDP(largest, 0.015 * perimeter, True)
    result = [(int(pt[0][0]), int(pt[0][1])) for pt in simplified]
    return result if len(result) >= 3 else boundary_px


def _clip_dark_zones(
    boundary_px: list[tuple[int, int]],
    gray: np.ndarray,
    img_w: int,
    img_h: int,
    dark_threshold: int = 50,
) -> list[tuple[int, int]]:
    """Remove perimeter bleed into dark shadow / pavement zones."""
    if len(boundary_px) < 3:
        return boundary_px

    pts = np.array(boundary_px, dtype=np.int32).reshape(-1, 1, 2)
    poly_mask = np.zeros((img_h, img_w), dtype=np.uint8)
    cv2.drawContours(poly_mask, [pts], -1, 255, -1)
    original_area = np.count_nonzero(poly_mask)
    if original_area == 0:
        return boundary_px

    # Create non-dark mask (pixels above threshold)
    bright_mask = (gray > dark_threshold).astype(np.uint8) * 255
    clipped = cv2.bitwise_and(poly_mask, bright_mask)
    clipped_area = np.count_nonzero(clipped)

    if clipped_area < original_area * 0.70:
        return boundary_px

    contours, _ = cv2.findContours(clipped, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return boundary_px

    largest = max(contours, key=cv2.contourArea)
    perimeter = cv2.arcLength(largest, True)
    if perimeter <= 0:
        return boundary_px
    simplified = cv2.approxPolyDP(largest, 0.015 * perimeter, True)
    result = [(int(pt[0][0]), int(pt[0][1])) for pt in simplified]
    return result if len(result) >= 3 else boundary_px


# ---------------------------------------------------------------------------
# Non-max suppression
# ---------------------------------------------------------------------------

def _non_max_suppress(
    promoted: list[SegmentedRegion],
    overlap_threshold: float,
    centroid_merge_px: float = 40.0,
) -> tuple[list[SegmentedRegion], list[SegmentedRegion]]:
    """
    Suppress overlapping or co-located duplicate planes.

    Suppression triggers:
      1. Pixel overlap > threshold (fraction of smaller plane)
      2. Centroid distance < centroid_merge_px AND any overlap exists

    Returns (survivors, suppressed).
    """
    if len(promoted) <= 1:
        return list(promoted), []

    # Sort by area descending — prefer larger, more complete planes
    ranked = sorted(promoted, key=lambda r: r.area_px, reverse=True)
    suppressed_set: set[str] = set()
    survivors: list[SegmentedRegion] = []
    suppressed: list[SegmentedRegion] = []

    for region in ranked:
        if region.id in suppressed_set:
            suppressed.append(region)
            continue
        survivors.append(region)
        if region.mask is None:
            continue
        for other in ranked:
            if other.id == region.id or other.id in suppressed_set:
                continue
            if other.mask is None:
                continue

            intersection = np.count_nonzero(
                (region.mask == 255) & (other.mask == 255)
            )

            # Centroid distance
            cx1, cy1 = region.centroid_px
            cx2, cy2 = other.centroid_px
            cdist = math.sqrt((cx1 - cx2) ** 2 + (cy1 - cy2) ** 2)

            # Suppress if: heavy overlap OR close centroids with any overlap
            smaller_area = min(region.area_px, other.area_px)
            if smaller_area == 0:
                continue
            overlap_frac = intersection / smaller_area

            should_suppress = False
            if overlap_frac > overlap_threshold:
                should_suppress = True
            elif intersection > 0 and cdist < centroid_merge_px:
                should_suppress = True

            if should_suppress:
                suppressed_set.add(other.id)
                logger.info(
                    "NMS suppress %s (overlap=%.2f, cdist=%.0f) — keeping %s",
                    other.id, overlap_frac, cdist, region.id,
                )

    for region in ranked:
        if region.id in suppressed_set and region not in suppressed:
            suppressed.append(region)

    logger.info(
        "NMS: %d promoted → %d survivors, %d suppressed",
        len(promoted), len(survivors), len(suppressed),
    )
    return survivors, suppressed


# ---------------------------------------------------------------------------
# Plane conversion
# ---------------------------------------------------------------------------

def _region_to_plane(region: SegmentedRegion) -> RoofPlane:
    """Convert a qualifying SegmentedRegion into a RoofPlane."""
    vertices_2d = [Point2D(x=x, z=z) for x, z in region.boundary_local]
    vertices_3d = [Point3D(x=x, y=0.0, z=z) for x, z in region.boundary_local]

    confidence = min(0.5, region.confidence * 0.5)

    return RoofPlane(
        id=f"ie_plane_{uuid.uuid4().hex[:8]}",
        vertices=vertices_2d,
        vertices_3d=vertices_3d,
        plane_equation=_FLAT_PLANE_EQ,
        pitch_deg=0.0,
        azimuth_deg=0.0,
        height_m=0.0,
        elevation_m=0.0,
        area_m2=region.area_m2,
        is_flat=True,
        plane_type=PlaneType.main,
        structure_id="",
        confidence=confidence,
        needs_review=True,
        source="image_engine",
    )


# ---------------------------------------------------------------------------
# Diagnostic functions (called from processor.py)
# ---------------------------------------------------------------------------

def compute_plane_diagnostics(
    regions: list[SegmentedRegion],
) -> dict:
    """Per-plane metrics, diagnostic flags, and global summary."""
    promoted = [r for r in regions if r.promoted_to_plane]
    per_plane = []
    for r in promoted:
        scale = r.scale_used
        bx, by, bw, bh = r.bounding_box
        bbox_m = [round(bw * scale, 2), round(bh * scale, 2)] if scale > 0 else [0, 0]
        roof_overlap = getattr(r, "_roof_mask_overlap", 1.0)
        roof_veto = getattr(r, "_roof_veto_score", 0.0)
        tree_signals = getattr(r, "_tree_signals", 0)

        # Diagnostic flags
        flags = []
        if r.area_m2 > 150:
            flags.append("likely_scale_error")
        if getattr(r, "_green_fraction", 0) > 0.20 and roof_veto < 0.45:
            flags.append("likely_tree_bleed")
        if roof_overlap < 0.60:
            flags.append("likely_boundary_bleed")
        # Check bbox aspect vs area — inflated boundaries have area >> bbox area
        bbox_area_m2 = bbox_m[0] * bbox_m[1] if bbox_m[0] > 0 else 0
        if bbox_area_m2 > 0 and r.area_m2 > bbox_area_m2 * 0.95:
            flags.append("likely_boundary_inflation")

        per_plane.append({
            "plane_id": r.id,
            "area_px": round(r.area_px, 1),
            "area_m2": round(r.area_m2, 2),
            "bounding_box_px": list(r.bounding_box),
            "bounding_box_m": bbox_m,
            "centroid_px": list(r.centroid_px),
            "centroid_local": [round(c, 3) for c in r.centroid_local],
            "vertex_count": len(r.boundary_px),
            "confidence": round(r.confidence, 4),
            "scale_used": round(r.scale_used, 6),
            "perimeter_px": round(r.perimeter_px, 1),
            "compactness": round(r.compactness, 4),
            "roof_mask_overlap": round(roof_overlap, 3),
            "roof_veto_score": round(roof_veto, 3),
            "tree_signals": tree_signals,
            "flags": flags,
        })

    areas = [r.area_m2 for r in promoted]
    global_stats = {
        "plane_count": len(promoted),
        "total_area_m2": round(sum(areas), 2) if areas else 0,
        "avg_area_m2": round(sum(areas) / len(areas), 2) if areas else 0,
        "max_area_m2": round(max(areas), 2) if areas else 0,
        "min_area_m2": round(min(areas), 2) if areas else 0,
    }

    return {"per_plane": per_plane, "global": global_stats}


def compute_overlap_matrix(
    regions: list[SegmentedRegion],
) -> dict:
    """Pairwise overlap analysis between promoted regions."""
    promoted = [r for r in regions if r.promoted_to_plane and r.mask is not None]
    pairs = []
    flagged_ids: set[str] = set()

    for i in range(len(promoted)):
        for j in range(i + 1, len(promoted)):
            a, b = promoted[i], promoted[j]
            intersection = np.count_nonzero((a.mask == 255) & (b.mask == 255))
            if intersection == 0:
                continue
            union = np.count_nonzero((a.mask == 255) | (b.mask == 255))
            iou = intersection / union if union > 0 else 0
            overlap_a = intersection / a.area_px if a.area_px > 0 else 0
            overlap_b = intersection / b.area_px if b.area_px > 0 else 0
            flagged = max(overlap_a, overlap_b) > 0.20
            if flagged:
                flagged_ids.add(a.id)
                flagged_ids.add(b.id)
            # Check centroid proximity — nearby centroids = likely same roof mass
            ca = a.centroid_px
            cb = b.centroid_px
            centroid_dist = math.sqrt((ca[0] - cb[0])**2 + (ca[1] - cb[1])**2)
            likely_duplicate = flagged or (iou > 0.10 and centroid_dist < 50)

            pairs.append({
                "region_a": a.id,
                "region_b": b.id,
                "intersection_area_px": int(intersection),
                "iou": round(iou, 4),
                "overlap_frac_a": round(overlap_a, 4),
                "overlap_frac_b": round(overlap_b, 4),
                "centroid_dist_px": round(centroid_dist, 1),
                "flagged": flagged,
                "likely_duplicate_plane": likely_duplicate,
            })

    # Build duplicate groups via simple connected components
    groups: list[set[str]] = []
    for pair in pairs:
        if not pair["flagged"]:
            continue
        a_id, b_id = pair["region_a"], pair["region_b"]
        merged = False
        for group in groups:
            if a_id in group or b_id in group:
                group.add(a_id)
                group.add(b_id)
                merged = True
                break
        if not merged:
            groups.append({a_id, b_id})

    return {
        "pairs": pairs,
        "overlapping_pair_count": sum(1 for p in pairs if p["flagged"]),
        "duplicate_groups": [sorted(g) for g in groups],
    }


def compute_scale_validation(
    image_input: ImageInput,
    registration: RegistrationTransform,
    regions: list[SegmentedRegion],
    img_w: int,
    img_h: int,
) -> dict:
    """Validate scale conversion and flag implausible plane sizes."""
    if registration.scale > 0:
        scale_source = "registration"
        scale_val = registration.scale
    else:
        scale_source = "image_input_resolution"
        scale_val = image_input.resolution_m_per_px

    footprint_w = img_w * scale_val
    footprint_h = img_h * scale_val

    promoted = [r for r in regions if r.promoted_to_plane]
    flagged = []
    for r in promoted:
        if r.area_m2 > 300:
            flagged.append({"id": r.id, "area_m2": round(r.area_m2, 2), "reason": "too_large"})
        elif r.area_m2 < 8:
            flagged.append({"id": r.id, "area_m2": round(r.area_m2, 2), "reason": "too_small"})

    return {
        "scale_source": scale_source,
        "scale_m_per_px": round(scale_val, 6),
        "image_footprint_m": [round(footprint_w, 2), round(footprint_h, 2)],
        "flagged_planes": flagged,
    }
