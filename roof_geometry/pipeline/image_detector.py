"""
Image-based roof detection: SAM segmentation, edge detection, contour extraction,
line segment detection, feature detection, and colour/texture segmentation.

Primary detector: SAMDetector (image-primary pipeline using MobileSAM)
Fallback detector: OpenCVDetector (classical CV for LiDAR-primary path)
"""

from __future__ import annotations

import abc
import logging
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np

from models.schemas import Point2D, RegistrationTransform

logger = logging.getLogger(__name__)

try:
    import cv2
    HAS_CV2 = True
except ImportError:
    cv2 = None  # type: ignore[assignment]
    HAS_CV2 = False
    logger.warning("OpenCV not installed -- image detection unavailable")


# ---------------------------------------------------------------------------
# Detection result types
# ---------------------------------------------------------------------------

@dataclass
class DetectedEdge:
    """A straight line segment detected in the image."""
    start: tuple[float, float]  # (x, z) local metres
    end: tuple[float, float]
    confidence: float = 0.5
    length_m: float = 0.0


@dataclass
class DetectedContour:
    """A closed contour detected in the image."""
    points: list[tuple[float, float]]  # (x, z) local metres
    area_m2: float = 0.0
    confidence: float = 0.5


@dataclass
class MaterialRegion:
    """A region classified by colour/texture."""
    boundary: list[tuple[float, float]]  # (x, z) local metres
    material_label: str = "unknown"
    area_m2: float = 0.0
    confidence: float = 0.3


@dataclass
class RoofSegment:
    """A SAM-derived roof region with pixel-precise boundary."""
    id: str = ""
    boundary_px: list[tuple[int, int]] = field(default_factory=list)  # pixel coords
    boundary_local: list[tuple[float, float]] = field(default_factory=list)  # (x, z) local metres
    mask: Optional[np.ndarray] = None  # H x W boolean mask
    area_m2: float = 0.0
    area_px: float = 0.0
    confidence: float = 0.0
    iou_score: float = 0.0
    stability_score: float = 0.0

    def __post_init__(self):
        if not self.id:
            self.id = f"seg_{uuid.uuid4().hex[:8]}"


@dataclass
class InternalEdge:
    """A line segment within the roof that divides faces (ridge, valley, hip, rake)."""
    id: str = ""
    start: tuple[float, float] = (0.0, 0.0)  # (x, z) local metres
    end: tuple[float, float] = (0.0, 0.0)
    start_px: tuple[int, int] = (0, 0)  # pixel coords
    end_px: tuple[int, int] = (0, 0)
    edge_class: str = "unknown"  # ridge, valley, hip, rake
    length_m: float = 0.0
    confidence: float = 0.5
    segment_ids: list[str] = field(default_factory=list)  # IDs of the two segments this separates

    def __post_init__(self):
        if not self.id:
            self.id = f"iedge_{uuid.uuid4().hex[:8]}"


@dataclass
class DetectedFeature:
    """A detected roof feature (dormer, chimney, skylight, vent pipe, etc.)."""
    id: str = ""
    feature_type: str = "unknown"  # dormer, chimney, skylight, vent, pipe
    boundary_px: list[tuple[int, int]] = field(default_factory=list)
    boundary_local: list[tuple[float, float]] = field(default_factory=list)
    center_local: tuple[float, float] = (0.0, 0.0)
    area_m2: float = 0.0
    confidence: float = 0.5
    parent_segment_id: str = ""  # which roof segment this sits on

    def __post_init__(self):
        if not self.id:
            self.id = f"feat_{uuid.uuid4().hex[:8]}"


@dataclass
class ImageDetections:
    """All detections from image analysis."""
    edges: list[DetectedEdge] = field(default_factory=list)
    contours: list[DetectedContour] = field(default_factory=list)
    material_regions: list[MaterialRegion] = field(default_factory=list)
    roof_segments: list[RoofSegment] = field(default_factory=list)
    internal_edges: list[InternalEdge] = field(default_factory=list)
    features: list[DetectedFeature] = field(default_factory=list)
    source: str = "opencv"


# ---------------------------------------------------------------------------
# Abstract base class
# ---------------------------------------------------------------------------

