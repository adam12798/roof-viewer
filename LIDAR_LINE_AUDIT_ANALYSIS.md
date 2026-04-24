# LiDAR Point Classification + Line Audit Fusion — Deep Audit

**Date:** 2026-04-23
**Purpose:** Understand how the LiDAR point classification engine works and how it can improve ridge/eave/rake detection in the Line Audit.

---

## 1. Files / Code Areas Inspected

| File | Purpose |
|------|---------|
| `roof_geometry/pipeline/gradient_detector.py` L31-44 | CellLabel enum (13 labels) |
| `roof_geometry/pipeline/tree_detector.py` L1561-2287 | Sweep tracer core: strip walking, ridge detection, eave detection |
| `roof_geometry/pipeline/color_classifier.py` L31-137 | V1 classifier: sweep + RANSAC fusion, ridge/valley/eave |
| `roof_geometry/pipeline/color_classifier_v2.py` L63-348 | V2 classifier: 8-direction voting for UNSURE resolution |
| `roof_geometry/pipeline/plane_classifier.py` | Step edge, obstruction, ridge edge dot promotion |
| `roof_geometry/pipeline/orchestrator.py` L60-269 | Pipeline orchestration |
| `roof_geometry/models/schemas.py` L29-542 | RoofParseResponse, RoofEdge, EdgeType, CellLabel |
| `roof_geometry/app.py` L60-67 | FastAPI `/roof/parse` endpoint |
| `server.js` L10178-10225 | LABEL_COLORS + `recolorLidarByClassification()` |
| `server.js` L15916-16180 | `autoDetectRoof()` flow + ridge line rendering |
| `server.js` L24835-24851 | `/api/roof/auto-detect` proxy to port 8000 |
| `ML/ml_ui_server.py` L802-1085 | Line Audit endpoint (current, ML-only) |
| `ML/ml_engine/core/stages/semantics.py` | ML semantic edge classifier |

---

## 2. Current Point-Classification Architecture

### Two Completely Separate Systems

**System A: Roof Geometry Pipeline** (port 8000, Python/FastAPI)
- Lives in `roof_geometry/` directory
- Triggered by "Auto detect roof" button → `/api/roof/auto-detect` → `localhost:8000/roof/parse`
- Uses LiDAR point cloud + calibration anchor dots
- Runs sweep tracer + RANSAC plane extraction + color classification
- Returns `cell_labels_grid`, `grid_info`, `ridge_line`, `sweep_ridge_line`, `roof_graph` (with typed edges)
- Labels are per-point (13 types) projected onto a 2D grid

**System B: ML Pipeline** (port 5001, Python/Flask)
- Lives in `ML/` directory
- Triggered by "ML Auto Build" button → `/api/ml/auto-build` → `localhost:5001/api/crm/auto-build`
- Uses satellite image + DSM from LiDAR
- Runs trained neural models (UNet, Mask R-CNN, ResNet-18)
- Returns `roof_faces` (4-vertex rectangles) + `semantic_edges` (classified line segments)
- Line Audit uses ONLY this system currently

**Key finding: These two systems do not talk to each other.** The Line Audit endpoint calls only the ML pipeline. The rich LiDAR point classification from the Roof Geometry pipeline is completely unused by Line Audit.

### Inputs to Point Classification

| Input | Source | Used by |
|-------|--------|---------|
| Raw LiDAR points (N x 3) | Google Solar DSM API | Both systems |
| Calibration anchor dots | User-placed control points | Roof Geometry only |
| Satellite image | Google Maps Static API | ML pipeline only |
| DSM grid | Built from LiDAR | Both (independently) |

### Where Labels Are Stored

- **Per-point array**: `labels: np.ndarray` shape (N,) of `CellLabel` ints (0-12)
- **2D grid**: `cell_labels_grid: list[list[int]]` — majority-vote projection of per-point labels
- **Returned in**: `RoofParseResponse.cell_labels_grid` + `RoofParseResponse.grid_info`
- **Visible on client**: Yes — `recolorLidarByClassification()` colors the 3D point cloud
- **NOT available to Line Audit today**: The Line Audit endpoint does not call the Roof Geometry service

