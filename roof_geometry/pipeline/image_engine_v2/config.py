"""
V2 configuration — extends v1 ImageEngineConfig with new parameters.
"""

from __future__ import annotations

from typing import Any

from pydantic import Field

from pipeline.image_engine.schemas import ImageEngineConfig


class V2Config(ImageEngineConfig):
    """Extended config for v2 engine experiments.

    Inherits all v1 parameters.  New parameters control the additional
    segmentation strategies and relaxed defaults.
    """

    # --- Watershed ---
    enable_watershed: bool = Field(True, description="Enable watershed segmentation")
    watershed_dist_threshold: float = Field(
        0.4, description="Distance transform threshold (fraction of max) for watershed markers"
    )
    watershed_min_marker_area: int = Field(
        200, description="Minimum marker area in pixels to seed a watershed basin"
    )

    # --- Color clustering ---
    enable_color_clustering: bool = Field(True, description="Enable k-means color clustering")
    color_k: int = Field(5, description="Number of k-means clusters for color segmentation")
    color_merge_threshold: float = Field(
        25.0, description="Max LAB delta-E to merge adjacent color clusters"
    )

    # --- Region merging ---
    enable_region_merging: bool = Field(True, description="Merge adjacent similar-color regions")
    merge_border_fraction: float = Field(
        0.15, description="Min shared-border fraction (of smaller region perimeter) to consider merge"
    )
    merge_color_max_delta: float = Field(
        30.0, description="Max mean-HSV L2 distance to allow region merge"
    )

    # --- Relaxed erosion (override v1 defaults) ---
    erosion_kernel_size: int = Field(5, description="V2 default: lighter erosion kernel")
    erosion_iterations: int = Field(1, description="V2 default: single erosion pass")

    # --- Improved confidence ---
    confidence_compactness_weight: float = Field(0.30)
    confidence_area_weight: float = Field(0.20)
    confidence_overlap_weight: float = Field(0.25)
    confidence_edge_support_weight: float = Field(0.25)
    plane_confidence_cap: float = Field(0.70, description="V2 default: higher cap")

    # --- Adaptive roof mask ---
    enable_shadow_detection: bool = Field(True, description="Exclude deep shadows from roof mask")
    shadow_v_percentile: float = Field(8.0, description="V-channel percentile below which = shadow")
    enable_adaptive_dark_threshold: bool = Field(True, description="Use histogram-based dark threshold")

    # --- NMS ---
    nms_overlap_threshold: float = Field(0.20, description="V2 default: slightly more permissive NMS")
    nms_min_overlap_for_centroid: float = Field(
        0.05, description="Require this much overlap before centroid distance triggers suppression"
    )
    nms_quality_weighted: bool = Field(True, description="Use quality score, not just area, for NMS winner")


def make_v2_config(
    profile: str | None = None,
    **overrides: Any,
) -> V2Config:
    """Create a V2Config, optionally from a v1 profile + overrides."""
    base: dict[str, Any] = {}
    if profile:
        from pipeline.image_engine.schemas import _PROFILES
        if profile in _PROFILES:
            base.update(_PROFILES[profile])
    base["profile"] = profile
    base.update(overrides)
    return V2Config(**base)
