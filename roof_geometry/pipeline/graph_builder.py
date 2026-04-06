"""
Graph builder: construct roof topology from detected planes.

Builds adjacency, classifies edges (ridge/valley/hip/eave/rake),
detects intersections, dormers, obstructions, and connected components.
"""

from __future__ import annotations

import logging
import math
import uuid
from collections import defaultdict

import numpy as np

from models.schemas import (
    Dormer,
    DormerType,
    EdgeType,
    IntersectionType,
    Obstruction,
    ObstructionType,
    PlaneType,
    Point2D,
    Point3D,
    RoofEdge,
    RoofGraph,
    RoofIntersection,
    RoofPlane,
)

logger = logging.getLogger(__name__)

try:
    from shapely.geometry import LineString, Polygon as ShapelyPolygon
    HAS_SHAPELY = True
except ImportError:
    HAS_SHAPELY = False


def build_roof_graph(
    planes: list[RoofPlane],
    *,
    adjacency_distance_m: float = 1.0,
    min_shared_length_m: float = 0.5,
) -> RoofGraph:
    """
    Build a complete roof graph from detected planes.

    Parameters
    ----------
    planes : list[RoofPlane]
        Detected roof planes from fusion.
    adjacency_distance_m : float
        Maximum distance between plane boundaries to consider them adjacent.
    min_shared_length_m : float
        Minimum length of shared boundary to create an edge.

    Returns
    -------
    RoofGraph
        Complete roof topology.
    """
    if not planes:
        return RoofGraph()

    # 1. Build adjacency map
    adjacency, shared_edges_info = _build_adjacency(
        planes, adjacency_distance_m, min_shared_length_m,
    )

    # 2. Classify edges between adjacent planes
    edges = _classify_edges(planes, shared_edges_info)

    # 3. Find intersections (where edges meet)
    intersections = _find_intersections(edges)

    # 4. Find connected components
    components = _find_components(planes, adjacency)

    # 5. Detect dormers
    dormers = _detect_dormers(planes, adjacency)

    # 6. Detect obstructions (small isolated clusters)
    obstructions = _detect_obstructions(planes, components)

    graph = RoofGraph(
        planes=planes,
        edges=edges,
        intersections=intersections,
        dormers=dormers,
        obstructions=obstructions,
        adjacency=adjacency,
        connected_components=components,
    )

    logger.info(
        "Built roof graph: %d planes, %d edges, %d intersections, "
        "%d dormers, %d obstructions, %d components",
        len(planes), len(edges), len(intersections),
        len(dormers), len(obstructions), len(components),
    )
    return graph


# ---------------------------------------------------------------------------
# Adjacency
# ---------------------------------------------------------------------------

def _build_adjacency(
    planes: list[RoofPlane],
    dist_thresh: float,
    min_shared_len: float,
) -> tuple[dict[str, list[str]], list[dict]]:
    """
    Determine which planes are adjacent by checking boundary proximity.

    Returns adjacency dict and a list of shared-edge metadata dicts.
    """
    adjacency: dict[str, list[str]] = {p.id: [] for p in planes}
    shared_edges: list[dict] = []

    for i in range(len(planes)):
        for j in range(i + 1, len(planes)):
            p1, p2 = planes[i], planes[j]
            result = _find_shared_boundary(p1, p2, dist_thresh, min_shared_len)
            if result is not None:
                adjacency[p1.id].append(p2.id)
                adjacency[p2.id].append(p1.id)
                shared_edges.append({
                    "plane_a": p1,
                    "plane_b": p2,
                    "start": result[0],
                    "end": result[1],
                    "length": result[2],
                })

    return adjacency, shared_edges


