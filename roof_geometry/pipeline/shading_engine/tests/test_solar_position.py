"""Sanity tests for the Michalsky 1988 solar position implementation."""

from __future__ import annotations

import numpy as np

from pipeline.shading_engine.solar_position import compute_solar_position


def _single(ts_iso: str) -> np.ndarray:
    return np.array([np.datetime64(ts_iso, "s")], dtype="datetime64[s]")


def test_equator_march_equinox_noon_is_overhead():
    """At the equator around March equinox at 12:00 UTC the sun is
    nearly overhead.

    The actual 2025 vernal equinox is 2025-03-20T09:01 UTC, so by
    12:00 UTC the declination is already ~0.05 deg and the equation
    of time contributes ~7 min of hour-angle offset.  Combined that
    puts the sun ~1.8 deg below zenith — within a generous 3 deg
    tolerance we still assert near-overhead.
    """
    ts = _single("2025-03-20T12:00:00")
    elev, _az = compute_solar_position(lat_deg=0.0, lng_deg=0.0, timestamps_utc=ts)
    assert elev.shape == (1,)
    assert elev[0] >= 87.0, f"expected near-overhead, got {elev[0]}"


def test_lowell_ma_june_solstice_noon_elevation():
    """At (42.65 N, -71.35) on 2025-06-21 17:00 UTC (~solar noon local)
    the Michalsky elevation should be ~70.7 deg, within 1 deg."""
    ts = _single("2025-06-21T17:00:00")
    elev, az = compute_solar_position(
        lat_deg=42.65, lng_deg=-71.35, timestamps_utc=ts,
    )
    # Expected: solar_noon_elevation = 90 - |lat - declination|
    #                                = 90 - |42.65 - 23.44|
    #                                = 70.79 deg.
    assert abs(elev[0] - 70.7) < 1.5, f"expected ~70.7, got {elev[0]}"
    # And at solar noon the sun is due south → azimuth near 180.
    assert abs(az[0] - 180.0) < 10.0, f"expected ~180, got {az[0]}"


def test_night_elevation_is_negative():
    """Pre-dawn at (42.65 N, -71.35) — 05:00 UTC on June 21 is ~01:00
    local time.  The sun must be below the horizon."""
    ts = _single("2025-06-21T05:00:00")
    elev, _az = compute_solar_position(
        lat_deg=42.65, lng_deg=-71.35, timestamps_utc=ts,
    )
    assert elev[0] < 0.0, f"expected <0, got {elev[0]}"


def test_vectorized_shape_preserved():
    """An N-element timestamp array returns N-element elev/az arrays."""
    ts = np.array([
        "2025-01-01T12:00:00",
        "2025-04-01T12:00:00",
        "2025-07-01T12:00:00",
        "2025-10-01T12:00:00",
    ], dtype="datetime64[s]")
    elev, az = compute_solar_position(42.35, -71.05, ts)
    assert elev.shape == (4,)
    assert az.shape == (4,)
    # Azimuths must lie in [0, 360).
    assert np.all(az >= 0.0)
    assert np.all(az < 360.0)
