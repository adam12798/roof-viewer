"""
Fusion: merge LiDAR-derived planes with image-derived detections,
refine boundaries, and reconcile disagreements.
"""

from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

import numpy as np

from models.schemas import (
    PlaneEquation,
    PlaneType,
    Point2D,
    Point3D,
    RoofPlane,
)
from pipeline.image_detector import DetectedContour, DetectedEdge, ImageDetections

logger = logging.getLogger(__name__)

try:
    from shapely.geometry import Polygon as ShapelyPolygon
    HAS_SHAPELY = True
except ImportError:
    HAS_SHAPELY = False


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def fuse_detections(
    lidar_planes: list[RoofPlane],
    image_detections: ImageDetections,
    registration: "RegistrationTransform | None" = None,
    *,
    iou_match_threshold: float = 0.15,
    edge_snap_distance_m: float = 0.5,
) -> list[RoofPlane]:
    """
    Fuse LiDAR planes with image detections.

    1. Match LiDAR planes to image contours by IoU.
    2. Refine matched plane boundaries using image edges.
    3. Create new planes for unmatched image contours (image-only detections).
    4. Flag disagreements for review.

    Parameters
    ----------
    lidar_planes : list[RoofPlane]
        Planes extracted from LiDAR data.
    image_detections : ImageDetections
        Edges, contours, and material regions from image analysis.
    registration : RegistrationTransform, optional
        For coordinate alignment (already applied if preprocessing was done).
    iou_match_threshold : float
        Minimum IoU to consider a LiDAR plane matched to an image contour.
    edge_snap_distance_m : float
        Maximum distance to snap a LiDAR boundary vertex to an image edge.

    Returns
    -------
    list[RoofPlane]
        Fused plane list with updated boundaries and confidence.
    """
    if not image_detections.contours and not image_detections.edges:
        # No image data to fuse -- return LiDAR planes as-is
        logger.info("No image detections to fuse; returning %d LiDAR planes", len(lidar_planes))
        return lidar_planes

    # Step 1: Match LiDAR planes to image contours by IoU
    matched_lidar: set[int] = set()
    matched_image: set[int] = set()
    matches: list[tuple[int, int, float]] = []  # (lidar_idx, contour_idx, iou)

    for li, plane in enumerate(lidar_planes):
        plane_poly = [(v.x, v.z) for v in plane.vertices]
        best_iou = 0.0
        best_ci = -1

        for ci, contour in enumerate(image_detections.contours):
            iou = _compute_iou(plane_poly, contour.points)
            if iou > best_iou:
                best_iou = iou
                best_ci = ci

        if best_iou >= iou_match_threshold and best_ci >= 0:
            matches.append((li, best_ci, best_iou))
            matched_lidar.add(li)
            matched_image.add(best_ci)

    logger.info("Matched %d LiDAR planes to image contours", len(matches))

    # Step 2: Refine matched planes using image edges
    fused_planes: list[RoofPlane] = []

    for li, ci, iou in matches:
        plane = lidar_planes[li]
        # Boost confidence when both sources agree
        new_confidence = min(1.0, plane.confidence + 0.2 * iou)
        refined = _snap_to_edges(plane, image_detections.edges, edge_snap_distance_m)
        refined_plane = plane.model_copy(update={
            "confidence": round(new_confidence, 3),
            "needs_review": new_confidence < 0.5,
            "vertices": refined if refined else plane.vertices,
        })
        fused_planes.append(refined_plane)

    # Step 3: Add unmatched LiDAR planes (not found in image)
    for li, plane in enumerate(lidar_planes):
        if li not in matched_lidar:
            # Lower confidence -- only LiDAR evidence
            updated = plane.model_copy(update={
                "confidence": round(plane.confidence * 0.8, 3),
                "needs_review": True,
            })
            fused_planes.append(updated)

    # Step 4: Create planes for unmatched image contours
    for ci, contour in enumerate(image_detections.contours):
        if ci in matched_image:
            continue
        if contour.area_m2 < 3.0:
            continue  # skip tiny contours

        # Create an image-only plane with lower confidence
        new_plane = _contour_to_plane(contour)
        if new_plane is not None:
            fused_planes.append(new_plane)
            logger.info("Added image-only plane from contour (area=%.1f m2)", contour.area_m2)

    logger.info("Fusion result: %d planes total", len(fused_planes))
    return fused_planes


# ---------------------------------------------------------------------------
# IoU computation
# ---------------------------------------------------------------------------