def _find_shared_boundary(
    p1: RoofPlane,
    p2: RoofPlane,
    dist_thresh: float,
    min_len: float,
) -> tuple[np.ndarray, np.ndarray, float] | None:
    """
    Find the shared boundary between two planes.
    Returns (start_point_3d, end_point_3d, length) or None.
    """
    verts1 = np.array([[v.x, v.z] for v in p1.vertices])
    verts2 = np.array([[v.x, v.z] for v in p2.vertices])

    if HAS_SHAPELY and len(verts1) >= 3 and len(verts2) >= 3:
        try:
            poly1 = ShapelyPolygon(verts1).buffer(dist_thresh / 2)
            poly2 = ShapelyPolygon(verts2).buffer(dist_thresh / 2)
            intersection = poly1.intersection(poly2)

            if intersection.is_empty:
                return None

            # Extract the longest line from the intersection
            if hasattr(intersection, "exterior"):
                coords = np.array(intersection.exterior.coords)
            elif hasattr(intersection, "coords"):
                coords = np.array(intersection.coords)
            else:
                return None

            if len(coords) < 2:
                return None

            # Use the two furthest points as the shared edge endpoints
            dists = np.linalg.norm(coords[:, np.newaxis] - coords[np.newaxis, :], axis=2)
            i_max, j_max = np.unravel_index(dists.argmax(), dists.shape)
            length = float(dists[i_max, j_max])

            if length < min_len:
                return None

            # Get heights from plane equations
            start_2d = coords[i_max]
            end_2d = coords[j_max]
            start_3d = _point_on_plane_3d(start_2d, p1)
            end_3d = _point_on_plane_3d(end_2d, p1)

            return (start_3d, end_3d, length)
        except Exception:
            pass

    # Fallback: find closest vertex pairs
    close_pairs = []
    for v1 in verts1:
        for v2 in verts2:
            d = np.linalg.norm(v1 - v2)
            if d < dist_thresh:
                close_pairs.append((v1, v2, d))

    if len(close_pairs) < 2:
        return None

    # Use the two most distant close pairs as edge endpoints
    best_len = 0.0
    best_start = best_end = None
    for a_idx in range(len(close_pairs)):
        for b_idx in range(a_idx + 1, len(close_pairs)):
            midA = (close_pairs[a_idx][0] + close_pairs[a_idx][1]) / 2
            midB = (close_pairs[b_idx][0] + close_pairs[b_idx][1]) / 2
            l = float(np.linalg.norm(midA - midB))
            if l > best_len:
                best_len = l
                best_start = midA
                best_end = midB

    if best_len < min_len or best_start is None:
        return None

    start_3d = _point_on_plane_3d(best_start, p1)
    end_3d = _point_on_plane_3d(best_end, p1)
    return (start_3d, end_3d, best_len)


def _point_on_plane_3d(xz: np.ndarray, plane: RoofPlane) -> np.ndarray:
    """Project a 2D (x,z) point onto a plane to get the y coordinate."""
    a = plane.plane_equation.a
    b = plane.plane_equation.b
    c = plane.plane_equation.c
    d = plane.plane_equation.d
    x, z = float(xz[0]), float(xz[1])
    if abs(b) > 1e-10:
        y = -(a * x + c * z + d) / b
    else:
        y = plane.height_m
    return np.array([x, y, z])


# ---------------------------------------------------------------------------
# Edge classification
# ---------------------------------------------------------------------------

def _classify_edges(
    planes: list[RoofPlane],
    shared_edges: list[dict],
) -> list[RoofEdge]:
    """Classify each shared boundary as ridge, valley, hip, eave, or rake."""
    plane_map = {p.id: p for p in planes}
    edges: list[RoofEdge] = []

    for info in shared_edges:
        pa: RoofPlane = info["plane_a"]
        pb: RoofPlane = info["plane_b"]
        start_3d: np.ndarray = info["start"]
        end_3d: np.ndarray = info["end"]
        length: float = info["length"]

        edge_type = _classify_single_edge(pa, pb, start_3d, end_3d)

        edges.append(RoofEdge(
            id=f"edge_{uuid.uuid4().hex[:8]}",
            edge_type=edge_type,
            start_point=Point3D(x=float(start_3d[0]), y=float(start_3d[1]), z=float(start_3d[2])),
            end_point=Point3D(x=float(end_3d[0]), y=float(end_3d[1]), z=float(end_3d[2])),
            plane_ids=[pa.id, pb.id],
            length_m=round(length, 3),
            confidence=round(min(pa.confidence, pb.confidence), 3),
            needs_review=pa.needs_review or pb.needs_review,
        ))

    # Add eave/rake edges for boundary edges (single-plane edges)
    for plane in planes:
        boundary_edges = _find_boundary_edges(plane, shared_edges)
        edges.extend(boundary_edges)

    return edges


