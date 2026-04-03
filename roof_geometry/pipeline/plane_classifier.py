"""
Plane-first roof classification.

Detects planes from the point cloud, builds structural relationships,
then classifies every point based on plane membership and inter-plane
geometry.  Designed as a drop-in replacement for the grid-cell-based
classification in gradient_detector._classify_grid_cells.

All thresholds are adaptive (derived from point density and local noise).
"""

from __future__ import annotations

import logging
import math
from collections import Counter
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

import numpy as np
from scipy import ndimage

if TYPE_CHECKING:
    pass

from models.schemas import (
    EdgeType,
    PlaneEquation,
    Point2D,
    Point3D,
    RoofEdge,
    RoofPlane,
)

logger = logging.getLogger(__name__)

# Optional imports — graceful fallback
try:
    import open3d as o3d
    HAS_O3D = True
except ImportError:
    o3d = None  # type: ignore[assignment]
    HAS_O3D = False

try:
    from scipy.spatial import cKDTree
    HAS_SCIPY_SPATIAL = True
except ImportError:
    HAS_SCIPY_SPATIAL = False

# Import CellLabel from gradient_detector (canonical location)
from pipeline.gradient_detector import CellLabel


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class PointFeatures:
    """Per-point geometric features computed from KNN neighborhoods."""
    normals: np.ndarray       # (N, 3) — oriented upward
    curvature: np.ndarray     # (N,)   — ratio of smallest eigenvalue to sum
    local_density: np.ndarray  # (N,)  — neighbor count within adaptive radius
    height_std: np.ndarray    # (N,)   — std of Y coords in KNN neighborhood


@dataclass
class AdaptiveThresholds:
    """Data-driven thresholds replacing all fixed constants."""
    distance_threshold: float      # RANSAC inlier distance
    roughness_threshold: float     # max RMS residual for a valid roof plane
    curvature_tree_threshold: float  # curvature above this = tree canopy
    height_ground_threshold: float   # points below this = ground
    nn_median_dist: float          # median nearest-neighbor distance


@dataclass
class PlaneInfo:
    """Lightweight metadata per accepted plane for classification."""
    index: int
    plane: RoofPlane
    residual: float
    is_primary: bool = False  # anchor dot falls within boundary


@dataclass
class ClassificationResult:
    """Output of the full plane-first classification pipeline."""
    per_point_class: np.ndarray   # (N,) CellLabel ints
    planes: list[RoofPlane]
    ridge_lines: list[tuple[np.ndarray, np.ndarray]]  # list of (start_3d, end_3d) pairs
    plane_infos: list[PlaneInfo]


# ---------------------------------------------------------------------------
# 1. Point Feature Computation
# ---------------------------------------------------------------------------

def compute_point_features(
    point_cloud: np.ndarray,
    k_neighbors: int = 20,
) -> PointFeatures:
    """
    Compute per-point normals, curvature, and local density.

    Uses Open3D if available (fast), otherwise scipy.spatial.cKDTree + numpy PCA.
    """
    pts = np.asarray(point_cloud, dtype=np.float64)
    N = len(pts)

    if HAS_O3D and N > k_neighbors:
        return _compute_features_o3d(pts, k_neighbors)

    return _compute_features_numpy(pts, k_neighbors)


def _compute_features_o3d(pts: np.ndarray, k: int) -> PointFeatures:
    """Open3D fast path for normal + curvature estimation."""
    pcd = o3d.geometry.PointCloud()
    pcd.points = o3d.utility.Vector3dVector(pts)

    # Estimate normals
    pcd.estimate_normals(
        search_param=o3d.geometry.KDTreeSearchParamKNN(knn=k),
    )
    # Orient normals upward
    pcd.orient_normals_towards_camera_location(camera_location=np.array([0, 100, 0]))

    normals = np.asarray(pcd.normals)
    # Ensure y-component is positive (pointing up)
    flip_mask = normals[:, 1] < 0
    normals[flip_mask] *= -1

    # Curvature via covariance eigenvalues (Open3D doesn't expose this directly)
    # Use the KDTree we already built
    tree = o3d.geometry.KDTreeFlann(pcd)
    N = len(pts)
    curvature = np.zeros(N)
    local_density = np.zeros(N, dtype=int)
    height_std = np.zeros(N)

    for i in range(N):
        [_, idx, _] = tree.search_knn_vector_3d(pts[i], k)
        idx = list(idx)
        if len(idx) < 3:
            continue
        local_density[i] = len(idx)
        neighbors = pts[idx]
        height_std[i] = float(np.std(neighbors[:, 1]))
        centered = neighbors - neighbors.mean(axis=0)
        cov = centered.T @ centered / len(neighbors)
        try:
            eigvals = np.linalg.eigvalsh(cov)
            eigvals = np.maximum(eigvals, 0)
            total = eigvals.sum()
            curvature[i] = eigvals[0] / total if total > 1e-12 else 0.0
        except np.linalg.LinAlgError:
            pass

    return PointFeatures(normals=normals, curvature=curvature, local_density=local_density, height_std=height_std)


def _compute_features_numpy(pts: np.ndarray, k: int) -> PointFeatures:
    """Numpy/scipy fallback for normal + curvature estimation."""
    N = len(pts)
    normals = np.zeros((N, 3))
    curvature = np.zeros(N)
    local_density = np.zeros(N, dtype=int)
    height_std = np.zeros(N)

    if not HAS_SCIPY_SPATIAL:
        logger.warning("scipy.spatial not available — returning zero features")
        normals[:, 1] = 1.0  # default: pointing up
        return PointFeatures(normals=normals, curvature=curvature, local_density=local_density, height_std=height_std)

    tree = cKDTree(pts)
    # Query k neighbors for each point
    dists, indices = tree.query(pts, k=min(k, N))

    for i in range(N):
        idx = indices[i]
        valid = idx[idx < N]  # cKDTree pads with N for missing neighbors
        if len(valid) < 3:
            normals[i] = [0, 1, 0]
            continue

        local_density[i] = len(valid)
        neighbors = pts[valid]
        height_std[i] = float(np.std(neighbors[:, 1]))
        centered = neighbors - neighbors.mean(axis=0)
        cov = centered.T @ centered / len(neighbors)
        try:
            eigvals, eigvecs = np.linalg.eigh(cov)
            # Smallest eigenvalue's eigenvector = normal
            normals[i] = eigvecs[:, 0]
            # Orient upward
            if normals[i, 1] < 0:
                normals[i] *= -1
            # Curvature = smallest eigenvalue / sum
            eigvals = np.maximum(eigvals, 0)
            total = eigvals.sum()
            curvature[i] = eigvals[0] / total if total > 1e-12 else 0.0
        except np.linalg.LinAlgError:
            normals[i] = [0, 1, 0]

    return PointFeatures(normals=normals, curvature=curvature, local_density=local_density, height_std=height_std)


# ---------------------------------------------------------------------------
# 2. Adaptive Thresholds
# ---------------------------------------------------------------------------

