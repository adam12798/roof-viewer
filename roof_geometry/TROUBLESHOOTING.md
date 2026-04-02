# Roof Auto-Detection Troubleshooting Log

## Current State (2026-04-01, Session 31)

### Setup
- Python 3.12 required (Open3D doesn't support 3.13)
- Venv on local drive for speed: `~/roof_venv` (not on USB/SSD)
- Run: `cd roof_geometry && ~/roof_venv/bin/python3.12 -m uvicorn app:app --port 8000`
- Portable setup script: `bash setup.sh` on any new machine

### Pipeline Modes (v0.3.0)
- **`auto`** (default): tries gradient detection first, falls back to RANSAC
- **`gradient`**: gradient-based edge detection from LiDAR height data only
- **`ransac`**: original RANSAC + DBSCAN plane extraction
- **`image_primary`**: SAM-based image segmentation (experimental, noisy — see below)

### What works
- **Gradient detection** (new default): LiDAR height grid → edge detection → flood fill → SVD plane fit
  - Rule 1: Height drops >0.5m between neighbors → eaves, step flashing
  - Rule 2: Gradient sign reversal between opposite neighbors → ridges, valleys
  - Rule 3: Diagonal gradient direction change >30° → hip lines
  - Validated on synthetic gable roof (2 faces, pitch=21.8°, azimuths 90°/270°) and hip roof (4 faces)
- RANSAC + DBSCAN still available as fallback (`pipeline_mode="ransac"`)
- Pipeline runs end-to-end: LiDAR → plane extraction → CRM face output → 3D rendering
- Oriented bounding rectangle fitting produces 4-vertex CRM-compatible faces
- Calibration offset forwarded from frontend (auto-align or user calibration)
- Double-offset bug fixed: skips registration transform when calibration offset is non-zero

### Known Issues

#### 1. Real-world testing needed (PRIMARY)
Gradient detection validated on synthetic data but not yet tested on actual addresses. Focus radius tuning may still be relevant since gradient detection operates on the preprocessed (radius-filtered) point cloud.

**Test addresses**: 20 Meadow Dr, Lowell, MA / 42 Tanager St, Arlington, MA

#### 2. SAM/image-primary approach too noisy
Tried MobileSAM image segmentation in Session 31. Results: segments on trees, roads, driveways, neighbors with overlapping planes. Mitigations applied (elevated-only prompts, LiDAR overlap filter, tighter dedup) but still too noisy for production. Available via `pipeline_mode="image_primary"` for future experimentation.

#### 3. Alignment — LIKELY FIXED
Double-offset bug was found and fixed. When `calibration_offset` is non-zero, the registration transform is skipped. Needs re-verification with gradient pipeline output.

#### 4. Rectangle fitting quality
Convex hull → oriented bounding rectangle is standard but may not match complex roof shapes (L, T). Future: alpha shapes or concave hull.

### Tuning History

#### Gradient Detection Parameters (Session 31)
| Parameter | Default | Notes |
|-----------|---------|-------|
| grid_resolution | 0.5m | Matches Google Solar DSM grid |
| height_drop_threshold | 0.5m | Rule 1: min height diff for edge |
| direction_change_threshold | 90° | Rule 2: min angle for ridge/valley |
| angle_change_threshold | 30° | Rule 3: min angle for hip lines |
| min_edge_length | 2 cells (1m) | Remove noise edge fragments |
| min_face_area | 8 cells (2m²) | Remove noise faces |
| patch_size | 3×3 | Window for local gradient averaging |

#### RANSAC Parameters (Sessions 28-30)
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

### Session 31 Key Fixes
| Problem | Cause | Fix |
|---------|-------|-----|
| 0 edge pixels detected | `has_slope` threshold too high (0.05), smoothing averaged over ridges | Lowered to 0.02, removed smoothing |
| Ridge lines destroyed | `clean_edges()` used binary_erosion on 1px-wide lines | Removed erosion, keep only fragment removal |
| Ridges filled in | Morphological closing (dilate+erode) filled thin ridges | Removed closing entirely |
| Central-diff misses ridges | np.gradient() central differences smooth the exact ridge cell | Switched Rule 2 to sign-change approach on one-sided gradients |
| MPS float64 crash | MPS framework doesn't support float64 tensors | Force CPU device in model_manager.py |
| mobile-sam install fail | Package not on PyPI | Install from GitHub: `git+https://github.com/ChaoningZhang/MobileSAM.git` |
