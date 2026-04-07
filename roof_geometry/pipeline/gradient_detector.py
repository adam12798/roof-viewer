"""
Anchor-seeded roof plane detection from LiDAR height data.

Uses calibration anchor dots (placed ON the roof by the user) to:
  1. Learn what "roof" looks like (local roughness signature)
  2. Pre-filter the grid to only roof-like cells
  3. Trace outward from anchors in slope-aligned directions to find edges
  4. Cross the ridge to find the matching face on the other side

Three physical rules enforced:
  1. Planarity — 5x5 patch must fit a plane with low residual
  2. Consistency — slope direction must be uniform across the face
  3. Elevation — cells must be above ground level
"""

from __future__ import annotations

import collections
import enum
import logging
import math
import random
import uuid

import numpy as np
from scipy import ndimage

from pipeline.tree_detector import compute_grid_tree_mask


class CellLabel(enum.IntEnum):
    UNSURE      = 0
    GROUND      = 1
    ROOF        = 2
    LOWER_ROOF  = 3
    FLAT_ROOF   = 4
    RIDGE_DOT   = 5   # definitively on the ridge (strong conditions met)
    NEAR_RIDGE  = 6   # softer ridge candidate — fallback when RIDGE_DOT count is low
    TREE        = 7   # elevated but high local variance — tree canopy, excluded from ridge
    EAVE_DOT        = 8   # bottom edge of roof slope — parallel to ridge, height drops sharply downhill
    RIDGE_EDGE_DOT  = 9   # ridge dot at the gable end — ground on the outward side, roof on the inward side
    VALLEY_DOT      = 10  # concave plane-plane intersection (both planes slope toward the line)
    STEP_EDGE       = 11  # ROOF → LOWER_ROOF height discontinuity
    OBSTRUCTION_DOT = 12  # small non-planar cluster elevated above roof surface (chimney, vent, etc.)

from models.schemas import (
    PlaneEquation,
    PlaneType,
    Point2D,
    Point3D,
    RoofPlane,
)

logger = logging.getLogger(__name__)

try:
    from shapely.geometry import MultiPoint
    HAS_SHAPELY = True
except ImportError:
    HAS_SHAPELY = False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def detect_roof_faces(
    lidar_pts: np.ndarray,
    *,
    anchor_dots: list[tuple[float, float]] | None = None,
    grid_resolution: float = 0.5,
    patch_size: int = 0,   # 0 = auto from grid_resolution (physical ~2.5m patch)
    roughness_cap: float = 0.15,
    height_drop_max: float = 0.5,
    min_height: float = 0.5,
    max_roughness: float = 0.20,
    min_up_component: float = 0.3,
    max_regions: int = 20,
    use_plane_first: bool = True,
    **kwargs,
) -> list[RoofPlane]:
    """
    Detect roof faces using anchor-dot-seeded directional tracing.

    Parameters
    ----------
    lidar_pts : np.ndarray
        Nx3 array (x, y_height, z) — already ground-removed and filtered.
    anchor_dots : list of (x, z) tuples
        User-placed calibration points ON the roof, in local metres.
    grid_resolution : float
        Grid cell size in metres (0.5 for Google Solar DSM).
    patch_size : int
        Window size for local roughness measurement (5 = 2.5m).
    roughness_cap : float
        Max RMS residual for a patch to be considered "roof-like".
    height_drop_max : float
        Max height change per step before declaring an edge.
    min_height : float
        Min cell height to consider.
    max_roughness : float
        Post-process: reject regions with RMS > this.
    min_up_component : float
        Post-process: reject near-vertical normals.
    max_regions : int
        Max number of faces to detect.
    use_plane_first : bool
        When True, use plane-first classification (RANSAC → structure → classify).
        Falls back to the grid-based approach if plane extraction fails.
    """
    if use_plane_first:
        result = _detect_roof_faces_plane_first(
            lidar_pts,
            anchor_dots=anchor_dots,
            grid_resolution=grid_resolution,
            max_roughness=max_roughness,
            max_regions=max_regions,
        )
        if result is not None:
            return result
        logger.info("Plane-first detection returned None — falling back to grid-based approach")
    # Auto-scale cell-count parameters from physical distances so they work
    # correctly at any grid resolution (0.5m, 0.25m, etc.)
    if patch_size == 0:
        patch_size = max(5, int(round(2.5 / grid_resolution)) | 1)  # odd, ~2.5m physical

    if len(lidar_pts) < 10:
        logger.warning("Too few LiDAR points (%d)", len(lidar_pts))
        return [], None, None, None

    # Step 1: Build height grid (always, so classification grid is available)
    height_grid, x_origin, z_origin = build_height_grid(lidar_pts, grid_resolution)
    rows, cols = height_grid.shape
    logger.info("Height grid: %dx%d cells, x_origin=%.3f z_origin=%.3f", cols, rows, x_origin, z_origin)

    if rows < 5 or cols < 5:
        logger.warning("Height grid too small for detection")
        return [], None, None

    # Step 2: Compute gradients
    dx, dz = compute_gradients(height_grid)

    if not anchor_dots or len(anchor_dots) < 1:
        logger.warning("No anchor dots provided — returning classification grid only")
        # Build a basic classification grid without anchor-based roof signature
        roof_mask = _build_roughness_mask(height_grid, roughness_cap, patch_size, min_height)
        cell_labels = _classify_grid_cells(
            height_grid, roof_mask, dx, dz,
            min_height=min_height, grid_resolution=grid_resolution,
        )
        cell_grid_info = {
            'grid': cell_labels.tolist(),
            'x_origin': x_origin,
            'z_origin': z_origin,
            'resolution': grid_resolution,
            'rows': rows,
            'cols': cols,
        }
        return [], None, cell_grid_info

    # Step 3: Convert anchor dots to grid coordinates
    anchor_cells = []
    for ax, az in anchor_dots:
        ac = int(round((ax - x_origin) / grid_resolution))
        ar = int(round((az - z_origin) / grid_resolution))
        ac = max(2, min(ac, cols - 3))
        ar = max(2, min(ar, rows - 3))
        anchor_cells.append((ar, ac))
    logger.info("Anchor dots mapped to grid: %d cells", len(anchor_cells))

    # Step 4: Learn roof signature from anchor patches
    roof_roughness_thresh, slope_dir = _learn_roof_signature(
        height_grid, dx, dz, anchor_cells, patch_size, roughness_cap,
    )
    logger.info(
        "Roof signature: roughness_thresh=%.4f, slope_dir=(%.3f, %.3f)",
        roof_roughness_thresh, slope_dir[0], slope_dir[1],
    )

    # Step 5: Build roughness mask — only roof-like cells
    roof_mask = _build_roughness_mask(
        height_grid, roof_roughness_thresh, patch_size, min_height,
    )
    roof_like_count = roof_mask.sum()
    logger.info("Roof-like cells: %d / %d total", roof_like_count, rows * cols)

    # Step 6: Classify all grid cells (run BEFORE roof_like_count check so the
    # classification grid is always available for frontend visualization)
    # Anything above the highest anchor point + margin is taller than the roof — treat as tree
    anchor_heights = [float(height_grid[ar, ac])
                      for ar, ac in anchor_cells
                      if not np.isnan(height_grid[ar, ac])]
    max_roof_height = (max(anchor_heights) + 6.0) if anchor_heights else float('inf')
    logger.info("Max plausible roof height: %.2fm (anchor max %.2fm + 6m margin)",
                max_roof_height, max(anchor_heights) if anchor_heights else 0.0)

    # HARD TREE EXCLUSION: DISABLED — only calibration slope-trace active.
    # compute_grid_tree_mask was too aggressive; keeping code for future use.
    # tree_grid = compute_grid_tree_mask(height_grid, max_roof_height)
    tree_grid = None

    # Grid classification DISABLED — all color rules off, only tracer active
    # cell_labels = _classify_grid_cells(
    #     height_grid, roof_mask, dx, dz,
    #     min_height=min_height, grid_resolution=grid_resolution,
    #     max_roof_height=max_roof_height,
    #     tree_grid=tree_grid,
    # )
    cell_labels = np.zeros((rows, cols), dtype=int)  # all UNSURE
    cell_grid_info = {
        'grid': cell_labels.tolist(),
        'x_origin': x_origin,
        'z_origin': z_origin,
        'resolution': grid_resolution,
        'rows': rows,
        'cols': cols,
    }

    if roof_like_count < 3:
        logger.warning("Too few roof-like cells — returning classification grid only")
        return [], None, cell_grid_info

    # Ridge detection is handled exclusively by the plane-first path
    # (plane-plane intersections in plane_classifier.py). The gradient
    # fallback path produces faces with SVD-derived orientation only.
    ridge_cells = []
    ridge_azimuth = None
    ridge_pitch = None
    ridge_world = None
    logger.info("Gradient fallback: no ridge detection (ridge comes from plane intersections only)")

    # Step 11: Grow faces from anchor dots through roof-like cells
    assigned = np.zeros((rows, cols), dtype=bool)
    planes = []
    # Faces sharing the same ridge belong to one roof structure
    main_structure_id = str(uuid.uuid4())[:8]

    # Mark tree cells as pre-assigned so face growth never enters them
    # DISABLED — grid tree mask disabled, only calibration slope-trace active
    # if tree_grid is not None:
    #     assigned |= tree_grid

    # Grow face from the anchor side
    for ar, ac in anchor_cells:
        if assigned[ar, ac]:
            continue

        result = _grow_face(
            height_grid, dx, dz, roof_mask, assigned,
            ar, ac, grid_resolution, height_drop_max,
        )
        if result is None:
            continue
        face_mask, variance_stops = result

        # HARD TREE EXCLUSION: do NOT infer through tree. Tree cells are
        # permanently excluded. The face boundary ends at the tree edge.

        assigned |= face_mask

        # Validate edges
        edge_info = _classify_edge_dropoff(
            height_grid, face_mask, assigned,
            1.5, height_drop_max,
        )
        n_ground = len(edge_info['ground_edges'])
        n_roof = len(edge_info['roof_edges'])
        n_weak = len(edge_info['weak_edges'])
        logger.info("Face from anchor (%d,%d): %d ground edges, %d roof step-downs, %d weak",
                    ar, ac, n_ground, n_roof, n_weak)

        # Fit plane from face cells (tree cells are already excluded from the mask)
        plane = _fit_and_build_plane(
            face_mask, height_grid, x_origin, z_origin,
            grid_resolution, max_roughness, min_up_component,
            override_azimuth=ridge_azimuth,
            override_pitch=ridge_pitch,
        )
        if plane is not None:
            plane.structure_id = main_structure_id
            planes.append(plane)

    # Ridge correction, cross-the-ridge, and hip face detection are skipped
    # in the gradient fallback — no ridge geometry available. Faces are
    # grown only from anchors with SVD-derived orientation.

    # Step 12: Edge drop-off analysis — find lower roofs beyond eaves
    # After a height drop at a face boundary, check what's below:
    #   - Drops to ground (< ground_height_thresh) → true eave, stop
    #   - Drops to elevated surface → another roof (porch, addition, dormer)
    ground_height_thresh = 1.5  # metres above ground = "still a roof"

    # Classify edges of all found faces
    all_assigned_mask = assigned.copy()
    for p_idx, p in enumerate(planes):
        # We already have the face in assigned; classify its boundary
        edge_info = _classify_edge_dropoff(
            height_grid, assigned, assigned,
            ground_height_thresh, height_drop_max,
        )
        logger.info(
            "Edge analysis: %d ground edges, %d roof step-downs, %d weak edges",
            len(edge_info['ground_edges']),
            len(edge_info['roof_edges']),
            len(edge_info['weak_edges']),
        )
        break  # only need one pass over the full assigned mask

    stepdown_seeds = _find_stepdown_seeds(
        height_grid, assigned, roof_mask, ground_height_thresh,
        height_drop_max,
    )
    logger.info("Step-down seeds found: %d", len(stepdown_seeds))

    for sr, sc in stepdown_seeds:
        if assigned[sr, sc]:
            continue
        if len(planes) >= max_regions:
            break

        # Step-down faces use relaxed growth — they may not match the
        # main roof's roughness signature, so we build a local roughness
        # mask centered on the seed's own roughness
        local_thresh = _compute_local_roughness(height_grid, sr, sc, patch_size)
        local_thresh = max(local_thresh * 3.0, roughness_cap)
        local_mask = _build_roughness_mask(
            height_grid, local_thresh, patch_size, min_height=ground_height_thresh,
        )

        result = _grow_face(
            height_grid, dx, dz, local_mask, assigned,
            sr, sc, grid_resolution, height_drop_max,
        )
        if result is None:
            continue
        face_mask, _ = result

        # Validate: the face boundary must show a substantial drop-off
        # somewhere — otherwise it's not a real roof, just noise
        edge_info = _classify_edge_dropoff(
            height_grid, face_mask, assigned,
            ground_height_thresh, height_drop_max,
        )
        real_edges = len(edge_info['ground_edges']) + len(edge_info['roof_edges'])
        face_cells = int(face_mask.sum())
        if real_edges < 1 and face_cells < 20:
            logger.debug("Step-down face at (%d,%d) rejected: %d real edges, %d cells",
                        sr, sc, real_edges, face_cells)
            continue

        assigned |= face_mask

        # Let SVD determine azimuth/pitch for step-down faces
        plane = _fit_and_build_plane(
            face_mask, height_grid, x_origin, z_origin,
            grid_resolution, max_roughness, min_up_component,
        )
        if plane is not None:
            # Step-down = separate structure (porch, addition, etc.)
            plane.structure_id = str(uuid.uuid4())[:8]
            planes.append(plane)

    # Step 13: Sister faces that share a ridge into one structure
    _sister_faces(planes)

    logger.info("Anchor-seeded detection complete: %d roof planes", len(planes))
    return planes, ridge_world, cell_grid_info, None


