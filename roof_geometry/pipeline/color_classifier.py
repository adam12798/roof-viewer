"""
Minimal point-cloud color classifier.

Takes RANSAC planes + edges and assigns per-point color labels
(ROOF, LOWER_ROOF, FLAT_ROOF, RIDGE_DOT, EAVE_DOT, GROUND, etc.)
with NO tree detection, pattern learning, or scrubbing.

This is a clean replacement for the classification steps in
plane_classifier.py, which are currently disabled.
"""

from __future__ import annotations

import logging
from collections import Counter

import numpy as np

try:
    from scipy.spatial import cKDTree
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False

from pipeline.gradient_detector import CellLabel
from models.schemas import RoofPlane, RoofEdge, EdgeType

logger = logging.getLogger(__name__)


def classify_points_for_color(
    pts: np.ndarray,
    planes: list[RoofPlane],
    point_labels: np.ndarray,
    edges: list[RoofEdge] | None = None,
    adjacency: dict[str, list[str]] | None = None,
    components: list[list[str]] | None = None,
    height_ground_threshold: float = 2.0,
    sweep_labels: 'np.ndarray | None' = None,
) -> tuple[np.ndarray, list[tuple[np.ndarray, np.ndarray]]]:
    """
    Assign color labels to every point based on plane membership and edges.

    When sweep_labels is provided (from the sweep tracer), it takes priority
    for ROOF, LOWER_ROOF, GROUND, and TREE labels. Ridge/valley labels still
    come from plane-plane edge intersections.

    Returns (per_point_labels, ridge_lines).
    """
    N = len(pts)
    labels = np.full(N, CellLabel.UNSURE, dtype=int)
    ridge_lines: list[tuple[np.ndarray, np.ndarray]] = []

    # ---- Sweep labels take priority when available ----
    if sweep_labels is not None:
        # Copy sweep classifications for ROOF, GROUND, LOWER_ROOF, TREE
        has_sweep = sweep_labels != CellLabel.UNSURE
        labels[has_sweep] = sweep_labels[has_sweep]

        n_swept = int(has_sweep.sum())
        logger.info("Color classifier: using sweep labels for %d / %d points", n_swept, N)

        # Ridge/valley still from plane-plane edges (geometrically accurate)
        if edges:
            ridge_lines = _classify_ridge_valley(
                labels, pts, planes, edges, point_labels,
            )

        # Eave detection for points not already classified
        if HAS_SCIPY:
            _classify_eaves(labels, pts, point_labels, planes)
    else:
        # ---- Fallback: RANSAC-based classification ----
        # Step 1: Plane-assigned points → ROOF / FLAT_ROOF
        for pi, plane in enumerate(planes):
            mask = point_labels == pi
            if not mask.any():
                continue
            if plane.is_flat:
                labels[mask] = CellLabel.FLAT_ROOF
            else:
                labels[mask] = CellLabel.ROOF

        logger.info("Color classifier: %d points on %d planes labeled ROOF/FLAT_ROOF",
                    int((labels == CellLabel.ROOF).sum() + (labels == CellLabel.FLAT_ROOF).sum()),
                    len(planes))

        # Step 2: LOWER_ROOF
        if adjacency and len(planes) > 1 and components:
            _classify_lower_roofs(labels, point_labels, planes, adjacency, edges, components)

        # Step 3: Ridge / Valley from plane intersections
        if edges:
            ridge_lines = _classify_ridge_valley(
                labels, pts, planes, edges, point_labels,
            )

        # Step 4: Ground — unassigned low points
        unassigned = point_labels == -1
        low = pts[:, 1] < height_ground_threshold
        ground_mask = unassigned & low & (labels == CellLabel.UNSURE)
        labels[ground_mask] = CellLabel.GROUND

        # Step 5: Eave — plane boundary adjacent to ground
        if HAS_SCIPY:
            _classify_eaves(labels, pts, point_labels, planes)

    # Log distribution
    counts = np.bincount(labels.ravel(), minlength=13)
    logger.info(
        "Color labels — GROUND:%d ROOF:%d LOWER_ROOF:%d FLAT_ROOF:%d "
        "UNSURE:%d RIDGE_DOT:%d NEAR_RIDGE:%d EAVE_DOT:%d",
        counts[CellLabel.GROUND], counts[CellLabel.ROOF],
        counts[CellLabel.LOWER_ROOF], counts[CellLabel.FLAT_ROOF],
        counts[CellLabel.UNSURE], counts[CellLabel.RIDGE_DOT],
        counts[CellLabel.NEAR_RIDGE], counts[CellLabel.EAVE_DOT],
    )

    return labels, ridge_lines


# ---------------------------------------------------------------------------
# LOWER_ROOF
# ---------------------------------------------------------------------------

