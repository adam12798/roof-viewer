# Roof Auto-Detection Troubleshooting Log

## Current State (2026-03-30)

### What works
- Pipeline runs end-to-end: LiDAR → plane extraction → CRM face output → 3D rendering
- RANSAC finds the main roof plane from LiDAR data
- Oriented bounding rectangle fitting produces 4-vertex CRM-compatible faces
- Calibration offset (auto-align or user calibration) is sent in payload

### Known Issues

#### 1. Alignment offset not applied correctly
The detected roof rectangle doesn't perfectly overlay the satellite imagery. The LiDAR point cloud in the 3D viewer IS correctly aligned (colored dots sit on the roof), but the Python pipeline output is shifted.

**Hypothesis**: The coordinate conversion in `orchestrator._convert_lidar_to_local()` may not match how the 3D viewer positions LiDAR. The viewer uses `geoToLocal()` for point positions AND applies `lidarPoints.position.x/z` as a mesh-level offset from `autoAlignLidar()`. The Python pipeline converts geo→local and adds calibration offset, but the math may differ.

**Key comparison needed**:
- `server.js:geoToLocal()` (~line 8028) — how the viewer converts lat/lng to local XZ
- `server.js:autoAlignLidar()` (~line 8615) — how the viewer auto-aligns LiDAR mesh
- `orchestrator._convert_lidar_to_local()` — how Python does the same conversion

#### 2. False positives (trees, neighbors)
Trees and neighbor structures sometimes survive all filters. Current filters:
- 10m radius from design center
- 3m ground removal threshold
- 0.20m max roughness (point-to-plane RMSE)
- 15m² minimum area
- DBSCAN eps=3.0, min_samples=20

**Questions**: Is roughness actually discriminating? Trees with flat-ish canopies could pass 0.20m. Is the radius centered on the right point after offset? Should we use elevation histogram to isolate the building's height band?

#### 3. Rectangle fitting quality
The convex hull → oriented bounding rectangle sometimes doesn't match the actual roof. This may be because the convex hull includes outlier points at the edges of the plane.

### Tuning History
| Parameter | Original | Current | Notes |
|-----------|----------|---------|-------|
| focus_radius | 35m (all) | 10m | Was detecting entire neighborhood |
| ground_threshold | 0.3m | 3.0m | Low objects now filtered |
| min_inliers | 50 | 80 | Fewer tiny fragments |
| min_area_m2 | none | 15m² | Rejects small tree clusters |
| max_roughness | none | 0.20m | Rejects bumpy surfaces (trees) |
| cluster_eps | 1.0 | 3.0 | Porch stays connected to main roof |
| merge angle | 5° | 10° | More aggressive coplanar merge |
| merge dist | 0.3m | 1.0m | More aggressive coplanar merge |
| distance_threshold | 0.15 | 0.20 | RANSAC inlier threshold |
