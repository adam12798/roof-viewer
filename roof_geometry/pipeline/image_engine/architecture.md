# Image Engine Module Architecture

## Overview

The image engine is a purely image-based roof analysis pipeline that operates
independently of LiDAR data. It detects roof geometry candidates, obstructions,
and dormers from satellite/aerial imagery alone.

## Pipeline Flow

```
ImageInput + RegistrationTransform
  │
  ├─ 1. preprocess.py ─────── PreprocessedImage (BGR, gray, CLAHE, denoised, HSV)
  │
  ├─ 2. edge_detector.py ──── Edge map (Canny binary) + ExtractedLine list (LSD + Hough)
  │                            Returns line_counts: {lsd, hough, combined, after_merge, after_filter}
  │
  ├─ 3. segmenter.py ─────── SegmentedRegion list → filtered → RoofPlane list
  │                            Returns rejection_counts per filter reason
  │                            Filters: size (≥8m²), aspect ratio (<10:1),
  │                                     compactness (≥0.15), centrality, vertex count
  │
  ├─ 4. obstruction_detector.py ── ObstructionCandidate list (metadata only)
  │
  ├─ 5. dormer_detector.py ─────── DormerCandidate list (metadata only)
  │
  ├─ 6. debug_visualization.py ─── DebugArtifact list (base64 PNG overlays)
  │                                  6 overlays: edges, lines, regions, obstructions, dormers, combined
  │
  └─ processor.py ──────────── ImageEngineResult (wraps all outputs)
                                Builds diagnostics report, logs it, includes in metadata
```

## Module Files

| File | Purpose |
|------|---------|
| `__init__.py` | Exports `run_image_engine`, `ImageEngineResult`, `ImageEngineConfig` |
| `schemas.py` | All data models: config, intermediates (`PreprocessedImage`, `ExtractedLine`, `SegmentedRegion`, `ObstructionCandidate`, `DormerCandidate`, `DebugArtifact`), and `ImageEngineResult` |
| `preprocess.py` | Load image from file/URL, CLAHE, Gaussian blur, grayscale, HSV |
| `edge_detector.py` | Canny edge detection, LSD + Hough line extraction, collinear merging |
| `segmenter.py` | Contour-based region segmentation, per-reason filtering, RoofPlane promotion |
| `obstruction_detector.py` | Adaptive threshold blob detection, shape-based classification (chimney/vent/skylight/pipe) |
| `dormer_detector.py` | Convexity defect analysis + shadow pattern detection for dormer candidates |
| `debug_visualization.py` | Overlay generation for all detection stages, base64 PNG encoding |
| `processor.py` | Top-level `run_image_engine()` wiring all sub-modules, diagnostics |

## Integration Point

The orchestrator (`pipeline/orchestrator.py`) routes to image_engine when
`pipeline_mode="image_engine"`. This bypasses all LiDAR stages entirely —
no LiDAR convert, no LiDAR preprocess, no gradient/RANSAC detection.
The image engine's RoofPlane objects feed into the standard `build_roof_graph()`
and `score_confidence()` pipeline. Zero planes is a valid result.

## RoofPlane Construction Rules

Image-engine planes always have:
- `source = "image_engine"`
- `needs_review = True`
- `confidence` capped at 0.5 (`min(0.5, region_confidence * 0.5)`)
- `plane_equation = PlaneEquation(a=0, b=1, c=0, d=0)` (flat placeholder)
- `pitch_deg = 0`, `is_flat = True`, `height_m = 0`, `elevation_m = 0`

Only regions passing all segmenter filters are promoted. Rejected regions
remain in `metadata.regions` for inspection but do not become RoofPlane objects.

## Diagnostics

The processor builds a diagnostics dict included at `image_engine_result.metadata.diagnostics`:

```json
{
  "segments_raw": 42,
  "segments_promoted": 5,
  "rejected_size": 28,
  "rejected_aspect_ratio": 1,
  "rejected_compactness": 6,
  "rejected_centrality": 2,
  "rejected_vertex_count": 0,
  "lines_lsd": 245,
  "lines_hough": 120,
  "lines_before_merge": 312,
  "lines_after_merge": 187,
  "lines_after_filter": 94,
  "obstruction_candidates": 3,
  "dormer_candidates": 1
}
```

All counts are also logged at INFO level as a structured report block.

## Separation Rules

This module does NOT:
- Import gradient_detector, plane_classifier, plane_extractor, or lidar_processor
- Depend on raw LiDAR points or gradient labels
- Modify cell_labels_grid or roof dot colours
- Call fusion.py
- Inject obstructions/dormers into RoofGraph directly (candidates are metadata only)
- Alter confidence.py or graph_builder.py behaviour

## Testing

Quick inline test (no server needed):
```python
from models.schemas import ImageInput, RegistrationTransform
from pipeline.image_engine import run_image_engine

image_input = ImageInput(
    file_path="/path/to/roof.png",
    width_px=500, height_px=400,
    geo_bounds=[37.77, -122.42, 37.78, -122.41],
    resolution_m_per_px=0.1,
)
registration = RegistrationTransform(
    affine_matrix=[[1,0,0],[0,1,0]],
    tx=0, tz=0, rotation_deg=0, scale=0.1,
    residual_error=0, method="test",
)
result = run_image_engine(image_input, registration)
print(result.metadata["diagnostics"])
```

Via API: POST to `/roof/parse` with `"options": {"pipeline_mode": "image_engine"}`.
LiDAR fields can be empty — validation is skipped for this mode.

## Web UI: Image Analysis Page

A standalone testing page at `GET /image-analysis` (Node server, `server.js`) provides
a dedicated UI for running the image engine without touching the LiDAR/Design Mode workflow.

### Access
- URL: `http://localhost:3001/image-analysis`
- Also linked from the nav drawer ("Image Analysis") on the home page
- Requires login (uses `requireAuth` middleware)

### Input
- **Image source**: file upload (converted to base64 data URL) or image URL
- **Metadata**: width/height px, resolution m/px, geo bounds (S,W,N,E), optional design center
- Submits to `POST /api/roof/auto-detect` with `pipeline_mode: "image_engine"`
- LiDAR payload is a dummy `[[0,0,0]]` — the orchestrator skips all LiDAR stages

### Results Display
- Summary metrics: regions, promoted planes, lines, ridges, obstructions, dormers, confidence bar
- Diagnostics table from `image_engine_result.metadata.diagnostics`
- Debug overlay images (base64 PNGs, click-to-enlarge lightbox)
- Candidate regions table (area, compactness, aspect ratio, material hint, promoted status)
- Line segments, obstruction candidates, dormer candidates, ridge candidates tables
- Pipeline timings breakdown

### Debug Output Panel
- **Original image** + **combined/regions overlay** side by side
- **Diagnostics JSON** formatted view with **Copy JSON** button
- **Planes Summary** table (index, area_m2, confidence, vertex count) — max 5 rows
- **Copy Debug Report** button — copies plaintext report (image ref, overlay list, diagnostics JSON, planes summary)

### Isolation
This page is completely separate from Design Mode. It does not:
- Modify the LiDAR 3D viewer or color-dot rendering
- Affect the `autoDetectRoof()` flow
- Share any frontend state with the design page

## Future: Fusion Integration

TODO: A future fusion module can compare image_engine results with LiDAR results
by matching planes by boundary overlap (IoU). The `source` field on RoofPlane
enables this comparison.
