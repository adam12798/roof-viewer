"""
Image engine pipeline module.

Provides a purely image-based roof analysis engine that operates
independently of LiDAR data. Produces RoofPlane candidates, edge
detections, obstruction/dormer candidates, and debug visualizations.

Usage:
    from pipeline.image_engine import run_image_engine, ImageEngineResult

    result = run_image_engine(image_input, registration)
"""

from pipeline.image_engine.processor import run_image_engine
from pipeline.image_engine.schemas import ImageEngineConfig, ImageEngineResult, make_config

__all__ = ["run_image_engine", "ImageEngineConfig", "ImageEngineResult", "make_config"]
