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
from pipeline.tree_detector import detect_and_exclude_trees, TreeExclusionResult, compute_roof_veto_score, _ROOF_VETO_THRESHOLD, apply_hard_tree_rules, RoofTraceResult
from pipeline.tree_detector_v2 import trace_ridge_from_anchors


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
    vertical_compactness: np.ndarray  # (N,) — Y range / XY radius in KNN neighborhood


@dataclass
class AdaptiveThresholds:
    """Data-driven thresholds replacing all fixed constants."""
    distance_threshold: float      # RANSAC inlier distance
    roughness_threshold: float     # max RMS residual for a valid roof plane
    curvature_tree_threshold: float  # curvature above this = tree canopy
    height_ground_threshold: float   # points below this = ground
    nn_median_dist: float          # median nearest-neighbor distance
    compactness_tree_threshold: float = 2.0  # vertical_compactness above this = tree


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
    tree_exclusion: TreeExclusionResult | None = None  # tree diagnostics
    tree_plane_ids: set[str] = field(default_factory=set)  # plane IDs classified as TREE
    sweep_labels: np.ndarray | None = None  # (N,) per-point labels from sweep tracer


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
    vertical_compactness = np.zeros(N)

    for i in range(N):
        [_, idx, _] = tree.search_knn_vector_3d(pts[i], k)
        idx = list(idx)
        if len(idx) < 3:
            continue
        local_density[i] = len(idx)
        neighbors = pts[idx]
        height_std[i] = float(np.std(neighbors[:, 1]))
        # Vertical compactness: Y range / XY radius — high for trees (tall, narrow)
        y_range = float(neighbors[:, 1].max() - neighbors[:, 1].min())
        xz = neighbors[:, [0, 2]]
        xz_radius = float(np.linalg.norm(xz - xz.mean(axis=0), axis=1).max())
        vertical_compactness[i] = y_range / max(xz_radius, 0.01)
        centered = neighbors - neighbors.mean(axis=0)
        cov = centered.T @ centered / len(neighbors)
        try:
            eigvals = np.linalg.eigvalsh(cov)
            eigvals = np.maximum(eigvals, 0)
            total = eigvals.sum()
            curvature[i] = eigvals[0] / total if total > 1e-12 else 0.0
        except np.linalg.LinAlgError:
            pass

    return PointFeatures(normals=normals, curvature=curvature, local_density=local_density, height_std=height_std, vertical_compactness=vertical_compactness)


