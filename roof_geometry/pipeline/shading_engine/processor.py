"""
Top-level processor for the shading engine pipeline.

Wires together solar position, clear-sky irradiance, and Liu-Jordan
POA transposition to produce per-section annual kWh/m²/yr over a full
8760-hour year.  Runs in well under a second for any realistic design.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

import numpy as np

from pipeline.shading_engine.clear_sky import compute_clearsky
from pipeline.shading_engine.schemas import (
    ObservedRange,
    SectionResult,
    ShadingRequest,
    ShadingResponse,
)
from pipeline.shading_engine.solar_position import (
    compute_solar_position,
    day_of_year,
    make_hourly_utc_year,
)
from pipeline.shading_engine.surface_irradiance import liu_jordan_poa

logger = logging.getLogger(__name__)

SHADING_ENGINE_VERSION = "clearsky-haurwitz-liujordan-tmy075-v1"

# Representative non-leap year for the annual integration.  Choice is
# cosmetic — we integrate over every hour so the year only affects
# declination slightly.
_REFERENCE_YEAR = 2025

# TMY derate: scalar applied to clear-sky annual kWh/m² to approximate a
# realistic TMY (typical meteorological year) with cloud cover. Calibrated
# against an Aurora Solar reading at Lowell, MA: Aurora flat roof = 1510
# kWh/m²/yr vs our clear-sky flat = 2010 kWh/m²/yr → 1510/2010 ≈ 0.75.
_TMY_DERATE = 0.75


def run_shading_engine(request: ShadingRequest) -> ShadingResponse:
    """Compute clear-sky annual POA irradiance for each section."""
    if not request.sections:
        return ShadingResponse(
            computed_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            model=SHADING_ENGINE_VERSION,
            sections=[],
            observed_range=ObservedRange(min_kwh_per_m2=0.0, max_kwh_per_m2=0.0),
        )

    t_total = time.perf_counter()

    timestamps = make_hourly_utc_year(_REFERENCE_YEAR)
    t0 = time.perf_counter()
    elevation_deg, azimuth_deg = compute_solar_position(
        request.lat, request.lng, timestamps,
    )
    t_solpos = time.perf_counter() - t0

    t0 = time.perf_counter()
    doy = day_of_year(timestamps)
    ghi, dni, dhi = compute_clearsky(elevation_deg, doy)
    t_clearsky = time.perf_counter() - t0

    t0 = time.perf_counter()
    results: list[SectionResult] = []
    for section in request.sections:
        poa = liu_jordan_poa(
            elevation_deg=elevation_deg,
            solar_azimuth_deg=azimuth_deg,
            ghi=ghi, dni=dni, dhi=dhi,
            pitch_deg=section.pitch_deg,
            surface_azimuth_deg=section.azimuth_deg,
            albedo=request.albedo,
        )
        annual_wh_per_m2 = float(np.sum(poa))
        annual_kwh_per_m2 = (annual_wh_per_m2 / 1000.0) * _TMY_DERATE
        annual_kwh = annual_kwh_per_m2 * float(section.area_m2)

        results.append(
            SectionResult(
                id=section.id,
                annual_kwh_per_m2=round(annual_kwh_per_m2, 2),
                annual_kwh=round(annual_kwh, 2),
            )
        )
    t_poa = time.perf_counter() - t0

    per_m2_values = [r.annual_kwh_per_m2 for r in results]
    observed = ObservedRange(
        min_kwh_per_m2=round(float(min(per_m2_values)), 2),
        max_kwh_per_m2=round(float(max(per_m2_values)), 2),
    )

    t_total = time.perf_counter() - t_total
    logger.info(
        "Shading engine: %d sections in %.3fs (solpos=%.3fs clearsky=%.3fs poa=%.3fs)",
        len(results), t_total, t_solpos, t_clearsky, t_poa,
    )

    return ShadingResponse(
        computed_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        model=SHADING_ENGINE_VERSION,
        sections=results,
        observed_range=observed,
    )
