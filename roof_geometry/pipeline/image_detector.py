"""
Image-based roof detection: edge detection, contour extraction,
line segment detection, and colour/texture segmentation.

Provides an abstract base class for ML-based detectors (SAM/GroundingDINO)
with a concrete OpenCV implementation.
"""

from __future__ import annotations

import abc
import logging
import uuid
from dataclasses import dataclass, field
from pathlib import Path

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
class ImageDetections:
    """All detections from image analysis."""
    edges: list[DetectedEdge] = field(default_factory=list)
    contours: list[DetectedContour] = field(default_factory=list)
    material_regions: list[MaterialRegion] = field(default_factory=list)
    source: str = "opencv"


# ---------------------------------------------------------------------------
# Abstract base class for ML-based detectors
# ---------------------------------------------------------------------------

class RoofImageDetector(abc.ABC):
    """
    Abstract interface for image-based roof detection.

    Subclass this to plug in SAM, GroundingDINO, or other ML models.
    """

    @abc.abstractmethod
    def detect(
        self,
        image: np.ndarray,
        registration: RegistrationTransform,
    ) -> ImageDetections:
        """Run detection on a BGR image array. Return detections in local metres."""
        ...

    @abc.abstractmethod
    def name(self) -> str:
        """Human-readable name of this detector."""
        ...


# ---------------------------------------------------------------------------
# OpenCV implementation
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

        # Pixels-to-metres conversion from registration scale
        scale = registration.scale if registration.scale > 0 else 1.0

        # 1. Edge detection
        edges_img = cv2.Canny(gray, self.canny_low, self.canny_high)

        # 2. Line segment detection (HoughLinesP)
        detected_edges = self._detect_lines(edges_img, scale, w, h)

        # 3. Contour extraction
        detected_contours = self._detect_contours(edges_img, scale, w, h)

        # 4. Colour segmentation for material regions
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
        """Detect straight line segments using Hough transform."""
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
            # Convert pixel coords to local metres (centered on image)
            sx, sz = _px_to_local(x1, y1, w, h, scale)
            ex, ez = _px_to_local(x2, y2, w, h, scale)
            length = float(np.hypot(ex - sx, ez - sz))
            result.append(DetectedEdge(
                start=(sx, sz),
                end=(ex, ez),
                confidence=min(1.0, length / 5.0),  # longer = more confident
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
        """Extract closed contours from edge image."""
        contours, _ = cv2.findContours(
            edges_img, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE,
        )
        result = []
        for cnt in contours:
            area_px = cv2.contourArea(cnt)
            if area_px < self.min_contour_area_px:
                continue

            # Approximate polygon
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
        """Basic colour segmentation using HSV k-means."""
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        pixels = hsv.reshape(-1, 3).astype(np.float32)

        # K-means with k=4 clusters
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

            # Keep only the largest contour per cluster
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
        Detector implementation to use. Defaults to OpenCVDetector.

    Returns
    -------
    ImageDetections
        Detected edges, contours, and material regions.
    """
    if not HAS_CV2:
        logger.warning("OpenCV not available -- skipping image detection")
        return ImageDetections()

    # Resolve file path from ImageInput or string
    image_path = None
    if isinstance(image_input, str):
        image_path = image_input
    elif hasattr(image_input, 'file_path') and image_input.file_path:
        image_path = image_input.file_path
    else:
        # URL-only image — can't do local file detection yet
        logger.info("Image is URL-only (no local file) -- skipping image detection for now")
        return ImageDetections()

    path = Path(image_path)
    if not path.exists():
        logger.warning("Image file not found: %s -- skipping image detection", image_path)
        return ImageDetections()

    image = cv2.imread(str(path))
    if image is None:
        logger.error("Failed to read image: %s", image_path)
        return ImageDetections()

    if detector is None:
        detector = OpenCVDetector()

    return detector.detect(image, registration)


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
