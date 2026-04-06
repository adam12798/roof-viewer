"""
Pydantic v2 data models for the roof-geometry parsing pipeline.

Covers: input payloads, registration transforms, detected geometry,
roof graph, confidence reporting, and CRM-compatible output.
"""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class PlaneType(str, Enum):
    """Classification of a detected roof plane."""
    main = "main"
    garage = "garage"
    porch = "porch"
    walkway = "walkway"
    dormer = "dormer"


class EdgeType(str, Enum):
    """Type of edge where two roof planes meet."""
    ridge = "ridge"
    valley = "valley"
    hip = "hip"
    eave = "eave"
    rake = "rake"
    step_flash = "step_flash"


class IntersectionType(str, Enum):
    """Classification of a roof intersection point."""
    peak = "peak"
    t_junction = "t_junction"
    corner = "corner"


class DormerType(str, Enum):
    """Shape classification of a dormer."""
    gable = "gable"
    hip = "hip"
    shed = "shed"


class ObstructionType(str, Enum):
    """Type of rooftop obstruction."""
    vent = "vent"
    chimney = "chimney"
    skylight = "skylight"
    hvac = "hvac"
    pipe = "pipe"
    unknown = "unknown"


# ---------------------------------------------------------------------------
# Primitive geometry
# ---------------------------------------------------------------------------

class Point2D(BaseModel):
    """A point in the local coordinate system (metres). z = depth axis."""
    x: float = Field(..., description="X coordinate in local metres")
    z: float = Field(..., description="Z coordinate in local metres")


class Point3D(BaseModel):
    """A point with height.  y = elevation (up)."""
    x: float = Field(..., description="X coordinate in local metres")
    y: float = Field(..., description="Y (height) coordinate in local metres")
    z: float = Field(..., description="Z coordinate in local metres")


# ---------------------------------------------------------------------------
# Input models
# ---------------------------------------------------------------------------

class AnchorDot(BaseModel):
    """
    An alignment-only reference point placed by the user.
    NOT a roof boundary vertex.
    """
    id: str = Field(..., description="Unique identifier for the anchor dot")
    x: float = Field(..., description="X position in local metres")
    z: float = Field(..., description="Z position in local metres")
    lat: float | None = Field(None, description="Latitude in geographic coords")
    lng: float | None = Field(None, description="Longitude in geographic coords")
    label: str | None = Field(None, description="Optional human-readable label")


class LidarInput(BaseModel):
    """Reference to LiDAR point-cloud data."""
    points: list[list[float]] | None = Field(
        None,
        description="Inline point list: each entry is [x, y, z, classification]",
    )
    file_path: str | None = Field(None, description="Path to a LiDAR file on disk")
    bounds: list[float] = Field(
        ...,
        min_length=4,
        max_length=4,
        description="Bounding box [min_x, min_z, max_x, max_z] in local metres",
    )
    resolution: float = Field(..., description="Spatial resolution in metres per point")
    source: str = Field(..., description="Name of the source dataset (e.g. 'google_solar')")


class ImageInput(BaseModel):
    """Reference to a high-resolution satellite/aerial image."""
    url: str | None = Field(None, description="URL to fetch the image from")
    file_path: str | None = Field(None, description="Local file path to the image")
    width_px: int = Field(..., gt=0, description="Image width in pixels")
    height_px: int = Field(..., gt=0, description="Image height in pixels")
    geo_bounds: list[float] = Field(
        ...,
        min_length=4,
        max_length=4,
        description="Geographic bounding box [south, west, north, east] in decimal degrees",
    )
    resolution_m_per_px: float = Field(..., gt=0, description="Spatial resolution in metres per pixel")


class RoofParseOptions(BaseModel):
    """Tuning knobs for the parsing pipeline."""
    confidence_threshold: float = Field(0.7, ge=0, le=1, description="Minimum confidence to accept a detection")
    max_planes: int = Field(50, gt=0, description="Maximum number of roof planes to detect")
    merge_coplanar: bool = Field(True, description="Merge nearly-coplanar adjacent planes")
    detect_dormers: bool = Field(True, description="Run dormer detection sub-pipeline")
    detect_obstructions: bool = Field(True, description="Run obstruction detection sub-pipeline")
    pipeline_mode: str = Field("auto", description="Pipeline mode: 'auto', 'gradient', 'image_primary', 'lidar_primary', or 'image_engine'")
    image_engine_profile: str | None = Field(None, description="Image engine profile: 'high_recall' or 'high_precision' (default: high_precision)")


