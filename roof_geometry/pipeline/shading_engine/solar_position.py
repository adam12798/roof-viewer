"""
Solar position — Michalsky 1988.

Vectorized NumPy implementation of the Michalsky (1988) algorithm for
solar position.  Accurate to ~0.01 degrees, which is plenty for solar
design / shading work.

References
----------
Michalsky, J.J. (1988). "The Astronomical Almanac's algorithm for
approximate solar position (1950-2050)." Solar Energy 40(3), 227-235.
"""

from __future__ import annotations

from datetime import datetime, timezone

import numpy as np

# J2000 epoch: 2000-01-01 12:00 UTC
_J2000 = np.datetime64("2000-01-01T12:00:00", "s")


def _to_datetime64_seconds(timestamps: np.ndarray) -> np.ndarray:
    """Coerce an array of datetimes (numpy or Python) to datetime64[s]."""
    arr = np.asarray(timestamps)
    if arr.dtype.kind == "M":
        return arr.astype("datetime64[s]")
    # Fall back to object array of Python datetimes.
    return np.array(
        [np.datetime64(ts.replace(tzinfo=None)) if isinstance(ts, datetime) else np.datetime64(ts)
         for ts in arr.ravel()],
        dtype="datetime64[s]",
    ).reshape(arr.shape)


def compute_solar_position(
    lat_deg: float,
    lng_deg: float,
    timestamps_utc: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Compute solar elevation and azimuth for an array of UTC timestamps.

    Parameters
    ----------
    lat_deg
        Observer latitude in degrees (+ = north).
    lng_deg
        Observer longitude in degrees (+ = east).
    timestamps_utc
        Array of UTC timestamps — accepts ``numpy.datetime64`` (any
        precision), or a Python ``datetime`` object array.  Shape is
        preserved in the outputs.

    Returns
    -------
    elevation_deg, azimuth_deg
        Solar elevation above horizon (degrees, negative below) and
        solar azimuth in compass convention (0=N, 90=E, 180=S, 270=W).
    """
    ts = _to_datetime64_seconds(timestamps_utc)

    # Julian days since J2000 (2000-01-01 12:00 UTC), as float64.
    delta_sec = (ts - _J2000).astype("timedelta64[s]").astype(np.float64)
    n = delta_sec / 86400.0  # days

    # UTC hour-of-day (float).  We need this for GMST.
    day = ts.astype("datetime64[D]")
    sec_of_day = (ts - day).astype("timedelta64[s]").astype(np.float64)
    utc_hours = sec_of_day / 3600.0

    # --- Ecliptic quantities (degrees) ---
    L = (280.460 + 0.9856474 * n) % 360.0  # mean longitude
    g = (357.528 + 0.9856003 * n) % 360.0  # mean anomaly

    g_rad = np.deg2rad(g)
    lam_deg = L + 1.915 * np.sin(g_rad) + 0.020 * np.sin(2.0 * g_rad)
    ep_deg = 23.439 - 0.0000004 * n  # obliquity

    lam_rad = np.deg2rad(lam_deg)
    ep_rad = np.deg2rad(ep_deg)

    # --- Equatorial coordinates ---
    # Right ascension (radians), then degrees, kept in same quadrant as lambda.
    ra_rad = np.arctan2(np.cos(ep_rad) * np.sin(lam_rad), np.cos(lam_rad))
    ra_deg = np.rad2deg(ra_rad) % 360.0
    dec_rad = np.arcsin(np.sin(ep_rad) * np.sin(lam_rad))

    # --- Sidereal time → hour angle ---
    # GMST in hours, Michalsky's form.
    gmst = (6.697375 + 0.0657098242 * n + utc_hours) % 24.0
    # Local mean sidereal time in hours.
    lmst_hours = (gmst + lng_deg / 15.0) % 24.0
    # Hour angle in degrees, wrapped to [-180, 180].
    ha_deg = lmst_hours * 15.0 - ra_deg
    ha_deg = ((ha_deg + 180.0) % 360.0) - 180.0

    ha_rad = np.deg2rad(ha_deg)
    phi = np.deg2rad(lat_deg)

    # --- Elevation ---
    sin_el = (
        np.sin(dec_rad) * np.sin(phi)
        + np.cos(dec_rad) * np.cos(phi) * np.cos(ha_rad)
    )
    el_rad = np.arcsin(np.clip(sin_el, -1.0, 1.0))
    elevation_deg = np.rad2deg(el_rad)

    # --- Azimuth (compass: 0=N, 90=E, 180=S, 270=W) ---
    az_num = -np.sin(ha_rad)
    az_den = np.tan(dec_rad) * np.cos(phi) - np.sin(phi) * np.cos(ha_rad)
    az_rad = np.arctan2(az_num, az_den)
    azimuth_deg = (np.rad2deg(az_rad) + 360.0) % 360.0

    return elevation_deg, azimuth_deg


def make_hourly_utc_year(year: int = 2025) -> np.ndarray:
    """Return an array of 8760 (or 8784) hourly UTC timestamps for ``year``.

    We default to 2025 which is a non-leap year → exactly 8760 hours,
    the conventional "annual" resolution.
    """
    start = np.datetime64(f"{year:04d}-01-01T00:00:00", "s")
    end = np.datetime64(f"{year + 1:04d}-01-01T00:00:00", "s")
    hours = np.arange(start, end, np.timedelta64(3600, "s"), dtype="datetime64[s]")
    return hours


def day_of_year(timestamps_utc: np.ndarray) -> np.ndarray:
    """Return 1-indexed day-of-year for each UTC timestamp."""
    ts = _to_datetime64_seconds(timestamps_utc)
    year_start = ts.astype("datetime64[Y]").astype("datetime64[s]")
    delta_days = (ts.astype("datetime64[D]") - year_start.astype("datetime64[D]")).astype(np.int64)
    return (delta_days + 1).astype(np.int64)
