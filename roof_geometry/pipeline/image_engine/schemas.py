"""
Data models for the image engine pipeline.

These models are scoped to the image_engine subpackage and describe
intermediate and final results of pure image-based roof analysis.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

class ImageEngineConfig(BaseModel):
    """Tuning parameters for the image engine pipeline."""
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
    # Obstruction detection
    min_obstruction_area_m2: float = Field(0.2, description="Minimum obstruction candidate area")
    max_obstruction_area_m2: float = Field(12.0, description="Maximum obstruction candidate area")
    # Dormer detection
    min_dormer_area_m2: float = Field(1.0, description="Minimum dormer candidate area")
    max_dormer_area_m2: float = Field(20.0, description="Maximum dormer candidate area")


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
