"""
Color classifier v2 — wraps v1 and adds directional pattern-based
UNSURE resolution.

Instead of copying the nearest neighbor's label, each UNSURE point
probes outward in 8 compass directions in XZ, collecting classified
neighbors along each ray.  A voting system with height-awareness
decides the label:

  - Unanimous surround → adopt that label
  - ROOF on most sides + height matches roof → ROOF
  - ROOF on one side, GROUND on the other → likely EAVE
  - TREE majority + high texture → TREE
  - Not enough evidence → stays UNSURE (no guessing)

Drop-in replacement: same function signature as v1.
"""

from __future__ import annotations

import logging
import math
from collections import Counter

import numpy as np

try:
    from scipy.spatial import cKDTree
    HAS_SCIPY = True
except ImportError:
    HAS_SCIPY = False

from pipeline.gradient_detector import CellLabel
from pipeline.color_classifier import classify_points_for_color as _v1_classify
from models.schemas import RoofPlane, RoofEdge

logger = logging.getLogger(__name__)

# 8 compass directions in XZ plane (unit vectors)
_DIRECTIONS = np.array([
    [1, 0],    # E
    [1, 1],    # NE
    [0, 1],    # N
    [-1, 1],   # NW
    [-1, 0],   # W
    [-1, -1],  # SW
    [0, -1],   # S
    [1, -1],   # SE
], dtype=np.float64)
_DIRECTIONS = _DIRECTIONS / np.linalg.norm(_DIRECTIONS, axis=1, keepdims=True)

# Labels that count as "roof surface" for voting
_ROOF_LABELS = frozenset({
    CellLabel.ROOF, CellLabel.FLAT_ROOF, CellLabel.LOWER_ROOF,
    CellLabel.RIDGE_DOT, CellLabel.NEAR_RIDGE, CellLabel.EAVE_DOT,
    CellLabel.VALLEY_DOT,
})