class RoofImageDetector(abc.ABC):
    """Abstract interface for image-based roof detection."""

    @abc.abstractmethod
    def detect(
        self,
        image: np.ndarray,
        registration: RegistrationTransform,
    ) -> ImageDetections:
        ...

    @abc.abstractmethod
    def name(self) -> str:
        ...


# ---------------------------------------------------------------------------
# SAM Detector (image-primary pipeline)
# ---------------------------------------------------------------------------

class SAMDetector(RoofImageDetector):
    """
    Roof detection using MobileSAM for segmentation + OpenCV LSD for edges.

    This is the primary detector for the image-primary pipeline. It:
    1. Segments the roof outline with SAM (point-prompted or automatic)
    2. Detects internal edges (ridges, valleys, hips) with LSD
    3. Detects features (dormers, chimneys, skylights) with SAM auto-masks
    """

    def __init__(
        self,
        *,
        min_roof_area_m2: float = 10.0,
        min_edge_length_m: float = 1.0,
        clahe_clip_limit: float = 3.0,
        clahe_grid_size: int = 8,
        lsd_scale: float = 0.8,
        min_feature_area_m2: float = 0.1,
        max_feature_area_m2: float = 15.0,
    ):
        self.min_roof_area_m2 = min_roof_area_m2
        self.min_edge_length_m = min_edge_length_m
        self.clahe_clip_limit = clahe_clip_limit
        self.clahe_grid_size = clahe_grid_size
        self.lsd_scale = lsd_scale
        self.min_feature_area_m2 = min_feature_area_m2
        self.max_feature_area_m2 = max_feature_area_m2

    def name(self) -> str:
        return "sam"

    def detect(
        self,
        image: np.ndarray,
        registration: RegistrationTransform,
        *,
        point_prompts: list[tuple[int, int]] | None = None,
    ) -> ImageDetections:
        """
        Run SAM-based detection on a BGR image.

        Parameters
        ----------
        image : np.ndarray
            BGR image array (H, W, 3).
        registration : RegistrationTransform
            For pixel-to-local-metre conversion.
        point_prompts : list of (px_x, px_y), optional
            LiDAR-guided point prompts projected into pixel space.
            If None, uses SAM automatic mask generation.
        """
        if not HAS_CV2:
            logger.error("OpenCV required for SAM detector preprocessing")
            return ImageDetections()

        h, w = image.shape[:2]
        scale = registration.scale if registration.scale > 0 else 1.0

        # Convert BGR to RGB for SAM
        image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)

        # Stage A: Roof segmentation
        roof_segments = self._segment_roof(image_rgb, point_prompts, scale, w, h)
        logger.info(f"SAM segmentation: {len(roof_segments)} roof segments found")

        if not roof_segments:
            return ImageDetections(source="sam")

        # Build combined roof mask for edge detection
        combined_mask = np.zeros((h, w), dtype=np.uint8)
        for seg in roof_segments:
            if seg.mask is not None:
                combined_mask = np.bitwise_or(combined_mask, seg.mask.astype(np.uint8))

        # Stage B: Internal edge detection within the roof
        internal_edges = self._detect_internal_edges(image, combined_mask, scale, w, h)
        logger.info(f"Edge detection: {len(internal_edges)} internal edges found")

        # Stage C: Feature detection within the roof
        features = self._detect_features(image_rgb, roof_segments, scale, w, h)
        logger.info(f"Feature detection: {len(features)} features found")

        return ImageDetections(
            roof_segments=roof_segments,
            internal_edges=internal_edges,
            features=features,
            source="sam",
        )

    def _segment_roof(
        self,
        image_rgb: np.ndarray,
        point_prompts: list[tuple[int, int]] | None,
        scale: float,
        w: int,
        h: int,
    ) -> list[RoofSegment]:
        """
        Segment roof regions using SAM.

        If point_prompts provided (from LiDAR peaks), uses prompted prediction.
        Otherwise falls back to automatic mask generation.
        """
        from pipeline.model_manager import get_predictor, get_mask_generator

        segments = []

        if point_prompts and len(point_prompts) > 0:
            # Prompted segmentation: one prediction per point
            predictor = get_predictor()
            predictor.set_image(image_rgb)

            for px_x, px_y in point_prompts:
                # Clamp to image bounds
                px_x = max(0, min(px_x, w - 1))
                px_y = max(0, min(px_y, h - 1))

                masks, scores, _ = predictor.predict(
                    point_coords=np.array([[px_x, px_y]]),
                    point_labels=np.array([1]),  # 1 = foreground
                    multimask_output=True,
                )

                # Pick the best mask
                best_idx = int(np.argmax(scores))
                mask = masks[best_idx]
                score = float(scores[best_idx])

                seg = self._mask_to_segment(mask, score, scale, w, h)
                if seg and seg.area_m2 >= self.min_roof_area_m2:
                    segments.append(seg)

        else:
            # Automatic mask generation (no prompts available)
            generator = get_mask_generator()
            auto_masks = generator.generate(image_rgb)

            for am in auto_masks:
                mask = am["segmentation"]
                score = float(am["predicted_iou"])
                stability = float(am.get("stability_score", 0.0))

                seg = self._mask_to_segment(mask, score, scale, w, h)
                if seg:
                    seg.stability_score = stability
                    if seg.area_m2 >= self.min_roof_area_m2:
                        segments.append(seg)

        # Deduplicate overlapping segments (keep highest confidence)
        segments = self._deduplicate_segments(segments)

        return segments

    def _mask_to_segment(
        self,
        mask: np.ndarray,
        score: float,
        scale: float,
        w: int,
        h: int,
    ) -> Optional[RoofSegment]:
        """Convert a binary mask to a RoofSegment with boundary polygon."""
        mask_uint8 = (mask > 0).astype(np.uint8) * 255
        contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

        if not contours:
            return None

        # Keep largest contour
        largest = max(contours, key=cv2.contourArea)
        area_px = cv2.contourArea(largest)
        if area_px < 100:  # too tiny
            return None

        # Simplify contour slightly to reduce noise while keeping precision
        epsilon = 0.005 * cv2.arcLength(largest, True)
        approx = cv2.approxPolyDP(largest, epsilon, True)

        boundary_px = [(int(pt[0][0]), int(pt[0][1])) for pt in approx]
        boundary_local = [_px_to_local(px, py, w, h, scale) for px, py in boundary_px]
        area_m2 = area_px * (scale ** 2)

        return RoofSegment(
            boundary_px=boundary_px,
            boundary_local=boundary_local,
            mask=mask.astype(bool),
            area_m2=float(area_m2),
            area_px=float(area_px),
            confidence=float(score),
            iou_score=float(score),
        )

    def _deduplicate_segments(
        self,
        segments: list[RoofSegment],
        iou_threshold: float = 0.3,
    ) -> list[RoofSegment]:
        """Remove overlapping segments, keeping the one with highest confidence."""
        if len(segments) <= 1:
            return segments

        # Sort by confidence descending
        segments.sort(key=lambda s: s.confidence, reverse=True)
        keep = []

        for seg in segments:
            overlaps = False
            for kept in keep:
                if seg.mask is not None and kept.mask is not None:
                    intersection = np.logical_and(seg.mask, kept.mask).sum()
                    union = np.logical_or(seg.mask, kept.mask).sum()
                    if union > 0 and (intersection / union) > iou_threshold:
                        overlaps = True
                        break
            if not overlaps:
                keep.append(seg)

        return keep

    def _detect_internal_edges(
        self,
        image_bgr: np.ndarray,
        roof_mask: np.ndarray,
        scale: float,
        w: int,
        h: int,
    ) -> list[InternalEdge]:
        """
        Detect internal edges (ridges, valleys, hips) within the roof mask.

        Uses CLAHE enhancement + OpenCV Line Segment Detector (LSD).
        """
        gray = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY)

        # CLAHE to enhance shadow/colour contrast at plane intersections
        clahe = cv2.createCLAHE(
            clipLimit=self.clahe_clip_limit,
            tileGridSize=(self.clahe_grid_size, self.clahe_grid_size),
        )
        enhanced = clahe.apply(gray)

        # Mask to roof area only
        masked = cv2.bitwise_and(enhanced, enhanced, mask=roof_mask)

        # LSD (Line Segment Detector)
        lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD, scale=self.lsd_scale)
        lines, widths, _, scores = lsd.detect(masked)

        if lines is None:
            return []

        edges = []
        for i, line in enumerate(lines):
            x1, y1, x2, y2 = line[0]

            # Convert to local metres
            sx, sz = _px_to_local(x1, y1, w, h, scale)
            ex, ez = _px_to_local(x2, y2, w, h, scale)
            length_m = float(np.hypot(ex - sx, ez - sz))

            # Filter: must be within roof mask and minimum length
            mid_x, mid_y = int((x1 + x2) / 2), int((y1 + y2) / 2)
            if 0 <= mid_y < h and 0 <= mid_x < w:
                if roof_mask[mid_y, mid_x] == 0:
                    continue  # midpoint outside roof

            if length_m < self.min_edge_length_m:
                continue

            # Classify edge based on angle relative to horizontal
            angle_deg = float(np.degrees(np.arctan2(ez - sz, ex - sx))) % 180
            edge_class = _classify_edge_by_angle(angle_deg)

            conf = min(1.0, length_m / 5.0)
            if scores is not None:
                conf = min(1.0, conf * float(scores[i][0]) / 0.5)

            edges.append(InternalEdge(
                start=(sx, sz),
                end=(ex, ez),
                start_px=(int(x1), int(y1)),
                end_px=(int(x2), int(y2)),
                edge_class=edge_class,
                length_m=length_m,
                confidence=conf,
            ))

        # Merge collinear edges that are close together
        edges = self._merge_collinear_edges(edges)

        return edges

    def _merge_collinear_edges(
        self,
        edges: list[InternalEdge],
        angle_thresh_deg: float = 10.0,
        gap_thresh_m: float = 0.5,
    ) -> list[InternalEdge]:
        """Merge nearly-collinear edges that are close together."""
        if len(edges) <= 1:
            return edges

        merged = []
        used = set()

        for i, e1 in enumerate(edges):
            if i in used:
                continue

            # Collect collinear neighbors
            group = [e1]
            used.add(i)

            angle1 = np.degrees(np.arctan2(
                e1.end[1] - e1.start[1],
                e1.end[0] - e1.start[0],
            )) % 180

            for j, e2 in enumerate(edges):
                if j in used:
                    continue
                angle2 = np.degrees(np.arctan2(
                    e2.end[1] - e2.start[1],
                    e2.end[0] - e2.start[0],
                )) % 180

                angle_diff = abs(angle1 - angle2)
                if angle_diff > 90:
                    angle_diff = 180 - angle_diff

                if angle_diff > angle_thresh_deg:
                    continue

                # Check gap between endpoints
                min_gap = min(
                    np.hypot(e1.end[0] - e2.start[0], e1.end[1] - e2.start[1]),
                    np.hypot(e1.start[0] - e2.end[0], e1.start[1] - e2.end[1]),
                    np.hypot(e1.end[0] - e2.end[0], e1.end[1] - e2.end[1]),
                    np.hypot(e1.start[0] - e2.start[0], e1.start[1] - e2.start[1]),
                )
                if min_gap <= gap_thresh_m:
                    group.append(e2)
                    used.add(j)

            if len(group) == 1:
                merged.append(e1)
            else:
                # Merge group: find the two most distant endpoints
                all_pts = []
                for e in group:
                    all_pts.append(e.start)
                    all_pts.append(e.end)
                best_dist = 0
                best_pair = (all_pts[0], all_pts[1])
                for a in all_pts:
                    for b in all_pts:
                        d = np.hypot(a[0] - b[0], a[1] - b[1])
                        if d > best_dist:
                            best_dist = d
                            best_pair = (a, b)

                best_conf = max(e.confidence for e in group)
                merged.append(InternalEdge(
                    start=best_pair[0],
                    end=best_pair[1],
                    edge_class=group[0].edge_class,
                    length_m=float(best_dist),
                    confidence=best_conf,
                ))

        return merged

    def _detect_features(
        self,
        image_rgb: np.ndarray,
        roof_segments: list[RoofSegment],
        scale: float,
        w: int,
        h: int,
    ) -> list[DetectedFeature]:
        """
        Detect features (dormers, chimneys, skylights, vents) within roof segments.

        Uses SAM automatic mask generation constrained to each roof face,
        then classifies small masks by shape heuristics.
        """
        from pipeline.model_manager import get_mask_generator

        features = []
        generator = get_mask_generator(
            points_per_side=16,
            pred_iou_thresh=0.80,
            stability_score_thresh=0.85,
            min_mask_region_area=50,
        )

        # Generate all masks once
        all_masks = generator.generate(image_rgb)

        for am in all_masks:
            mask = am["segmentation"]
            score = float(am["predicted_iou"])
            area_px = float(mask.sum())
            area_m2 = area_px * (scale ** 2)

            # Must be within feature size range
            if area_m2 < self.min_feature_area_m2 or area_m2 > self.max_feature_area_m2:
                continue

            # Must be contained within a roof segment
            parent_id = ""
            for seg in roof_segments:
                if seg.mask is not None:
                    overlap = np.logical_and(mask, seg.mask).sum()
                    if overlap / max(area_px, 1) > 0.7:  # 70% contained
                        parent_id = seg.id
                        break

            if not parent_id:
                continue  # Not on a roof

            # Extract boundary
            mask_uint8 = mask.astype(np.uint8) * 255
            contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if not contours:
                continue

            largest = max(contours, key=cv2.contourArea)
            epsilon = 0.02 * cv2.arcLength(largest, True)
            approx = cv2.approxPolyDP(largest, epsilon, True)

            boundary_px = [(int(pt[0][0]), int(pt[0][1])) for pt in approx]
            boundary_local = [_px_to_local(px, py, w, h, scale) for px, py in boundary_px]

            # Compute center
            cx = np.mean([p[0] for p in boundary_local])
            cz = np.mean([p[1] for p in boundary_local])

            # Classify by shape
            feature_type = _classify_feature(approx, area_m2, boundary_local)

            features.append(DetectedFeature(
                feature_type=feature_type,
                boundary_px=boundary_px,
                boundary_local=boundary_local,
                center_local=(float(cx), float(cz)),
                area_m2=area_m2,
                confidence=score,
                parent_segment_id=parent_id,
            ))

        return features