# ---------------------------------------------------------------------------
# Post-RANSAC plane validation — reject ground & tree false positives
# ---------------------------------------------------------------------------

def _validate_roof_planes(
    planes: list[RoofPlane],
    point_labels: np.ndarray,
    residuals: list[float],
    pts: np.ndarray,
    anchor_dots: list[tuple[float, float]] | None,
    height_ground_threshold: float,
    anchor_height_margin: float = 3.0,
    strict_roughness: float = 0.12,
    tree_roughness: float = 0.10,
    tree_aspect_ratio: float = 1.5,
) -> tuple[list[RoofPlane], np.ndarray, list[float]]:
    """
    Filter RANSAC planes to keep only real roof surfaces.

    Rules applied:
      1. Height floor — plane elevation must be above ground threshold
      2. Anchor height reference — plane must not be far below the roof
      3. Stricter roughness for non-anchor planes
      4. Tree shape detection (rough + round = likely tree canopy)
    """
    if not planes:
        return planes, point_labels, residuals

    # Build KDTree on XZ for spatial queries
    try:
        from scipy.spatial import cKDTree
        xz = pts[:, [0, 2]]
        kd = cKDTree(xz)
        has_kd = True
    except ImportError:
        kd = None
        has_kd = False

    # Identify ground-level points for edge consistency checks
    ground_mask = pts[:, 1] < height_ground_threshold
    ground_indices = np.where(ground_mask)[0]
    if has_kd and len(ground_indices) > 0:
        ground_xz = pts[ground_indices][:, [0, 2]]
        ground_kd = cKDTree(ground_xz)
    else:
        ground_kd = None

    # Compute anchor heights
    anchor_heights: list[float] = []
    if anchor_dots and has_kd:
        for ax, az in anchor_dots:
            _, idx = kd.query([ax, az])
            anchor_heights.append(float(pts[idx, 1]))

    min_anchor_h = min(anchor_heights) if anchor_heights else None

    # Determine which planes are near an anchor dot
    anchor_adjacent: set[int] = set()
    if anchor_dots:
        for pi, plane in enumerate(planes):
            for ax, az in anchor_dots:
                # Check if anchor is inside or near the plane boundary
                for v in plane.vertices:
                    dx = v.x - ax
                    dz = v.z - az
                    if math.sqrt(dx * dx + dz * dz) < 3.0:
                        anchor_adjacent.add(pi)
                        break
                if pi in anchor_adjacent:
                    break

    accepted: list[int] = []
    reject_reasons: dict[str, int] = {"ground": 0, "below_roof": 0, "rough": 0, "tree_shape": 0, "inconsistent_edge": 0}

    for pi, plane in enumerate(planes):
        is_anchor_adj = pi in anchor_adjacent
        roughness = residuals[pi] if pi < len(residuals) else 0.0

        # Rule 1: Height floor — reject ground-level planes
        if plane.elevation_m < height_ground_threshold and not is_anchor_adj:
            # Extra check: if the plane's highest point is also below threshold,
            # it's definitely ground. If highest point is above, it might be a
            # sloped roof that dips near ground at the eave.
            if plane.height_m < height_ground_threshold + 0.5:
                reject_reasons["ground"] += 1
                logger.info(
                    "Plane %s REJECTED (ground): elev=%.1fm, height=%.1fm, threshold=%.1fm",
                    plane.id, plane.elevation_m, plane.height_m, height_ground_threshold,
                )
                continue

        # Rule 2: Anchor height reference — reject planes far below the roof
        if min_anchor_h is not None and not is_anchor_adj:
            if plane.height_m < min_anchor_h - anchor_height_margin:
                reject_reasons["below_roof"] += 1
                logger.info(
                    "Plane %s REJECTED (below roof): height=%.1fm, min_anchor=%.1fm, margin=%.1fm",
                    plane.id, plane.height_m, min_anchor_h, anchor_height_margin,
                )
                continue

        # Rule 3: Stricter roughness for non-anchor planes
        if not is_anchor_adj and roughness > strict_roughness:
            reject_reasons["rough"] += 1
            logger.info(
                "Plane %s REJECTED (rough): residual=%.3f > %.3f (non-anchor)",
                plane.id, roughness, strict_roughness,
            )
            continue

        # Rule 4: Tree shape — rough + round = tree canopy
        if not is_anchor_adj and roughness > tree_roughness:
            # Compute aspect ratio from bounding box of vertices
            if len(plane.vertices) >= 3:
                xs = [v.x for v in plane.vertices]
                zs = [v.z for v in plane.vertices]
                dx = max(xs) - min(xs)
                dz = max(zs) - min(zs)
                short_side = min(dx, dz) if min(dx, dz) > 0.1 else 0.1
                long_side = max(dx, dz)
                aspect = long_side / short_side
                if aspect < tree_aspect_ratio:
                    reject_reasons["tree_shape"] += 1
                    logger.info(
                        "Plane %s REJECTED (tree shape): residual=%.3f, aspect=%.1f (< %.1f)",
                        plane.id, roughness, aspect, tree_aspect_ratio,
                    )
                    continue

        # Rule 5: Consistent edge — boundary points jumping from ground must
        # reach similar heights (real roof has a consistent wall/edge)
        if not is_anchor_adj and ground_kd is not None and has_kd:
            plane_mask = point_labels == pi
            plane_indices = np.where(plane_mask)[0]
            if len(plane_indices) >= 5:
                plane_pts_xz = pts[plane_indices][:, [0, 2]]
                # Find plane points with a ground neighbor within 1.5m
                boundary_jumps: list[tuple[int, float]] = []
                for local_i, global_i in enumerate(plane_indices):
                    nearby_ground = ground_kd.query_ball_point(plane_pts_xz[local_i], r=1.5)
                    if nearby_ground:
                        # Height jump = plane point height - nearest ground neighbor height
                        nearest_ground_h = min(pts[ground_indices[gi], 1] for gi in nearby_ground)
                        jump = pts[global_i, 1] - nearest_ground_h
                        if jump > 0.3:  # must be a real upward jump
                            boundary_jumps.append((global_i, jump))

                if len(boundary_jumps) >= 5:
                    jump_heights = np.array([j for _, j in boundary_jumps])
                    median_jump = float(np.median(jump_heights))
                    consistent = np.abs(jump_heights - median_jump) < 0.5
                    n_consistent = int(consistent.sum())
                    ratio = n_consistent / len(boundary_jumps)

                    if ratio < 0.5:
                        reject_reasons["inconsistent_edge"] += 1
                        logger.info(
                            "Plane %s REJECTED (inconsistent edge): %d/%d boundary pts consistent (%.0f%% < 50%%), median_jump=%.1fm",
                            plane.id, n_consistent, len(boundary_jumps), ratio * 100, median_jump,
                        )
                        continue

                    # Adjacency check: at least 5 consistent points must be near each other
                    consistent_indices = [boundary_jumps[i][0] for i in range(len(boundary_jumps)) if consistent[i]]
                    if len(consistent_indices) >= 5:
                        cons_xz = pts[consistent_indices][:, [0, 2]]
                        cons_kd = cKDTree(cons_xz)
                        # Find largest connected cluster via flood fill
                        visited_cons = set()
                        max_cluster = 0
                        for start in range(len(consistent_indices)):
                            if start in visited_cons:
                                continue
                            cluster = set()
                            frontier = [start]
                            while frontier:
                                cur = frontier.pop()
                                if cur in visited_cons:
                                    continue
                                visited_cons.add(cur)
                                cluster.add(cur)
                                nearby = cons_kd.query_ball_point(cons_xz[cur], r=1.5)
                                for ni in nearby:
                                    if ni not in visited_cons:
                                        frontier.append(ni)
                            max_cluster = max(max_cluster, len(cluster))

                        if max_cluster < 5:
                            reject_reasons["inconsistent_edge"] += 1
                            logger.info(
                                "Plane %s REJECTED (scattered edge): largest cluster=%d (< 5 adjacent)",
                                plane.id, max_cluster,
                            )
                            continue

        accepted.append(pi)

    if len(accepted) == len(planes):
        logger.info("Plane validation: all %d planes accepted", len(planes))
        return planes, point_labels, residuals

    # Rebuild with only accepted planes, renumber point_labels
    new_planes = []
    new_residuals = []
    label_map = {}  # old index → new index
    for new_idx, old_idx in enumerate(accepted):
        new_planes.append(planes[old_idx])
        new_residuals.append(residuals[old_idx])
        label_map[old_idx] = new_idx

    # Update point_labels: remap accepted, set rejected to -1
    new_labels = np.full_like(point_labels, -1)
    for old_idx, new_idx in label_map.items():
        mask = point_labels == old_idx
        new_labels[mask] = new_idx

    n_rejected = len(planes) - len(accepted)
    logger.info(
        "Plane validation: rejected %d of %d planes (ground=%d, below_roof=%d, rough=%d, tree=%d, edge=%d)",
        n_rejected, len(planes),
        reject_reasons["ground"], reject_reasons["below_roof"],
        reject_reasons["rough"], reject_reasons["tree_shape"],
        reject_reasons["inconsistent_edge"],
    )

    return new_planes, new_labels, new_residuals


