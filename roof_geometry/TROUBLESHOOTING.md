# Roof Auto-Detection Troubleshooting Log

## Current State (2026-04-01, Session 32)

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
- **Anchor-seeded detection** (new default): uses calibration dots as ground truth
  - Traces uphill from anchors to find ridge → traces ridge both directions
  - Azimuth derived from ridge direction (perpendicular to ridge line)
  - Pitch derived from ridge-to-eave height drop
  - Face growth uses gradient consistency + running plane fit + 3x3 variance
  - Edge drop-off analysis: classifies boundaries as ground/roof/weak
  - Step-down detection: finds lower roofs (porches, additions) beyond eaves
  - Tree-over-roof inference: projects known plane through tree-blocked areas
  - Structure sistering: groups faces sharing a ridge into one roof structure
  - Ridge correction from eaves: uses face extent to fix tree-obscured ridge endpoints
  - Validated on synthetic gable (2 faces, pitch=22°, azimuths 180°/0°), gable+porch (3 faces), gable+tree (2 faces with inference)
- **Mandatory calibration**: user must complete calibration before design mode
- RANSAC + DBSCAN still available as fallback (`pipeline_mode="ransac"`)
- Pipeline runs end-to-end: LiDAR → plane extraction → CRM face output → 3D rendering
- Calibration offset forwarded from frontend (auto-align or user calibration)
- Double-offset bug fixed: skips registration transform when calibration offset is non-zero

### Known Issues

#### 1. Edge termination on real roofs (PRIMARY)
Real DSM data has dissolving edges where the roof fades rather than dropping off. Session 32 added plane deviation checks and gradient magnitude tracking but needs more real-world validation.

**Test addresses**: 20 Meadow Dr, Lowell, MA / 42 Tanager St, Arlington, MA

#### 2. Tree-over-roof inference accuracy
Tree inference projects the known plane through tree-blocked areas. Works on synthetic data but needs validation on real trees where canopy shape varies. Inferred faces get `confidence=0.6` and `needs_review=True`.

#### 3. SAM/image-primary approach too noisy
Tried MobileSAM image segmentation in Session 31. Still too noisy. Available via `pipeline_mode="image_primary"`.

#### 4. Rectangle fitting quality
Convex hull → oriented bounding rectangle may not match complex shapes (L, T).

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

### Session 32 Key Fixes
| Problem | Cause | Fix |
|---------|-------|-----|
| Faces flood into trees | No roughness check in face growth | Added 3x3 neighbor variance check (>0.15 = tree) |
| Edges dissolve past roof | Only checked height drops, not plane deviation | Added running plane fit; reject cells >0.3m off-plane |
| Ridge direction wrong | Coordinate swap: `(-dz, dx)` instead of `(-dx, dz)` | Fixed to `(-slope_dx, slope_dz)` in grid (row,col) space |
| Ridge traces into trees | No surface quality check during trace | Added 3x3 variance filter to ridge trace |
| Azimuth picks wrong side | `atan2` gives arbitrary perpendicular | Now picks perpendicular pointing toward anchor centroid |
| Eave trace overshoots | Stopped at 30% of peak height | Now stops at first >0.5m drop between consecutive cells |
| Ridge too short (3m vs 20m) | Slope averaged abs() killed sign info | Sample slope from off-ridge cells with clear one-sided gradient |
| Faces not grouped | No structure concept | Added `structure_id` + `_sister_faces()` post-processing |
| Trees over roofs missed | Face stops at tree boundary | Added `_infer_through_tree()` plane projection |

### Session 31 Key Fixes
| Problem | Cause | Fix |
|---------|-------|-----|
| MPS float64 crash | MPS framework doesn't support float64 tensors | Force CPU device in model_manager.py |
| mobile-sam install fail | Package not on PyPI | Install from GitHub: `git+https://github.com/ChaoningZhang/MobileSAM.git` |
