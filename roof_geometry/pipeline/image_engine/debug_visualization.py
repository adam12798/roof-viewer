"""
Debug visualization for the image engine pipeline.

Generates overlay images showing detected edges, lines, segmented regions,
obstruction candidates, and dormer candidates. Each overlay is encoded
as a base64 PNG string.
"""

from __future__ import annotations

import base64
import logging
from io import BytesIO

import numpy as np

from pipeline.image_engine.schemas import (
    DebugArtifact,
    DormerCandidate,
    ExtractedLine,
    ObstructionCandidate,
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

# Colour palette for region overlays
_REGION_COLORS = [
    (66, 133, 244),   # blue
    (52, 168, 83),    # green
    (251, 188, 4),    # yellow
    (234, 67, 53),    # red
    (154, 160, 166),  # grey
    (255, 112, 67),   # orange
    (129, 212, 250),  # light blue
    (174, 213, 129),  # light green
]


def generate_debug_artifacts(
    preprocessed: PreprocessedImage,
    edge_map: np.ndarray,
    lines: list[ExtractedLine],
    regions: list[SegmentedRegion],
    obstructions: list[ObstructionCandidate],
    dormers: list[DormerCandidate],
) -> list[DebugArtifact]:
    """
    Generate all debug overlay images.

    Returns a list of DebugArtifact objects, each containing a
    base64-encoded PNG overlay image.
    """
    if not HAS_CV2:
        return []

    artifacts: list[DebugArtifact] = []

    # 1. Edge map overlay
    edge_artifact = _draw_edge_overlay(preprocessed.bgr, edge_map)
    if edge_artifact:
        artifacts.append(edge_artifact)

    # 2. Lines overlay
    lines_artifact = _draw_lines_overlay(preprocessed.bgr, lines)
    if lines_artifact:
        artifacts.append(lines_artifact)

    # 3. Regions overlay
    regions_artifact = _draw_regions_overlay(preprocessed.bgr, regions)
    if regions_artifact:
        artifacts.append(regions_artifact)

    # 4. Obstruction candidates overlay
    if obstructions:
        obst_artifact = _draw_obstructions_overlay(preprocessed.bgr, obstructions)
        if obst_artifact:
            artifacts.append(obst_artifact)

    # 5. Dormer candidates overlay
    if dormers:
        dormer_artifact = _draw_dormers_overlay(preprocessed.bgr, dormers)
        if dormer_artifact:
            artifacts.append(dormer_artifact)

    # 6. Combined overlay
    combined_artifact = _draw_combined_overlay(
        preprocessed.bgr, edge_map, lines, regions, obstructions, dormers,
    )
    if combined_artifact:
        artifacts.append(combined_artifact)

    # 7. Roof coverage overlay
    coverage_artifact = _draw_coverage_overlay(preprocessed.bgr, preprocessed.roof_mask, regions)
    if coverage_artifact:
        artifacts.append(coverage_artifact)

    logger.info("Generated %d debug artifacts", len(artifacts))
    return artifacts


def _encode_image(img: np.ndarray) -> str:
    """Encode a BGR image as a base64 PNG string."""
    _, buffer = cv2.imencode(".png", img)
    return base64.b64encode(buffer).decode("utf-8")


def _draw_edge_overlay(bgr: np.ndarray, edge_map: np.ndarray) -> DebugArtifact | None:
    """Draw Canny edges in green over the original image."""
    overlay = bgr.copy()
    edge_colored = np.zeros_like(overlay)
    edge_colored[edge_map > 0] = (0, 255, 0)
    overlay = cv2.addWeighted(overlay, 0.7, edge_colored, 0.3, 0)

    return DebugArtifact(
        name="edges",
        description="Canny edge detection overlay",
        image_base64=_encode_image(overlay),
    )


def _draw_lines_overlay(bgr: np.ndarray, lines: list[ExtractedLine]) -> DebugArtifact | None:
    """Draw extracted line segments over the original image."""
    overlay = bgr.copy()
    for ln in lines:
        color = (0, 0, 255) if ln.confidence > 0.5 else (0, 165, 255)
        thickness = 2 if ln.length_m > 3.0 else 1
        cv2.line(overlay, ln.start_px, ln.end_px, color, thickness)
        # Draw small circles at endpoints
        cv2.circle(overlay, ln.start_px, 3, (255, 0, 0), -1)
        cv2.circle(overlay, ln.end_px, 3, (255, 0, 0), -1)

    return DebugArtifact(
        name="lines",
        description=f"Extracted line segments ({len(lines)} lines)",
        image_base64=_encode_image(overlay),
    )


def _draw_regions_overlay(
    bgr: np.ndarray,
    regions: list[SegmentedRegion],
) -> DebugArtifact | None:
    """Draw segmented regions with colour-coded overlays."""
    overlay = bgr.copy()
    mask_layer = np.zeros_like(overlay)
    promoted_count = 0

    for i, region in enumerate(regions):
        if len(region.boundary_px) < 3:
            continue
        color = _REGION_COLORS[i % len(_REGION_COLORS)]
        pts = np.array(region.boundary_px, dtype=np.int32).reshape(-1, 1, 2)

        if region.promoted_to_plane:
            # Filled overlay for promoted regions
            cv2.fillPoly(mask_layer, [pts], color)
            cv2.polylines(overlay, [pts], True, (255, 255, 255), 2)
            promoted_count += 1
        else:
            # Outline only for non-promoted regions
            cv2.polylines(overlay, [pts], True, color, 1)

        # Label
        cx, cy = region.centroid_px
        label = f"{region.area_m2:.0f}m²"
        cv2.putText(overlay, label, (cx - 20, cy), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (255, 255, 255), 1)

    overlay = cv2.addWeighted(overlay, 0.7, mask_layer, 0.3, 0)

    return DebugArtifact(
        name="regions",
        description=f"Segmented regions ({len(regions)} total, {promoted_count} promoted)",
        image_base64=_encode_image(overlay),
    )


def _draw_obstructions_overlay(
    bgr: np.ndarray,
    obstructions: list[ObstructionCandidate],
) -> DebugArtifact | None:
    """Draw obstruction candidates with markers and labels."""
    overlay = bgr.copy()

    for obst in obstructions:
        cx, cy = obst.center_px
        color = {
            "chimney": (0, 0, 255),
            "vent": (0, 255, 255),
            "skylight": (255, 255, 0),
            "pipe": (255, 0, 255),
        }.get(obst.classification, (128, 128, 128))

        if len(obst.boundary_px) >= 3:
            pts = np.array(obst.boundary_px, dtype=np.int32).reshape(-1, 1, 2)
            cv2.polylines(overlay, [pts], True, color, 2)

        cv2.circle(overlay, (cx, cy), 8, color, 2)
        label = f"{obst.classification} ({obst.confidence:.2f})"
        cv2.putText(overlay, label, (cx + 10, cy - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.35, color, 1)

    return DebugArtifact(
        name="obstructions",
        description=f"Obstruction candidates ({len(obstructions)})",
        image_base64=_encode_image(overlay),
    )


def _draw_dormers_overlay(
    bgr: np.ndarray,
    dormers: list[DormerCandidate],
) -> DebugArtifact | None:
    """Draw dormer candidates with outlines and labels."""
    overlay = bgr.copy()

    for dormer in dormers:
        cx, cy = dormer.centroid_px
        color = (0, 200, 200)

        if len(dormer.boundary_px) >= 3:
            pts = np.array(dormer.boundary_px, dtype=np.int32).reshape(-1, 1, 2)
            cv2.polylines(overlay, [pts], True, color, 2)

        cv2.drawMarker(overlay, (cx, cy), color, cv2.MARKER_DIAMOND, 12, 2)
        label = f"{dormer.dormer_type} ({dormer.width_m:.1f}x{dormer.depth_m:.1f}m)"
        cv2.putText(overlay, label, (cx + 10, cy - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.35, color, 1)

    return DebugArtifact(
        name="dormers",
        description=f"Dormer candidates ({len(dormers)})",
        image_base64=_encode_image(overlay),
    )


def _draw_combined_overlay(
    bgr: np.ndarray,
    edge_map: np.ndarray,
    lines: list[ExtractedLine],
    regions: list[SegmentedRegion],
    obstructions: list[ObstructionCandidate],
    dormers: list[DormerCandidate],
) -> DebugArtifact | None:
    """Draw a combined overlay with all detections."""
    overlay = bgr.copy()
    mask_layer = np.zeros_like(overlay)

    # Regions (filled)
    for i, region in enumerate(regions):
        if not region.promoted_to_plane or len(region.boundary_px) < 3:
            continue
        color = _REGION_COLORS[i % len(_REGION_COLORS)]
        pts = np.array(region.boundary_px, dtype=np.int32).reshape(-1, 1, 2)
        cv2.fillPoly(mask_layer, [pts], color)

    overlay = cv2.addWeighted(overlay, 0.6, mask_layer, 0.4, 0)

    # Lines
    for ln in lines:
        cv2.line(overlay, ln.start_px, ln.end_px, (0, 0, 255), 1)

    # Obstructions
    for obst in obstructions:
        cv2.circle(overlay, obst.center_px, 6, (255, 0, 255), 2)

    # Dormers
    for dormer in dormers:
        cv2.drawMarker(overlay, dormer.centroid_px, (0, 200, 200), cv2.MARKER_DIAMOND, 10, 2)

    return DebugArtifact(
        name="combined",
        description="Combined overlay: regions, lines, obstructions, dormers",
        image_base64=_encode_image(overlay),
    )


def _draw_coverage_overlay(
    bgr: np.ndarray,
    roof_mask: np.ndarray,
    regions: list[SegmentedRegion],
) -> DebugArtifact | None:
    """
    Roof coverage overlay:
      - Cyan contour: roof-likelihood mask boundary
      - Green fill: promoted plane area covering the roof mask
      - Red tint: uncovered roof-likelihood area (missed by planes)
      - White outlines: promoted plane boundaries
      - Yellow labels: per-region overlap % with roof mask
      - Cyan/magenta bboxes: spatial comparison when coverage is 0%
    """
    h, w = bgr.shape[:2]
    overlay = bgr.copy()

    # Build promoted planes mask
    promoted_count = 0
    promoted_mask = np.zeros((h, w), dtype=np.uint8)
    for region in regions:
        if not region.promoted_to_plane or len(region.boundary_px) < 3:
            continue
        promoted_count += 1
        if region.mask is not None:
            promoted_mask = cv2.bitwise_or(promoted_mask, region.mask)
        else:
            pts = np.array(region.boundary_px, dtype=np.int32).reshape(-1, 1, 2)
            cv2.fillPoly(promoted_mask, [pts], 255)

    # Covered = roof_mask AND promoted
    covered = cv2.bitwise_and(roof_mask, promoted_mask)
    # Uncovered = roof_mask AND NOT promoted
    uncovered = cv2.bitwise_and(roof_mask, cv2.bitwise_not(promoted_mask))

    # Color layers
    color_layer = np.zeros_like(overlay)
    # Green: covered roof area
    color_layer[covered > 0] = (0, 200, 0)
    # Red: uncovered roof area
    color_layer[uncovered > 0] = (0, 0, 200)

    overlay = cv2.addWeighted(overlay, 0.6, color_layer, 0.4, 0)

    # Draw roof_mask contours in cyan
    roof_contours, _ = cv2.findContours(roof_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(overlay, roof_contours, -1, (255, 255, 0), 2)  # cyan in BGR

    # Draw promoted plane outlines in white + per-region overlap annotation
    for region in regions:
        if not region.promoted_to_plane or len(region.boundary_px) < 3:
            continue
        pts = np.array(region.boundary_px, dtype=np.int32).reshape(-1, 1, 2)
        cv2.polylines(overlay, [pts], True, (255, 255, 255), 2)

        # Per-region overlap with roof_mask
        if region.mask is not None:
            region_nz = int(np.count_nonzero(region.mask))
            region_isect = int(np.count_nonzero(cv2.bitwise_and(roof_mask, region.mask)))
            region_overlap_pct = (region_isect / region_nz * 100) if region_nz > 0 else 0
            cx, cy = region.centroid_px
            if region_overlap_pct == 0:
                cv2.drawMarker(overlay, (cx, cy), (0, 0, 255), cv2.MARKER_TILTED_CROSS, 14, 2)
                cv2.putText(overlay, "0% OVERLAP", (cx + 10, cy),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 0, 255), 1)
            else:
                cv2.putText(overlay, f"{region_overlap_pct:.0f}%", (cx + 10, cy),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.35, (0, 255, 255), 1)

    # Stats
    roof_px = int(np.count_nonzero(roof_mask))
    promoted_px = int(np.count_nonzero(promoted_mask))
    covered_px = int(np.count_nonzero(covered))
    uncovered_px = int(np.count_nonzero(uncovered))
    coverage_pct = (covered_px / roof_px * 100) if roof_px > 0 else 0

    line1 = f"Coverage: {coverage_pct:.0f}% | Roof:{roof_px}px Promoted:{promoted_px}px Covered:{covered_px}px"
    cv2.putText(overlay, line1, (10, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    line2 = f"Promoted regions: {promoted_count} | Outside roof: {promoted_px - covered_px}px"
    cv2.putText(overlay, line2, (10, 45), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)

    # Bounding box comparison when coverage is 0%
    if covered_px == 0 and promoted_px > 0 and roof_px > 0:
        cv2.putText(overlay, "WARNING: NO OVERLAP — check coordinate alignment",
                    (10, 65), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 1)
        # Roof mask bbox in cyan
        roof_ys, roof_xs = np.nonzero(roof_mask)
        cv2.rectangle(overlay, (int(roof_xs.min()), int(roof_ys.min())),
                       (int(roof_xs.max()), int(roof_ys.max())), (255, 255, 0), 2)
        # Promoted mask bbox in magenta
        promo_ys, promo_xs = np.nonzero(promoted_mask)
        cv2.rectangle(overlay, (int(promo_xs.min()), int(promo_ys.min())),
                       (int(promo_xs.max()), int(promo_ys.max())), (255, 0, 255), 2)

    return DebugArtifact(
        name="coverage",
        description=f"Roof coverage: {coverage_pct:.0f}% of roof mask covered by promoted planes",
        image_base64=_encode_image(overlay),
    )
