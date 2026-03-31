"""
Orchestrator that chains all pipeline stages into a single parse() call.
"""

from __future__ import annotations

import math
import time
import traceback
import logging
from typing import Any

import numpy as np

from models.schemas import (
    ConfidenceReport,
    RegistrationTransform,
    RoofGraph,
    RoofParseMetadata,
    RoofParseRequest,
    RoofParseResponse,
)

from pipeline.registration import compute_registration
from pipeline.lidar_processor import preprocess_lidar
from pipeline.plane_extractor import extract_planes
from pipeline.image_detector import detect_from_image
from pipeline.fusion import fuse_detections
from pipeline.graph_builder import build_roof_graph
from pipeline.confidence import score_confidence

PIPELINE_VERSION = "0.1.0"
logger = logging.getLogger(__name__)


class RoofParsingPipeline:
    """Chains the 9 stages of roof geometry parsing."""

    def __init__(self) -> None:
        self.version = PIPELINE_VERSION
        self.stage_timings: dict[str, float] = {}

    def _time_stage(self, name: str, func, *args, **kwargs) -> Any:
        """Run a stage function and record its wall-clock time."""
        t0 = time.perf_counter()
        result = func(*args, **kwargs)
        elapsed = time.perf_counter() - t0
        self.stage_timings[name] = round(elapsed, 4)
        return result

    async def parse(self, request: RoofParseRequest) -> RoofParseResponse:
        """
        Execute the full pipeline:
          1. Validate inputs
          2. Compute registration (anchor dots -> affine transform)
          3. Convert LiDAR [lng, lat, elev] to local XYZ
          4. Preprocess LiDAR (filter, downsample)
          5. Extract planes from LiDAR point cloud
          6. Detect features from imagery
          7. Fuse LiDAR planes + image detections
          8. Build roof graph (edges, intersections, adjacency)
          9. Score confidence and flag review items
        """
        t_total_start = time.perf_counter()
        self.stage_timings = {}

        try:
            # Stage 1: Validate inputs (relaxed — 0 anchor dots is OK)
            self._time_stage("validate", self._validate_inputs, request)

            # Stage 2: Registration
            registration = self._time_stage(
                "registration",
                compute_registration,
                request.anchor_dots,
                request.design_center,
                request.lidar,
                request.image,
            )

            # Stage 3: Convert raw LiDAR points to local Nx3 numpy array
            lidar_xyz = self._time_stage(
                "lidar_convert",
                self._convert_lidar_to_local,
                request,
            )

            if lidar_xyz is None or len(lidar_xyz) == 0:
                raise ValueError("No LiDAR points available after conversion")

            logger.info("LiDAR points converted to local XYZ: %d points", len(lidar_xyz))

            # Stage 4: Preprocess LiDAR (ground removal, outlier filtering, downsampling)
            # If calibration offset was applied in _convert_lidar_to_local(), skip
            # the registration transform to avoid double-correcting alignment.
            calib = request.calibration_offset
            if calib.tx != 0 or calib.tz != 0:
                from models.schemas import RegistrationTransform as RT
                effective_reg = RT(
                    affine_matrix=[[1, 0, 0], [0, 1, 0], [0, 0, 1]],
                    tx=0, tz=0, rotation_deg=0, scale=1.0,
                    residual_error=0, method="identity_calib_override",
                )
                logger.info("Calibration offset non-zero (tx=%.3f tz=%.3f) — skipping registration to avoid double-offset",
                            calib.tx, calib.tz)
            else:
                effective_reg = registration

            processed = self._time_stage(
                "lidar_preprocess",
                preprocess_lidar,
                lidar_xyz,
                effective_reg,
            )

            logger.info("LiDAR points after preprocessing: %d", len(processed))

            if len(processed) == 0:
                raise ValueError("No LiDAR points remaining after preprocessing")

            # Stage 5: Extract planes from LiDAR
            planes = self._time_stage(
                "plane_extraction",
                extract_planes,
                processed,
                request.options,
            )

            logger.info("Planes extracted: %d", len(planes))

            # Stage 6: Detect from image (stub — no real image fetching yet)
            image_detections = self._time_stage(
                "image_detection",
                detect_from_image,
                request.image,
                registration,
            )

            # Stage 7: Fuse detections
            fused = self._time_stage(
                "fusion",
                fuse_detections,
                planes,
                image_detections,
                registration,
            )

            # Stage 8: Build roof graph
            roof_graph = self._time_stage(
                "graph_build",
                build_roof_graph,
                fused,
            )

            # Stage 9: Score confidence
            confidence_report = self._time_stage(
                "confidence",
                score_confidence,
                roof_graph,
            )

            # Format output
            crm_faces = roof_graph.to_crm_faces()

            total_time = time.perf_counter() - t_total_start

            lidar_points_used = len(lidar_xyz) if lidar_xyz is not None else 0

            metadata = RoofParseMetadata(
                processing_time_s=round(total_time, 3),
                pipeline_version=self.version,
                lidar_points_used=lidar_points_used,
                image_resolution_used=request.image.resolution_m_per_px,
            )

            return RoofParseResponse(
                registration=registration,
                roof_graph=roof_graph,
                crm_faces=crm_faces,
                confidence_report=confidence_report,
                metadata=metadata,
            )

        except Exception as e:
            total_time = time.perf_counter() - t_total_start
            logger.error("Pipeline failed: %s", e)
            traceback.print_exc()

            empty_registration = RegistrationTransform(
                affine_matrix=[[1, 0, 0], [0, 1, 0]],
                tx=0, tz=0,
                rotation_deg=0, scale=1.0,
                residual_error=0,
                method="failed",
            )

            return RoofParseResponse(
                registration=empty_registration,
                roof_graph=RoofGraph(),
                crm_faces=[],
                confidence_report=ConfidenceReport(
                    overall_confidence=0.0,
                    planes_needing_review=[],
                    edges_needing_review=[],
                    dormers_needing_review=[],
                    obstructions_needing_review=[],
                    disagreements=[],
                ),
                metadata=RoofParseMetadata(
                    processing_time_s=round(total_time, 3),
                    pipeline_version=self.version,
                    lidar_points_used=0,
                    image_resolution_used=request.image.resolution_m_per_px,
                ),
            )

    @staticmethod
    def _validate_inputs(request: RoofParseRequest) -> None:
        """Basic sanity checks on the request payload."""
        if not request.lidar.points and not request.lidar.file_path:
            raise ValueError("LiDAR input must provide either inline points or a file_path")
        if not request.image.url and not request.image.file_path:
            raise ValueError("Image input must provide either a url or a file_path")

    @staticmethod
    def _convert_lidar_to_local(request: RoofParseRequest) -> np.ndarray:
        """
        Convert raw LiDAR points from [lng, lat, elevation, class] format
        (as sent by the CRM frontend) into local [x, y, z] coordinates
        where x/z are metres from design center and y is elevation.

        Also filters to a tight radius around the design center to focus
        on the target building and avoid detecting neighbor roofs/trees.
        """
        if not request.lidar.points:
            return np.empty((0, 3))

        center_lat = request.design_center.lat
        center_lng = request.design_center.lng

        m_per_deg_lat = 111320.0
        m_per_deg_lng = 111320.0 * math.cos(math.radians(center_lat))

        # If we have anchor dots, compute a bounding radius from them
        # Otherwise default to 10m radius (typical single-family house)
        if request.anchor_dots and len(request.anchor_dots) >= 2:
            dot_dists = [math.sqrt(d.x**2 + d.z**2) for d in request.anchor_dots]
            max_dot_dist = max(dot_dists)
            focus_radius = max_dot_dist + 5.0  # add 5m buffer around dots
            focus_radius = max(focus_radius, 12.0)
        else:
            focus_radius = 10.0  # default: 10m radius

        raw = request.lidar.points
        converted = []
        all_local = []  # diagnostic: ALL points before radius filter

        for pt in raw:
            if len(pt) < 3:
                continue
            lng, lat, elev = pt[0], pt[1], pt[2]
            local_x = (lng - center_lng) * m_per_deg_lng
            local_z = -(lat - center_lat) * m_per_deg_lat

            all_local.append((local_x, local_z, elev))

            # Filter to focus radius around design center
            dist = math.sqrt(local_x**2 + local_z**2)
            if dist > focus_radius:
                continue

            # Apply user calibration offset (aligns LiDAR to satellite)
            local_x += request.calibration_offset.tx
            local_z += request.calibration_offset.tz

            converted.append([local_x, elev, local_z])

        # ── Diagnostic: bounding box of ALL points and elevated points ──
        if all_local:
            all_x = [p[0] for p in all_local]
            all_z = [p[1] for p in all_local]
            all_e = [p[2] for p in all_local]
            logger.info(
                "DIAG all points (%d): X=[%.1f, %.1f] Z=[%.1f, %.1f] Elev=[%.1f, %.1f]",
                len(all_local), min(all_x), max(all_x), min(all_z), max(all_z), min(all_e), max(all_e),
            )
            # Elevated points = top 30% by elevation (likely building)
            elev_sorted = sorted(all_e)
            elev_thresh = elev_sorted[int(len(elev_sorted) * 0.7)]
            high_pts = [(x, z, e) for x, z, e in all_local if e >= elev_thresh]
            if high_pts:
                hx = [p[0] for p in high_pts]
                hz = [p[1] for p in high_pts]
                max_dist = max(math.sqrt(x**2 + z**2) for x, z, _ in high_pts)
                logger.info(
                    "DIAG elevated points (%d, elev>=%.1f): X=[%.1f, %.1f] Z=[%.1f, %.1f] max_dist_from_center=%.1fm",
                    len(high_pts), elev_thresh, min(hx), max(hx), min(hz), max(hz), max_dist,
                )
                logger.info(
                    "DIAG focus_radius=%.1fm — %s to contain all elevated points",
                    focus_radius,
                    "SUFFICIENT" if focus_radius >= max_dist else "TOO SMALL (need %.1fm)" % max_dist,
                )

        logger.info(
            "LiDAR conversion: %d raw -> %d within %.1fm radius",
            len(raw), len(converted), focus_radius,
        )
        if not converted:
            return np.empty((0, 3))

        return np.array(converted, dtype=np.float64)
