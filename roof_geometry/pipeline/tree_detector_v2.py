"""
Tree detector v2 — wraps v1 and adds post-sweep tree identification.

V1 detects trees only via the sweep tracer:
  - Slope consistency (3 consecutive outliers)
  - Height-increase on downhill

This misses trees in unswept areas and canopies that RANSAC accepted
as roof planes.  V2 adds three post-sweep checks:

  1. RANSAC Plane Canopy Audit — tests if a RANSAC plane slices through
     a 3D volume (tree canopy) rather than sitting on a surface (roof).
     Checks: residual spread, plane at mid-height, vertical extent,
     height-to-footprint ratio.  ALL four must pass (conservative).

  2. Region Scatter Scoring — scores UNSURE points for tree-like
     geometry using 5 signals (need 3+):
       - Eigenvalue scatter (isotropic = tree, planar = roof)
       - Height std in neighborhood
       - Low planarity
       - Vertical compactness (taller than wide)
       - Vertical range in KNN neighborhood

  3. Conservative Seed Expansion — BFS from new tree seeds:
       - Only expands to UNSURE points (never overrides ROOF)
       - Won't cross into validated RANSAC planes
       - Height-drop guard (max 1m below seed)
       - Max 3 hops from any seed

Drop-in replacement: same function signature and return type as v1.
To activate:  change plane_classifier.py import to tree_detector_v2
To revert:    change back to tree_detector
"""

from __future__ import annotations

import logging
from collections import deque

import numpy as np

try:
    from scipy.spatial import cKDTree
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False

from pipeline.tree_detector import trace_ridge_from_anchors as _v1_trace
from pipeline.tree_detector import RoofTraceResult  # noqa: F401 — re-export

logger = logging.getLogger(__name__)


# ── Configuration ──────────────────────────────────────────────────────
# All thresholds deliberately conservative.  The original sophisticated
# tree detection was disabled because thresholds were too aggressive and
# caused false positives on roof ridges, hips, and edges.

# Check 1: Canopy audit
_CANOPY_DIST_STD_MIN = 0.25       # min std of signed distances to plane (m)
_CANOPY_VERT_EXTENT_MIN = 1.2     # min vertical extent of plane cluster (m)
_CANOPY_REL_POS_LO = 0.25         # plane centroid must be above this fraction
_CANOPY_REL_POS_HI = 0.75         # plane centroid must be below this fraction
_CANOPY_HEIGHT_RATIO_MIN = 0.4    # min vertical-extent / footprint-radius

# Check 2: Scatter scoring
_SCATTER_MIN = 0.15               # eigenvalue scatter (λ3 / Σλ)
_HEIGHT_STD_MIN = 0.35            # local height std (m)
_PLANARITY_MAX = 0.3              # (λ2 - λ3) / λ1
_COMPACTNESS_MIN = 1.2            # Y-range / XZ-radius
_Y_RANGE_MIN = 0.8                # vertical range in KNN ball (m)
_MIN_TREE_SIGNALS = 3             # need ≥ this many of 5 signals

# Check 3: Expansion
_EXPAND_RADIUS = 0.6              # BFS step radius (m)
_EXPAND_MAX_HOPS = 3              # max BFS depth
_EXPAND_HEIGHT_DROP_MAX = 1.0     # don't expand this far below seed (m)


# ── Public API ─────────────────────────────────────────────────────────

def trace_ridge_from_anchors(
    point_cloud: np.ndarray,
    anchor_dots: list[tuple[float, float]],
    plane_labels: np.ndarray,
    search_radius: float = 0.75,
) -> RoofTraceResult:
    """
    V2 trace — runs v1 sweep tracer, then applies additional tree
    identification on remaining UNSURE points.

    Same signature and return type as v1.
    """
    # Run v1 unchanged
    result = _v1_trace(point_cloud, anchor_dots, plane_labels, search_radius)

    # Guard: nothing to enhance
    if result.sweep_labels is None or not HAS_SCIPY:
        return result

    pts = np.asarray(point_cloud, dtype=np.float64)
    if len(pts) < 20:
        return result

    # Lazy import to avoid circular dependency
    # (gradient_detector → plane_classifier → tree_detector_v2 → gradient_detector)
    from pipeline.gradient_detector import CellLabel

    sweep = result.sweep_labels.copy()
    v1_tree = int((sweep == CellLabel.TREE).sum())
    v1_unsure = int((sweep == CellLabel.UNSURE).sum())

    if v1_unsure == 0:
        logger.info("V2 tree: no UNSURE points to analyze")
        return result

    # Wrap in try/except so v1 result is never lost
    try:
        sweep, new_count, n_canopy, n_scatter = _enhance_tree_detection(
            pts, plane_labels, sweep, CellLabel,
        )
    except Exception as e:
        logger.warning("V2 tree detection failed, returning v1 result: %s", e)
        return result

    # Apply enhanced labels
    result.sweep_labels = sweep

    v2_tree = int((sweep == CellLabel.TREE).sum())
    v2_unsure = int((sweep == CellLabel.UNSURE).sum())

    if new_count > 0:
        # Update tree intrusion list
        new_tree_indices = list(
            set(int(i) for i in np.where(sweep == CellLabel.TREE)[0])
            - set(result.tree_intrusion_indices)
        )
        result.tree_intrusion_indices = (
            result.tree_intrusion_indices + new_tree_indices
        )

    logger.info(
        "V2 tree: +%d tree points (%d canopy-plane, %d scatter-scored), "
        "TREE %d→%d, UNSURE %d→%d",
        new_count, n_canopy, n_scatter,
        v1_tree, v2_tree, v1_unsure, v2_unsure,
    )

    return result


