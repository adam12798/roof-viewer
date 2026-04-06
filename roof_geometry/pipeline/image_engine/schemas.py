"""
Data models for the image engine pipeline.

These models are scoped to the image_engine subpackage and describe
intermediate and final results of pure image-based roof analysis.

Profiles
--------
The ``profile`` field on :class:`ImageEngineConfig` selects a named
tuning preset that overrides individual defaults.  Two built-in profiles
exist:

* **high_recall** — broad roof coverage, more false-positives allowed.
  Weakens/disables aggressive erosion, vegetation rejection, texture
  rejection, roof-mask overlap gates, NMS, dormer detection, and
  obstruction detection.  Use when the goal is to *see the roof again*.

* **high_precision** — tighter region boundaries, fewer false-positives.
  Uses the existing (strict) defaults which favour precision.

Setting ``profile=None`` (the default) is equivalent to
``profile="high_precision"`` — it preserves the original behaviour.
"""

from __future__ import annotations

import copy
import logging
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Profile presets
# ---------------------------------------------------------------------------

# high_precision is intentionally empty — it uses the class defaults as-is.
_PROFILE_HIGH_PRECISION: dict[str, Any] = {}

# high_recall: relax or disable every aggressive filter.
_PROFILE_HIGH_RECALL: dict[str, Any] = {
    # Edge detection — lower thresholds → more edges → more closed regions
    "canny_low": 50,
    "canny_high": 150,
    # Line extraction — accept shorter / weaker lines
    "hough_threshold": 50,
    "hough_min_line_length": 35,
    "hough_max_line_gap": 12,
    "min_line_length_m": 1.0,
    "min_line_confidence": 0.3,
    "min_line_length_px": 35,
    "merge_gap_tolerance_m": 1.0,
    # Segmentation — accept smaller and larger regions
    "min_region_area_m2": 3.0,
    "max_region_area_m2": 500.0,
    "max_aspect_ratio": 10.0,
    "min_compactness": 0.08,
    "central_margin_fraction": 0.02,
    # Roof-mask overlap — very permissive
    "min_roof_mask_overlap": 0.15,
    # Vegetation / texture — very permissive
    "max_green_fraction": 0.70,
    "max_texture_variance": 2500.0,
    # Erosion control
    "erosion_kernel_size": 3,
    "erosion_iterations": 1,
    "enable_edge_barrier": False,
    "roof_mask_clip_retention": 0.50,
    "dark_zone_clip_retention": 0.40,
    # NMS — very permissive
    "nms_overlap_threshold": 0.50,
    "nms_centroid_merge_px": 15.0,
    # Feature toggles
    "enable_dormer_detection": False,
    "enable_obstruction_detection": False,
    # Previously hardcoded filters — relaxed for recall
    "min_contour_area_px": 50,
    "lsd_min_length_px": 20,
    "hough_line_confidence": 0.5,
    "plane_confidence_cap": 0.7,
}

_PROFILES: dict[str, dict[str, Any]] = {
    "high_precision": _PROFILE_HIGH_PRECISION,
    "high_recall": _PROFILE_HIGH_RECALL,
}


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