def _classify_single_edge(
    pa: RoofPlane,
    pb: RoofPlane,
    start: np.ndarray,
    end: np.ndarray,
) -> EdgeType:
    """
    Classify the edge between two planes based on their geometry.

    - Ridge: two planes meeting at top (edge is highest line)
    - Valley: two planes meeting at bottom (edge is lowest line)
    - Hip: diagonal ridge connecting ridge to eave
    """
    na = np.array([pa.plane_equation.a, pa.plane_equation.b, pa.plane_equation.c])
    nb = np.array([pb.plane_equation.a, pb.plane_equation.b, pb.plane_equation.c])

    # Ensure normals point up
    if na[1] < 0:
        na = -na
    if nb[1] < 0:
        nb = -nb

    # ---- Normal angle gate: reject nearly co-planar pairs ----
    na_len = np.linalg.norm(na)
    nb_len = np.linalg.norm(nb)
    if na_len > 1e-8 and nb_len > 1e-8:
        cos_normals = np.clip(np.dot(na / na_len, nb / nb_len), -1, 1)
        normal_angle_deg = math.degrees(math.acos(abs(cos_normals)))
    else:
        normal_angle_deg = 0.0
    if normal_angle_deg < 10.0:
        return EdgeType.step_flash  # nearly co-planar — not a meaningful ridge/valley

    # Average height along the shared edge
    edge_avg_y = (start[1] + end[1]) / 2.0

    # Compare edge height to plane centroids
    a_centroid_y = (pa.height_m + pa.elevation_m) / 2.0
    b_centroid_y = (pb.height_m + pb.elevation_m) / 2.0
    avg_centroid_y = (a_centroid_y + b_centroid_y) / 2.0

    # Angle between plane normals projected to XZ
    a_xz = np.array([na[0], na[2]])
    b_xz = np.array([nb[0], nb[2]])
    a_norm = np.linalg.norm(a_xz)
    b_norm = np.linalg.norm(b_xz)

    if a_norm > 1e-6 and b_norm > 1e-6:
        cos_angle = np.dot(a_xz / a_norm, b_xz / b_norm)
        facing_angle = math.degrees(math.acos(np.clip(abs(cos_angle), 0, 1)))
    else:
        facing_angle = 0

    # ---- Convexity check: both planes must slope away from the edge ----
    edge_mid_xz = np.array([(start[0] + end[0]) / 2, (start[2] + end[2]) / 2])
    a_centroid_xz = np.mean([[v.x, v.z] for v in pa.vertices], axis=0)
    b_centroid_xz = np.mean([[v.x, v.z] for v in pb.vertices], axis=0)
    to_a = a_centroid_xz - edge_mid_xz
    to_b = b_centroid_xz - edge_mid_xz
    # For convex (ridge): XZ normal points toward the centroid (downslope side)
    convex_a = np.dot(to_a, a_xz) > 0 if a_norm > 1e-6 else True
    convex_b = np.dot(to_b, b_xz) > 0 if b_norm > 1e-6 else True
    is_convex = convex_a and convex_b

    # Flat roof guard: the low end of a flat roof cannot be a ridge.
    # If either plane is flat and the edge is at its lower end, demote to step_flash.
    if pa.is_flat and edge_avg_y < pa.elevation_m + 0.3:
        return EdgeType.step_flash
    if pb.is_flat and edge_avg_y < pb.elevation_m + 0.3:
        return EdgeType.step_flash

    if is_convex and edge_avg_y > avg_centroid_y + 0.3:
        # Convex edge above both plane centres → ridge or hip
        if facing_angle > 45:
            return EdgeType.hip
        return EdgeType.ridge
    elif (not is_convex) and edge_avg_y < avg_centroid_y - 0.3:
        return EdgeType.valley
    elif is_convex:
        # Convex but not clearly above — check diagonal
        if facing_angle > 30:
            return EdgeType.hip
        return EdgeType.ridge
    else:
        # Not convex — default to valley for concave, step_flash for ambiguous
        if edge_avg_y < avg_centroid_y - 0.1:
            return EdgeType.valley
        return EdgeType.step_flash


