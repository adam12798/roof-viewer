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
    plane_thickness_std: float = 0.0  # std of signed distances from best-fit plane
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


@dataclass
class AnchorProbe:
    """What we learn from probing 2 dots out in every direction from a calibration dot."""
    anchor_idx: int                       # index of the anchor's nearest LiDAR dot
    anchor_height: float                  # Y height at the anchor
    upslope_dir: np.ndarray               # (2,) XZ unit vector toward higher ground
    downslope_dir: np.ndarray             # (2,) XZ unit vector toward lower ground
    eave_dir: np.ndarray                  # (2,) XZ unit vector along the eave (perpendicular to slope)
    slope_magnitude: float                # height change per metre in the upslope direction
    neighbor_height_at_anchor: float      # average height of immediate neighbors (baseline)
    has_ground_dropoff: bool              # True if one direction drops sharply to ground
    has_lower_roof_dropoff: bool          # True if one direction drops to a lower roof level
    ground_dropoff_dir: np.ndarray | None  # direction of the ground dropoff if found
    lower_roof_dropoff_dir: np.ndarray | None  # direction of lower roof dropoff if found


@dataclass
class AnchorTraceResult:
    """Trace result from a single calibration dot."""
    anchor_xz: tuple[float, float]        # original calibration dot position
    anchor_height: float                  # Y height at the anchor's nearest LiDAR dot
    ridge_height: float                   # highest point reached tracing uphill
    ridge_point: np.ndarray               # 3D position of the ridge point
    roof_slope: float                     # rise/run ratio of the upslope
    slope_axis: np.ndarray                # (2,) XZ unit vector from anchor → ridge
    upslope_trace: list[int]              # point indices: anchor → ridge
    downslope_trace: list[int]            # point indices: ridge → other side
    tree_intrusion_indices: list[int]     # dots flagged as tree on the downslope
    cross_slope_tree_indices: list[int]   # dots flagged by cross-slope inconsistency
    confirmed_roof_indices: list[int] = field(default_factory=list)  # dots that passed consistency check
    consistency_ratio: float = 0.0        # fraction of traced dots that are confirmed roof
    was_on_ground: bool = False           # True if anchor was relocated from ground
    probe: AnchorProbe | None = None      # neighborhood probe result


@dataclass
class RoofTraceResult:
    """Merged output of slope-tracing from ALL calibration dots."""
    ridge_height: float                   # highest ridge across all anchors
    base_height: float                    # MEDIAN anchor height (not min, not ground)
    ridge_points: list[np.ndarray]        # 3D position of each traced ridge point
    roof_slope: float                     # average rise/run across all anchors
    slope_axis: np.ndarray                # (2,) average XZ unit vector
    upslope_trace: list[int]              # merged point indices: all anchors → ridges
    downslope_trace: list[int]            # merged point indices: all ridges → other sides
    tree_intrusion_indices: list[int]     # dots flagged as tree on downslopes
    cross_slope_tree_indices: list[int]   # dots flagged by cross-slope inconsistency
    anchor_probes: list[AnchorProbe] = field(default_factory=list)
    per_anchor_traces: list[AnchorTraceResult] = field(default_factory=list)  # individual results
    sweep_labels: np.ndarray | None = None  # (N,) per-point CellLabel from sweep


@dataclass
class SweepStripResult:
    """Result from a single perpendicular strip trace."""
    strip_offset: float                     # perpendicular distance from initial trace (signed)
    start_idx: int                          # point index where this strip started
    upslope_trace: list[int]                # point indices: start → ridge
    downslope_trace: list[int]              # point indices: ridge → other side
    ridge_idx: int | None                   # index of ridge point on this strip
    tree_indices: list[int]                 # points flagged as tree on this strip
    terminated_by: str                      # "ground" | "lower_roof" | "edge" | "max_steps"
    ground_indices: list[int] = field(default_factory=list)
    lower_roof_indices: list[int] = field(default_factory=list)


@dataclass
class SweepResult:
    """Full sweep output from one anchor."""
    anchor_xz: tuple[float, float]
    slope_axis: np.ndarray                  # (2,) XZ unit vector upslope
    perp_axis: np.ndarray                   # (2,) XZ unit vector along eave
    roof_slope: float
    ridge_height: float
    base_height: float
    strips: list[SweepStripResult]          # all strips, ordered by offset
    roof_indices: set[int] = field(default_factory=set)
    ridge_indices: set[int] = field(default_factory=set)
    tree_indices: set[int] = field(default_factory=set)
    ground_indices: set[int] = field(default_factory=set)
    lower_roof_indices: set[int] = field(default_factory=set)
    eave_indices: set[int] = field(default_factory=set)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Per-point scoring
_MIN_SIGNALS_FOR_CANDIDATE = 6   # out of 7 signals (raised from 4→5→6)

# Cluster promotion
_MIN_CLUSTER_AREA_M2 = 4.0       # raised from 2.0 — need a larger blob to call it tree
_MIN_CLUSTER_Z_SPREAD = 2.5      # raised from 1.5 — need more vertical chaos
_MAX_PLANE_RESIDUAL = 0.40
_NORMAL_CHAOS_THRESHOLD_DEG = 31.0

# Roof veto thresholds
_ROOF_VETO_THRESHOLD = 3.0       # veto score >= this blocks TREE
_TREE_PROMOTE_SIGNALS = 5        # need >= 5 positive tree shape signals (raised from 3→4→5)

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

    # --- Anti-veto: "plane thickness" penalty ---
    # A real roof surface is thin (points cluster within ~0.1m of the plane).
    # A tree canopy "plane" is RANSAC slicing through a 3D volume — points
    # are spread 1-3m on either side of the fit.
    if len(cl_pts) >= 10:
        centroid = cl_pts.mean(axis=0)
        centered = cl_pts - centroid
        try:
            _, S, Vt = np.linalg.svd(centered, full_matrices=False)
            plane_normal = Vt[2]  # smallest singular value direction
            signed_dists = centered @ plane_normal
            thickness_std = float(np.std(signed_dists))
            metrics.plane_thickness_std = thickness_std

            if thickness_std > 0.30:
                veto -= 1.5
                logger.debug(
                    "Anti-veto: plane_thickness_std=%.3f > 0.30 → veto -= 1.5",
                    thickness_std,
                )

            # Additional check: observed height range vs predicted from plane slope
            observed_h_range = float(cl_pts[:, 1].max() - cl_pts[:, 1].min())
            xz_range = cl_pts[:, [0, 2]].max(axis=0) - cl_pts[:, [0, 2]].min(axis=0)
            xz_span = float(np.linalg.norm(xz_range))
            # Predicted height range from a plane with this normal over this XZ span
            normal_y = abs(float(plane_normal[1]))
            if normal_y > 1e-6:
                # plane slope in Y direction
                slope_xz = math.sqrt(max(0, 1 - normal_y**2)) / normal_y
                predicted_h_range = slope_xz * xz_span
            else:
                predicted_h_range = xz_span  # near-vertical plane

            if observed_h_range > 2.0 and predicted_h_range < 0.5 * observed_h_range:
                veto -= 1.0
                logger.debug(
                    "Anti-veto: observed_h=%.1fm >> predicted_h=%.1fm → veto -= 1.0",
                    observed_h_range, predicted_h_range,
                )
        except np.linalg.LinAlgError:
            pass

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

    # Step 4: Safety rule — DISABLED, absorbs too many roof-edge points
    # tree_mask = apply_safety_rule(
    #     pts, tree_mask, plane_labels, normals, height_std,
    #     vertical_compactness, plane_areas or {},
    # )

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
# 7. Calibration dot neighborhood probe
# ---------------------------------------------------------------------------

