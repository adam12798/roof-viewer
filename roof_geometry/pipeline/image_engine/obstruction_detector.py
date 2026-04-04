"""
Obstruction candidate detection for the image engine pipeline.

Detects likely chimney, vent, skylight, and pipe candidate regions
using heuristic shape/size analysis within segmented roof regions.
"""

from __future__ import annotations

import logging
import math

import numpy as np

from models.schemas import ImageInput, RegistrationTransform
from pipeline.image_engine.edge_detector import px_to_local
from pipeline.image_engine.schemas import (
    ImageEngineConfig,
    ObstructionCandidate,
    PreprocessedImage,
    SegmentedRegion,
)

logger = logging.getLogger(__name__)

try:
    import cv2
    HAS_CV2 = True
except ImportError:
    cv2 = None  # type: ignore[assignment]
    HAS_CV2 = False


def detect_obstructions(
    preprocessed: PreprocessedImage,
    regions: list[SegmentedRegion],
    image_input: ImageInput,
    registration: RegistrationTransform,
    config: ImageEngineConfig,
) -> list[ObstructionCandidate]:
    """
    Detect candidate rooftop obstructions within segmented regions.

    Strategy:
      1. For each promoted region, create a masked sub-image
      2. Apply adaptive thresholding to find high-contrast blobs
      3. Find contours of blobs
      4. Filter by area bounds
      5. Classify by shape: circular → vent/pipe, rectangular → chimney/skylight
    """
    if not HAS_CV2:
        return []

    scale = _get_scale(image_input, registration)
    w, h = preprocessed.width_px, preprocessed.height_px
    candidates: list[ObstructionCandidate] = []

    for region in regions:
        if not region.promoted_to_plane:
            continue
        if region.mask is None:
            # Build mask from boundary
            region_mask = _build_region_mask(region, w, h)
        else:
            region_mask = region.mask

        blobs = _find_blobs_in_region(preprocessed.gray, region_mask, config)
        for blob_contour in blobs:
            candidate = _classify_blob(
                blob_contour, region.id, w, h, scale, config,
            )
            if candidate is not None:
                candidates.append(candidate)

    logger.info("Obstruction detection: %d candidates found", len(candidates))
    return candidates


def _get_scale(image_input: ImageInput, registration: RegistrationTransform) -> float:
    if registration.scale > 0:
        return registration.scale
    return image_input.resolution_m_per_px


def _build_region_mask(region: SegmentedRegion, w: int, h: int) -> np.ndarray:
    """Build a binary mask from region boundary pixels."""
    mask = np.zeros((h, w), dtype=np.uint8)
    if len(region.boundary_px) >= 3:
        pts = np.array(region.boundary_px, dtype=np.int32).reshape(-1, 1, 2)
        cv2.fillPoly(mask, [pts], 255)
    return mask


def _find_blobs_in_region(
    gray: np.ndarray,
    region_mask: np.ndarray,
    config: ImageEngineConfig,
) -> list[np.ndarray]:
    """Find high-contrast blobs within a region using adaptive thresholding."""
    # Apply mask
    masked = cv2.bitwise_and(gray, gray, mask=region_mask)

    # Adaptive threshold to find dark/bright blobs against the roof surface
    thresh = cv2.adaptiveThreshold(
        masked, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        blockSize=21,
        C=10,
    )

    # Mask the threshold result to the region
    thresh = cv2.bitwise_and(thresh, thresh, mask=region_mask)

    # Clean up with morphological operations
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel, iterations=1)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=1)

    contours, _ = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return list(contours)


def _classify_blob(
    contour: np.ndarray,
    parent_region_id: str,
    img_w: int,
    img_h: int,
    scale: float,
    config: ImageEngineConfig,
) -> ObstructionCandidate | None:
    """Classify a blob contour as an obstruction candidate."""
    area_px = cv2.contourArea(contour)
    area_m2 = area_px * scale * scale

    if area_m2 < config.min_obstruction_area_m2:
        return None
    if area_m2 > config.max_obstruction_area_m2:
        return None

    # Bounding rect
    rect = cv2.minAreaRect(contour)
    box_w, box_h = rect[1]
    if box_w == 0 or box_h == 0:
        return None
    aspect = max(box_w, box_h) / min(box_w, box_h)

    # Circularity: 4*pi*area / perimeter^2
    perimeter = cv2.arcLength(contour, True)
    circularity = (4 * math.pi * area_px) / (perimeter * perimeter) if perimeter > 0 else 0

    # Classify
    if circularity > 0.75:
        classification = "vent" if area_m2 < 1.0 else "pipe"
    elif aspect < 1.5 and area_m2 > 1.0:
        classification = "chimney"
    elif aspect > 1.5 and area_m2 > 0.5:
        classification = "skylight"
    else:
        classification = "unknown"

    # Centroid
    M = cv2.moments(contour)
    if M["m00"] > 0:
        cx = int(M["m10"] / M["m00"])
        cy = int(M["m01"] / M["m00"])
    else:
        cx, cy = int(rect[0][0]), int(rect[0][1])

    center_local = px_to_local(cx, cy, img_w, img_h, scale)

    # Boundary
    epsilon = 0.03 * perimeter
    simplified = cv2.approxPolyDP(contour, epsilon, True)
    boundary_px = [(int(pt[0][0]), int(pt[0][1])) for pt in simplified]
    boundary_local = [px_to_local(px, py, img_w, img_h, scale) for px, py in boundary_px]

    confidence = 0.3 + circularity * 0.2  # base + shape bonus

    return ObstructionCandidate(
        center_px=(cx, cy),
        center_local=center_local,
        boundary_px=boundary_px,
        boundary_local=boundary_local,
        area_m2=area_m2,
        classification=classification,
        confidence=min(0.6, confidence),
        parent_region_id=parent_region_id,
    )