class DesignCenter(BaseModel):
    """Geographic centre of the project site."""
    lat: float = Field(..., description="Latitude in decimal degrees")
    lng: float = Field(..., description="Longitude in decimal degrees")


class CalibrationOffset(BaseModel):
    """User calibration offset to align LiDAR with satellite imagery."""
    tx: float = Field(0.0, description="X translation in metres")
    tz: float = Field(0.0, description="Z translation in metres")


class RoofParseRequest(BaseModel):
    """Top-level request payload sent to the parsing endpoint."""
    project_id: str = Field(..., description="CRM project identifier")
    design_center: DesignCenter = Field(..., description="Geographic centre of the project")
    anchor_dots: list[AnchorDot] = Field(default_factory=list, description="Alignment reference points (NOT roof boundaries)")
    calibration_offset: CalibrationOffset = Field(default_factory=CalibrationOffset, description="User calibration LiDAR-to-satellite offset")
    lidar: LidarInput = Field(..., description="LiDAR point-cloud input")
    image: ImageInput = Field(..., description="High-res image input")
    options: RoofParseOptions = Field(default_factory=RoofParseOptions, description="Pipeline options")


# ---------------------------------------------------------------------------
# Registration models
# ---------------------------------------------------------------------------

class RegistrationTransform(BaseModel):
    """Affine transform aligning image/LiDAR to the local coordinate frame."""
    affine_matrix: list[list[float]] = Field(
        ...,
        description="2×3 or 3×3 affine matrix mapping source → local coords",
    )
    tx: float = Field(..., description="Translation along X in metres")
    tz: float = Field(..., description="Translation along Z in metres")
    rotation_deg: float = Field(..., description="Rotation in degrees")
    scale: float = Field(..., description="Uniform scale factor")
    residual_error: float = Field(..., ge=0, description="RMS residual error of the registration in metres")
    method: str = Field(..., description="Algorithm used (e.g. 'icp', 'feature_match', 'anchor_affine')")


class RegisteredImage(BaseModel):
    """An image after registration into the local frame."""
    original: ImageInput = Field(..., description="Original image reference")
    transform: RegistrationTransform = Field(..., description="Applied registration transform")


class RegisteredLidar(BaseModel):
    """LiDAR data after registration into the local frame."""
    original: LidarInput = Field(..., description="Original LiDAR reference")
    transform: RegistrationTransform = Field(..., description="Applied registration transform")


# ---------------------------------------------------------------------------
# Geometry models
# ---------------------------------------------------------------------------

class PlaneEquation(BaseModel):
    """Plane defined by ax + by + cz + d = 0."""
    a: float = Field(..., description="X coefficient")
    b: float = Field(..., description="Y coefficient")
    c: float = Field(..., description="Z coefficient")
    d: float = Field(..., description="Constant term")


class RoofPlane(BaseModel):
    """A single detected roof plane."""
    id: str = Field(..., description="Unique plane identifier")
    vertices: list[Point2D] = Field(..., min_length=3, description="2D boundary vertices in local metres")
    vertices_3d: list[Point3D] = Field(..., min_length=3, description="3D boundary vertices with height")
    plane_equation: PlaneEquation = Field(..., description="Best-fit plane equation")
    pitch_deg: float = Field(..., ge=0, le=90, description="Roof pitch in degrees (0 = flat)")
    azimuth_deg: float = Field(..., ge=0, lt=360, description="Azimuth of the downslope direction (0 = north, clockwise)")
    height_m: float = Field(..., description="Height of the highest point above ground in metres")
    elevation_m: float = Field(..., description="Height of the lowest point above ground in metres")
    area_m2: float = Field(..., gt=0, description="Surface area in square metres")
    is_flat: bool = Field(False, description="True if pitch < ~2 degrees")
    plane_type: PlaneType = Field(PlaneType.main, description="Classification of this plane")
    structure_id: str = Field("", description="Groups faces that share a ridge into one roof structure")
    confidence: float = Field(..., ge=0, le=1, description="Detection confidence score")
    needs_review: bool = Field(False, description="Flagged for human review")
    source: str = Field("lidar", description="Data source that produced this plane: 'lidar', 'gradient', 'image_engine', 'fusion'")


