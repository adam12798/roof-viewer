"""
Roof geometry parsing pipeline.

Public API:
    compute_registration  – Anchor-dot alignment (SVD affine)
    preprocess_lidar      – Ground removal, outlier filter, downsample
    extract_planes        – Multi-plane RANSAC + DBSCAN clustering
    detect_from_image     – OpenCV edge/contour/material detection
    fuse_detections       – Merge LiDAR planes with image detections
    build_roof_graph      – Adjacency, edge classification, dormers
    score_confidence      – Per-element and overall confidence scoring
"""

from pipeline.registration import compute_registration
from pipeline.lidar_processor import preprocess_lidar
from pipeline.plane_extractor import extract_planes
from pipeline.image_detector import detect_from_image
from pipeline.fusion import fuse_detections
from pipeline.graph_builder import build_roof_graph
from pipeline.confidence import score_confidence

__all__ = [
    "compute_registration",
    "preprocess_lidar",
    "extract_planes",
    "detect_from_image",
    "fuse_detections",
    "build_roof_graph",
    "score_confidence",
]