class ImageEngineConfig(BaseModel):
    """Tuning parameters for the image engine pipeline.

    Set ``profile`` to ``"high_recall"`` or ``"high_precision"`` to apply
    a named preset.  Individual field overrides always take priority —
    they are applied *after* the profile.
    """

    # Profile selection (None → defaults = high_precision behaviour)
    profile: str | None = Field(None, description="Named tuning profile: 'high_recall' or 'high_precision'")

    # Preprocessing
    clahe_clip_limit: float = Field(3.0, description="CLAHE contrast clip limit")
    clahe_grid_size: int = Field(8, description="CLAHE grid tile size")
    blur_kernel_size: int = Field(5, description="Gaussian blur kernel size (odd)")
    # Edge detection
    canny_low: int = Field(80, description="Canny lower threshold")
    canny_high: int = Field(200, description="Canny upper threshold")
    # Line extraction
    hough_threshold: int = Field(80, description="HoughLinesP accumulator threshold")
    hough_min_line_length: int = Field(60, description="Minimum line length in pixels")
    hough_max_line_gap: int = Field(5, description="Maximum gap between line segments")
    min_line_length_m: float = Field(2.0, description="Minimum line length in metres to keep")
    merge_angle_tolerance_deg: float = Field(10.0, description="Angle tolerance for merging collinear lines")
    merge_gap_tolerance_m: float = Field(0.5, description="Max gap for merging collinear lines")
    # Line filtering
    min_line_confidence: float = Field(0.5, description="Minimum confidence to keep a line")
    min_line_length_px: int = Field(60, description="Minimum line length in pixels to keep")
    # Segmentation
    min_region_area_m2: float = Field(8.0, description="Minimum region area to promote to RoofPlane")
    max_region_area_m2: float = Field(300.0, description="Maximum region area — reject implausibly large planes")
    max_aspect_ratio: float = Field(6.0, description="Maximum aspect ratio for valid regions")
    min_compactness: float = Field(0.20, description="Minimum compactness (4*pi*area/perimeter^2)")
    central_margin_fraction: float = Field(0.05, description="Fraction of image edge to exclude region centroids from")
    min_roof_mask_overlap: float = Field(0.5, description="Minimum fraction of region that must overlap roof mask")
    # Tree / vegetation rejection
    vegetation_hue_low: int = Field(30, description="Lower HSV hue bound for green/vegetation")
    vegetation_hue_high: int = Field(90, description="Upper HSV hue bound for green/vegetation")
    vegetation_sat_min: int = Field(30, description="Minimum saturation to classify as vegetation")
    max_green_fraction: float = Field(0.35, description="Max fraction of green pixels before region is rejected as vegetation")
    max_texture_variance: float = Field(900.0, description="Max grayscale variance within region — high = tree/grass texture")
    # Region tightening
    edge_snap_radius_px: int = Field(7, description="Max pixel radius for snapping boundary vertices to edges")
    min_boundary_edge_length_px: int = Field(3, description="Minimum pixel length of a polygon edge before collapse")
    # Erosion control (parameterized for profile tuning)
    erosion_kernel_size: int = Field(7, description="Elliptical erosion kernel diameter (px)")
    erosion_iterations: int = Field(2, description="Number of erosion iterations")
    enable_edge_barrier: bool = Field(True, description="Enable edge-barrier splitting during erosion")
    roof_mask_clip_retention: float = Field(0.80, description="Min area retention when clipping to roof mask (0-1)")
    dark_zone_clip_retention: float = Field(0.70, description="Min area retention when clipping dark zones (0-1)")
    # NMS
    nms_overlap_threshold: float = Field(0.15, description="Overlap fraction threshold for NMS suppression")
    nms_centroid_merge_px: float = Field(40.0, description="Centroid distance threshold for NMS merge (px)")
    # Obstruction detection
    min_obstruction_area_m2: float = Field(0.2, description="Minimum obstruction candidate area")
    max_obstruction_area_m2: float = Field(12.0, description="Maximum obstruction candidate area")
    # Dormer detection
    min_dormer_area_m2: float = Field(1.0, description="Minimum dormer candidate area")
    max_dormer_area_m2: float = Field(20.0, description="Maximum dormer candidate area")
    # Feature toggles
    enable_dormer_detection: bool = Field(True, description="Run dormer detection on promoted regions")
    enable_obstruction_detection: bool = Field(True, description="Run obstruction detection on promoted regions")
    # Previously hardcoded filters (now parameterized)
    min_contour_area_px: int = Field(200, description="Minimum contour area in pixels to consider as a region")
    lsd_min_length_px: int = Field(40, description="Minimum LSD line segment length in pixels")
    hough_line_confidence: float = Field(0.4, description="Confidence assigned to Hough-only lines")
    plane_confidence_cap: float = Field(0.5, description="Maximum confidence for image-engine planes")

    def effective_profile_name(self) -> str:
        """Return the resolved profile name for metadata."""
        if self.profile and self.profile in _PROFILES:
            return self.profile
        return "high_precision"

    def effective_settings(self) -> dict[str, Any]:
        """Return a flat dict of every tunable setting at its current value.

        Useful for embedding in run metadata so that the exact thresholds
        used can be reconstructed without knowing the profile definition.
        """
        return {
            k: v
            for k, v in self.model_dump().items()
            if k != "profile"
        }


def make_config(
    profile: str | None = None,
    **overrides: Any,
) -> ImageEngineConfig:
    """Create an :class:`ImageEngineConfig` from a named profile + overrides.

    Resolution order:
      1. Class defaults (= ``high_precision`` behaviour)
      2. Profile preset values (if *profile* is given)
      3. Explicit *overrides* (always win)

    Usage::

        cfg = make_config("high_recall")
        cfg = make_config("high_recall", min_region_area_m2=5.0)
        cfg = make_config()  # plain defaults
    """
    base: dict[str, Any] = {}
    if profile and profile in _PROFILES:
        base.update(_PROFILES[profile])
    base["profile"] = profile
    base.update(overrides)
    config = ImageEngineConfig(**base)
    logger.info("ImageEngineConfig created — profile=%s, overrides=%s",
                config.effective_profile_name(), list(overrides.keys()) or "none")
    return config


