"""
Image preprocessing for the image engine pipeline.

Loads the input image and produces multiple representations:
BGR, grayscale, CLAHE-enhanced, denoised, and HSV.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

from models.schemas import ImageInput
from pipeline.image_engine.schemas import ImageEngineConfig, PreprocessedImage

logger = logging.getLogger(__name__)

try:
    import cv2
    HAS_CV2 = True
except ImportError:
    cv2 = None  # type: ignore[assignment]
    HAS_CV2 = False
    logger.warning("OpenCV not installed — image engine preprocessing unavailable")


def preprocess_image(
    image_input: ImageInput,
    config: ImageEngineConfig,
) -> PreprocessedImage:
    """
    Load and preprocess the input image.

    Steps:
      1. Load from file path or URL
      2. Convert to grayscale
      3. Apply CLAHE for contrast normalization
      4. Apply Gaussian blur for denoising
      5. Convert to HSV for colour analysis

    Returns a PreprocessedImage with all representations.
    """
    if not HAS_CV2:
        raise RuntimeError("OpenCV is required for image engine preprocessing")

    bgr = _load_image(image_input)
    h, w = bgr.shape[:2]
    logger.info("Image loaded: %d x %d", w, h)

    # Grayscale
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)

    # CLAHE enhancement for shadow/contrast normalization
    clahe = cv2.createCLAHE(
        clipLimit=config.clahe_clip_limit,
        tileGridSize=(config.clahe_grid_size, config.clahe_grid_size),
    )
    enhanced = clahe.apply(gray)

    # Gaussian blur for noise reduction
    ksize = config.blur_kernel_size
    if ksize % 2 == 0:
        ksize += 1
    denoised = cv2.GaussianBlur(gray, (ksize, ksize), 0)

    # HSV for colour/material analysis
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)

    # Build roof mask: exclude vegetation and high-texture regions
    roof_mask = _build_roof_mask(hsv, gray, config)

    return PreprocessedImage(
        bgr=bgr,
        gray=gray,
        enhanced=enhanced,
        denoised=denoised,
        hsv=hsv,
        roof_mask=roof_mask,
        width_px=w,
        height_px=h,
    )


def _build_roof_mask(
    hsv: np.ndarray,
    gray: np.ndarray,
    config: ImageEngineConfig,
) -> np.ndarray:
    """
    Build a binary mask where 255 = likely roof surface, 0 = vegetation/tree/ground.

    Excludes:
      - Green/vegetation pixels (HSV hue in vegetation range with sufficient saturation)
      - High-texture regions (local grayscale variance above threshold — trees, grass)
    """
    h_channel = hsv[:, :, 0]
    s_channel = hsv[:, :, 1]

    # Vegetation mask: green hue + sufficient saturation
    green_mask = (
        (h_channel >= config.vegetation_hue_low)
        & (h_channel <= config.vegetation_hue_high)
        & (s_channel >= config.vegetation_sat_min)
    )

    # Texture mask: high local variance = trees/grass (not smooth roof)
    # Use a 15x15 window for local variance
    ksize = 15
    gray_f = gray.astype(np.float32)
    mean = cv2.blur(gray_f, (ksize, ksize))
    sq_mean = cv2.blur(gray_f * gray_f, (ksize, ksize))
    local_var = sq_mean - mean * mean
    texture_mask = local_var > config.max_texture_variance

    # Combine exclusions
    excluded = green_mask | texture_mask
    roof_mask = np.where(excluded, 0, 255).astype(np.uint8)

    # Morphological open to remove small noise holes in the mask
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    roof_mask = cv2.morphologyEx(roof_mask, cv2.MORPH_OPEN, kernel, iterations=1)
    # Close small gaps
    roof_mask = cv2.morphologyEx(roof_mask, cv2.MORPH_CLOSE, kernel, iterations=1)

    pct = 100.0 * np.count_nonzero(roof_mask) / roof_mask.size
    logger.info("Roof mask: %.1f%% of image classified as potential roof", pct)

    return roof_mask


def _load_image(image_input: ImageInput) -> np.ndarray:
    """Load image from file path or URL, returning BGR numpy array."""
    # Try file path first
    if image_input.file_path:
        path = Path(image_input.file_path)
        if path.exists():
            img = cv2.imread(str(path), cv2.IMREAD_COLOR)
            if img is not None:
                return img
            raise ValueError(f"Failed to decode image at {path}")
        logger.warning("Image file not found at %s, trying URL", path)

    # Try URL
    if image_input.url:
        return _fetch_image_from_url(image_input.url)

    raise ValueError("ImageInput must provide either file_path or url")


def _fetch_image_from_url(url: str) -> np.ndarray:
    """Download an image from a URL and return as BGR numpy array."""
    import urllib.request

    logger.info("Fetching image from URL: %s", url[:80])
    try:
        with urllib.request.urlopen(url, timeout=30) as resp:
            data = resp.read()
    except Exception as e:
        raise ValueError(f"Failed to fetch image from URL: {e}") from e

    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Failed to decode image downloaded from URL")
    return img