def _find_boundary_edges(
    plane: RoofPlane,
    shared_edges: list[dict],
) -> list[RoofEdge]:
    """
    Find edges of a plane that are NOT shared with another plane.
    Classify as eave (bottom) or rake (side).
    """
    verts = plane.vertices
    n = len(verts)
    edges: list[RoofEdge] = []

    for i in range(n):
        j = (i + 1) % n
        v1 = verts[i]
        v2 = verts[j]

        # Check if this edge segment is near any shared edge
        mid = np.array([(v1.x + v2.x) / 2, (v1.z + v2.z) / 2])
        is_shared = False
        for se in shared_edges:
            if se["plane_a"].id == plane.id or se["plane_b"].id == plane.id:
                se_mid = (se["start"][[0, 2]] + se["end"][[0, 2]]) / 2
                if np.linalg.norm(mid - se_mid) < 1.5:
                    is_shared = True
                    break

        if is_shared:
            continue

        # Get 3D points
        v1_3d = _point_on_plane_3d(np.array([v1.x, v1.z]), plane)
        v2_3d = _point_on_plane_3d(np.array([v2.x, v2.z]), plane)
        length = float(np.linalg.norm(v2_3d - v1_3d))

        if length < 0.2:
            continue

        # Classify: eave (lowest edges) vs rake (side edges)
        avg_y = (v1_3d[1] + v2_3d[1]) / 2.0
        edge_type = EdgeType.eave if avg_y < plane.elevation_m + 0.5 else EdgeType.rake

        edges.append(RoofEdge(
            id=f"edge_{uuid.uuid4().hex[:8]}",
            edge_type=edge_type,
            start_point=Point3D(x=float(v1_3d[0]), y=float(v1_3d[1]), z=float(v1_3d[2])),
            end_point=Point3D(x=float(v2_3d[0]), y=float(v2_3d[1]), z=float(v2_3d[2])),
            plane_ids=[plane.id],
            length_m=round(length, 3),
            confidence=round(plane.confidence * 0.9, 3),
            needs_review=False,
        ))

    return edges


# ---------------------------------------------------------------------------
# Intersections
# ---------------------------------------------------------------------------

def _find_intersections(edges: list[RoofEdge]) -> list[RoofIntersection]:
    """Find points where multiple edges share a vertex."""
    # Group edge endpoints by proximity
    endpoint_map: dict[str, list[tuple[Point3D, str]]] = defaultdict(list)

    for edge in edges:
        for pt in [edge.start_point, edge.end_point]:
            # Quantize to grid for grouping
            key = f"{round(pt.x, 1)}_{round(pt.y, 1)}_{round(pt.z, 1)}"
            endpoint_map[key].append((pt, edge.id))

    intersections = []
    for key, entries in endpoint_map.items():
        if len(entries) < 2:
            continue

        # Average position
        xs = [e[0].x for e in entries]
        ys = [e[0].y for e in entries]
        zs = [e[0].z for e in entries]
        avg_pt = Point3D(
            x=round(sum(xs) / len(xs), 3),
            y=round(sum(ys) / len(ys), 3),
            z=round(sum(zs) / len(zs), 3),
        )

        edge_ids = list({e[1] for e in entries})

        # Classify
        if len(edge_ids) >= 3:
            itype = IntersectionType.peak
        elif avg_pt.y > 2.0:
            itype = IntersectionType.peak
        else:
            itype = IntersectionType.corner

        intersections.append(RoofIntersection(
            id=f"int_{uuid.uuid4().hex[:8]}",
            point=avg_pt,
            edge_ids=edge_ids,
            intersection_type=itype,
        ))

    return intersections


