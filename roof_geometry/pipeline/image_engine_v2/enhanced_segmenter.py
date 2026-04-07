"""
Enhanced segmentation — watershed, color clustering, region merging.

Produces regions from three sources, fuses them, then runs improved
filtering, confidence scoring, and NMS.  Imports v1 utilities where
possible (edge snapping, boundary smoothing, clipping, plane conversion).
"""

from __future__ import annotations

import logging
import math
import uuid

import cv2
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
    PreprocessedImage,
    SegmentedRegion,
)
# Reuse v1 tightening & diagnostic helpers
from pipeline.image_engine.segmenter import (
    _snap_boundary_to_edges,
    _smooth_boundary,
    _clip_to_roof_mask,
    _clip_dark_zones,
    _compute_roof_veto_score,
    _count_tree_signals,
    compute_plane_diagnostics,
    compute_overlap_matrix,
    compute_scale_validation,
)
from pipeline.image_engine_v2.config import V2Config

logger = logging.getLogger(__name__)

_FLAT_PLANE_EQ = PlaneEquation(a=0.0, b=1.0, c=0.0, d=0.0)


# ── Main entry ────────────────────────────────────────────────────────

def segment_regions_v2(
    preprocessed: PreprocessedImage,
    lines: list[ExtractedLine],
    edge_map: np.ndarray,
    image_input: ImageInput,
    registration: RegistrationTransform,
    config: V2Config,
) -> tuple[list[SegmentedRegion], list[RoofPlane], dict[str, int]]:
    """
    Multi-source segmentation pipeline:
      1. Edge-inversion contours (v1 approach)
      2. Watershed basins
      3. Color k-means clusters
      4. Fuse & deduplicate regions
      5. Rejection filter  (v1 logic, reused)
      6. Tighten boundaries (v1 logic, lighter erosion)
      7. Adjacent region merging (NEW)
      8. Improved NMS
      9. Convert → RoofPlane with better confidence
    """
    scale = _get_scale(image_input, registration)
    w, h = preprocessed.width_px, preprocessed.height_px

    logger.info("=== V2 SEGMENTER ===")
    logger.info("  scale: %.6f m/px  image: %d x %d", scale, w, h)

    rejection_counts = _empty_rejection_counts()

    # ── Source 1: edge-inversion contours (v1 approach) ──
    edge_regions = _edge_inversion_regions(
        edge_map, lines, preprocessed, w, h, scale, config,
    )
    logger.info("V2 source 1 (edge-inversion): %d regions", len(edge_regions))

    # ── Source 2: watershed ──
    watershed_regions: list[SegmentedRegion] = []
    if config.enable_watershed:
        watershed_regions = _watershed_regions(
            preprocessed, w, h, scale, config,
        )
        logger.info("V2 source 2 (watershed): %d regions", len(watershed_regions))

    # ── Source 3: color clustering ──
    color_regions: list[SegmentedRegion] = []
    if config.enable_color_clustering:
        color_regions = _color_cluster_regions(
            preprocessed, w, h, scale, config,
        )
        logger.info("V2 source 3 (color-cluster): %d regions", len(color_regions))

    # ── Fuse & deduplicate ──
    all_regions = _fuse_regions(edge_regions, watershed_regions, color_regions, w, h)
    all_regions.sort(key=lambda r: r.area_m2, reverse=True)
    logger.info("V2 fused: %d unique regions", len(all_regions))

    # ── Rejection filter (reuse v1 logic) ──
    for region in all_regions:
        reason = _rejection_reason_v2(region, w, h, config)
        if reason is None:
            region.promoted_to_plane = True
        else:
            rejection_counts[reason] += 1

    # ── Tighten boundaries (v1 helpers, v2 erosion params) ──
    _tighten_regions(all_regions, edge_map, preprocessed, w, h, scale, config)

    # ── Post-tighten size re-check ──
    for region in all_regions:
        if not region.promoted_to_plane:
            continue
        if region.area_m2 > config.max_region_area_m2:
            region.promoted_to_plane = False
            rejection_counts["rejected_too_large"] += 1
        elif region.area_m2 < config.min_region_area_m2:
            region.promoted_to_plane = False
            rejection_counts["rejected_too_small"] += 1

    # ── Adjacent region merging (NEW) ──
    if config.enable_region_merging:
        merge_count = _merge_adjacent_regions(all_regions, preprocessed, w, h, scale, config)
        logger.info("V2 region merging: %d merges performed", merge_count)

    # ── Improved NMS ──
    promoted = [r for r in all_regions if r.promoted_to_plane]
    survivors, suppressed = _nms_v2(promoted, config)
    rejection_counts["suppressed_nms"] = len(suppressed)
    for s in suppressed:
        s.promoted_to_plane = False

    # ── Convert to RoofPlane with better confidence ──
    planes = [_region_to_plane_v2(r, edge_map, config) for r in survivors]

    logger.info(
        "V2 segmentation: %d regions → %d promoted → %d after NMS",
        len(all_regions), len(promoted), len(planes),
    )
    return all_regions, planes, rejection_counts