def probe_anchor_neighborhood(
    point_cloud: np.ndarray,
    anchor_xz: tuple[float, float],
    kd: 'cKDTree',
    dot_spacing: float = 0.5,
) -> AnchorProbe | None:
    """
    Probe 2 dots out in 8 directions from a calibration dot to learn
    the local roof structure.

    From the calibration point, we look in 8 compass directions (N, NE, E,
    SE, S, SW, W, NW). For each direction we step out ~1 dot spacing and
    ~2 dot spacings, finding the nearest LiDAR dot at each step.

    What each direction reveals by its height profile (2 steps):
      - Gradual increase    → upslope (toward ridge)
      - Gradual decrease    → downslope (toward eave)
      - Flat / same height  → along the eave (perpendicular to slope)
      - Large drop (>1.5m)  → eave edge dropping to ground
      - Medium drop (0.5-1.5m) → step down to lower roof section
      - Large increase then flat → ridge is very close

    Returns AnchorProbe with classified directions, or None if too few points.
    """
    pts = point_cloud
    ax, az = anchor_xz
    _, anchor_idx = kd.query([ax, az])
    anchor_h = pts[anchor_idx, 1]

    # 8 compass directions in XZ plane
    angles = [i * math.pi / 4 for i in range(8)]  # 0, 45, 90, ... 315 degrees
    directions = [np.array([math.cos(a), math.sin(a)]) for a in angles]

    # For each direction, get height at 1-dot and 2-dot distance
    dir_profiles: list[tuple[np.ndarray, float, float]] = []  # (dir_xz, h_at_1, h_at_2)

    for d in directions:
        # Step 1: ~1 dot spacing out
        probe1_xz = np.array([ax, az]) + d * dot_spacing
        near1 = kd.query_ball_point(probe1_xz, r=dot_spacing * 0.6)
        if not near1:
            _, near1_idx = kd.query(probe1_xz)
            h1 = pts[near1_idx, 1]
        else:
            # Pick the closest to probe point
            dists1 = [float(np.linalg.norm(pts[n, [0, 2]] - probe1_xz)) for n in near1]
            h1 = pts[near1[int(np.argmin(dists1))], 1]

        # Step 2: ~2 dot spacings out
        probe2_xz = np.array([ax, az]) + d * dot_spacing * 2
        near2 = kd.query_ball_point(probe2_xz, r=dot_spacing * 0.6)
        if not near2:
            _, near2_idx = kd.query(probe2_xz)
            h2 = pts[near2_idx, 1]
        else:
            dists2 = [float(np.linalg.norm(pts[n, [0, 2]] - probe2_xz)) for n in near2]
            h2 = pts[near2[int(np.argmin(dists2))], 1]

        dir_profiles.append((d, h1, h2))

    # Classify each direction by its height changes
    # delta1 = h_at_1 - anchor_h, delta2 = h_at_2 - h_at_1
    upslope_candidates: list[tuple[np.ndarray, float]] = []    # (dir, slope_magnitude)
    downslope_candidates: list[tuple[np.ndarray, float]] = []
    flat_candidates: list[tuple[np.ndarray, float]] = []
    ground_dropoff_dir = None
    lower_roof_dropoff_dir = None

    for d, h1, h2 in dir_profiles:
        delta1 = h1 - anchor_h     # change from anchor to 1st step
        delta2 = h2 - h1           # change from 1st step to 2nd step

        # Large dropoff to ground (>1.5m drop in 1 step)
        if delta1 < -1.5 or delta2 < -1.5:
            ground_dropoff_dir = d.copy()
            continue

        # Medium dropoff to lower roof (0.5m-1.5m drop)
        if delta1 < -0.5 or (delta1 + delta2) < -0.8:
            lower_roof_dropoff_dir = d.copy()
            downslope_candidates.append((d, abs(delta1) / dot_spacing))
            continue

        # Consistent upslope: both steps go up
        if delta1 > 0.03 and delta2 > -0.05:
            slope_mag = (h2 - anchor_h) / (dot_spacing * 2)
            upslope_candidates.append((d, slope_mag))
            continue

        # Consistent downslope: both steps go down (gentler than dropoff)
        if delta1 < -0.03 and delta2 < 0.05:
            slope_mag = abs(anchor_h - h2) / (dot_spacing * 2)
            downslope_candidates.append((d, slope_mag))
            continue

        # Flat: both steps stay within ~0.05m of anchor height
        if abs(delta1) < 0.08 and abs(delta2) < 0.08:
            flat_candidates.append((d, abs(delta1)))
            continue

        # Large increase then flat = ridge very close
        if delta1 > 0.1 and abs(delta2) < 0.08:
            upslope_candidates.append((d, delta1 / dot_spacing))

    # Pick the strongest upslope direction
    if upslope_candidates:
        upslope_candidates.sort(key=lambda x: x[1], reverse=True)
        upslope_dir = upslope_candidates[0][0]
        slope_mag = upslope_candidates[0][1]
    else:
        # Fallback: use the direction with the highest 2-step height
        best_dir = max(dir_profiles, key=lambda x: x[2])
        upslope_dir = best_dir[0]
        slope_mag = max(0.05, (best_dir[2] - anchor_h) / (dot_spacing * 2))

    # Downslope = opposite of upslope
    downslope_dir = -upslope_dir

    # Eave direction = perpendicular to slope (the flat direction, or rotate 90°)
    if flat_candidates:
        # Use the flattest direction
        flat_candidates.sort(key=lambda x: x[1])
        eave_dir = flat_candidates[0][0]
    else:
        # Rotate upslope 90° in XZ
        eave_dir = np.array([-upslope_dir[1], upslope_dir[0]])

    # Average height of immediate neighbors = baseline for this spot
    immediate = kd.query_ball_point([ax, az], r=dot_spacing * 0.8)
    if immediate:
        neighbor_h = float(np.mean([pts[n, 1] for n in immediate]))
    else:
        neighbor_h = anchor_h

    probe = AnchorProbe(
        anchor_idx=anchor_idx,
        anchor_height=anchor_h,
        upslope_dir=upslope_dir,
        downslope_dir=downslope_dir,
        eave_dir=eave_dir,
        slope_magnitude=slope_mag,
        neighbor_height_at_anchor=neighbor_h,
        has_ground_dropoff=ground_dropoff_dir is not None,
        has_lower_roof_dropoff=lower_roof_dropoff_dir is not None,
        ground_dropoff_dir=ground_dropoff_dir,
        lower_roof_dropoff_dir=lower_roof_dropoff_dir,
    )

    logger.info(
        "Anchor probe (%.1f, %.1f): h=%.1fm, slope=%.2f, "
        "upslope=(%.2f,%.2f), eave=(%.2f,%.2f), "
        "ground_drop=%s, lower_roof_drop=%s",
        ax, az, anchor_h, slope_mag,
        upslope_dir[0], upslope_dir[1],
        eave_dir[0], eave_dir[1],
        ground_dropoff_dir is not None,
        lower_roof_dropoff_dir is not None,
    )

    return probe


# ---------------------------------------------------------------------------
# 8. Slope-tracing tree detection from calibration dots
# ---------------------------------------------------------------------------

def _is_ground_level(pts: np.ndarray, idx: int, kd: 'cKDTree', radius: float = 2.0) -> bool:
    """
    Check if a point is at ground level by looking at its neighborhood.
    Ground = flat area (low height variance) at the bottom of the height range.
    """
    heights = pts[:, 1]
    h_10 = float(np.percentile(heights, 10))
    h_range = float(np.percentile(heights, 90) - h_10)
    pt_h = pts[idx, 1]

    # If point is in the bottom 20% of height range, it's likely ground
    if pt_h > h_10 + 0.20 * h_range:
        return False

    # Check local flatness — ground is flat
    neighbors = kd.query_ball_point(pts[idx, [0, 2]], r=radius)
    if len(neighbors) < 5:
        return False
    neighbor_heights = pts[neighbors, 1]
    height_std = float(np.std(neighbor_heights))

    # Ground neighborhoods are very flat (std < 0.3m)
    return height_std < 0.3


