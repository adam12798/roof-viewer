"""
Pydantic v2 schemas for the shading engine request/response contract.

These are the public API surface of ``POST /roof/shading``.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class SectionInput(BaseModel):
    """A single roof section to evaluate.

    ``azimuth_deg`` is compass-frame (0=N, 90=E, 180=S, 270=W).
    ``pitch_deg`` is tilt from horizontal (0=flat, 90=vertical wall).
    ``area_m2`` is only used to aggregate ``annual_kwh`` per section;
    it defaults to 1.0 so the caller can ignore it and read
    ``annual_kwh_per_m2`` directly.
    """

    id: str
    azimuth_deg: float = Field(..., ge=0.0, le=360.0)
    pitch_deg: float = Field(..., ge=0.0, le=90.0)
    area_m2: float = Field(default=1.0, ge=0.0)


class ShadingRequest(BaseModel):
    """Full shading request for a single project.

    ``timezone_offset_hours`` is optional — if omitted the engine uses
    ``round(lng/15)`` as a stand-in.  Since we integrate over every hour
    of the year, the exact offset mostly shifts the local solar-noon
    alignment and does not materially affect the annual total.
    """

    lat: float = Field(..., ge=-90.0, le=90.0)
    lng: float = Field(..., ge=-180.0, le=180.0)
    timezone_offset_hours: float | None = None
    albedo: float = Field(default=0.2, ge=0.0, le=1.0)
    sections: list[SectionInput]


class SectionResult(BaseModel):
    """Per-section annual irradiance result."""

    id: str
    annual_kwh_per_m2: float
    annual_kwh: float


class ObservedRange(BaseModel):
    """Min/max of ``annual_kwh_per_m2`` across all sections in a request."""

    min_kwh_per_m2: float
    max_kwh_per_m2: float


class ShadingResponse(BaseModel):
    """Full shading response for a single project."""

    computed_at: str  # ISO-8601 UTC
    model: str  # identifier for the math stack used
    sections: list[SectionResult]
    observed_range: ObservedRange


# ─────────────────────────────────────────────────────────────────────
# Per-pixel (Aurora-style) shading schemas.
#
# These are additive and do not change any of the types above.  The
# per-pixel path exists side-by-side with the per-section path so the
# existing overlay keeps working while we roll out the bake.
# ─────────────────────────────────────────────────────────────────────


class Vec3(BaseModel):
    """3D point in local metres (X=East, Z=South, Y=Up)."""

    x: float
    y: float
    z: float


class SectionPlaneInput(BaseModel):
    """A roof section with full 3D geometry for per-pixel baking.

    ``vertices`` are the deduplicated corners of the section polygon in
    local metres — typically 3 or 4 points.  The backend projects them
    onto the section's own (u, v) plane frame and rasterizes the
    polygon onto a regular grid at ``resolution_m`` metres/pixel.

    ``owner_id`` is an optional tag that associates this section with a
    3D object (e.g. a dormer) which also appears as an ``Obstruction3D``.
    When set, the bake excludes obstructions with the same ``owner_id``
    from the occluder scene for this section so the object does not
    self-shadow its own roof panels.
    """

    id: str
    azimuth_deg: float = Field(..., ge=0.0, le=360.0)
    pitch_deg: float = Field(..., ge=0.0, le=90.0)
    vertices: list[Vec3]
    resolution_m: float = Field(default=0.25, gt=0.0, le=2.0)
    owner_id: str | None = None


class Obstruction3D(BaseModel):
    """Extruded-prism obstruction (chimney, vent, HVAC, skylight).

    The prism is a vertical extrusion of ``footprint`` (a closed
    polygon on the roof surface) from ``base_y`` up to ``top_y``.

    ``owner_id`` is an optional tag that ties this obstruction to a
    3D object which also appears as one or more ``SectionPlaneInput``
    entries (e.g. a dormer with roof panels baked as sections).  The
    bake skips obstructions whose ``owner_id`` matches the section's
    ``owner_id`` to prevent the object self-shadowing its own surface.
    """

    id: str
    footprint: list[Vec3]
    base_y: float
    top_y: float
    owner_id: str | None = None


class Tree3D(BaseModel):
    """Ellipsoid approximation of a single tree canopy.

    Axis-aligned ellipsoid centred at ``(center_x, (base_y+peak_y)/2,
    center_z)`` with radii ``(radius_m, (peak_y-base_y)/2, radius_m)``.
    """

    id: str
    center_x: float
    center_z: float
    base_y: float
    peak_y: float
    radius_m: float = Field(..., gt=0.0)


class PerPixelShadingRequest(BaseModel):
    """Per-pixel annual POA irradiance request.

    ``shadow_mode`` controls which occluders are active:
    ``"none"`` — no shadows (Phase 1 clear-sky bake),
    ``"obstructions"`` — obstruction prisms only (Phase 2),
    ``"trees"`` — tree ellipsoids only,
    ``"both"`` — obstructions + trees (Phase 3).

    ``solar_samples`` is the number of stratified annual solar
    positions used in the bake.  The default (120) is calibrated
    against the full 8760-hour baseline to match within a few percent
    on a flat plane.
    """

    lat: float = Field(..., ge=-90.0, le=90.0)
    lng: float = Field(..., ge=-180.0, le=180.0)
    timezone_offset_hours: float | None = None
    albedo: float = Field(default=0.2, ge=0.0, le=1.0)
    sections: list[SectionPlaneInput]
    obstructions: list[Obstruction3D] = Field(default_factory=list)
    trees: list[Tree3D] = Field(default_factory=list)
    solar_samples: int = Field(default=120, ge=24, le=8760)
    shadow_mode: str = Field(default="both")


class SectionGrid(BaseModel):
    """Per-pixel irradiance grid for a single roof section.

    The grid is a (height × width) float32 array stored as a base64
    string (little-endian, length = width*height*4 bytes).  Pixels
    outside the section polygon are encoded as ``NaN``.

    The pixel at (row=i, col=j) corresponds to the world-space point
    ``origin + (j + 0.5) * u_axis + (i + 0.5) * v_axis`` where
    ``u_axis`` and ``v_axis`` have length equal to ``resolution_m``.
    """

    id: str
    width: int
    height: int
    origin: Vec3
    u_axis: Vec3
    v_axis: Vec3
    min_kwh_per_m2: float
    max_kwh_per_m2: float
    mean_kwh_per_m2: float
    kwh_grid_b64: str


class PerPixelShadingResponse(BaseModel):
    """Per-pixel shading response, one grid per section."""

    computed_at: str
    model: str
    sections: list[SectionGrid]
    observed_range: ObservedRange