# ── Source 1: edge-inversion (adapted from v1) ───────────────────────

def _edge_inversion_regions(
    edge_map: np.ndarray,
    lines: list[ExtractedLine],
    preprocessed: PreprocessedImage,
    w: int, h: int, scale: float,
    config: V2Config,
) -> list[SegmentedRegion]:
    """V1-style edge inversion, but produces raw SegmentedRegion objects."""
    combined = edge_map.copy()
    for ln in lines:
        cv2.line(combined, ln.start_px, ln.end_px, 255, thickness=2)

    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    closed = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, kernel, iterations=2)
    dilated = cv2.dilate(closed, kernel, iterations=1)
    inverted = cv2.bitwise_not(dilated)
    contours, _ = cv2.findContours(inverted, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    regions = []
    for contour in contours:
        r = _contour_to_region(
            contour, w, h, scale,
            preprocessed.hsv, preprocessed.gray, preprocessed.roof_mask,
            config, source="edge",
        )
        if r is not None:
            regions.append(r)
    return regions


# ── Source 2: watershed ──────────────────────────────────────────────

def _watershed_regions(
    preprocessed: PreprocessedImage,
    w: int, h: int, scale: float,
    config: V2Config,
) -> list[SegmentedRegion]:
    """Marker-based watershed on the roof-masked area."""
    # Work only within the roof mask
    masked_gray = cv2.bitwise_and(preprocessed.gray, preprocessed.gray, mask=preprocessed.roof_mask)

    # Distance transform → markers
    binary = (preprocessed.roof_mask > 0).astype(np.uint8)
    dist = cv2.distanceTransform(binary, cv2.DIST_L2, 5)
    dist_max = dist.max()
    if dist_max == 0:
        return []

    threshold = config.watershed_dist_threshold * dist_max
    _, markers_bin = cv2.threshold(dist, threshold, 255, cv2.THRESH_BINARY)
    markers_bin = markers_bin.astype(np.uint8)

    # Label connected components as markers
    n_labels, markers = cv2.connectedComponents(markers_bin)
    if n_labels <= 1:
        return []

    # Markers: background=0 → set to 1 (watershed needs >0 for known bg)
    # Unknown pixels = 0
    markers = markers + 1
    unknown = cv2.subtract(preprocessed.roof_mask, markers_bin)
    markers[unknown == 255] = 0

    # Watershed needs 3-channel input
    bgr = preprocessed.bgr.copy()
    cv2.watershed(bgr, markers)

    # Extract regions from each label (skip bg=1 and boundary=-1)
    regions = []
    for label_id in range(2, n_labels + 1):
        mask = (markers == label_id).astype(np.uint8) * 255
        area_px = int(np.count_nonzero(mask))
        if area_px < config.min_contour_area_px:
            continue

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        largest = max(contours, key=cv2.contourArea)
        r = _contour_to_region(
            largest, w, h, scale,
            preprocessed.hsv, preprocessed.gray, preprocessed.roof_mask,
            config, source="watershed",
        )
        if r is not None:
            r.mask = mask  # use the watershed mask, not contour-derived
            r.area_px = float(area_px)
            r.area_m2 = area_px * scale * scale
            regions.append(r)

    return regions


# ── Source 3: color clustering ───────────────────────────────────────

def _color_cluster_regions(
    preprocessed: PreprocessedImage,
    w: int, h: int, scale: float,
    config: V2Config,
) -> list[SegmentedRegion]:
    """K-means color clustering on LAB color space within roof mask."""
    # Convert to LAB for perceptual uniformity
    lab = cv2.cvtColor(preprocessed.bgr, cv2.COLOR_BGR2LAB)

    # Only cluster pixels within roof mask
    roof_pixels = preprocessed.roof_mask > 0
    pixel_coords = np.argwhere(roof_pixels)  # (row, col)
    if len(pixel_coords) < config.color_k * 50:
        return []

    # Sample LAB values at roof pixels
    lab_values = lab[roof_pixels].astype(np.float32)

    # K-means
    criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 30, 1.0)
    _, labels, centers = cv2.kmeans(
        lab_values, config.color_k, None, criteria, 5, cv2.KMEANS_PP_CENTERS,
    )
    labels = labels.flatten()

    # Build label image
    label_img = np.full((h, w), -1, dtype=np.int32)
    label_img[roof_pixels] = labels

    # Merge similar adjacent clusters
    merged_labels = _merge_similar_clusters(
        label_img, centers, config.color_merge_threshold, config.color_k,
    )

    # Extract regions
    regions = []
    unique_labels = set(merged_labels[merged_labels >= 0])
    for label_id in unique_labels:
        mask = (merged_labels == label_id).astype(np.uint8) * 255
        area_px = int(np.count_nonzero(mask))
        if area_px < config.min_contour_area_px:
            continue

        # Morphological clean — remove noise and small holes
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=1)
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=1)

        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            if cv2.contourArea(contour) < config.min_contour_area_px:
                continue
            r = _contour_to_region(
                contour, w, h, scale,
                preprocessed.hsv, preprocessed.gray, preprocessed.roof_mask,
                config, source="color",
            )
            if r is not None:
                regions.append(r)

    return regions