class RoofEdge(BaseModel):
    """An edge shared between two roof planes."""
    id: str = Field(..., description="Unique edge identifier")
    edge_type: EdgeType = Field(..., description="Classification of this edge")
    start_point: Point3D = Field(..., description="Start vertex of the edge")
    end_point: Point3D = Field(..., description="End vertex of the edge")
    plane_ids: list[str] = Field(..., min_length=1, max_length=2, description="IDs of the 1-2 adjacent planes")
    length_m: float = Field(..., gt=0, description="Edge length in metres")
    confidence: float = Field(..., ge=0, le=1, description="Detection confidence")
    needs_review: bool = Field(False, description="Flagged for human review")


class RoofIntersection(BaseModel):
    """A point where multiple roof edges meet."""
    id: str = Field(..., description="Unique intersection identifier")
    point: Point3D = Field(..., description="Location of the intersection")
    edge_ids: list[str] = Field(..., min_length=2, description="IDs of edges meeting here")
    intersection_type: IntersectionType = Field(..., description="Classification of this intersection")


class Dormer(BaseModel):
    """A detected dormer protruding from a roof plane."""
    id: str = Field(..., description="Unique dormer identifier")
    dormer_type: DormerType = Field(..., description="Shape classification")
    position: Point2D = Field(..., description="Centre position on the parent plane")
    width_m: float = Field(..., gt=0, description="Width in metres")
    depth_m: float = Field(..., gt=0, description="Depth (projection from wall) in metres")
    height_m: float = Field(..., gt=0, description="Height in metres")
    pitch_deg: float = Field(..., ge=0, le=90, description="Dormer roof pitch in degrees")
    azimuth_deg: float = Field(..., ge=0, lt=360, description="Facing direction in degrees")
    parent_plane_id: str = Field(..., description="ID of the roof plane this dormer sits on")
    confidence: float = Field(..., ge=0, le=1, description="Detection confidence")
    needs_review: bool = Field(False, description="Flagged for human review")
    footprint: list[Point3D] = Field(
        default_factory=list,
        description=(
            "5 contact points where the dormer meets the parent roof plane, "
            "ordered: front-left, front-right, back-right, peak, back-left. "
            "front-* are at the eave (lowest elevation); peak is the ridge "
            "contact (highest elevation, centre-back)."
        ),
    )


class Obstruction(BaseModel):
    """A detected rooftop obstruction (vent, chimney, etc.)."""
    id: str = Field(..., description="Unique obstruction identifier")
    obstruction_type: ObstructionType = Field(..., description="Classification of this obstruction")
    position: Point2D = Field(..., description="Centre position in local metres")
    footprint: list[Point2D] = Field(default_factory=list, description="Boundary polygon of the obstruction")
    height_m: float = Field(0, ge=0, description="Height above the roof surface in metres")
    confidence: float = Field(..., ge=0, le=1, description="Detection confidence")
    needs_review: bool = Field(False, description="Flagged for human review")


# ---------------------------------------------------------------------------
# Graph model
# ---------------------------------------------------------------------------

class RoofGraph(BaseModel):
    """Complete detected roof topology."""
    planes: list[RoofPlane] = Field(default_factory=list, description="All detected roof planes")
    edges: list[RoofEdge] = Field(default_factory=list, description="All detected edges between planes")
    intersections: list[RoofIntersection] = Field(default_factory=list, description="All edge intersection points")
    dormers: list[Dormer] = Field(default_factory=list, description="All detected dormers")
    obstructions: list[Obstruction] = Field(default_factory=list, description="All detected obstructions")
    adjacency: dict[str, list[str]] = Field(
        default_factory=dict,
        description="Adjacency map: plane_id → list of neighbouring plane_ids",
    )
    connected_components: list[list[str]] = Field(
        default_factory=list,
        description="Groups of plane_ids forming disconnected roof structures",
    )

    def to_crm_faces(self) -> list[CRMRoofFace]:
        """Convert detected planes into the CRM-compatible face list.

        The CRM expects exactly 4-vertex rectangles. We fit an oriented
        minimum bounding rectangle to each plane's boundary polygon.
        """
        import math
        faces: list[CRMRoofFace] = []
        for plane in self.planes:
            # Build dormer list for this plane
            plane_dormers = [
                CRMDormer(
                    id=d.id,
                    type=d.dormer_type.value,
                    x=d.position.x,
                    z=d.position.z,
                    width=d.width_m,
                    depth=d.depth_m,
                    height=d.height_m,
                    pitch=d.pitch_deg,
                    azimuth=d.azimuth_deg,
                    footprint=[
                        {"x": round(p.x, 3), "y": round(p.y, 3), "z": round(p.z, 3)}
                        for p in d.footprint
                    ],
                )
                for d in self.dormers
                if d.parent_plane_id == plane.id
            ]

            # Fit oriented minimum bounding rectangle (4 vertices)
            rect_verts = _fit_oriented_rect([v for v in plane.vertices])

            face = CRMRoofFace(
                vertices=[{"x": round(v.x, 3), "z": round(v.z, 3)} for v in rect_verts],
                pitch=plane.pitch_deg,
                sectionPitches=[plane.pitch_deg] * 4,
                azimuth=plane.azimuth_deg,
                height=plane.elevation_m if plane.elevation_m else 0.0,
                color=_plane_type_color(plane.plane_type),
                deletedSections=[False, False, False, False],
                dormers=plane_dormers,
            )
            faces.append(face)
        return faces