# ---------------------------------------------------------------------------
# Connected components
# ---------------------------------------------------------------------------

def _find_components(
    planes: list[RoofPlane],
    adjacency: dict[str, list[str]],
) -> list[list[str]]:
    """Find connected components using BFS."""
    visited: set[str] = set()
    components: list[list[str]] = []

    for plane in planes:
        if plane.id in visited:
            continue

        component: list[str] = []
        queue = [plane.id]
        while queue:
            pid = queue.pop(0)
            if pid in visited:
                continue
            visited.add(pid)
            component.append(pid)
            for neighbor in adjacency.get(pid, []):
                if neighbor not in visited:
                    queue.append(neighbor)

        components.append(component)

    return components


# ---------------------------------------------------------------------------
# Dormer detection
# ---------------------------------------------------------------------------

def _detect_dormers(
    planes: list[RoofPlane],
    adjacency: dict[str, list[str]],
) -> list[Dormer]:
    """
    Detect dormers: small elevated planes sitting on larger planes.
    """
    plane_map = {p.id: p for p in planes}
    dormers: list[Dormer] = []

    for plane in planes:
        if plane.area_m2 > 10.0:
            continue  # too large for a dormer
        if plane.elevation_m < 1.0:
            continue  # too low

        # Check if adjacent to a larger plane
        neighbors = adjacency.get(plane.id, [])
        parent = None
        for nid in neighbors:
            n = plane_map.get(nid)
            if n and n.area_m2 > plane.area_m2 * 2:
                parent = n
                break

        if parent is None:
            continue

        # Estimate dormer dimensions from bounding box
        xs = [v.x for v in plane.vertices]
        zs = [v.z for v in plane.vertices]
        width = max(xs) - min(xs)
        depth = max(zs) - min(zs)
        height = plane.height_m - plane.elevation_m

        if width < 0.3 or depth < 0.3:
            continue

        # Classify dormer type by pitch and shape
        if plane.pitch_deg > 20:
            dtype = DormerType.gable
        elif plane.pitch_deg > 5:
            dtype = DormerType.hip
        else:
            dtype = DormerType.shed

        cx = sum(xs) / len(xs)
        cz = sum(zs) / len(zs)

        # Build the 5-point triangular footprint.
        # The dormer faces outward in its azimuth direction (downslope).
        # From birds-eye view the shape is a pentagon:
        #
        #         peak          ← highest point, centre-back (up-slope)
        #        /    \
        #   back-L    back-R    ← where each side wall meets the main roof
        #     |          |
        #   front-L  front-R   ← parent-plane eave edge (may hang past it)
        #
        # Ordered: front-left, front-right, back-right, peak, back-left
        az_rad = math.radians(plane.azimuth_deg)
        # Unit vector pointing in the facing (downslope) direction
        face_x = math.sin(az_rad)
        face_z = math.cos(az_rad)
        # Unit vector pointing left (90° counter-clockwise from facing)
        lat_x = -face_z
        lat_z = face_x

        hw = width / 2.0   # half-width

        # Project each parent-plane vertex onto the facing axis and take the
        # maximum — this is the eave line (furthest downslope boundary).
        center_proj = cx * face_x + cz * face_z
        parent_projs = [v.x * face_x + v.z * face_z for v in parent.vertices]
        eave_proj = max(parent_projs)

        # Distance from dormer centre to the eave (downslope).
        # Positive means the eave is further downslope than the centre.
        front_d = eave_proj - center_proj

        # Distance from dormer centre to the ridge contact (up-slope).
        # Use the projected depth of the dormer plane itself.
        dormer_projs = [v.x * face_x + v.z * face_z for v in plane.vertices]
        ridge_proj = min(dormer_projs)  # furthest up-slope vertex
        back_d = center_proj - ridge_proj  # should be positive

        # Guard against degenerate cases
        if front_d <= 0:
            front_d = depth / 2.0
        if back_d <= 0:
            back_d = depth / 2.0

        # Elevation rises as we move up-slope (opposite to facing direction).
        pitch_tan = math.tan(math.radians(plane.pitch_deg))

        def _pt(dx: float, dz: float) -> Point3D:
            """Return a Point3D offset from dormer centre, with slope elevation."""
            px = cx + lat_x * dx + face_x * dz
            pz = cz + lat_z * dx + face_z * dz
            # dz > 0 → downslope (lower); dz < 0 → upslope (higher)
            elev = plane.elevation_m + max(0.0, -dz) * pitch_tan
            return Point3D(x=round(px, 3), y=round(elev, 3), z=round(pz, 3))

        footprint = [
            _pt(+hw, +front_d),   # front-left   (at parent eave, lowest)
            _pt(-hw, +front_d),   # front-right
            _pt(-hw, -back_d),    # back-right
            _pt(0.0, -back_d),    # peak         (ridge contact, highest)
            _pt(+hw, -back_d),    # back-left
        ]

        # Recompute actual dimensions from the adjusted contact points
        actual_depth = front_d + back_d

        dormers.append(Dormer(
            id=f"dormer_{uuid.uuid4().hex[:8]}",
            dormer_type=dtype,
            position=Point2D(x=round(cx, 3), z=round(cz, 3)),
            width_m=round(width, 2),
            depth_m=round(actual_depth, 2),
            height_m=round(max(height, 0.1), 2),
            pitch_deg=round(plane.pitch_deg, 2),
            azimuth_deg=round(plane.azimuth_deg, 2),
            parent_plane_id=parent.id,
            confidence=round(plane.confidence, 3),
            needs_review=plane.confidence < 0.6,
            footprint=footprint,
        ))

    logger.info("Detected %d dormers", len(dormers))
    return dormers


