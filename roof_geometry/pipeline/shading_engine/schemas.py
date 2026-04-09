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
