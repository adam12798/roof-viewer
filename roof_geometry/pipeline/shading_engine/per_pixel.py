"""
Per-pixel annual POA irradiance bake (Aurora-style).

Each roof section is rasterized into a regular (u, v) grid on its own
plane frame; for every pixel we sum the POA beam + sky diffuse + ground
reflected irradiance across ~120 stratified solar samples across the
year.  When an occluder scene is provided, the beam component is zeroed
for any (pixel, sample) pair where a ray from the pixel toward the sun
is blocked by an obstruction prism or a tree ellipsoid.

The output of each section is a float32 (height × width) grid of annual
kWh/m²/yr values, with ``NaN`` for pixels outside the section polygon.
The grid is serialized as base64 float32 little-endian in the response.

The 120-sample schedule is calibrated against the 8760-hour baseline so
a shadow-free (flat or tilted) plane produces the same annual total as
``run_shading_engine`` on the same inputs, within a few percent.
"""

from __future__ import annotations

import base64
import logging
import math
import time
from datetime import datetime, timezone

import numpy as np

from pipeline.shading_engine.clear_sky import compute_clearsky
from pipeline.shading_engine.occluders import (
    OccluderScene,
    from_obstructions_and_trees,
    rays_blocked,
)
from pipeline.shading_engine.schemas import (
    ObservedRange,
    PerPixelShadingRequest,
    PerPixelShadingResponse,
    SectionGrid,
    SectionPlaneInput,
    Vec3,
)
from pipeline.shading_engine.solar_position import (
    compute_solar_position,
    day_of_year,
)

logger = logging.getLogger(__name__)

PER_PIXEL_VERSION = "perpixel-aurora-bake-v1"

# Same calibrated derate as the per-section engine so the two stay in sync.
_TMY_DERATE = 0.75

# Reference year for solar sampling — non-leap so the 120-sample grid is
# regular.
_REFERENCE_YEAR = 2025

# Max ray length for occluder tests — anything beyond this is ignored
# (no relevant occluders on a residential roof are more than 80 m away).
_RAY_MAX_DIST_M = 80.0

# Epsilon used to lift the ray origin off the roof plane, so pixels
# don't self-shadow against the plane they live on.
_RAY_LIFT_M = 0.02


# ─────────────────────────────────────────────────────────────────────
# Solar sample schedule
# ─────────────────────────────────────────────────────────────────────