def _search_for_roof_from_ground(
    pts: np.ndarray,
    kd: 'cKDTree',
    start_idx: int,
    search_radius: float,
) -> tuple[int, float] | None:
    """
    From a ground-level point, search outward in expanding rings for a
    large height jump — the transition from ground to roof (eave/wall).

    Returns (roof_entry_idx, height_at_entry) or None if no roof found.
    """
    start_h = pts[start_idx, 1]
    start_xz = pts[start_idx, [0, 2]]

    # Search in expanding rings: 1m, 2m, 3m, ... up to 15m
    for ring_r in np.arange(1.0, 15.5, 0.5):
        ring_candidates = kd.query_ball_point(start_xz, r=ring_r)

        # Among candidates, find points significantly higher than ground
        best_roof_idx = -1
        best_jump = 0.0

        for ci in ring_candidates:
            h_jump = pts[ci, 1] - start_h

            # A real roof eave is at least 2.5m above ground (single story)
            # and the point should be higher than anything we've seen closer
            if h_jump > 2.0 and h_jump > best_jump:
                # Verify this isn't an isolated spike — check its neighbors
                local = kd.query_ball_point(pts[ci, [0, 2]], r=search_radius)
                if len(local) >= 3:
                    local_heights = pts[local, 1]
                    # At least 3 neighbors should also be elevated (not a lone spike)
                    n_elevated = int(np.sum(local_heights > start_h + 1.5))
                    if n_elevated >= 3:
                        best_jump = h_jump
                        best_roof_idx = ci

        if best_roof_idx >= 0:
            logger.info(
                "Ground→roof transition found: ground=%.1fm, roof=%.1fm "
                "(jump=+%.1fm at ring_r=%.1fm)",
                start_h, pts[best_roof_idx, 1], best_jump, ring_r,
            )
            return best_roof_idx, float(pts[best_roof_idx, 1])

    return None


def _validate_roof_consistency(
    pts: np.ndarray,
    kd: 'cKDTree',
    trace_indices: list[int],
    slope_axis: np.ndarray,
    search_radius: float,
) -> list[int]:
    """
    Validate traced roof points by checking cross-slope consistency.

    A real roof is consistent: points at the same distance along the slope
    axis should have nearly identical heights when you look perpendicular
    to the slope. Two dots on opposite sides of the ridge at equal distance
    down should be at equal height.

    Returns list of point indices that pass the consistency check
    (confirmed roof points).
    """
    if len(trace_indices) < 3:
        return list(trace_indices)

    perp_axis = np.array([-slope_axis[1], slope_axis[0]])
    confirmed: list[int] = []

    for idx in trace_indices:
        pt_xz = pts[idx, [0, 2]]
        pt_h = pts[idx, 1]

        # Look 1-3 dots perpendicular on each side
        consistent_count = 0
        check_count = 0

        for direction in [1.0, -1.0]:
            for dist_mult in [1.0, 2.0]:
                probe_pt = pt_xz + perp_axis * direction * search_radius * dist_mult
                neighbors = kd.query_ball_point(probe_pt, r=search_radius * 0.6)

                for ni in neighbors:
                    if ni == idx:
                        continue
                    check_count += 1
                    side_h = pts[ni, 1]
                    h_diff = abs(side_h - pt_h)

                    # Consistent = within 0.3m height (generous for slopes)
                    if h_diff < 0.3:
                        consistent_count += 1

        # A point is confirmed roof if majority of perpendicular
        # neighbors are at a consistent height
        if check_count > 0 and consistent_count / check_count >= 0.5:
            confirmed.append(idx)

    return confirmed