def _merge_similar_clusters(
    label_img: np.ndarray,
    centers: np.ndarray,
    threshold: float,
    k: int,
) -> np.ndarray:
    """Merge clusters whose LAB centers are within threshold distance."""
    merge_map = list(range(k))

    for i in range(k):
        for j in range(i + 1, k):
            if merge_map[j] != j:
                continue  # already merged
            delta = np.linalg.norm(centers[i].astype(float) - centers[j].astype(float))
            if delta < threshold:
                merge_map[j] = merge_map[i]

    # Propagate transitive merges
    for i in range(k):
        root = i
        while merge_map[root] != root:
            root = merge_map[root]
        merge_map[i] = root

    result = label_img.copy()
    for i in range(k):
        if merge_map[i] != i:
            result[label_img == i] = merge_map[i]

    return result


# ── Region fusion & deduplication ────────────────────────────────────

def _fuse_regions(
    edge_regions: list[SegmentedRegion],
    watershed_regions: list[SegmentedRegion],
    color_regions: list[SegmentedRegion],
    w: int, h: int,
) -> list[SegmentedRegion]:
    """Combine regions from all sources, suppressing near-duplicates."""
    all_regions = list(edge_regions)
    existing_masks = []

    # Build mask list from edge regions
    for r in edge_regions:
        if r.mask is not None:
            existing_masks.append(r.mask)

    # Add watershed and color regions only if they don't heavily overlap existing
    for source_name, source_regions in [("watershed", watershed_regions), ("color", color_regions)]:
        for candidate in source_regions:
            if candidate.mask is None:
                continue
            is_duplicate = False
            for existing in existing_masks:
                intersection = np.count_nonzero((candidate.mask > 0) & (existing > 0))
                candidate_px = np.count_nonzero(candidate.mask > 0)
                if candidate_px > 0 and intersection / candidate_px > 0.60:
                    is_duplicate = True
                    break
            if not is_duplicate:
                all_regions.append(candidate)
                existing_masks.append(candidate.mask)

    return all_regions


