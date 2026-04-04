"""
Hard tree exclusion detector with ROOF-FIRST veto.

A region must NOT be classified as TREE if it has strong roof-like structure.
TREE requires positive evidence from multiple signals; lack of certainty
defaults to UNSURE, never TREE.

Pipeline:
  1. Per-point tree scoring (7 signals, need >= 4 to be candidate)
  2. Spatial clustering of candidates
  3. Per-cluster roof_veto_score — blocks TREE if roof-like
  4. Per-cluster tree promotion — requires 3+ positive tree signals
  5. Safety rule for valid-plane adjacency
  6. Debug diagnostics for every cluster decision

Must run BEFORE plane scoring, LOWER_ROOF, and dominant-plane selection.
"""

from __future__ import annotations

import logging
import math
from collections import Counter
from dataclasses import dataclass, field

import numpy as np

try:
    from scipy.spatial import cKDTree, ConvexHull
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------

@dataclass
class ClusterMetrics:
    """Debug metrics for a single cluster decision."""
    n_points: int = 0
    area_m2: float = 0.0
    z_spread: float = 0.0
    tree_score: float = 0.0
    roof_veto_score: float = 0.0
    roundness: float = 0.0
    straight_edge_ratio: float = 0.0
    edge_direction_entropy: float = 0.0
    plane_residual: float = 0.0
    normal_angular_std_deg: float = 0.0
    plane_membership_frac: float = 0.0
    decision: str = ""  # "promoted" / "vetoed_roof" / "rejected_<reason>"


@dataclass
class TreeDiagnostics:
    """Debug output for tree detection."""
    tree_score_per_point: np.ndarray        # (N,) float — composite tree score
    tree_candidate_mask: np.ndarray         # (N,) bool — pre-clustering candidates
    tree_cluster_mask: np.ndarray           # (N,) bool — final promoted tree points
    n_candidates: int = 0
    n_clusters_promoted: int = 0
    n_clusters_rejected: int = 0
    n_points_excluded: int = 0
    trigger_counts: dict = field(default_factory=dict)
    cluster_metrics: list[ClusterMetrics] = field(default_factory=list)


@dataclass
class TreeExclusionResult:
    """Output of the tree exclusion pipeline."""
    tree_mask: np.ndarray          # (N,) bool — True = excluded as TREE
    diagnostics: TreeDiagnostics


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Per-point scoring
_MIN_SIGNALS_FOR_CANDIDATE = 4   # out of 7 signals

# Cluster promotion
_MIN_CLUSTER_AREA_M2 = 2.0
_MIN_CLUSTER_Z_SPREAD = 1.5
_MAX_PLANE_RESIDUAL = 0.40
_NORMAL_CHAOS_THRESHOLD_DEG = 31.0

# Roof veto thresholds
_ROOF_VETO_THRESHOLD = 3.0       # veto score >= this blocks TREE
_TREE_PROMOTE_SIGNALS = 3        # need >= 3 positive tree shape signals

# Obstruction guard
_MAX_OBSTRUCTION_AREA_M2 = 3.0
_MAX_OBSTRUCTION_PTS = 30

# Safety rule
_SAFETY_PLANE_PROXIMITY_M = 1.5


# ---------------------------------------------------------------------------
# 1. Per-point tree score (unchanged logic, tightened thresholds)
# ---------------------------------------------------------------------------

