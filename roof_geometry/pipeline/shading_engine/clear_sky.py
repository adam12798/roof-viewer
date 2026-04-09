"""
Clear-sky global horizontal irradiance and direct/diffuse split.

Uses the Haurwitz clear-sky model for GHI and the Erbs (1982) piecewise
decomposition to split GHI into beam-normal (DNI) and diffuse-horizontal
(DHI).  All functions are vectorized.

References
----------
Haurwitz, B. (1945). "Insolation in relation to cloudiness and cloud
density." Journal of Meteorology 2, 154-166.

Erbs, D.G., Klein, S.A., Duffie, J.A. (1982). "Estimation of the
diffuse radiation fraction for hourly, daily and monthly-average
global radiation." Solar Energy 28(4), 293-302.
"""

from __future__ import annotations

import numpy as np

# Solar constant used in Erbs decomposition (W/m²).
_SOLAR_CONSTANT = 1367.0

# Near-horizon guard: treat the sun as down when cos(zenith) ≤ this
# to avoid blow-up in 1/cos(Z).
_COS_Z_EPS = 0.01


def haurwitz_ghi(elevation_deg: np.ndarray) -> np.ndarray:
    """Clear-sky global horizontal irradiance (W/m²) from Haurwitz.

    ``GHI = 1098 * cos(Z) * exp(-0.059 / cos(Z))`` when the sun is up
    (``cos(Z) > 0``), else 0.
    """
    el_rad = np.deg2rad(np.asarray(elevation_deg, dtype=np.float64))
    cos_z = np.sin(el_rad)  # cos(zenith) = sin(elevation)

    sun_up = cos_z > 0.0
    # Evaluate Haurwitz on a safe denominator, mask sun-down to 0.
    safe_cos_z = np.where(sun_up, cos_z, 1.0)
    ghi = 1098.0 * safe_cos_z * np.exp(-0.059 / safe_cos_z)
    return np.where(sun_up, ghi, 0.0)


def erbs_decomposition(
    ghi: np.ndarray,
    elevation_deg: np.ndarray,
    day_of_year: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Split GHI into DNI and DHI via the Erbs (1982) correlation.

    Parameters
    ----------
    ghi
        Global horizontal irradiance, W/m².
    elevation_deg
        Solar elevation above horizon, degrees.
    day_of_year
        1-indexed day of year for each sample (used for the
        extraterrestrial normal irradiance).

    Returns
    -------
    dni, dhi
        Direct-normal and diffuse-horizontal irradiance, W/m².  Both
        zero when the sun is below the horizon.
    """
    ghi = np.asarray(ghi, dtype=np.float64)
    el_rad = np.deg2rad(np.asarray(elevation_deg, dtype=np.float64))
    doy = np.asarray(day_of_year, dtype=np.float64)

    cos_z = np.sin(el_rad)
    sun_up = cos_z > _COS_Z_EPS

    # Extraterrestrial normal irradiance — eccentricity correction.
    i0_n = _SOLAR_CONSTANT * (1.0 + 0.033 * np.cos(2.0 * np.pi * doy / 365.0))

    # Clearness index Kt = GHI / (I0_n * cos(Z)).
    safe_cos_z = np.where(sun_up, cos_z, 1.0)
    kt = np.where(sun_up, ghi / (i0_n * safe_cos_z), 0.0)
    kt = np.clip(kt, 0.0, 1.0)

    # Erbs piecewise diffuse fraction.
    kd_low = 1.0 - 0.09 * kt
    kd_mid = (
        0.9511
        - 0.1604 * kt
        + 4.388 * kt**2
        - 16.638 * kt**3
        + 12.336 * kt**4
    )
    kd_high = np.full_like(kt, 0.165)

    kd = np.where(
        kt <= 0.22,
        kd_low,
        np.where(kt <= 0.80, kd_mid, kd_high),
    )

    dhi = ghi * kd
    dni = np.where(sun_up, (ghi - dhi) / safe_cos_z, 0.0)

    # Safety: mask sun-down.
    dni = np.where(sun_up, dni, 0.0)
    dhi = np.where(sun_up, dhi, 0.0)

    return dni, dhi


def compute_clearsky(
    elevation_deg: np.ndarray,
    day_of_year: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Convenience: run Haurwitz + Erbs and return ``(ghi, dni, dhi)``."""
    ghi = haurwitz_ghi(elevation_deg)
    dni, dhi = erbs_decomposition(ghi, elevation_deg, day_of_year)
    return ghi, dni, dhi