# ---------------------------------------------------------------------------
# Intermediate data (dataclasses — may hold numpy arrays)
# ---------------------------------------------------------------------------

@dataclass
class PreprocessedImage:
    """Holds all preprocessed versions of the input image."""
    bgr: np.ndarray
    gray: np.ndarray
    enhanced: np.ndarray  # CLAHE-enhanced grayscale
    denoised: np.ndarray  # Gaussian-blurred grayscale
    hsv: np.ndarray
    roof_mask: np.ndarray  # binary mask: 255 = likely roof, 0 = vegetation/texture
    width_px: int
    height_px: int


@dataclass
class ExtractedLine:
    """A line segment detected in the image."""
    id: str = field(default_factory=lambda: f"line_{uuid.uuid4().hex[:8]}")
    start_px: tuple[int, int] = (0, 0)  # (x, y) pixel coords
    end_px: tuple[int, int] = (0, 0)
    start_local: tuple[float, float] = (0.0, 0.0)  # (x, z) local metres
    end_local: tuple[float, float] = (0.0, 0.0)
    length_px: float = 0.0
    length_m: float = 0.0
    angle_deg: float = 0.0
    confidence: float = 0.5


@dataclass
class SegmentedRegion:
    """A candidate roof region from image segmentation."""
    id: str = field(default_factory=lambda: f"region_{uuid.uuid4().hex[:8]}")
    boundary_px: list[tuple[int, int]] = field(default_factory=list)
    boundary_local: list[tuple[float, float]] = field(default_factory=list)
    mask: np.ndarray | None = None
    area_px: float = 0.0
    area_m2: float = 0.0
    centroid_px: tuple[int, int] = (0, 0)
    centroid_local: tuple[float, float] = (0.0, 0.0)
    compactness: float = 0.0
    aspect_ratio: float = 1.0
    perimeter_px: float = 0.0
    bounding_box: tuple[int, int, int, int] = (0, 0, 0, 0)  # (x, y, w, h)
    scale_used: float = 0.0
    material_hint: str = "unknown"
    confidence: float = 0.5
    promoted_to_plane: bool = False  # True if this region passed filtering


@dataclass
class ObstructionCandidate:
    """A candidate rooftop obstruction detected from image analysis."""
    id: str = field(default_factory=lambda: f"obst_{uuid.uuid4().hex[:8]}")
    center_px: tuple[int, int] = (0, 0)
    center_local: tuple[float, float] = (0.0, 0.0)
    boundary_px: list[tuple[int, int]] = field(default_factory=list)
    boundary_local: list[tuple[float, float]] = field(default_factory=list)
    area_m2: float = 0.0
    classification: str = "unknown"  # vent, chimney, skylight, pipe, unknown
    confidence: float = 0.3
    parent_region_id: str = ""


@dataclass
class DormerCandidate:
    """A candidate dormer detected from image analysis."""
    id: str = field(default_factory=lambda: f"dormer_{uuid.uuid4().hex[:8]}")
    boundary_px: list[tuple[int, int]] = field(default_factory=list)
    boundary_local: list[tuple[float, float]] = field(default_factory=list)
    centroid_px: tuple[int, int] = (0, 0)
    centroid_local: tuple[float, float] = (0.0, 0.0)
    width_m: float = 0.0
    depth_m: float = 0.0
    dormer_type: str = "unknown"  # gable, hip, shed, unknown
    confidence: float = 0.3
    parent_region_id: str = ""


@dataclass
class DebugArtifact:
    """A debug visualization artifact (base64-encoded PNG)."""
    name: str = ""
    description: str = ""
    image_base64: str = ""


# ---------------------------------------------------------------------------
# Final result model
# ---------------------------------------------------------------------------

class ImageEngineResult(BaseModel):
    """Complete result from the image engine pipeline."""
    planes: list[Any] = Field(default_factory=list, description="RoofPlane objects promoted from segmentation")
    edges: list[dict] = Field(default_factory=list, description="Extracted line segments")
    ridge_line_candidates: list[dict] = Field(default_factory=list, description="Candidate ridge lines from line analysis")
    overall_confidence: float = Field(0.0, description="Aggregate confidence of the image engine result")
    source: str = Field("image_engine", description="Always 'image_engine'")
    metadata: dict = Field(default_factory=dict, description="Additional metadata including all candidates")
    debug_artifacts: list[dict] = Field(default_factory=list, description="Debug overlay images")
    regions_total: int = Field(0, description="Total segmented regions before filtering")
    regions_promoted: int = Field(0, description="Regions promoted to RoofPlane")
    obstruction_candidates: list[dict] = Field(default_factory=list, description="Obstruction candidate details")
    dormer_candidates: list[dict] = Field(default_factory=list, description="Dormer candidate details")