---

## 3. How Each Label Can Support Line Extraction

### RIDGE_DOT (label=5) — High value for ridge lines

**Current meaning**: Point is within 0.15m of the ridge line where two roof planes meet. Strong confidence — passed linearity enforcement (PCA fit, outliers >0.20m demoted).

**Line audit use**: RIDGE_DOT points form a natural ridge line. They're already PCA-fitted in the sweep tracer. The `sweep_ridge_line` in the response is literally a line fitted through RIDGE_DOT points. Additional ridges from plane-plane intersections produce more RIDGE_DOT clusters. Each cluster = a ridge line candidate.

**Extraction method**: Cluster RIDGE_DOT points by proximity (DBSCAN or connected components via KDTree). Fit PCA line per cluster. Each cluster → one ridge line candidate.

### NEAR_RIDGE (label=6) — Moderate value, supports ridge width

**Current meaning**: Point is 0.15-0.30m from the ridge line. Softer candidate — used when RIDGE_DOT count is low.

**Line audit use**: Expands ridge support band. Can improve ridge endpoint detection (RIDGE_DOT may be sparse at ends). Use as supporting evidence, not primary.

**Extraction method**: Merge NEAR_RIDGE points into nearby RIDGE_DOT clusters to extend ridge line endpoints.

### RIDGE_EDGE_DOT (label=9) — High value for rake detection

**Current meaning**: Ridge point at a gable end where ground is visible within 2m perpendicular to the ridge. This is where the ridge TERMINATES at the building edge.

**Line audit use**: RIDGE_EDGE_DOT marks where the ridge meets the roof perimeter. The direction from the RIDGE_EDGE_DOT downslope to the nearest EAVE_DOT (or GROUND transition) defines a RAKE line. This is the single most useful signal for rake detection.

**Extraction method**: From each RIDGE_EDGE_DOT, trace along the roof boundary (label transition ROOF→GROUND/UNSURE) downslope. The traced path = rake line candidate.

### EAVE_DOT (label=8) — High value for eave lines

**Current meaning**: Bottom edge of roof slope where height drops to ground. Detected via three paths: (1) sweep tracer strip termination, (2) plane boundary adjacent to ground, (3) V2 directional voting.

**Line audit use**: EAVE_DOT points trace the eave line directly. Cluster them, fit a line per cluster, and each cluster is an eave line candidate.

**Extraction method**: Cluster EAVE_DOT points. Fit polyline per cluster. Each cluster → one eave line candidate. Eaves should be roughly perpendicular to the slope direction.

### VALLEY_DOT (label=10) — Direct valley lines

**Current meaning**: Point within 0.15m of a concave plane-plane intersection (both planes slope toward the line).

**Line audit use**: Direct valley line extraction, same as RIDGE_DOT. Cluster + PCA fit.

### STEP_EDGE (label=11) — Step transition lines

**Current meaning**: Height discontinuity at ROOF→LOWER_ROOF transitions. Marks the step-flash edge.

**Line audit use**: Step edge line candidates. Useful for multi-level roofs. Cluster + fit line per cluster.

### ROOF (label=2) — Supporting context

**Current meaning**: Main sloped roof surface.

**Line audit use**: Defines the "interior" of roof planes. Boundaries between ROOF and non-ROOF labels define edges. Slope direction (from local gradient) helps classify boundary edges as eave vs rake.

### LOWER_ROOF (label=3) — Supporting context

**Current meaning**: Secondary roof surface >1.5m below main roof (porch, addition).

**Line audit use**: ROOF→LOWER_ROOF boundaries are step edges. LOWER_ROOF→GROUND boundaries are additional eaves.

### FLAT_ROOF (label=4) — Supporting context

**Current meaning**: Pitch <5deg surface.

**Line audit use**: Flat roof perimeter edges are all eaves (no rakes on flat roofs). Simple boundary extraction.

### GROUND (label=1) — Rejection / boundary signal

