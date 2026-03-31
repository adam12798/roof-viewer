# Roof Geometry Detection Pipeline -- Architecture

## System Overview

The roof-geometry service is a Python/FastAPI microservice that automatically detects roof planes and topology from LiDAR elevation data and satellite imagery. It runs alongside the existing Node.js solar CRM application and produces output directly compatible with the CRM's `finalizeRoofFace()` renderer.

**Primary goal:** Turn raw Google Solar API DSM data + satellite imagery into editable roof face definitions with vertices, pitch, azimuth, and eave height -- the same format the CRM already consumes.

**Key principle:** LiDAR is the primary geometric truth source. Satellite imagery provides semantic refinement (edge sharpening, material classification). User-placed dots are used only for coordinate registration, never as roof boundary definitions.

---

## 9-Stage Pipeline

```
Stage 1    Stage 2          Stage 3         Stage 4          Stage 5
Ingest --> Registration --> LiDAR Pre- --> Plane         --> Image
Request    (dot-based)     processing     Extraction        Detection
                                          (RANSAC)          (edge/ridge)
   |
   v
Stage 9    Stage 8          Stage 7         Stage 6
Editable   Confidence   <-- Topology    <-- Fusion
Output <-- Scoring          Graph           (LiDAR+Image)
API                         Builder
```

### Stage 1: Ingestion

Accepts a JSON request containing:
- LiDAR DSM grid (177x177, 0.5m resolution from Google Solar API)
- Satellite image (RGB, geo-referenced)
- Design center (lat/lng)
- User-placed alignment dots (optional, for registration)
- Calibration offsets (tx/tz) if already known

### Stage 2: Dot-Based Registration

Aligns the LiDAR grid with the satellite image using user-placed reference dots.

- Dots are alignment markers ONLY -- they do NOT define roof boundaries
- Computes or refines tx/tz translation offsets (meters) between coordinate systems
- If calibration offsets are already provided, validates and applies them directly
- Output: a unified local coordinate frame (XZ meters from design center)

### Stage 3: LiDAR Preprocessing

Cleans and prepares the raw DSM elevation grid for plane fitting.

- Filters ground-level points (below eave threshold)
- Removes noise/outliers (vegetation, antennas, HVAC units)
- Optional: Gaussian smoothing to reduce sensor noise
- Computes surface normals for each grid cell
- Output: cleaned elevation grid + normal vectors

### Stage 4: Plane Extraction (RANSAC)

Segments the cleaned LiDAR point cloud into planar regions representing roof faces.

- RANSAC-based plane fitting to detect dominant planes
- Region growing to expand initial plane seeds
- Merges coplanar adjacent segments
- Computes per-plane: normal vector, pitch (degrees), azimuth (0-360), inlier points
- Output: list of detected plane segments with parameters

### Stage 5: Image Detection

Analyzes the satellite image for edge and ridge features that LiDAR may miss.

- Edge detection (Canny/structured edges) for roof boundaries
- Ridge/valley line detection via Hough transform or learned features
- Shadow analysis for approximate height cues
- Material/color segmentation for face differentiation
- Output: detected edge lines, ridge lines, and region segments in local XZ coords

### Stage 6: Fusion

Merges LiDAR plane segments with image-detected features.

- Snaps LiDAR plane boundaries to image-detected edges where they agree
- Splits LiDAR planes where image edges indicate boundaries the LiDAR missed
- Refines vertex positions using sub-pixel image edge localization
- Resolves conflicts: LiDAR geometry wins, image refines boundaries
- Output: refined plane segments with sharpened boundaries

### Stage 7: Topology Graph Builder

Constructs the roof topology -- how faces connect at ridges, hips, and valleys.

