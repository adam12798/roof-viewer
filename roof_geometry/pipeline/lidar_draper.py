"""
LiDAR Draper: takes image-defined 2D roof regions and samples LiDAR
elevation data within each to compute 3D geometry (pitch, azimuth, height).

In the image-primary pipeline, the image defines WHERE the boundaries are,
and LiDAR defines the 3D SHAPE (pitch, height, elevation).
"""

from __future__ import annotations

import logging
import math
import uuid
from typing import Optional

import numpy as np

from models.schemas import (
    PlaneEquation,
    PlaneType,
    Point2D,
    Point3D,
    RoofPlane,
)
from pipeline.image_detector import RoofSegment

logger = logging.getLogger(__name__)

try:
    from shapely.geometry import Polygon as ShapelyPolygon, Point as ShapelyPoint
    HAS_SHAPELY = True
except ImportError:
    HAS_SHAPELY = False
    logger.warning("Shapely not installed -- lidar draper will use fallback point-in-polygon")


def drape_lidar(
    roof_segments: list[RoofSegment],
    lidar_points: np.ndarray,
    *,
    min_points_for_plane: int = 10,
) -> list[RoofPlane]:
    """
    Drape LiDAR elevation data onto image-defined roof segments.

    For each roof segment (with image-precise 2D boundary), find the LiDAR
    points that fall within it and fit a plane to get pitch, azimuth, height.

    Parameters
    ----------
    roof_segments : list[RoofSegment]
        Image-derived roof regions with boundary_local in (x, z) metres.
    lidar_points : np.ndarray
        Nx3 array of preprocessed LiDAR points (x, y_height, z) in local metres.
    min_points_for_plane : int
        Minimum LiDAR points within a segment to fit a plane.

    Returns
    -------
    list[RoofPlane]
        Roof planes with image-precise boundaries and LiDAR-derived 3D geometry.
    """
    if lidar_points.ndim != 2 or lidar_points.shape[1] != 3:
        logger.error(f"Expected Nx3 LiDAR array, got shape {lidar_points.shape}")
        return []

    planes: list[RoofPlane] = []
    fitted_planes: list[tuple[str, np.ndarray]] = []  # (segment_id, plane_eq) for neighbor interpolation

    for seg in roof_segments:
        if len(seg.boundary_local) < 3:
            logger.warning(f"Segment {seg.id}: <3 boundary points, skipping")
            continue

        # Find LiDAR points within this segment's boundary
        contained_pts = _points_in_polygon(lidar_points, seg.boundary_local)

        if len(contained_pts) >= min_points_for_plane:
            # Fit plane via SVD
            plane_eq = _fit_plane_svd(contained_pts)
            if plane_eq is not None:
                plane = _build_draped_plane(seg, plane_eq, contained_pts)
                planes.append(plane)
                fitted_planes.append((seg.id, plane_eq))
                logger.info(
                    f"Segment {seg.id}: {len(contained_pts)} LiDAR pts, "
                    f"pitch={plane.pitch_deg:.1f}°, area={plane.area_m2:.1f}m²"
                )
                continue

        # Not enough LiDAR points — try to interpolate from neighbors
        logger.warning(
            f"Segment {seg.id}: only {len(contained_pts)} LiDAR points "
            f"(need {min_points_for_plane}), attempting interpolation"
        )
        plane = _interpolate_plane(seg, contained_pts, fitted_planes, lidar_points)
        if plane is not None:
            planes.append(plane)

    logger.info(f"LiDAR draping complete: {len(planes)} planes from {len(roof_segments)} segments")
    return planes


def _points_in_polygon(
    points: np.ndarray,
    polygon: list[tuple[float, float]],
) -> np.ndarray:
    """
    Filter 3D points to those whose XZ projection falls within a 2D polygon.

    Returns the subset of points (Mx3) that are inside.
    """
    if HAS_SHAPELY:
        poly = ShapelyPolygon(polygon)
        if not poly.is_valid:
            poly = poly.buffer(0)
        xz = points[:, [0, 2]]
        # Vectorized: use prepared geometry for speed
        from shapely.prepared import prep
        prepared = prep(poly)
        mask = np.array([
            prepared.contains(ShapelyPoint(x, z))
            for x, z in xz
        ])
        return points[mask]

    # Fallback: ray casting point-in-polygon
    poly_arr = np.array(polygon)
    xz = points[:, [0, 2]]
    mask = _ray_cast_pip(xz, poly_arr)
    return points[mask]


def _ray_cast_pip(points: np.ndarray, polygon: np.ndarray) -> np.ndarray:
    """Ray casting point-in-polygon test (vectorized)."""
    n = len(polygon)
    mask = np.zeros(len(points), dtype=bool)

    for i in range(n):
        x1, z1 = polygon[i]
        x2, z2 = polygon[(i + 1) % n]

        # Points where ray from (px, pz) going +x crosses this edge
        cond1 = (z1 > points[:, 1]) != (z2 > points[:, 1])
        slope = (x2 - x1) / (z2 - z1 + 1e-30)
        x_intersect = x1 + slope * (points[:, 1] - z1)
        cond2 = points[:, 0] < x_intersect

        mask ^= (cond1 & cond2)

    return mask