**Current meaning**: Below roof surface, adjacent to building.

**Line audit use**: ROOF→GROUND transitions define the roof perimeter. Combined with slope direction, these transitions classify as eave (perpendicular to slope) or rake (parallel to slope).

### TREE (label=7) — Rejection signal

**Current meaning**: Elevated canopy, high variance, non-planar.

**Line audit use**: Reject/downweight lines near TREE clusters. Lines crossing TREE regions are suspect.

### OBSTRUCTION_DOT (label=12) — Rejection signal

**Current meaning**: Small non-planar cluster (chimney, vent).

**Line audit use**: Exclude from line candidates. Lines terminating at obstructions are not roof edges.

### UNSURE (label=0) — Ambiguity signal

**Current meaning**: Insufficient evidence for classification.

**Line audit use**: Lines passing through UNSURE regions should be downweighted. High UNSURE density = low confidence zone.

---

## 4. Rake Detection Analysis

### Why Rakes Are Hard

Rakes are the sloped roof edges at gable ends — they run parallel to the slope direction (uphill-downhill), unlike eaves which run perpendicular. Neither the ML semantic edges nor the current sweep tracer explicitly detect rakes well:

- **ML semantic edges**: The ResNet-18 classifier can label edges as "rake" but has limited training data for this class, and rakes are geometrically similar to other boundary edges.
- **Sweep tracer**: Detects RIDGE_EDGE_DOT (gable ridge endpoints) and EAVE_DOT (bottom edges), but does not trace the diagonal line between them.

### How LiDAR Labels Can Detect Rakes

**Method 1: Boundary trace from RIDGE_EDGE_DOT to EAVE_DOT**

The RIDGE_EDGE_DOT label explicitly marks where the ridge terminates at a gable end. From there:
1. Identify the outward direction (toward GROUND, away from ROOF)
2. Walk downslope along the ROOF→GROUND boundary
3. The traced boundary IS the rake line
4. Terminate at the nearest EAVE_DOT cluster

This is the most direct path to rake detection.

**Method 2: ROOF/non-ROOF boundary + slope direction**

For any ROOF boundary segment:
1. Compute the local slope direction from nearby ROOF points (gradient of height grid)
2. Compute the boundary direction (tangent along the ROOF/GROUND transition)
3. `dot = abs(boundary_direction . slope_direction)`
4. If `dot > 0.5` → the boundary runs parallel to slope → **rake**
5. If `dot < 0.5` → the boundary runs perpendicular to slope → **eave**

This works without RIDGE_EDGE_DOT and catches rakes on hip roofs too.

**Method 3: Outline polygon edge classification**

The building outline (from ML or from ROOF boundary extraction) gives the perimeter. Each perimeter edge can be classified as eave or rake using the same dot-product method with the nearest plane's azimuth.

### Are Rakes Explicitly Classified Today?

**In the Roof Geometry pipeline**: No. The `EdgeType` enum includes `rake` but the sweep tracer + color classifier do not assign it. RIDGE_EDGE_DOT is the closest — it marks gable endpoints but doesn't trace the rake edge.

**In the ML pipeline**: Yes. `SemanticEdge.class_label` can be "rake" from the neural classifier, but the confidence is often low for rakes vs other boundary edges.

### What Data Is Needed for Robust Rake Detection

1. **RIDGE_EDGE_DOT points** (from color classifier) → rake startpoints
2. **EAVE_DOT points** (from sweep tracer + color classifier) → rake endpoints  
3. **ROOF→GROUND boundary** (from label grid) → rake path
4. **Local slope direction** (from height grid gradient or plane azimuth) → eave/rake discrimination
5. **ML semantic_edge with class_label="rake"** → confirmation/boost

---

## 5. ML + LiDAR Fusion Recommendation

### Principle: LiDAR Proposes, ML Confirms, Either Can Stand Alone

The two signal sources have different strengths:

