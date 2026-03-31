# Roof Auto-Detection Troubleshooting Log

## Current State (2026-03-30, Session 30)

### Setup
- Python 3.12 required (Open3D doesn't support 3.13)
- Venv on local drive for speed: `~/roof_venv` (not on USB/SSD)
- Run: `cd roof_geometry && ~/roof_venv/bin/python3.12 -m uvicorn app:app --port 8000`

### What works
- Pipeline runs end-to-end: LiDAR → plane extraction → CRM face output → 3D rendering
- RANSAC + DBSCAN finds roof planes from LiDAR data
- Open3D 0.19.0 installed and used for RANSAC/outlier removal
- Oriented bounding rectangle fitting produces 4-vertex CRM-compatible faces
- Calibration offset forwarded from frontend (auto-align or user calibration)
- Double-offset bug fixed: skips registration transform when calibration offset is non-zero
- Near-vertical plane rejection added (walls/fences filtered out)
- Diagnostic logging shows bounding box of all/elevated LiDAR points vs focus radius

### Known Issues

#### 1. Focus radius needs tuning (PRIMARY BLOCKER)
At 10m: south half of roof detected correctly, but north half of a ~19m (62ft) house gets clipped.
At 15m: trees, road, neighbors all included → too many false positive planes.

**Diagnostic added**: Pipeline now logs the XY bounding box of all points and elevated (top 30%) points, plus whether the focus radius is sufficient. Next step: read these logs and pick the right radius.

**Test address**: 20 Meadow Dr, Lowell, MA

#### 2. Alignment — LIKELY FIXED
Double-offset bug was found and fixed. When `calibration_offset` is non-zero, the registration transform is skipped (it was applying a second correction on top of the calibration). Needs re-verification once radius is correct.

#### 3. False positives (trees, neighbors)
Current filters:
- Focus radius (10m default, tuning in progress)
- 2m ground removal threshold (was 3m)
- 0.20m max roughness
- 15m² minimum area
- DBSCAN eps=2.0, min_samples=20 (was eps=3.0)
- Near-vertical plane rejection (up_component < 0.3)

#### 4. Rectangle fitting quality
Convex hull → oriented bounding rectangle is standard but may not match complex roof shapes (L, T). Future: alpha shapes or concave hull.

### Tuning History
| Parameter | Original | Current | Notes |
|-----------|----------|---------|-------|
| focus_radius | 35m (all) | 10m | 15m too wide, 10m clips large houses |
| ground_threshold | 0.3m | 2.0m | Was 3.0m, lowered to preserve eave points |
| min_inliers | 50 | 60 | Was 80, lowered after tightening cluster eps |
| min_area_m2 | none | 15m² | Rejects small tree clusters |
| max_roughness | none | 0.20m | Rejects bumpy surfaces (trees) |
| cluster_eps | 1.0 | 2.0 | Was 3.0, tightened to separate tree/roof |
| merge angle | 5° | 10° | More aggressive coplanar merge |
| merge dist | 0.3m | 1.0m | More aggressive coplanar merge |
| distance_threshold | 0.15 | 0.20 | RANSAC inlier threshold |
| RANSAC iterations | 1000 | 1500 | Better plane fits |