def compute_adaptive_thresholds(
    point_cloud: np.ndarray,
    features: PointFeatures,
) -> AdaptiveThresholds:
    """
    Derive all classification thresholds from point cloud statistics.

    - distance_threshold: 2x median NN distance, clamped to [0.05, 0.30]
    - roughness_threshold: 3x noise-floor residual
    - curvature_tree_threshold: 5x noise-floor curvature
    - height_ground_threshold: scaled by point cloud height distribution
    """
    pts = np.asarray(point_cloud)

    # Median nearest-neighbor distance
    if HAS_SCIPY_SPATIAL and len(pts) > 2:
        tree = cKDTree(pts)
        nn_dists, _ = tree.query(pts, k=2)
        nn_median = float(np.median(nn_dists[:, 1]))
    else:
        nn_median = 0.15  # reasonable default for Google LiDAR

    distance_threshold = float(np.clip(2.0 * nn_median, 0.05, 0.30))

    # Curvature noise floor: median of the lowest-curvature 20% of points
    # These are the most planar points — their curvature represents sensor noise
    curv = features.curvature
    sorted_curv = np.sort(curv[curv > 0]) if np.any(curv > 0) else np.array([0.01])
    n_floor = max(1, len(sorted_curv) // 5)
    noise_floor_curv = float(np.median(sorted_curv[:n_floor])) if n_floor > 0 else 0.01
    curvature_tree_threshold = max(0.05, 5.0 * noise_floor_curv)

    # Roughness: proportional to distance threshold
    roughness_threshold = max(0.08, 3.0 * distance_threshold)

    # Ground height: 10th percentile + buffer
    heights = pts[:, 1]
    h_10 = float(np.percentile(heights, 10)) if len(heights) > 0 else 0.0
    h_range = float(np.percentile(heights, 90) - h_10) if len(heights) > 10 else 3.0
    height_ground_threshold = max(0.3, h_10 + 0.15 * h_range)

    logger.info(
        "Adaptive thresholds — dist=%.3f rough=%.3f curv_tree=%.3f height_gnd=%.2f nn_med=%.3f",
        distance_threshold, roughness_threshold, curvature_tree_threshold,
        height_ground_threshold, nn_median,
    )

    return AdaptiveThresholds(
        distance_threshold=distance_threshold,
        roughness_threshold=roughness_threshold,
        curvature_tree_threshold=curvature_tree_threshold,
        height_ground_threshold=height_ground_threshold,
        nn_median_dist=nn_median,
    )


# ---------------------------------------------------------------------------
# 3. Outlier Pre-filter
# ---------------------------------------------------------------------------

def prefilter_outliers(
    point_cloud: np.ndarray,
    nn_median_dist: float,
    min_neighbors: int = 3,
    min_cluster_size: int = 5,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Remove isolated and noisy points before plane extraction.

    Returns
    -------
    filtered_pts : np.ndarray (M, 3) where M <= N
    keep_mask : np.ndarray (N,) boolean — True for kept points
    """
    pts = np.asarray(point_cloud)
    N = len(pts)

    if not HAS_SCIPY_SPATIAL or N < min_cluster_size:
        return pts, np.ones(N, dtype=bool)

    # Radius outlier: remove points with < min_neighbors within 2x median NN dist
    radius = max(0.3, 2.0 * nn_median_dist)
    tree = cKDTree(pts)
    neighbor_counts = np.array(tree.query_ball_point(pts, r=radius, return_length=True))
    keep = neighbor_counts >= min_neighbors

    # Connected component filter: remove tiny isolated clusters in XZ space
    # Only run if we have enough points
    if keep.sum() > min_cluster_size * 2:
        kept_pts = pts[keep]
        kept_xz = kept_pts[:, [0, 2]]
        tree_xz = cKDTree(kept_xz)
        # Build adjacency via radius query
        pairs = tree_xz.query_pairs(r=radius * 1.5)
        # Union-find for connected components
        parent = np.arange(len(kept_pts))

        def _find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for a, b in pairs:
            ra, rb = _find(a), _find(b)
            if ra != rb:
                parent[ra] = rb

        roots = np.array([_find(i) for i in range(len(kept_pts))])
        _, comp_sizes = np.unique(roots, return_counts=True)
        root_to_size = dict(zip(*np.unique(roots, return_counts=True)))
        component_too_small = np.array([root_to_size[r] < min_cluster_size for r in roots])

        # Map back to the keep mask
        kept_indices = np.where(keep)[0]
        keep[kept_indices[component_too_small]] = False

    removed = N - keep.sum()
    if removed > 0:
        logger.info("Outlier prefilter removed %d / %d points (%.1f%%)",
                     removed, N, 100.0 * removed / N)

    return pts[keep], keep


# ---------------------------------------------------------------------------
# 4. Core Classification
# ---------------------------------------------------------------------------

def classify_from_planes(
    point_cloud: np.ndarray,
    planes: list[RoofPlane],
    point_labels: np.ndarray,
    features: PointFeatures,
    thresholds: AdaptiveThresholds,
    per_plane_residuals: list[float],
    anchor_dots: list[tuple[float, float]] | None = None,
    adjacency: dict[str, list[str]] | None = None,
    edges: list[RoofEdge] | None = None,
) -> ClassificationResult:
    """
    Classify every point based on plane membership and inter-plane geometry.

    This replaces the multi-pass grid-cell classification with a
    structure-aware approach: planes are the primary unit, and points
    inherit labels from the planes they belong to.
    """
    pts = np.asarray(point_cloud)
    N = len(pts)
    labels = np.full(N, CellLabel.UNSURE, dtype=int)

    plane_infos = _build_plane_infos(planes, per_plane_residuals, anchor_dots)

    # ---- Step 0: Learn roof pattern, then reject outlier planes ----
    #
    # A real residential roof has structural constraints:
    #   - Pitches cluster around 1-2 values (e.g., 22° and 22°, or 22° and 5°)
    #   - Elevations are bounded (main roof ± step-downs for porches/garages)
    #   - Planes are spatially near the anchor dots / house footprint
    #   - Surface is smooth (low curvature, consistent normals)
    #
    # Trees violate ALL of these.  Instead of trying to detect trees by
    # curvature alone, we learn the roof's pattern from primary (anchor-
    # containing) planes, then score every other plane against it.
    # Planes that don't fit the pattern are rejected as TREE/noise.

    tree_plane_indices: set[int] = set()

    # --- Pre-screen: compute per-plane median height_std ---
    # This is our best signal for roof vs tree.  Roof planes have very low
    # height_std (smooth surface); tree planes have high height_std (bumpy).
    # We use this to exclude tree planes from the "primary" set even if
    # they contain anchor dots.
    plane_median_hstd: dict[int, float] = {}
    for pi in plane_infos:
        mask = point_labels == pi.index
        if mask.sum() >= 5:
            plane_median_hstd[pi.index] = float(np.median(features.height_std[mask]))
        else:
            plane_median_hstd[pi.index] = 999.0

    # Find the smoothness baseline: median of all plane median_hstds
    all_hstds = sorted(plane_median_hstd.values())
    if all_hstds:
        hstd_baseline = all_hstds[len(all_hstds) // 4]  # 25th percentile = smooth planes
    else:
        hstd_baseline = 0.1

    # A plane is "smooth enough" for primary if its median hstd < 3x baseline
    smooth_threshold = max(hstd_baseline * 3.0, 0.2)

    # --- Learn the roof pattern from primary planes ---
    primary = [
        pi for pi in plane_infos
        if pi.is_primary and plane_median_hstd.get(pi.index, 999) < smooth_threshold
    ]
    if not primary:
        # No clean primary — use the 2 largest smooth planes as proxy
        smooth_planes = [
            pi for pi in plane_infos
            if plane_median_hstd.get(pi.index, 999) < smooth_threshold
        ]
        by_area = sorted(smooth_planes or plane_infos, key=lambda pi: pi.plane.area_m2, reverse=True)
        primary = by_area[:2] if len(by_area) >= 2 else by_area[:1]

    logger.info(
        "Primary plane selection: %d planes, hstd_baseline=%.3f, smooth_threshold=%.3f, "
        "plane_hstds=%s",
        len(primary), hstd_baseline, smooth_threshold,
        {pi.index: f"{plane_median_hstd.get(pi.index, -1):.3f}" for pi in plane_infos},
    )

    if primary:
        pattern_pitches = [pi.plane.pitch_deg for pi in primary]
        pattern_height_max = max(pi.plane.height_m for pi in primary)
        pattern_height_min = min(pi.plane.elevation_m for pi in primary)
        # Spatial centroid of primary planes (XZ)
        primary_centroids = []
        for pi in primary:
            mask = point_labels == pi.index
            if mask.any():
                primary_centroids.append(pts[mask][:, [0, 2]].mean(axis=0))
        if primary_centroids:
            pattern_centroid_xz = np.mean(primary_centroids, axis=0)
        else:
            pattern_centroid_xz = pts[:, [0, 2]].mean(axis=0)
        # Max distance from centroid to any primary plane point
        pattern_radius = 0.0
        for pi in primary:
            mask = point_labels == pi.index
            if mask.any():
                dists = np.linalg.norm(pts[mask][:, [0, 2]] - pattern_centroid_xz, axis=1)
                pattern_radius = max(pattern_radius, float(dists.max()))
        pattern_radius = max(pattern_radius, 5.0)  # at least 5m

        # Curvature, normal stats, and height_std from primary planes
        primary_curvatures = []
        primary_angular_stds = []
        primary_height_stds = []
        for pi in primary:
            mask = point_labels == pi.index
            if mask.sum() < 10:
                continue
            primary_curvatures.extend(features.curvature[mask].tolist())
            primary_height_stds.extend(features.height_std[mask].tolist())
            mn = features.normals[mask]
            mean_n = mn.mean(axis=0)
            mnl = np.linalg.norm(mean_n)
            if mnl > 1e-6:
                mean_n /= mnl
                cos_a = np.clip(mn @ mean_n, -1, 1)
                primary_angular_stds.append(float(np.std(np.arccos(cos_a))))

        pattern_curv_p90 = float(np.percentile(primary_curvatures, 90)) if primary_curvatures else 0.05
        pattern_ang_std_max = max(primary_angular_stds) if primary_angular_stds else math.radians(5)
        # Height std on a roof plane is very low (smooth surface); trees are bumpy
        pattern_hstd_p90 = float(np.percentile(primary_height_stds, 90)) if primary_height_stds else 0.15

        logger.info(
            "Roof pattern — pitches=%s, height=[%.1f, %.1f], radius=%.1f, "
            "curv_p90=%.4f, ang_std_max=%.1f°, hstd_p90=%.3f",
            [f"{p:.1f}" for p in pattern_pitches], pattern_height_min,
            pattern_height_max, pattern_radius,
            pattern_curv_p90, math.degrees(pattern_ang_std_max), pattern_hstd_p90,
        )

        # --- Score each non-primary plane against the pattern ---
        for pi in plane_infos:
            if pi in primary:
                continue
            mask = point_labels == pi.index
            n_pts = mask.sum()
            if n_pts < 5:
                continue

            # Fast-path: if this plane's surface is very rough compared to
            # the smooth baseline, it's almost certainly tree canopy.
            pi_hstd = plane_median_hstd.get(pi.index, 999)
            if pi_hstd > smooth_threshold * 2.0:
                tree_plane_indices.add(pi.index)
                labels[mask] = CellLabel.TREE
                logger.info(
                    "Plane %d → TREE (fast-path hstd=%.3f >> threshold=%.3f, %d pts)",
                    pi.index, pi_hstd, smooth_threshold, n_pts,
                )
                continue

            member_pts = pts[mask]
            plane = pi.plane
            score = 0  # higher = more likely tree
            reasons = []

            # (a) Pitch outlier: doesn't match any known roof pitch
            # Attached structures can have different pitch, but within reason.
            # Porches/garages: 0-15° (flat to shallow).  Main roof: pattern pitch.
            pitch_ok = (
                any(abs(plane.pitch_deg - pp) < 15.0 for pp in pattern_pitches)
                or plane.pitch_deg < 15.0  # allow flat/shallow for attached structures
            )
            if not pitch_ok:
                score += 2
                reasons.append(f"pitch={plane.pitch_deg:.1f}° (pattern={pattern_pitches})")

            # (b) Height outlier: above the main roof peak = likely tree canopy
            if plane.height_m > pattern_height_max + 1.0:
                score += 3
                reasons.append(f"height={plane.height_m:.1f} > pattern_max={pattern_height_max:.1f}")

            # (c) Spatial outlier: centroid far from house footprint
            plane_centroid_xz = member_pts[:, [0, 2]].mean(axis=0)
            dist_from_house = float(np.linalg.norm(plane_centroid_xz - pattern_centroid_xz))
            if dist_from_house > pattern_radius * 1.5:
                score += 2
                reasons.append(f"dist={dist_from_house:.1f}m > radius={pattern_radius:.1f}m")

            # (d) Surface quality: curvature much worse than primary planes
            member_curv = features.curvature[mask]
            median_curv = float(np.median(member_curv))
            if median_curv > pattern_curv_p90 * 3.0:
                score += 2
                reasons.append(f"curv={median_curv:.4f} >> pattern_p90={pattern_curv_p90:.4f}")

            # (e) Normal consistency much worse than primary
            member_normals = features.normals[mask]
            mean_n = member_normals.mean(axis=0)
            mn_len = np.linalg.norm(mean_n)
            if mn_len > 1e-6:
                mean_n /= mn_len
                cos_angles = np.clip(member_normals @ mean_n, -1, 1)
                angular_std = float(np.std(np.arccos(cos_angles)))
            else:
                angular_std = 1.0
            if angular_std > pattern_ang_std_max * 2.5:
                score += 2
                reasons.append(f"ang_std={math.degrees(angular_std):.1f}° >> pattern={math.degrees(pattern_ang_std_max):.1f}°")

            # (f) Residual much worse than primary
            if pi.residual > thresholds.roughness_threshold * 0.7:
                score += 1
                reasons.append(f"resid={pi.residual:.3f}")

            # (g) Local height std — THE strongest tree signal.
            # Roof surfaces are smooth (low height variation in KNN).
            # Tree canopy is bumpy (high height variation).
            member_hstd = features.height_std[mask]
            median_hstd = float(np.median(member_hstd))
            if median_hstd > pattern_hstd_p90 * 3.0:
                score += 3  # heavy weight — this is very discriminative
                reasons.append(f"hstd={median_hstd:.3f} >> pattern_p90={pattern_hstd_p90:.3f}")
            elif median_hstd > pattern_hstd_p90 * 2.0:
                score += 2
                reasons.append(f"hstd={median_hstd:.3f} > pattern_p90={pattern_hstd_p90:.3f}")

            # Threshold: score >= 3 means the plane is an outlier
            if score >= 3:
                tree_plane_indices.add(pi.index)
                labels[mask] = CellLabel.TREE
                logger.info(
                    "Plane %d → TREE (score=%d, %d pts, %s)",
                    pi.index, score, n_pts, ", ".join(reasons),
                )

    # ---- Step 1: Classify plane-assigned points ----
    for pi in plane_infos:
        if pi.index in tree_plane_indices:
            continue  # already labeled TREE
        mask = point_labels == pi.index
        if not mask.any():
            continue

        plane = pi.plane
        if plane.is_flat:
            labels[mask] = CellLabel.FLAT_ROOF
        else:
            labels[mask] = CellLabel.ROOF

    # ---- Step 1b: Per-point tree scrub on roof planes ----
    # Even on valid roof planes, individual points near the tree-roof
    # boundary may have tree-like features (overhanging branches).
    # Two signals: high curvature and high local height_std.
    for pi in plane_infos:
        if pi.index in tree_plane_indices:
            continue
        mask = point_labels == pi.index
        if mask.sum() < 20:
            continue

        member_curv = features.curvature[mask]
        member_hstd = features.height_std[mask]
        plane_median_curv = float(np.median(member_curv))
        plane_median_hstd = float(np.median(member_hstd))
        curv_scrub = max(thresholds.curvature_tree_threshold * 0.7, plane_median_curv * 3.0)
        hstd_scrub = max(0.15, plane_median_hstd * 3.0)

        member_indices = np.where(mask)[0]
        for idx in member_indices:
            is_tree = False
            # High local height variance = bumpy surface = tree
            if features.height_std[idx] > hstd_scrub:
                is_tree = True
            # High curvature + above plane surface
            elif features.curvature[idx] > curv_scrub:
                eq = pi.plane.plane_equation
                px, py, pz = pts[idx]
                signed_dist = eq.a * px + eq.b * py + eq.c * pz + eq.d
                normal_len = math.sqrt(eq.a**2 + eq.b**2 + eq.c**2)
                if normal_len > 1e-10:
                    signed_dist /= normal_len
                if signed_dist > 0.1 or features.curvature[idx] > curv_scrub * 1.5:
                    is_tree = True
            if is_tree:
                labels[idx] = CellLabel.TREE

    # ---- Step 2: LOWER_ROOF — planes significantly below adjacent planes ----
    if adjacency and len(planes) > 1:
        _classify_lower_roofs(
            labels, point_labels, planes, plane_infos, adjacency,
            edges=edges, tree_plane_indices=tree_plane_indices,
        )

    # ---- Step 3: Ridge and Valley from plane intersections ----
    ridge_lines: list[tuple[np.ndarray, np.ndarray]] = []
    if edges:
        ridge_lines = _classify_ridge_valley(
            labels, pts, planes, edges, thresholds.distance_threshold,
        )

    # ---- Step 4: Eave — plane boundary adjacent to ground ----
    _classify_eaves(labels, pts, point_labels, planes, thresholds)

    # ---- Step 5: Step edges — ROOF → LOWER_ROOF transitions ----
    if edges:
        _classify_step_edges(labels, pts, planes, edges, thresholds.distance_threshold)

    # ---- Step 6: Ground — unassigned low points ----
    _classify_ground(labels, pts, point_labels, thresholds)

    # ---- Step 7: Trees — unassigned high-curvature points ----
    _classify_trees(labels, pts, point_labels, features, thresholds)

    # ---- Step 7b: Recover attached structures (porches, garages) ----
    # Unassigned elevated points near existing roof planes with low curvature
    # are likely attached structures that RANSAC couldn't extract as independent planes.
    _recover_attached_structures(labels, pts, point_labels, planes, features, thresholds)

    # ---- Step 8: Obstructions — small elevated clusters above roof ----
    _classify_obstructions(labels, pts, point_labels, planes, thresholds)

    return ClassificationResult(
        per_point_class=labels,
        planes=planes,
        ridge_lines=ridge_lines,
        plane_infos=plane_infos,
    )


# ---------------------------------------------------------------------------
# Classification sub-steps
# ---------------------------------------------------------------------------

def _build_plane_infos(
    planes: list[RoofPlane],
    residuals: list[float],
    anchor_dots: list[tuple[float, float]] | None,
) -> list[PlaneInfo]:
    """Build PlaneInfo list, marking which planes contain anchor dots."""
    infos = []
    for i, plane in enumerate(planes):
        res = residuals[i] if i < len(residuals) else 0.0
        info = PlaneInfo(index=i, plane=plane, residual=res)

        if anchor_dots:
            verts = np.array([[v.x, v.z] for v in plane.vertices])
            for ax, az in anchor_dots:
                if _point_in_polygon_2d(ax, az, verts):
                    info.is_primary = True
                    break

        infos.append(info)
    return infos


def _classify_lower_roofs(
    labels: np.ndarray,
    point_labels: np.ndarray,
    planes: list[RoofPlane],
    plane_infos: list[PlaneInfo],
    adjacency: dict[str, list[str]],
    edges: list[RoofEdge] | None = None,
    tree_plane_indices: set[int] | None = None,
) -> None:
    """Mark ROOF points on planes significantly below their neighbors as LOWER_ROOF."""
    plane_map = {p.id: p for p in planes}
    tree_planes = tree_plane_indices or set()

    # Build set of plane IDs connected by a RIDGE edge — these are
    # opposite faces of the same gable/hip structure and should never
    # be marked LOWER_ROOF relative to each other.
    ridge_partners: set[tuple[str, str]] = set()
    if edges:
        for e in edges:
            if e.edge_type in (EdgeType.ridge, EdgeType.hip) and len(e.plane_ids) == 2:
                a, b = e.plane_ids
                ridge_partners.add((a, b))
                ridge_partners.add((b, a))

    # Find the dominant roof elevation from non-tree planes only.
    # Use MEDIAN height (not max) so one tall plane doesn't demote everything.
    valid_infos = [pi for pi in plane_infos if pi.index not in tree_planes]
    valid_heights = sorted([pi.plane.height_m for pi in valid_infos])
    if valid_heights:
        median_height = valid_heights[len(valid_heights) // 2]
    else:
        median_height = 0.0

    # Collect all non-tree pitches for the similarity guard
    all_roof_pitches = [pi.plane.pitch_deg for pi in valid_infos]

    for pi in plane_infos:
        plane = pi.plane
        # Never demote primary (anchor-containing) planes or tree planes
        if pi.is_primary or pi.index in tree_planes:
            continue

        neighbors = adjacency.get(plane.id, [])
        if not neighbors:
            continue

        # Only compare against roof-like neighbors that are NOT ridge partners
        # and NOT trees.  Pitch > 2° filters out flat canopy-like planes.
        neighbor_heights = []
        for nid in neighbors:
            if nid not in plane_map:
                continue
            np_ = plane_map[nid]
            # Skip tree-canopy planes
            nidx = next((pi2.index for pi2 in plane_infos if pi2.plane.id == nid), -1)
            if nidx in tree_planes:
                continue
            # Skip ridge partners — same gable structure
            if (plane.id, nid) in ridge_partners:
                continue
            if np_.pitch_deg > 2.0:
                neighbor_heights.append(np_.height_m)

        if not neighbor_heights:
            continue

        max_neighbor_elev = max(neighbor_heights)

        # Similarity guard: if this plane's height is within 2.5m of the
        # median roof height, it's part of the main structure — don't demote.
        # This prevents normal height variation (different wings, hip vs gable)
        # from being misclassified as step-downs.
        if abs(plane.height_m - median_height) < 2.5:
            continue

        # Also guard on pitch: if this plane's pitch matches any primary
        # plane pitch within 12°, it's likely the same structure level.
        ref_pitches = [pi2.plane.pitch_deg for pi2 in plane_infos if pi2.is_primary]
        if not ref_pitches:
            by_area = sorted(valid_infos, key=lambda x: x.plane.area_m2, reverse=True)
            ref_pitches = [x.plane.pitch_deg for x in by_area[:2]]
        if ref_pitches:
            pitch_similar = any(abs(plane.pitch_deg - pp) < 12.0 for pp in ref_pitches)
            if pitch_similar and plane.height_m > median_height - 4.0:
                continue  # similar pitch and not drastically lower

        # Must be significantly below the tallest non-partner neighbor.
        # Use 2.5m threshold — real step-downs (porches, additions) are
        # typically 2.5-5m below the main roof.
        height_below_neighbor = max_neighbor_elev - plane.height_m

        if height_below_neighbor > 2.5:
            mask = point_labels == pi.index
            downgrade = mask & ((labels == CellLabel.ROOF) | (labels == CellLabel.FLAT_ROOF))
            labels[downgrade] = CellLabel.LOWER_ROOF
            logger.debug(
                "Plane %s → LOWER_ROOF (below neighbor by %.1fm, median=%.1f)",
                plane.id, height_below_neighbor, median_height,
            )


def _classify_ridge_valley(
    labels: np.ndarray,
    pts: np.ndarray,
    planes: list[RoofPlane],
    edges: list[RoofEdge],
    distance_threshold: float,
) -> list[tuple[np.ndarray, np.ndarray]]:
    """
    Assign RIDGE_DOT and VALLEY_DOT from plane-plane intersections.

    For each ridge/valley edge, project nearby ROOF points onto the
    intersection line and label those within distance_threshold.
    """
    ridge_lines: list[tuple[np.ndarray, np.ndarray]] = []
    # Ridge band should be tight: ~1 grid cell width.  The RANSAC
    # distance_threshold is for plane inliers (much wider).  Use a fixed
    # narrow band so ridge dots form a clean line, not a broad smear.
    ridge_dist = 0.35  # ~35cm — roughly 1 cell at 0.25m or 0.5m resolution

    for edge in edges:
        if edge.edge_type not in (EdgeType.ridge, EdgeType.valley, EdgeType.hip):
            continue

        start = np.array([edge.start_point.x, edge.start_point.y, edge.start_point.z])
        end = np.array([edge.end_point.x, edge.end_point.y, edge.end_point.z])
        edge_vec = end - start
        edge_len = np.linalg.norm(edge_vec)
        if edge_len < 0.1:
            continue

        edge_dir = edge_vec / edge_len

        # Find points near this edge line
        # Vector from start to each point
        to_pts = pts - start
        # Project onto edge direction
        proj_along = to_pts @ edge_dir
        # Clamp to edge segment
        proj_along_clamped = np.clip(proj_along, 0, edge_len)
        # Closest point on edge segment
        closest = start + proj_along_clamped[:, np.newaxis] * edge_dir
        # Distance from each point to closest point on edge
        dist_to_edge = np.linalg.norm(pts - closest, axis=1)

        near_mask = dist_to_edge < ridge_dist
        # Only relabel ROOF / FLAT_ROOF / LOWER_ROOF points
        roof_mask = (
            (labels == CellLabel.ROOF)
            | (labels == CellLabel.FLAT_ROOF)
            | (labels == CellLabel.LOWER_ROOF)
        )
        candidates = near_mask & roof_mask

        if edge.edge_type == EdgeType.ridge:
            labels[candidates] = CellLabel.RIDGE_DOT
            ridge_lines.append((start, end))
        elif edge.edge_type == EdgeType.valley:
            labels[candidates] = CellLabel.VALLEY_DOT
        elif edge.edge_type == EdgeType.hip:
            # Hip edges are diagonal ridges — label as RIDGE_DOT
            labels[candidates] = CellLabel.RIDGE_DOT
            ridge_lines.append((start, end))

    # Promote ridge endpoints near ground to RIDGE_EDGE_DOT (gable ends)
    _promote_ridge_edge_dots(labels, pts, ridge_lines, distance_threshold)

    return ridge_lines


def _promote_ridge_edge_dots(
    labels: np.ndarray,
    pts: np.ndarray,
    ridge_lines: list[tuple[np.ndarray, np.ndarray]],
    distance_threshold: float,
) -> None:
    """
    At the endpoints of ridge lines, check if one perpendicular direction
    reaches GROUND within ~2m.  If so, promote to RIDGE_EDGE_DOT (gable end).
    """
    edge_look_m = 2.0

    for start, end in ridge_lines:
        for endpoint in [start, end]:
            # Find RIDGE_DOT points near this endpoint
            dist_to_ep = np.linalg.norm(pts - endpoint, axis=1)
            near = (dist_to_ep < distance_threshold * 2) & (labels == CellLabel.RIDGE_DOT)
            if not near.any():
                continue

            # Ridge direction
            ridge_dir_xz = np.array([end[0] - start[0], end[2] - start[2]])
            rd_len = np.linalg.norm(ridge_dir_xz)
            if rd_len < 0.01:
                continue
            ridge_dir_xz /= rd_len

            # Check along ridge direction (outward from ridge) for ground
            step = ridge_dir_xz * 0.5  # 0.5m steps
            check_pt = np.array([endpoint[0], endpoint[2]])

            # Determine which direction is "outward" from the ridge center
            ridge_center_xz = np.array([(start[0] + end[0]) / 2, (start[2] + end[2]) / 2])
            outward = check_pt - ridge_center_xz
            if np.dot(outward, ridge_dir_xz) < 0:
                step = -step

            found_ground = False
            for s in range(1, int(edge_look_m / 0.5) + 1):
                probe = check_pt + step * s
                # Find nearest point to probe
                dists_xz = np.sqrt((pts[:, 0] - probe[0]) ** 2 + (pts[:, 2] - probe[1]) ** 2)
                closest_idx = np.argmin(dists_xz)
                if dists_xz[closest_idx] < 1.0 and labels[closest_idx] == CellLabel.GROUND:
                    found_ground = True
                    break

            if found_ground:
                labels[near] = CellLabel.RIDGE_EDGE_DOT


def _classify_eaves(
    labels: np.ndarray,
    pts: np.ndarray,
    point_labels: np.ndarray,
    planes: list[RoofPlane],
    thresholds: AdaptiveThresholds,
) -> None:
    """
    Mark plane boundary points as EAVE_DOT where the nearest
    non-plane neighbor is classified GROUND.
    """
    if not HAS_SCIPY_SPATIAL:
        return

    tree = cKDTree(pts[:, [0, 2]])  # XZ only for boundary detection
    search_radius = max(1.0, thresholds.nn_median_dist * 6)

    for pi, plane in enumerate(planes):
        plane_mask = point_labels == pi
        if not plane_mask.any():
            continue

        plane_indices = np.where(plane_mask)[0]
        plane_pts_xz = pts[plane_indices][:, [0, 2]]

        # Boundary points: plane points that have a non-plane neighbor nearby
        for idx in plane_indices:
            pt_xz = pts[idx, [0, 2]]
            nearby = tree.query_ball_point(pt_xz, r=search_radius)

            has_ground_neighbor = False
            has_non_plane_nearby = False
            for ni in nearby:
                if ni == idx:
                    continue
                if point_labels[ni] != pi:
                    has_non_plane_nearby = True
                    if labels[ni] == CellLabel.GROUND:
                        has_ground_neighbor = True
                        break

            if has_ground_neighbor and labels[idx] in (CellLabel.ROOF, CellLabel.FLAT_ROOF, CellLabel.LOWER_ROOF):
                labels[idx] = CellLabel.EAVE_DOT


def _classify_step_edges(
    labels: np.ndarray,
    pts: np.ndarray,
    planes: list[RoofPlane],
    edges: list[RoofEdge],
    distance_threshold: float,
) -> None:
    """Mark points at ROOF → LOWER_ROOF transitions as STEP_EDGE."""
    for edge in edges:
        if edge.edge_type != EdgeType.step_flash:
            continue

        start = np.array([edge.start_point.x, edge.start_point.y, edge.start_point.z])
        end = np.array([edge.end_point.x, edge.end_point.y, edge.end_point.z])
        edge_vec = end - start
        edge_len = np.linalg.norm(edge_vec)
        if edge_len < 0.1:
            continue
        edge_dir = edge_vec / edge_len

        to_pts = pts - start
        proj_along = to_pts @ edge_dir
        proj_clamped = np.clip(proj_along, 0, edge_len)
        closest = start + proj_clamped[:, np.newaxis] * edge_dir
        dist_to_edge = np.linalg.norm(pts - closest, axis=1)

        near_mask = dist_to_edge < distance_threshold * 1.5
        # Label points that are ROOF or LOWER_ROOF near this step edge
        eligible = near_mask & (
            (labels == CellLabel.ROOF)
            | (labels == CellLabel.LOWER_ROOF)
            | (labels == CellLabel.FLAT_ROOF)
        )
        labels[eligible] = CellLabel.STEP_EDGE


def _classify_ground(
    labels: np.ndarray,
    pts: np.ndarray,
    point_labels: np.ndarray,
    thresholds: AdaptiveThresholds,
) -> None:
    """Classify unassigned low points as GROUND."""
    unassigned = point_labels == -1
    low = pts[:, 1] < thresholds.height_ground_threshold
    ground_mask = unassigned & low & (labels == CellLabel.UNSURE)
    labels[ground_mask] = CellLabel.GROUND


def _classify_trees(
    labels: np.ndarray,
    pts: np.ndarray,
    point_labels: np.ndarray,
    features: PointFeatures,
    thresholds: AdaptiveThresholds,
) -> None:
    """
    Classify unassigned elevated points with high curvature and
    inconsistent normals as TREE.
    """
    unassigned = point_labels == -1
    elevated = pts[:, 1] > max(1.0, thresholds.height_ground_threshold)
    high_curvature = features.curvature > thresholds.curvature_tree_threshold
    high_hstd = features.height_std > 0.3  # bumpy surface = tree
    still_unsure = labels == CellLabel.UNSURE

    # Tree condition: unassigned + elevated + (high curvature OR high height_std)
    tree_mask = unassigned & elevated & (high_curvature | high_hstd) & still_unsure

    # Also check normal consistency for borderline cases:
    # compute angular deviation of normals in local neighborhood
    if HAS_SCIPY_SPATIAL and tree_mask.any():
        _refine_tree_by_normal_consistency(
            labels, pts, features, tree_mask, thresholds,
        )
    else:
        labels[tree_mask] = CellLabel.TREE


def _refine_tree_by_normal_consistency(
    labels: np.ndarray,
    pts: np.ndarray,
    features: PointFeatures,
    candidate_mask: np.ndarray,
    thresholds: AdaptiveThresholds,
) -> None:
    """
    Among tree candidates, confirm using normal consistency.
    Points with highly inconsistent neighbor normals (angular std > 30 deg)
    are trees. Others might be undetected roof edges.
    """
    candidate_indices = np.where(candidate_mask)[0]
    if len(candidate_indices) == 0:
        return

    tree = cKDTree(pts)
    radius = max(0.5, thresholds.nn_median_dist * 5)
    angle_threshold_rad = math.radians(30)

    for idx in candidate_indices:
        nearby = tree.query_ball_point(pts[idx], r=radius)
        if len(nearby) < 3:
            labels[idx] = CellLabel.TREE
            continue

        # Angular deviation of normals
        normals_nearby = features.normals[nearby]
        mean_normal = normals_nearby.mean(axis=0)
        mn_len = np.linalg.norm(mean_normal)
        if mn_len < 1e-6:
            labels[idx] = CellLabel.TREE
            continue

        mean_normal /= mn_len
        cos_angles = np.clip(normals_nearby @ mean_normal, -1, 1)
        angles = np.arccos(cos_angles)
        angular_std = float(np.std(angles))

        if angular_std > angle_threshold_rad:
            labels[idx] = CellLabel.TREE
        # else: leave as UNSURE — might be a roof edge or other feature


def _recover_attached_structures(
    labels: np.ndarray,
    pts: np.ndarray,
    point_labels: np.ndarray,
    planes: list[RoofPlane],
    features: PointFeatures,
    thresholds: AdaptiveThresholds,
) -> None:
    """
    Recover unassigned elevated points near existing roof planes.

    Attached structures (porches, garages, additions) share a wall/edge with
    the main house.  If RANSAC couldn't extract them as independent planes,
    their points end up as UNSURE.  We recover them by checking proximity
    to existing planes and local planarity.
    """
    if not HAS_SCIPY_SPATIAL:
        return

    # Candidates: UNSURE, elevated, low curvature (not tree)
    candidates = (
        (labels == CellLabel.UNSURE)
        & (pts[:, 1] > thresholds.height_ground_threshold)
        & (features.curvature < thresholds.curvature_tree_threshold)
    )
    cand_indices = np.where(candidates)[0]
    if len(cand_indices) < 3:
        return

    # Build KDTree on XZ for proximity checks
    cand_pts = pts[cand_indices]
    roof_plane_pts_xz = []
    roof_plane_heights = []
    for pi, plane in enumerate(planes):
        pmask = point_labels == pi
        if not pmask.any():
            continue
        ppts = pts[pmask]
        roof_plane_pts_xz.append(ppts[:, [0, 2]])
        roof_plane_heights.append(plane.height_m)

    if not roof_plane_pts_xz:
        return

    # Combine all roof points for proximity search.
    # Store the ACTUAL height of each roof point (not the plane peak)
    # so we compare against the local roof surface height.
    all_roof_xz = np.vstack(roof_plane_pts_xz)
    all_roof_pts_y = []
    for pi, plane in enumerate(planes):
        pmask = point_labels == pi
        if pmask.any():
            all_roof_pts_y.append(pts[pmask, 1])
    if not all_roof_pts_y:
        return
    all_roof_y = np.concatenate(all_roof_pts_y)
    roof_tree = cKDTree(all_roof_xz)

    # For each candidate, check if it's near a roof point
    cand_xz = cand_pts[:, [0, 2]]
    dists, nearest_idx = roof_tree.query(cand_xz)

    proximity_threshold = 2.0  # within 2m of a roof point

    recovered = 0
    for i, ci in enumerate(cand_indices):
        if dists[i] > proximity_threshold:
            continue

        # Compare against the actual height of the nearest roof point
        # (not the plane peak), so eave-level points aren't falsely demoted
        nearest_roof_y = all_roof_y[nearest_idx[i]]
        point_height = pts[ci, 1]
        height_diff = nearest_roof_y - point_height

        # If the point is significantly below the nearest roof surface → LOWER_ROOF
        # (this catches attached porches/garages that step down from the main roof)
        # If at similar height → ROOF (same level, just missed by RANSAC)
        if height_diff > 2.5:
            labels[ci] = CellLabel.LOWER_ROOF
            recovered += 1
        elif height_diff > -0.5:
            labels[ci] = CellLabel.ROOF
            recovered += 1

    if recovered > 0:
        logger.info("Recovered %d attached-structure points from UNSURE", recovered)


def _classify_obstructions(
    labels: np.ndarray,
    pts: np.ndarray,
    point_labels: np.ndarray,
    planes: list[RoofPlane],
    thresholds: AdaptiveThresholds,
) -> None:
    """
    Small unassigned clusters elevated above a roof plane = obstructions
    (chimneys, vents, skylights, HVAC units).
    """
    # Collect unassigned elevated points that are still UNSURE
    unassigned_unsure = (point_labels == -1) & (labels == CellLabel.UNSURE)
    elevated = pts[:, 1] > thresholds.height_ground_threshold
    candidates = unassigned_unsure & elevated
    candidate_indices = np.where(candidates)[0]

    if len(candidate_indices) < 3:
        return

    if not HAS_SCIPY_SPATIAL:
        return

    # Cluster the candidates
    cand_pts = pts[candidate_indices]
    cand_xz = cand_pts[:, [0, 2]]
    tree_xz = cKDTree(cand_xz)

    # Simple connected-component clustering
    radius = max(0.5, thresholds.nn_median_dist * 3)
    pairs = tree_xz.query_pairs(r=radius)
    parent = np.arange(len(cand_pts))

    def _find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in pairs:
        ra, rb = _find(a), _find(b)
        if ra != rb:
            parent[ra] = rb

    roots = np.array([_find(i) for i in range(len(cand_pts))])

    for root_id in np.unique(roots):
        cluster_local = np.where(roots == root_id)[0]

        # Footprint check: must be small (< 4m^2)
        cl_pts = cand_pts[cluster_local]
        cl_xz = cl_pts[:, [0, 2]]
        xz_range = cl_xz.max(axis=0) - cl_xz.min(axis=0)
        footprint = xz_range[0] * xz_range[1]
        if footprint > 4.0:
            continue

        # Must sit above a detected roof plane
        centroid_x = cl_pts[:, 0].mean()
        centroid_z = cl_pts[:, 2].mean()
        centroid_y = cl_pts[:, 1].mean()

        above_roof = False
        for plane in planes:
            eq = plane.plane_equation
            # Height of the plane at this XZ position
            if abs(eq.b) > 1e-10:
                plane_y = -(eq.a * centroid_x + eq.c * centroid_z + eq.d) / eq.b
            else:
                continue

            # Check if XZ centroid is within plane boundary (rough check)
            verts = np.array([[v.x, v.z] for v in plane.vertices])
            if _point_in_polygon_2d(centroid_x, centroid_z, verts):
                if centroid_y > plane_y + 0.3:
                    above_roof = True
                    break

        if above_roof:
            orig_indices = candidate_indices[cluster_local]
            labels[orig_indices] = CellLabel.OBSTRUCTION_DOT


# ---------------------------------------------------------------------------
# 5. Ridge Line from Plane Intersections
# ---------------------------------------------------------------------------

def compute_ridge_from_planes(
    planes: list[RoofPlane],
    edges: list[RoofEdge],
) -> tuple | None:
    """
    Compute the primary ridge line from plane-plane intersection edges.

    Returns
    -------
    ridge_world : tuple or None
        ((x0, z0), (x1, z1), azimuth_deg, pitch_deg, length_m, peak_height_m)
        Same format as gradient_detector's ridge_world output.
    """
    # Collect ridge edges
    ridge_edges = [e for e in edges if e.edge_type == EdgeType.ridge]
    if not ridge_edges:
        return None

    # Find the longest ridge edge (or connected chain)
    # For now: pick the longest individual edge, then try to extend
    # by chaining adjacent ridge edges endpoint-to-endpoint.
    ridge_edges.sort(key=lambda e: e.length_m, reverse=True)

    # Build a chain starting from the longest edge
    chain_start = np.array([ridge_edges[0].start_point.x, ridge_edges[0].start_point.y, ridge_edges[0].start_point.z])
    chain_end = np.array([ridge_edges[0].end_point.x, ridge_edges[0].end_point.y, ridge_edges[0].end_point.z])
    used = {0}
    chain_length = ridge_edges[0].length_m

    # Greedily extend the chain
    changed = True
    while changed:
        changed = False
        for i, e in enumerate(ridge_edges):
            if i in used:
                continue
            ep_start = np.array([e.start_point.x, e.start_point.y, e.start_point.z])
            ep_end = np.array([e.end_point.x, e.end_point.y, e.end_point.z])
            snap_dist = 0.5  # within 50cm = same intersection point

            if np.linalg.norm(ep_start - chain_end) < snap_dist:
                chain_end = ep_end
                chain_length += e.length_m
                used.add(i)
                changed = True
            elif np.linalg.norm(ep_end - chain_end) < snap_dist:
                chain_end = ep_start
                chain_length += e.length_m
                used.add(i)
                changed = True
            elif np.linalg.norm(ep_start - chain_start) < snap_dist:
                chain_start = ep_end
                chain_length += e.length_m
                used.add(i)
                changed = True
            elif np.linalg.norm(ep_end - chain_start) < snap_dist:
                chain_start = ep_start
                chain_length += e.length_m
                used.add(i)
                changed = True

    # Compute ridge properties
    dx = chain_end[0] - chain_start[0]
    dz = chain_end[2] - chain_start[2]
    azimuth_deg = float(math.degrees(math.atan2(dx, dz))) % 360.0
    peak_height = max(chain_start[1], chain_end[1])

    # Pitch: angle of the ridge line from horizontal
    horizontal_len = math.sqrt(dx ** 2 + dz ** 2)
    dy = chain_end[1] - chain_start[1]
    pitch_deg = float(math.degrees(math.atan2(abs(dy), horizontal_len))) if horizontal_len > 0.01 else 0.0

    start_2d = (float(chain_start[0]), float(chain_start[2]))
    end_2d = (float(chain_end[0]), float(chain_end[2]))

    return (start_2d, end_2d, azimuth_deg, pitch_deg, chain_length, float(peak_height))


# ---------------------------------------------------------------------------
# 6. Grid Projection
# ---------------------------------------------------------------------------

def project_to_grid(
    point_cloud: np.ndarray,
    per_point_class: np.ndarray,
    height_grid: np.ndarray,
    resolution: float,
    x_origin: float,
    z_origin: float,
) -> np.ndarray:
    """
    Project per-point classifications onto the 2D height grid.

    For each grid cell, assigns the majority-vote label of the points
    falling within that cell.  Empty cells are filled from neighbors.

    Returns
    -------
    cell_labels : np.ndarray shape (rows, cols) of CellLabel ints
    """
    rows, cols = height_grid.shape
    cell_labels = np.full((rows, cols), CellLabel.UNSURE, dtype=int)

    pts = np.asarray(point_cloud)
    N = len(pts)

    # Map points to grid cells — must match build_height_grid's mapping (floor, not round)
    grid_cols = ((pts[:, 0] - x_origin) / resolution).astype(int)
    grid_rows = ((pts[:, 2] - z_origin) / resolution).astype(int)
    grid_cols = np.clip(grid_cols, 0, cols - 1)
    grid_rows = np.clip(grid_rows, 0, rows - 1)

    # Accumulate votes per cell, then majority-vote
    cell_votes: dict[tuple[int, int], list[int]] = {}

    for i in range(N):
        r, c = int(grid_rows[i]), int(grid_cols[i])
        if 0 <= r < rows and 0 <= c < cols:
            key = (r, c)
            if key not in cell_votes:
                cell_votes[key] = []
            cell_votes[key].append(int(per_point_class[i]))

    # Assign majority vote
    for (r, c), votes in cell_votes.items():
        if not votes:
            continue
        counter = Counter(votes)
        # Priority tiers for voting (higher tier wins regardless of count):
        #   Tier 3: structural edge labels (ridge, valley, eave, step)
        #   Tier 2: plane-based labels (ROOF, FLAT_ROOF, LOWER_ROOF)
        #   Tier 1: everything else (TREE, GROUND, UNSURE)
        # This prevents TREE from bleeding onto plane-confirmed ROOF cells
        # at the tree-roof boundary where points are mixed.
        def _tier(lbl):
            if lbl in (CellLabel.RIDGE_DOT, CellLabel.RIDGE_EDGE_DOT,
                       CellLabel.VALLEY_DOT, CellLabel.EAVE_DOT,
                       CellLabel.STEP_EDGE, CellLabel.OBSTRUCTION_DOT):
                return 3
            if lbl in (CellLabel.ROOF, CellLabel.FLAT_ROOF, CellLabel.LOWER_ROOF):
                return 2
            return 1

        best_label = CellLabel.UNSURE
        best_count = 0
        best_tier = 0
        for lbl, cnt in counter.items():
            if lbl == CellLabel.UNSURE:
                continue
            t = _tier(lbl)
            if t > best_tier or (t == best_tier and cnt > best_count):
                best_label = lbl
                best_count = cnt
                best_tier = t
        if best_count > 0:
            cell_labels[r, c] = best_label

    # Fill empty cells where height data exists — use nearest-neighbor from classified cells
    _fill_empty_cells(cell_labels, height_grid)

    return cell_labels


def _fill_empty_cells(
    cell_labels: np.ndarray,
    height_grid: np.ndarray,
    max_radius: int = 3,
) -> None:
    """
    Fill UNSURE cells that have height data using nearest classified neighbor.
    Only fills cells within max_radius of a classified cell.
    """
    rows, cols = cell_labels.shape
    has_height = ~np.isnan(height_grid)
    needs_fill = (cell_labels == CellLabel.UNSURE) & has_height

    if not needs_fill.any():
        return

    # Iterative dilation: expand classified cells outward
    for _ in range(max_radius):
        fill_mask = needs_fill.copy()
        if not fill_mask.any():
            break

        new_labels = cell_labels.copy()
        filled_any = False

        for r in range(rows):
            for c in range(cols):
                if not fill_mask[r, c]:
                    continue
                # Check 8-neighbors
                neighbor_labels = []
                for dr in (-1, 0, 1):
                    for dc in (-1, 0, 1):
                        if dr == 0 and dc == 0:
                            continue
                        nr, nc = r + dr, c + dc
                        if 0 <= nr < rows and 0 <= nc < cols:
                            nl = cell_labels[nr, nc]
                            if nl != CellLabel.UNSURE:
                                neighbor_labels.append(nl)
                if neighbor_labels:
                    # Majority vote, but plane-based labels (ROOF etc.) win
                    # over TREE to prevent tree bleed during fill expansion.
                    counter = Counter(neighbor_labels)
                    _ROOF_LABELS = {CellLabel.ROOF, CellLabel.FLAT_ROOF,
                                    CellLabel.LOWER_ROOF, CellLabel.RIDGE_DOT,
                                    CellLabel.EAVE_DOT, CellLabel.RIDGE_EDGE_DOT}
                    roof_votes = sum(cnt for lbl, cnt in counter.items() if lbl in _ROOF_LABELS)
                    tree_votes = counter.get(CellLabel.TREE, 0)
                    if roof_votes > 0 and tree_votes > 0:
                        # Mixed boundary — prefer roof
                        best = max((lbl for lbl in counter if lbl in _ROOF_LABELS),
                                   key=lambda l: counter[l], default=None)
                        new_labels[r, c] = best if best is not None else counter.most_common(1)[0][0]
                    else:
                        new_labels[r, c] = counter.most_common(1)[0][0]
                    filled_any = True

        cell_labels[:] = new_labels
        needs_fill = (cell_labels == CellLabel.UNSURE) & has_height
        if not filled_any:
            break


# ---------------------------------------------------------------------------
# Geometry Helpers
# ---------------------------------------------------------------------------

def _point_in_polygon_2d(px: float, pz: float, verts: np.ndarray) -> bool:
    """Ray-casting point-in-polygon test on the XZ plane."""
    n = len(verts)
    if n < 3:
        return False
    inside = False
    j = n - 1
    for i in range(n):
        xi, zi = verts[i]
        xj, zj = verts[j]
        if ((zi > pz) != (zj > pz)) and (px < (xj - xi) * (pz - zi) / (zj - zi + 1e-15) + xi):
            inside = not inside
        j = i
    return inside