| Signal | Strength | Weakness |
|--------|----------|----------|
| ML semantic_edges | Good at classifying edge type (ridge vs eave vs rake) | Poor at finding short/small edges, depends on image quality |
| LiDAR point labels | Good at finding ALL edges including small ones, uses real 3D geometry | Poor at classifying edge type without plane context |

### Fusion Rules

**Rule 1: ML+LiDAR agreement → high confidence**
If an ML semantic_edge and a LiDAR-derived line candidate overlap (midpoints within 2m, angles within 20deg), boost confidence: `fused_confidence = max(ml_conf, lidar_conf) + 0.15`.

**Rule 2: ML-only with confidence >= 0.45 → keep as-is**
ML semantic_edges that don't overlap with any LiDAR candidate keep their original confidence and classification. They may represent edges the LiDAR missed (e.g., areas with sparse point coverage).

**Rule 3: ML-only with confidence 0.25-0.45 → keep as uncertain**
Weak ML edges without LiDAR support stay as `uncertain` type. They're visible in debug but not promoted.

**Rule 4: LiDAR-only strong lines → show even without ML**
LiDAR clusters of 5+ RIDGE_DOT/EAVE_DOT/VALLEY_DOT points that form a coherent line (PCA residual < 0.3m) should be shown as candidates even without ML confirmation. Type is assigned by label (RIDGE_DOT → ridge, EAVE_DOT → eave, etc.). Confidence = `0.4 + 0.1 * min(point_count / 10, 1.0)`.

**Rule 5: LiDAR-only rakes from boundary trace → show with moderate confidence**
Rake candidates derived from RIDGE_EDGE_DOT → boundary trace → EAVE_DOT should be shown with confidence 0.35-0.55 depending on boundary clarity. Type = "rake".

**Rule 6: Disagreement → prefer ML classification, LiDAR geometry**
If ML says "eave" and LiDAR says "ridge" for overlapping lines, keep ML's classification but use LiDAR's endpoint geometry (more precise in 3D). Flag as `review_disagree` in debug.

---

## 6. Proposed Scoring Model

### Per-Line Candidate Scores

```
boundary_score        = f(boundary clarity, label transition strength)
                        Range 0-1. High when ROOF→GROUND transition is sharp.

lidar_label_score     = f(supporting point count, label type match)
                        Range 0-1. RIDGE_DOT×10 + NEAR_RIDGE×3 per metre of line.
                        Normalized: min(total_support / 20, 1.0)

slope_geometry_score  = f(slope consistency, gradient magnitude)
                        Range 0-1. High when local slope is consistent along the line.
                        For ridges: both sides should slope away.
                        For eaves: one side slopes, other side drops.

ml_semantic_score     = f(ML edge confidence, ML edge class match)
                        Range 0-1. Direct from SemanticEdge.confidence if overlapping.
                        0 if no ML edge overlaps.

roof_rule_score       = f(geometric constraints)
                        Range 0-1. Checks: line length > 1m, not crossing obstructions,
                        endpoints near known features, angle consistency with neighbors.

final_line_confidence = weighted combination:
  ridge:  0.25 * lidar + 0.25 * ml + 0.20 * slope + 0.15 * boundary + 0.15 * rule
  eave:   0.30 * boundary + 0.25 * lidar + 0.20 * ml + 0.15 * slope + 0.10 * rule
  rake:   0.30 * boundary + 0.25 * slope + 0.20 * lidar + 0.15 * ml + 0.10 * rule
  valley: 0.25 * lidar + 0.25 * ml + 0.25 * slope + 0.15 * boundary + 0.10 * rule
```

### Decision Rules

| Type | Promote if | Demote to uncertain if |
|------|-----------|----------------------|
| **ridge** | lidar_label_score > 0.3 OR ml_semantic_score > 0.45 | final < 0.30 |
| **eave** | boundary_score > 0.4 AND dot_with_slope < 0.5 | final < 0.25 |
| **rake** | boundary_score > 0.3 AND dot_with_slope > 0.5 AND (RIDGE_EDGE_DOT nearby OR ml confirms) | final < 0.30 |
| **valley** | lidar_label_score > 0.3 AND slope_geometry shows concave | final < 0.35 |
| **hip** | ml_semantic_score > 0.45 OR (ridge-like but not at peak) | final < 0.35 |
| **uncertain** | No strong signal from any source | always keep in debug |