# ---------------------------------------------------------------------------
# OpenCV implementation (fallback)
# ---------------------------------------------------------------------------

class OpenCVDetector(RoofImageDetector):
    """Roof detection using classical OpenCV methods."""

    def __init__(
        self,
        *,
        canny_low: int = 50,
        canny_high: int = 150,
        hough_threshold: int = 50,
        hough_min_line_length: int = 30,
        hough_max_line_gap: int = 10,
        min_contour_area_px: float = 500.0,
    ):
        self.canny_low = canny_low
        self.canny_high = canny_high
        self.hough_threshold = hough_threshold
        self.hough_min_line_length = hough_min_line_length
        self.hough_max_line_gap = hough_max_line_gap
        self.min_contour_area_px = min_contour_area_px

    def name(self) -> str:
        return "opencv"

    def detect(
        self,
        image: np.ndarray,
        registration: RegistrationTransform,
    ) -> ImageDetections:
        if not HAS_CV2:
            logger.error("OpenCV required for image detection")
            return ImageDetections()

        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        h, w = gray.shape[:2]

        scale = registration.scale if registration.scale > 0 else 1.0

        edges_img = cv2.Canny(gray, self.canny_low, self.canny_high)
        detected_edges = self._detect_lines(edges_img, scale, w, h)
        detected_contours = self._detect_contours(edges_img, scale, w, h)
        material_regions = self._segment_materials(image, scale, w, h)

        return ImageDetections(
            edges=detected_edges,
            contours=detected_contours,
            material_regions=material_regions,
            source="opencv",
        )

    def _detect_lines(
        self,
        edges_img: np.ndarray,
        scale: float,
        w: int,
        h: int,
    ) -> list[DetectedEdge]:
        lines = cv2.HoughLinesP(
            edges_img,
            rho=1,
            theta=np.pi / 180,
            threshold=self.hough_threshold,
            minLineLength=self.hough_min_line_length,
            maxLineGap=self.hough_max_line_gap,
        )
        if lines is None:
            return []

        result = []
        for line in lines:
            x1, y1, x2, y2 = line[0]
            sx, sz = _px_to_local(x1, y1, w, h, scale)
            ex, ez = _px_to_local(x2, y2, w, h, scale)
            length = float(np.hypot(ex - sx, ez - sz))
            result.append(DetectedEdge(
                start=(sx, sz),
                end=(ex, ez),
                confidence=min(1.0, length / 5.0),
                length_m=length,
            ))
        return result

    def _detect_contours(
        self,
        edges_img: np.ndarray,
        scale: float,
        w: int,
        h: int,
    ) -> list[DetectedContour]:
        contours, _ = cv2.findContours(
            edges_img, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE,
        )
        result = []
        for cnt in contours:
            area_px = cv2.contourArea(cnt)
            if area_px < self.min_contour_area_px:
                continue

            epsilon = 0.02 * cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, epsilon, True)

            pts = []
            for pt in approx:
                px, py = pt[0]
                lx, lz = _px_to_local(px, py, w, h, scale)
                pts.append((lx, lz))

            area_m2 = area_px * (scale ** 2)
            result.append(DetectedContour(
                points=pts,
                area_m2=float(area_m2),
                confidence=min(1.0, area_m2 / 20.0),
            ))
        return result

    def _segment_materials(
        self,
        image: np.ndarray,
        scale: float,
        w: int,
        h: int,
    ) -> list[MaterialRegion]:
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        pixels = hsv.reshape(-1, 3).astype(np.float32)

        k = 4
        criteria = (cv2.TERM_CRITERIA_EPS + cv2.TERM_CRITERIA_MAX_ITER, 20, 1.0)
        _, labels, centers = cv2.kmeans(
            pixels, k, None, criteria, 5, cv2.KMEANS_PP_CENTERS,
        )

        labels_2d = labels.reshape(hsv.shape[:2])
        regions = []
        for ci in range(k):
            mask = (labels_2d == ci).astype(np.uint8) * 255
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

            if not contours:
                continue
            largest = max(contours, key=cv2.contourArea)
            area_px = cv2.contourArea(largest)
            if area_px < self.min_contour_area_px * 2:
                continue

            epsilon = 0.02 * cv2.arcLength(largest, True)
            approx = cv2.approxPolyDP(largest, epsilon, True)
            boundary = [
                _px_to_local(pt[0][0], pt[0][1], w, h, scale)
                for pt in approx
            ]

            hue = centers[ci][0]
            label = _hue_to_material(float(hue))

            regions.append(MaterialRegion(
                boundary=boundary,
                material_label=label,
                area_m2=float(area_px * scale ** 2),
                confidence=0.4,
            ))

        return regions


