"""
Enhanced preprocessing — extends v1 with shadow detection and adaptive thresholds.
"""

from __future__ import annotations

import logging

import cv2
import numpy as np

from models.schemas import ImageInput
from pipeline.image_engine.preprocess import preprocess_image as v1_preprocess
from pipeline.image_engine.schemas import PreprocessedImage
from pipeline.image_engine_v2.config import V2Config

logger = logging.getLogger(__name__)


def preprocess_image_v2(
    image_input: ImageInput,
    config: V2Config,
) -> PreprocessedImage:
    """Run v1 preprocessing, then enhance the roof mask with v2 improvements."""

    # Run the full v1 pipeline first (CLAHE, blur, HSV, base roof mask)
    result = v1_preprocess(image_input, config)

    # Layer additional exclusions onto the roof mask
    enhanced_mask = result.roof_mask.copy()

    if config.enable_shadow_detection:
        shadow_mask = _detect_shadows(result.hsv, config)
        shadow_px = int(np.count_nonzero(shadow_mask))
        enhanced_mask = cv2.bitwise_and(enhanced_mask, cv2.bitwise_not(shadow_mask))
        logger.info("V2 shadow detection: excluded %d shadow pixels", shadow_px)

    if config.enable_adaptive_dark_threshold:
        dark_mask = _adaptive_dark_mask(result.gray, config)
        dark_px = int(np.count_nonzero(dark_mask))
        enhanced_mask = cv2.bitwise_and(enhanced_mask, cv2.bitwise_not(dark_mask))
        logger.info("V2 adaptive dark: excluded %d dark pixels", dark_px)

    # Clean up with morphological ops (same as v1 but on enhanced mask)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    enhanced_mask = cv2.morphologyEx(enhanced_mask, cv2.MORPH_OPEN, kernel, iterations=1)
    enhanced_mask = cv2.morphologyEx(enhanced_mask, cv2.MORPH_CLOSE, kernel, iterations=1)

    pct_before = 100.0 * np.count_nonzero(result.roof_mask) / result.roof_mask.size
    pct_after = 100.0 * np.count_nonzero(enhanced_mask) / enhanced_mask.size
    logger.info(
        "V2 roof mask: %.1f%% → %.1f%% (removed %.1f%% additional)",
        pct_before, pct_after, pct_before - pct_after,
    )

    # Return new PreprocessedImage with enhanced mask
    return PreprocessedImage(
        bgr=result.bgr,
        gray=result.gray,
        enhanced=result.enhanced,
        denoised=result.denoised,
        hsv=result.hsv,
        roof_mask=enhanced_mask,
        width_px=result.width_px,
        height_px=result.height_px,
    )


def _detect_shadows(hsv: np.ndarray, config: V2Config) -> np.ndarray:
    """Detect deep shadow regions using the V channel histogram."""
    v_channel = hsv[:, :, 2]
    threshold = np.percentile(v_channel, config.shadow_v_percentile)
    # Shadows: very low value AND low saturation (not just dark-colored objects)
    s_channel = hsv[:, :, 1]
    shadow = ((v_channel < threshold) & (s_channel < 80)).astype(np.uint8) * 255

    # Dilate slightly to catch shadow edges
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    shadow = cv2.dilate(shadow, kernel, iterations=1)
    return shadow


def _adaptive_dark_mask(gray: np.ndarray, config: V2Config) -> np.ndarray:
    """Build an adaptive dark threshold from the image histogram.

    Instead of a fixed threshold=50, use the 5th percentile of the
    grayscale histogram as the dark cutoff.  This adapts to overall
    image brightness — dark roofs on overcast days won't be clipped.
    """
    p5 = np.percentile(gray, 5)
    # The dark threshold is the max of (percentile, 25) to avoid
    # being too permissive on very dark images
    threshold = max(int(p5), 25)
    dark = (gray < threshold).astype(np.uint8) * 255
    logger.info("V2 adaptive dark threshold: %d (5th pctl=%.0f)", threshold, p5)
    return dark
