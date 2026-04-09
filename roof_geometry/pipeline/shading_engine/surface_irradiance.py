"""
Tilted-surface plane-of-array irradiance — Liu-Jordan isotropic model.

For a surface with tilt ``beta`` (degrees from horizontal) and compass
azimuth ``gamma`` (degrees, 0=N, 90=E, 180=S, 270=W), the POA
irradiance is the sum of three components:

* Beam: ``DNI * max(cos(AOI), 0)``
* Sky diffuse (isotropic): ``DHI * (1 + cos(beta)) / 2``
* Ground-reflected: ``GHI * albedo * (1 - cos(beta)) / 2``

Both the sun and the surface are expressed in compass azimuth, so the
``A_s - gamma`` term in the angle-of-incidence formula is invariant to
the choice of reference direction (north vs south) as long as both use
the same convention.
"""

from __future__ import annotations

import numpy as np


def liu_jordan_poa(
    elevation_deg: np.ndarray,
    solar_azimuth_deg: np.ndarray,
    ghi: np.ndarray,
    dni: np.ndarray,
    dhi: np.ndarray,
    pitch_deg: float,
    surface_azimuth_deg: float,
    albedo: float = 0.2,
) -> np.ndarray:
    """Compute POA total irradiance per sample for one tilted surface.

    All irradiance arrays (``ghi``, ``dni``, ``dhi``) share the same
    shape as ``elevation_deg`` / ``solar_azimuth_deg``.  The result has
    the same shape.
    """
    el_rad = np.deg2rad(np.asarray(elevation_deg, dtype=np.float64))
    az_rad = np.deg2rad(np.asarray(solar_azimuth_deg, dtype=np.float64))
    beta = np.deg2rad(float(pitch_deg))
    gamma = np.deg2rad(float(surface_azimuth_deg))

    # Zenith angle and its trig.
    cos_z = np.sin(el_rad)
    sin_z = np.cos(el_rad)

    cos_beta = np.cos(beta)
    sin_beta = np.sin(beta)

    # cos(AOI) between sun and surface normal.
    cos_aoi = cos_z * cos_beta + sin_z * sin_beta * np.cos(az_rad - gamma)
    # Back-of-panel → no direct component.
    cos_aoi = np.maximum(cos_aoi, 0.0)

    # Sun-down mask — GHI/DNI/DHI are already zero there, but guard the
    # beam component explicitly so a numerically tiny cos(AOI) at
    # elevation ≤ 0 cannot leak through.
    sun_up = cos_z > 0.0
    cos_aoi = np.where(sun_up, cos_aoi, 0.0)

    poa_beam = np.asarray(dni, dtype=np.float64) * cos_aoi
    poa_diffuse = np.asarray(dhi, dtype=np.float64) * (1.0 + cos_beta) / 2.0
    poa_ground = (
        np.asarray(ghi, dtype=np.float64) * float(albedo) * (1.0 - cos_beta) / 2.0
    )

    return poa_beam + poa_diffuse + poa_ground