- Identifies shared edges between adjacent planes
- Classifies edges: ridge, hip, valley, eave, rake
- Builds adjacency graph of roof faces
- Detects roof sub-structures (dormers, cross-gables)
- Infers deleted sections for hip roofs (maps to CRM's `deletedSections` array)
- Output: topology graph with classified edges and face adjacency

### Stage 8: Confidence Scoring

Rates the reliability of each detected feature.

- Per-face confidence: how well LiDAR and image sources agree
- Per-vertex confidence: registration quality, edge sharpness
- Per-edge confidence: topology certainty
- Flags areas where manual review is recommended
- Output: confidence scores (0-1) attached to every face, vertex, and edge

### Stage 9: Editable Output API

Produces CRM-compatible roof face definitions and serves them via REST endpoints.

- Converts detected planes to `{x, z}` vertex arrays (local meters from design center)
- Computes pitch, azimuth, eave height per face
- Maps hip roofs to `sectionPitches[4]` and `deletedSections[4]` format
- Detects and encodes dormers in CRM dormer format
- Returns JSON directly consumable by `finalizeRoofFace()`

---

## Data Flow (ASCII)

```
                          +------------------+
                          |  Node.js CRM     |
                          |  (server.js)     |
                          +--------+---------+
                                   |
                            POST /detect
                            JSON payload:
                            - DSM grid
                            - satellite image
                            - design center
                            - alignment dots
                            - calibration tx/tz
                                   |
                                   v
+----------------------------------------------------------------------+
|                    Python FastAPI Service (port 8100)                 |
|                                                                      |
|  +------------+    +--------------+    +----------------+            |
|  | Ingestion  |--->| Registration |--->| LiDAR          |            |
|  | (validate) |    | (dot align)  |    | Preprocessing  |            |
|  +------------+    +--------------+    +-------+--------+            |
|                                                |                     |
|                          +---------------------+                     |
|                          |                                           |
|                          v                                           |
|                 +------------------+    +------------------+         |
|                 | Plane Extraction |    | Image Detection  |         |
|                 | (RANSAC)         |    | (edges/ridges)   |         |
|                 +--------+---------+    +--------+---------+         |
|                          |                       |                   |
|                          +----------+------------+                   |
|                                     |                                |
|                                     v                                |
|                              +------+------+                         |
|                              |   Fusion    |                         |
|                              +------+------+                         |
|                                     |                                |
|                                     v                                |
|                           +---------+----------+                     |
|                           | Topology Graph     |                     |
|                           | Builder            |                     |
|                           +---------+----------+                     |
|                                     |                                |
|                                     v                                |
|                           +---------+----------+                     |
|                           | Confidence Scoring |                     |
|                           +---------+----------+                     |
|                                     |                                |
|                                     v                                |
|                           +---------+----------+                     |
|                           | Output Formatter   |                     |
|                           +--------------------+                     |
+----------------------------------------------------------------------+
                                   |
                            JSON response:
                            - roofFaces[] with vertices,
                              pitch, azimuth, height
                            - sectionPitches, deletedSections
                            - dormers[]
                            - confidence scores
                                   |
                                   v
                          +------------------+
                          |  Node.js CRM     |
                          |  finalizeRoof    |
                          |  Face()          |
                          +------------------+
```

---

## Key Design Decisions

### 1. Dots are alignment-only, NOT roof boundaries

User-placed dots in the CRM are used exclusively for LiDAR-to-image registration (computing tx/tz offsets). They must never be interpreted as roof vertices or boundary markers. The geometry comes from LiDAR plane fitting and image edge detection.

### 2. LiDAR is primary geometric truth

When LiDAR and imagery disagree on plane geometry (pitch, location, extent), LiDAR wins. The DSM grid provides reliable 3D elevation data at 0.5m resolution. Imagery is used to refine boundaries and detect features that LiDAR resolution may miss (sharp edges, small dormers).

### 3. Imagery provides semantic refinement

Satellite imagery excels at detecting precise edge locations, material boundaries, and ridge lines. It complements LiDAR by sharpening boundaries and adding semantic context (is this edge a ridge or a valley?).

### 4. Confidence scoring resolves disagreements

Rather than hard rules for every conflict, the system assigns confidence scores when sources disagree. Low-confidence regions are flagged for manual review in the CRM, letting the user make the final call.

### 5. Output format matches existing CRM exactly

The service outputs roof faces in the same format `finalizeRoofFace()` already consumes:
- Vertices as `{x, z}` in local meters from design center
- `pitch` in degrees, `azimuth` 0-360
- `height` (eave height in meters)
- `sectionPitches[4]` for hip roofs
- `deletedSections[4]` booleans
- `dormers[]` array

No changes to the CRM are required to consume this output.

### 6. Separate Python microservice

The pipeline runs as a standalone FastAPI service, keeping heavy numerical/ML dependencies (numpy, scipy, scikit-learn, OpenCV) out of the Node.js process. Communication is via HTTP JSON.

---

## Module Responsibilities

| Module | File | Role |
|--------|------|------|
| **App** | `app.py` | FastAPI application, endpoint definitions, request routing |
| **Schemas** | `models/schemas.py` | Pydantic models for request/response validation |
| **Orchestrator** | `pipeline/orchestrator.py` | Runs the 9-stage pipeline in sequence, manages data flow |
| **Registration** | `pipeline/registration.py` | Dot-based LiDAR-to-image alignment, tx/tz computation |
| **LiDAR Processor** | `pipeline/lidar_processor.py` | DSM grid cleaning, normal computation, ground filtering |
| **Plane Extractor** | `pipeline/plane_extractor.py` | RANSAC plane fitting, region growing, plane parameter computation |
| **Image Detector** | `pipeline/image_detector.py` | Edge/ridge detection from satellite imagery |
| **Fusion** | `pipeline/fusion.py` | Merges LiDAR planes with image features, resolves conflicts |
| **Graph Builder** | `pipeline/graph_builder.py` | Builds roof topology graph, classifies edges, detects sub-structures |
| **Confidence** | `pipeline/confidence.py` | Scores reliability of faces, vertices, edges; flags review areas |

---

## Integration with Existing CRM

### Coordinate System

Both systems use the same local coordinate frame:
- Origin: design center (lat/lng converted via `geoToLocal()`)
- X-axis: east (meters)
- Z-axis: south (meters) -- note: Z is the horizontal ground axis, not vertical
- Y-axis: up (elevation in meters)

The Python service receives the design center and operates in this same XZ meter space.

### Communication Flow

1. CRM user triggers roof detection from the 3D viewer
2. Node.js `server.js` sends POST request to Python service (port 8100)
3. Payload includes DSM grid, satellite image, design center, calibration data
4. Python service runs the pipeline, returns JSON roof faces
5. CRM calls `finalizeRoofFace()` with each returned face to render in Three.js

### No CRM Modifications Required

The Python service is entirely additive. It reads data the CRM already has and returns data in the format the CRM already consumes. The only CRM-side change needed is a single fetch call to trigger detection.

---

## Assumptions and Constraints

1. **LiDAR source**: Google Solar API DSM at 0.5m resolution, 177x177 grid. The pipeline is designed for this specific resolution and grid size.

2. **Single-building scope**: Each request processes one building. Multi-building sites require separate requests.

3. **Coordinate precision**: Local XZ meter coordinates provide sub-meter precision, sufficient for solar panel layout.

4. **No persistent state**: The service is stateless. Each request contains all data needed for detection. No database required.

5. **Runtime target**: Detection should complete in under 5 seconds for a typical residential roof.

6. **Python 3.10+**: Uses modern Python features (type unions, match statements where appropriate).

7. **Dependencies**: numpy, scipy, scikit-learn (RANSAC), OpenCV (image processing), FastAPI, uvicorn. No deep learning models in v1 -- classical CV and geometric algorithms only.

8. **Existing calibration**: If the CRM provides tx/tz calibration offsets, the registration stage uses them directly rather than recomputing from dots.