# ── Region construction (shared by all sources) ─────────────────────

def _contour_to_region(
    contour: np.ndarray,
    img_w: int, img_h: int, scale: float,
    hsv: np.ndarray, gray: np.ndarray, roof_mask: np.ndarray,
    config: V2Config,
    source: str = "unknown",
) -> SegmentedRegion | None:
    """Convert a contour into a SegmentedRegion. Mirrors v1 logic."""
    area_px = cv2.contourArea(contour)
    if area_px < config.min_contour_area_px:
        return None

    area_m2 = area_px * scale * scale
    perimeter = cv2.arcLength(contour, True)
    if perimeter == 0:
        return None
    compactness = (4 * math.pi * area_px) / (perimeter * perimeter)

    rect = cv2.minAreaRect(contour)
    box_w, box_h = rect[1]
    if box_w == 0 or box_h == 0:
        return None
    aspect_ratio = max(box_w, box_h) / min(box_w, box_h)

    bx, by, bw, bh = cv2.boundingRect(contour)

    epsilon = 0.02 * perimeter
    simplified = cv2.approxPolyDP(contour, epsilon, True)
    boundary_px = [(int(pt[0][0]), int(pt[0][1])) for pt in simplified]
    boundary_local = [px_to_local(px, py, img_w, img_h, scale) for px, py in boundary_px]

    M = cv2.moments(contour)
    if M["m00"] > 0:
        cx, cy = int(M["m10"] / M["m00"]), int(M["m01"] / M["m00"])
    else:
        cx, cy = int(rect[0][0]), int(rect[0][1])

    centroid_local = px_to_local(cx, cy, img_w, img_h, scale)

    region_mask = np.zeros(hsv.shape[:2], dtype=np.uint8)
    cv2.drawContours(region_mask, [contour], -1, 255, -1)
    mask_pixels = np.count_nonzero(region_mask)
    if mask_pixels == 0:
        return None

    # Material hint
    mean_hsv = cv2.mean(hsv, mask=region_mask)[:3]
    h_val, s_val, v_val = mean_hsv
    if s_val < 30:
        material = "grey_shingle" if v_val > 120 else "dark_shingle"
    elif 10 < h_val < 25:
        material = "brown_shingle"
    elif 35 < h_val < 85:
        material = "green_material"
    elif 100 < h_val < 130:
        material = "blue_material"
    else:
        material = "unknown"

    # Green fraction
    h_ch, s_ch = hsv[:, :, 0], hsv[:, :, 1]
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
    roof_overlap = np.count_nonzero((region_mask == 255) & (roof_mask == 255)) / mask_pixels

    # V2 confidence: weighted multi-factor score
    confidence = _compute_confidence_v2(
        compactness, area_m2, roof_overlap, 0.0, config,
    )

    region = SegmentedRegion(
        id=f"v2_{source}_{uuid.uuid4().hex[:8]}",
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
        material_hint=material,
        confidence=confidence,
    )

    # Attach private quality metrics (same pattern as v1)
    region._green_fraction = green_fraction  # type: ignore[attr-defined]
    region._texture_variance = texture_variance  # type: ignore[attr-defined]
    region._roof_mask_overlap = roof_overlap  # type: ignore[attr-defined]
    region._roof_veto_score = _compute_roof_veto_score(contour, boundary_px, compactness, area_px)  # type: ignore[attr-defined]
    region._tree_signals = _count_tree_signals(contour, boundary_px, green_fraction, texture_variance, compactness, region_mask, gray)  # type: ignore[attr-defined]
    region._source = source  # type: ignore[attr-defined]

    return region


