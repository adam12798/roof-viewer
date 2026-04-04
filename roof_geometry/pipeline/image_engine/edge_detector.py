"""
Edge detection and line extraction for the image engine pipeline.

Produces a binary edge map (Canny) and extracts straight line segments
using LSD and/or Hough transform, with collinear merging.
"""

from __future__ import annotations

import logging
import math
import uuid
from typing import Optional

import numpy as np

from models.schemas import ImageInput, RegistrationTransform
from pipeline.image_engine.schemas import (
    ExtractedLine,
    ImageEngineConfig,
    PreprocessedImage,
)

logger = logging.getLogger(__name__)

try:
    import cv2
    HAS_CV2 = True
except ImportError:
    cv2 = None  # type: ignore[assignment]
    HAS_CV2 = False


def detect_edges(
    preprocessed: PreprocessedImage,
    config: ImageEngineConfig,
) -> np.ndarray:
    """
    Run Canny edge detection on the CLAHE-enhanced image.

    Returns a binary edge map (H x W, uint8, values 0 or 255).
    """
    if not HAS_CV2:
        return np.zeros((preprocessed.height_px, preprocessed.width_px), dtype=np.uint8)

    edge_map = cv2.Canny(
        preprocessed.enhanced,
        config.canny_low,
        config.canny_high,
        apertureSize=3,
        L2gradient=True,
    )

    logger.info(
        "Canny edge detection: %d edge pixels (%.1f%%)",
        np.count_nonzero(edge_map),
        100.0 * np.count_nonzero(edge_map) / edge_map.size,
    )
    return edge_map


def extract_lines(
    edge_map: np.ndarray,
    preprocessed: PreprocessedImage,
    image_input: ImageInput,
    registration: RegistrationTransform,
    config: ImageEngineConfig,
) -> tuple[list[ExtractedLine], dict[str, int]]:
    """
    Extract straight line segments from the edge map.

    Uses LSD (Line Segment Detector) as primary method with
    Hough Line Transform as supplementary. Merges near-collinear
    segments and filters by minimum length.

    Returns (filtered_lines, line_counts) where line_counts tracks
    lines at each stage for diagnostics.
    """
    if not HAS_CV2:
        return [], {"lsd": 0, "hough": 0, "combined": 0, "after_merge": 0, "after_filter": 0}

    scale = _get_scale(image_input, registration)
    w, h = preprocessed.width_px, preprocessed.height_px

    # Primary: LSD
    lsd_lines = _detect_lsd_lines(preprocessed.enhanced)

    # Secondary: Hough
    hough_lines = _detect_hough_lines(edge_map, config)

    # Combine and deduplicate
    raw_lines = _combine_lines(lsd_lines, hough_lines, w, h, scale, config)

    # Merge collinear segments
    merged = _merge_collinear(raw_lines, config)

    # Filter by minimum length, minimum pixel length, and minimum confidence
    filtered = [
        ln for ln in merged
        if ln.length_m >= config.min_line_length_m
        and ln.length_px >= config.min_line_length_px
        and ln.confidence >= config.min_line_confidence
    ]

    line_counts = {
        "lsd": len(lsd_lines),
        "hough": len(hough_lines),
        "combined": len(raw_lines),
        "after_merge": len(merged),
        "after_filter": len(filtered),
    }

    logger.info(
        "Line extraction: LSD=%d, Hough=%d, combined=%d, merged=%d, filtered=%d",
        len(lsd_lines), len(hough_lines), len(raw_lines), len(merged), len(filtered),
    )
    return filtered, line_counts


def _get_scale(image_input: ImageInput, registration: RegistrationTransform) -> float:
    """Get metres-per-pixel scale from registration or image input."""
    if registration.scale > 0:
        return registration.scale
    return image_input.resolution_m_per_px


def px_to_local(
    px: int,
    py: int,
    img_w: int,
    img_h: int,
    scale: float,
) -> tuple[float, float]:
    """Convert pixel coordinates to local metres (x, z)."""
    x = (px - img_w / 2) * scale
    z = (py - img_h / 2) * scale
    return x, z


def _detect_lsd_lines(enhanced: np.ndarray) -> list[tuple[int, int, int, int]]:
    """Run LSD on the enhanced grayscale image."""
    try:
        lsd = cv2.createLineSegmentDetector(cv2.LSD_REFINE_STD)
        lines, _, _, _ = lsd.detect(enhanced)
        if lines is None:
            return []
        result = []
        for seg in lines:
            x1, y1, x2, y2 = seg[0]
            # Pre-filter: drop very short LSD segments (noise)
            dx, dy = x2 - x1, y2 - y1
            if dx * dx + dy * dy < 40 * 40:  # < 40px
                continue
            result.append((int(x1), int(y1), int(x2), int(y2)))
        return result
    except Exception as e:
        logger.warning("LSD detection failed: %s", e)
        return []


def _detect_hough_lines(
    edge_map: np.ndarray,
    config: ImageEngineConfig,
) -> list[tuple[int, int, int, int]]:
    """Run probabilistic Hough line detection on the edge map."""
    lines = cv2.HoughLinesP(
        edge_map,
        rho=1,
        theta=np.pi / 180,
        threshold=config.hough_threshold,
        minLineLength=config.hough_min_line_length,
        maxLineGap=config.hough_max_line_gap,
    )
    if lines is None:
        return []
    return [(int(l[0][0]), int(l[0][1]), int(l[0][2]), int(l[0][3])) for l in lines]


