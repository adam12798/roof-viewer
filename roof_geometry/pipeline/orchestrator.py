"""
Orchestrator that chains all pipeline stages into a single parse() call.

Supports two modes:
  - image_primary: SAM segments roof from satellite image, LiDAR provides 3D geometry
  - lidar_primary: RANSAC extracts planes from LiDAR, image provides refinement (legacy)
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
    Point2D,
    RegistrationTransform,
    RidgeLine,
    RoofGraph,
    RoofParseMetadata,
    RoofParseRequest,
    RoofParseResponse,
)

from pipeline.registration import compute_registration
from pipeline.lidar_processor import preprocess_lidar
from pipeline.plane_extractor import extract_planes
from pipeline.image_detector import detect_from_image, SAMDetector, ImageDetections
from pipeline.fusion import fuse_detections, fuse_image_primary
from pipeline.lidar_draper import drape_lidar
from pipeline.gradient_detector import detect_roof_faces
from pipeline.graph_builder import build_roof_graph
from pipeline.confidence import score_confidence
from pipeline.image_engine import run_image_engine, make_config

PIPELINE_VERSION = "0.3.0"
logger = logging.getLogger(__name__)


class RoofParsingPipeline:
    """Chains the pipeline stages with automatic mode selection."""

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
        Execute the full pipeline with automatic mode selection.

        Image-primary mode (new):
          1. Validate → 2. Register → 3-4. Convert & preprocess LiDAR
          5. SAM segmentation on satellite image → roof segments
          6. LiDAR draping onto image segments → 3D geometry
          7. Image-primary fusion → 8. Graph → 9. Confidence

        LiDAR-primary mode (legacy fallback):
          1. Validate → 2. Register → 3-4. Convert & preprocess LiDAR
          5. RANSAC plane extraction → 6. OpenCV image detection
          7. IoU fusion → 8. Graph → 9. Confidence
        """
        t_total_start = time.perf_counter()
        self.stage_timings = {}
        pipeline_mode_used = "lidar_primary"
        sam_masks_found = 0

        try:
            # Stage 1: Validate
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

            # Image engine early exit: bypass all LiDAR-dependent stages
            requested_mode = request.options.pipeline_mode
            image_engine_result_dict = None

            if requested_mode == "image_engine":
                fused, image_engine_result_dict = self._try_image_engine(
                    request, registration,
                )
                pipeline_mode_used = "image_engine"
                logger.info("Using IMAGE-ENGINE mode (%d planes)", len(fused))

                # Build graph and confidence from image-engine planes (may be empty)
                roof_graph = self._time_stage("graph_build", build_roof_graph, fused)
                confidence_report = self._time_stage("confidence", score_confidence, roof_graph)
                crm_faces = roof_graph.to_crm_faces()

                total_time = time.perf_counter() - t_total_start
                metadata = RoofParseMetadata(
                    processing_time_s=round(total_time, 3),
                    pipeline_version=self.version,
                    lidar_points_used=0,
                    image_resolution_used=request.image.resolution_m_per_px,
                    pipeline_mode_used="image_engine",
                    sam_masks_found=0,
                )

                return RoofParseResponse(
                    registration=registration,
                    roof_graph=roof_graph,
                    crm_faces=crm_faces,
                    confidence_report=confidence_report,
                    metadata=metadata,
                    ridge_line=None,
                    cell_labels_grid=None,
                    grid_info=None,
                    image_engine_result=image_engine_result_dict,
                )

            # Stage 3: Convert raw LiDAR to local XYZ
            lidar_xyz = self._time_stage(
                "lidar_convert",
                self._convert_lidar_to_local,
                request,
            )

            if lidar_xyz is None or len(lidar_xyz) == 0:
                raise ValueError("No LiDAR points available after conversion")

            logger.info("LiDAR points converted to local XYZ: %d points", len(lidar_xyz))

            # Stage 4: Preprocess LiDAR
            calib = request.calibration_offset
            if calib.tx != 0 or calib.tz != 0:
                effective_reg = RegistrationTransform(
                    affine_matrix=[[1, 0, 0], [0, 1, 0], [0, 0, 1]],
                    tx=0, tz=0, rotation_deg=0, scale=1.0,
                    residual_error=0, method="identity_calib_override",
                )
                logger.info(
                    "Calibration offset non-zero (tx=%.3f tz=%.3f) — skipping registration to avoid double-offset",
                    calib.tx, calib.tz,
                )
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

            # Determine pipeline mode (requested_mode set before LiDAR stages)
            fused = None

            # Gradient mode: default for auto — pure LiDAR height logic
            ridge_world = None
            cell_grid_info = None
            sweep_ridge_world = None
            if requested_mode in ("auto", "gradient"):
                lidar_resolution = request.lidar.resolution if request.lidar else 0.5
                gradient_result = self._try_gradient(processed, request.anchor_dots,
                                                     grid_resolution=lidar_resolution)
                if gradient_result is not None:
                    gradient_planes, ridge_world, cell_grid_info, sweep_ridge_world = gradient_result
                    if gradient_planes:
                        fused = gradient_planes
                        pipeline_mode_used = "gradient"
                        logger.info("Using GRADIENT mode (%d planes)", len(fused))
                    else:
                        logger.info("Gradient detection found no planes — falling back")

            # Image-primary mode: SAM-based (explicit request only)
            if fused is None and requested_mode == "image_primary":
                image_result = self._try_image_primary(
                    request, registration, processed,
                )
                if image_result is not None:
                    fused, image_detections = image_result
                    pipeline_mode_used = "image_primary"
                    sam_masks_found = len(image_detections.roof_segments)
                    logger.info("Using IMAGE-PRIMARY mode (%d segments)", sam_masks_found)

            # LiDAR-primary fallback: RANSAC
            if fused is None:
                fused = self._run_lidar_primary(request, registration, processed)
                pipeline_mode_used = "lidar_primary"
                logger.info("Using LIDAR-PRIMARY mode")

            # Stage 8: Build roof graph
            roof_graph = self._time_stage("graph_build", build_roof_graph, fused)

            # Stage 9: Score confidence
            confidence_report = self._time_stage("confidence", score_confidence, roof_graph)

            # Format output
            crm_faces = roof_graph.to_crm_faces()

            total_time = time.perf_counter() - t_total_start

            metadata = RoofParseMetadata(
                processing_time_s=round(total_time, 3),
                pipeline_version=self.version,
                lidar_points_used=len(lidar_xyz),
                image_resolution_used=request.image.resolution_m_per_px,
                pipeline_mode_used=pipeline_mode_used,
                sam_masks_found=sam_masks_found,
            )

            # Build ridge_line from gradient detector output if available
            ridge_line = None
            if ridge_world is not None:
                start, end, az, pitch, length, peak_h = ridge_world
                ridge_line = RidgeLine(
                    start=Point2D(x=start[0], z=start[1]),
                    end=Point2D(x=end[0], z=end[1]),
                    peak_height_m=float(peak_h),
                    length_m=float(length),
                    azimuth_deg=float(az),
                    pitch_deg=float(pitch),
                )

            # Build sweep ridge line from tracer RIDGE_DOT points
            sweep_ridge_line = None
            if sweep_ridge_world is not None:
                s, e, az, pitch, length, peak_h = sweep_ridge_world
                sweep_ridge_line = RidgeLine(
                    start=Point2D(x=s[0], z=s[1]),
                    end=Point2D(x=e[0], z=e[1]),
                    peak_height_m=float(peak_h),
                    length_m=float(length),
                    azimuth_deg=float(az),
                    pitch_deg=float(pitch),
                )

            return RoofParseResponse(
                registration=registration,
                roof_graph=roof_graph,
                crm_faces=crm_faces,
                confidence_report=confidence_report,
                metadata=metadata,
                ridge_line=ridge_line,
                sweep_ridge_line=sweep_ridge_line,
                cell_labels_grid=cell_grid_info['grid'] if cell_grid_info else None,
                grid_info={k: v for k, v in cell_grid_info.items() if k != 'grid'} if cell_grid_info else None,
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
                    pipeline_mode_used="failed",
                    sam_masks_found=0,
                ),
            )

    def _try_gradient(
        self,
        processed_lidar: np.ndarray,
        anchor_dots: list | None = None,
        grid_resolution: float = 0.5,
    ) -> tuple[list, tuple] | None:
        """
        Anchor-seeded roof detection: use calibration dots to learn
        what 'roof' looks like, then grow faces from those seeds.
        Returns (planes, ridge_world, cell_grid_info) or None on failure.
        """
        try:
            # Convert anchor dots to (x, z) tuples
            anchor_xz = None
            if anchor_dots:
                anchor_xz = [(d.x, d.z) for d in anchor_dots]

            planes, ridge_world, cell_grid_info, sweep_ridge_world = self._time_stage(
                "gradient_detection",
                detect_roof_faces,
                processed_lidar,
                anchor_dots=anchor_xz,
                grid_resolution=grid_resolution,
            )
            # Always return cell_grid_info so the classification grid reaches the frontend
            # even when no planes were found. The caller decides whether to fall back.
            return planes, ridge_world, cell_grid_info, sweep_ridge_world
        except Exception as e:
            logger.warning("Gradient detection failed: %s — falling back", e)
            return None

    def _try_image_primary(
        self,
        request: RoofParseRequest,
        registration: RegistrationTransform,
        processed_lidar: np.ndarray,
    ) -> tuple[list, ImageDetections] | None:
        """
        Attempt the image-primary pipeline path.

        Returns (fused_planes, image_detections) if successful, or None to fall back.
        """
        try:
            # Step A: Generate LiDAR-guided point prompts for SAM
            # Use RANSAC to find approximate roof peaks, then project to pixel coords
            point_prompts = self._lidar_to_pixel_prompts(
                processed_lidar, request.image, registration,
            )

            # Step B: Run SAM detection on satellite image
            image_detections = self._time_stage(
                "sam_detection",
                detect_from_image,
                request.image,
                registration,
                point_prompts=point_prompts,
                use_sam=True,
            )

            # Check if SAM found usable roof segments
            if not image_detections.roof_segments:
                logger.info("SAM found no roof segments — falling back to LiDAR-primary")
                return None

            # Filter: only keep segments that contain elevated LiDAR points
            # This eliminates segments on roads, grass, trees, neighbors
            image_detections.roof_segments = self._filter_segments_by_lidar(
                image_detections.roof_segments,
                processed_lidar,
                request.image,
                registration,
            )

            if not image_detections.roof_segments:
                logger.info("No SAM segments survived LiDAR filtering — falling back")
                return None

            largest = max(image_detections.roof_segments, key=lambda s: s.area_m2)
            if largest.area_m2 < 10.0:
                logger.info(
                    "Largest SAM segment too small (%.1f m²) — falling back to LiDAR-primary",
                    largest.area_m2,
                )
                return None

            logger.info(
                "SAM found %d roof segments after LiDAR filtering (largest=%.1f m²)",
                len(image_detections.roof_segments),
                largest.area_m2,
            )

            # Step C: Drape LiDAR onto image-defined segments
            draped_planes = self._time_stage(
                "lidar_draping",
                drape_lidar,
                image_detections.roof_segments,
                processed_lidar,
            )

            if not draped_planes:
                logger.warning("LiDAR draping produced no planes — falling back")
                return None

            # Step D: Image-primary fusion
            fused = self._time_stage(
                "fusion",
                fuse_image_primary,
                draped_planes,
                image_detections.internal_edges,
                image_detections.features,
            )

            return fused, image_detections

        except Exception as e:
            logger.warning("Image-primary path failed: %s — falling back to LiDAR-primary", e)
            traceback.print_exc()
            return None

    def _try_image_engine(
        self,
        request: RoofParseRequest,
        registration: RegistrationTransform,
    ) -> tuple[list, dict]:
        """
        Run the image engine pipeline (pure image, no LiDAR dependency).

        Always returns (planes, result_dict) — zero planes is valid.
        Does not touch LiDAR data, gradient labels, or cell_labels_grid.
        """
        try:
            ie_config = make_config(
                profile=request.options.image_engine_profile,
            )
            result = self._time_stage(
                "image_engine",
                run_image_engine,
                request.image,
                registration,
                ie_config,
            )

            logger.info(
                "Image engine: %d planes, %d obstructions, %d dormers",
                len(result.planes), len(result.obstruction_candidates),
                len(result.dormer_candidates),
            )
            return result.planes, result.model_dump()

        except Exception as e:
            logger.error("Image engine failed: %s", e)
            traceback.print_exc()
            # Return empty result — image_engine always succeeds
            return [], {"source": "image_engine", "error": str(e)}

    def _run_lidar_primary(
        self,
        request: RoofParseRequest,
        registration: RegistrationTransform,
        processed_lidar: np.ndarray,
    ) -> list:
        """Run the legacy LiDAR-primary pipeline path."""
        # RANSAC plane extraction
        planes = self._time_stage(
            "plane_extraction",
            extract_planes,
            processed_lidar,
            request.options,
        )
        logger.info("Planes extracted (LiDAR): %d", len(planes))

        # OpenCV image detection (fallback)
        image_detections = self._time_stage(
            "image_detection",
            detect_from_image,
            request.image,
            registration,
            use_sam=False,
        )

        # IoU fusion
        fused = self._time_stage(
            "fusion",
            fuse_detections,
            planes,
            image_detections,
            registration,
        )

        return fused

    def _lidar_to_pixel_prompts(
        self,
        lidar_pts: np.ndarray,
        image_input,
        registration: RegistrationTransform,
    ) -> list[tuple[int, int]]:
        """
        Generate SAM point prompts ONLY from elevated LiDAR clusters (the building).

        Strategy:
        1. Find the median height of all points — only consider points well above it
        2. Grid the elevated points into 5m cells
        3. Take the highest point per cell as a SAM prompt
        This ensures prompts only land on the building, not on roads/grass/trees.
        """
        if len(lidar_pts) < 10:
            return []

        y = lidar_pts[:, 1]

        # Only use points in the top 40% of elevation — these are the building
        # (ground has been removed by preprocessing, but trees/low structures remain)
        height_threshold = np.percentile(y, 60)
        elevated_mask = y >= height_threshold
        elevated_pts = lidar_pts[elevated_mask]

        if len(elevated_pts) < 5:
            logger.info("Too few elevated LiDAR points for SAM prompts")
            return []

        prompts = []
        xz = elevated_pts[:, [0, 2]]
        ey = elevated_pts[:, 1]

        # Grid size: 5m cells
        grid_size = 5.0
        x_min, x_max = xz[:, 0].min(), xz[:, 0].max()
        z_min, z_max = xz[:, 1].min(), xz[:, 1].max()

        for gx in np.arange(x_min, x_max + grid_size, grid_size):
            for gz in np.arange(z_min, z_max + grid_size, grid_size):
                mask = (
                    (xz[:, 0] >= gx) & (xz[:, 0] < gx + grid_size) &
                    (xz[:, 1] >= gz) & (xz[:, 1] < gz + grid_size)
                )
                if mask.sum() < 3:
                    continue

                # Highest point in this cell
                cell_y = ey[mask]
                peak_idx = np.where(mask)[0][np.argmax(cell_y)]
                peak_x, peak_z = float(elevated_pts[peak_idx, 0]), float(elevated_pts[peak_idx, 2])

                # Convert local metres to pixel coords
                px, py = self._local_to_pixel(
                    peak_x, peak_z, image_input, registration,
                )
                if 0 <= px < image_input.width_px and 0 <= py < image_input.height_px:
                    prompts.append((int(px), int(py)))

        logger.info(
            "Generated %d LiDAR-guided SAM prompts (from %d elevated pts, threshold=%.1fm)",
            len(prompts), len(elevated_pts), height_threshold,
        )
        return prompts

    @staticmethod
    def _local_to_pixel(
        local_x: float,
        local_z: float,
        image_input,
        registration: RegistrationTransform,
    ) -> tuple[float, float]:
        """Convert local metre coordinates to image pixel coordinates."""
        scale = registration.scale if registration.scale > 0 else image_input.resolution_m_per_px
        px = (local_x / scale) + image_input.width_px / 2
        py = (local_z / scale) + image_input.height_px / 2
        return px, py

    def _filter_segments_by_lidar(
        self,
        segments: list,
        lidar_pts: np.ndarray,
        image_input,
        registration: RegistrationTransform,
        min_lidar_pts: int = 10,
        min_lidar_fraction: float = 0.3,
    ) -> list:
        """
        Filter SAM segments to only those containing enough elevated LiDAR points.

        This removes segments that cover roads, grass, trees, or neighbor properties.
        A valid roof segment should contain a significant number of the preprocessed
        LiDAR points (which are already ground-removed and height-filtered).

        Parameters
        ----------
        min_lidar_pts : int
            Minimum number of LiDAR points inside the segment's pixel mask.
        min_lidar_fraction : float
            Minimum fraction of the segment's area covered by LiDAR points
            (relative to what we'd expect given point density).
        """
        if len(lidar_pts) == 0:
            return segments

        scale = registration.scale if registration.scale > 0 else image_input.resolution_m_per_px
        h, w = image_input.height_px, image_input.width_px

        # Project all LiDAR points to pixel coordinates
        lidar_px = []
        for pt in lidar_pts:
            px, py = self._local_to_pixel(float(pt[0]), float(pt[2]), image_input, registration)
            lidar_px.append((int(round(px)), int(round(py))))

        lidar_px = np.array(lidar_px)

        filtered = []
        for seg in segments:
            if seg.mask is None:
                continue

            # Count LiDAR points that fall within this segment's mask
            count = 0
            for px_x, px_y in lidar_px:
                if 0 <= px_y < h and 0 <= px_x < w:
                    if seg.mask[px_y, px_x]:
                        count += 1

            if count >= min_lidar_pts:
                filtered.append(seg)
                logger.info(
                    "Segment %s KEPT: %d LiDAR pts inside (area=%.1f m²)",
                    seg.id, count, seg.area_m2,
                )
            else:
                logger.info(
                    "Segment %s REJECTED: only %d LiDAR pts (need %d), area=%.1f m²",
                    seg.id, count, min_lidar_pts, seg.area_m2,
                )

        return filtered

    @staticmethod
    def _validate_inputs(request: RoofParseRequest) -> None:
        """Basic sanity checks on the request payload."""
        if request.options.pipeline_mode != "image_engine":
            if not request.lidar.points and not request.lidar.file_path:
                raise ValueError("LiDAR input must provide either inline points or a file_path")
        if not request.image.url and not request.image.file_path:
            raise ValueError("Image input must provide either a url or a file_path")

    @staticmethod
    def _convert_lidar_to_local(request: RoofParseRequest) -> np.ndarray:
        """
        Convert raw LiDAR points from [lng, lat, elevation, class] format
        into local [x, y, z] coordinates where x/z are metres from design
        center and y is elevation.
        """
        if not request.lidar.points:
            return np.empty((0, 3))

        center_lat = request.design_center.lat
        center_lng = request.design_center.lng

        m_per_deg_lat = 111320.0
        m_per_deg_lng = 111320.0 * math.cos(math.radians(center_lat))

        # Compute focus radius from anchor dots or default
        if request.anchor_dots and len(request.anchor_dots) >= 2:
            dot_dists = [math.sqrt(d.x**2 + d.z**2) for d in request.anchor_dots]
            max_dot_dist = max(dot_dists)
            focus_radius = max_dot_dist + 5.0
            focus_radius = max(focus_radius, 12.0)
        else:
            focus_radius = 10.0

        raw = request.lidar.points
        converted = []
        all_local = []

        for pt in raw:
            if len(pt) < 3:
                continue
            lng, lat, elev = pt[0], pt[1], pt[2]
            local_x = (lng - center_lng) * m_per_deg_lng
            local_z = -(lat - center_lat) * m_per_deg_lat

            all_local.append((local_x, local_z, elev))

            dist = math.sqrt(local_x**2 + local_z**2)
            if dist > focus_radius:
                continue

            local_x += request.calibration_offset.tx
            local_z += request.calibration_offset.tz

            converted.append([local_x, elev, local_z])

        # Diagnostic logging
        if all_local:
            all_x = [p[0] for p in all_local]
            all_z = [p[1] for p in all_local]
            all_e = [p[2] for p in all_local]
            logger.info(
                "DIAG all points (%d): X=[%.1f, %.1f] Z=[%.1f, %.1f] Elev=[%.1f, %.1f]",
                len(all_local), min(all_x), max(all_x), min(all_z), max(all_z), min(all_e), max(all_e),
            )
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