def _compute_features_numpy(pts: np.ndarray, k: int) -> PointFeatures:
    """Numpy/scipy fallback for normal + curvature estimation."""
    N = len(pts)
    normals = np.zeros((N, 3))
    curvature = np.zeros(N)
    local_density = np.zeros(N, dtype=int)
    height_std = np.zeros(N)
    vertical_compactness = np.zeros(N)

    if not HAS_SCIPY_SPATIAL:
        logger.warning("scipy.spatial not available — returning zero features")
        normals[:, 1] = 1.0  # default: pointing up
        return PointFeatures(normals=normals, curvature=curvature, local_density=local_density, height_std=height_std, vertical_compactness=vertical_compactness)

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
        # Vertical compactness: Y range / XY radius — high for trees (tall, narrow)
        y_range = float(neighbors[:, 1].max() - neighbors[:, 1].min())
        xz = neighbors[:, [0, 2]]
        xz_radius = float(np.linalg.norm(xz - xz.mean(axis=0), axis=1).max())
        vertical_compactness[i] = y_range / max(xz_radius, 0.01)
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

    return PointFeatures(normals=normals, curvature=curvature, local_density=local_density, height_std=height_std, vertical_compactness=vertical_compactness)


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

    # Vertical compactness: roof slopes are gradual (low ratio), trees are tall
    # and narrow (high ratio). Use the 90th percentile of roof-like points as
    # baseline and set threshold above it.
    vc = features.vertical_compactness
    vc_valid = vc[vc > 0]
    if len(vc_valid) > 10:
        # The lower 80% are likely roof/ground — use their 90th pctl as baseline
        sorted_vc = np.sort(vc_valid)
        n_roof = max(1, int(len(sorted_vc) * 0.8))
        vc_roof_p90 = float(sorted_vc[min(n_roof, len(sorted_vc) - 1)])
        compactness_tree_threshold = max(2.0, vc_roof_p90 * 2.0)
    else:
        compactness_tree_threshold = 2.0

    logger.info(
        "Adaptive thresholds — dist=%.3f rough=%.3f curv_tree=%.3f height_gnd=%.2f nn_med=%.3f compact_tree=%.2f",
        distance_threshold, roughness_threshold, curvature_tree_threshold,
        height_ground_threshold, nn_median, compactness_tree_threshold,
    )

    return AdaptiveThresholds(
        distance_threshold=distance_threshold,
        roughness_threshold=roughness_threshold,
        curvature_tree_threshold=curvature_tree_threshold,
        height_ground_threshold=height_ground_threshold,
        nn_median_dist=nn_median,
        compactness_tree_threshold=compactness_tree_threshold,
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
    components: list[list[str]] | None = None,
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

    # ---- TRACE RIDGE FROM CALIBRATION DOTS ----
    # Walk uphill from each anchor dot to find the ridge, then trace
    # downslope on the other side. Detects tree intrusions where height
    # suddenly increases after consistent descent.
    roof_trace = trace_ridge_from_anchors(
        pts, anchor_dots or [], point_labels,
    )

    # ---- TREE EXCLUSION — ALL DISABLED ----
    # All tree detection rules disabled. Only the tracer runs for diagnostics.
    # Pattern learning, hard tree rules, flood fill — all off.
    tree_mask = np.zeros(len(pts), dtype=bool)
    tree_plane_indices: set[int] = set()
    logger.info(
        "All tree exclusion DISABLED — tracer ran for diagnostics: "
        "ridge=%.1fm, base=%.1fm, slope=%.2f, %d intrusions",
        roof_trace.ridge_height, roof_trace.base_height,
        roof_trace.roof_slope, len(roof_trace.tree_intrusion_indices),
    )

    # ---- ALL CLASSIFICATION STEPS DISABLED ----
    # Steps 1-8 all disabled. Too many interacting rules breaking colors.
    # Only the calibration tracer (above) runs for diagnostics.
    # All points stay as UNSURE — no color assignments from classifier.
    ridge_lines: list[tuple[np.ndarray, np.ndarray]] = []
    logger.info("All classification steps DISABLED — only tracer active, labels unchanged")

    # Collect tree plane IDs for downstream use
    _tree_plane_id_set = {
        pi.plane.id for pi in plane_infos if pi.index in tree_plane_indices
    }

    return ClassificationResult(
        per_point_class=labels,
        planes=planes,
        ridge_lines=ridge_lines,
        plane_infos=plane_infos,
        tree_exclusion=None,
        tree_plane_ids=_tree_plane_id_set,
        sweep_labels=roof_trace.sweep_labels if roof_trace.sweep_labels is not None else None,
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
    components: list[list[str]] | None = None,
) -> None:
    """
    Mark ROOF points on planes significantly below their neighbors as LOWER_ROOF.

    Uses per-connected-component logic:
      - Median height is computed per component, not globally
      - The largest valid plane in each component is protected from demotion
      - Only structurally valid planes (non-tree, low residual) set height baselines
    """
    plane_map = {p.id: p for p in planes}
    tree_planes = tree_plane_indices or set()
    info_by_id: dict[str, PlaneInfo] = {pi.plane.id: pi for pi in plane_infos}

    # Ridge partners: opposite faces of the same gable/hip — never demote relative to each other
    ridge_partners: set[tuple[str, str]] = set()
    if edges:
        for e in edges:
            if e.edge_type in (EdgeType.ridge, EdgeType.hip) and len(e.plane_ids) == 2:
                a, b = e.plane_ids
                ridge_partners.add((a, b))
                ridge_partners.add((b, a))

    # Compute connected components if not provided (inline BFS fallback)
    # Tree planes are excluded from the walk — they must not bridge components
    tree_plane_ids = {
        pi.plane.id for pi in plane_infos if pi.index in tree_planes
    }
    if components is None:
        visited: set[str] = set()
        components = []
        for p in planes:
            if p.id in visited or p.id in tree_plane_ids:
                continue
            comp: list[str] = []
            queue = [p.id]
            while queue:
                pid = queue.pop(0)
                if pid in visited or pid in tree_plane_ids:
                    continue
                visited.add(pid)
                comp.append(pid)
                for nb in adjacency.get(pid, []):
                    if nb not in visited and nb not in tree_plane_ids:
                        queue.append(nb)
            components.append(comp)

    # Determine valid reference planes: non-tree, low residual, has ROOF points
    non_tree_infos = [pi for pi in plane_infos if pi.index not in tree_planes]
    residuals = sorted([pi.residual for pi in non_tree_infos]) if non_tree_infos else [1.0]
    median_residual = residuals[len(residuals) // 2]
    max_valid_residual = median_residual * 2.0

    valid_plane_ids: set[str] = set()
    for pi in non_tree_infos:
        if pi.residual <= max_valid_residual:
            mask = point_labels == pi.index
            if mask.any():
                pt_labels = labels[mask]
                if np.any((pt_labels == CellLabel.ROOF) | (pt_labels == CellLabel.FLAT_ROOF)):
                    valid_plane_ids.add(pi.plane.id)

    # Process each connected component independently
    for comp_ids in components:
        # Valid planes in this component
        comp_valid = [
            info_by_id[pid] for pid in comp_ids
            if pid in valid_plane_ids and pid in info_by_id
        ]
        if not comp_valid:
            continue

        # Per-component median height
        comp_heights = sorted([pi.plane.height_m for pi in comp_valid])
        comp_median_height = comp_heights[len(comp_heights) // 2]

        # Per-component dominant plane = largest area → protected from demotion
        dominant = max(comp_valid, key=lambda pi: pi.plane.area_m2)
        dominant_id = dominant.plane.id

        # Guard: cap median at dominant plane height + 3m to prevent tree
        # canopy planes from inflating the component baseline
        comp_median_height = min(comp_median_height, dominant.plane.height_m + 3.0)

        # Reference pitches: from primary planes in this component, or dominant
        comp_primary = [
            info_by_id[cid] for cid in comp_ids
            if cid in info_by_id and info_by_id[cid].is_primary
        ]
        ref_pitches = [p.plane.pitch_deg for p in comp_primary] if comp_primary else [dominant.plane.pitch_deg]

        for pid in comp_ids:
            if pid not in info_by_id:
                continue
            pi = info_by_id[pid]
            plane = pi.plane

            # Never demote: dominant plane, primary planes, tree planes, invalid planes
            if pid == dominant_id or pi.is_primary or pi.index in tree_planes:
                continue
            if pid not in valid_plane_ids:
                continue

            # Neighbor heights from valid planes only
            neighbors = adjacency.get(pid, [])
            neighbor_heights = []
            for nid in neighbors:
                if nid not in plane_map or nid not in valid_plane_ids:
                    continue
                if (pid, nid) in ridge_partners:
                    continue
                np_ = plane_map[nid]
                # Skip anomalously high planes (likely surviving tree canopy)
                if np_.height_m > dominant.plane.height_m + 4.0:
                    continue
                if np_.pitch_deg > 2.0:
                    neighbor_heights.append(np_.height_m)

            if not neighbor_heights:
                continue
            max_neighbor_elev = max(neighbor_heights)

            # Similarity guard: within 2.5m of component median → main structure
            if abs(plane.height_m - comp_median_height) < 2.5:
                continue

            # Pitch guard: similar pitch to primary/dominant + not drastically lower
            pitch_similar = any(abs(plane.pitch_deg - pp) < 12.0 for pp in ref_pitches)
            if pitch_similar and plane.height_m > comp_median_height - 4.0:
                continue

            # Must be significantly below tallest valid neighbor
            height_below_neighbor = max_neighbor_elev - plane.height_m
            if height_below_neighbor > 2.5:
                mask = point_labels == pi.index
                downgrade = mask & ((labels == CellLabel.ROOF) | (labels == CellLabel.FLAT_ROOF))
                labels[downgrade] = CellLabel.LOWER_ROOF
                logger.debug(
                    "Plane %s → LOWER_ROOF (comp dominant=%s, below neighbor by %.1fm, "
                    "comp_median=%.1f)",
                    plane.id, dominant_id, height_below_neighbor, comp_median_height,
                )


def _classify_ridge_valley(
    labels: np.ndarray,
    pts: np.ndarray,
    planes: list[RoofPlane],
    edges: list[RoofEdge],
    distance_threshold: float,
    point_labels: np.ndarray | None = None,
    tree_plane_indices: set[int] | None = None,
) -> list[tuple[np.ndarray, np.ndarray]]:
    """
    Assign RIDGE_DOT, NEAR_RIDGE, and VALLEY_DOT from plane-plane intersections.

    Ridge classification rules:
      1. RIDGE_DOT requires a valid plane-plane intersection (two distinct planes,
         normal angle > 10°, convex edge). These checks are enforced upstream in
         graph_builder._classify_single_edge().
      2. A point can only be RIDGE_DOT if within 0.15m of the intersection line.
      3. NEAR_RIDGE: points 0.15m-0.30m from a valid ridge line.
      4. Single-plane guard: ridge candidates must have points from ≥2 planes nearby.
      5. Linearity enforcement: outliers > 0.20m from a fitted ridge line are demoted.
      6. Tree-edge filter: edges touching tree-classified planes are skipped.
    """
    ridge_lines: list[tuple[np.ndarray, np.ndarray]] = []
    ridge_dist = 0.15       # tight band — only points right on the intersection
    near_ridge_dist = 0.30  # outer limit for NEAR_RIDGE

    # Build set of tree plane IDs to filter edges
    tree_ids: set[str] = set()
    if tree_plane_indices:
        tree_ids = {planes[i].id for i in tree_plane_indices if i < len(planes)}

    # Build XZ KDTree once for single-plane guard
    xz_tree = None
    if HAS_SCIPY_SPATIAL and point_labels is not None:
        xz_tree = cKDTree(pts[:, [0, 2]])

    # Map plane IDs to indices for the single-plane guard
    plane_id_to_idx: dict[str, int] = {}
    for i, p in enumerate(planes):
        plane_id_to_idx[p.id] = i

    for edge in edges:
        if edge.edge_type not in (EdgeType.ridge, EdgeType.valley, EdgeType.hip):
            continue
        # Skip edges that touch a tree-classified plane
        if tree_ids and any(pid in tree_ids for pid in edge.plane_ids):
            continue

        start = np.array([edge.start_point.x, edge.start_point.y, edge.start_point.z])
        end = np.array([edge.end_point.x, edge.end_point.y, edge.end_point.z])
        edge_vec = end - start
        edge_len = np.linalg.norm(edge_vec)
        if edge_len < 0.1:
            continue

        edge_dir = edge_vec / edge_len

        # Project all points onto the edge line segment
        to_pts = pts - start
        proj_along = to_pts @ edge_dir
        proj_along_clamped = np.clip(proj_along, 0, edge_len)
        closest = start + proj_along_clamped[:, np.newaxis] * edge_dir
        dist_to_edge = np.linalg.norm(pts - closest, axis=1)

        # Only relabel ROOF / FLAT_ROOF / LOWER_ROOF points
        roof_mask = (
            (labels == CellLabel.ROOF)
            | (labels == CellLabel.FLAT_ROOF)
            | (labels == CellLabel.LOWER_ROOF)
        )

        if edge.edge_type == EdgeType.valley:
            valley_candidates = (dist_to_edge < ridge_dist) & roof_mask
            labels[valley_candidates] = CellLabel.VALLEY_DOT
            continue

        # Ridge or hip — apply strict rules
        ridge_candidates = (dist_to_edge < ridge_dist) & roof_mask
        near_ridge_candidates = (
            (dist_to_edge >= ridge_dist)
            & (dist_to_edge < near_ridge_dist)
            & roof_mask
        )

        # Single-plane guard: require points from ≥2 distinct planes nearby
        if xz_tree is not None and point_labels is not None and len(edge.plane_ids) == 2:
            for candidates_mask in [ridge_candidates, near_ridge_candidates]:
                candidate_indices = np.where(candidates_mask)[0]
                for idx in candidate_indices:
                    nearby = xz_tree.query_ball_point(pts[idx, [0, 2]], r=0.5)
                    nearby_planes = set(point_labels[nearby]) - {-1}
                    if len(nearby_planes) < 2:
                        candidates_mask[idx] = False

        labels[ridge_candidates] = CellLabel.RIDGE_DOT
        labels[near_ridge_candidates] = CellLabel.NEAR_RIDGE
        ridge_lines.append((start, end))

    # Linearity enforcement: fit line per ridge segment, reject outliers
    ridge_lines = _enforce_ridge_linearity(labels, pts, ridge_lines)

    # Promote ridge endpoints near ground to RIDGE_EDGE_DOT (gable ends)
    _promote_ridge_edge_dots(labels, pts, ridge_lines, distance_threshold)

    return ridge_lines


def _enforce_ridge_linearity(
    labels: np.ndarray,
    pts: np.ndarray,
    ridge_lines: list[tuple[np.ndarray, np.ndarray]],
    max_deviation_m: float = 0.20,
) -> list[tuple[np.ndarray, np.ndarray]]:
    """
    For each ridge line, fit a line to its RIDGE_DOT points, reject outliers
    further than max_deviation_m from the fitted line, and recompute endpoints.
    """
    refined_lines: list[tuple[np.ndarray, np.ndarray]] = []
    ridge_mask = labels == CellLabel.RIDGE_DOT

    for start, end in ridge_lines:
        edge_vec = end - start
        edge_len = np.linalg.norm(edge_vec)
        if edge_len < 0.1:
            continue
        edge_dir = edge_vec / edge_len

        # Find RIDGE_DOT points near this edge
        to_pts = pts - start
        proj = to_pts @ edge_dir
        closest = start + np.clip(proj, 0, edge_len)[:, np.newaxis] * edge_dir
        dist = np.linalg.norm(pts - closest, axis=1)
        on_this_edge = ridge_mask & (dist < 0.30)

        edge_pt_indices = np.where(on_this_edge)[0]
        if len(edge_pt_indices) < 3:
            refined_lines.append((start, end))
            continue

        edge_pts = pts[edge_pt_indices]

        # PCA fit
        centroid = edge_pts.mean(axis=0)
        centered = edge_pts - centroid
        _, _, Vt = np.linalg.svd(centered, full_matrices=False)
        line_dir = Vt[0]

        # Perpendicular distance from fitted line
        perp = centered - (centered @ line_dir)[:, np.newaxis] * line_dir
        perp_dist = np.linalg.norm(perp, axis=1)

        # Reject outliers — demote back to ROOF
        outlier_local = perp_dist > max_deviation_m
        outlier_indices = edge_pt_indices[outlier_local]
        labels[outlier_indices] = CellLabel.ROOF

        # Recompute endpoints from inliers
        inlier_pts = edge_pts[~outlier_local]
        if len(inlier_pts) >= 2:
            projs = (inlier_pts - centroid) @ line_dir
            new_start = centroid + line_dir * projs.min()
            new_end = centroid + line_dir * projs.max()
            refined_lines.append((new_start, new_end))
        else:
            refined_lines.append((start, end))

    return refined_lines


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


def _compute_normal_variance_mask(
    pts: np.ndarray,
    features: PointFeatures,
    thresholds: AdaptiveThresholds,
) -> np.ndarray:
    """
    Return boolean mask where True = high normal variance in the local
    neighborhood (angular std of normals > 30°). Points with chaotic
    normals cannot be explained by a single plane orientation.
    """
    N = len(pts)
    high_variance = np.ones(N, dtype=bool)  # default True if scipy unavailable

    if not HAS_SCIPY_SPATIAL:
        return high_variance

    kd = cKDTree(pts)
    radius = max(0.5, thresholds.nn_median_dist * 5)
    angle_threshold_rad = math.radians(30)

    for i in range(N):
        nearby = kd.query_ball_point(pts[i], r=radius)
        if len(nearby) < 3:
            # Too few neighbors to judge — assume high variance
            continue
        normals_nearby = features.normals[nearby]
        mean_normal = normals_nearby.mean(axis=0)
        mn_len = np.linalg.norm(mean_normal)
        if mn_len < 1e-6:
            continue  # degenerate — keep True
        mean_normal /= mn_len
        cos_angles = np.clip(normals_nearby @ mean_normal, -1, 1)
        angular_std = float(np.std(np.arccos(cos_angles)))
        high_variance[i] = angular_std > angle_threshold_rad

    return high_variance


def _classify_trees(
    labels: np.ndarray,
    pts: np.ndarray,
    point_labels: np.ndarray,
    features: PointFeatures,
    thresholds: AdaptiveThresholds,
) -> None:
    """
    Classify unassigned elevated points as TREE using three properties:
      1. Cannot be explained by a stable plane (high curvature or height_std)
      2. Exhibits high normal variance (angular std > 30° in neighborhood)
      3. Significant vertical spread within a small XY region (high compactness)
    All three must be present — this is an AND rule.
    """
    unassigned = point_labels == -1
    elevated = pts[:, 1] > max(1.0, thresholds.height_ground_threshold)
    still_unsure = labels == CellLabel.UNSURE

    # (1) Cannot be explained by a stable plane
    unstable_plane = (
        (features.curvature > thresholds.curvature_tree_threshold)
        | (features.height_std > 0.3)
    )

    # (3) Significant vertical spread in small XY region
    high_compactness = features.vertical_compactness > thresholds.compactness_tree_threshold

    # Pre-filter before the expensive normal variance computation
    candidate_mask = unassigned & elevated & unstable_plane & high_compactness & still_unsure

    if not candidate_mask.any():
        return

    # (2) High normal variance — only compute for candidates
    normal_var = _compute_normal_variance_mask(pts, features, thresholds)

    tree_mask = candidate_mask & normal_var
    labels[tree_mask] = CellLabel.TREE


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
    tree_mask: np.ndarray | None = None,
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

    # Build KDTree of tree points for proximity exclusion
    tree_kd = None
    if tree_mask is not None and tree_mask.any():
        tree_pts_xz = pts[tree_mask][:, [0, 2]]
        tree_kd = cKDTree(tree_pts_xz)

    # Cluster the candidates
    cand_pts = pts[candidate_indices]
    cand_xz = cand_pts[:, [0, 2]]
    cand_xz_tree = cKDTree(cand_xz)

    # Simple connected-component clustering
    radius = max(0.5, thresholds.nn_median_dist * 3)
    pairs = cand_xz_tree.query_pairs(r=radius)
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

        # Tree proximity guard: skip clusters near tree points
        if tree_kd is not None:
            dist_to_tree, _ = tree_kd.query([[centroid_x, centroid_z]])
            if dist_to_tree[0] < 2.0:
                continue  # likely scattered canopy debris

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
                # Height guard: too high above roof = tree, not obstruction
                if centroid_y > plane_y + 3.0:
                    continue
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
    tree_plane_ids: set[str] | None = None,
) -> tuple | None:
    """
    Compute the primary ridge line from plane-plane intersection edges.

    Returns
    -------
    ridge_world : tuple or None
        ((x0, z0), (x1, z1), azimuth_deg, pitch_deg, length_m, peak_height_m)
        Same format as gradient_detector's ridge_world output.
    """
    # Collect ridge edges, excluding edges that touch tree-classified planes
    _tree_ids = tree_plane_ids or set()
    ridge_edges = [
        e for e in edges
        if e.edge_type == EdgeType.ridge
        and not any(pid in _tree_ids for pid in e.plane_ids)
    ]
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