# ---------------------------------------------------------------------------
# Obstruction detection
# ---------------------------------------------------------------------------

def _detect_obstructions(
    planes: list[RoofPlane],
    components: list[list[str]],
) -> list[Obstruction]:
    """
    Detect obstructions: very small isolated clusters.
    """
    plane_map = {p.id: p for p in planes}
    obstructions: list[Obstruction] = []

    for component in components:
        if len(component) != 1:
            continue

        plane = plane_map.get(component[0])
        if plane is None:
            continue

        if plane.area_m2 > 4.0:
            continue  # too large for an obstruction

        # Classify by size and shape
        xs = [v.x for v in plane.vertices]
        zs = [v.z for v in plane.vertices]
        width = max(xs) - min(xs)
        depth = max(zs) - min(zs)
        aspect = max(width, depth) / max(min(width, depth), 0.01)

        if plane.area_m2 < 0.3:
            otype = ObstructionType.pipe
        elif plane.area_m2 < 1.0 and aspect < 2:
            otype = ObstructionType.vent
        elif aspect < 2:
            otype = ObstructionType.chimney
        elif plane.is_flat and plane.area_m2 > 1.0:
            otype = ObstructionType.skylight
        else:
            otype = ObstructionType.unknown

        cx = sum(xs) / len(xs)
        cz = sum(zs) / len(zs)

        obstructions.append(Obstruction(
            id=f"obs_{uuid.uuid4().hex[:8]}",
            obstruction_type=otype,
            position=Point2D(x=round(cx, 3), z=round(cz, 3)),
            footprint=[Point2D(x=v.x, z=v.z) for v in plane.vertices],
            height_m=round(plane.height_m - plane.elevation_m, 2),
            confidence=round(plane.confidence * 0.7, 3),
            needs_review=True,
        ))

    logger.info("Detected %d obstructions", len(obstructions))
    return obstructions
