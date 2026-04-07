"""
Image engine v2 — experimental improvements.

Runs independently of the production image_engine.  No production files
are modified.  Import and extend v1 components where possible.

Usage:
    from pipeline.image_engine_v2 import run_image_engine_v2, V2Config

    result = run_image_engine_v2(image_input, registration)
"""

from pipeline.image_engine_v2.processor import run_image_engine_v2
from pipeline.image_engine_v2.config import V2Config

__all__ = ["run_image_engine_v2", "V2Config"]