def _fit_plane_svd(pts: np.ndarray) -> Optional[np.ndarray]:
    """Fit a plane to points using SVD (least-squares). Returns [a, b, c, d]."""
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


def _build_draped_plane(
    segment: RoofSegment,
    plane_eq: np.ndarray,
    lidar_pts: np.ndarray,
) -> RoofPlane:
    """
    Build a RoofPlane using image-defined boundary + LiDAR-derived geometry.

    The boundary comes from the image (pixel-precise).
    Pitch, azimuth, height come from the LiDAR plane fit.
    """
    normal = plane_eq[:3].copy()
    # Ensure normal points upward
    if normal[1] < 0:
        normal = -normal
        plane_eq = -plane_eq

    a, b, c, d = plane_eq

    # Pitch
    cos_pitch = abs(normal[1]) / np.linalg.norm(normal)
    pitch_deg = float(math.degrees(math.acos(np.clip(cos_pitch, -1, 1))))

    # Azimuth (downslope direction)
    dx, dz = normal[0], normal[2]
    azimuth_deg = float(math.degrees(math.atan2(dx, dz))) % 360.0

    # Build 2D vertices from image boundary
    vertices_2d = [Point2D(x=float(bx), z=float(bz)) for bx, bz in segment.boundary_local]

    # Build 3D vertices by projecting each boundary point onto the LiDAR-fitted plane
    vertices_3d = []
    for bx, bz in segment.boundary_local:
        if abs(b) > 1e-10:
            by = -(a * bx + c * bz + d) / b
        else:
            by = float(lidar_pts[:, 1].mean())
        vertices_3d.append(Point3D(x=float(bx), y=float(by), z=float(bz)))

    # Heights from LiDAR
    height_m = float(lidar_pts[:, 1].max())
    elevation_m = float(lidar_pts[:, 1].min())

    # Area from image boundary
    boundary_arr = np.array(segment.boundary_local)
    flat_area = _shoelace_area(boundary_arr)
    surface_area = flat_area / max(cos_pitch, 0.01)

    is_flat = pitch_deg < 2.0
    plane_type = _classify_plane(surface_area, height_m, elevation_m)

    # Confidence: higher when we have more LiDAR points confirming the fit
    lidar_confidence = min(1.0, len(lidar_pts) / 200.0)
    # Image boundary is high confidence since SAM gave us the outline
    image_confidence = segment.confidence
    # Combined confidence
    confidence = 0.6 * image_confidence + 0.4 * lidar_confidence

    return RoofPlane(
        id=f"plane_{uuid.uuid4().hex[:8]}",
        vertices=vertices_2d,
        vertices_3d=vertices_3d,
        plane_equation=PlaneEquation(a=float(a), b=float(b), c=float(c), d=float(d)),
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


def _interpolate_plane(
    segment: RoofSegment,
    sparse_pts: np.ndarray,
    fitted_planes: list[tuple[str, np.ndarray]],
    all_lidar: np.ndarray,
) -> Optional[RoofPlane]:
    """
    Attempt to create a plane for a segment with insufficient LiDAR points
    by interpolating from neighboring fitted planes.
    """
    if len(sparse_pts) == 0 and not fitted_planes:
        logger.warning(f"Segment {seg.id}: no LiDAR data and no neighbors to interpolate from")
        return None

    # If we have any sparse points, use their mean height
    if len(sparse_pts) >= 3:
        plane_eq = _fit_plane_svd(sparse_pts)
        if plane_eq is not None:
            plane = _build_draped_plane(segment, plane_eq, sparse_pts)
            plane.confidence = round(plane.confidence * 0.5, 3)  # penalize low-data fit
            plane.needs_review = True
            return plane

    # Use nearest neighbor plane
    if fitted_planes:
        seg_center = np.mean(segment.boundary_local, axis=0)

        best_dist = float('inf')
        best_eq = None
        for fid, feq in fitted_planes:
            # Estimate center of that plane (we don't have its boundary here,
            # but the plane equation + nearby lidar gives us something)
            dist = 0.0  # Default: use the most recent plane
            if dist < best_dist:
                best_dist = dist
                best_eq = feq

        if best_eq is not None:
            # Create a synthetic point set from boundary projected onto neighbor's plane
            a, b, c, d = best_eq
            synthetic_pts = []
            for bx, bz in segment.boundary_local:
                if abs(b) > 1e-10:
                    by = -(a * bx + c * bz + d) / b
                else:
                    by = float(all_lidar[:, 1].mean()) if len(all_lidar) > 0 else 3.0
                synthetic_pts.append([bx, by, bz])

            synthetic_arr = np.array(synthetic_pts)
            plane = _build_draped_plane(segment, best_eq, synthetic_arr)
            plane.confidence = round(plane.confidence * 0.3, 3)  # heavily penalized
            plane.needs_review = True
            return plane

    return None


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