def _fit_oriented_rect(vertices: list[Point2D]) -> list[Point2D]:
    """Fit an oriented minimum-area bounding rectangle to a set of 2D points.

    Returns exactly 4 Point2D vertices in winding order.
    """
    import math
    if len(vertices) <= 2:
        return vertices

    pts = [(v.x, v.z) for v in vertices]

    # Compute convex hull
    try:
        from shapely.geometry import MultiPoint
        mp = MultiPoint(pts)
        hull = mp.convex_hull
        if hull.geom_type != "Polygon":
            return vertices[:4] if len(vertices) >= 4 else vertices
        hull_coords = list(hull.exterior.coords[:-1])
    except ImportError:
        hull_coords = pts  # fallback: use raw points

    if len(hull_coords) < 3:
        return vertices[:4] if len(vertices) >= 4 else vertices

    # Rotating calipers — find minimum-area bounding rectangle
    import numpy as np
    hull_arr = np.array(hull_coords)
    n = len(hull_arr)

    best_area = float('inf')
    best_rect = None

    for i in range(n):
        # Edge vector
        edge = hull_arr[(i + 1) % n] - hull_arr[i]
        angle = math.atan2(edge[1], edge[0])

        # Rotation matrix to align this edge with X axis
        cos_a = math.cos(-angle)
        sin_a = math.sin(-angle)
        R = np.array([[cos_a, -sin_a], [sin_a, cos_a]])

        rotated = (R @ hull_arr.T).T
        min_x, max_x = rotated[:, 0].min(), rotated[:, 0].max()
        min_z, max_z = rotated[:, 1].min(), rotated[:, 1].max()

        area = (max_x - min_x) * (max_z - min_z)
        if area < best_area:
            best_area = area
            # Build rect corners in rotated space, then rotate back
            R_inv = np.array([[cos_a, sin_a], [-sin_a, cos_a]])
            corners_rot = np.array([
                [min_x, min_z],
                [max_x, min_z],
                [max_x, max_z],
                [min_x, max_z],
            ])
            best_rect = (R_inv @ corners_rot.T).T

    if best_rect is None:
        return vertices[:4] if len(vertices) >= 4 else vertices

    return [Point2D(x=float(c[0]), z=float(c[1])) for c in best_rect]


def _plane_type_color(pt: PlaneType) -> str:
    """Default colour per plane type (hex)."""
    return {
        PlaneType.main: "#4a90d9",
        PlaneType.garage: "#7bc47f",
        PlaneType.porch: "#d4a843",
        PlaneType.walkway: "#999999",
        PlaneType.dormer: "#c46b6b",
    }.get(pt, "#4a90d9")


# ---------------------------------------------------------------------------
# Confidence report
# ---------------------------------------------------------------------------

class Disagreement(BaseModel):
    """A discrepancy between LiDAR and image-derived values."""
    element_id: str = Field(..., description="ID of the element with conflicting data")
    lidar_value: Any = Field(..., description="Value derived from LiDAR")
    image_value: Any = Field(..., description="Value derived from imagery")
    chosen_value: Any = Field(..., description="Final value used")
    reason: str = Field(..., description="Why this value was chosen")


class ConfidenceReport(BaseModel):
    """Summary of detection confidence and items needing review."""
    overall_confidence: float = Field(..., ge=0, le=1, description="Aggregate confidence score")
    planes_needing_review: list[str] = Field(default_factory=list, description="Plane IDs flagged for review")
    edges_needing_review: list[str] = Field(default_factory=list, description="Edge IDs flagged for review")
    dormers_needing_review: list[str] = Field(default_factory=list, description="Dormer IDs flagged for review")
    obstructions_needing_review: list[str] = Field(default_factory=list, description="Obstruction IDs flagged for review")
    disagreements: list[Disagreement] = Field(default_factory=list, description="LiDAR vs image disagreements")


