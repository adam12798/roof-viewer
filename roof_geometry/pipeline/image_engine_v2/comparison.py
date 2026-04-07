"""
A/B comparison between v1 and v2 image engines.

Runs both engines on the same input and produces a comparison report
with metrics diff, side-by-side debug images, and per-improvement
ablation results.
"""

from __future__ import annotations

import base64
import logging
import time
from io import BytesIO
from typing import Any

import cv2
import numpy as np

from models.schemas import ImageInput, RegistrationTransform
from pipeline.image_engine import run_image_engine
from pipeline.image_engine.schemas import ImageEngineConfig, ImageEngineResult
from pipeline.image_engine_v2.config import V2Config
from pipeline.image_engine_v2.processor import run_image_engine_v2

logger = logging.getLogger(__name__)


def run_comparison(
    image_input: ImageInput,
    registration: RegistrationTransform,
    v1_config: ImageEngineConfig | None = None,
    v2_config: V2Config | None = None,
) -> dict[str, Any]:
    """
    Run v1 and v2 side-by-side and return a comparison report.

    Returns:
        {
            "v1": { metrics... },
            "v2": { metrics... },
            "diff": { metric_name: (v1_val, v2_val, delta) },
            "comparison_image_base64": "...",  # side-by-side overlay
            "ablation": [ ... ],  # per-feature toggle results
        }
    """
    if v1_config is None:
        v1_config = ImageEngineConfig()
    if v2_config is None:
        v2_config = V2Config()

    logger.info("=== A/B COMPARISON START ===")

    # Run v1
    t0 = time.perf_counter()
    v1_result = run_image_engine(image_input, registration, v1_config)
    v1_time = round(time.perf_counter() - t0, 3)

    # Run v2
    t0 = time.perf_counter()
    v2_result = run_image_engine_v2(image_input, registration, v2_config)
    v2_time = round(time.perf_counter() - t0, 3)

    # Extract metrics
    v1_metrics = _extract_metrics(v1_result, v1_time, "v1")
    v2_metrics = _extract_metrics(v2_result, v2_time, "v2")

    # Compute diffs
    diff = {}
    all_keys = set(v1_metrics.keys()) | set(v2_metrics.keys())
    for key in sorted(all_keys):
        v1_val = v1_metrics.get(key, 0)
        v2_val = v2_metrics.get(key, 0)
        if isinstance(v1_val, (int, float)) and isinstance(v2_val, (int, float)):
            delta = round(v2_val - v1_val, 3)
            diff[key] = {"v1": v1_val, "v2": v2_val, "delta": delta}

    # Side-by-side comparison image
    comparison_img = _build_comparison_image(v1_result, v2_result)

    report = {
        "v1": v1_metrics,
        "v2": v2_metrics,
        "diff": diff,
        "comparison_image_base64": comparison_img,
        "v1_debug_artifacts": v1_result.debug_artifacts,
        "v2_debug_artifacts": v2_result.debug_artifacts,
    }

    # Print summary
    _print_summary(v1_metrics, v2_metrics, diff)

    logger.info("=== A/B COMPARISON COMPLETE ===")
    return report


def run_ablation(
    image_input: ImageInput,
    registration: RegistrationTransform,
) -> list[dict[str, Any]]:
    """
    Run v2 with each improvement toggled individually to measure
    the contribution of each feature.

    Returns a list of { "feature", "enabled", "metrics" } dicts.
    """
    baseline = V2Config(
        enable_watershed=False,
        enable_color_clustering=False,
        enable_region_merging=False,
        enable_shadow_detection=False,
        enable_adaptive_dark_threshold=False,
        nms_quality_weighted=False,
        # Use v1 erosion defaults
        erosion_kernel_size=7,
        erosion_iterations=2,
        plane_confidence_cap=0.5,
    )

    features = [
        ("watershed", {"enable_watershed": True}),
        ("color_clustering", {"enable_color_clustering": True}),
        ("region_merging", {"enable_region_merging": True}),
        ("shadow_detection", {"enable_shadow_detection": True}),
        ("adaptive_dark", {"enable_adaptive_dark_threshold": True}),
        ("lighter_erosion", {"erosion_kernel_size": 5, "erosion_iterations": 1}),
        ("better_confidence", {"plane_confidence_cap": 0.70}),
        ("quality_nms", {"nms_quality_weighted": True}),
    ]

    results = []

    # Baseline (all v2 features off = effectively v1 behavior)
    logger.info("Ablation: running baseline (all v2 features OFF)")
    t0 = time.perf_counter()
    baseline_result = run_image_engine_v2(image_input, registration, baseline)
    baseline_time = round(time.perf_counter() - t0, 3)
    baseline_metrics = _extract_metrics(baseline_result, baseline_time, "baseline")
    results.append({"feature": "baseline", "enabled": False, "metrics": baseline_metrics})

    # Each feature individually
    for feature_name, overrides in features:
        cfg_dict = baseline.model_dump()
        cfg_dict.update(overrides)
        cfg = V2Config(**cfg_dict)

        logger.info("Ablation: testing +%s", feature_name)
        t0 = time.perf_counter()
        result = run_image_engine_v2(image_input, registration, cfg)
        elapsed = round(time.perf_counter() - t0, 3)
        metrics = _extract_metrics(result, elapsed, feature_name)
        results.append({"feature": feature_name, "enabled": True, "metrics": metrics})

    # All features on
    logger.info("Ablation: running ALL features ON")
    full_cfg = V2Config()
    t0 = time.perf_counter()
    full_result = run_image_engine_v2(image_input, registration, full_cfg)
    full_time = round(time.perf_counter() - t0, 3)
    full_metrics = _extract_metrics(full_result, full_time, "all_features")
    results.append({"feature": "all_features", "enabled": True, "metrics": full_metrics})

    # Print ablation table
    _print_ablation_table(results)

    return results