def _classify_lower_roofs(
    labels: np.ndarray,
    point_labels: np.ndarray,
    planes: list[RoofPlane],
    adjacency: dict[str, list[str]],
    edges: list[RoofEdge] | None,
    components: list[list[str]],
) -> None:
    """Mark planes significantly below their component neighbors as LOWER_ROOF.

    Uses the LARGEST plane's height as the reference instead of median.
    The largest plane is the main roof — anything well below it is a
    porch, garage, or addition. This prevents tree canopy planes from
    inflating the reference height.
    """
    plane_map = {p.id: p for p in planes}
    plane_idx_by_id = {p.id: i for i, p in enumerate(planes)}

    # Ridge partners — never demote relative to each other
    ridge_partners: set[tuple[str, str]] = set()
    if edges:
        for e in edges:
            if e.edge_type in (EdgeType.ridge, EdgeType.hip) and len(e.plane_ids) == 2:
                a, b = e.plane_ids
                ridge_partners.add((a, b))
                ridge_partners.add((b, a))

    for comp in components:
        if len(comp) < 2:
            continue

        comp_planes = [plane_map[pid] for pid in comp if pid in plane_map]
        if not comp_planes:
            continue

        # Use the LARGEST plane as reference — it's the main roof
        largest = max(comp_planes, key=lambda p: p.area_m2)
        ref_height = largest.height_m

        for plane in comp_planes:
            if plane.id == largest.id:
                continue
            # Don't demote ridge partners
            if (plane.id, largest.id) in ridge_partners:
                continue
            # Significantly below the main roof → LOWER_ROOF
            if plane.height_m < ref_height - 1.5:
                pi = plane_idx_by_id.get(plane.id)
                if pi is not None:
                    mask = point_labels == pi
                    labels[mask] = CellLabel.LOWER_ROOF

    logger.info("LOWER_ROOF: reference=largest plane (%.1fm), %d points demoted",
                ref_height if comp_planes else 0,
                int((labels == CellLabel.LOWER_ROOF).sum()))


# ---------------------------------------------------------------------------
# Ridge / Valley
# ---------------------------------------------------------------------------

def _classify_ridge_valley(
    labels: np.ndarray,
    pts: np.ndarray,
    planes: list[RoofPlane],
    edges: list[RoofEdge],
    point_labels: np.ndarray,
    ridge_dist: float = 0.15,
    near_ridge_dist: float = 0.30,
) -> list[tuple[np.ndarray, np.ndarray]]:
    """Assign RIDGE_DOT, NEAR_RIDGE, VALLEY_DOT from plane-plane intersections."""
    ridge_lines: list[tuple[np.ndarray, np.ndarray]] = []

    xz_tree = None
    if HAS_SCIPY and len(pts) > 0:
        xz_tree = cKDTree(pts[:, [0, 2]])

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

        # Distance from every point to this edge segment
        to_pts = pts - start
        proj_along = to_pts @ edge_dir
        proj_clamped = np.clip(proj_along, 0, edge_len)
        closest = start + proj_clamped[:, np.newaxis] * edge_dir
        dist_to_edge = np.linalg.norm(pts - closest, axis=1)

        roof_mask = (
            (labels == CellLabel.ROOF)
            | (labels == CellLabel.FLAT_ROOF)
            | (labels == CellLabel.LOWER_ROOF)
        )

        if edge.edge_type == EdgeType.valley:
            valley_candidates = (dist_to_edge < ridge_dist) & roof_mask
            labels[valley_candidates] = CellLabel.VALLEY_DOT
            continue

        # Ridge or hip
        ridge_candidates = (dist_to_edge < ridge_dist) & roof_mask
        near_ridge_candidates = (
            (dist_to_edge >= ridge_dist)
            & (dist_to_edge < near_ridge_dist)
            & roof_mask
        )

        # Two-plane guard: require points from 2+ planes nearby
        if xz_tree is not None and len(edge.plane_ids) == 2:
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

    return ridge_lines


# ---------------------------------------------------------------------------
# Eaves
# ---------------------------------------------------------------------------

def _classify_eaves(
    labels: np.ndarray,
    pts: np.ndarray,
    point_labels: np.ndarray,
    planes: list[RoofPlane],
    search_radius: float = 1.0,
) -> None:
    """Mark plane boundary points adjacent to GROUND as EAVE_DOT."""
    tree = cKDTree(pts[:, [0, 2]])

    for pi, plane in enumerate(planes):
        plane_mask = point_labels == pi
        if not plane_mask.any():
            continue

        plane_indices = np.where(plane_mask)[0]
        for idx in plane_indices:
            pt_xz = pts[idx, [0, 2]]
            nearby = tree.query_ball_point(pt_xz, r=search_radius)

            for ni in nearby:
                if ni == idx:
                    continue
                if point_labels[ni] != pi and labels[ni] == CellLabel.GROUND:
                    if labels[idx] in (CellLabel.ROOF, CellLabel.FLAT_ROOF, CellLabel.LOWER_ROOF):
                        labels[idx] = CellLabel.EAVE_DOT
                    break