---

## 7. Debug Fields to Add

### Build-Level Debug (v3_line_audit)

```
lidar_classification_available: bool
lidar_point_count: int
lidar_label_counts: {
  ROOF: int, RIDGE_DOT: int, NEAR_RIDGE: int, RIDGE_EDGE_DOT: int,
  EAVE_DOT: int, VALLEY_DOT: int, STEP_EDGE: int, GROUND: int,
  LOWER_ROOF: int, FLAT_ROOF: int, TREE: int, OBSTRUCTION_DOT: int, UNSURE: int
}
lidar_ridge_clusters: int
lidar_eave_clusters: int
lidar_rake_candidates: int
ml_semantic_edge_count: int
fusion_matched_count: int        // ML+LiDAR overlap
fusion_ml_only_count: int
fusion_lidar_only_count: int
fusion_disagree_count: int
```

### Per-Line Debug

```
line_id: str
type_guess: str                  // initial classification before fusion
final_type: str
confidence: float
length_m: float
source: "ml_only" | "lidar_only" | "fused"
ml_support: {
  edge_id: str | null
  class_label: str | null
  confidence: float | null
}
lidar_support: {
  supporting_label: str          // RIDGE_DOT, EAVE_DOT, etc.
  point_count: int
  mean_distance_to_line_m: float
}
boundary_support: {
  roof_side_label: str
  non_roof_side_label: str
  transition_sharpness: float
}
slope_support: {
  local_slope_deg: float
  dot_with_line_direction: float  // eave≈0, rake≈1
}
rejected_reason: str | null
```

---

## 8. Recommended Phased Implementation

### Phase 1: Expose Point-Classification Debug to Line Audit

**Goal**: Make the roof geometry pipeline's classification data available to the line audit flow without changing classification logic.

**What to do**:
1. When the Line Audit button is clicked, call BOTH services:
   - `/api/crm/line-audit` (ML pipeline, port 5001) — already done
   - `/api/roof/auto-detect` (Roof Geometry, port 8000) — new call
2. Forward the LiDAR + anchor dot payload to `/api/roof/auto-detect`
3. Return `cell_labels_grid`, `grid_info`, and `roof_graph.edges` alongside `audit_lines`
4. Add label count summary to debug output

**Why first**: Zero new classification logic. Just plumbing. Immediately tells us how much LiDAR data is available and whether labels are useful per-property.

**Risk**: Roof Geometry service must be running (port 8000). Need graceful fallback if unavailable.

### Phase 2: Derive Ridge/Eave/Valley Lines from Classified Points

**Goal**: Extract line candidates from RIDGE_DOT, EAVE_DOT, VALLEY_DOT point clusters.

**What to do**:
1. From the `cell_labels_grid`, extract connected components of each edge label
2. For each RIDGE_DOT cluster: fit PCA line → ridge candidate
3. For each EAVE_DOT cluster: fit polyline → eave candidate
4. For each VALLEY_DOT cluster: fit PCA line → valley candidate
5. Add these as `source: "lidar_label"` lines in the audit output

**Why second**: Uses existing labels directly. No new classification. Tests whether LiDAR-derived lines add value vs ML-only.

### Phase 3: Derive Rakes from Boundary + Slope Direction

**Goal**: Detect rake edges by tracing ROOF/GROUND boundaries and classifying by slope direction.

**What to do**:
1. Extract ROOF→GROUND boundary segments from the label grid (marching squares or contour tracing — `_extract_boundary_segments()`)
2. For each boundary segment, compute slope direction from the height grid gradient at nearby ROOF cells
3. Classify: `dot(boundary_direction, slope_direction) > 0.5` → rake, else → eave
4. RIDGE_EDGE_DOT nearby boosts rake confidence
5. Add as `source: "boundary_trace"` lines