# ---------------------------------------------------------------------------
# Top-level convenience function
# ---------------------------------------------------------------------------

def detect_from_image(
    image_input,
    registration: RegistrationTransform,
    *,
    detector: RoofImageDetector | None = None,
    point_prompts: list[tuple[int, int]] | None = None,
    use_sam: bool = True,
) -> ImageDetections:
    """
    Run image-based detection.

    Parameters
    ----------
    image_input : ImageInput or str
        ImageInput model with url/file_path, or a direct file path string.
    registration : RegistrationTransform
        Transform for pixel-to-local-metre conversion.
    detector : RoofImageDetector, optional
        Detector implementation to use. Defaults to SAMDetector if use_sam=True.
    point_prompts : list of (px_x, px_y), optional
        LiDAR-guided point prompts in pixel coordinates for SAM.
    use_sam : bool
        If True (default), use SAMDetector. If False, use OpenCVDetector.
    """
    if not HAS_CV2:
        logger.warning("OpenCV not available -- skipping image detection")
        return ImageDetections()

    # Resolve image to a file path and load it
    image_path = None
    if isinstance(image_input, str):
        image_path = image_input
    elif hasattr(image_input, 'file_path') and image_input.file_path:
        image_path = image_input.file_path
    elif hasattr(image_input, 'url') and image_input.url:
        # Try to download the image from URL
        image_arr = _fetch_image_from_url(image_input.url)
        if image_arr is not None:
            return _run_detection(image_arr, registration, detector, point_prompts, use_sam)
        logger.info("Could not fetch image from URL -- skipping image detection")
        return ImageDetections()
    else:
        logger.info("No image source available -- skipping image detection")
        return ImageDetections()

    path = Path(image_path)
    if not path.exists():
        logger.warning("Image file not found: %s -- skipping image detection", image_path)
        return ImageDetections()

    image = cv2.imread(str(path))
    if image is None:
        logger.error("Failed to read image: %s", image_path)
        return ImageDetections()

    return _run_detection(image, registration, detector, point_prompts, use_sam)


