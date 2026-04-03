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
        return [], None, None

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

    cell_labels = _classify_grid_cells(
        height_grid, roof_mask, dx, dz,
        min_height=min_height, grid_resolution=grid_resolution,
        max_roof_height=max_roof_height,
    )
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

    # Step 7: Collect ridge candidates (RIDGE_DOT first, NEAR_RIDGE as fallback)
    slope_top_candidates = _find_slope_top_candidates(
        height_grid, cell_labels,
        resolution=grid_resolution, x_origin=x_origin, z_origin=z_origin,
    )

    # Step 8: Fit ridge line via PCA; fall back to old trace method if needed
    new_ridge_result = None
    if len(slope_top_candidates) >= 5:
        new_ridge_result = _fit_ridge_line(
            slope_top_candidates, height_grid, anchor_cells,
            resolution=grid_resolution, x_origin=x_origin, z_origin=z_origin,
            anchor_heights=anchor_heights,
        )

    if new_ridge_result is not None:
        ridge_cells, fitted_direction = new_ridge_result
        # Snap to valid roof geometry: gable (90° from slope) or hip (45°)
        snapped_direction = _snap_ridge_to_slope(fitted_direction, slope_dir)
        if not np.allclose(snapped_direction, fitted_direction, atol=0.05):
            ridge_cells = _reproject_ridge_cells(ridge_cells, snapped_direction, height_grid, rows, cols)
        ridge_point = ridge_cells[len(ridge_cells) // 2]
        logger.info("Ridge from PCA fit: %d cells, midpoint=(%d,%d)",
                    len(ridge_cells), ridge_point[0], ridge_point[1])
    else:
        logger.warning(
            "PCA ridge fit failed or too few candidates (%d) — falling back to trace method",
            len(slope_top_candidates),
        )
        ridge_point = _trace_uphill(height_grid, roof_mask, anchor_cells)
        if ridge_point is None:
            logger.warning("Could not find ridge from anchor dots")
            return [], None, cell_grid_info
        logger.info("Ridge point found at grid (%d, %d), height=%.2f",
                    ridge_point[0], ridge_point[1], height_grid[ridge_point])
        ridge_cells = _trace_ridge(height_grid, roof_mask, ridge_point, dx, dz)
        logger.info("Ridge traced: %d cells", len(ridge_cells))
        # Apply same constraints: tilt ≤ 8° and endpoint Δh ≤ 0.5m
        def _ep(cells):
            if len(cells) < 2: return 0.0, 0.0
            q = max(1, len(cells) // 4)
            sv = sorted([height_grid[r,c] for r,c in cells[:q]  if not math.isnan(height_grid[r,c])])
            ev = sorted([height_grid[r,c] for r,c in cells[-q:] if not math.isnan(height_grid[r,c])])
            if not sv or not ev: return 0.0, 0.0
            dh = abs(ev[len(ev)//2] - sv[len(sv)//2])
            return math.degrees(math.atan2(dh, len(cells) * grid_resolution)), dh
        while len(ridge_cells) >= 4:
            t, dh = _ep(ridge_cells)
            if t <= 8.0 and dh <= 0.5: break
            q = max(1, len(ridge_cells) // 4)
            sv = sorted([height_grid[r,c] for r,c in ridge_cells[:q]  if not math.isnan(height_grid[r,c])])
            ev = sorted([height_grid[r,c] for r,c in ridge_cells[-q:] if not math.isnan(height_grid[r,c])])
            if sv and ev and ev[len(ev)//2] > sv[len(sv)//2]:
                ridge_cells = ridge_cells[:-1]
            else:
                ridge_cells = ridge_cells[1:]

    if len(ridge_cells) < 2:
        logger.warning("Ridge too short")
        return [], None, cell_grid_info

    # Step 9: Validate ridge density — require ~4/5 cells to be RIDGE_DOT or NEAR_RIDGE
    ridge_cells = _validate_ridge_density(ridge_cells, cell_labels, grid_resolution=grid_resolution)
    if len(ridge_cells) < 2:
        logger.warning("Ridge failed density check")
        return [], None, cell_grid_info

    # Step 10: Compute azimuth and pitch from ridge geometry
    ridge_azimuth, ridge_pitch, ridge_info = _ridge_geometry(
        height_grid, ridge_cells, x_origin, z_origin, grid_resolution,
        anchor_cells=anchor_cells,
    )
    logger.info(
        "Ridge geometry: azimuth=%.1f°, pitch=%.1f°, length=%.1fm",
        ridge_azimuth, ridge_pitch, ridge_info['length_m'],
    )

    # Default ridge_world from traced endpoints
    _r0, _c0 = ridge_cells[0]
    _r1, _c1 = ridge_cells[-1]
    ridge_world = (
        (x_origin + _c0 * grid_resolution, z_origin + _r0 * grid_resolution),
        (x_origin + _c1 * grid_resolution, z_origin + _r1 * grid_resolution),
        ridge_azimuth, ridge_pitch,
        ridge_info['length_m'], ridge_info['peak_height'],
    )

    # Step 11: Grow faces from anchor dots through roof-like cells
    assigned = np.zeros((rows, cols), dtype=bool)
    planes = []
    # Faces sharing the same ridge belong to one roof structure
    main_structure_id = str(uuid.uuid4())[:8]

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

        # Save original mask before tree inference
        original_mask = face_mask.copy()

        # Infer through tree if the face was blocked by variance
        if variance_stops:
            face_mask, n_inferred = _infer_through_tree(
                face_mask, height_grid, variance_stops, assigned, grid_resolution,
            )
            tree_inferred = n_inferred > 0
        else:
            tree_inferred = False

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

        # Fit plane from ORIGINAL cells only (not tree-inferred ones)
        # but use the full mask for boundary extraction
        plane = _fit_and_build_plane(
            original_mask, height_grid, x_origin, z_origin,
            grid_resolution, max_roughness, min_up_component,
            override_azimuth=ridge_azimuth,
            override_pitch=ridge_pitch,
        )
        if plane is not None:
            plane.structure_id = main_structure_id
            if tree_inferred:
                plane.confidence = 0.6
                plane.needs_review = True
            planes.append(plane)

    # Step 9b: Correct ridge using eave boundaries
    # If a face's eave edge drops off at a certain lateral position, the
    # ridge should end there too — eave and ridge run parallel. This fixes
    # cases where trees obscure the ridge endpoint.
    if planes and len(ridge_cells) >= 2:
        ridge_cells = _correct_ridge_from_eaves(
            height_grid, ridge_cells, assigned, ridge_point, grid_resolution,
        )
        # Recompute geometry with corrected ridge
        ridge_azimuth, ridge_pitch, ridge_info = _ridge_geometry(
            height_grid, ridge_cells, x_origin, z_origin, grid_resolution,
            anchor_cells=anchor_cells,
        )
        logger.info(
            "Corrected ridge: azimuth=%.1f°, pitch=%.1f°, length=%.1fm",
            ridge_azimuth, ridge_pitch, ridge_info['length_m'],
        )

    # Update ridge_world from corrected ridge endpoints
    _r0, _c0 = ridge_cells[0]
    _r1, _c1 = ridge_cells[-1]
    ridge_world = (
        (x_origin + _c0 * grid_resolution, z_origin + _r0 * grid_resolution),
        (x_origin + _c1 * grid_resolution, z_origin + _r1 * grid_resolution),
        ridge_azimuth,
        ridge_pitch,
        ridge_info['length_m'],
        ridge_info['peak_height'],
    )

    # Step 10: Cross the ridge — find the other face
    # Seeds: roof-like cells just past the ridge on the opposite side
    ridge_set = set(ridge_cells)
    neighbors = [(-1, 0), (1, 0), (0, -1), (0, 1)]
    opposite_seeds = set()
    for rr, rc in ridge_cells:
        for dr, dc in neighbors:
            nr, nc = rr + dr, rc + dc
            if 0 <= nr < rows and 0 <= nc < cols:
                if (nr, nc) not in ridge_set and not assigned[nr, nc] and roof_mask[nr, nc]:
                    opposite_seeds.add((nr, nc))

    # Detect if the opposite side of the ridge is flat before growing
    opposite_side_is_flat = _is_flat_region(height_grid, dx, dz, opposite_seeds)
    if opposite_side_is_flat:
        logger.info("Opposite side of ridge appears flat — fitting independently (no pitch override)")

    opposite_azimuth = (ridge_azimuth + 180.0) % 360.0

    for sr, sc in opposite_seeds:
        if assigned[sr, sc]:
            continue
        if len(planes) >= max_regions:
            break

        result = _grow_face(
            height_grid, dx, dz, roof_mask, assigned,
            sr, sc, grid_resolution, height_drop_max,
            allow_flat=opposite_side_is_flat,
        )
        if result is None:
            continue
        face_mask, _ = result

        assigned |= face_mask

        if opposite_side_is_flat:
            # Let SVD determine pitch naturally (~0°); still orient azimuth away from ridge
            plane = _fit_and_build_plane(
                face_mask, height_grid, x_origin, z_origin,
                grid_resolution, max_roughness, min_up_component,
                override_azimuth=opposite_azimuth,
                override_pitch=None,
            )
        else:
            plane = _fit_and_build_plane(
                face_mask, height_grid, x_origin, z_origin,
                grid_resolution, max_roughness, min_up_component,
                override_azimuth=opposite_azimuth,
                override_pitch=ridge_pitch,
            )
        if plane is not None:
            plane.structure_id = main_structure_id  # same ridge = same structure
            planes.append(plane)

    # Step 11: Check ridge ends for hip faces
    if len(ridge_cells) >= 2:
        hip_faces = _find_hip_faces(
            height_grid, dx, dz, roof_mask, assigned,
            ridge_cells, grid_resolution, height_drop_max,
        )
        for hf_mask in hip_faces:
            if len(planes) >= max_regions:
                break
            assigned |= hf_mask
            plane = _fit_and_build_plane(
                hf_mask, height_grid, x_origin, z_origin,
                grid_resolution, max_roughness, min_up_component,
            )
            if plane is not None:
                plane.structure_id = main_structure_id  # hip = same structure
                planes.append(plane)

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
    return planes, ridge_world, cell_grid_info


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
    from pipeline.plane_extractor import extract_planes_with_membership
    from pipeline.graph_builder import (
        _build_adjacency,
        _classify_edges,
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

    # 6. Build adjacency and classify edges using graph_builder
    adjacency, shared_edges_info = _build_adjacency(planes, 1.0, 0.5)
    edges = _classify_edges(planes, shared_edges_info)

    # 7. Classify all points
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
    )

    # 8. Compute ridge from plane intersections
    ridge_world = compute_ridge_from_planes(planes, edges)

    # 9. Project per-point labels to the 2D grid for frontend
    cell_labels = project_to_grid(
        lidar_pts,
        result.per_point_class,
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

    logger.info("Plane-first detection complete: %d planes, ridge=%s",
                len(planes), "found" if ridge_world else "none")
    return planes, ridge_world, cell_grid_info


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


def _snap_ridge_to_slope(
    direction: np.ndarray,
    slope_dir: tuple[float, float],
    snap_tolerance_deg: float = 15.0,
) -> np.ndarray:
    """
    Snap the PCA ridge direction to 90° (gable) or 45° (hip) from the slope direction.
    Returns the (possibly corrected) unit direction vector in (row, col) space.
    """
    # slope_dir is (slope_dx, slope_dz) = (col-direction, row-direction)
    slope_vec = np.array([slope_dir[1], slope_dir[0]], dtype=float)
    norm = np.linalg.norm(slope_vec)
    if norm < 1e-6:
        return direction
    slope_vec /= norm

    # Gable: ridge perpendicular to slope
    perp = np.array([-slope_vec[1], slope_vec[0]])
    # Hip: ridge at 45° to slope
    diag = slope_vec + perp
    diag /= np.linalg.norm(diag)

    angle_to_gable = math.degrees(math.acos(min(1.0, abs(float(np.dot(direction, perp))))))
    angle_to_hip   = math.degrees(math.acos(min(1.0, abs(float(np.dot(direction, diag))))))

    best_angle = min(angle_to_gable, angle_to_hip)
    if best_angle > snap_tolerance_deg:
        logger.warning(
            "Ridge direction matches neither gable (%.1f°) nor hip (%.1f°) — keeping PCA fit",
            angle_to_gable, angle_to_hip,
        )
        return direction

    if angle_to_gable <= angle_to_hip:
        snapped = perp if np.dot(direction, perp) >= 0 else -perp
        logger.info("Ridge snapped to GABLE direction (was %.1f° off perpendicular)", angle_to_gable)
    else:
        snapped = diag if np.dot(direction, diag) >= 0 else -diag
        logger.info("Ridge snapped to HIP direction (was %.1f° off 45°)", angle_to_hip)

    return snapped / (np.linalg.norm(snapped) + 1e-9)


def _reproject_ridge_cells(
    ridge_cells: list[tuple[int, int]],
    direction: np.ndarray,
    height_grid: np.ndarray,
    rows: int,
    cols: int,
) -> list[tuple[int, int]]:
    """
    Re-sample ridge cells along a new direction, keeping the same centroid and extent.
    """
    if len(ridge_cells) < 2:
        return ridge_cells
    positions = np.array(ridge_cells, dtype=float)
    centroid = positions.mean(axis=0)
    projs = (positions - centroid) @ direction
    proj_min, proj_max = projs.min(), projs.max()
    n_steps = max(int(math.ceil(proj_max - proj_min)), 1)
    new_cells = []
    for i in range(n_steps + 1):
        t = proj_min + i * (proj_max - proj_min) / n_steps
        pos = centroid + direction * t
        ri, ci = int(round(pos[0])), int(round(pos[1]))
        if 0 <= ri < rows and 0 <= ci < cols:
            if not new_cells or new_cells[-1] != (ri, ci):
                new_cells.append((ri, ci))
    return new_cells if new_cells else ridge_cells


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
            # Anything above the max plausible roof height is taller than the roof — tree
            if h > max_roof_height:
                cell_labels[r, c] = CellLabel.TREE
                continue

            if not roughness_mask[r, c]:
                # Rough cell — check variance first to distinguish trees from edge cells
                h_var = _local_variance_3x3(height_grid, r, c)
                if h_var > _TREE_VARIANCE_THRESH:
                    cell_labels[r, c] = CellLabel.TREE
                    continue
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

    # ---- Pass 3: upgrade ROOF cells to RIDGE_DOT or NEAR_RIDGE ----
    for r in range(rows):
        for c in range(cols):
            if cell_labels[r, c] != CellLabel.ROOF:
                continue
            h = height_grid[r, c]
            gx, gz = dx[r, c], dz[r, c]
            grad_mag = math.sqrt(gx * gx + gz * gz)
            if grad_mag < 0.01:
                continue  # flat area — can't determine ridge geometry

            # Uphill direction (normalized)
            ux, uz = gx / grad_mag, gz / grad_mag  # (col-direction, row-direction)

            # Cell one step further uphill
            nr_up = int(round(r + uz))
            nc_up = int(round(c + ux))
            h_up = (height_grid[nr_up, nc_up]
                    if 0 <= nr_up < rows and 0 <= nc_up < cols
                    else h - 1.0)  # treat out-of-bounds as drop

            # Cell one step downhill (opposite of uphill)
            nr_down = int(round(r - uz))
            nc_down = int(round(c - ux))
            h_down = (height_grid[nr_down, nc_down]
                      if 0 <= nr_down < rows and 0 <= nc_down < cols
                      else h - 1.0)

            # Perpendicular direction (ridge runs this way)
            px, pz = -gz / grad_mag, gx / grad_mag
            nr_pp = int(round(r + pz));  nc_pp = int(round(c + px))
            nr_pm = int(round(r - pz));  nc_pm = int(round(c - px))
            h_pp = (height_grid[nr_pp, nc_pp]
                    if 0 <= nr_pp < rows and 0 <= nc_pp < cols else h - 1.0)
            h_pm = (height_grid[nr_pm, nc_pm]
                    if 0 <= nr_pm < rows and 0 <= nc_pm < cols else h - 1.0)

            # Reject tree canopy before any ridge assignment
            if _local_variance_3x3(height_grid, r, c) > _TREE_VARIANCE_THRESH:
                cell_labels[r, c] = CellLabel.TREE
                continue

            # Ridge check: a RIDGE_DOT must be a local maximum in the slope
            # direction.  If the uphill neighbor is higher, this cell is on the
            # slope — skip ridge assignment but still check for eave below.
            is_ridge_candidate = np.isnan(h_up) or h_up <= h

            if is_ridge_candidate:
                # Predict what the next uphill cell's height SHOULD be if slope continues.
                # grad_mag is height-change per grid cell in the uphill direction.
                # If actual h_up falls short of prediction, the slope broke — we're at the ridge.
                h_predicted_up = h + grad_mag  # expected height one step further uphill

                cond_a = (not np.isnan(h_up)) and (h_up < h_predicted_up - 0.05)  # strong: slope broke
                cond_b = ((not np.isnan(h_pp)) and (not np.isnan(h_pm))
                          and h_pp < h and h_pm < h)                                # local max perpendicular
                cond_c = ((not np.isnan(h_up)) and (h_up < h_predicted_up - 0.02)
                          and (np.isnan(h_pp) or h_pp < h
                               or np.isnan(h_pm) or h_pm < h))                     # soft — low-pitch roofs

                if cond_a or cond_b:
                    cell_labels[r, c] = CellLabel.RIDGE_DOT
                elif cond_c:
                    cell_labels[r, c] = CellLabel.NEAR_RIDGE

            # EAVE_DOT: bottom edge of slope — height drops sharply going downhill.
            # The downslope cell drops significantly relative to the current cell,
            # meaning this cell sits at the roof's lower edge (eave line).
            # Only assign if not already promoted to ridge.
            if cell_labels[r, c] == CellLabel.ROOF and not np.isnan(h_down):
                h_predicted_down = h - grad_mag  # expected height one step downhill
                eave_cond = h_down < h_predicted_down - 0.15  # drops faster than slope predicts
                eave_cond_strong = h_down < h - 0.4           # or absolute drop > 40cm
                if eave_cond or eave_cond_strong:
                    cell_labels[r, c] = CellLabel.EAVE_DOT

    # ---- Pass 2.5: Reclassify narrow FLAT_ROOF regions as RIDGE_DOT ----
    # Real flat roofs have a reasonable aspect ratio. A very long, narrow flat
    # region (e.g. 50ft × 2ft) is a ridge cap, not a flat roof.
    flat_mask = (cell_labels == CellLabel.FLAT_ROOF).astype(np.uint8)
    if flat_mask.any():
        labeled_flat, n_components = ndimage.label(flat_mask)
        min_flat_width_cells = min_flat_roof_width_m / grid_resolution
        for comp_id in range(1, n_components + 1):
            comp_cells = np.argwhere(labeled_flat == comp_id)
            n_cells = len(comp_cells)
            if n_cells < 3:
                for r, c in comp_cells:
                    cell_labels[r, c] = CellLabel.UNSURE
                continue
            positions = comp_cells.astype(float)
            centroid = positions.mean(axis=0)
            centered = positions - centroid
            try:
                _, _, Vt = np.linalg.svd(centered, full_matrices=False)
                principal = Vt[0]
                perp = np.array([-principal[1], principal[0]])
            except np.linalg.LinAlgError:
                continue
            projs_len = centered @ principal
            projs_wid = centered @ perp
            length_cells = projs_len.max() - projs_len.min()
            width_cells = max(projs_wid.max() - projs_wid.min(), 0.1)
            aspect_ratio = length_cells / width_cells
            length_m = length_cells * grid_resolution
            width_m = width_cells * grid_resolution
            too_small = length_m < 1.0 or width_m < 1.0
            too_narrow = aspect_ratio > max_ridge_aspect_ratio
            if too_small or too_narrow:
                for r, c in comp_cells:
                    cell_labels[r, c] = CellLabel.RIDGE_DOT
                logger.debug(
                    "FLAT_ROOF component (n=%d) → RIDGE_DOT "
                    "(length=%.1fm, width=%.1fm, aspect=%.1f)",
                    n_cells, length_m, width_m, aspect_ratio,
                )
            else:
                logger.debug(
                    "FLAT_ROOF component (n=%d) kept — length=%.1fm, width=%.1fm, aspect=%.1f",
                    n_cells, length_m, width_m, aspect_ratio,
                )

    # ---- Pass 4: promote RIDGE_DOT cells at gable ends to RIDGE_EDGE_DOT ----
    # A RIDGE_EDGE_DOT is a ridge dot where, along the ridge direction
    # (perpendicular to local slope), one side quickly reaches GROUND / a large
    # height drop, while the other side still has ROOF / RIDGE_DOT cells.
    _EDGE_LOOK = max(4, int(round(2.0 / grid_resolution)))  # ~2m physical look distance
    _EDGE_DROP = 0.5      # height drop (m) that counts as "ground side"

    for r in range(rows):
        for c in range(cols):
            if cell_labels[r, c] != CellLabel.RIDGE_DOT:
                continue
            h = height_grid[r, c]
            if np.isnan(h):
                continue

            # Ridge direction is perpendicular to the local gradient
            gdx = dx[r, c]
            gdz = dz[r, c]
            mag = math.sqrt(gdx ** 2 + gdz ** 2)
            if mag < 0.001:
                continue
            # In (row, col) space: gradient≈(gdz, gdx); ridge perp = (-gdx, gdz)
            rd_r =  gdz / mag
            rd_c = -gdx / mag

            def _ground_side(dr, dc):
                """True if stepping in (dr,dc) hits GROUND or LOWER_ROOF within _EDGE_LOOK cells."""
                for s in range(1, _EDGE_LOOK + 1):
                    nr = int(round(r + dr * s))
                    nc = int(round(c + dc * s))
                    if not (0 <= nr < rows and 0 <= nc < cols):
                        return True   # off data edge = effectively ground
                    lbl = cell_labels[nr, nc]
                    if lbl in (CellLabel.GROUND, CellLabel.LOWER_ROOF):
                        return True
                return False

            def _roof_side(dr, dc):
                """True if stepping in (dr,dc) finds at least one ROOF/RIDGE_DOT cell."""
                for s in range(1, _EDGE_LOOK + 1):
                    nr = int(round(r + dr * s))
                    nc = int(round(c + dc * s))
                    if not (0 <= nr < rows and 0 <= nc < cols):
                        return False
                    if cell_labels[nr, nc] in (CellLabel.ROOF, CellLabel.RIDGE_DOT,
                                               CellLabel.NEAR_RIDGE, CellLabel.RIDGE_EDGE_DOT):
                        return True
                return False

            fwd_ground = _ground_side( rd_r,  rd_c)
            fwd_roof   = _roof_side  ( rd_r,  rd_c)
            bwd_ground = _ground_side(-rd_r, -rd_c)
            bwd_roof   = _roof_side  (-rd_r, -rd_c)

            # Gable end: ground on one side, roof on the other
            if (fwd_ground and bwd_roof) or (bwd_ground and fwd_roof):
                cell_labels[r, c] = CellLabel.RIDGE_EDGE_DOT

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


def _find_slope_top_candidates(
    height_grid: np.ndarray,
    cell_labels: np.ndarray,
    resolution: float,
    x_origin: float,
    z_origin: float,
    use_near_ridge_fallback: bool = True,
    min_ridge_dot_count: int = 0,   # 0 = auto from resolution (~2.5m worth of cells)
) -> list[tuple[int, int, float, float, float]]:
    """
    Collect ridge-candidate cells from RIDGE_DOT labels, falling back to
    NEAR_RIDGE cells if fewer than min_ridge_dot_count are found.
    Returns list of (row, col, world_x, world_y, world_z).
    """
    if min_ridge_dot_count == 0:
        min_ridge_dot_count = max(5, int(round(2.5 / resolution)))
    ridge_dot_candidates = []
    near_ridge_candidates = []

    # Collect both RIDGE_DOT and RIDGE_EDGE_DOT as strong candidates
    for r, c in np.argwhere(
        (cell_labels == CellLabel.RIDGE_DOT) | (cell_labels == CellLabel.RIDGE_EDGE_DOT)
    ):
        r, c = int(r), int(c)
        world_x = x_origin + c * resolution
        world_y = float(height_grid[r, c])
        world_z = z_origin + r * resolution
        ridge_dot_candidates.append((r, c, world_x, world_y, world_z))
        logger.debug("%s at grid (%d,%d) world XYZ=(%.2f, %.2f, %.2f)",
                     CellLabel(cell_labels[r, c]).name, r, c, world_x, world_y, world_z)

    candidates = list(ridge_dot_candidates)

    if use_near_ridge_fallback and len(candidates) < min_ridge_dot_count:
        logger.info("Only %d RIDGE_DOT cells — expanding to include NEAR_RIDGE cells",
                    len(candidates))
        for r, c in np.argwhere(cell_labels == CellLabel.NEAR_RIDGE):
            r, c = int(r), int(c)
            world_x = x_origin + c * resolution
            world_y = float(height_grid[r, c])
            world_z = z_origin + r * resolution
            near_ridge_candidates.append((r, c, world_x, world_y, world_z))
            logger.debug("NEAR_RIDGE at grid (%d,%d) world XYZ=(%.2f, %.2f, %.2f)",
                         r, c, world_x, world_y, world_z)
        candidates.extend(near_ridge_candidates)

    logger.info(
        "Ridge candidates: %d RIDGE_DOT + %d NEAR_RIDGE = %d total",
        len(ridge_dot_candidates), len(near_ridge_candidates), len(candidates),
    )
    return candidates


def _fit_ridge_line(
    candidates: list[tuple[int, int, float, float, float]],
    height_grid: np.ndarray,
    anchor_cells: list[tuple[int, int]],
    resolution: float,
    x_origin: float,
    z_origin: float,
    anchor_search_radius_m: float = 10.0,
    ransac_inlier_dist_m: float = 1.0,
    min_inliers: int = 0,   # 0 = auto from resolution (~1.5m worth of cells)
    anchor_heights: list[float] | None = None,
) -> tuple[list[tuple[int, int]], np.ndarray] | None:
    """
    Fit a ridge line through slope-top candidates using PCA (SVD) with optional
    RANSAC outlier rejection.

    Returns (ridge_cells, direction) or None if fitting fails.
    ridge_cells is an ordered list of (row, col) along the fitted line.
    direction is a (2,) unit vector [dr, dc] in grid space.
    """
    if not candidates:
        return None

    if min_inliers == 0:
        min_inliers = max(3, int(round(1.5 / resolution)))

    rows, cols = height_grid.shape
    search_cells = anchor_search_radius_m / resolution

    def _min_anchor_dist(r, c):
        return min(math.sqrt((r - ar) ** 2 + (c - ac) ** 2)
                   for ar, ac in anchor_cells)

    # Filter by anchor proximity; relax if too few survive
    proximate = [cand for cand in candidates
                 if _min_anchor_dist(cand[0], cand[1]) <= search_cells]
    if len(proximate) < min_inliers:
        proximate = [cand for cand in candidates
                     if _min_anchor_dist(cand[0], cand[1]) <= search_cells * 2]
    if len(proximate) < min_inliers:
        logger.warning("_fit_ridge_line: only %d proximate candidates after 2× relaxation",
                       len(proximate))
        return None

    # Anchor-height pre-filter: the ridge must be at or above the highest anchor
    # point (minus a small margin). This prevents low-lying tree clusters or
    # ground-level features from being selected as the ridge.
    if anchor_heights:
        min_ridge_h = max(anchor_heights) - 0.5   # ridge ≥ highest anchor − 0.5m
        above_anchor = [c for c in proximate if c[3] >= min_ridge_h]
        if len(above_anchor) >= min_inliers:
            logger.info(
                "Anchor-height pre-filter: kept %d / %d candidates at h≥%.2fm",
                len(above_anchor), len(proximate), min_ridge_h,
            )
            proximate = above_anchor
        else:
            logger.info(
                "Anchor-height pre-filter: only %d above %.2fm — keeping all %d",
                len(above_anchor), min_ridge_h, len(proximate),
            )

    # Height consistency filter — keep the densest cluster within a 1m window.
    # This prevents neighboring structures (fences, sheds, trees) at different
    # heights from polluting the ridge fit.
    heights = sorted(cand[3] for cand in proximate)
    best_start = 0
    best_count_h = 0
    for i, h_lo in enumerate(heights):
        count = sum(1 for h in heights if h <= h_lo + 1.0)
        if count > best_count_h:
            best_count_h = count
            best_start = i
    h_lo_best = heights[best_start]
    h_hi_best = h_lo_best + 1.0
    height_filtered = [c for c in proximate if h_lo_best <= c[3] <= h_hi_best]
    n_dropped = len(proximate) - len(height_filtered)
    if n_dropped > 0:
        logger.info(
            "Height filter: kept %d / %d candidates in [%.2f–%.2fm], dropped %d outliers",
            len(height_filtered), len(proximate), h_lo_best, h_hi_best, n_dropped,
        )
    proximate = height_filtered if len(height_filtered) >= min_inliers else proximate

    positions = np.array([(r, c) for r, c, *_ in proximate], dtype=float)

    # RANSAC (only when enough points to bother)
    inlier_positions = positions
    if len(proximate) >= 10:
        ransac_cells = ransac_inlier_dist_m / resolution
        best_inlier_mask = None
        best_count = 0
        for _ in range(50):
            idx1, idx2 = random.sample(range(len(proximate)), 2)
            p1 = positions[idx1]
            p2 = positions[idx2]
            d = p2 - p1
            d_len = np.linalg.norm(d)
            if d_len < 0.5:
                continue
            d_unit = d / d_len
            perp = np.array([-d_unit[1], d_unit[0]])
            dists = np.abs((positions - p1) @ perp)
            mask = dists < ransac_cells
            n_in = mask.sum()
            if n_in > best_count:
                best_count = n_in
                best_inlier_mask = mask
        if best_inlier_mask is not None and best_count >= min_inliers:
            inlier_positions = positions[best_inlier_mask]

    # PCA via SVD
    try:
        centroid = inlier_positions.mean(axis=0)
        centered = inlier_positions - centroid
        _, _, Vt = np.linalg.svd(centered, full_matrices=False)
        direction = Vt[0]  # principal axis = ridge direction in (row, col) space
    except np.linalg.LinAlgError:
        logger.warning("_fit_ridge_line: SVD failed")
        return None

    direction = direction / (np.linalg.norm(direction) + 1e-9)

    # Project inliers onto line to find extent
    projs = (inlier_positions - centroid) @ direction
    proj_min, proj_max = projs.min(), projs.max()
    ridge_len_cells = proj_max - proj_min

    if ridge_len_cells < 1.0:
        logger.warning("_fit_ridge_line: fitted ridge too short (%.2f cells)", ridge_len_cells)
        return None

    # Walk from start to end along fitted line, sampling one cell at a time
    n_steps = max(int(math.ceil(ridge_len_cells)), 1)
    ridge_cells = []
    for i in range(n_steps + 1):
        t = proj_min + i * (proj_max - proj_min) / n_steps
        pos = centroid + direction * t
        ri = int(round(pos[0]))
        ci = int(round(pos[1]))
        if 0 <= ri < rows and 0 <= ci < cols:
            if not ridge_cells or ridge_cells[-1] != (ri, ci):
                ridge_cells.append((ri, ci))

    # Validate ridge endpoints — a real ridge should be nearly horizontal.
    # Two constraints must both hold:
    #   1. Tilt angle ≤ 8° end-to-end
    #   2. Absolute height difference between endpoints ≤ 0.5m
    # Trim from the higher end until both pass, or reject if unfixable.
    _MAX_TILT_DEG  = 8.0
    _MAX_H_DELTA_M = 0.5

    def _endpoint_metrics(cells):
        """Return (tilt_deg, h_delta_m) for the endpoint quarters of cells."""
        if len(cells) < 2:
            return 0.0, 0.0
        q = max(1, len(cells) // 4)
        s_vals = [height_grid[r, c] for r, c in cells[:q]  if not math.isnan(height_grid[r, c])]
        e_vals = [height_grid[r, c] for r, c in cells[-q:] if not math.isnan(height_grid[r, c])]
        if not s_vals or not e_vals:
            return 0.0, 0.0
        h_s = sorted(s_vals)[len(s_vals) // 2]
        h_e = sorted(e_vals)[len(e_vals) // 2]
        h_delta = abs(h_e - h_s)
        horiz = len(cells) * resolution
        tilt = math.degrees(math.atan2(h_delta, horiz))
        return tilt, h_delta

    tilt, h_delta = _endpoint_metrics(ridge_cells)
    needs_trim = tilt > _MAX_TILT_DEG or h_delta > _MAX_H_DELTA_M
    if needs_trim:
        logger.info(
            "Ridge endpoints: tilt=%.1f°, Δh=%.2fm — trimming the higher end",
            tilt, h_delta,
        )
        while len(ridge_cells) >= 4:
            tilt, h_delta = _endpoint_metrics(ridge_cells)
            if tilt <= _MAX_TILT_DEG and h_delta <= _MAX_H_DELTA_M:
                break
            # Trim from whichever end is higher
            q = max(1, len(ridge_cells) // 4)
            s_h = sorted([height_grid[r, c] for r, c in ridge_cells[:q]
                          if not math.isnan(height_grid[r, c])])[max(0, q // 2 - 1)]
            e_h = sorted([height_grid[r, c] for r, c in ridge_cells[-q:]
                          if not math.isnan(height_grid[r, c])])[max(0, q // 2 - 1)]
            if e_h > s_h:
                ridge_cells = ridge_cells[:-1]
            else:
                ridge_cells = ridge_cells[1:]
        tilt, h_delta = _endpoint_metrics(ridge_cells)
        if tilt > _MAX_TILT_DEG or h_delta > _MAX_H_DELTA_M:
            logger.warning(
                "_fit_ridge_line: endpoints still out of range after trimming "
                "(tilt=%.1f°, Δh=%.2fm) — rejecting",
                tilt, h_delta,
            )
            return None
        logger.info(
            "Ridge trimmed to %d cells — tilt=%.1f°, Δh=%.2fm",
            len(ridge_cells), tilt, h_delta,
        )
    else:
        logger.debug("Ridge endpoints ok: tilt=%.1f°, Δh=%.2fm", tilt, h_delta)

    logger.info(
        "Fitted ridge: %d cells, direction=(%.3f, %.3f), length=%.1f cells (%.1fm)",
        len(ridge_cells), direction[0], direction[1],
        ridge_len_cells, ridge_len_cells * resolution,
    )
    return ridge_cells, direction


# ---------------------------------------------------------------------------
# Ridge Density Validation
# ---------------------------------------------------------------------------

def _validate_ridge_density(
    ridge_cells: list[tuple[int, int]],
    cell_labels: np.ndarray,
    grid_resolution: float = 0.5,
    window_size: int = 0,       # 0 = auto (~2.5m physical window)
    min_hits: int = 4,
    min_final_length: int = 3,
    max_endpoint_gap: int = 0,  # 0 = auto (~1m physical gap)
) -> list[tuple[int, int]]:
    """
    Trim the ridge to the longest continuous stretch where at least min_hits
    out of every window_size cells are labeled RIDGE_DOT or NEAR_RIDGE.

    Also trims stray tails: if more than max_endpoint_gap empty cells separate
    the last valid dot from either endpoint, those tail cells are cut — they
    are likely a neighboring object's dot, not part of this ridge.

    For the main ridge there should be ~4 matching dots in every 5-cell window.
    Returns the trimmed ridge_cells, or the original if no valid stretch found.
    """
    if window_size == 0:
        window_size = max(5, int(round(2.5 / grid_resolution)))
    if max_endpoint_gap == 0:
        max_endpoint_gap = max(2, int(round(1.0 / grid_resolution)))

    if len(ridge_cells) < window_size:
        return ridge_cells

    valid_labels = {CellLabel.RIDGE_DOT, CellLabel.NEAR_RIDGE, CellLabel.RIDGE_EDGE_DOT}
    n = len(ridge_cells)

    # Score each cell: 1 if it matches a ridge label, 0 otherwise
    scores = [1 if cell_labels[r, c] in valid_labels else 0
              for r, c in ridge_cells]

    # For each position, check if its window passes the density threshold
    passes = []
    for i in range(n):
        half = window_size // 2
        lo = max(0, i - half)
        hi = min(n, i + half + 1)
        window_hits = sum(scores[lo:hi])
        window_len = hi - lo
        required = min(min_hits, window_len)  # relax at edges
        passes.append(window_hits >= required)

    # Find the longest contiguous run of True
    best_start, best_len = 0, 0
    cur_start, cur_len = 0, 0
    for i, ok in enumerate(passes):
        if ok:
            if cur_len == 0:
                cur_start = i
            cur_len += 1
            if cur_len > best_len:
                best_len = cur_len
                best_start = cur_start
        else:
            cur_len = 0

    if best_len < min_final_length:
        logger.warning(
            "Ridge density check: no stretch of %d+ cells with %d/%d density — "
            "keeping full ridge (%d cells)",
            min_final_length, min_hits, window_size, len(ridge_cells),
        )
        return ridge_cells

    trimmed_scores = scores[best_start: best_start + best_len]
    trimmed = ridge_cells[best_start: best_start + best_len]

    # Trim stray tails: cut from each end until the outermost valid dot is
    # within max_endpoint_gap cells of the endpoint.
    # More than max_endpoint_gap empty cells at the end = stray dot, not the ridge.
    def _trim_tail(cells, sc):
        """Trim empty cells from one end until last dot is within max_endpoint_gap."""
        gap = 0
        cut = 0
        for s in reversed(sc):
            if s == 1:
                break
            gap += 1
            if gap > max_endpoint_gap:
                cut = gap
        return cells[:len(cells) - cut] if cut else cells, sc[:len(sc) - cut] if cut else sc

    trimmed, trimmed_scores = _trim_tail(trimmed, trimmed_scores)
    trimmed_rev = list(reversed(trimmed))
    scores_rev = list(reversed(trimmed_scores))
    trimmed_rev, scores_rev = _trim_tail(trimmed_rev, scores_rev)
    trimmed = list(reversed(trimmed_rev))

    n_trimmed = n - len(trimmed)
    if n_trimmed > 0:
        logger.info(
            "Ridge density: trimmed %d cells → kept %d-cell stretch "
            "(density %.0f%% in %d-cell windows)",
            n_trimmed, len(trimmed),
            sum(scores_rev) / max(len(scores_rev), 1) * 100,
            window_size,
        )
    return trimmed if len(trimmed) >= min_final_length else ridge_cells


# ---------------------------------------------------------------------------
# Ridge Tracing
# ---------------------------------------------------------------------------

def _trace_uphill(
    height_grid: np.ndarray,
    roof_mask: np.ndarray,
    anchor_cells: list[tuple[int, int]],
    min_height: float = 0.5,
) -> tuple[int, int] | None:
    """
    From anchor dots, trace uphill to find a point on the ridge.
    Only steps into cells that pass the roof_mask (smooth, planar surface).
    This prevents the walk from climbing onto trees or neighboring structures.
    """
    rows, cols = height_grid.shape
    best_r, best_c = None, None
    best_height = -float('inf')

    for start_r, start_c in anchor_cells:
        cr, cc = start_r, start_c
        for _ in range(200):
            current_h = height_grid[cr, cc]
            best_nr, best_nc, best_nh = cr, cc, current_h

            for dr in [-1, 0, 1]:
                for dc in [-1, 0, 1]:
                    if dr == 0 and dc == 0:
                        continue
                    nr, nc = cr + dr, cc + dc
                    if not (0 <= nr < rows and 0 <= nc < cols):
                        continue
                    # Only step into roof-like cells — rejects trees and noise
                    if not roof_mask[nr, nc]:
                        continue
                    nh = height_grid[nr, nc]
                    if nh > best_nh and nh >= min_height:
                        best_nr, best_nc, best_nh = nr, nc, nh

            if best_nh <= current_h:
                break  # At local maximum on the roof surface — this is the ridge
            cr, cc = best_nr, best_nc

        if height_grid[cr, cc] > best_height:
            best_height = height_grid[cr, cc]
            best_r, best_c = cr, cc

    if best_r is None:
        return None
    return (best_r, best_c)


def _trace_ridge(
    height_grid: np.ndarray,
    roof_mask: np.ndarray,
    ridge_point: tuple[int, int],
    dx: np.ndarray,
    dz: np.ndarray,
) -> list[tuple[int, int]]:
    """
    Trace along the ridge from a known ridge point in both directions.

    The ridge direction is perpendicular to the slope direction.
    We trace until height drops significantly or we leave roof-like cells.
    """
    rows, cols = height_grid.shape
    rr, rc = ridge_point
    ridge_height = height_grid[rr, rc]

    # Determine ridge direction: perpendicular to the local slope
    # Slope is (dx, dz), ridge is perpendicular: (-dz, dx) and (dz, -dx)
    slope_dx = float(dx[rr, rc])
    slope_dz = float(dz[rr, rc])

    # If slope is near-zero at the ridge (expected for central differences),
    # sample from cells 2-3 steps away where the gradient is one-sided.
    # Use the anchor-side slope (not averaged abs which kills sign info).
    if abs(slope_dx) < 0.01 and abs(slope_dz) < 0.01:
        best_mag = 0.0
        for offset in range(2, 6):
            for dr, dc in [(-1, 0), (1, 0), (0, -1), (0, 1)]:
                nr, nc = rr + dr * offset, rc + dc * offset
                if 0 <= nr < rows and 0 <= nc < cols:
                    sdx = float(dx[nr, nc])
                    sdz = float(dz[nr, nc])
                    mag = math.sqrt(sdx**2 + sdz**2)
                    if mag > best_mag:
                        slope_dx, slope_dz = sdx, sdz
                        best_mag = mag

    # Ridge direction is perpendicular to slope in (row, col) grid space.
    # Slope in grid space is (dz, dx) [row=z, col=x].
    # Perpendicular of (dz, dx) = (-dx, dz) in (row, col).
    ridge_dir = (-slope_dx, slope_dz)
    mag = math.sqrt(ridge_dir[0]**2 + ridge_dir[1]**2)
    if mag < 0.001:
        # Fallback: try both axes
        ridge_dir = (1.0, 0.0)
        mag = 1.0
    ridge_dir = (ridge_dir[0] / mag, ridge_dir[1] / mag)

    # Trace in both directions along the ridge
    all_cells = [ridge_point]
    visited = {ridge_point}

    for sign in [1, -1]:
        cr, cc = rr, rc
        dr_float = sign * ridge_dir[0]
        dc_float = sign * ridge_dir[1]
        # Track the running peak so we can detect when we're falling off
        local_peak = ridge_height

        for step in range(200):
            # Step in the ridge direction. Stay on the ridge by requiring:
            # 1. Cell is near ridge elevation (not wandered onto a lower roof)
            # 2. Step aligns with ridge direction (don't wander sideways)
            # 3. Cell has low neighbor variance (roof, not tree)
            candidates = []
            for test_dr in [-1, 0, 1]:
                for test_dc in [-1, 0, 1]:
                    if test_dr == 0 and test_dc == 0:
                        continue
                    nr, nc = cr + test_dr, cc + test_dc
                    if (nr, nc) in visited:
                        continue
                    if not (0 <= nr < rows and 0 <= nc < cols):
                        continue
                    h = height_grid[nr, nc]
                    if np.isnan(h) or h < local_peak - 0.8:
                        continue
                    # Must align with ridge direction (dot > 0)
                    dot = test_dr * dr_float + test_dc * dc_float
                    if dot < 0.1:
                        continue
                    # Check local 3x3 variance — reject tree canopy
                    n_count = 0
                    h_sum = 0.0
                    h_sq_sum = 0.0
                    for dr2 in [-1, 0, 1]:
                        for dc2 in [-1, 0, 1]:
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
                            continue
                    score = dot * 2.0 + h / ridge_height
                    candidates.append((score, h, nr, nc))

            if not candidates:
                break

            candidates.sort(reverse=True)
            _, best_h, best_nr, best_nc = candidates[0]

            # Stop if we're significantly below the ridge
            if best_h < ridge_height - 0.8:
                break

            local_peak = max(local_peak * 0.95, best_h)  # gentle decay

            cr, cc = best_nr, best_nc
            visited.add((cr, cc))
            if sign == 1:
                all_cells.append((cr, cc))
            else:
                all_cells.insert(0, (cr, cc))

    return all_cells


def _correct_ridge_from_eaves(
    height_grid: np.ndarray,
    ridge_cells: list[tuple[int, int]],
    assigned: np.ndarray,
    ridge_point: tuple[int, int],
    resolution: float,
    overhang_m: float = 1.524,  # extend 5 feet beyond each face edge
) -> list[tuple[int, int]]:
    """
    Correct the ridge length using the grown face's lateral extent.

    The eave and ridge run parallel on a normal roof — they start and end
    at the same lateral position (the rake/gable end). If trees obscured
    the ridge, the face boundary tells us where it should actually end.

    If the ridge is shorter than the face, extend it.
    If the ridge went past the face (into trees), clip it.
    """
    rows, cols = height_grid.shape
    if len(ridge_cells) < 2:
        return ridge_cells

    # Get ridge direction vector (start → end)
    r0, c0 = ridge_cells[0]
    r1, c1 = ridge_cells[-1]
    rd = r1 - r0
    cd = c1 - c0
    ridge_len = math.sqrt(rd**2 + cd**2)
    if ridge_len < 1:
        return ridge_cells

    # Normalize ridge direction
    rd_n = rd / ridge_len
    cd_n = cd / ridge_len

    # Find the lateral extent of the assigned face projected onto the ridge axis
    face_rows, face_cols = np.where(assigned)
    if len(face_rows) == 0:
        return ridge_cells

    # Project each face cell onto the ridge direction
    # (distance along the ridge from the ridge start)
    projections = (face_rows - r0) * rd_n + (face_cols - c0) * cd_n
    face_min_proj = float(projections.min())
    face_max_proj = float(projections.max())

    # Also project ridge endpoints
    ridge_min_proj = 0.0  # by definition (start)
    ridge_max_proj = ridge_len

    # Compare: clip or extend
    new_min = max(face_min_proj - 2, ridge_min_proj)  # allow 2 cells of slack
    new_max = min(face_max_proj + 2, ridge_max_proj)

    # If the face is wider than the ridge, extend the ridge to face edges + overhang
    overhang_cells = overhang_m / resolution
    if face_min_proj < ridge_min_proj - 1:
        new_min = face_min_proj - overhang_cells
    if face_max_proj > ridge_max_proj + 1:
        new_max = face_max_proj + overhang_cells

    # Filter ridge cells to those within the corrected range
    corrected = []
    for r, c in ridge_cells:
        proj = (r - r0) * rd_n + (c - c0) * cd_n
        if new_min - 1 <= proj <= new_max + 1:
            corrected.append((r, c))

    # If we need to extend the ridge, add cells at ridge height
    rr_p, rc_p = ridge_point
    ridge_height = height_grid[rr_p, rc_p]

    if face_max_proj > ridge_max_proj + 2:
        # Extend to face edge + 5ft overhang
        last_r, last_c = ridge_cells[-1]
        extend_steps = int(face_max_proj - ridge_max_proj + overhang_cells) + 2
        for step in range(1, extend_steps):
            nr = int(round(last_r + rd_n * step))
            nc = int(round(last_c + cd_n * step))
            if 0 <= nr < rows and 0 <= nc < cols:
                h = height_grid[nr, nc]
                if not np.isnan(h) and h > ridge_height - 1.5:
                    corrected.append((nr, nc))

    if face_min_proj < ridge_min_proj - 2:
        first_r, first_c = ridge_cells[0]
        extend_steps = int(ridge_min_proj - face_min_proj + overhang_cells) + 2
        for step in range(1, extend_steps):
            nr = int(round(first_r - rd_n * step))
            nc = int(round(first_c - cd_n * step))
            if 0 <= nr < rows and 0 <= nc < cols:
                h = height_grid[nr, nc]
                if not np.isnan(h) and h > ridge_height - 1.5:
                    corrected.insert(0, (nr, nc))

    if len(corrected) < 2:
        return ridge_cells

    logger.info("Ridge corrected: %d→%d cells (face proj: %.1f to %.1f, ridge was 0 to %.1f)",
                len(ridge_cells), len(corrected), face_min_proj, face_max_proj, ridge_len)
    return corrected


def _ridge_geometry(
    height_grid: np.ndarray,
    ridge_cells: list[tuple[int, int]],
    x_origin: float,
    z_origin: float,
    resolution: float,
    anchor_cells: list[tuple[int, int]] | None = None,
) -> tuple[float, float, dict]:
    """
    Compute azimuth and pitch from the traced ridge line.

    Returns (azimuth_deg, pitch_deg, info_dict).
    - azimuth: direction the anchor-side face faces, perpendicular to ridge
    - pitch: computed from ridge peak to eave height drop
    """
    # Ridge endpoints: cells[0] and cells[-1] are the true furthest-apart points
    # because the trace inserts cells at index 0 for the -direction and appends for +direction.
    start_r, start_c = ridge_cells[0]
    end_r, end_c = ridge_cells[-1]

    # Ridge direction in grid space
    dr = end_r - start_r
    dc = end_c - start_c
    ridge_len_cells = math.sqrt(dr**2 + dc**2)

    if ridge_len_cells < 1:
        return 0.0, 0.0, {'length_m': 0.0}

    # Collinearity check: verify middle points fall on the start→end line.
    # For each intermediate cell, compute perpendicular distance from the axis.
    # Cells more than 1.5 grid cells off-axis indicate the trace wandered.
    if len(ridge_cells) > 4:
        inv_len = 1.0 / ridge_len_cells
        # Unit perpendicular to the line (in row, col space)
        perp_dr = -dc * inv_len
        perp_dc =  dr * inv_len
        max_perp = 0.0
        off_axis = 0
        for mid_r, mid_c in ridge_cells[1:-1]:
            vr = mid_r - start_r
            vc = mid_c - start_c
            perp_dist = abs(vr * perp_dr + vc * perp_dc)
            if perp_dist > max_perp:
                max_perp = perp_dist
            if perp_dist > 1.5:
                off_axis += 1
        consistency_pct = 100.0 * (1.0 - off_axis / max(1, len(ridge_cells) - 2))
        logger.info(
            "Ridge collinearity: %.0f%% on-axis (max_perp=%.2f cells, %d/%d off-axis)",
            consistency_pct, max_perp, off_axis, len(ridge_cells) - 2,
        )
        # If more than 30% of middle cells are off-axis, re-anchor direction to
        # only the inner half of cells where the trace is most reliable.
        if consistency_pct < 70.0 and len(ridge_cells) >= 6:
            q1 = len(ridge_cells) // 4
            q3 = len(ridge_cells) * 3 // 4
            inner_start_r, inner_start_c = ridge_cells[q1]
            inner_end_r,   inner_end_c   = ridge_cells[q3]
            inner_dr = inner_end_r - inner_start_r
            inner_dc = inner_end_c - inner_start_c
            if math.sqrt(inner_dr**2 + inner_dc**2) > 0.5:
                dr, dc = inner_dr, inner_dc
                logger.info("Ridge direction re-anchored to inner quartiles due to low collinearity")

    # Ridge direction in metres (x=col, z=row)
    ridge_dx = dc * resolution  # x direction
    ridge_dz = dr * resolution  # z direction

    # Azimuth: perpendicular to ridge direction
    # Two perpendicular candidates — pick the one pointing toward the anchors
    perp1_az = math.degrees(math.atan2(-ridge_dz, ridge_dx)) % 360.0
    perp2_az = (perp1_az + 180.0) % 360.0

    face_azimuth = perp1_az  # default

    if anchor_cells:
        # Compute which perpendicular direction points from ridge toward anchors
        mid_r, mid_c = ridge_cells[len(ridge_cells) // 2]
        avg_ar = np.mean([a[0] for a in anchor_cells])
        avg_ac = np.mean([a[1] for a in anchor_cells])
        # Vector from ridge midpoint to anchor centroid in (x, z) = (col, row)
        to_anchor_x = (avg_ac - mid_c) * resolution
        to_anchor_z = (avg_ar - mid_r) * resolution
        # Pick the perpendicular that aligns with the anchor direction
        # Convert azimuth to vector: az=0°→north(−z), az=90°→east(+x)
        for candidate_az in [perp1_az, perp2_az]:
            az_rad = math.radians(candidate_az)
            az_x = math.sin(az_rad)
            az_z = -math.cos(az_rad)
            dot = az_x * to_anchor_x + az_z * to_anchor_z
            if dot > 0:
                face_azimuth = candidate_az
                break

    # Ridge length
    ridge_length_m = math.sqrt(ridge_dx**2 + ridge_dz**2)

    # Pitch: from ridge peak height to the eave below
    # Find the peak (highest point on ridge)
    peak_height = max(height_grid[r, c] for r, c in ridge_cells)

    # Find eave height: trace perpendicular from ridge midpoint downhill
    mid_idx = len(ridge_cells) // 2
    mid_r, mid_c = ridge_cells[mid_idx]
    rows, cols = height_grid.shape

    # Perpendicular to ridge = the slope direction
    perp_dr = -dc / ridge_len_cells  # perpendicular row step
    perp_dc = dr / ridge_len_cells   # perpendicular col step

    # Trace downhill to find eave — stop at substantial drop-offs
    eave_height = peak_height
    eave_dist = 0.0
    prev_h = peak_height
    cr, cc = float(mid_r), float(mid_c)
    for step in range(1, 100):
        nr = int(round(cr + perp_dr * step))
        nc = int(round(cc + perp_dc * step))
        if nr < 0 or nr >= rows or nc < 0 or nc >= cols:
            break
        h = height_grid[nr, nc]
        # Stop at sudden drop (>0.5m between consecutive cells) = eave/edge
        if prev_h - h > 0.5:
            break
        # Stop if height starts rising again (crossed into another structure)
        if h > prev_h + 0.1:
            break
        if h < eave_height:
            eave_height = h
            eave_dist = step * resolution
        prev_h = h

    # Pitch from height drop over horizontal distance
    height_drop = peak_height - eave_height
    if eave_dist > 0 and height_drop > 0:
        pitch_deg = math.degrees(math.atan2(height_drop, eave_dist))
    else:
        pitch_deg = 0.0

    # Also compute pitch from ridge endpoints (for hip roofs)
    end_heights = [height_grid[r, c] for r, c in [ridge_cells[0], ridge_cells[-1]]]
    endpoint_drop = peak_height - min(end_heights)

    info = {
        'length_m': ridge_length_m,
        'peak_height': peak_height,
        'eave_height': eave_height,
        'eave_dist_m': eave_dist,
        'height_drop': height_drop,
        'endpoint_drop': endpoint_drop,
        'ridge_cells': len(ridge_cells),
    }

    logger.info(
        "Ridge: peak=%.2fm, eave=%.2fm, drop=%.2fm over %.1fm, pitch=%.1f°",
        peak_height, eave_height, height_drop, eave_dist, pitch_deg,
    )

    return face_azimuth, pitch_deg, info


def _find_hip_faces(
    height_grid: np.ndarray,
    dx: np.ndarray,
    dz: np.ndarray,
    roof_mask: np.ndarray,
    assigned: np.ndarray,
    ridge_cells: list[tuple[int, int]],
    resolution: float,
    height_drop_max: float,
) -> list[np.ndarray]:
    """
    Find hip faces at the ends of the ridge.
    Check cells beyond each ridge endpoint for unassigned roof-like regions.
    """
    rows, cols = height_grid.shape
    hip_faces = []
    neighbors = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]

    # Check both ends of the ridge
    for endpoint in [ridge_cells[0], ridge_cells[-1]]:
        er, ec = endpoint
        # Look at cells around the endpoint that aren't assigned
        for dr, dc in neighbors:
            nr, nc = er + dr, ec + dc
            if 0 <= nr < rows and 0 <= nc < cols:
                if not assigned[nr, nc] and roof_mask[nr, nc]:
                    result = _grow_face(
                        height_grid, dx, dz, roof_mask, assigned,
                        nr, nc, resolution, height_drop_max,
                    )
                    if result is not None and result[0].sum() >= 3:
                        assigned |= result[0]
                        hip_faces.append(result[0])
                        break  # One face per endpoint

    return hip_faces


# ---------------------------------------------------------------------------
# Face Growing (through roof-like cells with consistency)
# ---------------------------------------------------------------------------

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