# ── V2 confidence model ─────────────────────────────────────────────

def _compute_confidence_v2(
    compactness: float,
    area_m2: float,
    roof_overlap: float,
    edge_support: float,
    config: V2Config,
) -> float:
    """Multi-factor confidence score (0–1). No double-capping."""
    # Compactness factor: rectangles ~0.78, circles ~1.0, irregular <0.3
    compact_score = min(compactness / 0.78, 1.0)

    # Area factor: sweet spot 15–80 m², tapers outside
    if area_m2 < 5:
        area_score = area_m2 / 5.0
    elif area_m2 < 15:
        area_score = 0.7 + 0.3 * (area_m2 - 5) / 10
    elif area_m2 <= 80:
        area_score = 1.0
    elif area_m2 <= 200:
        area_score = 1.0 - 0.3 * (area_m2 - 80) / 120
    else:
        area_score = 0.5

    # Roof mask overlap factor
    overlap_score = min(roof_overlap / 0.8, 1.0)

    # Edge support factor (0 for now — computed later if we have edge data)
    edge_score = edge_support

    score = (
        config.confidence_compactness_weight * compact_score
        + config.confidence_area_weight * area_score
        + config.confidence_overlap_weight * overlap_score
        + config.confidence_edge_support_weight * edge_score
    )
    return min(config.plane_confidence_cap, max(0.05, score))


# ── Rejection filter (mirrors v1, same logic) ───────────────────────

def _rejection_reason_v2(
    region: SegmentedRegion,
    img_w: int, img_h: int,
    config: V2Config,
) -> str | None:
    """Same rejection logic as v1 — imported scoring, same thresholds."""
    roof_veto = getattr(region, "_roof_veto_score", 0.0)
    tree_signals = getattr(region, "_tree_signals", 0)
    green_frac = getattr(region, "_green_fraction", 0.0)
    tex_var = getattr(region, "_texture_variance", 0.0)
    roof_overlap = getattr(region, "_roof_mask_overlap", 1.0)

    if roof_veto < 0.45 and tree_signals >= 3:
        if green_frac > config.max_green_fraction:
            return "rejected_vegetation"
        if tex_var > config.max_texture_variance:
            return "rejected_texture"

    overlap_threshold = config.min_roof_mask_overlap
    if roof_veto >= 0.45:
        overlap_threshold = min(overlap_threshold, 0.30)
    if roof_overlap < overlap_threshold:
        return "rejected_roof_mask_overlap"

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
    if cx < margin_x or cx > img_w - margin_x or cy < margin_y or cy > img_h - margin_y:
        return "rejected_centrality"

    if len(region.boundary_local) < 3:
        return "rejected_vertex_count"

    return None


# ── Boundary tightening (reuses v1 helpers, v2 erosion) ──────────────