def _run_detection(
    image: np.ndarray,
    registration: RegistrationTransform,
    detector: RoofImageDetector | None,
    point_prompts: list[tuple[int, int]] | None,
    use_sam: bool,
) -> ImageDetections:
    """Run the actual detection on a loaded image array."""
    if detector is not None:
        if isinstance(detector, SAMDetector) and point_prompts is not None:
            return detector.detect(image, registration, point_prompts=point_prompts)
        return detector.detect(image, registration)

    if use_sam:
        try:
            sam_det = SAMDetector()
            return sam_det.detect(image, registration, point_prompts=point_prompts)
        except Exception as e:
            logger.warning(f"SAM detection failed, falling back to OpenCV: {e}")

    return OpenCVDetector().detect(image, registration)


def _fetch_image_from_url(url: str) -> Optional[np.ndarray]:
    """Download an image from URL and return as BGR numpy array."""
    try:
        import urllib.request
        import tempfile

        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
            urllib.request.urlretrieve(url, tmp.name)
            image = cv2.imread(tmp.name)
            Path(tmp.name).unlink(missing_ok=True)
            return image
    except Exception as e:
        logger.warning(f"Failed to fetch image from URL: {e}")
        return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _px_to_local(
    px: float,
    py: float,
    img_w: int,
    img_h: int,
    scale: float,
) -> tuple[float, float]:
    """Convert pixel coordinates to local metres (centred on image)."""
    x = (px - img_w / 2) * scale
    z = (py - img_h / 2) * scale
    return (float(x), float(z))