def _trace_single_anchor(
    pts: np.ndarray,
    kd: 'cKDTree',
    ax: float, az: float,
    search_radius: float,
) -> AnchorTraceResult | None:
    """
    Run the full probe + uphill walk + downslope trace for ONE calibration dot.
    Returns AnchorTraceResult or None if the trace fails.
    No tree dots are written — only data is collected.

    FAILSAFE: If the calibration point is at ground level, the program
    searches outward for the roof (large height jump), steps onto it,
    then proceeds with normal tracing. This way even mis-placed calibration
    points still find the roof.
    """
    _, start_idx = kd.query([ax, az])

    # --- FAILSAFE: Detect ground-level anchor ---
    # If the user placed the calibration dot on the ground (or driveway, yard),
    # we search outward for the nearest roof edge and jump up to it.
    effective_start_idx = start_idx
    on_ground = _is_ground_level(pts, start_idx, kd)

    if on_ground:
        logger.info(
            "Anchor (%.1f, %.1f) is at GROUND level (h=%.1fm) — "
            "searching for nearest roof...",
            ax, az, pts[start_idx, 1],
        )
        roof_entry = _search_for_roof_from_ground(pts, kd, start_idx, search_radius)
        if roof_entry is not None:
            effective_start_idx = roof_entry[0]
            logger.info(
                "Relocated anchor from ground (h=%.1fm) to roof entry "
                "(h=%.1fm, idx=%d)",
                pts[start_idx, 1], pts[effective_start_idx, 1], effective_start_idx,
            )
        else:
            logger.warning(
                "Anchor (%.1f, %.1f) is on ground and no roof found nearby — "
                "skipping this anchor",
                ax, az,
            )
            return None

    # --- Probe the anchor neighborhood ---
    eff_xz = (float(pts[effective_start_idx, 0]), float(pts[effective_start_idx, 2]))
    probe = probe_anchor_neighborhood(pts, eff_xz, kd, dot_spacing=search_radius * 0.7)
    upslope_guide = probe.upslope_dir if probe else None

    # --- Phase A: Walk uphill to ridge ---
    # Pick the neighbor with the steepest consistent slope toward the ridge.
    # Score = slope (rise/run) weighted by direction consistency.
    # This follows the roof pitch instead of jumping to the tallest point.
    current_idx = effective_start_idx
    current_h = pts[current_idx, 1]
    start_h = current_h

    upslope_path: list[int] = [current_idx]
    visited: set[int] = {current_idx}
    running_slope = probe.slope_magnitude if probe else 0.0  # running avg slope
    upslope_tree_intrusions: list[int] = []
    # Need a few steps to establish the slope before we can flag outliers
    upslope_steps_taken = 0
    consecutive_outliers = 0
    outlier_buffer: list[int] = []

    for _ in range(300):
        neighbors = kd.query_ball_point(pts[current_idx, [0, 2]], r=search_radius)
        best_idx = -1
        best_score = -float('inf')

        for ni in neighbors:
            if ni in visited:
                continue
            nh = pts[ni, 1]
            if nh <= current_h - 0.02:
                continue

            step_dir = pts[ni, [0, 2]] - pts[current_idx, [0, 2]]
            step_len = float(np.linalg.norm(step_dir))
            if step_len < 0.01:
                continue

            h_gain = nh - current_h
            step_slope = h_gain / step_len  # rise/run for this step

            # Score = step slope (steepest wins)
            score = step_slope

            # Bonus for matching the running average slope (consistency)
            if running_slope > 0.01:
                slope_match = 1.0 - min(abs(step_slope - running_slope) / running_slope, 1.0)
                score += slope_match * 0.3

            # Bonus for alignment with upslope direction
            if upslope_guide is not None:
                alignment = float(np.dot(step_dir / step_len, upslope_guide))
                score += alignment * 0.2

            if score > best_score:
                best_score = score
                best_idx = ni

        if best_idx == -1:
            break

        # Check if this best step is a slope outlier
        is_outlier = False
        if running_slope > 0.01 and upslope_steps_taken >= 3:
            sd = pts[best_idx, [0, 2]] - pts[current_idx, [0, 2]]
            sl = float(np.linalg.norm(sd))
            if sl > 0.01:
                ss = (pts[best_idx, 1] - current_h) / sl
                slope_ratio = ss / running_slope
                if slope_ratio > 1.6 or slope_ratio < 0.15:
                    is_outlier = True

        if is_outlier:
            consecutive_outliers += 1
            outlier_buffer.append(best_idx)
            if consecutive_outliers >= 3:
                upslope_tree_intrusions.extend(outlier_buffer)
                break
        else:
            consecutive_outliers = 0
            outlier_buffer.clear()

        visited.add(best_idx)
        upslope_steps_taken += 1

        # Update running slope (exponential moving average)
        if not is_outlier:
            step_dir = pts[best_idx, [0, 2]] - pts[current_idx, [0, 2]]
            step_len = float(np.linalg.norm(step_dir))
            if step_len > 0.01:
                new_slope = (pts[best_idx, 1] - current_h) / step_len
                if running_slope > 0.01:
                    running_slope = 0.7 * running_slope + 0.3 * new_slope
                else:
                    running_slope = new_slope

        current_idx = best_idx
        current_h = pts[best_idx, 1]
        upslope_path.append(current_idx)

    if upslope_tree_intrusions:
        logger.info(
            "Upslope tree flags: %d points rejected (slope didn't match "
            "running avg %.2f)",
            len(upslope_tree_intrusions), running_slope,
        )

    # --- Ridge detection: find where the slope leveled off ---
    # Walk back through the path and find the point where slope dropped
    # to near zero after consistent climbing. That's the ridge.
    # If the slope never clearly leveled off, use the highest point.
    ridge_idx = current_idx
    if len(upslope_path) >= 5:
        # Compute per-step slopes for the last portion of the walk
        step_slopes = []
        for i in range(1, len(upslope_path)):
            p0 = upslope_path[i - 1]
            p1 = upslope_path[i]
            d = float(np.linalg.norm(pts[p1, [0, 2]] - pts[p0, [0, 2]]))
            if d > 0.01:
                s = (pts[p1, 1] - pts[p0, 1]) / d
                step_slopes.append((i, s))

        # Find where the slope first drops below 20% of the running average
        # (walking along the ridge — nearly flat)
        if step_slopes and running_slope > 0.01:
            flat_threshold = running_slope * 0.2
            flat_start = None
            flat_count = 0
            for i, (path_i, s) in enumerate(step_slopes):
                if abs(s) < flat_threshold:
                    flat_count += 1
                    if flat_start is None:
                        flat_start = path_i
                else:
                    flat_count = 0
                    flat_start = None
                # 3+ consecutive near-flat steps = ridge
                if flat_count >= 3 and flat_start is not None:
                    ridge_idx = upslope_path[flat_start]
                    logger.info(
                        "Ridge detected at step %d: slope dropped below %.3f "
                        "(running avg %.3f), h=%.1fm",
                        flat_start, flat_threshold, running_slope,
                        pts[ridge_idx, 1],
                    )
                    break

    ridge_pt = pts[ridge_idx].copy()

    # --- Phase B: Compute roof slope and slope axis ---
    start_xz = pts[effective_start_idx, [0, 2]]
    ridge_xz = pts[ridge_idx, [0, 2]]
    horizontal_dist = float(np.linalg.norm(ridge_xz - start_xz))
    climb = current_h - start_h

    if horizontal_dist > 0.5:
        roof_slope = climb / horizontal_dist
        slope_axis_xz = (ridge_xz - start_xz) / horizontal_dist
    else:
        roof_slope = probe.slope_magnitude if probe else 0.4
        slope_axis_xz = upslope_guide if upslope_guide is not None else np.array([1.0, 0.0])

    logger.info(
        "Anchor (%.1f, %.1f): h=%.1fm%s, climbed %.1fm over %.1fm (slope=%.2f, "
        "ridge_h=%.1fm, %d steps)",
        ax, az, start_h,
        " [relocated from ground]" if on_ground else "",
        climb, horizontal_dist, roof_slope,
        current_h, len(upslope_path),
    )

    # --- Consistency validation ---
    # Check that the traced path shows roof-like consistency:
    # perpendicular neighbors at similar heights = real roof surface
    confirmed_roof = _validate_roof_consistency(
        pts, kd, upslope_path, slope_axis_xz, search_radius,
    )
    consistency_ratio = len(confirmed_roof) / max(len(upslope_path), 1)
    logger.info(
        "Roof consistency: %d / %d traced dots confirmed (%.0f%%)",
        len(confirmed_roof), len(upslope_path), consistency_ratio * 100,
    )

    # --- Phase C: Trace downslope from ridge ---
    downslope_path: list[int] = []
    current_idx = ridge_idx
    current_h = pts[ridge_idx, 1]
    prev_h = current_h
    expected_drop_per_step = abs(roof_slope) * search_radius
    consecutive_descents = 0
    tree_intrusions: list[int] = []

    for step in range(300):
        probe_xz = pts[current_idx, [0, 2]] + slope_axis_xz * search_radius * 0.8
        candidates = kd.query_ball_point(probe_xz, r=search_radius)

        if not candidates:
            break

        best_idx = -1
        best_dist = float('inf')
        for ci in candidates:
            if ci in visited:
                continue
            d = float(np.linalg.norm(pts[ci, [0, 2]] - probe_xz))
            if d < best_dist:
                best_dist = d
                best_idx = ci

        if best_idx == -1:
            break

        visited.add(best_idx)
        step_h = pts[best_idx, 1]
        height_change = step_h - prev_h
        downslope_path.append(best_idx)

        if height_change < 0:
            consecutive_descents += 1

        # --- Phase D: Detect tree intrusion ---
        if consecutive_descents >= 2 and height_change > 0:
            threshold = expected_drop_per_step * 0.15
            if height_change > max(threshold, 0.10):
                tree_intrusions.append(best_idx)
                logger.info(
                    "Tree intrusion at step %d: height jumped +%.2fm "
                    "(was descending, expected ~-%.2fm/step)",
                    step, height_change, expected_drop_per_step,
                )

                # --- Phase F: Confirm by tracing 5 more dots ---
                confirm_idx = best_idx
                confirmed = False
                for _ in range(5):
                    fwd_xz = pts[confirm_idx, [0, 2]] + slope_axis_xz * search_radius * 0.8
                    fwd_cands = kd.query_ball_point(fwd_xz, r=search_radius)
                    fwd_best = -1
                    fwd_best_d = float('inf')
                    for fc in fwd_cands:
                        if fc in visited:
                            continue
                        fd = float(np.linalg.norm(pts[fc, [0, 2]] - fwd_xz))
                        if fd < fwd_best_d:
                            fwd_best_d = fd
                            fwd_best = fc
                    if fwd_best == -1:
                        break
                    visited.add(fwd_best)
                    if pts[fwd_best, 1] >= pts[best_idx, 1]:
                        confirmed = True
                        tree_intrusions.append(fwd_best)
                    confirm_idx = fwd_best

                if confirmed:
                    logger.info(
                        "Tree CONFIRMED: 5-dot forward trace shows "
                        "continued height increase from %.1fm",
                        pts[best_idx, 1],
                    )
                break

        current_idx = best_idx
        prev_h = step_h

    # --- Phase E: Cross-slope consistency check ---
    perp_axis = np.array([-slope_axis_xz[1], slope_axis_xz[0]])
    cross_tree: list[int] = []

    full_path = upslope_path + downslope_path
    for pi_idx in full_path:
        pt_xz = pts[pi_idx, [0, 2]]
        pt_h = pts[pi_idx, 1]
        for direction in [1.0, -1.0]:
            probe_pt = pt_xz + perp_axis * direction * 0.5
            side_neighbors = kd.query_ball_point(probe_pt, r=0.4)
            for sn in side_neighbors:
                if sn == pi_idx or sn in visited:
                    continue
                side_h = pts[sn, 1]
                h_diff = abs(side_h - pt_h)
                if h_diff > 0.15:
                    cross_tree.append(sn)

    # Also validate downslope consistency
    confirmed_down = _validate_roof_consistency(
        pts, kd, downslope_path, slope_axis_xz, search_radius,
    )
    all_confirmed = confirmed_roof + confirmed_down

    return AnchorTraceResult(
        anchor_xz=(ax, az),
        anchor_height=start_h,
        ridge_height=current_h,
        ridge_point=ridge_pt,
        roof_slope=roof_slope,
        slope_axis=slope_axis_xz,
        upslope_trace=upslope_path,
        downslope_trace=downslope_path,
        tree_intrusion_indices=tree_intrusions + upslope_tree_intrusions,
        cross_slope_tree_indices=cross_tree,
        confirmed_roof_indices=all_confirmed,
        consistency_ratio=consistency_ratio,
        was_on_ground=on_ground,
        probe=probe,
    )