def _tighten_regions(
    all_regions: list[SegmentedRegion],
    edge_map: np.ndarray,
    preprocessed: PreprocessedImage,
    w: int, h: int, scale: float,
    config: V2Config,
) -> None:
    """Apply v1 boundary tightening with v2 erosion parameters."""
    ek_size = config.erosion_kernel_size  # v2 default: 5 (vs v1: 7)
    erode_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ek_size, ek_size))

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
            retention=config.roof_mask_clip_retention,
        )
        region.boundary_px = _clip_dark_zones(
            region.boundary_px, preprocessed.gray, w, h,
            retention=config.dark_zone_clip_retention,
        )

        # Build mask + erode (lighter than v1)
        new_mask = np.zeros((h, w), dtype=np.uint8)
        pts = np.array(region.boundary_px, dtype=np.int32).reshape(-1, 1, 2)
        cv2.drawContours(new_mask, [pts], -1, 255, -1)
        pre_erode_px = float(np.count_nonzero(new_mask))

        new_mask = cv2.erode(new_mask, erode_k, iterations=config.erosion_iterations)

        # Edge barrier (optional, same as v1)
        if config.enable_edge_barrier:
            edge_dilated = cv2.dilate(
                edge_map, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)), iterations=1,
            )
            new_mask = cv2.bitwise_and(new_mask, cv2.bitwise_not(edge_dilated))

        # Largest connected component
        split_contours, _ = cv2.findContours(new_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if split_contours:
            largest_c = max(split_contours, key=cv2.contourArea)
            new_mask = np.zeros((h, w), dtype=np.uint8)
            cv2.drawContours(new_mask, [largest_c], -1, 255, -1)

        post_area_px = float(np.count_nonzero(new_mask))

        # Mask preservation guard
        if pre_erode_px > 0 and post_area_px < max(pre_erode_px * 0.20, 100):
            new_mask = np.zeros((h, w), dtype=np.uint8)
            pts = np.array(region.boundary_px, dtype=np.int32).reshape(-1, 1, 2)
            cv2.drawContours(new_mask, [pts], -1, 255, -1)
            fb_k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
            new_mask = cv2.erode(new_mask, fb_k, iterations=1)
            post_area_px = float(np.count_nonzero(new_mask))

        if post_area_px > pre_area_px:
            region.boundary_px = original_boundary
            new_mask = np.zeros((h, w), dtype=np.uint8)
            pts = np.array(region.boundary_px, dtype=np.int32).reshape(-1, 1, 2)
            cv2.drawContours(new_mask, [pts], -1, 255, -1)
            new_mask = cv2.erode(new_mask, erode_k, iterations=config.erosion_iterations)
            post_area_px = float(np.count_nonzero(new_mask))

        region.mask = new_mask
        region.area_px = post_area_px
        region.area_m2 = post_area_px * scale * scale

        # Recompute boundary from final mask
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


# ── Adjacent region merging ──────────────────────────────────────────

def _merge_adjacent_regions(
    all_regions: list[SegmentedRegion],
    preprocessed: PreprocessedImage,
    w: int, h: int, scale: float,
    config: V2Config,
) -> int:
    """Merge adjacent promoted regions with similar color."""
    promoted = [r for r in all_regions if r.promoted_to_plane and r.mask is not None]
    if len(promoted) < 2:
        return 0

    lab = cv2.cvtColor(preprocessed.bgr, cv2.COLOR_BGR2LAB)
    merge_count = 0
    merged_ids: set[str] = set()

    for i in range(len(promoted)):
        if promoted[i].id in merged_ids:
            continue
        for j in range(i + 1, len(promoted)):
            if promoted[j].id in merged_ids:
                continue

            a, b = promoted[i], promoted[j]

            # Check if they share a border (dilate A, intersect with B)
            dilated_a = cv2.dilate(a.mask, np.ones((5, 5), np.uint8), iterations=1)
            border_px = int(np.count_nonzero((dilated_a > 0) & (b.mask > 0)))
            smaller_perim = min(a.perimeter_px, b.perimeter_px)
            if smaller_perim == 0 or border_px / smaller_perim < config.merge_border_fraction:
                continue

            # Check color similarity (mean LAB delta)
            mean_a = np.array(cv2.mean(lab, mask=a.mask)[:3])
            mean_b = np.array(cv2.mean(lab, mask=b.mask)[:3])
            color_delta = float(np.linalg.norm(mean_a - mean_b))
            if color_delta > config.merge_color_max_delta:
                continue

            # Merge B into A
            a.mask = cv2.bitwise_or(a.mask, b.mask)
            a.area_px = float(np.count_nonzero(a.mask))
            a.area_m2 = a.area_px * scale * scale

            # Recompute boundary
            contours, _ = cv2.findContours(a.mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if contours:
                largest = max(contours, key=cv2.contourArea)
                perim = cv2.arcLength(largest, True)
                if perim > 0:
                    simplified = cv2.approxPolyDP(largest, 0.012 * perim, True)
                    a.boundary_px = [(int(p[0][0]), int(p[0][1])) for p in simplified]
                    a.boundary_local = [
                        px_to_local(px, py, w, h, scale) for px, py in a.boundary_px
                    ]
                    a.perimeter_px = perim

            b.promoted_to_plane = False
            merged_ids.add(b.id)
            merge_count += 1
            logger.info(
                "V2 merged %s into %s (border=%dpx, color_delta=%.1f)",
                b.id, a.id, border_px, color_delta,
            )

    return merge_count


# ── Improved NMS ─────────────────────────────────────────────────────

def _nms_v2(
    promoted: list[SegmentedRegion],
    config: V2Config,
) -> tuple[list[SegmentedRegion], list[SegmentedRegion]]:
    """Quality-weighted NMS — keeps the better-quality region, not just largest."""
    if len(promoted) <= 1:
        return list(promoted), []

    def quality(r: SegmentedRegion) -> float:
        if config.nms_quality_weighted:
            return r.confidence * 0.5 + min(r.area_px / 10000, 0.5)
        return r.area_px

    ranked = sorted(promoted, key=quality, reverse=True)
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
            if other.id == region.id or other.id in suppressed_set or other.mask is None:
                continue

            intersection = np.count_nonzero((region.mask == 255) & (other.mask == 255))
            smaller_area = min(region.area_px, other.area_px)
            if smaller_area == 0:
                continue
            overlap_frac = intersection / smaller_area

            cx1, cy1 = region.centroid_px
            cx2, cy2 = other.centroid_px
            cdist = math.sqrt((cx1 - cx2) ** 2 + (cy1 - cy2) ** 2)

            should_suppress = False
            if overlap_frac > config.nms_overlap_threshold:
                should_suppress = True
            elif (
                intersection > 0
                and cdist < config.nms_centroid_merge_px
                and overlap_frac > config.nms_min_overlap_for_centroid
            ):
                should_suppress = True

            if should_suppress:
                suppressed_set.add(other.id)

    for region in ranked:
        if region.id in suppressed_set and region not in suppressed:
            suppressed.append(region)

    return survivors, suppressed


# ── Plane conversion with better confidence ──────────────────────────

def _region_to_plane_v2(
    region: SegmentedRegion,
    edge_map: np.ndarray,
    config: V2Config,
) -> RoofPlane:
    """Convert region to RoofPlane. No double confidence cap."""
    vertices_2d = [Point2D(x=x, z=z) for x, z in region.boundary_local]
    vertices_3d = [Point3D(x=x, y=0.0, z=z) for x, z in region.boundary_local]

    # Edge support: fraction of boundary vertices near strong edges
    edge_support = _compute_edge_support(region, edge_map)

    # Recompute confidence with edge support factor
    confidence = _compute_confidence_v2(
        region.compactness,
        region.area_m2,
        getattr(region, "_roof_mask_overlap", 1.0),
        edge_support,
        config,
    )

    return RoofPlane(
        id=f"v2_plane_{uuid.uuid4().hex[:8]}",
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
        source="image_engine_v2",
    )


def _compute_edge_support(region: SegmentedRegion, edge_map: np.ndarray) -> float:
    """Fraction of boundary vertices within 5px of a strong edge."""
    if not region.boundary_px:
        return 0.0
    h, w = edge_map.shape[:2]
    near_edge = 0
    for vx, vy in region.boundary_px:
        x0, y0 = max(0, vx - 5), max(0, vy - 5)
        x1, y1 = min(w, vx + 6), min(h, vy + 6)
        if np.any(edge_map[y0:y1, x0:x1] > 0):
            near_edge += 1
    return near_edge / len(region.boundary_px)


# ── Helpers ──────────────────────────────────────────────────────────

def _get_scale(image_input: ImageInput, registration: RegistrationTransform) -> float:
    if registration.scale > 0:
        return registration.scale
    return image_input.resolution_m_per_px


def _empty_rejection_counts() -> dict[str, int]:
    return {
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