def _hue_to_material(hue: float) -> str:
    """Map an HSV hue value (0-180 in OpenCV) to a rough material label."""
    if hue < 15 or hue > 165:
        return "dark_shingle"
    elif hue < 30:
        return "brown_shingle"
    elif hue < 75:
        return "green_material"
    elif hue < 135:
        return "blue_material"
    else:
        return "grey_material"


def _classify_edge_by_angle(angle_deg: float) -> str:
    """
    Rough edge classification based on angle.
    This is a heuristic — real classification needs LiDAR elevation data.
    Angles near 0/180 are likely ridges/eaves, diagonal are likely hips/valleys.
    """
    # Normalize to 0-90 range
    a = angle_deg % 180
    if a > 90:
        a = 180 - a

    if a < 15 or a > 165:
        return "ridge"  # Near-horizontal lines
    elif 30 < a < 60:
        return "hip"  # Diagonal lines
    else:
        return "unknown"


def _classify_feature(
    contour: np.ndarray,
    area_m2: float,
    boundary_local: list[tuple[float, float]],
) -> str:
    """
    Classify a detected feature by shape heuristics.

    - Rectangular + flat → skylight
    - Small square near edge → chimney
    - Tiny circle → vent/pipe
    - Triangular protrusion → dormer
    """
    n_vertices = len(contour)

    # Compute bounding rect and aspect ratio
    x, y, bw, bh = cv2.boundingRect(contour)
    aspect = max(bw, bh) / max(min(bw, bh), 1)
    rectangularity = area_m2 / max((bw * bh * 0.01), 0.001)  # rough

    # Very small = pipe/vent
    if area_m2 < 0.3:
        return "pipe"

    if area_m2 < 1.0:
        if aspect < 2.0:
            return "vent"
        return "pipe"

    # Rectangular shapes
    if n_vertices == 4 or (n_vertices <= 6 and aspect < 2.5):
        if area_m2 < 4.0:
            if aspect < 1.5:
                return "chimney"
            else:
                return "skylight"
        return "skylight"

    # Triangular = dormer
    if n_vertices == 3 or (n_vertices <= 5 and area_m2 > 2.0):
        return "dormer"

    return "unknown"