# ---------------------------------------------------------------------------
# Sweep tracer: strip-by-strip roof classification
# ---------------------------------------------------------------------------

def _trace_strip(
    pts: np.ndarray,
    kd: 'cKDTree',
    start_xz: np.ndarray,
    slope_axis_xz: np.ndarray,
    known_slope: float,
    ridge_height: float,
    base_height: float,
    search_radius: float,
    global_visited: set[int] | None = None,
) -> SweepStripResult:
    """
    Trace one strip: uphill to ridge, then downhill on the other side.
    Uses known slope parameters from the initial anchor trace — no probing.
    """
    # Find nearest point to the start position
    _, start_idx = kd.query(start_xz)
    start_h = pts[start_idx, 1]

    visited: set[int] = {start_idx}
    tree_indices: list[int] = []
    ground_indices: list[int] = []
    lower_roof_indices: list[int] = []

    # --- Uphill walk ---
    current_idx = start_idx
    current_h = start_h
    running_slope = known_slope
    upslope_path: list[int] = [current_idx]
    steps_taken = 0
    consecutive_outliers = 0
    outlier_buffer: list[int] = []

    for _ in range(300):
        neighbors = kd.query_ball_point(pts[current_idx, [0, 2]], r=search_radius)
        best_idx = -1
        best_score = -float('inf')
        best_is_outlier = False

        for ni in neighbors:
            if ni in visited:
                continue
            if global_visited is not None and ni in global_visited:
                continue
            nh = pts[ni, 1]
            if nh <= current_h - 0.02:
                continue

            step_dir = pts[ni, [0, 2]] - pts[current_idx, [0, 2]]
            step_len = float(np.linalg.norm(step_dir))
            if step_len < 0.01:
                continue

            h_gain = nh - current_h
            step_slope = h_gain / step_len

            score = step_slope
            if running_slope > 0.01:
                slope_match = 1.0 - min(abs(step_slope - running_slope) / running_slope, 1.0)
                score += slope_match * 0.3

            alignment = float(np.dot(step_dir / step_len, slope_axis_xz))
            score += alignment * 0.2

            if score > best_score:
                best_score = score
                best_idx = ni

        if best_idx == -1:
            break

        # Check if this best step is a slope outlier
        is_outlier = False
        if running_slope > 0.01 and steps_taken >= 3:
            sd = pts[best_idx, [0, 2]] - pts[current_idx, [0, 2]]
            sl = float(np.linalg.norm(sd))
            if sl > 0.01:
                ss = (pts[best_idx, 1] - current_h) / sl
                slope_ratio = ss / running_slope
                if slope_ratio > 1.6 or slope_ratio < 0.15:
                    is_outlier = True

        if is_outlier:
            consecutive_outliers += 1
            outlier_buffer.append(best_idx)
            if consecutive_outliers >= 3:
                # 3 consecutive outliers → flag all as tree
                tree_indices.extend(outlier_buffer)
                break
        else:
            # Reset streak — any buffered outliers were just noise, treat as roof
            consecutive_outliers = 0
            outlier_buffer.clear()

        visited.add(best_idx)
        if global_visited is not None:
            global_visited.add(best_idx)
        steps_taken += 1

        # Update running slope
        if not is_outlier:
            step_dir = pts[best_idx, [0, 2]] - pts[current_idx, [0, 2]]
            step_len = float(np.linalg.norm(step_dir))
            if step_len > 0.01:
                new_slope = (pts[best_idx, 1] - current_h) / step_len
                if running_slope > 0.01:
                    running_slope = 0.7 * running_slope + 0.3 * new_slope
                else:
                    running_slope = new_slope

        current_idx = best_idx
        current_h = pts[best_idx, 1]
        upslope_path.append(current_idx)

    # --- Ridge detection ---
    ridge_idx = current_idx

    # Method 1: Slope reversal — if the trace was going up/flat and then
    # starts going down, the highest point before the descent is the ridge.
    # This works for flat roofs where the slope is too small for the flat-threshold method.
    if len(upslope_path) >= 3:
        # Compute per-step slopes
        step_slopes = []
        for i in range(1, len(upslope_path)):
            p0, p1 = upslope_path[i - 1], upslope_path[i]
            d = float(np.linalg.norm(pts[p1, [0, 2]] - pts[p0, [0, 2]]))
            if d > 0.01:
                step_slopes.append((i, (pts[p1, 1] - pts[p0, 1]) / d))
            else:
                step_slopes.append((i, 0.0))

        # Find where slope goes negative after being positive/flat
        consecutive_down = 0
        for j, (path_i, s) in enumerate(step_slopes):
            if s < -0.02:  # going downhill
                consecutive_down += 1
                if consecutive_down >= 2:
                    # Ridge is the point just before the descent started
                    descent_start = step_slopes[j - consecutive_down + 1][0] if j >= consecutive_down else 1
                    ridge_idx = upslope_path[max(0, descent_start - 1)]
                    break
            else:
                consecutive_down = 0

    # Method 2: Flat-threshold — 3+ consecutive near-flat steps (original method)
    if ridge_idx == current_idx and len(upslope_path) >= 5 and known_slope > 0.01:
        flat_threshold = known_slope * 0.2
        flat_count = 0
        flat_start = None
        for i in range(1, len(upslope_path)):
            p0, p1 = upslope_path[i - 1], upslope_path[i]
            d = float(np.linalg.norm(pts[p1, [0, 2]] - pts[p0, [0, 2]]))
            if d > 0.01:
                s = (pts[p1, 1] - pts[p0, 1]) / d
                if abs(s) < flat_threshold:
                    flat_count += 1
                    if flat_start is None:
                        flat_start = i
                else:
                    flat_count = 0
                    flat_start = None
                if flat_count >= 3 and flat_start is not None:
                    ridge_idx = upslope_path[flat_start]
                    break

    # Method 3: Near known ridge height
    if abs(pts[current_idx, 1] - ridge_height) < 0.3:
        ridge_idx = current_idx

    # --- Downhill walk ---
    downslope_path: list[int] = []
    current_idx = ridge_idx
    current_h = pts[ridge_idx, 1]
    prev_h = current_h
    expected_drop = abs(known_slope) * search_radius
    consecutive_descents = 0
    terminated_by = "max_steps"

    for step in range(300):
        probe_xz = pts[current_idx, [0, 2]] + slope_axis_xz * search_radius * 0.8
        candidates = kd.query_ball_point(probe_xz, r=search_radius)

        best_idx = -1
        best_dist = float('inf')
        for ci in candidates:
            if ci in visited:
                continue
            if global_visited is not None and ci in global_visited:
                continue
            d = float(np.linalg.norm(pts[ci, [0, 2]] - probe_xz))
            if d < best_dist:
                best_dist = d
                best_idx = ci

        if best_idx == -1:
            terminated_by = "edge"
            break

        visited.add(best_idx)
        if global_visited is not None:
            global_visited.add(best_idx)
        step_h = pts[best_idx, 1]
        height_change = step_h - prev_h
        downslope_path.append(best_idx)

        # Ground detection
        if step_h < base_height - 2.0:
            ground_indices.append(best_idx)
            terminated_by = "ground"
            break

        # Lower roof detection — significant drop but above ground
        if consecutive_descents >= 3 and height_change < -1.5:
            lower_roof_indices.append(best_idx)
            terminated_by = "lower_roof"
            break

        if height_change < 0:
            consecutive_descents += 1

        # Tree detection — height goes back up after descent
        if consecutive_descents >= 2 and height_change > 0:
            threshold = expected_drop * 0.15
            if height_change > max(threshold, 0.10):
                tree_indices.append(best_idx)
                break

        current_idx = best_idx
        prev_h = step_h

    return SweepStripResult(
        strip_offset=0.0,  # caller sets this
        start_idx=start_idx,
        upslope_trace=upslope_path,
        downslope_trace=downslope_path,
        ridge_idx=ridge_idx,
        tree_indices=tree_indices,
        terminated_by=terminated_by,
        ground_indices=ground_indices,
        lower_roof_indices=lower_roof_indices,
    )