def _combine_lines(
    lsd_lines: list[tuple[int, int, int, int]],
    hough_lines: list[tuple[int, int, int, int]],
    img_w: int,
    img_h: int,
    scale: float,
    config: ImageEngineConfig,
) -> list[ExtractedLine]:
    """Combine LSD and Hough lines, removing near-duplicates from Hough."""
    result: list[ExtractedLine] = []

    # Add all LSD lines
    for x1, y1, x2, y2 in lsd_lines:
        result.append(_make_line(x1, y1, x2, y2, img_w, img_h, scale, confidence=0.6))

    # Add Hough lines only if not near-duplicate of an existing LSD line
    for x1, y1, x2, y2 in hough_lines:
        candidate = _make_line(x1, y1, x2, y2, img_w, img_h, scale, confidence=0.4)
        if not _is_duplicate(candidate, result, config):
            result.append(candidate)

    return result


def _make_line(
    x1: int, y1: int, x2: int, y2: int,
    img_w: int, img_h: int, scale: float,
    confidence: float,
) -> ExtractedLine:
    """Create an ExtractedLine from pixel endpoints."""
    dx, dy = x2 - x1, y2 - y1
    length_px = math.sqrt(dx * dx + dy * dy)
    angle_deg = math.degrees(math.atan2(dy, dx)) % 180

    s_local = px_to_local(x1, y1, img_w, img_h, scale)
    e_local = px_to_local(x2, y2, img_w, img_h, scale)
    length_m = math.sqrt(
        (e_local[0] - s_local[0]) ** 2 + (e_local[1] - s_local[1]) ** 2
    )

    return ExtractedLine(
        start_px=(x1, y1),
        end_px=(x2, y2),
        start_local=s_local,
        end_local=e_local,
        length_px=length_px,
        length_m=length_m,
        angle_deg=angle_deg,
        confidence=confidence,
    )


def _is_duplicate(
    candidate: ExtractedLine,
    existing: list[ExtractedLine],
    config: ImageEngineConfig,
) -> bool:
    """Check if a candidate line is a near-duplicate of any existing line."""
    for ln in existing:
        angle_diff = abs(candidate.angle_deg - ln.angle_deg)
        if angle_diff > 90:
            angle_diff = 180 - angle_diff
        if angle_diff > config.merge_angle_tolerance_deg:
            continue
        # Check midpoint distance
        mid_c = (
            (candidate.start_px[0] + candidate.end_px[0]) / 2,
            (candidate.start_px[1] + candidate.end_px[1]) / 2,
        )
        mid_e = (
            (ln.start_px[0] + ln.end_px[0]) / 2,
            (ln.start_px[1] + ln.end_px[1]) / 2,
        )
        dist = math.sqrt((mid_c[0] - mid_e[0]) ** 2 + (mid_c[1] - mid_e[1]) ** 2)
        if dist < max(candidate.length_px, ln.length_px) * 0.3:
            return True
    return False


def _merge_collinear(
    lines: list[ExtractedLine],
    config: ImageEngineConfig,
) -> list[ExtractedLine]:
    """
    Merge near-collinear line segments that are close together.

    Two lines are merged if:
    - Their angles differ by less than merge_angle_tolerance_deg
    - The gap between them is less than merge_gap_tolerance_m
    """
    if len(lines) <= 1:
        return lines

    used = [False] * len(lines)
    merged: list[ExtractedLine] = []

    for i in range(len(lines)):
        if used[i]:
            continue
        current = lines[i]
        used[i] = True

        # Try to extend by merging with compatible lines
        for j in range(i + 1, len(lines)):
            if used[j]:
                continue
            other = lines[j]

            angle_diff = abs(current.angle_deg - other.angle_deg)
            if angle_diff > 90:
                angle_diff = 180 - angle_diff
            if angle_diff > config.merge_angle_tolerance_deg:
                continue

            # Check gap distance between closest endpoints
            gap = _endpoint_gap(current, other)
            if gap > config.merge_gap_tolerance_m:
                continue

            # Merge: take the two most distant endpoints
            current = _merge_two_lines(current, other)
            used[j] = True

        merged.append(current)

    return merged


def _endpoint_gap(a: ExtractedLine, b: ExtractedLine) -> float:
    """Minimum distance between any pair of endpoints (in local metres)."""
    points_a = [a.start_local, a.end_local]
    points_b = [b.start_local, b.end_local]
    min_dist = float("inf")
    for pa in points_a:
        for pb in points_b:
            d = math.sqrt((pa[0] - pb[0]) ** 2 + (pa[1] - pb[1]) ** 2)
            min_dist = min(min_dist, d)
    return min_dist


def _merge_two_lines(a: ExtractedLine, b: ExtractedLine) -> ExtractedLine:
    """Merge two lines by keeping the most distant pair of endpoints."""
    all_points_px = [a.start_px, a.end_px, b.start_px, b.end_px]
    all_points_local = [a.start_local, a.end_local, b.start_local, b.end_local]

    max_dist = 0.0
    best_i, best_j = 0, 1
    for i in range(4):
        for j in range(i + 1, 4):
            dx = all_points_local[i][0] - all_points_local[j][0]
            dz = all_points_local[i][1] - all_points_local[j][1]
            d = math.sqrt(dx * dx + dz * dz)
            if d > max_dist:
                max_dist = d
                best_i, best_j = i, j

    s_px, e_px = all_points_px[best_i], all_points_px[best_j]
    s_local, e_local = all_points_local[best_i], all_points_local[best_j]

    dx_px = e_px[0] - s_px[0]
    dy_px = e_px[1] - s_px[1]
    angle_deg = math.degrees(math.atan2(dy_px, dx_px)) % 180

    return ExtractedLine(
        start_px=s_px,
        end_px=e_px,
        start_local=s_local,
        end_local=e_local,
        length_px=math.sqrt(dx_px ** 2 + dy_px ** 2),
        length_m=max_dist,
        angle_deg=angle_deg,
        confidence=max(a.confidence, b.confidence),
    )
