"""
Registration: compute affine transform aligning anchor dots between
LiDAR space and image space using least-squares SVD.
"""

from __future__ import annotations

import math
import uuid
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    from models.schemas import AnchorDot

from models.schemas import RegistrationTransform


def compute_registration(
    anchor_dots: list[AnchorDot],
    design_center=None,
    lidar_input=None,
    image_input=None,
) -> RegistrationTransform:
    """
    Estimate a rigid (rotation + translation + uniform scale) transform
    from anchor dot positions expressed in two coordinate frames.

    Parameters
    ----------
    anchor_dots : list[AnchorDot]
        User-placed alignment points.
    design_center : DesignCenter, optional
        Geographic centre of the project.
    lidar_input : LidarInput, optional
        LiDAR input (used for bounds).
    image_input : ImageInput, optional
        Image input (used for geo_bounds).

    Returns
    -------
    RegistrationTransform
    """
    if len(anchor_dots) < 2:
        return _identity_transform()

    # Extract bounds from input objects or use defaults
    lidar_bounds = [-35, -35, 35, 35]
    image_bounds = [0, 0, 0, 0]
    if lidar_input is not None and hasattr(lidar_input, 'bounds'):
        lidar_bounds = list(lidar_input.bounds)
    if image_input is not None and hasattr(image_input, 'geo_bounds'):
        image_bounds = list(image_input.geo_bounds)

    # --- Build corresponding point sets ---
    # Source: LiDAR local (x, z)
    src = np.array([[d.x, d.z] for d in anchor_dots], dtype=np.float64)

    # Destination: image local (project lat/lng into image metres)
    dst = np.array(
        [_latlon_to_image_local(d, image_bounds, lidar_bounds) for d in anchor_dots],
        dtype=np.float64,
    )

    # --- SVD-based rigid + scale transform ---
    # Centroids
    src_centroid = src.mean(axis=0)
    dst_centroid = dst.mean(axis=0)

    src_centered = src - src_centroid
    dst_centered = dst - dst_centroid

    # Cross-covariance
    H = src_centered.T @ dst_centered  # 2x2

    U, S, Vt = np.linalg.svd(H)

    # Rotation
    d = np.linalg.det(Vt.T @ U.T)
    sign_matrix = np.diag([1.0, np.sign(d)])
    R = Vt.T @ sign_matrix @ U.T  # 2x2 rotation

    # Scale (ratio of spreads)
    src_var = np.sum(src_centered ** 2)
    scale = float(np.sum(S) / src_var) if src_var > 1e-12 else 1.0

    # Translation
    t = dst_centroid - scale * (R @ src_centroid)

    # --- Build 3x3 affine matrix ---
    affine = np.eye(3)
    affine[:2, :2] = scale * R
    affine[:2, 2] = t

    # --- Compute residuals ---
    transformed = (scale * (R @ src.T)).T + t
    residuals = np.linalg.norm(transformed - dst, axis=1)
    rmse = float(np.sqrt(np.mean(residuals ** 2)))

    # Extract rotation angle
    rotation_deg = float(math.degrees(math.atan2(R[1, 0], R[0, 0])))

    return RegistrationTransform(
        affine_matrix=affine.tolist(),
        tx=float(t[0]),
        tz=float(t[1]),
        rotation_deg=rotation_deg,
        scale=float(scale),
        residual_error=rmse,
        method="anchor_affine",
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _latlon_to_image_local(
    dot: AnchorDot,
    image_bounds: list[float],
    lidar_bounds: list[float],
) -> list[float]:
    """
    Project a dot's lat/lng into the same local-metre frame used by LiDAR,
    using the image geographic bounds as the reference.

    Falls back to the dot's own x/z if lat/lng are missing (identity).
    """
    if dot.lat is None or dot.lng is None:
        return [dot.x, dot.z]

    south, west, north, east = image_bounds
    lidar_min_x, lidar_min_z, lidar_max_x, lidar_max_z = lidar_bounds

    # Normalised position within image bounds  [0..1]
    frac_x = (dot.lng - west) / (east - west) if east != west else 0.5
    frac_z = (dot.lat - south) / (north - south) if north != south else 0.5

    # Map to LiDAR local metres
    local_x = lidar_min_x + frac_x * (lidar_max_x - lidar_min_x)
    local_z = lidar_min_z + frac_z * (lidar_max_z - lidar_min_z)
    return [local_x, local_z]


def _identity_transform() -> RegistrationTransform:
    """Return an identity registration (no transform)."""
    return RegistrationTransform(
        affine_matrix=[[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        tx=0.0,
        tz=0.0,
        rotation_deg=0.0,
        scale=1.0,
        residual_error=0.0,
        method="identity",
    )


def apply_transform_2d(
    points: np.ndarray,
    transform: RegistrationTransform,
) -> np.ndarray:
    """
    Apply a RegistrationTransform to an Nx2 array of (x, z) points.
    Returns transformed Nx2 array.
    """
    M = np.array(transform.affine_matrix, dtype=np.float64)
    # Extract 2x2 linear part and translation
    A = M[:2, :2]
    t = M[:2, 2]
    return (A @ points.T).T + t