def _extract_metrics(result: ImageEngineResult, elapsed: float, label: str) -> dict[str, Any]:
    """Extract comparable metrics from an ImageEngineResult."""
    meta = result.metadata or {}
    coverage = meta.get("coverage", {})
    diagnostics = meta.get("diagnostics", {})

    return {
        "label": label,
        "planes": result.regions_promoted,
        "regions_total": result.regions_total,
        "overall_confidence": result.overall_confidence,
        "coverage_pct": coverage.get("coverage_pct", 0),
        "uncovered_pct": coverage.get("uncovered_pct", 0),
        "assessment": coverage.get("assessment", "unknown"),
        "obstructions": len(result.obstruction_candidates),
        "dormers": len(result.dormer_candidates),
        "lines": len(result.edges),
        "rejected_vegetation": diagnostics.get("rejected_vegetation", 0),
        "rejected_texture": diagnostics.get("rejected_texture", 0),
        "rejected_too_small": diagnostics.get("rejected_too_small", 0),
        "rejected_too_large": diagnostics.get("rejected_too_large", 0),
        "suppressed_nms": diagnostics.get("suppressed_nms", 0),
        "time_s": elapsed,
    }


def _build_comparison_image(v1_result: ImageEngineResult, v2_result: ImageEngineResult) -> str:
    """Build a side-by-side comparison image from the 'regions' debug artifacts."""
    v1_img = _find_artifact_image(v1_result, "regions")
    v2_img = _find_artifact_image(v2_result, "regions")

    if v1_img is None or v2_img is None:
        return ""

    # Resize to same height
    h1, h2 = v1_img.shape[0], v2_img.shape[0]
    target_h = max(h1, h2)
    if h1 != target_h:
        scale = target_h / h1
        v1_img = cv2.resize(v1_img, None, fx=scale, fy=scale)
    if h2 != target_h:
        scale = target_h / h2
        v2_img = cv2.resize(v2_img, None, fx=scale, fy=scale)

    # Add labels
    cv2.putText(v1_img, "V1", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 255), 2)
    cv2.putText(v2_img, "V2", (10, 30), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 255, 0), 2)

    # Concatenate horizontally with a divider
    divider = np.full((target_h, 4, 3), 255, dtype=np.uint8)
    combined = np.hstack([v1_img, divider, v2_img])

    _, buffer = cv2.imencode(".png", combined)
    return base64.b64encode(buffer).decode("utf-8")


def _find_artifact_image(result: ImageEngineResult, name: str) -> np.ndarray | None:
    """Decode a debug artifact by name."""
    for artifact in result.debug_artifacts:
        if artifact.get("name") == name and artifact.get("image_base64"):
            data = base64.b64decode(artifact["image_base64"])
            arr = np.frombuffer(data, dtype=np.uint8)
            return cv2.imdecode(arr, cv2.IMREAD_COLOR)
    return None


def _print_summary(v1: dict, v2: dict, diff: dict) -> None:
    """Print a human-readable comparison summary."""
    print("\n" + "=" * 60)
    print("  IMAGE ENGINE A/B COMPARISON")
    print("=" * 60)
    print(f"  {'Metric':<25} {'V1':>8} {'V2':>8} {'Delta':>8}")
    print("-" * 60)

    key_metrics = [
        ("planes", "Planes"),
        ("regions_total", "Total regions"),
        ("overall_confidence", "Confidence"),
        ("coverage_pct", "Coverage %"),
        ("uncovered_pct", "Uncovered %"),
        ("rejected_vegetation", "Rej: vegetation"),
        ("rejected_too_small", "Rej: too small"),
        ("suppressed_nms", "Suppressed NMS"),
        ("obstructions", "Obstructions"),
        ("dormers", "Dormers"),
        ("time_s", "Time (s)"),
    ]

    for key, label in key_metrics:
        if key in diff:
            d = diff[key]
            delta_str = f"+{d['delta']}" if d['delta'] > 0 else str(d['delta'])
            print(f"  {label:<25} {d['v1']:>8.1f} {d['v2']:>8.1f} {delta_str:>8}")

    print("-" * 60)
    print(f"  V1 assessment: {v1.get('assessment', '?')}")
    print(f"  V2 assessment: {v2.get('assessment', '?')}")
    print("=" * 60 + "\n")


def _print_ablation_table(results: list[dict]) -> None:
    """Print ablation results as a table."""
    print("\n" + "=" * 70)
    print("  ABLATION: Per-Feature Contribution")
    print("=" * 70)
    print(f"  {'Feature':<22} {'Planes':>6} {'Cov%':>6} {'Conf':>6} {'Time':>6}")
    print("-" * 70)

    for r in results:
        m = r["metrics"]
        print(
            f"  {r['feature']:<22} {m['planes']:>6} {m['coverage_pct']:>6.1f} "
            f"{m['overall_confidence']:>6.3f} {m['time_s']:>6.2f}"
        )

    print("=" * 70 + "\n")