def _stratified_solar_timestamps(samples: int) -> tuple[np.ndarray, float]:
    """Return ``(timestamps, hours_per_sample)`` for a stratified schedule.

    We place ``samples/12`` timestamps in the middle of each month at
    equally spaced UTC hours covering the daytime range.  Each sample
    then represents ``8760 / samples`` hours of the year.

    Using a regular stratified grid (rather than true midpoint hours)
    keeps the integration simple: every sample has the same weight
    ``hours_per_sample`` and we multiply by that weight at the end.
    """
    samples = max(12, int(samples))
    # Force divisible-by-12 so each month gets the same count.
    per_month = max(1, samples // 12)
    total = per_month * 12
    # Spread the per-month samples across the whole day at the month's
    # midpoint.  Use float UTC hours 0..24, skipping the sub-hour lead
    # for the first and trailing for the last so the samples don't
    # duplicate midnight across months.
    hours = (np.arange(per_month, dtype=np.float64) + 0.5) * (24.0 / per_month)
    # Month midpoints.
    midpoints = [
        (1, 16), (2, 14), (3, 16), (4, 16),
        (5, 16), (6, 16), (7, 16), (8, 16),
        (9, 16), (10, 16), (11, 16), (12, 16),
    ]
    ts_list: list[np.datetime64] = []
    for (month, day) in midpoints:
        for h in hours:
            whole_h = int(h)
            minute = int(round((h - whole_h) * 60.0))
            if minute == 60:
                minute = 59
            ts_list.append(
                np.datetime64(
                    f"{_REFERENCE_YEAR:04d}-{month:02d}-{day:02d}T"
                    f"{whole_h:02d}:{minute:02d}:00",
                    "s",
                )
            )
    timestamps = np.array(ts_list, dtype="datetime64[s]")
    hours_per_sample = 8760.0 / float(total)
    return timestamps, hours_per_sample


# ─────────────────────────────────────────────────────────────────────
# Section plane frame + rasterization
# ─────────────────────────────────────────────────────────────────────


def _section_plane_frame(vertices: list[Vec3]) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Build an orthonormal plane frame for a section polygon.

    Returns
    -------
    normal : (3,) unit normal (points "up" — positive y component)
    u_dir  : (3,) unit vector spanning the polygon horizontally
    v_dir  : (3,) unit vector = normal × u_dir (up-slope direction)
    verts  : (N, 3) numpy array of the input vertices
    """
    verts = np.array([[v.x, v.y, v.z] for v in vertices], dtype=np.float64)
    if verts.shape[0] < 3:
        raise ValueError("section vertices must contain at least 3 points")

    # Pick the triangle with the largest area for a stable normal.
    best_n = None
    best_area = -1.0
    for i in range(1, verts.shape[0] - 1):
        e1 = verts[i] - verts[0]
        e2 = verts[i + 1] - verts[0]
        cross = np.cross(e1, e2)
        area = float(np.linalg.norm(cross))
        if area > best_area:
            best_area = area
            best_n = cross
    if best_n is None or best_area < 1e-9:
        # Degenerate polygon — default to horizontal up.
        return (
            np.array([0.0, 1.0, 0.0]),
            np.array([1.0, 0.0, 0.0]),
            np.array([0.0, 0.0, 1.0]),
            verts,
        )
    n = best_n / np.linalg.norm(best_n)
    if n[1] < 0.0:
        n = -n

    # Choose u along the projection of world X onto the plane, unless
    # that projection is near-degenerate (steep wall along X), in which
    # case fall back to the projection of world Z.
    def project(vec: np.ndarray) -> np.ndarray:
        return vec - np.dot(vec, n) * n

    candidates = [
        np.array([1.0, 0.0, 0.0]),
        np.array([0.0, 0.0, 1.0]),
    ]
    u_dir = None
    for cand in candidates:
        proj = project(cand)
        nrm = float(np.linalg.norm(proj))
        if nrm > 1e-6:
            u_dir = proj / nrm
            break
    if u_dir is None:
        u_dir = np.array([1.0, 0.0, 0.0])

    v_dir = np.cross(n, u_dir)
    v_dir_len = float(np.linalg.norm(v_dir))
    if v_dir_len < 1e-9:
        v_dir = np.array([0.0, 0.0, 1.0])
    else:
        v_dir = v_dir / v_dir_len
    return n, u_dir, v_dir, verts


def _points_in_polygon_xz(points_xz: np.ndarray, poly_xz: np.ndarray) -> np.ndarray:
    """Vectorized ray-casting point-in-polygon test on the XZ plane.

    ``points_xz`` is (N, 2) and ``poly_xz`` is (M, 2).  Returns an (N,)
    boolean mask: True where the point lies inside the polygon.  The
    polygon may be convex or concave.  Collinear/edge points are
    treated as inside with a small epsilon tolerance.
    """
    n = points_xz.shape[0]
    m = poly_xz.shape[0]
    if n == 0 or m < 3:
        return np.zeros(n, dtype=bool)

    px = points_xz[:, 0]
    pz = points_xz[:, 1]
    inside = np.zeros(n, dtype=bool)
    j = m - 1
    for i in range(m):
        xi, zi = poly_xz[i, 0], poly_xz[i, 1]
        xj, zj = poly_xz[j, 0], poly_xz[j, 1]
        # Edge crosses horizontal line through pt_z?
        cond1 = (zi > pz) != (zj > pz)
        denom = (zj - zi)
        # Guard against zero-length edges.
        if abs(denom) < 1e-12:
            j = i
            continue
        x_cross = (xj - xi) * (pz - zi) / denom + xi
        cond2 = px < x_cross
        flip = cond1 & cond2
        inside ^= flip
        j = i
    return inside


def _rasterize_polygon_mask(uv: np.ndarray, width: int, height: int) -> np.ndarray:
    """Scanline-fill a (height, width) boolean mask from polygon UVs.

    ``uv`` is in **pixel** coordinates already — each row is
    ``[col, row]``.  Edges are closed (last vertex connects to first).
    """
    mask = np.zeros((height, width), dtype=bool)
    n = uv.shape[0]
    if n < 3 or width == 0 or height == 0:
        return mask

    for y in range(height):
        y_mid = y + 0.5
        xs: list[float] = []
        for i in range(n):
            a = uv[i]
            b = uv[(i + 1) % n]
            ay = a[1]; by = b[1]
            if ay == by:
                continue
            if (ay <= y_mid < by) or (by <= y_mid < ay):
                t = (y_mid - ay) / (by - ay)
                xs.append(a[0] + t * (b[0] - a[0]))
        if not xs:
            continue
        xs.sort()
        for k in range(0, len(xs) - 1, 2):
            x0 = int(math.ceil(xs[k] - 0.5))
            x1 = int(math.floor(xs[k + 1] - 0.5))
            x0 = max(0, x0)
            x1 = min(width - 1, x1)
            if x0 <= x1:
                mask[y, x0:x1 + 1] = True
    return mask


# ─────────────────────────────────────────────────────────────────────
# Per-section bake
# ─────────────────────────────────────────────────────────────────────


def _compass_to_world_direction(az_compass_deg: np.ndarray,
                                el_deg: np.ndarray) -> np.ndarray:
    """Convert (compass azimuth, elevation) → world XYZ unit vectors.

    The repo's local frame is X=East, Y=Up, Z=South (positive Z
    decreases latitude).  Compass azimuth is 0=N, 90=E, 180=S, 270=W.

    * Sun at compass N (azimuth=0) is looking south, so the direction
      from surface → sun has a negative Z component.
    * Sun at compass S (azimuth=180) has a positive Z component.
    * Sun at compass E (azimuth=90) has a positive X component.

    Returns an (N, 3) array of unit vectors pointing **toward** the sun.
    """
    az = np.deg2rad(np.asarray(az_compass_deg, dtype=np.float64))
    el = np.deg2rad(np.asarray(el_deg, dtype=np.float64))
    cos_el = np.cos(el)
    sx = cos_el * np.sin(az)
    sy = np.sin(el)
    # South = +Z in this repo, North = -Z. Sun at compass 0 (N) is to
    # the north of the observer, so the vector _toward_ the sun points
    # north → -Z.
    sz = -cos_el * np.cos(az)
    return np.stack([sx, sy, sz], axis=1)


def _bake_one_section(
    section: SectionPlaneInput,
    scene: OccluderScene,
    sun_dirs_world: np.ndarray,      # (S, 3) unit vectors
    cos_z: np.ndarray,               # (S,) cos of solar zenith
    ghi: np.ndarray,                 # (S,) W/m²
    dni: np.ndarray,                 # (S,) W/m²
    dhi: np.ndarray,                 # (S,) W/m²
    hours_per_sample: float,
    albedo: float,
    shadow_enabled: bool,
    excluded_footprints_xz: list[np.ndarray] | None = None,
) -> SectionGrid:
    """Compute the per-pixel annual kWh/m²/yr grid for a single section.

    ``excluded_footprints_xz`` is an optional list of (M, 2) XZ polygon
    arrays.  Pixels whose world XZ lies inside any of these polygons are
    marked NaN in the output grid and skipped for the bake.  This is
    used to clip obstruction (chimney, dormer) footprints out of the
    parent section so we do not bake pixels that sit under a 3D object.
    """
    normal, u_dir, v_dir, verts = _section_plane_frame(section.vertices)

    # Polygon in plane-local (u, v) coordinates (metres).
    centroid = verts.mean(axis=0)
    rel = verts - centroid  # (N, 3)
    u_coords = rel @ u_dir  # (N,)
    v_coords = rel @ v_dir  # (N,)
    u_min = float(u_coords.min())
    u_max = float(u_coords.max())
    v_min = float(v_coords.min())
    v_max = float(v_coords.max())

    res = float(section.resolution_m)
    width = max(1, int(math.ceil((u_max - u_min) / res)))
    height = max(1, int(math.ceil((v_max - v_min) / res)))
    # Safety cap: very large sections should not explode memory.
    # 256 × 256 = 65k px at 0.25 m means a 64 m × 64 m section, which is
    # comfortably larger than any residential roof plane.
    width = min(width, 256)
    height = min(height, 256)

    # Polygon in integer pixel coords for the scanline rasterizer.
    uv_px = np.stack([
        (u_coords - u_min) / res,
        (v_coords - v_min) / res,
    ], axis=1)
    mask = _rasterize_polygon_mask(uv_px, width, height)
    if not np.any(mask):
        # Degenerate section — fall back to the AABB itself so the
        # caller still gets a valid grid.
        mask = np.ones((height, width), dtype=bool)

    in_mask = np.nonzero(mask)
    pixel_rows = in_mask[0]
    pixel_cols = in_mask[1]
    n_pixels = pixel_rows.size

    origin_world = centroid + u_dir * u_min + v_dir * v_min
    # World positions of every in-mask pixel centre.
    pixel_positions = (
        origin_world[None, :]
        + ((pixel_cols[:, None] + 0.5) * res) * u_dir[None, :]
        + ((pixel_rows[:, None] + 0.5) * res) * v_dir[None, :]
    )

    # Clip out pixels whose XZ lies under any excluded obstruction
    # footprint (e.g. a chimney sitting on the main roof, or a sibling
    # dormer).  Those pixels are physically covered by a 3D object and
    # should not be baked as part of this section.
    excluded_row_idxs: np.ndarray | None = None
    excluded_col_idxs: np.ndarray | None = None
    if excluded_footprints_xz:
        points_xz = np.stack(
            [pixel_positions[:, 0], pixel_positions[:, 2]], axis=1
        )
        keep = np.ones(n_pixels, dtype=bool)
        for poly_xz in excluded_footprints_xz:
            if poly_xz is None or poly_xz.shape[0] < 3:
                continue
            # Fast bounding-box reject.
            xmin = float(poly_xz[:, 0].min())
            xmax = float(poly_xz[:, 0].max())
            zmin = float(poly_xz[:, 1].min())
            zmax = float(poly_xz[:, 1].max())
            in_bbox = (
                (points_xz[:, 0] >= xmin)
                & (points_xz[:, 0] <= xmax)
                & (points_xz[:, 1] >= zmin)
                & (points_xz[:, 1] <= zmax)
            )
            candidate = keep & in_bbox
            if not np.any(candidate):
                continue
            inside = _points_in_polygon_xz(points_xz[candidate], poly_xz)
            # Mark these candidate pixels as excluded where inside==True.
            idx = np.nonzero(candidate)[0]
            keep[idx[inside]] = False
        if not np.all(keep):
            excluded_row_idxs = pixel_rows[~keep]
            excluded_col_idxs = pixel_cols[~keep]
            pixel_rows = pixel_rows[keep]
            pixel_cols = pixel_cols[keep]
            pixel_positions = pixel_positions[keep]
            n_pixels = pixel_rows.size

    # Lift off the plane to avoid self-shadowing on obstruction prisms
    # that share the plane.
    ray_origins = pixel_positions + normal[None, :] * _RAY_LIFT_M

    # Preallocate per-pixel watt-hours accumulator.
    wh_per_pixel = np.zeros(n_pixels, dtype=np.float64)

    cos_beta = float(normal[1])  # since normal is unit and y is tilt component
    # cos(beta) in Liu-Jordan = normal · up = normal[1].
    diffuse_factor = 0.5 * (1.0 + cos_beta)
    ground_factor = 0.5 * (1.0 - cos_beta) * float(albedo)

    # Loop over sun samples. For each sample, compute cos(AOI) via
    # dot(sun, normal) and test shadow blocking in one batched call.
    for si in range(sun_dirs_world.shape[0]):
        if cos_z[si] <= 0.0:
            continue  # sun below horizon
        sun = sun_dirs_world[si]
        cos_aoi = float(np.dot(sun, normal))
        if cos_aoi <= 0.0:
            # Back-of-panel for this sample — no beam, diffuse + ground
            # still contribute.
            beam_w = 0.0
        else:
            beam_w = float(dni[si]) * cos_aoi
        dhi_w = float(dhi[si]) * diffuse_factor
        ghi_w = float(ghi[si]) * ground_factor

        if beam_w > 0.0 and shadow_enabled and not scene.is_empty:
            blocked = rays_blocked(scene, ray_origins, sun, _RAY_MAX_DIST_M)
            beam_contrib = np.where(blocked, 0.0, beam_w)
        else:
            beam_contrib = np.full(n_pixels, beam_w, dtype=np.float64)

        sample_wh = (beam_contrib + dhi_w + ghi_w) * hours_per_sample
        wh_per_pixel += sample_wh

    # Convert Wh → kWh and apply the TMY derate for consistency with the
    # per-section engine.
    kwh_per_pixel = (wh_per_pixel / 1000.0) * _TMY_DERATE

    # Assemble grid with NaN for out-of-mask pixels.
    grid = np.full((height, width), np.nan, dtype=np.float32)
    grid[pixel_rows, pixel_cols] = kwh_per_pixel.astype(np.float32)

    in_mask_vals = grid[~np.isnan(grid)]
    if in_mask_vals.size:
        min_k = float(in_mask_vals.min())
        max_k = float(in_mask_vals.max())
        mean_k = float(in_mask_vals.mean())
    else:
        min_k = max_k = mean_k = 0.0

    grid_bytes = grid.astype("<f4").tobytes()
    grid_b64 = base64.b64encode(grid_bytes).decode("ascii")

    return SectionGrid(
        id=section.id,
        width=width,
        height=height,
        origin=Vec3(x=float(origin_world[0]), y=float(origin_world[1]), z=float(origin_world[2])),
        u_axis=Vec3(x=float(u_dir[0] * res), y=float(u_dir[1] * res), z=float(u_dir[2] * res)),
        v_axis=Vec3(x=float(v_dir[0] * res), y=float(v_dir[1] * res), z=float(v_dir[2] * res)),
        min_kwh_per_m2=round(min_k, 2),
        max_kwh_per_m2=round(max_k, 2),
        mean_kwh_per_m2=round(mean_k, 2),
        kwh_grid_b64=grid_b64,
    )


# ─────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────


def run_per_pixel_shading(request: PerPixelShadingRequest) -> PerPixelShadingResponse:
    """Compute per-pixel annual POA irradiance for every section."""
    t_total = time.perf_counter()

    timestamps, hours_per_sample = _stratified_solar_timestamps(request.solar_samples)
    elevation_deg, azimuth_deg = compute_solar_position(
        request.lat, request.lng, timestamps,
    )
    doy = day_of_year(timestamps)
    ghi, dni, dhi = compute_clearsky(elevation_deg, doy)

    sun_dirs = _compass_to_world_direction(azimuth_deg, elevation_deg)
    cos_z = np.sin(np.deg2rad(elevation_deg))

    # Compile occluder scene based on shadow_mode.
    mode = (request.shadow_mode or "both").lower()
    obstructions = [] if mode in ("none", "trees") else list(request.obstructions)
    trees = [] if mode in ("none", "obstructions") else list(request.trees)
    default_scene = from_obstructions_and_trees(obstructions, trees)
    shadow_enabled = mode != "none"

    # Pre-compute each obstruction's XZ footprint as a numpy array for
    # point-in-polygon clipping.  We store tuples of
    # ``(owner_id, footprint_xz)`` so the per-section loop can filter
    # by owner_id without rebuilding the underlying polygons.
    obstruction_meta: list[tuple[str | None, np.ndarray]] = []
    for ob in obstructions:
        if not ob.footprint:
            continue
        poly_xz = np.array(
            [[v.x, v.z] for v in ob.footprint], dtype=np.float64,
        )
        obstruction_meta.append((ob.owner_id, poly_xz))

    # Cache filtered occluder scenes keyed by owner_id (None = default).
    scene_cache: dict[str | None, OccluderScene] = {None: default_scene}
    owner_ids_present = {ob.owner_id for ob in obstructions if ob.owner_id}

    section_grids: list[SectionGrid] = []
    for section in request.sections:
        owner = section.owner_id
        if owner and owner in owner_ids_present:
            if owner not in scene_cache:
                filtered_obs = [o for o in obstructions if o.owner_id != owner]
                scene_cache[owner] = from_obstructions_and_trees(
                    filtered_obs, trees,
                )
            section_scene = scene_cache[owner]
            # Exclude footprints of all obstructions EXCEPT the ones
            # this section owns (so a dormer panel is not clipped by
            # its own prism footprint, but IS clipped by a sibling
            # chimney/dormer sitting on it).
            excluded = [
                poly for (oid, poly) in obstruction_meta if oid != owner
            ]
        else:
            section_scene = default_scene
            # Main-roof sections: clip ALL obstruction footprints so we
            # do not bake pixels that sit under a chimney or dormer.
            excluded = [poly for (_, poly) in obstruction_meta]
        grid = _bake_one_section(
            section,
            section_scene,
            sun_dirs,
            cos_z,
            ghi, dni, dhi,
            hours_per_sample=hours_per_sample,
            albedo=request.albedo,
            shadow_enabled=shadow_enabled,
            excluded_footprints_xz=excluded if excluded else None,
        )
        section_grids.append(grid)

    if section_grids:
        observed = ObservedRange(
            min_kwh_per_m2=round(
                float(min(g.min_kwh_per_m2 for g in section_grids)), 2
            ),
            max_kwh_per_m2=round(
                float(max(g.max_kwh_per_m2 for g in section_grids)), 2
            ),
        )
    else:
        observed = ObservedRange(min_kwh_per_m2=0.0, max_kwh_per_m2=0.0)

    t_total = time.perf_counter() - t_total
    logger.info(
        "Per-pixel shading: %d sections, %d sun samples, %d obstructions, %d trees in %.3fs",
        len(section_grids),
        sun_dirs.shape[0],
        len(obstructions),
        len(trees),
        t_total,
    )

    return PerPixelShadingResponse(
        computed_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        model=PER_PIXEL_VERSION,
        sections=section_grids,
        observed_range=observed,
    )
