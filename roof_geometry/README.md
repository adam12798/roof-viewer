# Roof Geometry Parser

A Python/FastAPI microservice that parses LiDAR point clouds and high-resolution satellite imagery into structured roof geometry. Designed to integrate with the Interrupt solar CRM, producing both a detailed roof topology graph and CRM-compatible face arrays for direct use in the 3D roof editor.

## Quick Start

```bash
cd roof_geometry
pip install -r requirements.txt
uvicorn app:app --reload --port 8000
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/roof/parse` | Run the full parsing pipeline. Accepts `RoofParseRequest`, returns `RoofParseResponse`. |
| `GET` | `/roof/parse/sample` | Returns a sample request JSON for testing. |
| `GET` | `/health` | Health check with pipeline version. |

## Architecture

See [architecture.md](architecture.md) for the full pipeline design.

**Pipeline stages:**

1. **Validate** inputs (anchor dots, LiDAR, image references)
2. **Register** coordinate frames using anchor dots (affine transform)
3. **Preprocess** LiDAR (filter ground, classify roof points, downsample)
4. **Extract planes** from the LiDAR point cloud (RANSAC + region growing)
5. **Detect features** from imagery (edges, ridges, obstructions)
6. **Fuse** LiDAR planes with image detections
7. **Build roof graph** (edges, intersections, adjacency, connected components)
8. **Score confidence** and flag items for human review
9. **Format output** (roof graph + CRM-compatible face array)

## Key Assumptions

- **LiDAR is the primary geometric truth.** Plane positions, heights, and pitches come from the point cloud.
- **Anchor dots are alignment-only.** They define the coordinate registration, not roof boundaries.
- **Imagery provides semantic refinement.** Edge sharpening, dormer detection, and obstruction classification use the satellite/aerial image.

## Known Limitations

- **No data = no detection.** If LiDAR coverage is missing for part of the roof, that area will have no planes.
- **Low-resolution imagery** degrades edge detection and dormer identification.
- **Flat roofs** are harder to segment into distinct planes when pitch differences are minimal.
- **Occluded areas** (under trees, shadows) produce lower-confidence detections.
- **Complex intersections** (multiple dormers, cross-gables) may require human review.

## V2 Roadmap

- SAM / GroundingDINO integration for zero-shot segmentation
- ML-based plane classification (replace rule-based type assignment)
- Real-time editing sync (push graph updates to CRM via WebSocket)
- Multi-building support (detect and separate multiple structures)
- Historical imagery comparison (change detection over time)