# ── Core logic ─────────────────────────────────────────────────────────

def _enhance_tree_detection(pts, plane_labels, sweep, CellLabel):
    """
    Run all three checks and apply results.

    Returns (updated_sweep, new_tree_count, n_canopy_planes, n_scatter_seeds).
    """
    N = len(pts)

    # Check 1: Audit RANSAC planes for canopy slices
    canopy_planes = _audit_ransac_planes(pts, plane_labels)

    # Mark UNSURE points on canopy planes as tree seeds
    canopy_seed_mask = np.zeros(N, dtype=bool)
    for pi in canopy_planes:
        canopy_seed_mask |= (plane_labels == pi) & (sweep == CellLabel.UNSURE)
    n_canopy = int(canopy_seed_mask.sum())

    # Check 2: Score remaining UNSURE points for scatter
    scatter_mask = _score_unsure_scatter(pts, sweep, CellLabel)
    n_scatter = int(scatter_mask.sum())

    # Combine seeds
    all_seeds = canopy_seed_mask | scatter_mask

    # Check 3: Expand from seeds
    if all_seeds.any():
        expanded = _expand_tree_seeds(
            pts, sweep, all_seeds, plane_labels, canopy_planes, CellLabel,
        )
    else:
        expanded = all_seeds

    # Apply: only override UNSURE
    overridable = sweep == CellLabel.UNSURE
    new_tree = expanded & overridable
    sweep[new_tree] = CellLabel.TREE
    new_count = int(new_tree.sum())

    return sweep, new_count, len(canopy_planes), n_scatter


# ── Check 1: RANSAC Plane Canopy Audit ─────────────────────────────────

def _audit_ransac_planes(pts, plane_labels):
    """
    Test each RANSAC plane for tree-canopy characteristics.

    A tree canopy slice has:
      - Points spread in a VOLUME (high distance-to-plane std)
      - Fitted plane at MID-HEIGHT of the cluster (not at the top)
      - Significant vertical extent (> 1.2 m)
      - Compact footprint relative to height

    A real roof plane has:
      - Points on a SURFACE (low distance-to-plane std, < 0.1 m)
      - Plane at the TOP of its cluster
      - Low vertical extent (tight to the surface)
      - Wider than tall

    All four conditions must be met to flag a plane (conservative).
    """
    canopy_planes = set()
    unique_planes = [p for p in np.unique(plane_labels) if p >= 0]

    for pi in unique_planes:
        mask = plane_labels == pi
        plane_pts = pts[mask]

        if len(plane_pts) < 15:
            continue

        # Fit plane via SVD
        centroid = plane_pts.mean(axis=0)
        centered = plane_pts - centroid
        try:
            _, _, vh = np.linalg.svd(centered, full_matrices=False)
        except np.linalg.LinAlgError:
            continue
        normal = vh[2]  # direction of least variance

        # Signed distances from fitted plane
        signed_dist = centered @ normal
        dist_std = float(np.std(signed_dist))

        # Vertical extent of points on this plane
        y_min = float(plane_pts[:, 1].min())
        y_max = float(plane_pts[:, 1].max())
        vertical_extent = y_max - y_min

        # Where does the plane centroid sit in the vertical range?
        # Roofs: near 1.0 (surface IS the top).  Trees: near 0.5.
        if vertical_extent > 0.5:
            relative_pos = (centroid[1] - y_min) / vertical_extent
        else:
            relative_pos = 1.0  # flat cluster = roof-like

        # XY footprint
        xz = plane_pts[:, [0, 2]]
        xz_span = xz.max(axis=0) - xz.min(axis=0)
        footprint_radius = max(float(np.linalg.norm(xz_span)) / 2, 0.1)
        height_ratio = vertical_extent / footprint_radius

        # ALL four conditions required
        is_volume = dist_std > _CANOPY_DIST_STD_MIN
        is_mid = _CANOPY_REL_POS_LO < relative_pos < _CANOPY_REL_POS_HI
        is_tall = vertical_extent > _CANOPY_VERT_EXTENT_MIN
        is_compact = height_ratio > _CANOPY_HEIGHT_RATIO_MIN

        if is_volume and is_mid and is_tall and is_compact:
            canopy_planes.add(pi)
            logger.info(
                "V2 canopy audit: plane %d FLAGGED — "
                "dist_std=%.2fm, vert=%.1fm, rel_pos=%.2f, "
                "h_ratio=%.2f, %d pts",
                pi, dist_std, vertical_extent, relative_pos,
                height_ratio, len(plane_pts),
            )

    return canopy_planes