# ---------------------------------------------------------------------------
# Ridge seeding from plane intersection edges
# ---------------------------------------------------------------------------

def _seed_ridge_from_plane_edges(
    lidar_pts: np.ndarray,
    sweep_labels: np.ndarray,
    edges: list,
    planes: list,
    tree_plane_ids: set | None = None,
    snap_distance: float = 0.5,
) -> tuple[np.ndarray, int]:
    """
    When the sweep tracer fails to find enough RIDGE_DOT points, seed
    them from plane-plane intersection edges classified as ridges.

    Each slope change between adjacent RANSAC planes produces a ridge
    edge.  LiDAR points near those edges at the right height are marked
    as RIDGE_DOT.

    Returns (updated_ridge_mask, n_seeded).
    """
    from models.schemas import EdgeType

    _tree_ids = tree_plane_ids or set()
    ridge_mask = sweep_labels == CellLabel.RIDGE_DOT
    n_before = int(ridge_mask.sum())

    # Collect ridge and hip edges (both represent slope boundaries)
    ridge_edges = [
        e for e in edges
        if e.edge_type in (EdgeType.ridge, EdgeType.hip)
        and not any(pid in _tree_ids for pid in e.plane_ids)
    ]

    if not ridge_edges:
        return ridge_mask, 0

    # For each ridge edge, find nearby LiDAR points and mark as RIDGE_DOT
    pts_xz = lidar_pts[:, [0, 2]]
    pts_y = lidar_pts[:, 1]

    for edge in ridge_edges:
        # Edge endpoints in XZ
        e_start = np.array([edge.start_point.x, edge.start_point.z])
        e_end = np.array([edge.end_point.x, edge.end_point.z])
        e_h_start = edge.start_point.y
        e_h_end = edge.end_point.y

        edge_vec = e_end - e_start
        edge_len = float(np.linalg.norm(edge_vec))
        if edge_len < 0.1:
            continue
        edge_dir = edge_vec / edge_len

        # For each point, compute distance to the edge line segment
        rel = pts_xz - e_start
        along = rel @ edge_dir                          # projection along edge
        along_clipped = np.clip(along, 0, edge_len)
        closest = e_start + along_clipped[:, None] * edge_dir
        perp_dist = np.linalg.norm(pts_xz - closest, axis=1)

        # Interpolate edge height at the closest point
        t = along_clipped / edge_len
        edge_h_at_pt = e_h_start + t * (e_h_end - e_h_start)

        # Points near the edge (within snap_distance) and at edge height
        near = (perp_dist < snap_distance) & (np.abs(pts_y - edge_h_at_pt) < 0.3)

        # Only seed points that are UNSURE, ROOF, or NEAR_RIDGE — don't
        # override GROUND, TREE, etc.
        for idx in np.where(near)[0]:
            lbl = sweep_labels[idx]
            if lbl in (CellLabel.UNSURE, CellLabel.ROOF, CellLabel.NEAR_RIDGE):
                ridge_mask[idx] = True
                sweep_labels[idx] = CellLabel.RIDGE_DOT

    n_seeded = int(ridge_mask.sum()) - n_before
    return ridge_mask, n_seeded


# ---------------------------------------------------------------------------
# Plane-first detection path
# ---------------------------------------------------------------------------