def compute_tree_scores(
    point_cloud: np.ndarray,
    normals: np.ndarray,
    curvature: np.ndarray,
    height_std: np.ndarray,
    vertical_compactness: np.ndarray,
    local_density: np.ndarray,
    plane_labels: np.ndarray,
    plane_residuals: dict[int, float],
    k_neighbors: int = 20,
) -> tuple[np.ndarray, np.ndarray, dict]:
    """
    Compute a multi-signal tree score per point (7 signals, need >= 4).
    """
    pts = np.asarray(point_cloud)
    N = len(pts)
    scores = np.zeros(N, dtype=np.float32)
    triggers = {
        'normal_variance': 0,
        'plane_residual': 0,
        'vertical_spread': 0,
        'curvature': 0,
        'height_dispersion': 0,
        'density_irregularity': 0,
        'volumetric': 0,
    }

    if N < 10 or not HAS_SCIPY:
        return scores, np.zeros(N, dtype=bool), triggers

    tree = cKDTree(pts)
    _, nn_indices = tree.query(pts, k=min(k_neighbors, N))

    # Adaptive thresholds from point cloud statistics
    curv_sorted = np.sort(curvature[curvature > 0]) if np.any(curvature > 0) else np.array([0.01])
    curv_noise = float(np.median(curv_sorted[:max(1, len(curv_sorted) // 5)]))
    curv_thresh = max(0.04, curv_noise * 4.0)

    hstd_sorted = np.sort(height_std[height_std > 0]) if np.any(height_std > 0) else np.array([0.1])
    hstd_baseline = float(np.median(hstd_sorted[:max(1, len(hstd_sorted) // 4)]))
    hstd_thresh = max(0.15, hstd_baseline * 3.0)

    density_median = float(np.median(local_density[local_density > 0])) if np.any(local_density > 0) else 10.0
    density_low_thresh = max(3, density_median * 0.3)

    heights = pts[:, 1]
    h_10 = float(np.percentile(heights, 10))
    h_range = float(np.percentile(heights, 90) - h_10)
    ground_cutoff = h_10 + 0.15 * h_range

    for i in range(N):
        if pts[i, 1] < ground_cutoff:
            continue

        idx = nn_indices[i]
        valid = idx[idx < N]
        if len(valid) < 5:
            continue
        neighbors = pts[valid]
        s = 0

        # A. Normal variance (>30° angular std)
        nbr_normals = normals[valid]
        mean_n = nbr_normals.mean(axis=0)
        mn_len = np.linalg.norm(mean_n)
        if mn_len > 1e-6:
            mean_n /= mn_len
            cos_a = np.clip(nbr_normals @ mean_n, -1, 1)
            angular_std = float(np.std(np.arccos(cos_a)))
            if angular_std > math.radians(30):
                s += 1
                triggers['normal_variance'] += 1

        # B. Plane fit residual
        pi = plane_labels[i]
        if pi == -1:
            s += 1
            triggers['plane_residual'] += 1
        elif pi in plane_residuals and plane_residuals[pi] > _MAX_PLANE_RESIDUAL:
            s += 1
            triggers['plane_residual'] += 1

        # C. Vertical spread (compactness > 2.0 AND y_range > 1.0m)
        y_range = float(neighbors[:, 1].max() - neighbors[:, 1].min())
        xz = neighbors[:, [0, 2]]
        xz_radius = float(np.linalg.norm(xz - xz.mean(axis=0), axis=1).max())
        vc_local = y_range / max(xz_radius, 0.01)
        if vc_local > 2.0 and y_range > 1.0:
            s += 1
            triggers['vertical_spread'] += 1

        # D. Curvature
        if curvature[i] > curv_thresh:
            s += 1
            triggers['curvature'] += 1

        # E. Height dispersion
        if height_std[i] > hstd_thresh:
            s += 1
            triggers['height_dispersion'] += 1

        # F. Density irregularity
        if local_density[i] < density_low_thresh:
            s += 1
            triggers['density_irregularity'] += 1

        # G. Volumetric thickness (ratio > 1.5 AND y_range > 0.8m)
        if xz_radius > 0.1:
            thickness_ratio = y_range / max(xz_radius, 0.1)
            if thickness_ratio > 1.5 and y_range > 0.8:
                s += 1
                triggers['volumetric'] += 1

        scores[i] = s

    candidate_mask = scores >= _MIN_SIGNALS_FOR_CANDIDATE
    return scores, candidate_mask, triggers


# ---------------------------------------------------------------------------
# 2. Roof veto score — computed per cluster
# ---------------------------------------------------------------------------

def _compute_boundary_xz(cl_xz: np.ndarray) -> np.ndarray:
    """Return convex hull boundary points in XZ. Falls back to all points."""
    if len(cl_xz) < 4:
        return cl_xz
    try:
        hull = ConvexHull(cl_xz)
        return cl_xz[hull.vertices]
    except Exception:
        return cl_xz


def _straight_edge_ratio(boundary: np.ndarray) -> float:
    """
    Fraction of boundary length that lies on approximately straight segments.
    High for roofs (rectangular), low for trees (blobby).
    """
    n = len(boundary)
    if n < 4:
        return 0.0

    total_len = 0.0
    straight_len = 0.0
    # Slide a window of 3 consecutive boundary points; if the middle point
    # is close to the line between the outer two, the segment is straight.
    for i in range(n):
        p0 = boundary[i]
        p1 = boundary[(i + 1) % n]
        p2 = boundary[(i + 2) % n]
        seg_len = float(np.linalg.norm(p1 - p0))
        total_len += seg_len
        # Distance of p1 from line p0-p2
        line_vec = p2 - p0
        line_len = float(np.linalg.norm(line_vec))
        if line_len < 0.01:
            continue
        line_dir = line_vec / line_len
        perp = p1 - p0 - np.dot(p1 - p0, line_dir) * line_dir
        deviation = float(np.linalg.norm(perp))
        if deviation < 0.15:  # within 15cm of straight line
            straight_len += seg_len

    return straight_len / max(total_len, 0.01)


def _boundary_roundness(boundary: np.ndarray) -> float:
    """
    Roundness = 4π·area / perimeter². Circle=1.0, rectangle~0.78, irregular<0.5.
    High roundness is tree-like; low is roof-like.
    """
    n = len(boundary)
    if n < 3:
        return 1.0
    # Shoelace area
    area = 0.0
    perimeter = 0.0
    for i in range(n):
        j = (i + 1) % n
        area += boundary[i, 0] * boundary[j, 1] - boundary[j, 0] * boundary[i, 1]
        perimeter += float(np.linalg.norm(boundary[j] - boundary[i]))
    area = abs(area) / 2.0
    if perimeter < 0.01:
        return 1.0
    return (4.0 * math.pi * area) / (perimeter * perimeter)


def _edge_direction_entropy(boundary: np.ndarray) -> float:
    """
    Entropy of boundary edge directions binned into 8 angular sectors.
    Low entropy = edges align to few directions (roof-like, rectangular).
    High entropy = edges point in many directions (tree-like, blobby).
    Returns value in [0, 1] normalized by max entropy (log2(8)).
    """
    n = len(boundary)
    if n < 3:
        return 1.0
    n_bins = 8
    bins = np.zeros(n_bins)
    for i in range(n):
        j = (i + 1) % n
        dx = boundary[j, 0] - boundary[i, 0]
        dz = boundary[j, 1] - boundary[i, 1]
        seg_len = math.sqrt(dx * dx + dz * dz)
        if seg_len < 0.01:
            continue
        angle = math.atan2(dz, dx) % math.pi  # fold to [0, π)
        bin_idx = int(angle / math.pi * n_bins) % n_bins
        bins[bin_idx] += seg_len  # weight by length

    total = bins.sum()
    if total < 0.01:
        return 1.0
    probs = bins / total
    entropy = 0.0
    for p in probs:
        if p > 1e-10:
            entropy -= p * math.log2(p)
    max_entropy = math.log2(n_bins)
    return entropy / max_entropy


def compute_roof_veto_score(
    cl_pts: np.ndarray,
    cl_normals: np.ndarray,
    cl_curvature: np.ndarray,
    plane_residual: float,
    plane_membership_frac: float,
) -> tuple[float, ClusterMetrics]:
    """
    Compute a roof_veto_score for a cluster. High score = roof-like → block TREE.

    Signals (each 0 or 1, summed):
      1. Large contiguous area (> 3 m²)
      2. Low boundary roundness (< 0.85 → rectangular, not circular)
      3. High straight-edge ratio (> 0.3 → has long straight edges)
      4. Low edge direction entropy (< 0.7 → edges align to few directions)
      5. Low plane residual (< 0.35 → fits a plane well)
      6. Low curvature (median < 0.08 → smooth surface)
      7. Consistent normals (angular std < 20°)
      8. Significant plane membership (> 30% of points on RANSAC planes)

    Returns (veto_score, metrics).
    """
    cl_xz = cl_pts[:, [0, 2]]
    metrics = ClusterMetrics(n_points=len(cl_pts))

    # Area
    xz_range = cl_xz.max(axis=0) - cl_xz.min(axis=0)
    metrics.area_m2 = float(xz_range[0] * xz_range[1])
    metrics.z_spread = float(cl_pts[:, 1].max() - cl_pts[:, 1].min())
    metrics.plane_residual = plane_residual
    metrics.plane_membership_frac = plane_membership_frac

    # Boundary shape analysis
    boundary = _compute_boundary_xz(cl_xz)
    metrics.roundness = _boundary_roundness(boundary)
    metrics.straight_edge_ratio = _straight_edge_ratio(boundary)
    metrics.edge_direction_entropy = _edge_direction_entropy(boundary)

    # Normal consistency
    mean_n = cl_normals.mean(axis=0)
    mn_len = np.linalg.norm(mean_n)
    if mn_len > 1e-6:
        mean_n /= mn_len
        cos_a = np.clip(cl_normals @ mean_n, -1, 1)
        angular_std = float(np.std(np.arccos(cos_a)))
    else:
        angular_std = math.pi
    metrics.normal_angular_std_deg = math.degrees(angular_std)

    # Curvature
    median_curv = float(np.median(cl_curvature))

    # --- Score ---
    veto = 0.0

    if metrics.area_m2 > 3.0:
        veto += 1.0
    if metrics.roundness < 0.85:
        veto += 1.0
    if metrics.straight_edge_ratio > 0.3:
        veto += 1.0
    if metrics.edge_direction_entropy < 0.70:
        veto += 1.0
    if plane_residual < 0.35:
        veto += 1.0
    if median_curv < 0.08:
        veto += 1.0
    if angular_std < math.radians(20):
        veto += 1.0
    if plane_membership_frac > 0.30:
        veto += 1.0

    metrics.roof_veto_score = veto
    return veto, metrics


# ---------------------------------------------------------------------------
# 3. Tree shape signals (positive evidence required for TREE)
# ---------------------------------------------------------------------------

def compute_tree_shape_signals(
    cl_pts: np.ndarray,
    cl_normals: np.ndarray,
    plane_residual: float,
    roundness: float,
    straight_edge_ratio: float,
    edge_direction_entropy: float,
    normal_angular_std_deg: float,
) -> tuple[int, list[str]]:
    """
    Count positive tree-shape signals. Need >= _TREE_PROMOTE_SIGNALS to promote.

    Signals:
      1. Rounded/blob-like boundary (roundness > 0.80)
      2. Weak straight-line support (straight_edge_ratio < 0.2)
      3. High edge direction entropy (> 0.75 → edges scatter in many directions)
      4. Poor plane fit (residual > 0.35)
      5. Chaotic normals (angular std > 25°)
      6. Fragmented internal structure (high Z variance within XY slices)

    Returns (signal_count, reasons).
    """
    signals = 0
    reasons = []

    if roundness > 0.80:
        signals += 1
        reasons.append(f"round={roundness:.2f}")

    if straight_edge_ratio < 0.2:
        signals += 1
        reasons.append(f"weak_edges={straight_edge_ratio:.2f}")

    if edge_direction_entropy > 0.75:
        signals += 1
        reasons.append(f"edge_entropy={edge_direction_entropy:.2f}")

    if plane_residual > 0.35:
        signals += 1
        reasons.append(f"bad_plane={plane_residual:.3f}")

    if normal_angular_std_deg > 25.0:
        signals += 1
        reasons.append(f"chaotic_normals={normal_angular_std_deg:.1f}°")

    # Fragmented Z structure: divide cluster into XZ quadrants,
    # check if Z variance is high within each
    cl_xz = cl_pts[:, [0, 2]]
    centroid_xz = cl_xz.mean(axis=0)
    quadrant_z_vars = []
    for qx in (-1, 1):
        for qz in (-1, 1):
            qmask = ((cl_xz[:, 0] - centroid_xz[0]) * qx > 0) & \
                     ((cl_xz[:, 1] - centroid_xz[1]) * qz > 0)
            if qmask.sum() >= 3:
                quadrant_z_vars.append(float(np.std(cl_pts[qmask, 1])))
    if quadrant_z_vars and np.mean(quadrant_z_vars) > 0.4:
        signals += 1
        reasons.append(f"fragmented_z={np.mean(quadrant_z_vars):.2f}")

    return signals, reasons


# ---------------------------------------------------------------------------
# 4. Cluster and promote with roof veto
# ---------------------------------------------------------------------------

def cluster_and_promote_trees(
    point_cloud: np.ndarray,
    candidate_mask: np.ndarray,
    normals: np.ndarray,
    curvature: np.ndarray,
    plane_labels: np.ndarray,
    cluster_radius: float = 0.8,
    min_cluster_points: int = 8,
) -> tuple[np.ndarray, int, int, list[ClusterMetrics]]:
    """
    Cluster TREE_CANDIDATE points. For each cluster:
      1. Compute roof_veto_score — if high, TREE is forbidden
      2. Compute tree shape signals — need >= 3 to promote
      3. Apply area/spread/plane checks

    Returns (tree_mask, n_promoted, n_rejected, all_cluster_metrics).
    """
    pts = np.asarray(point_cloud)
    N = len(pts)
    tree_mask = np.zeros(N, dtype=bool)
    all_metrics: list[ClusterMetrics] = []

    cand_indices = np.where(candidate_mask)[0]
    if len(cand_indices) < min_cluster_points or not HAS_SCIPY:
        return tree_mask, 0, 0, all_metrics

    # Spatial clustering via connected components in XZ
    cand_pts = pts[cand_indices]
    cand_xz = cand_pts[:, [0, 2]]
    kd = cKDTree(cand_xz)
    pairs = kd.query_pairs(r=cluster_radius)

    parent = np.arange(len(cand_indices))

    def _find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for a, b in pairs:
        ra, rb = _find(a), _find(b)
        if ra != rb:
            parent[ra] = rb

    roots = np.array([_find(i) for i in range(len(cand_indices))])

    n_promoted = 0
    n_rejected = 0

    for root_id in np.unique(roots):
        cluster_local = np.where(roots == root_id)[0]
        if len(cluster_local) < min_cluster_points:
            n_rejected += 1
            continue

        cluster_global = cand_indices[cluster_local]
        cl_pts = pts[cluster_global]
        cl_xz = cl_pts[:, [0, 2]]
        cl_normals = normals[cluster_global]
        cl_curvature = curvature[cluster_global]

        # --- Plane membership fraction ---
        cl_plane_labels = plane_labels[cluster_global]
        on_plane = cl_plane_labels[cl_plane_labels >= 0]
        plane_frac = len(on_plane) / len(cluster_local)

        # --- Plane fit residual ---
        if len(cl_pts) >= 4:
            centroid = cl_pts.mean(axis=0)
            centered = cl_pts - centroid
            try:
                _, s, _ = np.linalg.svd(centered, full_matrices=False)
                residual = float(s[2] / math.sqrt(len(cl_pts)))
            except np.linalg.LinAlgError:
                residual = 999.0
        else:
            residual = 999.0

        # --- Roof veto score ---
        veto_score, metrics = compute_roof_veto_score(
            cl_pts, cl_normals, cl_curvature, residual, plane_frac,
        )

        # --- ROOF-FIRST VETO: if veto_score is high, TREE is forbidden ---
        if veto_score >= _ROOF_VETO_THRESHOLD:
            metrics.decision = f"vetoed_roof (veto={veto_score:.0f})"
            all_metrics.append(metrics)
            n_rejected += 1
            logger.info(
                "Tree cluster VETOED by roof score: %d pts, area=%.1f m², "
                "veto=%.0f, roundness=%.2f, straight=%.2f, entropy=%.2f, "
                "resid=%.3f, plane_frac=%.0f%%",
                len(cluster_local), metrics.area_m2, veto_score,
                metrics.roundness, metrics.straight_edge_ratio,
                metrics.edge_direction_entropy, residual, plane_frac * 100,
            )
            continue

        # --- Basic checks ---
        xz_range = cl_xz.max(axis=0) - cl_xz.min(axis=0)
        area = xz_range[0] * xz_range[1]

        if area < _MAX_OBSTRUCTION_AREA_M2 and len(cluster_local) < _MAX_OBSTRUCTION_PTS:
            if plane_frac > 0.3:
                metrics.decision = "rejected_obstruction"
                all_metrics.append(metrics)
                n_rejected += 1
                continue

        if area < _MIN_CLUSTER_AREA_M2:
            metrics.decision = "rejected_small_area"
            all_metrics.append(metrics)
            n_rejected += 1
            continue

        z_spread = float(cl_pts[:, 1].max() - cl_pts[:, 1].min())
        if z_spread < _MIN_CLUSTER_Z_SPREAD:
            metrics.decision = "rejected_low_z_spread"
            all_metrics.append(metrics)
            n_rejected += 1
            continue

        # --- Tree shape signals (positive evidence required) ---
        tree_signals, tree_reasons = compute_tree_shape_signals(
            cl_pts, cl_normals, residual,
            metrics.roundness, metrics.straight_edge_ratio,
            metrics.edge_direction_entropy, metrics.normal_angular_std_deg,
        )
        metrics.tree_score = tree_signals

        if tree_signals < _TREE_PROMOTE_SIGNALS:
            metrics.decision = f"rejected_weak_tree (signals={tree_signals})"
            all_metrics.append(metrics)
            n_rejected += 1
            logger.debug(
                "Tree cluster rejected (weak signals=%d/%d): %d pts, %s",
                tree_signals, _TREE_PROMOTE_SIGNALS, len(cluster_local),
                ", ".join(tree_reasons) if tree_reasons else "none",
            )
            continue

        # --- Promoted as TREE ---
        tree_mask[cluster_global] = True
        n_promoted += 1
        metrics.decision = f"promoted ({', '.join(tree_reasons)})"
        all_metrics.append(metrics)
        logger.info(
            "Tree cluster PROMOTED: %d pts, area=%.1f m², z_spread=%.1f, "
            "tree_signals=%d (%s), veto=%.0f",
            len(cluster_local), area, z_spread, tree_signals,
            ", ".join(tree_reasons), veto_score,
        )

    return tree_mask, n_promoted, n_rejected, all_metrics


# ---------------------------------------------------------------------------
# 5. Safety rule — protect valid planes adjacent to tree regions
# ---------------------------------------------------------------------------

def apply_safety_rule(
    point_cloud: np.ndarray,
    tree_mask: np.ndarray,
    plane_labels: np.ndarray,
    normals: np.ndarray,
    height_std: np.ndarray,
    vertical_compactness: np.ndarray,
    plane_areas: dict[int, float],
) -> np.ndarray:
    """
    Unassigned points adjacent to tree clusters with 2+ tree features
    get absorbed. Points on RANSAC planes are never absorbed.
    """
    if not HAS_SCIPY:
        return tree_mask

    pts = np.asarray(point_cloud)
    tree_mask = tree_mask.copy()

    tree_indices = np.where(tree_mask)[0]
    if len(tree_indices) == 0:
        return tree_mask

    # Only consider unassigned elevated points (NOT on any RANSAC plane)
    non_tree_elevated = (~tree_mask) & (plane_labels == -1) & (pts[:, 1] > 1.0)
    non_tree_indices = np.where(non_tree_elevated)[0]
    if len(non_tree_indices) == 0:
        return tree_mask

    tree_xz = pts[tree_indices][:, [0, 2]]
    kd_tree = cKDTree(tree_xz)

    for idx in non_tree_indices:
        pt_xz = pts[idx, [0, 2]]
        dist, _ = kd_tree.query(pt_xz)
        if dist > _SAFETY_PLANE_PROXIMITY_M:
            continue

        has_high_spread = vertical_compactness[idx] > 1.5
        has_high_hstd = height_std[idx] > 0.2
        has_chaotic_normal = False

        nearby_tree = kd_tree.query_ball_point(pt_xz, r=1.0)
        if len(nearby_tree) > 2:
            nearby_normals = normals[tree_indices[nearby_tree]]
            mean_n = nearby_normals.mean(axis=0)
            mn_len = np.linalg.norm(mean_n)
            if mn_len > 1e-6:
                mean_n /= mn_len
                pt_cos = float(np.clip(np.dot(normals[idx], mean_n), -1, 1))
                if abs(pt_cos) < 0.7:
                    has_chaotic_normal = True

        if sum([has_high_spread, has_high_hstd, has_chaotic_normal]) >= 2:
            tree_mask[idx] = True

    return tree_mask


# ---------------------------------------------------------------------------
# 6. Main entry point
# ---------------------------------------------------------------------------

def detect_and_exclude_trees(
    point_cloud: np.ndarray,
    normals: np.ndarray,
    curvature: np.ndarray,
    height_std: np.ndarray,
    vertical_compactness: np.ndarray,
    local_density: np.ndarray,
    plane_labels: np.ndarray,
    plane_residuals: dict[int, float],
    plane_areas: dict[int, float] | None = None,
    k_neighbors: int = 20,
) -> TreeExclusionResult:
    """
    Full tree exclusion pipeline with ROOF-FIRST veto.

    A cluster is only promoted to TREE if:
      - roof_veto_score < threshold (region is NOT roof-like)
      - tree shape signals >= 3 (positive tree evidence)
      - passes area, z_spread, and plane checks
    """
    pts = np.asarray(point_cloud)
    N = len(pts)

    # Step 1: Per-point scoring
    scores, candidate_mask, trigger_counts = compute_tree_scores(
        pts, normals, curvature, height_std, vertical_compactness,
        local_density, plane_labels, plane_residuals, k_neighbors,
    )

    n_candidates = int(candidate_mask.sum())
    logger.info("Tree detection: %d / %d points are TREE_CANDIDATE", n_candidates, N)

    # Step 2-3: Cluster, veto, and promote
    tree_mask, n_promoted, n_rejected, cluster_metrics = cluster_and_promote_trees(
        pts, candidate_mask, normals, curvature, plane_labels,
    )

    logger.info(
        "Tree clustering: %d promoted, %d rejected, %d points excluded",
        n_promoted, n_rejected, int(tree_mask.sum()),
    )

    # Step 4: Safety rule
    tree_mask = apply_safety_rule(
        pts, tree_mask, plane_labels, normals, height_std,
        vertical_compactness, plane_areas or {},
    )

    n_excluded = int(tree_mask.sum())
    logger.info(
        "Tree exclusion final: %d points (%.1f%%) excluded as TREE",
        n_excluded, 100.0 * n_excluded / max(N, 1),
    )
    logger.info("Tree signal triggers: %s", trigger_counts)

    diagnostics = TreeDiagnostics(
        tree_score_per_point=scores,
        tree_candidate_mask=candidate_mask,
        tree_cluster_mask=tree_mask,
        n_candidates=n_candidates,
        n_clusters_promoted=n_promoted,
        n_clusters_rejected=n_rejected,
        n_points_excluded=n_excluded,
        trigger_counts=trigger_counts,
        cluster_metrics=cluster_metrics,
    )

    return TreeExclusionResult(tree_mask=tree_mask, diagnostics=diagnostics)


# ---------------------------------------------------------------------------
# 7. Grid-level tree exclusion (for gradient detector)
# ---------------------------------------------------------------------------

def compute_grid_tree_mask(
    height_grid: np.ndarray,
    max_roof_height: float,
    variance_threshold: float = 0.15,
) -> np.ndarray:
    """
    Compute a boolean grid mask where True = TREE cell.
    Only marks cells that are ABOVE max_roof_height or have very high
    local variance. Conservative — prefers false negatives over false positives.
    """
    rows, cols = height_grid.shape
    tree_grid = np.zeros((rows, cols), dtype=bool)

    for r in range(rows):
        for c in range(cols):
            h = height_grid[r, c]
            if np.isnan(h):
                continue

            # Height ceiling — above max roof height = tree
            if h > max_roof_height:
                tree_grid[r, c] = True
                continue

            # Local variance check
            vals = []
            for dr in (-1, 0, 1):
                for dc in (-1, 0, 1):
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < rows and 0 <= nc < cols:
                        v = height_grid[nr, nc]
                        if not np.isnan(v):
                            vals.append(v)
            if len(vals) >= 3:
                mean = sum(vals) / len(vals)
                var = sum((v - mean) ** 2 for v in vals) / len(vals)
                if var > variance_threshold:
                    tree_grid[r, c] = True

    n_tree = int(tree_grid.sum())
    if n_tree > 0:
        logger.info("Grid tree mask: %d / %d cells excluded (%.1f%%)",
                     n_tree, rows * cols, 100.0 * n_tree / (rows * cols))

    return tree_grid
