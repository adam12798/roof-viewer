"""
LiDAR pre-processing: registration, ground removal, outlier filtering,
height normalisation, and voxel downsampling.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

import numpy as np

if TYPE_CHECKING:
    pass

from models.schemas import RegistrationTransform

logger = logging.getLogger(__name__)

# Try to import Open3D; fall back gracefully.
try:
    import open3d as o3d

    HAS_O3D = True
except ImportError:
    o3d = None  # type: ignore[assignment]
    HAS_O3D = False
    logger.warning("Open3D not installed -- falling back to numpy-only LiDAR processing")


def preprocess_lidar(
    points: np.ndarray,
    registration: RegistrationTransform,
    *,
    ground_percentile: float = 5.0,
    ground_threshold_m: float = 2.0,
    outlier_nb_neighbors: int = 20,
    outlier_std_ratio: float = 2.0,
    voxel_size: float = 0.15,
) -> np.ndarray:
    """
    Full LiDAR preprocessing pipeline.

    Parameters
    ----------
    points : np.ndarray
        Nx3 (x, y, z) or Nx4 (x, y, z, classification) point cloud.
        y = height.
    registration : RegistrationTransform
        Transform to apply for alignment.
    ground_percentile : float
        Percentile of heights used to estimate ground plane.
    ground_threshold_m : float
        Points within this distance above ground are removed.
    outlier_nb_neighbors : int
        Number of neighbours for statistical outlier removal.
    outlier_std_ratio : float
        Standard-deviation multiplier for outlier removal.
    voxel_size : float
        Voxel edge length for downsampling (metres).

    Returns
    -------
    np.ndarray
        Cleaned Nx3 point cloud with height-normalised y values.
    """
    pts = np.asarray(points, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] < 3:
        raise ValueError(f"Expected Nx3+ array, got shape {pts.shape}")

    # Keep only XYZ
    pts = pts[:, :3].copy()

    # 1. Apply registration transform (XZ plane)
    pts = _apply_registration(pts, registration)

    # 2. Ground plane estimation
    ground_height = float(np.percentile(pts[:, 1], ground_percentile))
    logger.info("Estimated ground height: %.2f m (percentile=%s)", ground_height, ground_percentile)

    # 3. Ground removal
    above_ground = pts[:, 1] > (ground_height + ground_threshold_m)
    pts = pts[above_ground]
    logger.info("After ground removal: %d points", len(pts))

    if len(pts) == 0:
        return pts

    # 4. Height normalisation
    pts[:, 1] -= ground_height

    # 5. Statistical outlier removal
    pts = _remove_outliers(pts, outlier_nb_neighbors, outlier_std_ratio)
    logger.info("After outlier removal: %d points", len(pts))

    # 6. Voxel downsampling
    pts = _voxel_downsample(pts, voxel_size)
    logger.info("After voxel downsampling: %d points", len(pts))

    return pts


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _apply_registration(pts: np.ndarray, reg: RegistrationTransform) -> np.ndarray:
    """Apply the 2D affine (XZ) from a RegistrationTransform, preserving Y."""
    M = np.array(reg.affine_matrix, dtype=np.float64)
    A = M[:2, :2]
    t = M[:2, 2]

    xz = pts[:, [0, 2]]  # extract X and Z
    xz_transformed = (A @ xz.T).T + t

    out = pts.copy()
    out[:, 0] = xz_transformed[:, 0]
    out[:, 2] = xz_transformed[:, 1]
    return out


def _remove_outliers(
    pts: np.ndarray,
    nb_neighbors: int,
    std_ratio: float,
) -> np.ndarray:
    """Statistical outlier removal using Open3D or numpy fallback."""
    if HAS_O3D and len(pts) > nb_neighbors:
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(pts)
        _, inlier_idx = pcd.remove_statistical_outlier(
            nb_neighbors=nb_neighbors,
            std_ratio=std_ratio,
        )
        return pts[inlier_idx]

    # Numpy fallback: simple distance-based filtering
    if len(pts) < nb_neighbors:
        return pts

    from scipy.spatial import cKDTree

    tree = cKDTree(pts)
    dists, _ = tree.query(pts, k=nb_neighbors + 1)
    mean_dists = dists[:, 1:].mean(axis=1)  # skip self
    global_mean = mean_dists.mean()
    global_std = mean_dists.std()
    mask = mean_dists < (global_mean + std_ratio * global_std)
    return pts[mask]


def _voxel_downsample(pts: np.ndarray, voxel_size: float) -> np.ndarray:
    """Voxel grid downsampling using Open3D or numpy fallback."""
    if voxel_size <= 0:
        return pts

    if HAS_O3D and len(pts) > 0:
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(pts)
        down = pcd.voxel_down_sample(voxel_size=voxel_size)
        return np.asarray(down.points)

    # Numpy fallback: hash-based voxel grid
    if len(pts) == 0:
        return pts

    quantized = np.floor(pts / voxel_size).astype(np.int64)
    # Use structured array for unique voxel keys
    keys = quantized[:, 0] * 1_000_000 + quantized[:, 1] * 1_000 + quantized[:, 2]
    _, unique_idx = np.unique(keys, return_index=True)
    return pts[unique_idx]