def _detect_roof_faces_plane_first(
    lidar_pts: np.ndarray,
    *,
    anchor_dots: list[tuple[float, float]] | None = None,
    grid_resolution: float = 0.5,
    max_roughness: float = 0.20,
    max_regions: int = 20,
) -> tuple[list[RoofPlane], tuple | None, dict] | None:
    """
    Plane-first roof detection: extract planes via RANSAC, build structural
    graph, classify points from plane membership, project back to grid.

    Returns the same (planes, ridge_world, cell_grid_info) tuple as the
    grid-based path, or None if plane extraction fails (triggers fallback).
    """
    from pipeline.plane_classifier import (
        classify_from_planes,
        compute_adaptive_thresholds,
        compute_point_features,
        compute_ridge_from_planes,
        prefilter_outliers,
        project_to_grid,
    )
    from pipeline.color_classifier_v2 import classify_points_for_color
    from pipeline.plane_extractor import extract_planes_with_membership
    from pipeline.graph_builder import (
        _build_adjacency,
        _classify_edges,
        _find_components,
    )
    from models.schemas import RoofParseOptions

    if len(lidar_pts) < 10:
        return None

    # 1. Build height grid (needed for grid output regardless)
    height_grid, x_origin, z_origin = build_height_grid(lidar_pts, grid_resolution)
    rows, cols = height_grid.shape
    logger.info("Plane-first: height grid %dx%d", cols, rows)

    if rows < 5 or cols < 5:
        return None

    # 2. Compute point features (normals, curvature, density)
    features = compute_point_features(lidar_pts)

    # 3. Compute adaptive thresholds from data statistics
    thresholds = compute_adaptive_thresholds(lidar_pts, features)

    # 4. Pre-filter outliers
    filtered_pts, keep_mask = prefilter_outliers(
        lidar_pts, thresholds.nn_median_dist,
    )

    # 5. Extract planes with per-point membership
    # Use lower thresholds than default to catch small attached structures
    # (porches, garages, additions) that share a wall with the main roof.
    options = RoofParseOptions(max_planes=max_regions)
    planes, point_labels_filtered, per_plane_residuals = extract_planes_with_membership(
        filtered_pts,
        options,
        distance_threshold=thresholds.distance_threshold,
        max_roughness=max_roughness,
        min_area_m2=4.0,    # was 15.0 — catch porches, small additions
        min_inliers=20,     # was 60 — fewer points needed for small structures
    )

    if len(planes) < 1:
        logger.info("Plane-first: no planes found — returning None for fallback")
        return None

    # Map point_labels back to original point cloud indices
    # (prefilter_outliers may have removed some points)
    N_orig = len(lidar_pts)
    point_labels = np.full(N_orig, -1, dtype=int)
    kept_indices = np.where(keep_mask)[0]
    for i, orig_idx in enumerate(kept_indices):
        point_labels[orig_idx] = point_labels_filtered[i]

    # Also map features back (use original features since they were computed on full cloud)
    # features was computed on lidar_pts (the full cloud), so it's already aligned.

    # 5b. Validate planes — reject ground and tree false positives
    planes, point_labels, per_plane_residuals = _validate_roof_planes(
        planes, point_labels, per_plane_residuals,
        lidar_pts, anchor_dots,
        height_ground_threshold=thresholds.height_ground_threshold,
    )

    if len(planes) < 1:
        logger.info("Plane validation rejected all planes — returning None for fallback")
        return None

    # 6. Build adjacency and classify edges using graph_builder
    adjacency, shared_edges_info = _build_adjacency(planes, 1.0, 0.5)
    edges = _classify_edges(planes, shared_edges_info)
    components = _find_components(planes, adjacency)

    # 7. Classify all points (tracer-only — runs trace_ridge_from_anchors for diagnostics)
    result = classify_from_planes(
        lidar_pts,
        planes,
        point_labels,
        features,
        thresholds,
        per_plane_residuals,
        anchor_dots=anchor_dots,
        adjacency=adjacency,
        edges=edges,
        components=components,
    )

    # 7b. Color classification — clean file, no tree rules
    color_labels, color_ridge_lines = classify_points_for_color(
        lidar_pts,
        planes,
        point_labels,
        edges=edges,
        adjacency=adjacency,
        components=components,
        height_ground_threshold=thresholds.height_ground_threshold,
        sweep_labels=result.sweep_labels,
    )

    # 8. Compute ridge from plane intersections
    ridge_world = compute_ridge_from_planes(planes, edges, tree_plane_ids=result.tree_plane_ids)

    # 8b. Compute sweep-based ridge line from RIDGE_DOT points
    #     Fallback: if sweep tracer didn't find enough ridge points, seed
    #     from plane-plane intersection edges (different slope regions meeting
    #     at their highest boundary = ridge).
    sweep_ridge_world = None
    if result.sweep_labels is not None:
        ridge_mask = result.sweep_labels == CellLabel.RIDGE_DOT

        # Fallback: seed RIDGE_DOTs from plane intersection ridge edges
        # Each slope change between adjacent planes produces a ridge edge.
        # Find LiDAR points near those edges and mark as RIDGE_DOT.
        if ridge_mask.sum() < 5 and edges and len(lidar_pts) > 0:
            ridge_mask, n_seeded = _seed_ridge_from_plane_edges(
                lidar_pts, result.sweep_labels, edges, planes,
                result.tree_plane_ids,
            )
            if n_seeded > 0:
                logger.info("Ridge fallback: seeded %d RIDGE_DOT points from "
                            "plane intersection edges", n_seeded)

        if ridge_mask.sum() >= 3:
            ridge_pts = lidar_pts[ridge_mask]
            # PCA on XZ to get ridge direction
            ridge_xz = ridge_pts[:, [0, 2]]
            centroid = ridge_xz.mean(axis=0)
            centered = ridge_xz - centroid
            cov = centered.T @ centered
            eigvals, eigvecs = np.linalg.eigh(cov)
            axis = eigvecs[:, -1]
            axis = axis / np.linalg.norm(axis)
            # Project all ridge points onto axis, find extents
            projections = centered @ axis
            min_proj, max_proj = float(projections.min()), float(projections.max())
            start_xz = centroid + axis * min_proj
            end_xz = centroid + axis * max_proj
            # Ridge properties
            dx = end_xz[0] - start_xz[0]
            dz = end_xz[1] - start_xz[1]
            import math as _math
            azimuth = float(_math.degrees(_math.atan2(dx, dz))) % 360.0
            horiz_len = _math.sqrt(dx**2 + dz**2)
            peak_h = float(ridge_pts[:, 1].max())
            median_h = float(np.median(ridge_pts[:, 1]))
            dy = 0.0  # ridge is approximately level
            pitch = 0.0
            sweep_ridge_world = (
                (float(start_xz[0]), float(start_xz[1])),
                (float(end_xz[0]), float(end_xz[1])),
                azimuth, pitch, horiz_len, peak_h,
            )
            logger.info("Sweep ridge line: %.1fm long, azimuth %.0f°, peak %.1fm, %d pts",
                        horiz_len, azimuth, peak_h, int(ridge_mask.sum()))

    # 9. Project COLOR labels (not classify_from_planes labels) to grid
    cell_labels = project_to_grid(
        lidar_pts,
        color_labels,
        height_grid,
        grid_resolution,
        x_origin,
        z_origin,
    )

    cell_grid_info = {
        'grid': cell_labels.tolist(),
        'x_origin': x_origin,
        'z_origin': z_origin,
        'resolution': grid_resolution,
        'rows': rows,
        'cols': cols,
    }

    logger.info("Plane-first detection complete: %d planes, ridge=%s, sweep_ridge=%s",
                len(planes), "found" if ridge_world else "none",
                "found" if sweep_ridge_world else "none")
    return planes, ridge_world, cell_grid_info, sweep_ridge_world


# ---------------------------------------------------------------------------
# Step 1: Build Height Grid
# ---------------------------------------------------------------------------

def build_height_grid(
    pts: np.ndarray,
    resolution: float = 0.5,
) -> tuple[np.ndarray, float, float]:
    """
    Reconstruct a regular 2D height grid from scattered LiDAR points.
    Returns (height_grid, x_origin, z_origin).
    """
    x = pts[:, 0]
    y = pts[:, 1]
    z = pts[:, 2]

    x_min, x_max = x.min(), x.max()
    z_min, z_max = z.min(), z.max()

    n_cols = max(1, int(np.ceil((x_max - x_min) / resolution)) + 1)
    n_rows = max(1, int(np.ceil((z_max - z_min) / resolution)) + 1)

    grid = np.full((n_rows, n_cols), np.nan, dtype=np.float64)

    for i in range(len(pts)):
        col = int((x[i] - x_min) / resolution)
        row = int((z[i] - z_min) / resolution)
        col = min(col, n_cols - 1)
        row = min(row, n_rows - 1)
        if np.isnan(grid[row, col]) or y[i] > grid[row, col]:
            grid[row, col] = y[i]

    nan_mask = np.isnan(grid)
    if nan_mask.any() and not nan_mask.all():
        indices = ndimage.distance_transform_edt(
            nan_mask, return_distances=False, return_indices=True,
        )
        grid[nan_mask] = grid[indices[0][nan_mask], indices[1][nan_mask]]

    return grid, float(x_min), float(z_min)


# ---------------------------------------------------------------------------
# Step 2: Compute Gradients
# ---------------------------------------------------------------------------