# ── Check 2: Region Scatter Scoring ────────────────────────────────────

def _score_unsure_scatter(pts, sweep_labels, CellLabel, k=20):
    """
    Score UNSURE points for tree-like geometric scatter.

    5 signals (need >= 3 to flag):
      1. Eigenvalue scatter  — isotropic point distribution
      2. Height std          — neighbors at varied elevations
      3. Low planarity       — not a flat surface
      4. Vertical compactness — taller than wide locally
      5. Large vertical range — significant Y spread in KNN
    """
    N = len(pts)
    unsure_mask = sweep_labels == CellLabel.UNSURE
    target_indices = np.where(unsure_mask)[0]

    if len(target_indices) < 5:
        return np.zeros(N, dtype=bool)

    # Build KDTree on full cloud (queries need all points as candidates)
    kd = cKDTree(pts)

    # Batch KNN — much faster than per-point queries
    k_actual = min(k, N)
    _, all_neighbors = kd.query(pts[target_indices], k=k_actual)

    tree_mask = np.zeros(N, dtype=bool)

    for i, idx in enumerate(target_indices):
        nbr_pts = pts[all_neighbors[i]]

        if len(nbr_pts) < 5:
            continue

        # Local covariance eigenvalues
        centered = nbr_pts - nbr_pts.mean(axis=0)
        cov = (centered.T @ centered) / len(nbr_pts)
        try:
            eigenvalues = np.linalg.eigvalsh(cov)
        except np.linalg.LinAlgError:
            continue

        eigenvalues = np.sort(eigenvalues)[::-1]  # λ1 >= λ2 >= λ3
        ev_sum = float(eigenvalues.sum())
        if ev_sum < 1e-10:
            continue

        # Signal 1: Scatter — λ3 / (λ1 + λ2 + λ3)
        # High = points spread in all directions (tree canopy)
        # Low  = points on a plane (roof surface)
        scatter = eigenvalues[2] / ev_sum

        # Signal 2: Height std
        height_std = float(np.std(nbr_pts[:, 1]))

        # Signal 3: Planarity — (λ2 - λ3) / λ1
        # High = strong plane.  Low = not planar.
        planarity = (
            (eigenvalues[1] - eigenvalues[2]) / eigenvalues[0]
            if eigenvalues[0] > 1e-10 else 1.0
        )

        # Signal 4: Vertical compactness — Y_range / XZ_radius
        y_range = float(nbr_pts[:, 1].max() - nbr_pts[:, 1].min())
        xz_span = np.ptp(nbr_pts[:, [0, 2]], axis=0)
        xz_r = max(float(np.linalg.norm(xz_span)) / 2, 0.01)
        compactness = y_range / xz_r

        # Signal 5: Vertical range (absolute)
        # Separate from compactness — catches large-footprint trees

        # Count passing signals
        signals = 0
        if scatter > _SCATTER_MIN:
            signals += 1
        if height_std > _HEIGHT_STD_MIN:
            signals += 1
        if planarity < _PLANARITY_MAX:
            signals += 1
        if compactness > _COMPACTNESS_MIN:
            signals += 1
        if y_range > _Y_RANGE_MIN:
            signals += 1

        if signals >= _MIN_TREE_SIGNALS:
            tree_mask[idx] = True

    return tree_mask


# ── Check 3: Conservative Seed Expansion ───────────────────────────────

def _expand_tree_seeds(pts, sweep_labels, seed_mask, plane_labels,
                       canopy_planes, CellLabel):
    """
    BFS expand from tree seeds to nearby UNSURE points.

    Guards:
      - Only expands to UNSURE points (never touches ROOF etc.)
      - Won't cross into validated RANSAC planes
      - Height-drop guard: max 1 m below seed height
      - Max 3 hops from any seed
    """
    if not seed_mask.any():
        return seed_mask.copy()

    result = seed_mask.copy()
    xz = pts[:, [0, 2]]
    kd = cKDTree(xz)

    # Queue entries: (point_index, remaining_hops, seed_height)
    queue = deque()
    for idx in np.where(seed_mask)[0]:
        queue.append((int(idx), _EXPAND_MAX_HOPS, float(pts[idx, 1])))

    visited = set(np.where(seed_mask)[0].tolist())

    while queue:
        idx, hops, seed_h = queue.popleft()
        if hops <= 0:
            continue

        neighbors = kd.query_ball_point(xz[idx], r=_EXPAND_RADIUS)

        for ni in neighbors:
            if ni in visited:
                continue
            visited.add(ni)

            # Only expand to UNSURE points
            if sweep_labels[ni] != CellLabel.UNSURE:
                continue

            # Don't cross into validated (non-canopy) RANSAC planes
            if plane_labels[ni] >= 0 and plane_labels[ni] not in canopy_planes:
                continue

            # Height guard: don't drop too far below seed
            if pts[ni, 1] < seed_h - _EXPAND_HEIGHT_DROP_MAX:
                continue

            result[ni] = True
            queue.append((ni, hops - 1, seed_h))

    return result
