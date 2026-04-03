"""
Plane extraction: multi-plane RANSAC with DBSCAN clustering,
boundary polygon computation, and plane classification.
"""

from __future__ import annotations

import logging
import math
import uuid
from typing import TYPE_CHECKING

import numpy as np

from models.schemas import (
    PlaneEquation,
    PlaneType,
    Point2D,
    Point3D,
    RoofParseOptions,
    RoofPlane,
)

logger = logging.getLogger(__name__)

# Optional imports
try:
    import open3d as o3d
    HAS_O3D = True
except ImportError:
    o3d = None  # type: ignore[assignment]
    HAS_O3D = False

try:
    from sklearn.cluster import DBSCAN
    HAS_SKLEARN = True
except ImportError:
    HAS_SKLEARN = False

try:
    from shapely.geometry import MultiPoint
    HAS_SHAPELY = True
except ImportError:
    HAS_SHAPELY = False


def extract_planes_with_membership(
    point_cloud: np.ndarray,
    options: RoofParseOptions | None = None,
    *,
    distance_threshold: float = 0.20,
    min_inliers: int = 60,
    ransac_n: int = 3,
    num_iterations: int = 1500,
    cluster_eps: float = 2.0,
    cluster_min_samples: int = 20,
    min_area_m2: float = 15.0,
    max_roughness: float = 0.20,
) -> tuple[list[RoofPlane], np.ndarray, list[float]]:
    """
    Extract roof planes and track per-point membership.

    Returns
    -------
    planes : list[RoofPlane]
    point_labels : np.ndarray shape (N,)
        Plane index (0..K-1) per input point, -1 for unassigned.
    per_plane_residuals : list[float]
        RMS residual for each accepted plane.
    """
    if options is None:
        options = RoofParseOptions()

    pts = np.asarray(point_cloud, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 3:
        raise ValueError(f"Expected Nx3 array, got shape {pts.shape}")

    N = len(pts)
    point_labels = np.full(N, -1, dtype=int)
    # Track which original indices are still in the remaining pool
    remaining_indices = np.arange(N)
    remaining = pts.copy()

    raw_segments: list[tuple[np.ndarray, np.ndarray, np.ndarray]] = []  # (plane_eq, inlier_pts, orig_indices)

    for iter_i in range(options.max_planes):
        if len(remaining) < min_inliers:
            logger.info("RANSAC stopping: only %d points remaining (need %d)", len(remaining), min_inliers)
            break

        plane_eq, inlier_mask = _ransac_plane(
            remaining, distance_threshold, ransac_n, num_iterations,
        )
        if plane_eq is None or inlier_mask.sum() < min_inliers:
            logger.info("RANSAC iter %d: no plane found (inliers=%d)",
                        iter_i, 0 if plane_eq is None else int(inlier_mask.sum()))
            break

        inlier_pts = remaining[inlier_mask]
        inlier_orig_idx = remaining_indices[inlier_mask]
        remaining = remaining[~inlier_mask]
        remaining_indices = remaining_indices[~inlier_mask]
        raw_segments.append((plane_eq, inlier_pts, inlier_orig_idx))
        logger.info("RANSAC iter %d: found plane with %d inliers, %d remaining",
                     iter_i, len(inlier_pts), len(remaining))

    planes: list[RoofPlane] = []
    per_plane_residuals: list[float] = []
    plane_idx = 0

    for seg_i, (plane_eq, inlier_pts, orig_idx) in enumerate(raw_segments):
        clusters = _cluster_inliers(inlier_pts, cluster_eps, cluster_min_samples)
        # Also cluster the original indices in the same way
        clusters_idx = _cluster_inlier_indices(inlier_pts, orig_idx, cluster_eps, cluster_min_samples)
        logger.info("Segment %d: %d inliers -> %d clusters", seg_i, len(inlier_pts), len(clusters))

        for ci, (cluster_pts, cluster_orig) in enumerate(zip(clusters, clusters_idx)):
            if len(cluster_pts) < min_inliers:
                logger.info("  Cluster with %d points: SKIP (< %d min_inliers)", len(cluster_pts), min_inliers)
                continue

            refined_eq = _fit_plane_svd(cluster_pts)
            if refined_eq is None:
                refined_eq = plane_eq

            normal = refined_eq[:3]
            d_val = refined_eq[3]
            residuals = np.abs(cluster_pts @ normal + d_val)
            roughness = float(np.sqrt(np.mean(residuals ** 2)))

            if roughness > max_roughness:
                logger.debug("Rejecting plane: roughness=%.3f > %.3f", roughness, max_roughness)
                continue

            up_component = abs(normal[1]) / (np.linalg.norm(normal) + 1e-10)
            if up_component < 0.3:
                logger.debug("Rejecting plane: near-vertical (up_component=%.3f)", up_component)
                continue

            plane = _build_roof_plane(refined_eq, cluster_pts)
            if plane.area_m2 < min_area_m2:
                logger.info("  Cluster with %d points: SKIP (area=%.1f < %.1f)", len(cluster_pts), plane.area_m2, min_area_m2)
                continue

            logger.info("  Cluster with %d points: ACCEPTED (roughness=%.3f, up=%.3f, area=%.1f)",
                        len(cluster_pts), roughness, up_component, plane.area_m2)
            planes.append(plane)
            per_plane_residuals.append(roughness)
            point_labels[cluster_orig] = plane_idx
            plane_idx += 1

    if options.merge_coplanar and len(planes) > 1:
        planes = _merge_coplanar(planes)

    logger.info("Extracted %d roof planes with membership", len(planes))
    return planes, point_labels, per_plane_residuals


def extract_planes(
    point_cloud: np.ndarray,
    options: RoofParseOptions | None = None,
    *,
    distance_threshold: float = 0.20,
    min_inliers: int = 60,
    ransac_n: int = 3,
    num_iterations: int = 1500,
    cluster_eps: float = 2.0,
    cluster_min_samples: int = 20,
    min_area_m2: float = 15.0,
    max_roughness: float = 0.20,
) -> list[RoofPlane]:
    """
    Extract roof planes from a height-normalised point cloud using
    iterative RANSAC followed by DBSCAN clustering.

    Parameters
    ----------
    point_cloud : np.ndarray
        Nx3 array (x, y, z) with y = height above ground.
    options : RoofParseOptions, optional
        Pipeline options (max_planes, merge_coplanar, etc.).
    distance_threshold : float
        RANSAC inlier distance threshold (metres).
    min_inliers : int
        Minimum points for a valid plane.
    ransac_n : int
        Points sampled per RANSAC iteration.
    num_iterations : int
        RANSAC iteration count.
    cluster_eps : float
        DBSCAN epsilon for spatial clustering of inliers.
    cluster_min_samples : int
        DBSCAN minimum cluster size.

    Returns
    -------
    list[RoofPlane]
        Detected roof planes with boundaries, pitch, azimuth, etc.
    """
    if options is None:
        options = RoofParseOptions()

    pts = np.asarray(point_cloud, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[1] != 3:
        raise ValueError(f"Expected Nx3 array, got shape {pts.shape}")

    remaining = pts.copy()
    raw_segments: list[tuple[np.ndarray, np.ndarray]] = []  # (plane_eq, inlier_pts)

    for iter_i in range(options.max_planes):
        if len(remaining) < min_inliers:
            logger.info("RANSAC stopping: only %d points remaining (need %d)", len(remaining), min_inliers)
            break

        plane_eq, inlier_mask = _ransac_plane(
            remaining, distance_threshold, ransac_n, num_iterations,
        )
        if plane_eq is None or inlier_mask.sum() < min_inliers:
            logger.info("RANSAC iter %d: no plane found (inliers=%d)",
                        iter_i, 0 if plane_eq is None else int(inlier_mask.sum()))
            break

        inlier_pts = remaining[inlier_mask]
        remaining = remaining[~inlier_mask]
        raw_segments.append((plane_eq, inlier_pts))
        logger.info("RANSAC iter %d: found plane with %d inliers, %d remaining",
                     iter_i, len(inlier_pts), len(remaining))

    # Cluster each RANSAC segment to separate disconnected coplanar regions
    planes: list[RoofPlane] = []
    for seg_i, (plane_eq, inlier_pts) in enumerate(raw_segments):
        clusters = _cluster_inliers(inlier_pts, cluster_eps, cluster_min_samples)
        logger.info("Segment %d: %d inliers -> %d clusters", seg_i, len(inlier_pts), len(clusters))
        for cluster_pts in clusters:
            if len(cluster_pts) < min_inliers:
                logger.info("  Cluster with %d points: SKIP (< %d min_inliers)", len(cluster_pts), min_inliers)
                continue

            # Refit plane to this cluster for accuracy
            refined_eq = _fit_plane_svd(cluster_pts)
            if refined_eq is None:
                refined_eq = plane_eq

            # Roughness check: compute RMS residual of points to fitted plane
            # Trees have high roughness (>0.5m), roofs are smooth (<0.3m)
            normal = refined_eq[:3]
            d_val = refined_eq[3]
            residuals = np.abs(cluster_pts @ normal + d_val)
            roughness = float(np.sqrt(np.mean(residuals ** 2)))

            if roughness > max_roughness:
                logger.debug(
                    "Rejecting plane: roughness=%.3f > %.3f (likely tree/vegetation)",
                    roughness, max_roughness,
                )
                continue

            # Normal direction check: reject near-vertical planes (walls, fences)
            # Normal y-component should be > 0.3 for any legitimate roof plane
            up_component = abs(normal[1]) / (np.linalg.norm(normal) + 1e-10)
            if up_component < 0.3:
                logger.debug(
                    "Rejecting plane: near-vertical (up_component=%.3f)",
                    up_component,
                )
                continue

            plane = _build_roof_plane(refined_eq, cluster_pts)
            logger.info("  Cluster with %d points: ACCEPTED (roughness=%.3f, up=%.3f, area=%.1f)",
                        len(cluster_pts), roughness, up_component, plane.area_m2)
            planes.append(plane)

    # Filter out tiny planes (trees, debris, noise)
    planes = [p for p in planes if p.area_m2 >= min_area_m2]
    logger.info("After area filter (>= %.1f m²): %d planes", min_area_m2, len(planes))

    # Optional: merge nearly-coplanar adjacent planes
    if options.merge_coplanar and len(planes) > 1:
        planes = _merge_coplanar(planes)

    logger.info("Extracted %d roof planes", len(planes))
    return planes


# ---------------------------------------------------------------------------
# RANSAC
# ---------------------------------------------------------------------------

def _ransac_plane(
    pts: np.ndarray,
    dist_thresh: float,
    n_sample: int,
    n_iter: int,
) -> tuple[np.ndarray | None, np.ndarray]:
    """
    Fit the best plane via RANSAC.  Uses Open3D if available, else numpy.

    Returns (plane_coeffs [a,b,c,d], boolean inlier_mask).
    """
    if HAS_O3D and len(pts) > n_sample:
        pcd = o3d.geometry.PointCloud()
        pcd.points = o3d.utility.Vector3dVector(pts)
        plane_model, inlier_idx = pcd.segment_plane(
            distance_threshold=dist_thresh,
            ransac_n=n_sample,
            num_iterations=n_iter,
        )
        mask = np.zeros(len(pts), dtype=bool)
        mask[inlier_idx] = True
        return np.array(plane_model), mask

    # Numpy fallback RANSAC
    best_inliers = np.zeros(len(pts), dtype=bool)
    best_eq = None
    best_count = 0

    rng = np.random.default_rng(42)
    for _ in range(n_iter):
        idx = rng.choice(len(pts), size=n_sample, replace=False)
        sample = pts[idx]

        # Fit plane through 3 points
        v1 = sample[1] - sample[0]
        v2 = sample[2] - sample[0]
        normal = np.cross(v1, v2)
        norm_len = np.linalg.norm(normal)
        if norm_len < 1e-10:
            continue
        normal /= norm_len
        d = -normal @ sample[0]

        # Evaluate all points
        dists = np.abs(pts @ normal + d)
        inlier_mask = dists < dist_thresh
        count = inlier_mask.sum()

        if count > best_count:
            best_count = count
            best_inliers = inlier_mask
            best_eq = np.append(normal, d)

    return best_eq, best_inliers


# ---------------------------------------------------------------------------
# Clustering
# ---------------------------------------------------------------------------

def _cluster_inliers(
    pts: np.ndarray,
    eps: float,
    min_samples: int,
) -> list[np.ndarray]:
    """Split inlier points into spatially connected clusters via DBSCAN."""
    if len(pts) < min_samples:
        return [pts]

    if HAS_SKLEARN:
        # Cluster on XZ (horizontal) to separate disconnected regions
        xz = pts[:, [0, 2]]
        labels = DBSCAN(eps=eps, min_samples=min_samples).fit_predict(xz)
        clusters = []
        for label in set(labels):
            if label == -1:
                continue  # noise
            clusters.append(pts[labels == label])
        return clusters if clusters else [pts]

    # Fallback: return all as one cluster
    return [pts]


def _cluster_inlier_indices(
    pts: np.ndarray,
    orig_indices: np.ndarray,
    eps: float,
    min_samples: int,
) -> list[np.ndarray]:
    """Split original indices into clusters matching _cluster_inliers output."""
    if len(pts) < min_samples:
        return [orig_indices]

    if HAS_SKLEARN:
        xz = pts[:, [0, 2]]
        labels = DBSCAN(eps=eps, min_samples=min_samples).fit_predict(xz)
        clusters = []
        for label in set(labels):
            if label == -1:
                continue
            clusters.append(orig_indices[labels == label])
        return clusters if clusters else [orig_indices]

    return [orig_indices]


# ---------------------------------------------------------------------------
# Plane fitting
# ---------------------------------------------------------------------------

def _fit_plane_svd(pts: np.ndarray) -> np.ndarray | None:
    """Fit a plane to points using SVD (least-squares)."""
    centroid = pts.mean(axis=0)
    centered = pts - centroid
    _, _, Vt = np.linalg.svd(centered, full_matrices=False)
    normal = Vt[-1]  # smallest singular value
    norm_len = np.linalg.norm(normal)
    if norm_len < 1e-10:
        return None
    normal /= norm_len
    d = -normal @ centroid
    return np.append(normal, d)


# ---------------------------------------------------------------------------
# Build RoofPlane from points
# ---------------------------------------------------------------------------

def _build_roof_plane(plane_eq: np.ndarray, pts: np.ndarray) -> RoofPlane:
    """Construct a RoofPlane model from plane coefficients and member points."""
    normal = plane_eq[:3]
    # Ensure normal points upward (positive y component)
    if normal[1] < 0:
        normal = -normal
        plane_eq = -plane_eq

    # Pitch: angle between normal and vertical (0,1,0)
    cos_pitch = abs(normal[1]) / np.linalg.norm(normal)
    pitch_deg = float(math.degrees(math.acos(np.clip(cos_pitch, -1, 1))))

    # Azimuth: direction of the downslope in XZ plane
    # Downslope = projection of normal onto XZ, then flip (water flows away from normal)
    dx, dz = normal[0], normal[2]
    azimuth_deg = float(math.degrees(math.atan2(dx, dz))) % 360.0

    # Boundary polygon (convex hull on XZ)
    xz = pts[:, [0, 2]]
    boundary_2d = _compute_boundary(xz)

    # Corresponding 3D boundary: project each 2D vertex to the plane
    a, b, c, d = plane_eq
    vertices_3d = []
    for bx, bz in boundary_2d:
        if abs(b) > 1e-10:
            by = -(a * bx + c * bz + d) / b
        else:
            by = float(pts[:, 1].mean())
        vertices_3d.append(Point3D(x=float(bx), y=float(by), z=float(bz)))

    vertices_2d = [Point2D(x=float(bx), z=float(bz)) for bx, bz in boundary_2d]

    # Area: use Shoelace on XZ, then divide by cos(pitch) for true surface area
    flat_area = _shoelace_area(boundary_2d)
    surface_area = flat_area / max(cos_pitch, 0.01)

    height_m = float(pts[:, 1].max())
    elevation_m = float(pts[:, 1].min())

    is_flat = pitch_deg < 2.0

    # Classify plane type by heuristics
    plane_type = _classify_plane(surface_area, height_m, elevation_m, pts)

    # Confidence from inlier density
    confidence = min(1.0, len(pts) / 200.0)

    return RoofPlane(
        id=f"plane_{uuid.uuid4().hex[:8]}",
        vertices=vertices_2d,
        vertices_3d=vertices_3d,
        plane_equation=PlaneEquation(
            a=float(plane_eq[0]),
            b=float(plane_eq[1]),
            c=float(plane_eq[2]),
            d=float(plane_eq[3]),
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


def _compute_boundary(xz: np.ndarray) -> np.ndarray:
    """Compute boundary polygon of XZ points (convex hull or alpha shape)."""
    if len(xz) < 3:
        return xz

    if HAS_SHAPELY:
        mp = MultiPoint(xz.tolist())
        hull = mp.convex_hull
        if hull.geom_type == "Polygon":
            coords = np.array(hull.exterior.coords[:-1])  # drop closing vertex
            return coords
        elif hull.geom_type == "LineString":
            return np.array(hull.coords)
        return xz[:3]

    # Numpy fallback: simple convex hull via scipy
    try:
        from scipy.spatial import ConvexHull
        hull = ConvexHull(xz)
        return xz[hull.vertices]
    except Exception:
        return xz[:3]


def _shoelace_area(poly: np.ndarray) -> float:
    """Shoelace formula for polygon area."""
    n = len(poly)
    if n < 3:
        return 0.0
    x = poly[:, 0]
    z = poly[:, 1]
    return float(0.5 * abs(np.dot(x, np.roll(z, -1)) - np.dot(z, np.roll(x, -1))))


def _classify_plane(
    area: float,
    height: float,
    elevation: float,
    pts: np.ndarray,
) -> PlaneType:
    """
    Classify a plane based on size, height, and position heuristics.
    """
    # Small elevated planes on top of others => dormer
    if area < 5.0 and elevation > 2.0:
        return PlaneType.dormer

    # Low, small structures => porch
    if area < 15.0 and height < 3.0:
        return PlaneType.porch

    # Medium planes detached from the main cluster => garage
    if area < 30.0 and elevation < 1.5:
        return PlaneType.garage

    return PlaneType.main


# ---------------------------------------------------------------------------
# Merge coplanar
# ---------------------------------------------------------------------------

def _merge_coplanar(
    planes: list[RoofPlane],
    angle_thresh_deg: float = 10.0,
    dist_thresh_m: float = 1.0,
) -> list[RoofPlane]:
    """
    Merge planes whose normals are within angle_thresh_deg and whose
    centroids project within dist_thresh_m of each other's plane.
    """
    # Simple greedy merge
    merged: list[RoofPlane] = []
    used = set()

    for i, p1 in enumerate(planes):
        if i in used:
            continue
        group = [p1]
        n1 = np.array([p1.plane_equation.a, p1.plane_equation.b, p1.plane_equation.c])
        n1_norm = n1 / (np.linalg.norm(n1) + 1e-10)

        for j in range(i + 1, len(planes)):
            if j in used:
                continue
            p2 = planes[j]
            n2 = np.array([p2.plane_equation.a, p2.plane_equation.b, p2.plane_equation.c])
            n2_norm = n2 / (np.linalg.norm(n2) + 1e-10)

            angle = math.degrees(math.acos(np.clip(abs(np.dot(n1_norm, n2_norm)), 0, 1)))
            if angle < angle_thresh_deg:
                # Check distance between centroids projected onto plane
                c2 = np.mean([[v.x, v.z] for v in p2.vertices], axis=0)
                plane_dist = abs(n1[0] * c2[0] + n1[2] * c2[1] + p1.plane_equation.d)
                norm_horiz = math.sqrt(n1[0] ** 2 + n1[2] ** 2) + 1e-10
                if plane_dist / norm_horiz < dist_thresh_m:
                    group.append(p2)
                    used.add(j)

        # Keep the largest plane from the group (simplified merge)
        best = max(group, key=lambda p: p.area_m2)
        merged.append(best)

    return merged
