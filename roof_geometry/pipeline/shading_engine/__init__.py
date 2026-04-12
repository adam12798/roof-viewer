"""
Shading engine pipeline module.

Computes clear-sky annual plane-of-array irradiance (kWh/m²/yr) for a
collection of roof sections given their azimuth, pitch, and project
latitude/longitude.  v1 is clear-sky only (no trees, no LiDAR shadows)
and uses pure NumPy — no pvlib, no pandas.

Usage::

    from pipeline.shading_engine import run_shading_engine
    from pipeline.shading_engine.schemas import ShadingRequest, SectionInput

    request = ShadingRequest(
        lat=42.35, lng=-71.05,
        sections=[SectionInput(id="s1", azimuth_deg=180.0, pitch_deg=30.0)],
    )
    response = run_shading_engine(request)
"""

from pipeline.shading_engine.per_pixel import run_per_pixel_shading
from pipeline.shading_engine.processor import run_shading_engine
from pipeline.shading_engine.schemas import (
    ObservedRange,
    Obstruction3D,
    PerPixelShadingRequest,
    PerPixelShadingResponse,
    SectionGrid,
    SectionInput,
    SectionPlaneInput,
    SectionResult,
    ShadingRequest,
    ShadingResponse,
    Tree3D,
    Vec3,
)

__all__ = [
    "run_shading_engine",
    "run_per_pixel_shading",
    "ShadingRequest",
    "ShadingResponse",
    "SectionInput",
    "SectionResult",
    "ObservedRange",
    "PerPixelShadingRequest",
    "PerPixelShadingResponse",
    "SectionPlaneInput",
    "SectionGrid",
    "Obstruction3D",
    "Tree3D",
    "Vec3",
]
