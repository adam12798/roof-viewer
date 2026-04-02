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
import logging
import math
import uuid

import numpy as np
from scipy import ndimage

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
    patch_size: int = 5,
    roughness_cap: float = 0.25,
    height_drop_max: float = 0.5,
    min_height: float = 0.5,
    max_roughness: float = 0.20,
    min_up_component: float = 0.3,
    max_regions: int = 20,
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
    """
    if len(lidar_pts) < 10:
        logger.warning("Too few LiDAR points (%d)", len(lidar_pts))
        return []

    if not anchor_dots or len(anchor_dots) < 1:
        logger.warning("No anchor dots provided — cannot seed detection")
        return []

    # Step 1: Build height grid
    height_grid, x_origin, z_origin = build_height_grid(lidar_pts, grid_resolution)
    rows, cols = height_grid.shape
    logger.info("Height grid: %dx%d cells", cols, rows)

    if rows < 5 or cols < 5:
        logger.warning("Height grid too small for anchor-seeded detection")
        return []

    # Step 2: Compute gradients
    dx, dz = compute_gradients(height_grid)

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

    if roof_like_count < 3:
        logger.warning("Too few roof-like cells")
        return []

    # Step 6: Find the ridge by tracing uphill from anchor dots
    ridge_point = _trace_uphill(height_grid, roof_mask, anchor_cells)
    if ridge_point is None:
        logger.warning("Could not find ridge from anchor dots")
        return []
    logger.info("Ridge point found at grid (%d, %d), height=%.2f",
                ridge_point[0], ridge_point[1], height_grid[ridge_point])

    # Step 7: Trace along the ridge to both ends
    ridge_cells = _trace_ridge(height_grid, roof_mask, ridge_point, dx, dz)
    logger.info("Ridge traced: %d cells", len(ridge_cells))

    if len(ridge_cells) < 2:
        logger.warning("Ridge too short")
        return []

    # Step 8: Compute azimuth and pitch from ridge geometry
    ridge_azimuth, ridge_pitch, ridge_info = _ridge_geometry(
        height_grid, ridge_cells, x_origin, z_origin, grid_resolution,
        anchor_cells=anchor_cells,
    )
    logger.info(
        "Ridge geometry: azimuth=%.1f°, pitch=%.1f°, length=%.1fm",
        ridge_azimuth, ridge_pitch, ridge_info['length_m'],
    )

    # Step 9: Grow faces from anchor dots through roof-like cells
    assigned = np.zeros((rows, cols), dtype=bool)
    planes = []
    # Faces sharing the same ridge belong to one roof structure
    main_structure_id = str(uuid.uuid4())[:8]

    # Grow face from the anchor side
    for ar, ac in anchor_cells:
        if assigned[ar, ac]:
            continue

        face_mask = _grow_face(
            height_grid, dx, dz, roof_mask, assigned,
            ar, ac, grid_resolution, height_drop_max,
        )
        if face_mask is None:
            continue

        assigned |= face_mask

        # Validate edges: real roof faces must have substantial drop-offs
        edge_info = _classify_edge_dropoff(
            height_grid, face_mask, assigned,
            1.5, height_drop_max,
        )
        n_ground = len(edge_info['ground_edges'])
        n_roof = len(edge_info['roof_edges'])
        n_weak = len(edge_info['weak_edges'])
        logger.info("Face from anchor (%d,%d): %d ground edges, %d roof step-downs, %d weak",
                    ar, ac, n_ground, n_roof, n_weak)

        # Use ridge-derived azimuth instead of SVD-derived
        plane = _fit_and_build_plane(
            face_mask, height_grid, x_origin, z_origin,
            grid_resolution, max_roughness, min_up_component,
            override_azimuth=ridge_azimuth,
            override_pitch=ridge_pitch,
        )
        if plane is not None:
            plane.structure_id = main_structure_id
            planes.append(plane)

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

    for sr, sc in opposite_seeds:
        if assigned[sr, sc]:
            continue
        if len(planes) >= max_regions:
            break

        face_mask = _grow_face(
            height_grid, dx, dz, roof_mask, assigned,
            sr, sc, grid_resolution, height_drop_max,
        )
        if face_mask is None:
            continue

        assigned |= face_mask

        # Opposite face: azimuth is 180° flipped
        opposite_azimuth = (ridge_azimuth + 180.0) % 360.0
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

        face_mask = _grow_face(
            height_grid, dx, dz, local_mask, assigned,
            sr, sc, grid_resolution, height_drop_max,
        )
        if face_mask is None:
            continue

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

    logger.info("Anchor-seeded detection complete: %d roof planes", len(planes))
    return planes


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
    roughness_cap: float = 0.25,
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
    The ridge is the local height maximum along the slope.

    NOTE: Does NOT require roof_mask — the ridge itself sits at a fold
    where the 5x5 roughness check fails (both slopes in one patch).
    We follow raw height regardless of roughness.
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
                    if 0 <= nr < rows and 0 <= nc < cols:
                        nh = height_grid[nr, nc]
                        if nh > best_nh and nh >= min_height:
                            best_nr, best_nc, best_nh = nr, nc, nh

            if best_nh <= current_h:
                break  # At local maximum — this is the ridge
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
            # 2. Cell is a local maximum perpendicular to ridge (it IS the ridge)
            # 3. Step aligns with ridge direction (don't wander sideways)
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
    # Ridge endpoints and peak
    start_r, start_c = ridge_cells[0]
    end_r, end_c = ridge_cells[-1]

    # Ridge direction in grid space
    dr = end_r - start_r
    dc = end_c - start_c
    ridge_len_cells = math.sqrt(dr**2 + dc**2)

    if ridge_len_cells < 1:
        return 0.0, 0.0, {'length_m': 0.0}

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
                    face_mask = _grow_face(
                        height_grid, dx, dz, roof_mask, assigned,
                        nr, nc, resolution, height_drop_max,
                    )
                    if face_mask is not None and face_mask.sum() >= 3:
                        assigned |= face_mask
                        hip_faces.append(face_mask)
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
) -> np.ndarray | None:
    """
    Grow a face from a seed cell using gradient consistency.

    Stops at:
      - Substantial height drops (> height_drop_max) → real edge/eave
      - Gradient reversal (> 35°) → ridge or different plane
      - Already-assigned cells → another face
      - Cells below min height (0.5m) → ground

    Does NOT stop at roughness mask boundaries — the mask is only used as a
    preference (roof_mask cells are explored first), not a hard boundary.
    This ensures faces extend all the way to real physical edges.
    """
    rows, cols = height_grid.shape
    min_cell_height = 0.5

    if assigned[seed_r, seed_c]:
        # Try to find a nearby unassigned cell
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

    # Initial slope direction from seed
    avg_dx = float(dx[seed_r, seed_c])
    avg_dz = float(dz[seed_r, seed_c])
    n_cells = 1

    consistency_rad = np.radians(35.0)
    neighbors = [(-1, 0), (1, 0), (0, -1), (0, 1)]

    while boundary:
        cr, cc = boundary.popleft()

        for dr, dc in neighbors:
            nr, nc = cr + dr, cc + dc

            if nr < 0 or nr >= rows or nc < 0 or nc >= cols:
                continue
            if face[nr, nc] or assigned[nr, nc]:
                continue

            nh = height_grid[nr, nc]

            # Stop at ground-level cells
            if nh < min_cell_height:
                continue

            # Stop at substantial height drops → real edge
            h_diff = abs(nh - height_grid[cr, cc])
            if h_diff > height_drop_max:
                continue

            # Gradient consistency check → stops at ridges
            cand_dx = float(dx[nr, nc])
            cand_dz = float(dz[nr, nc])
            cand_mag = math.sqrt(cand_dx**2 + cand_dz**2)
            avg_mag = math.sqrt(avg_dx**2 + avg_dz**2)

            if cand_mag > 0.005 and avg_mag > 0.005:
                cos_a = (cand_dx * avg_dx + cand_dz * avg_dz) / (cand_mag * avg_mag)
                cos_a = max(-1.0, min(1.0, cos_a))
                if math.acos(cos_a) > consistency_rad:
                    continue

            # Accept
            face[nr, nc] = True
            boundary.append((nr, nc))
            n_cells += 1
            avg_dx += (cand_dx - avg_dx) / n_cells
            avg_dz += (cand_dz - avg_dz) / n_cells

    if n_cells < 3:
        return None

    logger.debug("Grew face from (%d,%d): %d cells", seed_r, seed_c, n_cells)
    return face


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
    if override_pitch is not None and override_pitch > 0:
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