def _sweep_roof_from_anchor(
    pts: np.ndarray,
    kd: 'cKDTree',
    initial_trace: AnchorTraceResult,
    search_radius: float = 0.75,
    max_strips: int = 200,
) -> SweepResult:
    """
    Sweep the roof surface strip-by-strip from an anchor trace.
    Steps perpendicular to the slope axis, tracing up-and-over each strip.
    """
    slope_axis = initial_trace.slope_axis
    perp_axis = np.array([-slope_axis[1], slope_axis[0]])
    ridge_height = initial_trace.ridge_height
    base_height = initial_trace.anchor_height
    roof_slope = initial_trace.roof_slope

    # Starting position is the anchor's XZ
    anchor_xz = np.array([initial_trace.anchor_xz[0], initial_trace.anchor_xz[1]])

    result = SweepResult(
        anchor_xz=initial_trace.anchor_xz,
        slope_axis=slope_axis,
        perp_axis=perp_axis,
        roof_slope=roof_slope,
        ridge_height=ridge_height,
        base_height=base_height,
        strips=[],
    )

    global_visited: set[int] = set()

    # Add the initial trace as strip #0
    strip0 = SweepStripResult(
        strip_offset=0.0,
        start_idx=initial_trace.upslope_trace[0] if initial_trace.upslope_trace else 0,
        upslope_trace=initial_trace.upslope_trace,
        downslope_trace=initial_trace.downslope_trace,
        ridge_idx=None,
        tree_indices=initial_trace.tree_intrusion_indices,
        terminated_by="initial",
    )
    result.strips.append(strip0)

    # Collect initial trace points as roof
    for idx in initial_trace.upslope_trace + initial_trace.downslope_trace:
        result.roof_indices.add(idx)
        global_visited.add(idx)
    for idx in initial_trace.confirmed_roof_indices:
        result.roof_indices.add(idx)
        global_visited.add(idx)

    # Sweep in both perpendicular directions
    for direction in [1.0, -1.0]:
        consecutive_skips = 0

        for i in range(1, max_strips):
            offset = direction * search_radius * i
            start_xz = anchor_xz + perp_axis * offset

            # Find nearest point to this starting position
            dist, nearest_idx = kd.query(start_xz)

            # Too far from any point — roof has ended
            if dist > search_radius * 1.5:
                consecutive_skips += 1
                if consecutive_skips >= 3:
                    break
                continue

            # Skip if starting on a tree (way above ridge)
            if pts[nearest_idx, 1] > ridge_height + 1.0:
                consecutive_skips += 1
                if consecutive_skips >= 3:
                    break
                continue

            consecutive_skips = 0

            # Trace this strip
            strip = _trace_strip(
                pts, kd, start_xz, slope_axis,
                known_slope=roof_slope,
                ridge_height=ridge_height,
                base_height=base_height,
                search_radius=search_radius,
                global_visited=global_visited,
            )
            strip.strip_offset = offset
            result.strips.append(strip)

            # Collect results
            all_strip_pts = strip.upslope_trace + strip.downslope_trace
            for idx in all_strip_pts:
                if idx not in strip.tree_indices and idx not in strip.ground_indices and idx not in strip.lower_roof_indices:
                    result.roof_indices.add(idx)
            if strip.ridge_idx is not None:
                result.ridge_indices.add(strip.ridge_idx)
            for idx in strip.tree_indices:
                result.tree_indices.add(idx)
            for idx in strip.ground_indices:
                result.ground_indices.add(idx)
            for idx in strip.lower_roof_indices:
                result.lower_roof_indices.add(idx)

            # If this strip terminated at ground on both sides, we've passed the eave
            if strip.terminated_by == "ground":
                break

    # --- Eave detection: lowest roof points on each strip ---
    for strip in result.strips:
        # First point of upslope trace = bottom of this side
        if strip.upslope_trace:
            first_idx = strip.upslope_trace[0]
            if (first_idx in result.roof_indices
                    and first_idx not in result.ridge_indices
                    and first_idx not in result.tree_indices
                    and abs(pts[first_idx, 1] - base_height) < 0.5):
                result.eave_indices.add(first_idx)

        # Last point of downslope trace = bottom of other side
        if strip.downslope_trace:
            last_idx = strip.downslope_trace[-1]
            if (last_idx in result.roof_indices
                    and last_idx not in result.ridge_indices
                    and last_idx not in result.tree_indices
                    and abs(pts[last_idx, 1] - base_height) < 0.5):
                result.eave_indices.add(last_idx)

    logger.info(
        "Sweep complete: %d strips, %d roof pts, %d ridge pts, %d tree pts, "
        "%d ground pts, %d lower_roof pts, %d eave pts",
        len(result.strips),
        len(result.roof_indices), len(result.ridge_indices),
        len(result.tree_indices), len(result.ground_indices),
        len(result.lower_roof_indices), len(result.eave_indices),
    )

    return result


def _expand_ridge_seeds(
    pts: np.ndarray,
    kd: 'cKDTree',
    seed_indices: set[int],
    search_radius: float,
    exclude_indices: set[int] | None = None,
) -> tuple[set[int], set[int]]:
    """
    Expand sparse ridge seed points into a continuous ridge line.

    Flood-fills from seeds to nearby same-height neighbors, constrained
    to stay narrow (line, not blob) using PCA on the ridge direction.

    Returns (ridge_indices, near_ridge_indices).
    """
    if len(seed_indices) < 2:
        logger.info("Ridge expansion: only %d seeds, skipping (need 2+)", len(seed_indices))
        return seed_indices, set()

    seed_list = list(seed_indices)
    seed_heights = pts[seed_list, 1]
    height_var = float(np.var(seed_heights))

    # Height variance gate: reject if seeds are at wildly different heights.
    # Use adaptive threshold — scaled by roof height range for tolerance on
    # tall or multi-level roofs.  Floor at 0.4 for small roofs.
    height_range = float(pts[:, 1].max() - pts[:, 1].min()) if len(pts) > 0 else 1.0
    var_threshold = max(0.4, height_range * 0.15)
    if height_var > var_threshold:
        logger.info("Ridge expansion: height variance %.3f > %.3f (adaptive), skipping",
                     height_var, var_threshold)
        return seed_indices, set()

    median_h = float(np.median(seed_heights))

    # Compute ridge principal axis from seed XZ positions
    seed_xz = pts[seed_list][:, [0, 2]]
    centroid = seed_xz.mean(axis=0)
    centered = seed_xz - centroid
    if len(centered) >= 2:
        cov = centered.T @ centered
        eigvals, eigvecs = np.linalg.eigh(cov)
        ridge_axis = eigvecs[:, -1]  # principal direction
        ridge_axis = ridge_axis / np.linalg.norm(ridge_axis)
    else:
        ridge_axis = np.array([1.0, 0.0])

    exclude = exclude_indices or set()
    ridge_indices = set(seed_indices)
    near_ridge_indices: set[int] = set()

    # Flood fill up to 3 rounds
    frontier = set(seed_indices)

    for round_num in range(3):
        next_frontier: set[int] = set()

        for idx in frontier:
            neighbors = kd.query_ball_point(pts[idx, [0, 2]], r=search_radius)

            for ni in neighbors:
                if ni in ridge_indices or ni in near_ridge_indices or ni in exclude:
                    continue

                nh = pts[ni, 1]
                h_diff = abs(nh - median_h)

                # Shape constraint: perpendicular distance from ridge axis
                rel_xz = pts[ni, [0, 2]] - centroid
                along = float(np.dot(rel_xz, ridge_axis))
                perp_dist = float(np.linalg.norm(rel_xz - along * ridge_axis))

                if perp_dist > 0.75:
                    continue

                if h_diff <= 0.1:
                    ridge_indices.add(ni)
                    next_frontier.add(ni)
                elif h_diff <= 0.3:
                    near_ridge_indices.add(ni)
                    # Don't expand further from near-ridge points

        frontier = next_frontier
        if not frontier:
            break

    # --- Thin ridge to max 2 dots perpendicular to ridge axis ---
    # Slice the ridge along its principal axis into bins. In each bin,
    # keep only the 2 points closest to the ridge axis (best ridge properties).
    if len(ridge_indices) > 2:
        ridge_list = list(ridge_indices)
        ridge_xz = pts[ridge_list][:, [0, 2]]
        ridge_h = pts[ridge_list, 1]

        # Project each point onto the ridge axis
        rel = ridge_xz - centroid
        along_proj = rel @ ridge_axis  # distance along ridge
        perp_vec = np.array([-ridge_axis[1], ridge_axis[0]])
        perp_proj = np.abs(rel @ perp_vec)  # distance from ridge axis

        # Bin along the ridge direction (bin width = search_radius)
        bin_width = search_radius
        min_along = float(along_proj.min())
        bin_ids = ((along_proj - min_along) / bin_width).astype(int)

        # For each bin, keep the 2 points with smallest perpendicular distance
        # (ties broken by closest height to median = best ridge property)
        from collections import defaultdict
        bins: dict[int, list[tuple[float, float, int]]] = defaultdict(list)
        for i, bi in enumerate(bin_ids):
            # Score: primary = perp distance, secondary = height deviation
            score = perp_proj[i] + abs(ridge_h[i] - median_h) * 0.5
            bins[bi].append((score, ridge_list[i]))

        thinned: set[int] = set()
        for bi, entries in bins.items():
            entries.sort(key=lambda x: x[0])  # best score first
            for _, idx in entries[:2]:
                thinned.add(idx)

        demoted = len(ridge_indices) - len(thinned)
        if demoted > 0:
            # Demoted ridge points become near_ridge
            for idx in ridge_indices - thinned:
                near_ridge_indices.add(idx)
            ridge_indices = thinned
            logger.info("Ridge thinning: kept %d, demoted %d to near_ridge", len(thinned), demoted)

    logger.info(
        "Ridge expansion: %d seeds → %d ridge + %d near_ridge (median_h=%.2fm, axis=(%.2f,%.2f))",
        len(seed_indices), len(ridge_indices), len(near_ridge_indices),
        median_h, ridge_axis[0], ridge_axis[1],
    )

    return ridge_indices, near_ridge_indices


