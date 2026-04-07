"""
V2 processor — wires together enhanced preprocessing, multi-source
segmentation, and reused v1 obstruction/dormer/debug stages.
"""

from __future__ import annotations

import hashlib
import json
import logging
import time
import uuid
from datetime import datetime, timezone

from models.schemas import ImageInput, RegistrationTransform
from pipeline.image_engine.debug_visualization import generate_debug_artifacts
from pipeline.image_engine.dormer_detector import detect_dormers
from pipeline.image_engine.edge_detector import detect_edges, extract_lines
from pipeline.image_engine.obstruction_detector import detect_obstructions
from pipeline.image_engine.schemas import ImageEngineResult
from pipeline.image_engine.segmenter import (
    compute_plane_diagnostics,
    compute_overlap_matrix,
    compute_scale_validation,
)
from pipeline.image_engine_v2.config import V2Config, make_v2_config
from pipeline.image_engine_v2.enhanced_preprocess import preprocess_image_v2
from pipeline.image_engine_v2.enhanced_segmenter import segment_regions_v2

logger = logging.getLogger(__name__)

IMAGE_ENGINE_V2_VERSION = "2.0.0-experimental"


def run_image_engine_v2(
    image_input: ImageInput,
    registration: RegistrationTransform,
    config: V2Config | None = None,
) -> ImageEngineResult:
    """
    Run the v2 image engine pipeline.

    Same interface as v1 run_image_engine — returns an ImageEngineResult.
    Stages:
      1. Enhanced preprocessing (v1 + shadow/adaptive dark)
      2. Edge detection (v1, unchanged)
      3. Line extraction (v1, unchanged)
      4. Multi-source segmentation (v2: edge + watershed + color)
      5. Obstruction detection (v1, unchanged)
      6. Dormer detection (v1, unchanged)
      7. Debug visualization (v1, unchanged)
    """
    if config is None:
        config = V2Config()

    timings: dict[str, float] = {}
    t_total = time.perf_counter()

    # Stage 1: Enhanced preprocessing
    t0 = time.perf_counter()
    preprocessed = preprocess_image_v2(image_input, config)
    timings["preprocess_v2"] = round(time.perf_counter() - t0, 4)
    logger.info("V2 engine: preprocessed %dx%d image", preprocessed.width_px, preprocessed.height_px)

    # Stage 2: Edge detection (reuse v1)
    t0 = time.perf_counter()
    edge_map = detect_edges(preprocessed, config)
    timings["edge_detection"] = round(time.perf_counter() - t0, 4)

    # Stage 3: Line extraction (reuse v1)
    t0 = time.perf_counter()
    lines, line_counts = extract_lines(edge_map, preprocessed, image_input, registration, config)
    timings["line_extraction"] = round(time.perf_counter() - t0, 4)
    logger.info("V2 engine: extracted %d lines", len(lines))

    # Stage 4: Multi-source segmentation (V2)
    t0 = time.perf_counter()
    regions, planes, rejection_counts = segment_regions_v2(
        preprocessed, lines, edge_map, image_input, registration, config,
    )
    timings["segmentation_v2"] = round(time.perf_counter() - t0, 4)
    logger.info("V2 engine: %d regions, %d promoted to planes", len(regions), len(planes))

    # Stage 4b: Geometry diagnostics (reuse v1)
    t0 = time.perf_counter()
    plane_diagnostics = compute_plane_diagnostics(regions)
    overlap_analysis = compute_overlap_matrix(regions)
    scale_validation = compute_scale_validation(
        image_input, registration, regions,
        preprocessed.width_px, preprocessed.height_px,
    )
    timings["geometry_diagnostics"] = round(time.perf_counter() - t0, 4)

    # Stage 4c: Coverage (inline — same as v1 processor)
    coverage_stats = _compute_coverage(preprocessed, regions)

    # Stage 5: Obstruction candidates (reuse v1)
    t0 = time.perf_counter()
    if config.enable_obstruction_detection:
        obstructions = detect_obstructions(preprocessed, regions, image_input, registration, config)
    else:
        obstructions = []
    timings["obstruction_detection"] = round(time.perf_counter() - t0, 4)

    # Stage 6: Dormer candidates (reuse v1)
    t0 = time.perf_counter()
    if config.enable_dormer_detection:
        dormers = detect_dormers(preprocessed, regions, lines, image_input, registration, config)
    else:
        dormers = []
    timings["dormer_detection"] = round(time.perf_counter() - t0, 4)

    # Stage 7: Debug artifacts (reuse v1)
    t0 = time.perf_counter()
    debug_artifacts = generate_debug_artifacts(
        preprocessed, edge_map, lines, regions, obstructions, dormers,
    )
    timings["debug_visualization"] = round(time.perf_counter() - t0, 4)

    total_time = round(time.perf_counter() - t_total, 4)
    timings["total"] = total_time

    # Aggregate confidence
    overall_confidence = sum(p.confidence for p in planes) / len(planes) if planes else 0.0

    # Ridge candidates (reuse v1 logic)
    ridge_candidates = _identify_ridge_candidates(lines)

    # Serialize
    line_dicts = [
        {"id": ln.id, "start_local": list(ln.start_local), "end_local": list(ln.end_local),
         "length_m": round(ln.length_m, 3), "angle_deg": round(ln.angle_deg, 1),
         "confidence": round(ln.confidence, 3)}
        for ln in lines
    ]
    obstruction_dicts = [
        {"id": o.id, "center_local": list(o.center_local), "area_m2": round(o.area_m2, 2),
         "classification": o.classification, "confidence": round(o.confidence, 3),
         "parent_region_id": o.parent_region_id}
        for o in obstructions
    ]
    dormer_dicts = [
        {"id": d.id, "centroid_px": list(d.centroid_px), "centroid_local": list(d.centroid_local),
         "width_m": round(d.width_m, 2), "depth_m": round(d.depth_m, 2),
         "area_m2": round(d.width_m * d.depth_m, 2), "dormer_type": d.dormer_type,
         "confidence": round(d.confidence, 3), "parent_region_id": d.parent_region_id}
        for d in dormers
    ]
    debug_dicts = [{"name": a.name, "description": a.description, "image_base64": a.image_base64} for a in debug_artifacts]
    region_summaries = [
        {"id": r.id, "area_px": round(r.area_px, 1), "area_m2": round(r.area_m2, 2),
         "compactness": round(r.compactness, 3), "aspect_ratio": round(r.aspect_ratio, 2),
         "vertex_count": len(r.boundary_px), "scale_used": round(r.scale_used, 6),
         "material_hint": r.material_hint, "promoted": r.promoted_to_plane,
         "source": getattr(r, "_source", "unknown")}
        for r in regions
    ]

    diagnostics = {
        "segments_raw": len(regions),
        "segments_promoted": len(planes),
        "promotion_rate": f"{100 * len(planes) / max(len(regions), 1):.1f}%",
        **rejection_counts,
        "lines_lsd": line_counts.get("lsd", 0),
        "lines_hough": line_counts.get("hough", 0),
        "lines_after_filter": line_counts.get("after_filter", 0),
        "obstruction_candidates": len(obstructions),
        "dormer_candidates": len(dormers),
    }

    request_id = uuid.uuid4().hex[:12]
    debug_stamp = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "request_id": request_id,
        "image_engine_version": IMAGE_ENGINE_V2_VERSION,
        "diagnostics_summary_hash": hashlib.sha256(
            json.dumps(diagnostics, sort_keys=True).encode()
        ).hexdigest()[:16],
    }

    logger.info("=== V2 ENGINE COMPLETE ===")
    logger.info("  Planes: %d  Coverage: %.1f%%  Time: %.3fs",
                len(planes), coverage_stats.get("coverage_pct", 0), total_time)
    logger.info("==========================")

    return ImageEngineResult(
        planes=planes,
        edges=line_dicts,
        ridge_line_candidates=ridge_candidates,
        overall_confidence=round(overall_confidence, 3),
        source="image_engine_v2",
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
            "v2_config": config.effective_settings(),
        },
        debug_artifacts=debug_dicts,
        regions_total=len(regions),
        regions_promoted=len(planes),
        obstruction_candidates=obstruction_dicts,
        dormer_candidates=dormer_dicts,
    )


