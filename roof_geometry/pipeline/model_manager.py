"""
Singleton model manager for SAM (Segment Anything Model).

Loads MobileSAM checkpoint once at startup and provides cached
predictor/generator instances for the image detection pipeline.
"""

import os
import logging
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# Default checkpoint location: roof_geometry/models/
_DEFAULT_MODEL_DIR = Path(__file__).parent.parent / "models"
_MOBILE_SAM_CHECKPOINT = "mobile_sam.pt"
_MOBILE_SAM_URL = "https://github.com/ChaoningZhang/MobileSAM/raw/master/weights/mobile_sam.pt"


class ModelManager:
    """Singleton that manages SAM model lifecycle."""

    _instance: Optional["ModelManager"] = None
    _initialized: bool = False

    def __new__(cls) -> "ModelManager":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True

        self._device = None
        self._sam_model = None
        self._sam_predictor = None
        self._mask_generator = None
        self._model_dir = Path(
            os.environ.get("SAM_MODEL_DIR", str(_DEFAULT_MODEL_DIR))
        )

    @property
    def device(self):
        if self._device is None:
            import torch
            if torch.cuda.is_available():
                self._device = torch.device("cuda")
                logger.info("Using CUDA device for SAM")
            else:
                # MPS (Apple Silicon) has float64 issues with SAM's mask generator,
                # so we default to CPU which is reliable and fast enough for MobileSAM.
                self._device = torch.device("cpu")
                logger.info("Using CPU device for SAM")
        return self._device

    def _get_checkpoint_path(self) -> Path:
        """Resolve checkpoint path, checking env var override first."""
        env_path = os.environ.get("SAM_CHECKPOINT_PATH")
        if env_path:
            p = Path(env_path)
            if p.exists():
                return p
            logger.warning(f"SAM_CHECKPOINT_PATH={env_path} does not exist, falling back to default")

        return self._model_dir / _MOBILE_SAM_CHECKPOINT

    def _download_checkpoint(self, dest: Path) -> None:
        """Download MobileSAM checkpoint if not present."""
        if dest.exists():
            return

        dest.parent.mkdir(parents=True, exist_ok=True)
        logger.info(f"Downloading MobileSAM checkpoint to {dest} ...")

        import urllib.request
        urllib.request.urlretrieve(_MOBILE_SAM_URL, str(dest))
        logger.info(f"Download complete: {dest} ({dest.stat().st_size / 1e6:.1f} MB)")

    def _load_sam(self):
        """Load MobileSAM model into memory."""
        if self._sam_model is not None:
            return

        checkpoint = self._get_checkpoint_path()
        self._download_checkpoint(checkpoint)

        logger.info(f"Loading MobileSAM from {checkpoint} ...")

        from mobile_sam import sam_model_registry, SamPredictor, SamAutomaticMaskGenerator

        model_type = "vit_t"
        self._sam_model = sam_model_registry[model_type](checkpoint=str(checkpoint))
        self._sam_model.to(self.device)
        self._sam_model.eval()

        logger.info("MobileSAM loaded successfully")

    def get_predictor(self):
        """
        Get a SamPredictor instance (for point/box prompted segmentation).
        The predictor is created once and cached.
        """
        if self._sam_predictor is None:
            self._load_sam()
            from mobile_sam import SamPredictor
            self._sam_predictor = SamPredictor(self._sam_model)
            logger.info("SAM predictor ready")
        return self._sam_predictor

    def get_mask_generator(self, **kwargs):
        """
        Get a SamAutomaticMaskGenerator instance (for unprompted full-image segmentation).

        kwargs are passed to the generator constructor. Defaults tuned for roof detection:
          - points_per_side: 32
          - pred_iou_thresh: 0.86
          - stability_score_thresh: 0.92
          - min_mask_region_area: 100
        """
        defaults = {
            "points_per_side": 32,
            "pred_iou_thresh": 0.86,
            "stability_score_thresh": 0.92,
            "min_mask_region_area": 100,
        }
        defaults.update(kwargs)

        if self._mask_generator is None:
            self._load_sam()
            from mobile_sam import SamAutomaticMaskGenerator
            self._mask_generator = SamAutomaticMaskGenerator(
                self._sam_model, **defaults
            )
            logger.info("SAM mask generator ready")
        return self._mask_generator

    def is_loaded(self) -> bool:
        return self._sam_model is not None

    def unload(self):
        """Free model memory."""
        self._sam_model = None
        self._sam_predictor = None
        self._mask_generator = None
        self._device = None
        logger.info("SAM model unloaded")


# Module-level convenience
_manager = ModelManager()

def get_predictor():
    return _manager.get_predictor()

def get_mask_generator(**kwargs):
    return _manager.get_mask_generator(**kwargs)

def is_loaded() -> bool:
    return _manager.is_loaded()