**Why third**: This is the first piece of genuinely new classification logic. It addresses the specific gap (missing rakes) that prompted this analysis.

### Phase 4: Fuse LiDAR-Derived + ML Semantic Edges

**Goal**: Merge the two signal sources using the fusion rules from section 5.

**What to do**:
1. Match LiDAR-derived lines to ML semantic_edges by proximity (midpoint < 2m, angle < 20deg)
2. For matched pairs: boost confidence, prefer ML classification + LiDAR geometry
3. For ML-only: keep as-is
4. For LiDAR-only: keep with moderate confidence
5. Compute `final_line_confidence` using the scoring model from section 6

**Why fourth**: Requires both Phase 2 and Phase 3 to be working. This is where the real quality improvement happens.

### Phase 5: High-Recall Mode with Weak/Uncertain Candidates

**Goal**: Add a debug mode that shows ALL candidates including weak ones, without using them for construction.

**What to do**:
1. Add `high_recall: bool` option to line audit request
2. When enabled, lower all confidence thresholds by 50%
3. Show weak candidates as dashed lines or thinner lines
4. Include all rejected candidates in debug with `rejected_reason`
5. Color uncertain lines distinctly (cyan, as current)

**Why last**: Polish. Only useful after the core fusion is working and we need to diagnose missed edges.

---

## 9. Risks / Unknowns

1. **Roof Geometry service availability**: Port 8000 must be running. Currently only started manually. Line Audit must degrade gracefully if unavailable (ML-only mode, which is what we have today).

2. **Anchor dot dependency**: The sweep tracer works best with user-placed calibration anchor dots. If none exist, it falls back to "highest LiDAR point as peak" which may not find all ridges. The ML pipeline does not need anchor dots.

3. **Coordinate frame alignment**: The Roof Geometry pipeline uses local XZ coordinates aligned via `calibration_offset`. The ML pipeline uses image-centre coordinates with a separate origin shift. These frames must be aligned when fusing candidates. Both start from the same design pin (lat/lng), so the offset should be the same calibration transform.

4. **Performance**: Running both pipelines adds latency. ML pipeline: ~100s on CPU. Roof Geometry pipeline: ~5-15s for sweep tracer. Total could be ~2 minutes. Consider running in parallel.

5. **Label grid resolution**: The `cell_labels_grid` uses 0.5m cells. At this resolution, narrow features (rakes, valleys) may span only 1-2 cells, making boundary extraction noisy. Per-point labels (N-array) are more precise but not currently exposed to the client.

6. **No rake label exists**: Neither the `CellLabel` enum nor the `SemanticEdge` class has a dedicated rake signal from LiDAR. Rakes must be DERIVED from boundary + slope direction. This is Phase 3 work.

---

## 10. Exact Next Implementation Prompt

The next step is **Phase 1: Expose Point-Classification Debug to Line Audit**.

The prompt should instruct:

1. In `server.js` `/api/line-audit` endpoint: after calling ML `/api/crm/line-audit`, also call Roof Geometry `/roof/parse` with the same LiDAR + anchor dot payload (if available). Wrap in try/catch — if Roof Geometry service is down, continue with ML-only results.

2. From the Roof Geometry response, extract:
   - `cell_labels_grid` + `grid_info` (for future phase 2 extraction)
   - `roof_graph.edges` (already-typed edges: ridge, valley, hip, eave, rake, step_flash)
   - Label counts (bincount of cell_labels_grid)

3. Merge Roof Geometry edges into `audit_lines`:
   - For each `roof_graph.edge` with `edge_type` in (ridge, eave, rake, valley, hip):
     - Convert `start_point` / `end_point` to the same coordinate frame as ML lines
     - Add as `source: "roof_geometry"` with `confidence: edge.confidence`

4. Add `lidar_classification` section to debug output with label counts.

5. On the client side: if `cell_labels_grid` is present in the response, optionally call `recolorLidarByClassification()` to show the colored points alongside the line overlay.

6. Ensure Line Audit still works if Roof Geometry service is unavailable (ML-only fallback).