def _compute_iou(
    poly_a: list[tuple[float, float]],
    poly_b: list[tuple[float, float]],
) -> float:
    """Compute intersection-over-union of two 2D polygons."""
    if HAS_SHAPELY:
        try:
            a = ShapelyPolygon(poly_a)
            b = ShapelyPolygon(poly_b)
            if not a.is_valid or not b.is_valid:
                return 0.0
            intersection = a.intersection(b).area
            union = a.union(b).area
            return float(intersection / union) if union > 0 else 0.0
        except Exception:
            return 0.0

    # Fallback: bounding-box IoU
    a_min_x = min(p[0] for p in poly_a)
    a_max_x = max(p[0] for p in poly_a)
    a_min_z = min(p[1] for p in poly_a)
    a_max_z = max(p[1] for p in poly_a)

    b_min_x = min(p[0] for p in poly_b)
    b_max_x = max(p[0] for p in poly_b)
    b_min_z = min(p[1] for p in poly_b)
    b_max_z = max(p[1] for p in poly_b)

    inter_x = max(0, min(a_max_x, b_max_x) - max(a_min_x, b_min_x))
    inter_z = max(0, min(a_max_z, b_max_z) - max(a_min_z, b_min_z))
    inter_area = inter_x * inter_z

    a_area = (a_max_x - a_min_x) * (a_max_z - a_min_z)
    b_area = (b_max_x - b_min_x) * (b_max_z - b_min_z)
    union_area = a_area + b_area - inter_area

    return float(inter_area / union_area) if union_area > 0 else 0.0


# ---------------------------------------------------------------------------
# Edge snapping
# ---------------------------------------------------------------------------

def _snap_to_edges(
    plane: RoofPlane,
    edges: list[DetectedEdge],
    max_dist: float,
) -> list[Point2D] | None:
    """
    Snap plane boundary vertices to nearby image edges for precision.
    Returns updated vertices or None if no snapping occurred.
    """
    if not edges:
        return None

    # Build array of edge segments
    edge_segments = np.array(
        [[[e.start[0], e.start[1]], [e.end[0], e.end[1]]] for e in edges],
        dtype=np.float64,
    )
    if len(edge_segments) == 0:
        return None

    snapped = []
    any_snapped = False

    for v in plane.vertices:
        pt = np.array([v.x, v.z])
        closest_pt, dist = _closest_point_on_segments(pt, edge_segments)

        if dist < max_dist:
            snapped.append(Point2D(x=float(closest_pt[0]), z=float(closest_pt[1])))
            any_snapped = True
        else:
            snapped.append(v)

    return snapped if any_snapped else None


def _closest_point_on_segments(
    pt: np.ndarray,
    segments: np.ndarray,
) -> tuple[np.ndarray, float]:
    """Find the closest point on any line segment to the given point."""
    A = segments[:, 0, :]  # Nx2
    B = segments[:, 1, :]  # Nx2
    AB = B - A
    AP = pt - A

    # Project pt onto each segment, clamp to [0,1]
    ab_sq = np.sum(AB ** 2, axis=1)
    ab_sq = np.maximum(ab_sq, 1e-10)
    t = np.sum(AP * AB, axis=1) / ab_sq
    t = np.clip(t, 0, 1)

    # Closest points on each segment
    closest = A + t[:, np.newaxis] * AB
    dists = np.linalg.norm(closest - pt, axis=1)

    best_idx = np.argmin(dists)
    return closest[best_idx], float(dists[best_idx])


# ---------------------------------------------------------------------------
# Contour to plane
# ---------------------------------------------------------------------------

def _contour_to_plane(contour: DetectedContour) -> RoofPlane | None:
    """Create a RoofPlane from an image contour (no height info)."""
    if len(contour.points) < 3:
        return None

    vertices = [Point2D(x=p[0], z=p[1]) for p in contour.points]
    vertices_3d = [Point3D(x=p[0], y=0.0, z=p[1]) for p in contour.points]

    return RoofPlane(
        id=f"img_plane_{uuid.uuid4().hex[:8]}",
        vertices=vertices,
        vertices_3d=vertices_3d,
        plane_equation=PlaneEquation(a=0, b=1, c=0, d=0),  # flat placeholder
        pitch_deg=0.0,
        azimuth_deg=0.0,
        height_m=0.0,
        elevation_m=0.0,
        area_m2=max(contour.area_m2, 0.01),
        is_flat=True,
        plane_type=PlaneType.main,
        confidence=round(contour.confidence * 0.6, 3),  # lower confidence for image-only
        needs_review=True,
    )