def trace_ridge_from_anchors(
    point_cloud: np.ndarray,
    anchor_dots: list[tuple[float, float]],
    plane_labels: np.ndarray,
    search_radius: float = 0.75,
) -> RoofTraceResult:
    """
    Run the full trace from EVERY calibration dot independently, then merge.

    Key changes from the old version:
      - Each anchor is traced independently (own visited set, own results)
      - No tree dots are written until ALL anchors are assessed
      - base_height = MEDIAN of anchor heights (not min, not ground)
      - Fallback: if no anchors provided, use the highest LiDAR point
        as a guaranteed roof reference and trace downhill from there
    """
    pts = np.asarray(point_cloud)
    empty = RoofTraceResult(
        ridge_height=float(np.percentile(pts[:, 1], 95)) if len(pts) > 0 else 0.0,
        base_height=float(np.median(pts[:, 1])) if len(pts) > 0 else 0.0,
        ridge_points=[], roof_slope=0.4, slope_axis=np.array([1.0, 0.0]),
        upslope_trace=[], downslope_trace=[],
        tree_intrusion_indices=[], cross_slope_tree_indices=[],
    )

    if len(pts) < 10 or not HAS_SCIPY:
        return empty

    xz = pts[:, [0, 2]]
    kd = cKDTree(xz)

    # --- Fallback: if no anchor dots, use the highest LiDAR point ---
    # The highest point in the cloud is almost certainly on the roof (ridge).
    # We trace downhill from it to establish a reference.
    effective_anchors = list(anchor_dots) if anchor_dots else []
    if not effective_anchors:
        peak_idx = int(np.argmax(pts[:, 1]))
        peak_xz = (float(pts[peak_idx, 0]), float(pts[peak_idx, 2]))
        effective_anchors = [peak_xz]
        logger.info(
            "No anchor dots — using highest LiDAR point as fallback: "
            "idx=%d, h=%.1fm, xz=(%.1f, %.1f)",
            peak_idx, pts[peak_idx, 1], peak_xz[0], peak_xz[1],
        )

    # --- Phase 1: Trace EVERY anchor independently ---
    # No tree dots written yet — just collecting data
    per_anchor: list[AnchorTraceResult] = []
    for ax, az in effective_anchors:
        result = _trace_single_anchor(pts, kd, ax, az, search_radius)
        if result is not None:
            per_anchor.append(result)

    if not per_anchor:
        return empty

    # --- Phase 2: Assess all traces before any tree decision ---
    # Log what each anchor found, including consistency
    for i, tr in enumerate(per_anchor):
        logger.info(
            "Anchor %d (%.1f, %.1f): anchor_h=%.1fm → ridge_h=%.1fm, "
            "slope=%.2f, consistency=%.0f%%, %d confirmed roof dots, "
            "%d intrusions, ground=%s",
            i, tr.anchor_xz[0], tr.anchor_xz[1],
            tr.anchor_height, tr.ridge_height,
            tr.roof_slope, tr.consistency_ratio * 100,
            len(tr.confirmed_roof_indices),
            len(tr.tree_intrusion_indices),
            tr.was_on_ground,
        )

    # --- Phase 3: Merge — weight by consistency ---
    # Anchors with high consistency found real roof; low consistency
    # may have wandered into a tree or noise. Use only anchors with
    # >60% consistency for the merged values.
    good_traces = [tr for tr in per_anchor if tr.consistency_ratio > 0.6]
    if not good_traces:
        # Fall back to all traces if none pass consistency
        good_traces = per_anchor
        logger.warning(
            "No anchor traces passed 60%% consistency — using all %d traces",
            len(per_anchor),
        )

    # Ridge = highest ridge from consistent traces
    ridge_height = max(tr.ridge_height for tr in good_traces)

    # Base height = MEDIAN of anchor starting heights (from consistent traces)
    # Exclude ground-relocated anchors from base height calculation —
    # their start_h is the roof entry point, which is valid
    anchor_heights = [tr.anchor_height for tr in good_traces]
    base_height = float(np.median(anchor_heights))

    logger.info(
        "Anchor heights: %s → base_height (median) = %.1fm "
        "(%d good / %d total traces)",
        [f"{h:.1f}" for h in anchor_heights], base_height,
        len(good_traces), len(per_anchor),
    )

    # Average slope and axis from consistent traces
    avg_slope = float(np.mean([tr.roof_slope for tr in good_traces]))
    axes = np.array([tr.slope_axis for tr in good_traces])
    avg_axis = axes.mean(axis=0)
    ax_len = float(np.linalg.norm(avg_axis))
    if ax_len > 1e-6:
        avg_axis /= ax_len

    # Merge all per-anchor lists
    all_ridge_points = [tr.ridge_point for tr in per_anchor]
    all_upslope = [idx for tr in per_anchor for idx in tr.upslope_trace]
    all_downslope = [idx for tr in per_anchor for idx in tr.downslope_trace]
    all_tree_intrusions = [idx for tr in per_anchor for idx in tr.tree_intrusion_indices]
    all_cross_tree = [idx for tr in per_anchor for idx in tr.cross_slope_tree_indices]
    all_probes = [tr.probe for tr in per_anchor if tr.probe is not None]

    # Collect ALL confirmed roof indices across all anchors
    all_confirmed_roof = [idx for tr in per_anchor for idx in tr.confirmed_roof_indices]

    logger.info(
        "Slope trace complete: ridge=%.2fm, base=%.2fm (median), slope=%.2f, "
        "%d anchors traced, %d confirmed roof dots, %d tree intrusions",
        ridge_height, base_height, avg_slope,
        len(per_anchor), len(all_confirmed_roof), len(all_tree_intrusions),
    )

    # --- Phase 4: Sweep each good anchor to classify the full roof ---
    from pipeline.gradient_detector import CellLabel

    sweep_labels = np.full(len(pts), CellLabel.UNSURE, dtype=int)

    all_ridge_seeds: set[int] = set()
    all_tree_set: set[int] = set()
    all_eave_set: set[int] = set()
    all_sweeps: list[SweepResult] = []

    for tr in good_traces:
        sweep = _sweep_roof_from_anchor(pts, kd, tr, search_radius)
        all_sweeps.append(sweep)

        # Apply sweep labels — ROOF wins over everything
        for idx in sweep.roof_indices:
            sweep_labels[idx] = CellLabel.ROOF
        for idx in sweep.ridge_indices:
            all_ridge_seeds.add(idx)
        for idx in sweep.ground_indices:
            if sweep_labels[idx] == CellLabel.UNSURE:
                sweep_labels[idx] = CellLabel.GROUND
        for idx in sweep.lower_roof_indices:
            if sweep_labels[idx] == CellLabel.UNSURE:
                sweep_labels[idx] = CellLabel.LOWER_ROOF
        for idx in sweep.tree_indices:
            all_tree_set.add(idx)
            if sweep_labels[idx] == CellLabel.UNSURE:
                sweep_labels[idx] = CellLabel.TREE
        for idx in sweep.eave_indices:
            all_eave_set.add(idx)

    # --- Ridge expansion: grow sparse seeds into continuous ridge line ---
    exclude_from_ridge = all_tree_set | {
        i for i in range(len(pts))
        if sweep_labels[i] in (CellLabel.GROUND, CellLabel.LOWER_ROOF)
    }
    expanded_ridge, near_ridge = _expand_ridge_seeds(
        pts, kd, all_ridge_seeds, search_radius,
        exclude_indices=exclude_from_ridge,
    )

    for idx in expanded_ridge:
        sweep_labels[idx] = CellLabel.RIDGE_DOT
    for idx in near_ridge:
        if sweep_labels[idx] in (CellLabel.ROOF, CellLabel.UNSURE):
            sweep_labels[idx] = CellLabel.NEAR_RIDGE

    # --- Eave labels ---
    for idx in all_eave_set:
        if sweep_labels[idx] in (CellLabel.ROOF, CellLabel.UNSURE):
            sweep_labels[idx] = CellLabel.EAVE_DOT

    n_roof = int((sweep_labels == CellLabel.ROOF).sum())
    n_ridge = int((sweep_labels == CellLabel.RIDGE_DOT).sum())
    n_near = int((sweep_labels == CellLabel.NEAR_RIDGE).sum())
    n_tree = int((sweep_labels == CellLabel.TREE).sum())
    n_ground = int((sweep_labels == CellLabel.GROUND).sum())
    n_lower = int((sweep_labels == CellLabel.LOWER_ROOF).sum())
    n_eave = int((sweep_labels == CellLabel.EAVE_DOT).sum())
    logger.info(
        "Sweep labels: ROOF=%d RIDGE=%d NEAR_RIDGE=%d TREE=%d GROUND=%d "
        "LOWER_ROOF=%d EAVE=%d UNSURE=%d",
        n_roof, n_ridge, n_near, n_tree, n_ground, n_lower, n_eave,
        int((sweep_labels == CellLabel.UNSURE).sum()),
    )

    return RoofTraceResult(
        ridge_height=ridge_height,
        base_height=base_height,
        ridge_points=all_ridge_points,
        roof_slope=avg_slope,
        slope_axis=avg_axis,
        upslope_trace=all_upslope,
        downslope_trace=all_downslope,
        tree_intrusion_indices=all_tree_intrusions,
        cross_slope_tree_indices=all_cross_tree,
        anchor_probes=all_probes,
        per_anchor_traces=per_anchor,
        sweep_labels=sweep_labels,
    )