def _compute_coverage(preprocessed, regions):
    """Inline coverage computation (same logic as v1 processor)."""
    import cv2 as _cv2
    import numpy as _np
    h, w = preprocessed.height_px, preprocessed.width_px
    roof_mask = preprocessed.roof_mask

    promoted_mask = _np.zeros((h, w), dtype=_np.uint8)
    promoted_count = 0
    for region in regions:
        if not region.promoted_to_plane:
            continue
        promoted_count += 1
        if region.mask is not None:
            promoted_mask = _cv2.bitwise_or(promoted_mask, region.mask)
        elif len(region.boundary_px) >= 3:
            pts = _np.array(region.boundary_px, dtype=_np.int32).reshape(-1, 1, 2)
            _cv2.fillPoly(promoted_mask, [pts], 255)

    roof_px = int(_np.count_nonzero(roof_mask))
    promoted_px = int(_np.count_nonzero(promoted_mask))
    covered_px = int(_np.count_nonzero(_cv2.bitwise_and(roof_mask, promoted_mask)))
    uncovered_px = int(_np.count_nonzero(_cv2.bitwise_and(roof_mask, _cv2.bitwise_not(promoted_mask))))
    union_px = int(_np.count_nonzero(_cv2.bitwise_or(roof_mask, promoted_mask)))

    coverage_pct = (covered_px / roof_px * 100) if roof_px > 0 else 0
    uncovered_pct = (uncovered_px / roof_px * 100) if roof_px > 0 else 0

    if coverage_pct > 70:
        assessment = "good_coverage"
    elif coverage_pct > 40:
        assessment = "partial_coverage"
    elif coverage_pct > 10:
        assessment = "low_coverage"
    else:
        assessment = "minimal_coverage"

    return {
        "roof_mask_area_px": roof_px,
        "promoted_area_px": promoted_px,
        "covered_area_px": covered_px,
        "uncovered_area_px": uncovered_px,
        "union_area_px": union_px,
        "promoted_outside_roof_px": promoted_px - covered_px,
        "promoted_count": promoted_count,
        "coverage_pct": round(coverage_pct, 1),
        "uncovered_pct": round(uncovered_pct, 1),
        "assessment": assessment,
    }


def _identify_ridge_candidates(lines) -> list[dict]:
    candidates = []
    for ln in lines:
        if ln.length_m < 3.0:
            continue
        candidates.append({
            "start_local": list(ln.start_local), "end_local": list(ln.end_local),
            "length_m": round(ln.length_m, 3), "angle_deg": round(ln.angle_deg, 1),
            "confidence": round(ln.confidence * 0.7, 3),
        })
    candidates.sort(key=lambda c: c["length_m"], reverse=True)
    return candidates[:10]
