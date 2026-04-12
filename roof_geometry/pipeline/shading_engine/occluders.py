"""
Occluder scene for per-pixel shadow ray-casting.

Contains two primitive types:

* **Obstruction prisms** — vertical extrusions of a 2D footprint from
  ``base_y`` to ``top_y``.  Triangulated on construction into a set of
  side quads + a top cap.  Tested with vectorized Möller-Trumbore.
* **Tree ellipsoids** — axis-aligned ellipsoids with horizontal radius
  ``radius_m`` and vertical half-extent ``(peak_y - base_y) / 2``.
  Closed-form ray-ellipsoid hit test, no triangulation.

Intersection queries use a 2D XZ uniform acceleration grid so each ray
only touches occluders whose XZ footprint overlaps the ray's XZ
projection.  DDA walk along the ray's XZ direction.

All ray tests return a single boolean per ray: ``True`` if the ray is
blocked within its max distance, ``False`` otherwise.  The direction
vectors must be unit length.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from pipeline.shading_engine.schemas import Obstruction3D, Tree3D

# Epsilon used in ray-triangle tests to guard against grazing hits.
_RAY_EPS = 1e-6


def _triangulate_prism(footprint: list[tuple[float, float, float]],
                       base_y: float, top_y: float) -> np.ndarray:
    """Triangulate an extruded prism into an (M, 3, 3) triangle array.

    The footprint is assumed closed (last vertex != first).  Sides are
    emitted as two triangles per edge and the top cap is fan-triangulated
    from the first vertex.  The bottom cap is omitted since rays from
    above a roof can never hit it.
    """
    fp = np.asarray(footprint, dtype=np.float64)
    if fp.ndim != 2 or fp.shape[0] < 3:
        return np.zeros((0, 3, 3), dtype=np.float64)
    # Drop the y coordinate from the footprint and clamp both base/top
    # strictly in ascending order.
    lo = float(min(base_y, top_y))
    hi = float(max(base_y, top_y))
    if hi - lo < 1e-4:
        hi = lo + 1e-4  # avoid degenerate flat prisms

    n = fp.shape[0]
    tris: list[np.ndarray] = []

    # Sides: for each edge (i, i+1) emit two triangles.
    for i in range(n):
        a = fp[i]
        b = fp[(i + 1) % n]
        a_lo = np.array([a[0], lo, a[2]])
        b_lo = np.array([b[0], lo, b[2]])
        a_hi = np.array([a[0], hi, a[2]])
        b_hi = np.array([b[0], hi, b[2]])
        tris.append(np.stack([a_lo, b_lo, b_hi]))
        tris.append(np.stack([a_lo, b_hi, a_hi]))

    # Top cap: fan from fp[0].
    top = np.column_stack([fp[:, 0], np.full(n, hi), fp[:, 2]])
    for i in range(1, n - 1):
        tris.append(np.stack([top[0], top[i], top[i + 1]]))

    return np.asarray(tris, dtype=np.float64)  # (M, 3, 3)


def _xz_aabb_of_triangles(tris: np.ndarray) -> np.ndarray:
    """Return (M, 4) array [xmin, zmin, xmax, zmax] for each triangle."""
    if tris.size == 0:
        return np.zeros((0, 4), dtype=np.float64)
    xs = tris[:, :, 0]
    zs = tris[:, :, 2]
    return np.stack([xs.min(1), zs.min(1), xs.max(1), zs.max(1)], axis=1)


@dataclass
class OccluderScene:
    """Compiled occluder scene ready for ray queries.

    Call :func:`from_obstructions_and_trees` to build one from the
    per-pixel shading request inputs.
    """

    triangles: np.ndarray = field(default_factory=lambda: np.zeros((0, 3, 3), dtype=np.float64))
    tri_aabb_xz: np.ndarray = field(default_factory=lambda: np.zeros((0, 4), dtype=np.float64))

    # Ellipsoid data: (K, 3) centres, (K, 3) radii.
    ellipsoid_centres: np.ndarray = field(default_factory=lambda: np.zeros((0, 3), dtype=np.float64))
    ellipsoid_radii: np.ndarray = field(default_factory=lambda: np.zeros((0, 3), dtype=np.float64))
    ellipsoid_aabb_xz: np.ndarray = field(default_factory=lambda: np.zeros((0, 4), dtype=np.float64))

    # XZ uniform grid for triangle + ellipsoid lookup.
    grid_cell: float = 2.0
    grid_origin: np.ndarray = field(default_factory=lambda: np.zeros(2, dtype=np.float64))
    grid_nx: int = 0
    grid_nz: int = 0
    # For each cell we store lists of triangle and ellipsoid indices.
    tri_cells: list[np.ndarray] = field(default_factory=list)
    ell_cells: list[np.ndarray] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return self.triangles.shape[0] == 0 and self.ellipsoid_centres.shape[0] == 0


def _build_grid(scene_aabbs: np.ndarray, cell: float) -> tuple[np.ndarray, int, int]:
    """Return (origin_xz, nx, nz) for a uniform grid covering all AABBs."""
    if scene_aabbs.size == 0:
        return np.zeros(2, dtype=np.float64), 0, 0
    xmin = float(scene_aabbs[:, 0].min())
    zmin = float(scene_aabbs[:, 1].min())
    xmax = float(scene_aabbs[:, 2].max())
    zmax = float(scene_aabbs[:, 3].max())
    # Pad by one cell so edges don't fall off the grid.
    pad = cell
    xmin -= pad
    zmin -= pad
    xmax += pad
    zmax += pad
    nx = max(1, int(np.ceil((xmax - xmin) / cell)))
    nz = max(1, int(np.ceil((zmax - zmin) / cell)))
    return np.array([xmin, zmin], dtype=np.float64), nx, nz


def _aabbs_to_cells(aabbs: np.ndarray, origin: np.ndarray, cell: float,
                    nx: int, nz: int) -> list[list[int]]:
    """Bucket each AABB into the list of cell indices it overlaps."""
    buckets: list[list[int]] = [[] for _ in range(nx * nz)]
    if aabbs.size == 0 or nx == 0 or nz == 0:
        return buckets
    for idx in range(aabbs.shape[0]):
        x0 = int(np.floor((aabbs[idx, 0] - origin[0]) / cell))
        z0 = int(np.floor((aabbs[idx, 1] - origin[1]) / cell))
        x1 = int(np.floor((aabbs[idx, 2] - origin[0]) / cell))
        z1 = int(np.floor((aabbs[idx, 3] - origin[1]) / cell))
        x0 = max(0, min(nx - 1, x0))
        x1 = max(0, min(nx - 1, x1))
        z0 = max(0, min(nz - 1, z0))
        z1 = max(0, min(nz - 1, z1))
        for iz in range(z0, z1 + 1):
            row = iz * nx
            for ix in range(x0, x1 + 1):
                buckets[row + ix].append(idx)
    return buckets


def from_obstructions_and_trees(
    obstructions: list[Obstruction3D],
    trees: list[Tree3D],
    *,
    grid_cell: float = 2.0,
) -> OccluderScene:
    """Compile occluder primitives into a queryable scene."""
    # 1) Triangulate obstructions.
    all_tris: list[np.ndarray] = []
    for ob in obstructions:
        fp = [(v.x, v.y, v.z) for v in ob.footprint]
        tris = _triangulate_prism(fp, ob.base_y, ob.top_y)
        if tris.size:
            all_tris.append(tris)
    triangles = (np.concatenate(all_tris, axis=0) if all_tris
                 else np.zeros((0, 3, 3), dtype=np.float64))
    tri_aabb_xz = _xz_aabb_of_triangles(triangles)

    # 2) Pack ellipsoid centres + radii.
    if trees:
        centres = np.array([
            [t.center_x, 0.5 * (t.base_y + t.peak_y), t.center_z]
            for t in trees
        ], dtype=np.float64)
        radii = np.array([
            [t.radius_m, max(0.1, 0.5 * (t.peak_y - t.base_y)), t.radius_m]
            for t in trees
        ], dtype=np.float64)
        ell_aabb_xz = np.stack([
            centres[:, 0] - radii[:, 0],
            centres[:, 2] - radii[:, 2],
            centres[:, 0] + radii[:, 0],
            centres[:, 2] + radii[:, 2],
        ], axis=1)
    else:
        centres = np.zeros((0, 3), dtype=np.float64)
        radii = np.zeros((0, 3), dtype=np.float64)
        ell_aabb_xz = np.zeros((0, 4), dtype=np.float64)

    # 3) Combined grid covering triangles + ellipsoids.
    scene_aabbs = np.concatenate([tri_aabb_xz, ell_aabb_xz], axis=0) \
        if (tri_aabb_xz.size or ell_aabb_xz.size) else np.zeros((0, 4), dtype=np.float64)
    origin, nx, nz = _build_grid(scene_aabbs, grid_cell)

    tri_buckets = _aabbs_to_cells(tri_aabb_xz, origin, grid_cell, nx, nz)
    ell_buckets = _aabbs_to_cells(ell_aabb_xz, origin, grid_cell, nx, nz)
    tri_cells = [np.asarray(b, dtype=np.int32) for b in tri_buckets]
    ell_cells = [np.asarray(b, dtype=np.int32) for b in ell_buckets]

    return OccluderScene(
        triangles=triangles,
        tri_aabb_xz=tri_aabb_xz,
        ellipsoid_centres=centres,
        ellipsoid_radii=radii,
        ellipsoid_aabb_xz=ell_aabb_xz,
        grid_cell=float(grid_cell),
        grid_origin=origin,
        grid_nx=nx,
        grid_nz=nz,
        tri_cells=tri_cells,
        ell_cells=ell_cells,
    )


def _moller_trumbore_any(
    origins: np.ndarray,     # (N, 3)
    direction: np.ndarray,   # (3,) — single direction for the batch
    tris: np.ndarray,        # (M, 3, 3)
    max_dist: float,
) -> np.ndarray:
    """Vectorized "any triangle hit" test for rays sharing one direction.

    Returns a boolean mask of shape (N,).  Triangles are assumed to be
    double-sided (both face orientations block).
    """
    n = origins.shape[0]
    if n == 0 or tris.shape[0] == 0:
        return np.zeros(n, dtype=bool)

    v0 = tris[:, 0]  # (M, 3)
    v1 = tris[:, 1]
    v2 = tris[:, 2]
    edge1 = v1 - v0   # (M, 3)
    edge2 = v2 - v0   # (M, 3)

    d = direction.astype(np.float64)
    # h = d × edge2 — shape (M, 3)
    h = np.cross(d[None, :], edge2)
    a = np.einsum("ij,ij->i", edge1, h)  # (M,)

    # Precompute reciprocal of a with grazing guard.
    a_safe = np.where(np.abs(a) < _RAY_EPS, 1.0, a)
    inv_a = np.where(np.abs(a) < _RAY_EPS, 0.0, 1.0 / a_safe)

    hit = np.zeros(n, dtype=bool)

    # Loop over rays (outer) — batched inside over triangles.  With
    # M typically small (≤ a few hundred for v1 occluders) this is fast.
    for r in range(n):
        o = origins[r]  # (3,)
        s = o[None, :] - v0  # (M, 3)
        u = np.einsum("ij,ij->i", s, h) * inv_a  # (M,)
        ok_u = (u >= -_RAY_EPS) & (u <= 1.0 + _RAY_EPS)
        if not np.any(ok_u):
            continue
        q = np.cross(s, edge1)  # (M, 3)
        v = np.einsum("j,ij->i", d, q) * inv_a  # (M,)
        ok_v = (v >= -_RAY_EPS) & ((u + v) <= 1.0 + _RAY_EPS)
        ok = ok_u & ok_v
        if not np.any(ok):
            continue
        t = np.einsum("ij,ij->i", edge2, q) * inv_a  # (M,)
        ok_t = ok & (t > _RAY_EPS) & (t < max_dist)
        if np.any(ok_t):
            hit[r] = True
    return hit


def _ellipsoid_any_hit(
    origins: np.ndarray,     # (N, 3)
    direction: np.ndarray,   # (3,)
    centres: np.ndarray,     # (K, 3)
    radii: np.ndarray,       # (K, 3)
    max_dist: float,
) -> np.ndarray:
    """Vectorized ray-ellipsoid ``any hit`` for a shared direction.

    Each ellipsoid is axis-aligned with half-extents ``radii[k]``.
    Transforming the ray into ellipsoid-local space reduces the test
    to a unit-sphere intersection.
    """
    n = origins.shape[0]
    k = centres.shape[0]
    if n == 0 or k == 0:
        return np.zeros(n, dtype=bool)

    hit = np.zeros(n, dtype=bool)
    d = direction.astype(np.float64)

    for j in range(k):
        c = centres[j]
        r = radii[j]
        # Local-space direction and origins: divide by radii.
        d_local = d / r              # (3,)
        inv_d_len = 1.0 / np.linalg.norm(d_local)
        d_hat = d_local * inv_d_len  # unit vector in local space
        # Origin in local space.
        o_local = (origins - c[None, :]) / r[None, :]  # (N, 3)

        # Unit sphere intersection: |o + t*d_hat|² = 1
        # → t² + 2 (o·d_hat) t + (|o|² - 1) = 0
        b = np.einsum("ij,j->i", o_local, d_hat)    # (N,)
        c_coef = np.einsum("ij,ij->i", o_local, o_local) - 1.0
        disc = b * b - c_coef
        ok = disc > 0.0
        if not np.any(ok):
            continue
        sqrt_disc = np.where(ok, np.sqrt(np.where(ok, disc, 0.0)), 0.0)
        t1 = (-b - sqrt_disc) * inv_d_len  # back to world distance
        t2 = (-b + sqrt_disc) * inv_d_len
        # Need any intersection within (eps, max_dist).
        any_t1 = ok & (t1 > _RAY_EPS) & (t1 < max_dist)
        any_t2 = ok & (t2 > _RAY_EPS) & (t2 < max_dist)
        hit |= any_t1 | any_t2
    return hit


def rays_blocked(
    scene: OccluderScene,
    origins: np.ndarray,     # (N, 3)
    direction: np.ndarray,   # (3,) unit vector in world XYZ
    max_dist: float = 80.0,
) -> np.ndarray:
    """Return a (N,) boolean mask: True where the ray is blocked.

    ``direction`` is assumed to be a unit vector pointing from the
    pixel toward the sun.  All N rays in one batch share the same
    direction (the caller batches by sun sample).

    The XZ acceleration grid is used to prune triangles and ellipsoids
    that cannot possibly overlap the ray batch.  For v1 we take the
    batch's XZ bounding box and union the cells it touches, plus a
    coarse expansion along the ray's XZ direction.
    """
    n = origins.shape[0]
    if n == 0 or scene.is_empty:
        return np.zeros(n, dtype=bool)

    d = np.asarray(direction, dtype=np.float64).reshape(3)
    d_len = float(np.linalg.norm(d))
    if d_len < 1e-9:
        return np.zeros(n, dtype=bool)
    d = d / d_len

    # Compute the union of cell indices the ray batch can touch.
    # For each origin, walk max_dist along XZ.  In practice origins
    # cluster on one roof section so the XZ bbox is small; we just
    # rasterize the XZ bbox of all endpoints.
    ox = origins[:, 0]
    oz = origins[:, 2]
    ex = ox + d[0] * max_dist
    ez = oz + d[2] * max_dist
    xmin = float(min(ox.min(), ex.min()))
    zmin = float(min(oz.min(), ez.min()))
    xmax = float(max(ox.max(), ex.max()))
    zmax = float(max(oz.max(), ez.max()))

    # Convert bbox to cell indices.
    if scene.grid_nx == 0 or scene.grid_nz == 0:
        return np.zeros(n, dtype=bool)
    cell = scene.grid_cell
    g0 = scene.grid_origin
    ix0 = max(0, int(np.floor((xmin - g0[0]) / cell)))
    ix1 = min(scene.grid_nx - 1, int(np.floor((xmax - g0[0]) / cell)))
    iz0 = max(0, int(np.floor((zmin - g0[1]) / cell)))
    iz1 = min(scene.grid_nz - 1, int(np.floor((zmax - g0[1]) / cell)))
    if ix0 > ix1 or iz0 > iz1:
        return np.zeros(n, dtype=bool)

    tri_idx_set: set[int] = set()
    ell_idx_set: set[int] = set()
    for iz in range(iz0, iz1 + 1):
        row = iz * scene.grid_nx
        for ix in range(ix0, ix1 + 1):
            tb = scene.tri_cells[row + ix]
            if tb.size:
                tri_idx_set.update(tb.tolist())
            eb = scene.ell_cells[row + ix]
            if eb.size:
                ell_idx_set.update(eb.tolist())

    blocked = np.zeros(n, dtype=bool)

    if tri_idx_set:
        tri_idx = np.fromiter(tri_idx_set, dtype=np.int32)
        tris = scene.triangles[tri_idx]
        blocked |= _moller_trumbore_any(origins, d, tris, max_dist)

    if ell_idx_set:
        ell_idx = np.fromiter(ell_idx_set, dtype=np.int32)
        centres = scene.ellipsoid_centres[ell_idx]
        radii = scene.ellipsoid_radii[ell_idx]
        # Skip already-blocked rays to save work.
        remaining = ~blocked
        if np.any(remaining):
            hit_remaining = _ellipsoid_any_hit(
                origins[remaining], d, centres, radii, max_dist,
            )
            idx = np.nonzero(remaining)[0]
            blocked[idx[hit_remaining]] = True

    return blocked
