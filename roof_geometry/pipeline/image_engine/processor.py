"""
Top-level processor for the image engine pipeline.

Wires together all sub-modules: preprocessing, edge detection,
line extraction, segmentation, obstruction/dormer detection,
and debug visualization.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
import uuid
from dataclasses import asdict
from datetime import datetime, timezone

import numpy as np

from models.schemas import ImageInput, RegistrationTransform
from pipeline.image_engine.debug_visualization import generate_debug_artifacts
from pipeline.image_engine.dormer_detector import detect_dormers
from pipeline.image_engine.edge_detector import detect_edges, extract_lines
from pipeline.image_engine.obstruction_detector import detect_obstructions
from pipeline.image_engine.preprocess import preprocess_image
from pipeline.image_engine.schemas import ImageEngineConfig, ImageEngineResult
from pipeline.image_engine.segmenter import (
    segment_regions,
    compute_plane_diagnostics,
    compute_overlap_matrix,
    compute_scale_validation,
)

logger = logging.getLogger(__name__)

IMAGE_ENGINE_VERSION = "0.7.0-dormer-overlap"


def run_image_engine(
    image_input: ImageInput,
    registration: RegistrationTransform,
    config: ImageEngineConfig | None = None,
) -> ImageEngineResult:
    """
    Run the complete image engine pipeline.

    This is the single entry point called by the orchestrator.
    Always returns a valid ImageEngineResult — zero planes is acceptable.

    Pipeline stages:
      1. Preprocess image (load, CLAHE, denoise, grayscale, HSV)
      2. Detect edges (Canny)
      3. Extract lines (LSD + Hough, merge collinear)
      4. Segment regions → promote qualifying to RoofPlane
      5. Detect obstruction candidates
      6. Detect dormer candidates
      7. Generate debug visualization artifacts
    """
    if config is None:
        config = ImageEngineConfig()

    timings: dict[str, float] = {}
    t_total = time.perf_counter()

    # Stage 1: Preprocessing
    t0 = time.perf_counter()
    preprocessed = preprocess_image(image_input, config)
    timings["preprocess"] = round(time.perf_counter() - t0, 4)
    logger.info("Image engine: preprocessed %dx%d image", preprocessed.width_px, preprocessed.height_px)

    # Stage 2: Edge detection
    t0 = time.perf_counter()
    edge_map = detect_edges(preprocessed, config)
    timings["edge_detection"] = round(time.perf_counter() - t0, 4)

    # Stage 3: Line extraction
    t0 = time.perf_counter()
    lines, line_counts = extract_lines(edge_map, preprocessed, image_input, registration, config)
    timings["line_extraction"] = round(time.perf_counter() - t0, 4)
    logger.info("Image engine: extracted %d lines", len(lines))

    # Stage 4: Region segmentation → RoofPlane promotion
    t0 = time.perf_counter()
    regions, planes, rejection_counts = segment_regions(
        preprocessed, lines, edge_map, image_input, registration, config,
    )
    timings["segmentation"] = round(time.perf_counter() - t0, 4)
    logger.info("Image engine: %d regions, %d promoted to planes", len(regions), len(planes))

    # Stage 4b: Geometry diagnostics
    t0 = time.perf_counter()
    plane_diagnostics = compute_plane_diagnostics(regions)
    overlap_analysis = compute_overlap_matrix(regions)
    scale_validation = compute_scale_validation(
        image_input, registration, regions,
        preprocessed.width_px, preprocessed.height_px,
    )
    timings["geometry_diagnostics"] = round(time.perf_counter() - t0, 4)

    # Stage 4c: Roof coverage analysis
    coverage_stats = _compute_coverage(preprocessed, regions)

    # Stage 5: Obstruction candidates
    t0 = time.perf_counter()
    if config.enable_obstruction_detection:
        obstructions = detect_obstructions(
            preprocessed, regions, image_input, registration, config,
        )
    else:
        obstructions = []
        logger.info("Image engine: obstruction detection DISABLED by profile")
    timings["obstruction_detection"] = round(time.perf_counter() - t0, 4)

    # Stage 6: Dormer candidates
    t0 = time.perf_counter()
    if config.enable_dormer_detection:
        dormers = detect_dormers(
            preprocessed, regions, lines, image_input, registration, config,
        )
    else:
        dormers = []
        logger.info("Image engine: dormer detection DISABLED by profile")
    timings["dormer_detection"] = round(time.perf_counter() - t0, 4)

    # Stage 7: Debug artifacts
    t0 = time.perf_counter()
    debug_artifacts = generate_debug_artifacts(
        preprocessed, edge_map, lines, regions, obstructions, dormers,
    )
    timings["debug_visualization"] = round(time.perf_counter() - t0, 4)

    total_time = round(time.perf_counter() - t_total, 4)
    timings["total"] = total_time

    # Compute aggregate confidence
    if planes:
        overall_confidence = sum(p.confidence for p in planes) / len(planes)
    else:
        overall_confidence = 0.0

    # Build ridge line candidates from long horizontal lines
    ridge_candidates = _identify_ridge_candidates(lines)

    # Serialize intermediate results for metadata
    line_dicts = [
        {
            "id": ln.id,
            "start_local": list(ln.start_local),
            "end_local": list(ln.end_local),
            "length_m": round(ln.length_m, 3),
            "angle_deg": round(ln.angle_deg, 1),
            "confidence": round(ln.confidence, 3),
        }
        for ln in lines
    ]

    obstruction_dicts = [
        {
            "id": o.id,
            "center_local": list(o.center_local),
            "area_m2": round(o.area_m2, 2),
            "classification": o.classification,
            "confidence": round(o.confidence, 3),
            "parent_region_id": o.parent_region_id,
        }
        for o in obstructions
    ]

    dormer_dicts = [
        {
            "id": d.id,
            "centroid_px": list(d.centroid_px),
            "centroid_local": list(d.centroid_local),
            "width_m": round(d.width_m, 2),
            "depth_m": round(d.depth_m, 2),
            "area_m2": round(d.width_m * d.depth_m, 2),
            "dormer_type": d.dormer_type,
            "confidence": round(d.confidence, 3),
            "parent_region_id": d.parent_region_id,
        }
        for d in dormers
    ]

    debug_dicts = [
        {
            "name": a.name,
            "description": a.description,
            "image_base64": a.image_base64,
        }
        for a in debug_artifacts
    ]

    region_summaries = [
        {
            "id": r.id,
            "area_px": round(r.area_px, 1),
            "area_m2": round(r.area_m2, 2),
            "compactness": round(r.compactness, 3),
            "aspect_ratio": round(r.aspect_ratio, 2),
            "perimeter_px": round(r.perimeter_px, 1),
            "bounding_box": list(r.bounding_box),
            "vertex_count": len(r.boundary_px),
            "scale_used": round(r.scale_used, 6),
            "material_hint": r.material_hint,
            "promoted": r.promoted_to_plane,
        }
        for r in regions
    ]

    # Build diagnostic report
    diagnostics = {
        "segments_raw": len(regions),
        "segments_promoted": len(planes),
        "promotion_rate": f"{100 * len(planes) / max(len(regions), 1):.1f}%",
        **{k: v for k, v in rejection_counts.items()},
        "lines_before_merge": line_counts.get("combined", 0),
        "lines_after_merge": line_counts.get("after_merge", 0),
        "lines_after_filter": line_counts.get("after_filter", 0),
        "lines_lsd": line_counts.get("lsd", 0),
        "lines_hough": line_counts.get("hough", 0),
        "obstruction_candidates": len(obstructions),
        "dormer_candidates": len(dormers),
    }

    # Log the diagnostic report
    logger.info("--- Image Engine Diagnostic Report ---")
    logger.info("  Segments raw:           %d", diagnostics["segments_raw"])
    logger.info("  Segments promoted:      %d  (%s)", diagnostics["segments_promoted"], diagnostics["promotion_rate"])
    for k, v in rejection_counts.items():
        logger.info("  %-24s %d", k + ":", v)
    logger.info("  Lines LSD:              %d", diagnostics["lines_lsd"])
    logger.info("  Lines Hough:            %d", diagnostics["lines_hough"])
    logger.info("  Lines before merge:     %d", diagnostics["lines_before_merge"])
    logger.info("  Lines after merge:      %d", diagnostics["lines_after_merge"])
    logger.info("  Lines after filter:     %d", diagnostics["lines_after_filter"])
    logger.info("  Obstruction candidates: %d", diagnostics["obstruction_candidates"])
    logger.info("  Dormer candidates:      %d", diagnostics["dormer_candidates"])
    logger.info("  Total time:             %.3fs", total_time)
    logger.info("--------------------------------------")

    # Runtime debug stamp
    request_id = uuid.uuid4().hex[:12]
    generated_at = datetime.now(timezone.utc).isoformat()
    diag_hash = hashlib.sha256(json.dumps(diagnostics, sort_keys=True).encode()).hexdigest()[:16]

    debug_stamp = {
        "generated_at": generated_at,
        "request_id": request_id,
        "image_engine_version": IMAGE_ENGINE_VERSION,
        "diagnostics_summary_hash": diag_hash,
    }

    # Log geometry summary
    gs = plane_diagnostics.get("global", {})
    logger.info("--- Geometry Summary ---")
    logger.info("  Planes:      %d", gs.get("plane_count", 0))
    logger.info("  Total area:  %.1f m²", gs.get("total_area_m2", 0))
    logger.info("  Avg area:    %.1f m²", gs.get("avg_area_m2", 0))
    logger.info("  Max area:    %.1f m²", gs.get("max_area_m2", 0))
    logger.info("  Min area:    %.1f m²", gs.get("min_area_m2", 0))
    logger.info("  NMS suppressed: %d", rejection_counts.get("suppressed_nms", 0))
    overlap_pairs = overlap_analysis.get("pairs", [])
    if overlap_pairs:
        logger.info("  --- Pairwise Overlap ---")
        for pair in overlap_pairs:
            logger.info("    %s ↔ %s: IoU=%.3f, overlap_a=%.3f, overlap_b=%.3f, cdist=%.0fpx%s",
                pair["region_a"], pair["region_b"],
                pair["iou"], pair["overlap_frac_a"], pair["overlap_frac_b"],
                pair.get("centroid_dist_px", 0),
                " ★ DUPLICATE" if pair.get("likely_duplicate_plane") else "",
            )
    else:
        logger.info("  Overlap: NO pairwise overlap detected — planes are spatially distinct")
    logger.info("  Overlapping pairs: %d", overlap_analysis.get("overlapping_pair_count", 0))
    logger.info("  Scale: %s (%.6f m/px)", scale_validation.get("scale_source", "?"), scale_validation.get("scale_m_per_px", 0))
    logger.info("  Image footprint: %s m", scale_validation.get("image_footprint_m", []))
    if scale_validation.get("flagged_planes"):
        for fp in scale_validation["flagged_planes"]:
            logger.warning("  FLAGGED: %s — %.1f m² (%s)", fp["id"], fp["area_m2"], fp["reason"])
    for pp in plane_diagnostics.get("per_plane", []):
        if pp.get("flags"):
            logger.warning("  PLANE %s flags: %s (area=%.1f m², veto=%.2f, tree_sig=%d)",
                pp["plane_id"], pp["flags"], pp["area_m2"],
                pp.get("roof_veto_score", 0), pp.get("tree_signals", 0))
    logger.info("------------------------")

    logger.info("--- Roof Coverage ---")
    logger.info("  Promoted rgns: %d", coverage_stats.get("promoted_count", 0))
    logger.info("  Roof mask:     %d px", coverage_stats.get("roof_mask_area_px", 0))
    logger.info("  Promoted:      %d px", coverage_stats.get("promoted_area_px", 0))
    logger.info("  Intersection:  %d px", coverage_stats.get("covered_area_px", 0))
    logger.info("  Union:         %d px", coverage_stats.get("union_area_px", 0))
    logger.info("  Covered:       %d px (%.1f%%)", coverage_stats.get("covered_area_px", 0), coverage_stats.get("coverage_pct", 0))
    logger.info("  Uncovered:     %d px (%.1f%%)", coverage_stats.get("uncovered_area_px", 0), coverage_stats.get("uncovered_pct", 0))
    logger.info("  Assessment:    %s", coverage_stats.get("assessment", "unknown"))
    logger.info("---------------------")

    logger.info("=== IMAGE ENGINE DEBUG STAMP ===")
    logger.info("  version:    %s", IMAGE_ENGINE_VERSION)
    logger.info("  request_id: %s", request_id)
    logger.info("  generated:  %s", generated_at)
    logger.info("  diag_hash:  %s", diag_hash)
    logger.info("================================")

    # Profile metadata — record exactly what config was active
    profile_meta = {
        "active_profile": config.effective_profile_name(),
        "effective_settings": config.effective_settings(),
        "profile_summary": {
            "high_recall": "Broad roof coverage, more false positives allowed. "
                           "Erosion reduced, vegetation/texture/overlap gates weakened, "
                           "NMS relaxed, dormer+obstruction detection disabled.",
            "high_precision": "Tight region boundaries, fewer false positives. "
                              "Aggressive erosion, strict vegetation/texture/overlap gates, "
                              "NMS at 15% overlap, dormer+obstruction detection enabled.",
        },
    }

    logger.info("=== PROFILE: %s ===", config.effective_profile_name())

    return ImageEngineResult(
        planes=planes,
        edges=line_dicts,
        ridge_line_candidates=ridge_candidates,
        overall_confidence=round(overall_confidence, 3),
        source="image_engine",
        metadata={
            "timings": timings,
            "image_size": [preprocessed.width_px, preprocessed.height_px],
            "regions": region_summaries,
            "diagnostics": diagnostics,
            "plane_diagnostics": plane_diagnostics,
            "overlap_analysis": overlap_analysis,
            "scale_validation": scale_validation,
            "coverage": coverage_stats,
            "debug_stamp": debug_stamp,
            "profile": profile_meta,
        },
        debug_artifacts=debug_dicts,
        regions_total=len(regions),
        regions_promoted=len(planes),
        obstruction_candidates=obstruction_dicts,
        dormer_candidates=dormer_dicts,
    )


def _compute_coverage(
    preprocessed,
    regions: list,
) -> dict:
    """Compute roof coverage statistics."""
    import cv2 as _cv2
    h, w = preprocessed.height_px, preprocessed.width_px
    roof_mask = preprocessed.roof_mask

    # --- Coordinate alignment assertions ---
    assert roof_mask.shape == (h, w), (
        f"roof_mask shape {roof_mask.shape} != expected ({h}, {w})"
    )
    assert roof_mask.dtype == np.uint8, f"roof_mask dtype={roof_mask.dtype}, expected uint8"
    logger.debug(
        "roof_mask shape=%s dtype=%s unique_values=%s",
        roof_mask.shape, roof_mask.dtype, np.unique(roof_mask).tolist(),
    )

    # Build promoted planes mask
    promoted_count = 0
    promoted_mask = np.zeros((h, w), dtype=np.uint8)
    for region in regions:
        if not region.promoted_to_plane:
            continue
        promoted_count += 1
        if region.mask is not None:
            assert region.mask.shape == (h, w), (
                f"{region.id} mask shape {region.mask.shape} != expected ({h}, {w})"
            )
            assert region.mask.dtype == np.uint8, (
                f"{region.id} mask dtype={region.mask.dtype}, expected uint8"
            )
            region_nz = int(np.count_nonzero(region.mask))
            region_intersection = int(np.count_nonzero(
                _cv2.bitwise_and(roof_mask, region.mask)
            ))
            logger.debug(
                "  region %s: mask_px=%d, intersection_with_roof=%d, unique=%s",
                region.id, region_nz, region_intersection,
                np.unique(region.mask).tolist(),
            )
            promoted_mask = _cv2.bitwise_or(promoted_mask, region.mask)
        elif len(region.boundary_px) >= 3:
            pts = np.array(region.boundary_px, dtype=np.int32).reshape(-1, 1, 2)
            _cv2.fillPoly(promoted_mask, [pts], 255)
            logger.debug("  region %s: using boundary_px fallback (%d vertices)", region.id, len(region.boundary_px))

    roof_px = int(np.count_nonzero(roof_mask))
    promoted_px = int(np.count_nonzero(promoted_mask))
    intersection_mask = _cv2.bitwise_and(roof_mask, promoted_mask)
    union_mask = _cv2.bitwise_or(roof_mask, promoted_mask)
    covered_px = int(np.count_nonzero(intersection_mask))
    union_px = int(np.count_nonzero(union_mask))
    uncovered_px = int(np.count_nonzero(_cv2.bitwise_and(roof_mask, _cv2.bitwise_not(promoted_mask))))
    promoted_outside = promoted_px - covered_px

    logger.info(
        "Coverage pixels: roof_mask_nonzero=%d, promoted_mask_nonzero=%d, "
        "intersection_nonzero=%d, union_nonzero=%d, promoted_count=%d",
        roof_px, promoted_px, covered_px, union_px, promoted_count,
    )

    # --- Zero-overlap sentinel ---
    if covered_px == 0 and promoted_px > 0 and roof_px > 0:
        logger.warning("NO OVERLAP DETECTED — POSSIBLE COORDINATE BUG")
        # Bounding boxes of non-zero regions for spatial comparison
        roof_ys, roof_xs = np.nonzero(roof_mask)
        promo_ys, promo_xs = np.nonzero(promoted_mask)
        logger.warning(
            "  roof_mask  bbox: x=[%d..%d] y=[%d..%d] centroid=(%.0f, %.0f)",
            roof_xs.min(), roof_xs.max(), roof_ys.min(), roof_ys.max(),
            roof_xs.mean(), roof_ys.mean(),
        )
        logger.warning(
            "  promoted   bbox: x=[%d..%d] y=[%d..%d] centroid=(%.0f, %.0f)",
            promo_xs.min(), promo_xs.max(), promo_ys.min(), promo_ys.max(),
            promo_xs.mean(), promo_ys.mean(),
        )

    coverage_pct = (covered_px / roof_px * 100) if roof_px > 0 else 0
    uncovered_pct = (uncovered_px / roof_px * 100) if roof_px > 0 else 0

    if coverage_pct > 70:
        assessment = "good_coverage"
    elif coverage_pct > 40:
        assessment = "partial_coverage — likely under-segmenting"
    elif coverage_pct > 10:
        assessment = "low_coverage — significant under-segmenting"
    else:
        assessment = "minimal_coverage — planes may not align with roof mask"

    return {
        "roof_mask_area_px": roof_px,
        "promoted_area_px": promoted_px,
        "covered_area_px": covered_px,
        "uncovered_area_px": uncovered_px,
        "union_area_px": union_px,
        "promoted_outside_roof_px": promoted_outside,
        "promoted_count": promoted_count,
        "coverage_pct": round(coverage_pct, 1),
        "uncovered_pct": round(uncovered_pct, 1),
        "assessment": assessment,
    }


def _identify_ridge_candidates(lines: list) -> list[dict]:
    """
    Identify lines that could be ridge lines.

    Ridge candidates are long lines (>3m) that are roughly horizontal
    or follow common roof ridge orientations.
    """
    candidates = []
    for ln in lines:
        if ln.length_m < 3.0:
            continue
        # Ridge lines tend to be the longest, most prominent lines
        candidates.append({
            "start_local": list(ln.start_local),
            "end_local": list(ln.end_local),
            "length_m": round(ln.length_m, 3),
            "angle_deg": round(ln.angle_deg, 1),
            "confidence": round(ln.confidence * 0.7, 3),  # downweight — visual only
        })

    # Sort by length descending, take top candidates
    candidates.sort(key=lambda c: c["length_m"], reverse=True)
    return candidates[:10]