def compute_gradients(
    height_grid: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    """Compute height gradients (∂h/∂x and ∂h/∂z) on the grid."""
    dz, dx = np.gradient(height_grid)
    return dx, dz


# ---------------------------------------------------------------------------
# Roof Signature Learning
# ---------------------------------------------------------------------------

def _learn_roof_signature(
    height_grid: np.ndarray,
    dx: np.ndarray,
    dz: np.ndarray,
    anchor_cells: list[tuple[int, int]],
    patch_size: int = 5,
    roughness_cap: float = 0.15,
) -> tuple[float, tuple[float, float]]:
    """
    Learn what "roof" looks like from patches around anchor dots.
    Returns (roughness_threshold, (slope_dx, slope_dz)).
    """
    roughness_values = []
    slope_dx_sum = 0.0
    slope_dz_sum = 0.0
    n_valid = 0

    half = patch_size // 2

    for ar, ac in anchor_cells:
        rms = _compute_local_roughness(height_grid, ar, ac, patch_size)
        if rms is not None:
            roughness_values.append(rms)

        # Collect slope direction from this patch
        r0 = max(0, ar - half)
        r1 = min(height_grid.shape[0], ar + half + 1)
        c0 = max(0, ac - half)
        c1 = min(height_grid.shape[1], ac + half + 1)

        patch_dx = dx[r0:r1, c0:c1]
        patch_dz = dz[r0:r1, c0:c1]
        slope_dx_sum += patch_dx.mean()
        slope_dz_sum += patch_dz.mean()
        n_valid += 1

    if not roughness_values:
        logger.warning("Could not compute roughness from anchor patches")
        return roughness_cap, (0.0, 1.0)

    mean_roughness = np.mean(roughness_values)
    # Threshold: 3x the measured roof roughness, capped
    threshold = min(mean_roughness * 3.0, roughness_cap)
    # Minimum threshold must be generous enough to include cells near
    # ridges and eaves where the 5×5 patch spans slope changes.
    # A 22° roof with 0.5m grid creates ~0.04m roughness near the ridge.
    threshold = max(threshold, roughness_cap)

    if n_valid > 0:
        slope_dir = (slope_dx_sum / n_valid, slope_dz_sum / n_valid)
    else:
        slope_dir = (0.0, 1.0)

    logger.info(
        "Anchor roughness: mean=%.4f, values=%s, threshold=%.4f",
        mean_roughness, [f"{v:.4f}" for v in roughness_values], threshold,
    )
    return threshold, slope_dir


def _compute_local_roughness(
    height_grid: np.ndarray,
    row: int,
    col: int,
    patch_size: int = 5,
) -> float | None:
    """
    Compute local roughness (plane-fit RMS) for a patch centered on (row, col).
    Returns RMS residual or None if patch is too small.
    """
    half = patch_size // 2
    rows, cols = height_grid.shape

    r0 = max(0, row - half)
    r1 = min(rows, row + half + 1)
    c0 = max(0, col - half)
    c1 = min(cols, col + half + 1)

    patch = height_grid[r0:r1, c0:c1]
    if patch.size < 6:
        return None

    # Build 3D points from the patch
    pr, pc = np.mgrid[r0:r1, c0:c1]
    pts = np.column_stack([
        pc.ravel().astype(float),
        patch.ravel(),
        pr.ravel().astype(float),
    ])

    plane_eq = _fit_plane_svd(pts)
    if plane_eq is None:
        return None

    distances = np.abs(pts @ plane_eq[:3] + plane_eq[3])
    return float(np.sqrt(np.mean(distances**2)))


def _build_roughness_mask(
    height_grid: np.ndarray,
    roughness_threshold: float,
    patch_size: int = 5,
    min_height: float = 0.5,
) -> np.ndarray:
    """
    Build a boolean mask of "roof-like" cells based on local roughness.
    True = cell's local patch is smooth enough to be a roof surface.
    """
    rows, cols = height_grid.shape
    mask = np.zeros((rows, cols), dtype=bool)
    half = patch_size // 2

    for r in range(half, rows - half):
        for c in range(half, cols - half):
            if height_grid[r, c] < min_height:
                continue

            rms = _compute_local_roughness(height_grid, r, c, patch_size)
            if rms is not None and rms <= roughness_threshold:
                mask[r, c] = True

    return mask


# ---------------------------------------------------------------------------
# Ridge Geometry Helpers
# ---------------------------------------------------------------------------

def _is_flat_region(
    height_grid: np.ndarray,
    dx: np.ndarray,
    dz: np.ndarray,
    cells: set[tuple[int, int]],
    flat_grad_thresh: float = 0.03,
    min_sample: int = 3,
) -> bool:
    """Return True if sampled cells have near-zero gradients (flat surface)."""
    sample = list(cells)[:20]
    mags = []
    for r, c in sample:
        g = math.sqrt(dx[r, c] ** 2 + dz[r, c] ** 2)
        if not math.isnan(g):
            mags.append(g)
    if len(mags) < min_sample:
        return False
    return (sum(mags) / len(mags)) < flat_grad_thresh


# ---------------------------------------------------------------------------
# Grid Cell Classification
# ---------------------------------------------------------------------------

_DIAG = math.sqrt(2)
_TREE_VARIANCE_THRESH = 0.15  # 3x3 variance above this = tree canopy


def _local_variance_3x3(height_grid: np.ndarray, r: int, c: int) -> float:
    """Return the 3x3 neighborhood height variance around (r, c). Returns 0 if too few cells."""
    rows, cols = height_grid.shape
    vals = []
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            nr, nc = r + dr, c + dc
            if 0 <= nr < rows and 0 <= nc < cols:
                v = height_grid[nr, nc]
                if not np.isnan(v):
                    vals.append(v)
    if len(vals) < 3:
        return 0.0
    mean = sum(vals) / len(vals)
    return sum((v - mean) ** 2 for v in vals) / len(vals)


def _classify_grid_cells(
    height_grid: np.ndarray,
    roughness_mask: np.ndarray,
    dx: np.ndarray,
    dz: np.ndarray,
    min_height: float = 0.5,
    neighbor_roof_min: int = 5,
    gradient_threshold: float = 0.0,  # 0 = auto: keeps ~5.7° flat threshold regardless of resolution
    expanded_ground_height: float = 1.5,
    expanded_search_radius: int = 0,  # 0 = auto: ~1.5m physical radius
    grid_resolution: float = 0.5,
    min_flat_roof_width_m: float = 1.5,   # real flat roof must be at least this wide
    max_ridge_aspect_ratio: float = 6.0,  # above this → ridge, not flat roof
    max_roof_height: float = float('inf'), # anything above this height is a tree
    tree_grid: np.ndarray | None = None,   # hard tree exclusion mask from tree_detector
) -> np.ndarray:
    """
    Classify every grid cell into one of: GROUND, ROOF, LOWER_ROOF, FLAT_ROOF,
    RIDGE_DOT, NEAR_RIDGE, or UNSURE.

    Pass 1: Initial per-cell classification based on height, roughness, and
            local gradient.
    Pass 2: Reclassify UNSURE cells using an expanded neighborhood.
    Pass 3: Upgrade ROOF cells to RIDGE_DOT or NEAR_RIDGE based on whether
            the cell sits at or near the top of a slope.
    """
    # Auto-scale resolution-dependent parameters so the physical meaning stays
    # constant regardless of grid_resolution (0.5m, 0.25m, etc.)
    # gradient_threshold is in height-per-cell units; scale to keep ~5.7° slope cutoff
    if gradient_threshold == 0.0:
        gradient_threshold = 0.1 * grid_resolution   # 0.05 @ 0.5m, 0.025 @ 0.25m
    if expanded_search_radius == 0:
        expanded_search_radius = max(3, int(round(1.5 / grid_resolution)))  # ~1.5m physical

    rows, cols = height_grid.shape
    cell_labels = np.zeros((rows, cols), dtype=int)

    _NBRS = [(-1, -1), (-1, 0), (-1, 1),
             (0,  -1),          (0,  1),
             (1,  -1),  (1, 0), (1,  1)]

    # ---- Pass 1: per-cell initial classification ----
    for r in range(rows):
        for c in range(cols):
            h = height_grid[r, c]
            if np.isnan(h) or h < min_height:
                cell_labels[r, c] = CellLabel.GROUND
                continue

            # HARD TREE EXCLUSION — DISABLED, only calibration slope-trace active
            # if tree_grid is not None and tree_grid[r, c]:
            #     cell_labels[r, c] = CellLabel.TREE
            #     continue

            # Fallback tree checks — DISABLED
            # if h > max_roof_height:
            #     cell_labels[r, c] = CellLabel.TREE
            #     continue

            if not roughness_mask[r, c]:
                # Rough cell — variance tree check DISABLED
                # h_var = _local_variance_3x3(height_grid, r, c)
                # if h_var > _TREE_VARIANCE_THRESH:
                #     cell_labels[r, c] = CellLabel.TREE
                #     continue
                # Check if any neighbor is at ground level
                is_ground_adjacent = False
                for dr, dc in _NBRS:
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < rows and 0 <= nc < cols:
                        nh = height_grid[nr, nc]
                        if not np.isnan(nh) and nh < min_height:
                            is_ground_adjacent = True
                            break
                cell_labels[r, c] = CellLabel.GROUND if is_ground_adjacent else CellLabel.UNSURE
                continue

            # Smooth/planar cell — compute mean gradient and roof-neighbor count
            grad_x_sum = grad_z_sum = 0.0
            n_valid = 0
            n_roof_neighbors = 0
            for dr, dc in _NBRS:
                nr, nc = r + dr, c + dc
                if 0 <= nr < rows and 0 <= nc < cols:
                    nh = height_grid[nr, nc]
                    if np.isnan(nh):
                        continue
                    dist = _DIAG if (dr != 0 and dc != 0) else 1.0
                    delta_h = nh - h
                    grad_x_sum += (dc / dist) * (delta_h / dist)
                    grad_z_sum += (dr / dist) * (delta_h / dist)
                    n_valid += 1
                    if roughness_mask[nr, nc]:
                        n_roof_neighbors += 1

            if n_valid == 0:
                cell_labels[r, c] = CellLabel.UNSURE
                continue

            grad_mag = math.sqrt((grad_x_sum / n_valid) ** 2 + (grad_z_sum / n_valid) ** 2)

            if grad_mag < gradient_threshold:
                cell_labels[r, c] = (
                    CellLabel.FLAT_ROOF if n_roof_neighbors >= neighbor_roof_min
                    else CellLabel.UNSURE
                )
            else:
                cell_labels[r, c] = CellLabel.ROOF

    # ---- Pass 2: reclassify UNSURE cells via expanded neighborhood ----
    for r in range(rows):
        for c in range(cols):
            if cell_labels[r, c] != CellLabel.UNSURE:
                continue
            h = height_grid[r, c]
            if np.isnan(h):
                continue

            n_roof = n_ground = 0
            roof_heights = []
            drops_to_ground = False

            for dr in range(-expanded_search_radius, expanded_search_radius + 1):
                for dc in range(-expanded_search_radius, expanded_search_radius + 1):
                    if dr == 0 and dc == 0:
                        continue
                    nr, nc = r + dr, c + dc
                    if not (0 <= nr < rows and 0 <= nc < cols):
                        continue
                    nh = height_grid[nr, nc]
                    if np.isnan(nh):
                        continue
                    lbl = cell_labels[nr, nc]
                    if nh < min_height:
                        drops_to_ground = True
                    if lbl == CellLabel.GROUND:
                        n_ground += 1
                    elif lbl in (CellLabel.ROOF, CellLabel.FLAT_ROOF):
                        n_roof += 1
                        roof_heights.append(nh)

            if drops_to_ground:
                cell_labels[r, c] = CellLabel.GROUND
            elif (roof_heights
                  and h >= expanded_ground_height
                  and h < (sum(roof_heights) / len(roof_heights)) - 1.5):
                cell_labels[r, c] = CellLabel.LOWER_ROOF
            elif n_roof > 0 and n_roof / (n_roof + n_ground + 1) >= 0.5:
                cell_labels[r, c] = CellLabel.ROOF
            # else: leave as UNSURE

    # ---- Pass 3: EAVE_DOT + tree variance reclassification ----
    # Ridge/NEAR_RIDGE labels are NO LONGER assigned here — they come
    # exclusively from plane-plane intersections in plane_classifier.py.
    # This pass only detects eave edges (downhill drop) and reclassifies
    # high-variance ROOF cells as TREE.
    for r in range(rows):
        for c in range(cols):
            if cell_labels[r, c] != CellLabel.ROOF:
                continue
            h = height_grid[r, c]
            gx, gz = dx[r, c], dz[r, c]
            grad_mag = math.sqrt(gx * gx + gz * gz)
            if grad_mag < 0.01:
                continue

            # Tree variance reclassification — DISABLED, only calibration slope-trace active
            # if _local_variance_3x3(height_grid, r, c) > _TREE_VARIANCE_THRESH:
            #     cell_labels[r, c] = CellLabel.TREE
            #     continue

            # Downhill neighbor
            uz, ux = gz / grad_mag, gx / grad_mag
            nr_down = int(round(r - uz))
            nc_down = int(round(c - ux))
            h_down = (height_grid[nr_down, nc_down]
                      if 0 <= nr_down < rows and 0 <= nc_down < cols
                      else h - 1.0)

            # EAVE_DOT: bottom edge of slope — height drops sharply downhill
            if not np.isnan(h_down):
                h_predicted_down = h - grad_mag
                eave_cond = h_down < h_predicted_down - 0.15
                eave_cond_strong = h_down < h - 0.4
                if eave_cond or eave_cond_strong:
                    cell_labels[r, c] = CellLabel.EAVE_DOT

    # Log label distribution
    counts = np.bincount(cell_labels.ravel(), minlength=10)
    logger.info(
        "Cell labels — GROUND:%d ROOF:%d LOWER_ROOF:%d FLAT_ROOF:%d "
        "UNSURE:%d RIDGE_DOT:%d NEAR_RIDGE:%d TREE:%d EAVE_DOT:%d RIDGE_EDGE_DOT:%d",
        counts[CellLabel.GROUND], counts[CellLabel.ROOF],
        counts[CellLabel.LOWER_ROOF], counts[CellLabel.FLAT_ROOF],
        counts[CellLabel.UNSURE], counts[CellLabel.RIDGE_DOT],
        counts[CellLabel.NEAR_RIDGE], counts[CellLabel.TREE],
        counts[CellLabel.EAVE_DOT], counts[CellLabel.RIDGE_EDGE_DOT],
    )
    return cell_labels


# ---------------------------------------------------------------------------
# Face Growing (through roof-like cells with consistency)
# ---------------------------------------------------------------------------
# NOTE: Gradient-based ridge functions (_find_slope_top_candidates,
# _fit_ridge_line, _validate_ridge_density, _trace_uphill, _trace_ridge,
# _correct_ridge_from_eaves, _ridge_geometry, _find_hip_faces) have been
# removed. Ridge detection now comes exclusively from plane-plane
# intersections in plane_classifier.py.



def _grow_face(
    height_grid: np.ndarray,
    dx: np.ndarray,
    dz: np.ndarray,
    roof_mask: np.ndarray,
    assigned: np.ndarray,
    seed_r: int,
    seed_c: int,
    resolution: float,
    height_drop_max: float,
    allow_flat: bool = False,
) -> tuple[np.ndarray, list[tuple[int, int]]] | None:
    """
    Grow a face from a seed cell using gradient consistency + plane fitting.

    Stops at:
      - Height deviation from fitted plane > 0.3m (dissolving edge)
      - Substantial height drops (> height_drop_max) → real edge/eave
      - Gradient reversal (> 30° in mask, > 15° outside) → ridge
      - High 3x3 neighbor variance (> 0.15) → tree canopy
      - Gradient magnitude drop (< 50% of face average) → leaving roof
      - Already-assigned cells / ground-level cells

    Returns (face_mask, variance_stops) where variance_stops are cells
    where growth stopped due to tree variance (used for tree inference).
    """
    rows, cols = height_grid.shape
    min_cell_height = 0.5

    if assigned[seed_r, seed_c]:
        best_r, best_c, best_dist = None, None, float('inf')
        for dr_s in range(-5, 6):
            for dc_s in range(-5, 6):
                nr, nc = seed_r + dr_s, seed_c + dc_s
                if 0 <= nr < rows and 0 <= nc < cols:
                    if not assigned[nr, nc] and height_grid[nr, nc] >= min_cell_height:
                        d = dr_s * dr_s + dc_s * dc_s
                        if d < best_dist:
                            best_r, best_c, best_dist = nr, nc, d
        if best_r is None:
            return None
        seed_r, seed_c = best_r, best_c

    face = np.zeros((rows, cols), dtype=bool)
    face[seed_r, seed_c] = True
    boundary = collections.deque([(seed_r, seed_c)])

    # Slope tracking
    avg_dx = float(dx[seed_r, seed_c])
    avg_dz = float(dz[seed_r, seed_c])
    n_cells = 1

    # Running plane fit — refit periodically for plane deviation check
    face_pts_list = [(seed_c * resolution, height_grid[seed_r, seed_c], seed_r * resolution)]
    plane_eq = None
    last_fit_count = 0

    # Gradient magnitude tracking
    seed_grad_mag = math.sqrt(avg_dx**2 + avg_dz**2)
    grad_mag_sum = seed_grad_mag
    grad_mag_count = 1
    low_grad_streak = 0

    # Variance-blocked cells (tree boundary) for later inference
    variance_stops = []

    consistency_in_mask = np.radians(30.0)
    consistency_outside = np.radians(15.0)
    nbrs = [(-1, 0), (1, 0), (0, -1), (0, 1)]

    while boundary:
        cr, cc = boundary.popleft()

        for dr, dc in nbrs:
            nr, nc = cr + dr, cc + dc

            if nr < 0 or nr >= rows or nc < 0 or nc >= cols:
                continue
            if face[nr, nc] or assigned[nr, nc]:
                continue

            nh = height_grid[nr, nc]

            # Ground check
            if nh < min_cell_height:
                continue

            # Height drop check
            h_diff = abs(nh - height_grid[cr, cc])
            if h_diff > height_drop_max:
                continue

            # 3x3 neighbor variance — reject tree canopy
            n_count = 0
            h_sum = 0.0
            h_sq_sum = 0.0
            for dr2, dc2 in nbrs:
                nr2, nc2 = nr + dr2, nc + dc2
                if 0 <= nr2 < rows and 0 <= nc2 < cols:
                    h2 = height_grid[nr2, nc2]
                    if not np.isnan(h2):
                        h_sum += h2
                        h_sq_sum += h2 * h2
                        n_count += 1
            if n_count >= 3:
                h_var = h_sq_sum / n_count - (h_sum / n_count) ** 2
                if h_var > 0.15:
                    variance_stops.append((nr, nc))
                    continue

            # Gradient consistency → stops at ridges
            cand_dx = float(dx[nr, nc])
            cand_dz = float(dz[nr, nc])
            cand_mag = math.sqrt(cand_dx**2 + cand_dz**2)
            avg_mag = math.sqrt(avg_dx**2 + avg_dz**2)

            in_mask = roof_mask[nr, nc]
            max_angle = consistency_in_mask if in_mask else consistency_outside

            if cand_mag > 0.005 and avg_mag > 0.005:
                cos_a = (cand_dx * avg_dx + cand_dz * avg_dz) / (cand_mag * avg_mag)
                cos_a = max(-1.0, min(1.0, cos_a))
                if math.acos(cos_a) > max_angle:
                    continue

            # Gradient magnitude drop — at the eave, gradient fades to ~0
            # Skip this check for flat faces (their gradient is near-zero by design)
            if not allow_flat and grad_mag_count > 5:
                avg_grad_mag = grad_mag_sum / grad_mag_count
                if avg_grad_mag > 0.02 and cand_mag < avg_grad_mag * 0.3:
                    low_grad_streak += 1
                    if low_grad_streak >= 3:
                        continue
                else:
                    low_grad_streak = 0

            # Plane deviation check — reject cells that drift off-plane
            # (catches dissolving edges where each step is small but
            # cumulative drift takes us off the roof)
            if plane_eq is not None and n_cells > 10:
                cell_x = nc * resolution
                cell_z = nr * resolution
                expected_h = -(plane_eq[0] * cell_x + plane_eq[2] * cell_z + plane_eq[3]) / plane_eq[1] if abs(plane_eq[1]) > 0.01 else nh
                deviation = abs(nh - expected_h)
                if deviation > 0.3:
                    continue

            # Accept
            face[nr, nc] = True
            boundary.append((nr, nc))
            n_cells += 1
            avg_dx += (cand_dx - avg_dx) / n_cells
            avg_dz += (cand_dz - avg_dz) / n_cells
            grad_mag_sum += cand_mag
            grad_mag_count += 1
            face_pts_list.append((nc * resolution, nh, nr * resolution))

            # Periodically refit plane (every 20 cells)
            if n_cells - last_fit_count >= 20 and n_cells >= 10:
                pts_arr = np.array(face_pts_list)
                plane_eq = _fit_plane_svd(pts_arr)
                last_fit_count = n_cells

    if n_cells < 3:
        return None

    logger.debug("Grew face from (%d,%d): %d cells, %d variance stops",
                 seed_r, seed_c, n_cells, len(variance_stops))
    return face, variance_stops


# ---------------------------------------------------------------------------
# Edge Drop-off Analysis
# ---------------------------------------------------------------------------

def _classify_edge_dropoff(
    height_grid: np.ndarray,
    face_mask: np.ndarray,
    assigned: np.ndarray,
    ground_height_thresh: float,
    min_drop: float,
) -> dict:
    """
    Classify what's beyond each edge of a face.

    For each boundary cell, look at the neighbor just outside the face and
    classify the drop-off:
      - 'ground': drops to near ground level → true eave, building edge
      - 'roof': drops to elevated surface → another roof below
      - 'none': no significant drop → face was cut short (roughness mask edge)

    Returns dict with:
      - 'ground_edges': list of (face_r, face_c) where eave meets ground
      - 'roof_edges': list of (outside_r, outside_c) seeds on lower roofs
      - 'weak_edges': list of (face_r, face_c) where no real drop was found
    """
    rows, cols = height_grid.shape
    neighbors = [(-1, 0), (1, 0), (0, -1), (0, 1)]

    ground_edges = []
    roof_edges = []
    weak_edges = []
    seen = set()

    for r in range(rows):
        for c in range(cols):
            if not face_mask[r, c]:
                continue

            for dr, dc in neighbors:
                nr, nc = r + dr, c + dc
                if not (0 <= nr < rows and 0 <= nc < cols):
                    continue
                if face_mask[nr, nc] or (nr, nc) in seen:
                    continue

                h_here = height_grid[r, c]
                h_there = height_grid[nr, nc]
                drop = h_here - h_there

                if drop > min_drop:
                    seen.add((nr, nc))
                    if h_there < ground_height_thresh:
                        ground_edges.append((r, c))
                    else:
                        roof_edges.append((nr, nc))
                elif abs(drop) <= min_drop and not assigned[nr, nc]:
                    weak_edges.append((r, c))

    return {
        'ground_edges': ground_edges,
        'roof_edges': roof_edges,
        'weak_edges': weak_edges,
    }


def _find_stepdown_seeds(
    height_grid: np.ndarray,
    assigned: np.ndarray,
    roof_mask: np.ndarray,
    ground_height_thresh: float,
    height_drop_max: float,
) -> list[tuple[int, int]]:
    """
    Scan the boundary of all assigned faces for step-down edges.

    At each boundary cell, check the neighbor just outside the face.
    If there's a height drop that lands on an elevated surface (not ground),
    that neighbor is a seed for a lower roof face (porch, addition, etc.).

    Returns a list of (row, col) seed cells on the lower roof, sorted by
    height (highest first) so we discover the most prominent faces first.
    """
    rows, cols = height_grid.shape
    neighbors = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    seeds = []
    seen = set()

    for r in range(rows):
        for c in range(cols):
            if not assigned[r, c]:
                continue

            for dr, dc in neighbors:
                nr, nc = r + dr, c + dc
                if not (0 <= nr < rows and 0 <= nc < cols):
                    continue
                if assigned[nr, nc] or (nr, nc) in seen:
                    continue

                h_here = height_grid[r, c]
                h_there = height_grid[nr, nc]
                drop = h_here - h_there

                # Must be a real drop (> threshold) but land on elevated surface
                if drop > height_drop_max and h_there >= ground_height_thresh:
                    seeds.append((nr, nc))
                    seen.add((nr, nc))

    # Sort by height descending — find the tallest lower roofs first
    seeds.sort(key=lambda rc: height_grid[rc[0], rc[1]], reverse=True)

    # Offset seeds away from the face boundary so the gradient isn't
    # polluted by the junction. Walk 3 cells away from the assigned face,
    # staying on elevated cells.
    offset_seeds = []
    offset_seen = set()
    for sr, sc in seeds:
        # Find the direction away from the assigned face
        best_nr, best_nc = sr, sc
        for step in range(1, 4):
            for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                nr, nc = sr + dr * step, sc + dc * step
                if not (0 <= nr < rows and 0 <= nc < cols):
                    continue
                if assigned[nr, nc]:
                    continue
                h = height_grid[nr, nc]
                if h >= ground_height_thresh and (nr, nc) not in offset_seen:
                    best_nr, best_nc = nr, nc
        if (best_nr, best_nc) not in offset_seen:
            offset_seeds.append((best_nr, best_nc))
            offset_seen.add((best_nr, best_nc))

    # Deduplicate — many boundary cells may map to the same offset seed
    return offset_seeds


# ---------------------------------------------------------------------------
# Tree-Over-Roof Inference
# ---------------------------------------------------------------------------

def _infer_through_tree(
    face_mask: np.ndarray,
    height_grid: np.ndarray,
    variance_stops: list[tuple[int, int]],
    assigned: np.ndarray,
    resolution: float,
    min_eave_height: float = 1.5,
) -> tuple[np.ndarray, int]:
    """
    Extend a face through tree-blocked cells using the known plane equation.

    When face growth stops at tree variance but the plane equation predicts
    the roof continues underneath, project the plane forward to infer the
    hidden portion. Stops when the projected height drops below eave level.

    Returns (extended_mask, n_inferred) — the extended mask includes both
    the original face and inferred cells. n_inferred is how many cells were
    added by inference.
    """
    rows, cols = height_grid.shape
    if not variance_stops or face_mask.sum() < 10:
        return face_mask, 0

    # Fit plane to the known face
    face_rows, face_cols = np.where(face_mask)
    pts = np.column_stack([
        face_cols * resolution,
        height_grid[face_rows, face_cols],
        face_rows * resolution,
    ])
    plane_eq = _fit_plane_svd(pts)
    if plane_eq is None:
        return face_mask, 0

    # Find eave height from the face (lowest point on the face)
    eave_h = float(height_grid[face_rows, face_cols].min())
    eave_h = max(eave_h, min_eave_height)

    # From each variance stop, project the plane outward
    extended = face_mask.copy()
    n_inferred = 0
    visited = set()
    queue = collections.deque()

    for vr, vc in variance_stops:
        if assigned[vr, vc] or extended[vr, vc]:
            continue
        if (vr, vc) in visited:
            continue
        # Check that the plane predicts a roof here
        ex = vc * resolution
        ez = vr * resolution
        if abs(plane_eq[1]) > 0.01:
            expected_h = -(plane_eq[0] * ex + plane_eq[2] * ez + plane_eq[3]) / plane_eq[1]
        else:
            continue
        if expected_h < eave_h:
            continue
        queue.append((vr, vc))
        visited.add((vr, vc))

    # Compute max inference distance from face boundary
    face_rows_set = set(zip(face_rows.tolist(), face_cols.tolist()))
    max_infer_dist = 15  # max 15 cells (~7.5m) from face boundary

    nbrs = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    while queue:
        cr, cc = queue.popleft()

        # Check distance from original face boundary
        min_dist = min(
            (abs(cr - fr) + abs(cc - fc) for fr, fc in face_rows_set),
            default=999,
        )
        if min_dist > max_infer_dist:
            continue

        # Project plane to get expected height
        ex = cc * resolution
        ez = cr * resolution
        if abs(plane_eq[1]) > 0.01:
            expected_h = -(plane_eq[0] * ex + plane_eq[2] * ez + plane_eq[3]) / plane_eq[1]
        else:
            continue

        # Stop if projected height is below eave
        if expected_h < eave_h:
            continue

        # Accept this cell as inferred roof
        extended[cr, cc] = True
        n_inferred += 1

        # Only grow through cells with high variance (still under tree)
        # Don't flood into normal cells — let face growth handle those
        for dr, dc in nbrs:
            nr, nc = cr + dr, cc + dc
            if not (0 <= nr < rows and 0 <= nc < cols):
                continue
            if extended[nr, nc] or assigned[nr, nc] or (nr, nc) in visited:
                continue
            # Check if this neighbor also has high variance (tree)
            n_ct = 0
            hs = 0.0
            hsq = 0.0
            for dr2, dc2 in nbrs:
                nr2, nc2 = nr + dr2, nc + dc2
                if 0 <= nr2 < rows and 0 <= nc2 < cols:
                    h2 = height_grid[nr2, nc2]
                    if not np.isnan(h2):
                        hs += h2
                        hsq += h2 * h2
                        n_ct += 1
            if n_ct >= 3:
                v = hsq / n_ct - (hs / n_ct) ** 2
                if v > 0.08:  # still tree-like
                    visited.add((nr, nc))
                    queue.append((nr, nc))

    if n_inferred > 0:
        logger.info("Inferred %d cells through tree (from %d variance stops)",
                    n_inferred, len(variance_stops))

    return extended, n_inferred


# ---------------------------------------------------------------------------
# Structure Sistering
# ---------------------------------------------------------------------------

def _sister_faces(planes: list[RoofPlane]) -> None:
    """
    Group faces that share a ridge into the same roof structure.

    Two faces are sistered if:
      - Their azimuths are ~180° apart (±20°) — opposite sides of a ridge
      - Their pitches are similar (±10°)
      - Their highest points are within 1.5m of each other (same ridge height)

    Modifies planes in-place by setting matching structure_ids.
    """
    if len(planes) < 2:
        return

    for i in range(len(planes)):
        for j in range(i + 1, len(planes)):
            p1, p2 = planes[i], planes[j]

            # Already in the same structure?
            if p1.structure_id == p2.structure_id and p1.structure_id:
                continue

            # Check azimuth opposition (should be ~180° apart)
            az_diff = abs(p1.azimuth_deg - p2.azimuth_deg)
            az_diff = min(az_diff, 360.0 - az_diff)
            if abs(az_diff - 180.0) > 20.0:
                continue

            # Check pitch similarity
            if abs(p1.pitch_deg - p2.pitch_deg) > 10.0:
                continue

            # Check ridge height similarity (highest point of each face)
            if abs(p1.height_m - p2.height_m) > 1.5:
                continue

            # Sister them — use the first face's structure_id
            shared_id = p1.structure_id or p2.structure_id or str(uuid.uuid4())[:8]
            p1.structure_id = shared_id
            p2.structure_id = shared_id
            logger.info(
                "Sistered faces %s and %s (az=%.0f/%.0f, pitch=%.0f/%.0f) → structure %s",
                p1.id, p2.id, p1.azimuth_deg, p2.azimuth_deg,
                p1.pitch_deg, p2.pitch_deg, shared_id,
            )


# ---------------------------------------------------------------------------
# Plane Fitting & Building
# ---------------------------------------------------------------------------

def _fit_and_build_plane(
    face_mask: np.ndarray,
    height_grid: np.ndarray,
    x_origin: float,
    z_origin: float,
    resolution: float,
    max_roughness: float,
    min_up_component: float,
    override_azimuth: float | None = None,
    override_pitch: float | None = None,
) -> RoofPlane | None:
    """Fit a plane to a face mask and build a RoofPlane if it passes checks.

    If override_azimuth/pitch are provided (from ridge geometry), they
    replace the SVD-derived values for higher accuracy.
    """
    r_rows, r_cols = np.where(face_mask)
    cell_x = r_cols * resolution + x_origin
    cell_z = r_rows * resolution + z_origin
    cell_y = height_grid[r_rows, r_cols]
    face_pts = np.column_stack([cell_x, cell_y, cell_z])

    if len(face_pts) < 3:
        return None

    plane_eq = _fit_plane_svd(face_pts)
    if plane_eq is None:
        return None

    # Roughness check
    distances = np.abs(face_pts @ plane_eq[:3] + plane_eq[3])
    rms = np.sqrt(np.mean(distances**2))
    if rms > max_roughness:
        logger.debug("Rejected face: roughness %.3f > %.3f", rms, max_roughness)
        return None

    # Reject near-vertical
    normal = plane_eq[:3].copy()
    if normal[1] < 0:
        normal = -normal
    up = abs(normal[1]) / np.linalg.norm(normal)
    if up < min_up_component:
        logger.debug("Rejected face: up_component %.3f < %.3f", up, min_up_component)
        return None

    return _build_roof_plane(
        face_pts, plane_eq, face_mask, x_origin, z_origin, resolution,
        override_azimuth=override_azimuth, override_pitch=override_pitch,
    )


# ---------------------------------------------------------------------------
# Helpers (unchanged from previous versions)
# ---------------------------------------------------------------------------

def _build_roof_plane(
    face_pts: np.ndarray,
    plane_eq: np.ndarray,
    face_mask: np.ndarray,
    x_origin: float,
    z_origin: float,
    resolution: float,
    override_azimuth: float | None = None,
    override_pitch: float | None = None,
) -> RoofPlane | None:
    """Build a RoofPlane from fitted points and plane equation.

    If override_azimuth/pitch are set (from ridge tracing), they replace
    the SVD-derived values for more accurate geometry.
    """
    boundary = _extract_face_boundary(face_mask, x_origin, z_origin, resolution)
    if len(boundary) < 3:
        return None

    normal = plane_eq[:3].copy()
    if normal[1] < 0:
        normal = -normal
        plane_eq = -plane_eq

    cos_pitch = abs(normal[1]) / np.linalg.norm(normal)
    pitch_deg = float(math.degrees(math.acos(np.clip(cos_pitch, -1, 1))))
    azimuth_deg = float(math.degrees(math.atan2(normal[0], normal[2]))) % 360.0

    # Use ridge-derived geometry when available (more accurate)
    if override_azimuth is not None:
        svd_azimuth = azimuth_deg
        azimuth_deg = override_azimuth
        logger.debug("Azimuth override: SVD=%.1f° → ridge=%.1f°", svd_azimuth, azimuth_deg)
    if override_pitch is not None:
        svd_pitch = pitch_deg
        pitch_deg = override_pitch
        logger.debug("Pitch override: SVD=%.1f° → ridge=%.1f°", svd_pitch, pitch_deg)

    a, b, c, d = plane_eq
    cell_y = face_pts[:, 1]
    vertices_2d = [Point2D(x=float(bx), z=float(bz)) for bx, bz in boundary]
    vertices_3d = []
    for bx, bz in boundary:
        if abs(b) > 1e-10:
            by = -(a * bx + c * bz + d) / b
        else:
            by = float(cell_y.mean())
        vertices_3d.append(Point3D(x=float(bx), y=float(by), z=float(bz)))

    height_m = float(cell_y.max())
    elevation_m = float(cell_y.min())

    flat_area = _shoelace_area(np.array(boundary))
    surface_area = flat_area / max(cos_pitch, 0.01)

    is_flat = pitch_deg < 2.0
    plane_type = _classify_plane(surface_area, height_m, elevation_m)
    confidence = min(1.0, len(face_pts) / 100.0)

    return RoofPlane(
        id=f"gplane_{uuid.uuid4().hex[:8]}",
        vertices=vertices_2d,
        vertices_3d=vertices_3d,
        plane_equation=PlaneEquation(
            a=float(plane_eq[0]), b=float(plane_eq[1]),
            c=float(plane_eq[2]), d=float(plane_eq[3]),
        ),
        pitch_deg=round(pitch_deg, 2),
        azimuth_deg=round(azimuth_deg, 2),
        height_m=round(height_m, 2),
        elevation_m=round(elevation_m, 2),
        area_m2=round(max(surface_area, 0.01), 2),
        is_flat=is_flat,
        plane_type=plane_type,
        confidence=round(confidence, 3),
        needs_review=confidence < 0.5,
    )


def _extract_face_boundary(
    face_mask: np.ndarray,
    x_origin: float,
    z_origin: float,
    resolution: float,
) -> list[tuple[float, float]]:
    """Extract boundary polygon from a binary face mask."""
    try:
        import cv2
        mask_uint8 = face_mask.astype(np.uint8) * 255
        contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            return []

        largest = max(contours, key=cv2.contourArea)
        epsilon = 0.01 * cv2.arcLength(largest, True)
        approx = cv2.approxPolyDP(largest, epsilon, True)

        boundary = []
        for pt in approx:
            col, row = pt[0]
            x = col * resolution + x_origin
            z = row * resolution + z_origin
            boundary.append((float(x), float(z)))
        return boundary

    except ImportError:
        rows, cols = np.where(face_mask)
        eroded = ndimage.binary_erosion(face_mask)
        border = face_mask & ~eroded
        b_rows, b_cols = np.where(border)
        if len(b_rows) < 3:
            return []

        x_coords = b_cols * resolution + x_origin
        z_coords = b_rows * resolution + z_origin
        points = list(zip(x_coords.tolist(), z_coords.tolist()))

        if HAS_SHAPELY:
            mp = MultiPoint(points)
            hull = mp.convex_hull
            if hull.geom_type == "Polygon":
                return list(hull.exterior.coords[:-1])
        return points[:20]


def _fit_plane_svd(pts: np.ndarray):
    """Fit a plane to points using SVD. Returns [a, b, c, d] or None."""
    centroid = pts.mean(axis=0)
    centered = pts - centroid
    try:
        _, _, Vt = np.linalg.svd(centered, full_matrices=False)
    except np.linalg.LinAlgError:
        return None
    normal = Vt[-1]
    norm_len = np.linalg.norm(normal)
    if norm_len < 1e-10:
        return None
    normal /= norm_len
    d = -normal @ centroid
    return np.append(normal, d)


def _shoelace_area(poly: np.ndarray) -> float:
    """Shoelace formula for polygon area."""
    n = len(poly)
    if n < 3:
        return 0.0
    x = poly[:, 0]
    z = poly[:, 1]
    return float(0.5 * abs(np.dot(x, np.roll(z, -1)) - np.dot(z, np.roll(x, -1))))


def _classify_plane(area: float, height: float, elevation: float) -> PlaneType:
    """Classify plane type by size and height heuristics."""
    if area < 5.0 and elevation > 2.0:
        return PlaneType.dormer
    if area < 15.0 and height < 3.0:
        return PlaneType.porch
    if area < 30.0 and elevation < 1.5:
        return PlaneType.garage
    return PlaneType.main