# ---------------------------------------------------------------------------
# 8. Apply traced results — flood fill tree from seeds + hard ceiling
# ---------------------------------------------------------------------------

def flood_fill_tree_from_seeds(
    point_cloud: np.ndarray,
    seed_indices: list[int],
    tree_mask: np.ndarray,
    plane_labels: np.ndarray | None = None,
    search_radius: float = 0.75,
) -> np.ndarray:
    """
    BFS flood fill from confirmed tree seed points.
    Only expands through points that are NOT assigned to a RANSAC plane.
    This prevents the fill from leaking across the roof surface.
    Stops when dots drop below the seed height (back to roof surface).
    """
    if not seed_indices or not HAS_SCIPY:
        return tree_mask

    pts = np.asarray(point_cloud)
    tree_mask = tree_mask.copy()
    xz = pts[:, [0, 2]]
    kd = cKDTree(xz)

    # Use the minimum seed height as the floor — anything at or above = tree
    seed_heights = [pts[si, 1] for si in seed_indices if si < len(pts)]
    if not seed_heights:
        return tree_mask
    tree_floor = min(seed_heights) - 0.3  # small tolerance below seed

    # BFS from all seeds simultaneously
    queue = list(seed_indices)
    visited: set[int] = set(seed_indices)
    for si in seed_indices:
        tree_mask[si] = True

    while queue:
        idx = queue.pop(0)
        neighbors = kd.query_ball_point(pts[idx, [0, 2]], r=search_radius)
        for ni in neighbors:
            if ni in visited:
                continue
            visited.add(ni)
            # Only flood through unassigned points — never eat into a plane
            if plane_labels is not None and plane_labels[ni] >= 0:
                continue
            if pts[ni, 1] >= tree_floor:
                tree_mask[ni] = True
                queue.append(ni)

    return tree_mask


def apply_hard_tree_rules(
    point_cloud: np.ndarray,
    plane_labels: np.ndarray,
    tree_mask: np.ndarray,
    trace: RoofTraceResult,
    features_height_std: np.ndarray,
    features_vertical_compactness: np.ndarray,
) -> np.ndarray:
    """
    Tree detection using the slope-trace results from calibration dots.

    1. Flood fill from tree intrusion seeds (downslope anomalies)
    2. Flag cross-slope inconsistencies
    3. Absolute ceiling: anything above traced ridge + 0.5m with no plane = tree
    4. Elevated + no plane + bumpy = tree
    """
    pts = np.asarray(point_cloud)
    tree_mask = tree_mask.copy()
    n_before = int(tree_mask.sum())

    # Step 1: Flood fill from confirmed tree intrusion seeds
    all_seeds = trace.tree_intrusion_indices
    if all_seeds:
        tree_mask = flood_fill_tree_from_seeds(pts, all_seeds, tree_mask, plane_labels=plane_labels)
        logger.info(
            "Flood fill from %d tree seeds: %d → %d tree points",
            len(all_seeds), n_before, int(tree_mask.sum()),
        )

    # Step 2: Cross-slope flagging DISABLED — 0.15m threshold too tight,
    # catches ridge/hip transitions on real roofs
    # for ci in trace.cross_slope_tree_indices:
    #     if ci < len(pts) and not tree_mask[ci]:
    #         if pts[ci, 1] > trace.base_height + 0.5:
    #             tree_mask[ci] = True

    # Step 3: Absolute ceiling — DISABLED. The ridge_height + 0.5m ceiling
    # was too aggressive, excluding 3000+ legitimate roof points and killing
    # plane-plane intersections needed for ridge dot detection.
    # ridge_ceiling = trace.ridge_height + 0.5
    # for i in range(len(pts)):
    #     if tree_mask[i]:
    #         continue
    #     h = pts[i, 1]
    #     on_plane = plane_labels[i] >= 0
    #     if not on_plane and h > ridge_ceiling:
    #         tree_mask[i] = True
    #         continue

        # Step 4: Elevated + no plane + bumpy — DISABLED, 0.15 hstd too low,
        # catches roof-edge points near plane boundaries
        # if (not on_plane
        #         and h > trace.base_height + 1.5
        #         and features_height_std[i] > 0.15):
        #     tree_mask[i] = True

    n_added = int(tree_mask.sum()) - n_before
    if n_added > 0:
        logger.info(
            "Hard tree rules: %d additional points excluded "
            "(ridge=%.1fm, base=%.1fm, slope=%.2f)",
            n_added, trace.ridge_height, trace.base_height, trace.roof_slope,
        )

    return tree_mask


# ---------------------------------------------------------------------------
# 9. Grid-level tree exclusion (for gradient detector)
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