# ---------------------------------------------------------------------------
# CRM output models
# ---------------------------------------------------------------------------

class CRMDormer(BaseModel):
    """Dormer in CRM-compatible format."""
    id: str = Field(..., description="Dormer identifier")
    type: str = Field(..., description="Dormer type string")
    x: float = Field(..., description="X position in local metres")
    z: float = Field(..., description="Z position in local metres")
    width: float = Field(..., description="Width in metres")
    depth: float = Field(..., description="Depth in metres")
    height: float = Field(..., description="Height in metres")
    pitch: float = Field(..., description="Pitch in degrees")
    azimuth: float = Field(..., description="Azimuth in degrees")
    footprint: list[dict[str, float]] = Field(
        default_factory=list,
        description=(
            "5 contact points [{x, y, z}, ...] ordered: "
            "front-left, front-right, back-right, peak, back-left"
        ),
    )


class CRMRoofFace(BaseModel):
    """
    A roof face in the EXACT format the existing Node.js CRM expects.

    vertices are {x, z} dicts, sectionPitches is a 4-element list,
    deletedSections is a 4-element bool list.
    """
    vertices: list[dict[str, float]] = Field(
        ...,
        min_length=3,
        description="Boundary vertices as [{x, z}, ...] in local metres",
    )
    pitch: float = Field(..., description="Overall pitch in degrees")
    sectionPitches: list[float] = Field(
        ...,
        min_length=4,
        max_length=4,
        description="Pitch for each of the 4 roof sections",
    )
    azimuth: float = Field(..., ge=0, lt=360, description="Face azimuth 0-360 degrees")
    height: float = Field(..., description="Height in metres")
    color: str = Field("#4a90d9", description="Display colour (hex)")
    deletedSections: list[bool] = Field(
        ...,
        min_length=4,
        max_length=4,
        description="Which of the 4 sections are deleted",
    )
    dormers: list[CRMDormer] = Field(default_factory=list, description="Dormers on this face")


# ---------------------------------------------------------------------------
# Ridge line model
# ---------------------------------------------------------------------------

class RidgeLine(BaseModel):
    """Direct ridge line output from the gradient detector."""
    start: Point2D = Field(..., description="Ridge start point in local metres")
    end: Point2D = Field(..., description="Ridge end point in local metres")
    peak_height_m: float = Field(..., description="Elevation of the ridge above ground in metres")
    length_m: float = Field(..., description="Ridge length in metres")
    azimuth_deg: float = Field(..., description="Ridge azimuth in degrees")
    pitch_deg: float = Field(..., description="Roof pitch in degrees")


# ---------------------------------------------------------------------------
# Response model
# ---------------------------------------------------------------------------

class RoofParseMetadata(BaseModel):
    """Metadata about the parsing run."""
    processing_time_s: float = Field(..., description="Total processing time in seconds")
    pipeline_version: str = Field(..., description="Version of the parsing pipeline")
    lidar_points_used: int = Field(0, ge=0, description="Number of LiDAR points processed")
    image_resolution_used: float = Field(0, gt=0, description="Effective image resolution in m/px")
    pipeline_mode_used: str = Field("lidar_primary", description="Which pipeline mode was actually used")
    sam_masks_found: int = Field(0, ge=0, description="Number of roof masks SAM detected")


class RoofParseResponse(BaseModel):
    """Top-level response from the parsing endpoint."""
    registration: RegistrationTransform = Field(..., description="Registration transform applied")
    roof_graph: RoofGraph = Field(..., description="Full detected roof topology")
    crm_faces: list[CRMRoofFace] = Field(
        default_factory=list,
        description="CRM-ready face list for direct integration",
    )
    confidence_report: ConfidenceReport = Field(..., description="Detection confidence summary")
    metadata: RoofParseMetadata = Field(..., description="Processing metadata")
    ridge_line: RidgeLine | None = Field(None, description="Direct ridge line from gradient detector")
    sweep_ridge_line: RidgeLine | None = Field(None, description="Ridge line from sweep tracer (fitted to RIDGE_DOT points)")
    cell_labels_grid: list[list[int]] | None = Field(None, description="Grid of CellLabel int values (rows×cols) for visualization")
    grid_info: dict | None = Field(None, description="Grid metadata: x_origin, z_origin, resolution, rows, cols")
    image_engine_result: dict | None = Field(None, description="Full ImageEngineResult when image_engine mode is used")