# Labels that count as structural (not UNSURE, not GROUND)
_STRUCTURAL_LABELS = _ROOF_LABELS | frozenset({CellLabel.TREE})


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
    V2 color classification — runs v1 first, then resolves remaining
    UNSURE points using directional pattern probing.

    Same signature and return type as v1.
    """
    # Run the full v1 pipeline
    labels, ridge_lines = _v1_classify(
        pts, planes, point_labels,
        edges=edges,
        adjacency=adjacency,
        components=components,
        height_ground_threshold=height_ground_threshold,
        sweep_labels=sweep_labels,
    )

    unsure_before = int((labels == CellLabel.UNSURE).sum())
    if unsure_before == 0 or not HAS_SCIPY:
        logger.info("V2 classifier: no UNSURE points to resolve (or no scipy)")
        return labels, ridge_lines

    # Build height reference per plane for height-aware voting
    plane_heights = _build_plane_height_map(pts, point_labels, planes)

    # Directional probe to resolve UNSURE points
    resolved = _resolve_unsure_directional(
        pts, labels, point_labels, plane_heights, height_ground_threshold,
    )

    unsure_after = int((resolved == CellLabel.UNSURE).sum())
    logger.info(
        "V2 classifier: resolved %d / %d UNSURE points (%d remain)",
        unsure_before - unsure_after, unsure_before, unsure_after,
    )

    # Log updated distribution
    counts = np.bincount(resolved.ravel(), minlength=13)
    logger.info(
        "V2 color labels — GROUND:%d ROOF:%d LOWER_ROOF:%d FLAT_ROOF:%d "
        "UNSURE:%d RIDGE_DOT:%d NEAR_RIDGE:%d EAVE_DOT:%d TREE:%d",
        counts[CellLabel.GROUND], counts[CellLabel.ROOF],
        counts[CellLabel.LOWER_ROOF], counts[CellLabel.FLAT_ROOF],
        counts[CellLabel.UNSURE], counts[CellLabel.RIDGE_DOT],
        counts[CellLabel.NEAR_RIDGE], counts[CellLabel.EAVE_DOT],
        counts[CellLabel.TREE],
    )

    return resolved, ridge_lines


# ── Directional pattern probing ──────────────────────────────────────

def _resolve_unsure_directional(
    pts: np.ndarray,
    labels: np.ndarray,
    point_labels: np.ndarray,
    plane_heights: dict[int, float],
    height_ground_threshold: float,
    probe_radius: float = 1.5,
    probe_steps: int = 5,
    min_votes: int = 3,
) -> np.ndarray:
    """
    For each UNSURE point, probe in 8 directions to find patterns.

    Each probe ray walks outward in steps, finding the first classified
    point along that direction.  The 8 directional votes are then
    analyzed to determine the most likely label.

    Parameters:
        probe_radius: max distance to probe in each direction (metres)
        probe_steps: number of steps per direction
        min_votes: minimum classified directions needed to assign a label
    """
    result = labels.copy()
    N = len(pts)

    unsure_mask = labels == CellLabel.UNSURE
    unsure_indices = np.where(unsure_mask)[0]
    if len(unsure_indices) == 0:
        return result

    # Build XZ KDTree for spatial lookups
    xz = pts[:, [0, 2]]
    tree = cKDTree(xz)

    # Pre-compute: for classified points, their label and height
    classified_mask = labels != CellLabel.UNSURE
    classified_indices = np.where(classified_mask)[0]
    if len(classified_indices) == 0:
        return result

    # Build a KDTree of only classified points for faster lookups
    classified_xz = xz[classified_indices]
    classified_tree = cKDTree(classified_xz)

    step_size = probe_radius / probe_steps
    search_radius = step_size * 0.6  # search cone around each step

    # Process in batches for logging
    total = len(unsure_indices)
    resolved_count = 0

    for unsure_idx in unsure_indices:
        pt_xz = xz[unsure_idx]
        pt_height = pts[unsure_idx, 1]

        # Probe 8 directions
        direction_votes = []
        direction_heights = []

        for direction in _DIRECTIONS:
            vote = _probe_direction(
                pt_xz, direction, step_size, probe_steps, search_radius,
                classified_tree, classified_indices, pts, labels,
            )
            if vote is not None:
                direction_votes.append(vote[0])   # label
                direction_heights.append(vote[1])  # height of the voted point

        if len(direction_votes) < min_votes:
            continue  # not enough evidence

        # Analyze the vote pattern
        new_label = _analyze_votes(
            direction_votes, direction_heights,
            pt_height, plane_heights, point_labels[unsure_idx],
            height_ground_threshold,
        )

        if new_label is not None:
            result[unsure_idx] = new_label
            resolved_count += 1

    return result


def _probe_direction(
    origin_xz: np.ndarray,
    direction: np.ndarray,
    step_size: float,
    num_steps: int,
    search_radius: float,
    classified_tree: 'cKDTree',
    classified_indices: np.ndarray,
    pts: np.ndarray,
    labels: np.ndarray,
) -> tuple[int, float] | None:
    """
    Walk along a direction from origin, return the first classified
    point's (label, height) found.

    This finds what the UNSURE point "sees" when looking in this direction —
    the first non-UNSURE neighbor tells us what region borders us here.
    """
    for step in range(1, num_steps + 1):
        probe_xz = origin_xz + direction * step_size * step

        # Find classified points near this probe position
        nearby_classified = classified_tree.query_ball_point(probe_xz, r=search_radius)
        if not nearby_classified:
            continue

        # Return the closest one
        best_dist = float('inf')
        best_label = None
        best_height = 0.0
        for ci in nearby_classified:
            real_idx = classified_indices[ci]
            d = np.linalg.norm(probe_xz - pts[real_idx, [0, 2]])
            if d < best_dist:
                best_dist = d
                best_label = labels[real_idx]
                best_height = pts[real_idx, 1]

        if best_label is not None:
            return (int(best_label), float(best_height))

    return None  # nothing found in this direction


def _analyze_votes(
    votes: list[int],
    heights: list[float],
    point_height: float,
    plane_heights: dict[int, float],
    plane_idx: int,
    height_ground_threshold: float,
) -> int | None:
    """
    Analyze directional votes to decide a label.

    Rules (in priority order):
    1. If 6+/8 directions agree on one label → adopt it (strong consensus)
    2. If all roof-family labels and point height is near roof height → ROOF
    3. If mix of ROOF and GROUND → check if this is an EAVE transition
    4. If majority TREE and no roof-height match → TREE
    5. If majority GROUND and point is low → GROUND
    6. Otherwise → None (stay UNSURE, don't guess)
    """
    n_votes = len(votes)
    counter = Counter(votes)
    most_common_label, most_common_count = counter.most_common(1)[0]

    # Categorize votes
    roof_votes = sum(1 for v in votes if v in _ROOF_LABELS)
    ground_votes = sum(1 for v in votes if v == CellLabel.GROUND)
    tree_votes = sum(1 for v in votes if v == CellLabel.TREE)

    # Mean height of voted neighbors
    mean_vote_height = sum(heights) / len(heights) if heights else 0
    # Height of roof planes (if point belongs to one)
    ref_plane_height = plane_heights.get(plane_idx)

    # Rule 1: Strong consensus (75%+ agree)
    if most_common_count >= max(6, int(n_votes * 0.75)):
        # Validate with height for ROOF labels
        if most_common_label in _ROOF_LABELS:
            if ref_plane_height is not None:
                if abs(point_height - ref_plane_height) < 2.0:
                    return most_common_label
            elif abs(point_height - mean_vote_height) < 1.5:
                return most_common_label
        elif most_common_label == CellLabel.GROUND:
            if point_height < height_ground_threshold:
                return CellLabel.GROUND
        elif most_common_label == CellLabel.TREE:
            return CellLabel.TREE
        else:
            return most_common_label

    # Rule 2: Mostly roof-family + height consistent → ROOF
    if roof_votes >= n_votes * 0.6:
        if ref_plane_height is not None and abs(point_height - ref_plane_height) < 1.5:
            return CellLabel.ROOF
        # Check against mean height of roof neighbors
        roof_heights = [h for v, h in zip(votes, heights) if v in _ROOF_LABELS]
        if roof_heights:
            mean_roof_h = sum(roof_heights) / len(roof_heights)
            if abs(point_height - mean_roof_h) < 1.0:
                return CellLabel.ROOF

    # Rule 3: ROOF + GROUND mix → possible EAVE
    if roof_votes >= 2 and ground_votes >= 2:
        # Point at roof height with ground nearby = eave transition
        roof_heights = [h for v, h in zip(votes, heights) if v in _ROOF_LABELS]
        ground_heights = [h for v, h in zip(votes, heights) if v == CellLabel.GROUND]
        if roof_heights and ground_heights:
            mean_roof = sum(roof_heights) / len(roof_heights)
            mean_ground = sum(ground_heights) / len(ground_heights)
            # Point is closer to roof height → eave
            if abs(point_height - mean_roof) < abs(point_height - mean_ground):
                if point_height > mean_ground + 0.5:
                    return CellLabel.EAVE_DOT

    # Rule 4: Majority TREE
    if tree_votes > n_votes * 0.5:
        # Don't classify as tree if height matches a known roof plane
        if ref_plane_height is not None and abs(point_height - ref_plane_height) < 1.0:
            return None  # ambiguous — stay UNSURE
        return CellLabel.TREE

    # Rule 5: Majority GROUND + low height
    if ground_votes > n_votes * 0.5 and point_height < height_ground_threshold:
        return CellLabel.GROUND

    # Rule 6: Moderate roof consensus (50%+) with height match
    if roof_votes >= n_votes * 0.5:
        roof_heights = [h for v, h in zip(votes, heights) if v in _ROOF_LABELS]
        if roof_heights:
            mean_roof = sum(roof_heights) / len(roof_heights)
            if abs(point_height - mean_roof) < 0.8:
                return CellLabel.ROOF

    # Not enough evidence — don't guess
    return None


# ── Helpers ──────────────────────────────────────────────────────────

def _build_plane_height_map(
    pts: np.ndarray,
    point_labels: np.ndarray,
    planes: list[RoofPlane],
) -> dict[int, float]:
    """Build a map from plane index → mean height of points on that plane."""
    heights = {}
    for pi, plane in enumerate(planes):
        mask = point_labels == pi
        if mask.any():
            heights[pi] = float(np.mean(pts[mask, 1]))
    return heights
