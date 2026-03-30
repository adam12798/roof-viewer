# Solar CRM — Build Progress

## Overview
A solar proposal and CRM web app built with Node.js + Express, served locally at `http://localhost:3001`. Data is stored in `data/projects.json`. Google Maps server-side APIs handle geocoding and satellite imagery. 3D design tool uses Three.js with LiDAR point cloud.

---

## Completed — 2026-03-30 (Session 27)

### Roof Edge Dragging
- [x] **Draggable edges** — click and drag any roof edge to slide it along its perpendicular axis; both vertices move together, preserving edge length and orientation
- [x] **Edge hover highlight** — hovering near an edge turns it cyan with a grab cursor; moving away restores original color
- [x] **Click-anywhere detection** — proximity-based hit testing (10px threshold) lets users grab any point along the edge, not just the midpoint handle
- [x] **Edge midpoint handles** — cyan box handles at each edge midpoint, visually distinct from white corner spheres
- [x] **Perpendicular constraint math** — edge direction → 90° rotation → dot-product projection constrains movement to the normal axis only

### Dormer Improvements
- [x] **Realistic default sizing** — updated to average US dormer: 2.4m (8ft) wide × 1.5m (5ft) deep × 1.1m (3.5ft) walls (was 1.2m × 0.9m × 0.6m)
- [x] **Perpendicular orientation** — `getRoofSlopeAngle()` now computes actual perpendicular to the roof face's eave edge using vertex geometry instead of relying on azimuth property

### Critical Bug Fix: Pointer Events
- [x] **Switched all drag handlers from mouse* to pointer* events** — OrbitControls was calling `preventDefault()` on `pointerdown`, which suppressed all `mousedown` events. This fix enables corner handle dragging, edge dragging, tree dragging, and space-bar panning that were previously broken.

---

## Completed — 2026-03-30 (Session 26)

### Dormer System
- [x] **Edit mode banner** — amber "Edit SmartRoof" toolbar appears at top when entering roof face edit mode with "Insert dormer" section and 3 type icons (Gable, Hip, Shed)
- [x] **Dormer placement mode** — ghost preview dormer follows cursor, always visible; snaps to roof surface and auto-orients downslope when hovering over a roof section; falls back to ground plane when off-roof; click to stamp down
- [x] **3 dormer types with full 3D geometry**:
  - Gable: triangular gable walls + two sloped roof planes meeting at ridge
  - Hip: 4 sloped faces (2 end triangles + 2 side trapezoids), shorter ridge
  - Shed: single sloped plane + vertical back wall
- [x] **Dormer properties panel** — right-side panel with shape selector (Gable/Hip/Shed radio list with checkmarks), pitch controls (single pitch for Gable/Shed, Side + Front for Hip), duplicate and delete buttons
- [x] **Draggable handles** — 4 white corner spheres on each dormer, symmetric dragging (opposite corner mirrors to keep rectangle shape)
- [x] **Dormer selection** — click dormer to select (cyan highlight), click away to deselect; raycasts against dormer meshes
- [x] **Parent face binding** — dormers stored in `face.dormers[]`, rebuild automatically when parent face height/pitch/vertices change
- [x] **Keyboard shortcuts** — Esc exits placement mode, Delete/Backspace removes selected dormer
- [x] **Undo/redo integration** — dormers included in roof snapshots, fully restorable
- [x] **Save/load persistence** — dormers serialized with roof faces in project data

### ViewCube Improvements
- [x] **North indicator** — red compass arrow on ViewCube ring, rotates with compass to always indicate north
- [x] **Double-tap auto-select** — double-tapping a roof face now enters edit mode AND selects the tapped section (turns blue) in one step

---

## Completed — 2026-03-30 (Session 25)

### Tree Interaction Overhaul
- [x] **Hover highlight** — trees turn white on hover, revert on mouse-out
- [x] **Selection highlight** — selected trees turn teal (`#00bfa5`), matching roof selection color
- [x] **Multi-selected hover** — hovering a selected tree goes white, returns to teal on mouse-out
- [x] **Click-to-deselect** — clicking empty space deselects tree and closes property panel
- [x] **Cmd+click multi-select fix** — first selected tree now promoted into `multiSelectedTrees` so it stays selected when Cmd+clicking additional trees
- [x] **Marquee box-select** — click-drag on empty space draws a dashed teal rectangle; all trees whose center falls inside get selected
  - Uses capture-phase pointer events to fire before OrbitControls
  - Disables orbit controls during drag, re-enables on release
  - Tracks `marqueeEnd` during move to avoid coordinate issues on pointerup
  - `marqueeJustFinished` flag prevents click handler from immediately deselecting
- [x] **Removed red bulk bar** — hidden with `display:none!important`, element IDs preserved for JS compatibility

### Bug Fixes
- [x] **Tree LiDAR height snap** — `getTreeHeightFromLidar()` now includes `lidarPoints.position.y` offset (was ~0.75 scene units too tall)
- [x] **Hip roof ridge line** — `buildHipRoofLines()` both-trapezoids-deleted case now draws Mf→Mb at `ridgeY` instead of `baseY`

---

## Completed — 2026-03-29 (Session 24)

### 2D Map View Removal
- [x] Removed Google Maps JavaScript API (`drawing` + `geometry` libraries)
- [x] Removed `initMap()`, `map` instance, `drawingManager`, `segments[]`, `selectedSegment`
- [x] Removed 2D panel fill (`fillPanels`, `clearPanels`, `addDimensionLabels`, `addAzimuthArrow`)
- [x] Removed 2D ViewCube (CSS transform orbit), zoom controls (tile + CSS deep zoom)
- [x] Removed `serializeSegments()`, `getCurrentStats()`, `updateStats()`, `selectSegment()`
- [x] Stubbed out shade overlay map polygon functions (`drawSolarRoofSegments`, `setShadeOverlay`, `clearShadeOverlay`, `highlightSolarSegment`)
- [x] Cleaned up orphaned CSS (`.map-3d-scene`, `.map-3d-plane`, `#map`)
- [x] Preserved server-side `/api/geocode` and `/api/satellite` endpoints (no JS API dependency)
- [x] Preserved shade analysis panel UI + data loading
- [x] Design save/load updated — no longer serializes/restores 2D segments

### UX Fix — Input Focus Blur
- [x] Clicking the 3D canvas now blurs any focused input/textarea/select
- [x] Fixes spacebar pan and other keyboard shortcuts being captured by side panel inputs

---

## Completed — 2026-03-29 (Session 23)

### Manual Roof Drawing — Rectangle Snap + Hip Roof
- [x] **Best-fit rectangle snap** — `fitRectangle()` computes oriented minimum bounding rectangle from clicked points
- [x] **Auto-close polygon** — clicking near the first vertex (within 1m) closes and finalizes; first handle highlights cyan when close
- [x] **Satellite texture overlay** — roof face meshes use the satellite image texture with computed UVs instead of solid color fill
- [x] **Fixed ShapeGeometry Z-flip** — negated Z in shape construction to correct fill/edge misalignment (`-verts[i].z`)
- [x] **Hip roof wireframe** — `buildHipRoofLines()` generates 5 interior lines on each rectangle:
  - 4 hip lines from each corner at 45° to the nearest ridge endpoint
  - 1 ridge line running parallel to the longest sides, elevated at 10° pitch
  - Ridge height = `(shortSide/2) * tan(10°)`
  - Creates 4 interior areas: 2 trapezoids (long sides) + 2 triangles (short ends)
- [x] Hip lines rebuild on vertex drag, removed on face delete
- [x] Stored satellite texture globally (`satTexture`) for roof face reuse

### SmartRoof Fixes
- [x] **Fixed marching squares contour tracing** — case 6 (left boundary) had wrong direction, added direction tracking for ambiguous cases
- [x] **Replaced marching squares with convex hull boundary** — `cellsToBoundary()` now extracts boundary cells and computes convex hull (more robust for irregular DSM shapes)
- [x] **LiDAR offset compensation** — click coordinates adjusted by auto-align/calibration offset before grid lookup; boundary vertices re-offset for scene alignment
- [x] **Flood fill max radius** — 15m constraint prevents leaking to trees/neighbors
- [x] **Tighter elevation tolerance** — reduced from 1.0m to 0.6m between adjacent cells
- [x] `traceContour()` now accepts separate rows/cols parameters

---

## Completed — 2026-03-29 (Session 22)

### CAD Modeling Engine — SmartRoof
- [x] Roof face drawing state variables and data model (`roofFaces3d[]` array)
- [x] **Manual roof face drawing** — click vertices on 3D ground plane, double-click/Enter to complete polygon
- [x] Semi-transparent colored face meshes (THREE.ShapeGeometry) with white edge outlines
- [x] Draggable white vertex handle spheres — click and drag to reshape faces, edges update live
- [x] Edge measurement labels (THREE.Sprite text) showing distances in feet on every edge
- [x] Face selection — click face to highlight cyan, right panel shows "Edge & face" properties
- [x] Right panel: editable Pitch, Azimuth, Eave Height + read-only Area (ft²) and edge lengths
- [x] Delete face via Delete/Backspace key or red "Delete Face" button in properties panel
- [x] Roof drawing mode banner (gold/orange, matches Aurora style)
- [x] Wired left panel Roof submenu items: Smart roof (R), Manual roof face, Flat roof with IDs and click handlers
- [x] Keyboard shortcuts: Escape (cancel/deselect), Enter (complete polygon), Delete (remove face)
- [x] Mutual exclusion: roof drawing mode deactivates tree mode and vice versa
- [x] Persistence: roof faces serialize/deserialize with design save/load (`roofFaces` in PUT endpoint)

### SmartRoof Auto-Detect (v1 → v2 → v3)
- [x] v1: Solar API rectangle placement (replaced)
- [x] v2: RANSAC plane detection + convex hull (replaced — grabbed trees, planes too noisy)
- [x] v3: **Elevation flood-fill** from click point + Solar API segment partitioning
  - Click on building → flood-fill DSM grid following roof surface (±0.6m neighbor tolerance, 15m max radius)
  - Stops at roof edges where elevation drops to ground
  - Boundary extracted via convex hull of boundary cells (replaced marching squares)
  - Douglas-Peucker simplification + orthogonalization (snap near-90° angles)
  - Splits footprint into faces using Solar API segment centroids (Voronoi partition)
  - Each face gets pitch/azimuth from Google's roofSegmentStats
- [x] Detection algorithms: `buildElevGrid()`, `floodFillRoof()`, `cellsToBoundary()`, `splitBySegments()`
- [x] Supporting algorithms: `douglasPeucker()`, `convexHull2d()`, `ransacPlanes()`, `traceContour()`, `orthogonalize()`
- [x] Stored `lidarRawPoints` globally for detection access
- [x] Detect mode UX: banner "Click on the building to detect roof faces", crosshair cursor, Esc to exit

### ViewCube Sensitivity
- [x] 3D viewcube tilt sensitivity increased from 0.3 to 0.8
- [x] 2D map viewcube tilt sensitivity increased from 0.3 to 1.5

---

## Completed — 2026-03-29 (Session 21)

### LiDAR Calibration Rewrite
- [x] Fixed pixel-to-meter conversion in `calibPinsToWorld` — was computing in pixel space, causing 100x scale blowup
- [x] Fixed DSM vs RGB bbox mismatch — server returns separate `rgbBbox` from RGB GeoTIFF dimensions
- [x] Calibration now moves LiDAR point cloud instead of satellite ground plane
- [x] Replaced similarity transform with translation-only offset (no scale/rotation needed)
- [x] Added `version: 2` calibration format; auto-load ignores old corrupt data
- [x] Cleared all legacy pixel-space calibration data from projects.json

### Cache Busting
- [x] `BUILD_VERSION` timestamp + `/api/version` endpoint + auto-reload on stale page
- [x] Aggressive no-cache headers on design page

### LiDAR Point Cloud
- [x] Grid density: 121×121 → 177×177 (14.6k → 31.3k points)
- [x] Point size: 2.0 → 6.6 with sizeAttenuation (world-space, grows on zoom)
- [x] Ground plane at Y=-0.5 to prevent z-fighting
- [x] Ground point filter: removes points within 1m of minimum elevation
- [x] Aurora-style color gradient: cyan → green → yellow → orange → red (height-based)
- [x] Solid circle texture with alphaTest cutout
- [x] Starting camera zoom increased 50% (closer default view)

### 3D ViewCube — Fully Functional
- [x] Draggable orbiting: pointer capture for responsive drag even over cube faces
- [x] Face clicks: snap to preset views, keep tilt for side views
- [x] Double-click: reset to top-down
- [x] Repositioned above zoom controls, z-index 50, stopPropagation for event isolation
- [x] Fixed vertical drag direction (was inverted vs 2D cube)
- [x] Fixed left/right face click azimuths (were swapped vs 2D cube)
- [x] Fixed compass ring: N at top, S at bottom
- [x] Tilt range: 0°–90° in 2D design mode, 0°–80° in 3D LiDAR mode

---

## Completed — 2026-03-28 (Session 20)

### UI Cleanup & Navigation
- [x] Moved Calibrate icon from bottom draw-toolbar to top toolbar2 (next to LiDAR button)
- [x] Calibrate icon shows default color when uncalibrated, green (#22c55e) when complete
- [x] Removed redundant project name and settings ellipsis from sub-header bar
- [x] Sun logo on home page opens nav drawer; on all other pages navigates to home (`/`)

### Geocode API
- [x] Added missing `GET /api/geocode?address=` endpoint (was returning HTML 404, causing JSON parse error)
- [x] Uses Google Geocoding API, returns `{ lat, lng, formatted_address }`

### New Project — Draggable Map Pin
- [x] Red teardrop pin appears centered on satellite image after address geocode
- [x] Pin fades in with smooth opacity transition
- [x] Fully draggable via mouse (grab/grabbing cursor) and touch
- [x] Pin positioned via percentage-based CSS for responsive layout

### Dashboard — Energy Usage Display
- [x] Dashboard energy usage card now shows actual saved values (annual energy, avg monthly energy)
- [x] Values computed server-side from `project.energyUsage` array
- [x] Shows "—" when no usage data has been entered

---

## Completed Features

### Infrastructure
- [x] Node.js / Express local server (`server.js`)
- [x] `.env` file for secure API key storage (never exposed to browser)
- [x] File-based JSON database (`data/projects.json`) — no external DB required
- [x] All Google API calls proxied server-side (key never sent to client)
- [x] GitHub repo: [adam12798/roof-viewer](https://github.com/adam12798/roof-viewer)

### Google APIs Enabled
- [x] Geocoding API — converts addresses to lat/lng
- [x] Maps Static API — satellite image proxy
- [x] Maps JavaScript API — interactive maps with markers

---

### Page 1 — New Project Form (`/new`)
- [x] Split layout: form on left, visual panel on right
- [x] Top bar with "← Projects" back link and "New project" title
- [x] Property address field with live geocoding (600ms debounce + Enter key support)
- [x] Resolved address confirmation shown in green below input
- [x] Customer name, email, phone fields
- [x] Project name field
- [x] Residential / Commercial property type toggle
- [x] Organization + Team dropdowns (UI only, placeholder)
- [x] Cancel button returns to CRM
- [x] Create button disabled until address is geocoded; activates and goes dark on success
- [x] Right panel: custom SVG iceberg illustration (small white cap above waterline, large dark navy submerged body, stars, shimmer lines)
- [x] Satellite image fades in over iceberg once address is resolved
- [x] Draggable red map pin appears centered on satellite image after geocode
- [x] On Create: POSTs to `/api/projects`, saves to JSON, redirects to project detail page

---

### Page 2 — CRM Home (`/`)
- [x] Dark purple left rail with icon buttons (projects, list, settings, account)
- [x] Sun logo icon at top of rail
- [x] "＋ New project" black button top right
- [x] "Projects" page title
- [x] Live search bar — filters rows as you type across name, customer, address
- [x] Filter button with full dropdown panel:
  - Tabs: Type, Status, Teams, Organizations, General
  - Search within filter options
  - Checkboxes for each option
  - Apply filter (filters table by type: Residential/Commercial)
  - Clear resets all filters
  - Filter button turns purple when active
  - Closes on outside click
- [x] Multi-select checkboxes on every row
- [x] Select-all checkbox in header
- [x] Bulk action bar appears when rows are selected ("X selected / Deselect all")
- [x] Table columns: Name, Updates, Address, Type (icon), Customer name, Status (progress bar), Organization, Team, Last updated, Assignee (avatar)
- [x] Row hover reveals "···" menu button with dropdown:
  - Rename (prompt + PATCH `/api/projects/:id/rename`)
  - Reassign (placeholder)
  - Archive (DELETE with confirmation)
  - Delete (DELETE with confirmation, red text)
- [x] Empty state with link to create first project
- [x] Clicking a row navigates to project detail page

---

### Page 3 — Project Detail (`/project/:id?tab=`)
- [x] Top header: "← Projects" breadcrumb + "Team Sunshine / Customer Name"
- [x] Sub-header: progress bar (1/6), "Remote Assessment Completed" status dropdown, assignee dropdown, Design mode + Sales mode buttons
- [x] Left sidebar: customer name + address at top with "···" menu, then full nav
- [x] Tab navigation via URL query param (`?tab=`)

#### Dashboard tab (`?tab=dashboard`)
- [x] Customer profile card (name, email, phone, property type, address)
- [x] Energy usage card (placeholder fields)

#### Designs tab (`?tab=designs`) — default
- [x] Three cards in a row:
  - **Site Model Service** — description + "Create new request" button
  - **Drone mapping** — "Beta" badge, description, "Import files" button
  - **Design 1** — "Sales Mode" link → opens design/pin screen, "···" menu, Cost/Offset/Size stats, edited timestamp
- [x] Pagination (Prev / 1 / Next)

#### Energy Usage tab (`?tab=energy`)
- [x] Upload utility bill drop zone (drag & drop UI)
- [x] Pre-solar rate selector + Escalation % input + "View pre-solar rate" button
- [x] Post-solar rate selector + "View post-solar rate" button
- [x] Input method dropdown (monthly estimate)
- [x] kWh / $ unit toggle
- [x] Location dropdown
- [x] "Edit existing appliances" button
- [x] Monthly input grid (January – December)
- [x] Energy usage (kWh) / Energy bill ($) sub-tabs
- [x] Annual energy + Avg. monthly stats display
- [x] Bar chart placeholder

#### Customer Profile tab (`?tab=customer`)
- [x] Full customer detail card

#### Notes tab (`?tab=notes`)
- [x] Two-column layout: rich text editor (left) + attachments dropzone (right)
- [x] Formatting toolbar: Bold, Italic, Underline, Strikethrough, Bullet list, Numbered list, Link
- [x] Auto-save (800ms debounce) via PATCH `/api/projects/:id/notes` with "Saved" indicator
- [x] Attachments drag & drop / click to browse with file list display

#### Other tabs
- [x] Documents — full documents tab with Proposals, Agreements, System design, Plan Sets

---

### Page 4 — Design / Pin Screen (`/design`)
- [x] Full-screen interactive Google Maps satellite view (zoom 20)
- [x] Custom teardrop SVG pin — rounded top, pointy bottom, blue with white center dot
- [x] Pin drops with animation on confirmed house location
- [x] Pin is fully draggable — coordinates update live in sidebar
- [x] Dark sidebar: Solar Design header, live lat/lng coordinate display, "Design tools coming soon" placeholder
- [x] Header: "← Back" button, address + live coordinates
- [x] Sub-header: progress bar, status, assignee, Design mode / Sales mode buttons

---

### Page 5 — Sales Mode (`/sales?projectId=`)
- [x] Full-screen dark-themed interactive slideshow (6 slides)
- [x] Slide 1: Welcome — logo, customer name, address, date
- [x] Slide 2: Your Home — satellite image + property details
- [x] Slide 3: Energy Profile — stats + canvas bar chart (or empty state with estimates)
- [x] Slide 4: Solar Design — system specs grid + satellite close-up
- [x] Slide 5: Your Savings — before/after bills, payback period, 25-year savings
- [x] Slide 6: Next Steps — 5-step process + CTA card
- [x] Arrow buttons, clickable dots, keyboard navigation (ArrowLeft/Right, Space, Escape)
- [x] All 3 entry points wired (dashboard, sub-header, design page)

---

### CRM Search & Filter
- [x] Unified `filterRows()` combines text search with all filter tabs
- [x] All 5 filter tabs functional: Type, Status, Teams, Organizations, General
- [x] General filters: Has/No assignee, Created this week/month
- [x] Live count ("Showing X of Y") updates on search + filter changes
- [x] Filter button turns purple when active

---

### Energy Usage — Bar Chart
- [x] Live canvas bar chart on energy usage tab
- [x] Orange bars with rounded tops, diagonal hatch pattern for estimates
- [x] Auto-scaled Y-axis grid with kWh labels
- [x] Annual energy estimate distributes across months with seasonal weighting
- [x] Chart auto-hides/shows based on data presence

---

### API Endpoints
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/geocode?address=` | Geocode address → lat/lng |
| GET | `/api/satellite?lat=&lng=&zoom=` | Proxy satellite image |
| POST | `/api/projects` | Create new project |
| DELETE | `/api/projects/:id` | Delete project |
| PATCH | `/api/projects/:id/rename` | Rename project |
| PATCH | `/api/projects/:id/notes` | Save project notes |
| GET | `/api/projects/:id/calibration` | Get saved calibration transform |
| PUT | `/api/projects/:id/calibration` | Save calibration transform + control points |

---

---

## Completed — 2026-03-28 (Session 19)

### Calibration UI Overhaul — Side-by-Side Pin Placement
- [x] Redesigned calibration overlay from tabbed single-canvas to **side-by-side dual-panel layout**
- [x] Left panel: Satellite image (loaded directly from `/api/satellite` endpoint — no 3D viewer dependency)
- [x] Right panel: LiDAR image (rendered from point cloud, waits for data with loading indicator)
- [x] Each panel has **independent zoom/pan** (scroll to zoom, drag to pan, +/-/Fit buttons)
- [x] Blue numbered pins on satellite, orange numbered pins on LiDAR
- [x] Per-panel pin count display ("X pins") + combined pair count in header
- [x] Header with instructions: "Place matching pins on house corners in both images"
- [x] Canvas sizing via `requestAnimationFrame` to fix 0x0 canvas layout bug
- [x] Pin coordinates stored as image-pixel coords, converted to world coords on confirm

### Calibrate Button — Visual State Indicators
- [x] Calibrate button in drawing toolbar shows **amber pulse** when uncalibrated (`.needs-calibration`)
- [x] Shows **green** when calibrated (`.calibrated`)
- [x] State set server-side via `hasCalibration` variable passed to template
- [x] `applyCalibration()` toggles button class on successful calibration
- [x] Removed mistakenly-added extra calibrate button from top navigation bar

### Auto-Calibration Flow
- [x] Uncalibrated designs auto-open calibration overlay on page load (800ms delay)
- [x] On LiDAR build: checks for saved calibration, applies silently or auto-prompts
- [x] Calibrate button click auto-activates 3D viewer if not already active

---

## Completed — 2026-03-28 (Session 16)

### Tree Placement Tool
- [x] Trees menu item (left panel Site tab) activates tree placement mode (click item or press T)
- [x] Click ground to place center, drag outward to set canopy width
- [x] Height auto-snaps to LiDAR DSM elevation (max height within canopy radius)
- [x] Tree mesh: brown cylinder trunk + green sphere canopy, scaled by vertExag
- [x] Escape exits tree mode; switching to draw tools also exits
- [x] Elevation grid stored globally from LiDAR fetch for real-time height queries

### ViewCube
- [x] Bottom face: "BTM" → "BOT"
- [x] Cardinal directions: front=S, back=N, left=W, right=E (die-on-table writing perspective)

### Known Issue — Pan Sensitivity (UNRESOLVED)
- OrbitControls `panSpeed` has no visible effect (tested 0.01 to 4.0)
- Camera: FOV 50, starting position Y=80, perspective camera
- Multiple overlapping mousedown handlers on canvas3d may be conflicting
- Spacebar+drag custom pan has separate scale (`dist / 60000`)
- Needs full investigation — see ROADMAP.md Session 16 notes for details

---

## Completed — 2026-03-28 (Session 19)

### Calibrate Icon — Deferred Green State
- [x] Calibrate button no longer starts green on page load
- [x] Removed server-side `tb2-calibrated` class from initial button render
- [x] Removed green class from `applyCalibration()` (fires on saved data load)
- [x] Green class only applied when user actively completes calibration via save handler

### ViewCube — Face Label Reorientation
- [x] Front face (default visible): TOP (was S)
- [x] Back face: BOT (was B)
- [x] Top face: N (was TOP)
- [x] Bottom face: S (was BOT)
- [x] Updated both 2D and 3D viewcube instances

### Settings — Teams Page
- [x] New `/settings/teams` route with dedicated Teams page
- [x] "Add team" button (purple, top right) matching "Add user" button pattern
- [x] Teams table built dynamically from user data (team field aggregation)
- [x] Search bar with filter icon
- [x] Add team modal with team name and organization fields
- [x] All sidebar "Teams" links updated from `/settings` to `/settings/teams`

### LiDAR Viewer — Legend Removed
- [x] Removed LiDAR legend overlay (ground/building/vegetation/high point color key) from 3D viewer

---

## Completed — 2026-03-28 (Session 18)

### Calibration System — Restored After Accidental Revert
Previous sessions (13, 15) built a full calibration system that was lost when `git checkout -- server.js` reverted uncommitted changes. Rebuilt from scratch based on PROGRESS.md specs and saved calibration data in projects.json.

#### Calibration API
- [x] `GET /api/projects/:id/calibration` — returns saved calibration transform + control points
- [x] `PUT /api/projects/:id/calibration` — saves calibration data to project JSON

#### Calibration Overlay UI
- [x] Full-screen overlay with tab switcher: LiDAR Image / Satellite Image / Side by Side
- [x] Each tab renders to a canvas with zoom (scroll wheel, +/- buttons, Fit reset, up to 10x) and pan (Space+drag)
- [x] Crosshair overlay for precise point placement
- [x] Numbered markers (orange for LiDAR, blue for satellite) scale inversely with zoom
- [x] Dynamic point count display + Confirm button (enabled at 4+ pairs)
- [x] Clear and Skip buttons

#### Calibration Process Flow
- [x] Auto-prompts calibration on first LiDAR load when no saved calibration exists
- [x] Saved calibrations silently applied on subsequent visits (no re-prompt)
- [x] Calibrate button in drawing toolbar — click auto-loads LiDAR if needed, then opens overlay
- [x] Calibrate button icon turns green when calibration is active/applied

#### Calibration Transform
- [x] Least-squares 4-DOF similarity transform solver (translation + uniform scale + rotation)
- [x] Transform applied to ground plane (position.x/z, scale, rotation.y) for satellite-LiDAR alignment
- [x] Control points saved with transform for future reference

#### LiDAR Image Rendering
- [x] Offscreen canvas renders LiDAR point cloud to 1024x1024 image with classification colors
- [x] Satellite ground plane texture extracted as calibration image
- [x] World coordinate mapping preserved for pixel-to-world conversion in both images

---

## Running the App

```bash
cd "project Interrupt"
npm start
# → http://localhost:3001
```

## Stack
- **Backend:** Node.js, Express, node-fetch, dotenv
- **Frontend:** Vanilla JS, server-rendered HTML
- **Storage:** Local JSON file (`data/projects.json`)
- **APIs:** Google Geocoding, Maps Static, Maps JavaScript

---

---

## Completed — 2026-03-27 (Session 4)

### Server Configuration
- [x] Changed default port from 3000 → 3001 (code + `.env`) to avoid conflicts with other local projects

### CRM — Row Height
- [x] Increased CRM table row vertical padding (12px → 18px) for better readability

### Energy Usage → Design Page Data Flow
- [x] `PATCH /api/projects/:id/energy` — saves monthly kWh array to project data
- [x] `GET /api/projects/:id/energy` — returns saved energy usage
- [x] Energy tab auto-saves on input, loads saved data on page load, updates annual/monthly stats live
- [x] Design page reads energy usage from project data (no more hardcoded values)
- [x] Production chart uses real usage data with dynamic Y-axis scaling
- [x] Energy offset % calculated and shown in top bar stats + production panel
- [x] Energy usage section in production panel shows annual/monthly stats when data exists

### Design Tool — 3D ViewCube
- [x] Full 3D ViewCube control (bottom-left) with N/S/E/W compass labels and red north arrow
- [x] Drag cube to orbit: left/right spins heading, up/down tilts view (inverted Y for natural feel)
- [x] Click cube faces to snap to preset views (TOP, N, S, E, W)
- [x] Side face clicks maintain current tilt angle, only change heading direction
- [x] Hover highlights cube faces gray
- [x] Double-click cube to reset to top-down north-up
- [x] Vertical tilt slider alongside ViewCube (0°–80°)
- [x] CSS 3D transforms on map plane (flat paper metaphor for future CAD/LIDAR model)

### Design Tool — 3D Navigation
- [x] Spacebar + drag to pan/slide the 3D perspective view over the ground
- [x] Scroll wheel zoom works when view is tilted
- [x] Grab/grabbing cursor feedback during space-pan

### Design Tool — Production Panel
- [x] Moved production/energy panel from bottom drawer to right-side slide-in panel (380px)
- [x] Stats bar click toggles panel open/closed (was open-only before)

### Design Tool — Settings Panel
- [x] Restored settings gear icon in top-right toolbar
- [x] Settings panel starts closed on initial load (was auto-open before)
- [x] Click gear to toggle settings panel open/closed

### Design Tool — Map Stability
- [x] Locked Google Maps base layer (no drag/scroll/double-click zoom) for a still design surface
- [x] Zoom still available via +/- buttons and scroll wheel (handled separately)
- [x] Reduced topbar height (48px → 42px) and toolbar2 height (40px → 34px) for more design workspace
- [x] Default zoom reduced from 21 → 20 for ~150ft context around the house

### API Endpoints (new)
| Method | Route | Description |
|--------|-------|-------------|
| PATCH | `/api/projects/:id/energy` | Save monthly energy usage |
| GET | `/api/projects/:id/energy` | Get saved energy usage |

---

## Completed — 2026-03-27 (Session 5)

### CRM Fixes
- [x] Fixed three-dots row menu not appearing (`.table-wrap` had `overflow: hidden` clipping the dropdown)
- [x] Address column now wraps text instead of truncating with ellipsis — full address always visible
- [x] Wired up project detail sidebar menu: Rename, Assign to team, Delete, Archive all functional
- [x] Added `PATCH /api/projects/:id/reassign` and `PATCH /api/projects/:id/archive` endpoints

### Google Solar API Integration
- [x] `GET /api/solar/building-insights` — fetches roof segments, sun hours, pitch, azimuth, area
- [x] `GET /api/solar/data-layers` — fetches DSM/flux GeoTIFF layer URLs
- [x] `GET /api/solar/geotiff` — proxies GeoTIFF downloads with proper content-type validation

### Shade Analysis (Design Tool)
- [x] "Shade" button in design toolbar opens floating shade analysis panel
- [x] Auto-fetches solar data from Google Solar API for the property
- [x] Displays: annual sun hours, peak flux, total roof area (ft²), segment count
- [x] Monthly sun hours bar chart with seasonal distribution
- [x] Roof segment list with pitch, direction, area, and sun hours per segment
- [x] Three overlay modes: None, Annual flux (green-to-red), Shade map (purple intensity)
- [x] Click any segment in the list to highlight and pan to it on the map
- [x] Roof segment polygons rendered as Google Maps overlays color-coded by solar exposure

### 3D CAD Viewer (Design Tool)
- [x] "3D CAD" button in design toolbar toggles full 3D viewer overlay
- [x] Three.js scene with orbit controls, ambient + directional lighting, grid, axes
- [x] "Load DSM" — downloads Google Solar elevation GeoTIFF, parses with geotiff.js, renders as 3D terrain mesh
- [x] DSM mesh color-coded by elevation: gray (ground), blue (building), green (vegetation), amber (high points)
- [x] "Load LiDAR" — queries USGS 3DEP for classified point cloud data
- [x] LiDAR point cloud rendered with classification colors: gray (ground), blue (building), green (vegetation)
- [x] Click-to-measure: click any point to see height above ground (ft/m) with visual marker and height line
- [x] Legend overlay showing color meanings
- [x] Reset view button
- [x] Height exaggeration (2x) for visibility
- [x] Camera auto-positions based on data bounds

### USGS 3DEP LiDAR Integration
- [x] `GET /api/lidar/points` — queries USGS Entwine index + National Map fallback
- [x] Searches for LiDAR datasets covering the property lat/lng
- [x] Returns classified points (ground, building, vegetation) when available
- [x] Graceful fallback messages when coverage exists but streaming unavailable

### Design Tool — Extra Zoom
- [x] CSS-based zoom beyond Google's max tile level (up to 4 extra levels / 16x magnification)
- [x] Zoom label appears when in extra zoom mode (e.g. "23+2x")

### API Endpoints (new)
| Method | Route | Description |
|--------|-------|-------------|
| PATCH | `/api/projects/:id/reassign` | Reassign project to team member |
| PATCH | `/api/projects/:id/archive` | Archive project (set status) |
| GET | `/api/solar/building-insights` | Google Solar API — roof data |
| GET | `/api/solar/data-layers` | Google Solar API — DSM/flux layers |
| GET | `/api/solar/geotiff` | Proxy GeoTIFF downloads |
| GET | `/api/lidar/points` | USGS 3DEP LiDAR point cloud |

---

## Completed — 2026-03-27 (Session 6)

### 3D Engine Fixes
- [x] Fixed `controls3d.target` crash — guarded all OrbitControls access against null
- [x] Downgraded Three.js from r160 → r152 for reliable `examples/js/OrbitControls` support
- [x] Added `designLat`/`designLng` checks before fetching DSM/LiDAR (shows helpful message instead of undefined coords)
- [x] Wrapped `init3dViewer()` in try/catch with error display in status bar
- [x] Fixed blue-only screen: brighter grid colors, removed fog, darker background for contrast
- [x] Added 50ms layout delay before init to avoid 0-dimension canvas race condition
- [x] 3D viewer auto-loads DSM on first open (no manual "Load DSM" click needed)

### Server-Side GeoTIFF Parsing
- [x] `GET /api/solar/dsm-elevation` — new endpoint that fetches + parses DSM GeoTIFF server-side, returns JSON elevation array
- [x] Eliminated browser-side GeoTIFF CDN dependency (geotiff.js removed from client)
- [x] Installed `geotiff` npm package for reliable server-side TIFF parsing

### Satellite Imagery on 3D Terrain
- [x] Extended `/api/solar/dsm-elevation` to also fetch Google Solar `rgbUrl` GeoTIFF in parallel
- [x] Server parses RGB bands → encodes to PNG via `pngjs` → returns as base64 data URL
- [x] `buildDsmMesh()` drapes satellite photo as `THREE.Texture` on terrain mesh
- [x] Satellite/Elevation toggle button swaps between photo texture and height-colored vertex material
- [x] Fallback to vertex colors when satellite image unavailable

### LiDAR Toggle
- [x] LiDAR button loads point cloud on first click, toggles visibility on subsequent clicks
- [x] Green active state indicator when LiDAR is visible
- [x] No re-fetch on toggle — data cached after first load

### API Endpoints (new/updated)
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/solar/dsm-elevation` | DSM elevation + satellite image (server-side parse) |

### Dependencies Added
- `geotiff` — server-side GeoTIFF parsing
- `pngjs` — PNG encoding for satellite image data URL

---

## Completed — 2026-03-27 (Session 7)

### 3D LiDAR Viewer — Architecture Overhaul
- [x] Renamed "3D CAD" toolbar button to "LiDAR" with radar-style icon — one-click opens 3D view
- [x] One-click auto-loads DSM terrain + satellite imagery + LiDAR point cloud (no separate "Load DSM" / "Load LiDAR" clicks)
- [x] Toolbar stays visible above 3D overlay so user can switch tools while in LiDAR view

### Geo-Referenced Coordinate System
- [x] Added `geoToLocal(lat, lng)` utility — converts geographic coords to meters offset from design center
- [x] DSM endpoint now computes and returns geographic bounding box (`bbox`) from GeoTIFF dimensions + pixel size
- [x] `buildDsmMesh()` uses real-world meter dimensions from bbox (replaced hardcoded `scaleXZ=0.5`)
- [x] `buildLidarPointCloud()` converts each point via `geoToLocal()` into shared meter-offset coordinate space
- [x] Both DSM and LiDAR share `vertExag = 2.0` and `groundLevel` for consistent vertical alignment

### Flat Satellite Ground Plane ("Cup on Paper")
- [x] Satellite imagery rendered as a flat `PlaneGeometry` at Y=0 (the "paper")
- [x] 3D DSM elevation mesh sits on top with vertex-colored elevation heat map (the "cup")
- [x] Ground-level DSM points (<2ft / 0.6m above ground) made fully transparent so satellite shows through
- [x] Uses per-vertex RGBA colors with alpha channel for smooth ground-to-structure transition
- [x] Removed grid and axes — satellite ground plane replaces them
- [x] Removed satellite/elevation toggle button (satellite is always the flat ground, elevation is always the 3D mesh)

### LiDAR Optimization
- [x] Reduced LiDAR pull radius from 75m to 15m (~50ft) — focused on target property only
- [x] Server-side spatial thinning: keeps highest point per 0.3m grid cell (outer surface of trees/rooftops)
- [x] Point cap reduced from 500K to 50K for better performance
- [x] Simplified HUD — moved to bottom-left, larger status text, removed unnecessary buttons

### API Changes
| Method | Route | Change |
|--------|-------|--------|
| GET | `/api/solar/dsm-elevation` | Now returns `bbox` array in response |
| GET | `/api/lidar/points` | Default radius reduced to 15m, spatial thinning applied |

---

## Completed — 2026-03-27 (Session 8)

### Design Tool — Zoom Overhaul
- [x] Enabled trackpad two-finger scroll zoom (`gestureHandling: 'greedy'`, `scrollwheel: true`)
- [x] Added min zoom limit (zoom 18) — prevents zooming out too far from the house
- [x] Increased CSS extra zoom from 4 → 20 levels for extreme close-up capability
- [x] Scroll/pinch zoom seamlessly chains into CSS extra zoom past Google's max tile level
- [x] Wheel event accumulator with threshold for smooth trackpad zoom increments
- [x] Removed Copy button from production chart header

### Multi-Design Support
- [x] Added `designs` array to project data model (auto-migrates old projects via `ensureDesigns()`)
- [x] Design CRUD API endpoints:
  - `GET /api/projects/:id/designs` — list all designs
  - `PUT /api/projects/:id/designs/:designId` — save design (segments + stats)
  - `POST /api/projects/:id/designs` — create new design (auto-names "Design 2", etc.)
  - `PATCH /api/projects/:id/designs/active` — switch active design
- [x] Design dropdown in design tool topbar — shows all designs with cost/offset/kW, purple checkmark on active
- [x] Click to switch designs — clears map, loads saved segments, updates UI
- [x] Save prompt when switching designs with unsaved changes (Discard/Cancel/Save)
- [x] Save persists segment paths, panel count, tilt, azimuth, and stats to project JSON
- [x] "Create new design" in dropdown and topbar creates blank design and switches to it
- [x] Dashboard designs table now dynamic — shows all designs with real stats from project data
- [x] "+ New design" button on dashboard creates design via API and navigates to design tool

### Customer Profile Page
- [x] Satellite image fills entire right half of the page (was partially empty)
- [x] Higher resolution image (1280x1280 with `scale=2`, zoom 19 for closer house view)
- [x] Removed red marker pin for cleaner look
- [x] CSS `object-fit: cover` ensures image fills without distortion

### API Endpoints (new)
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/projects/:id/designs` | List all designs for a project |
| PUT | `/api/projects/:id/designs/:designId` | Save design segments + stats |
| POST | `/api/projects/:id/designs` | Create new design |
| PATCH | `/api/projects/:id/designs/active` | Switch active design |

---

## Completed — 2026-03-27 (Session 9)

### LiDAR Viewer — Unified 3D Scene Rebuild
- [x] Replaced dual-system approach (CSS transforms + Three.js overlay) with single Three.js scene
- [x] One scene contains satellite ground plane (the "paper") + elevation point cloud (the "stuff in the glass")
- [x] OrbitControls for full 360° rotation, zoom, and pan — drag to orbit, scroll to zoom, right-drag to pan
- [x] LiDAR button is a simple on/off toggle — click on shows 3D scene, click off returns to map
- [x] ViewCube auto-hides when LiDAR is active, restores when toggled off

### Satellite Ground Plane
- [x] Uses Google Maps Static API (same imagery as the map view, not Solar API RGB)
- [x] Zoom 18 for wide area coverage (~380m across)
- [x] 1280x1280px resolution (640px with scale=2)
- [x] Plane sized using precise meters-per-pixel calculation at property latitude

### Elevation Point Cloud (from Google Solar DSM)
- [x] Generates 3D point cloud from DSM elevation grid (replaced broken USGS Entwine endpoint)
- [x] Points classified by height: gray (ground <0.8m), blue (buildings >5m), green (vegetation)
- [x] Smart density: ground points thinned (every 6th pixel, max 30m from center), full density on buildings/trees
- [x] 40m radius focused on the property — not the whole neighborhood
- [x] Height exaggeration (2x) for visual clarity

### Three.js Setup
- [x] Downgraded to Three.js r128 for reliable `THREE.OrbitControls` global support
- [x] PerspectiveCamera with OrbitControls (damping, distance limits, max polar angle)
- [x] Camera auto-positions to fit point cloud extent on load

### UI Cleanup
- [x] Removed satellite date/source selector from bottom-left of design tool
- [x] Removed old viewer HUD buttons (separate LiDAR/Reset buttons inside 3D view)
- [x] Legend and status text inside 3D viewer overlay
- [x] Raycaster infrastructure preserved for future tree height measurement feature

---

## Completed — 2026-03-28 (Session 10)

### LiDAR Point Cloud — Density & Color
- [x] Doubled-tripled point cloud density: ground skip reduced (6→3), distance cutoff extended (30m→55m), 2x2 sub-pixel bilinear interpolation for elevated features
- [x] Height-based color scale: blue (0-40 ft) → green (40-80 ft) → orange (80-90 ft) → red (90+ ft) with smooth blending
- [x] Legend updated to show height scale with ft ranges
- [x] Status bar now shows total point count with breakdown (elevated + ground)
- [x] `ftAbove` stored per point for foot-based color classification
- [x] Point size tunable (currently 3px)

### LiDAR Viewer — ViewCube Integration
- [x] ViewCube stays visible in LiDAR mode (was hidden before)
- [x] Tilt slider stays visible in LiDAR mode
- [x] ViewCube drag/face-click drives Three.js camera via `syncCameraToMap()`
- [x] CSS map transforms skipped in LiDAR mode — only 3D camera moves
- [x] `vcRotX`/`vcRotZ`/`vcDragging` exposed on `window` for cross-script-block communication
- [x] Disabled direct OrbitControls canvas interaction — all navigation through ViewCube (same UX in both modes)
- [x] Scroll-to-zoom on 3D canvas via `lidar3dZoomDist` variable
- [x] Face click transitions and drag transitions scoped to 2D-only

### LiDAR Viewer — Camera Sync
- [x] `syncCameraToMap()` positions Three.js camera from ViewCube tilt/heading/zoom
- [x] Camera matches 2D map perspective on LiDAR open (tilt, heading, zoom all carried over)
- [x] Heading direction corrected to match 2D cube drag direction

### LiDAR Viewer — Loading UX
- [x] Loading overlay with blur backdrop shown over map while LiDAR data fetches (no more blank blue screen)
- [x] Spinner icon + "Loading LiDAR Data" + subtitle text
- [x] Overlay hidden and 3D viewer revealed only after data is fully loaded
- [x] Error states also dismiss overlay and show 3D viewer with error message

### LiDAR Viewer — Satellite Ground Plane
- [x] Ground plane aspect ratio matches viewer dimensions (was square before)
- [x] Zoom 20 for high resolution matching the 2D map
- [x] Request dimensions shaped to screen aspect (640px max per axis)

### LiDAR Button — Navigation Menu
- [x] LiDAR toggle moved from bottom toolbar to top-left nav menu (next to Irradiance)
- [x] Old toolbar LiDAR button removed
- [x] Active state styled for `tb2-btn` class (green tint)

---

## Completed — 2026-03-28 (Session 11)

### LiDAR Point Cloud — Size Attenuation
- [x] Changed point rendering from fixed pixel size to world-space size (`sizeAttenuation: true`)
- [x] Points now grow larger when zooming in and shrink when zooming out (Aurora Solar-style)
- [x] Base size tuned to 0.8 world units for natural appearance at all zoom levels

### LiDAR Button — Input Fix
- [x] Changed LiDAR toggle from `click` to `mousedown` event — spacebar no longer accidentally toggles LiDAR off
- [x] Added "K" keyboard shortcut for LiDAR toggle (skips input/textarea fields)
- [x] Extracted `triggerLidarToggle()` function shared by mouse and keyboard handlers

### 3D Viewer — Mouse Controls Remapped
- [x] Left-click + drag = pan (was rotate)
- [x] Right-click + drag = tilt/orbit via ViewCube (was OrbitControls pan)
- [x] Scroll wheel = zoom (unchanged)
- [x] Disabled OrbitControls' built-in rotate — right-click drives ViewCube `vcRotX`/`vcRotZ` directly
- [x] ViewCube updates in real-time during right-click drag (tilt + heading synced)
- [x] Context menu suppressed on canvas to prevent right-click menu interference

### 3D Viewer — Spacebar Pan
- [x] Hold spacebar + left-click drag to pan camera across the scene
- [x] Custom pan implementation: disables OrbitControls entirely while space is held
- [x] Pan direction computed from camera heading (right/forward vectors on ground plane)
- [x] Distance-based scaling so pan speed feels natural at any zoom level
- [x] Canvas gets `tabindex="0"` and auto-focuses on click for reliable keyboard capture
- [x] Grab/grabbing cursor feedback during space-pan

---

## Completed — 2026-03-28 (Session 12)

### 3D Viewer — ViewCube Fix
- [x] Fixed bug where pulling ViewCube tilt back to 0 locked camera facing true north with no heading response
- [x] Root cause: `polarAngle = 0` zeroed out horizontal offset (`sin(0) = 0`), making heading rotation invisible
- [x] Fix: clamped `vcRotX` to minimum of 5 in `syncCameraFromViewCube()` so heading always has effect

### 3D Viewer — Spacebar Pan Mode
- [x] Hold spacebar + drag to pan camera parallel to the ground plane (XZ)
- [x] Custom pan implementation: disables OrbitControls rotate/pan while space is held
- [x] Pan direction computed from camera heading (right + forward vectors projected onto ground)
- [x] Distance-based speed scaling for natural feel at any zoom level
- [x] Grab/grabbing cursor feedback

### Satellite Imagery — LiDAR Alignment System
- [x] Ground plane now uses high-res imagery from `/api/imagery` (provider-agnostic: Google, Nearmap, EagleView)
- [x] Zoom auto-selected (up to 21) to cover LiDAR extent at highest resolution
- [x] `scale=2` on server gives 1280x1280px actual resolution
- [x] Server-side DSM bbox now computed from actual GeoTIFF resolution (`image.getResolution()`) instead of hardcoded 0.5m pixel assumption

### Satellite Imagery — UV-Based Alignment to LiDAR
- [x] `computeAlignmentUVs()` — analytically maps LiDAR bbox onto high-res image UV space using known geographic footprints
- [x] Ground plane geometry sized to LiDAR bbox with custom UV coordinates that crop the texture to match
- [x] `refineAlignmentNCC()` — normalized cross-correlation refinement using Solar API's co-registered RGB image as ground truth
- [x] Downscales both images to 128x128 grayscale, slides a 48px center patch over ±20px search window
- [x] Pixel offset converted to UV correction for sub-pixel alignment accuracy
- [x] Runs in <50ms in browser using offscreen canvas — no external dependencies
- [x] Console logging: `[Alignment] NCC offset` and `[Alignment] UVs` for debugging
- [x] `THREE.ClampToEdgeWrapping` on texture to handle edge overhang cleanly

### Provider-Agnostic Imagery Architecture
- [x] All imagery fetched through `/api/imagery` endpoint — never hardcodes a provider
- [x] Alignment system works with any tile-based provider (only needs center + zoom + pixel size)
- [x] Stubs in place for Nearmap (`NEARMAP_API_KEY`) and EagleView (`EAGLEVIEW_API_KEY`)
- [x] Future provider swap requires only env var change — alignment code unchanged

---

## Completed — 2026-03-28 (Session 13)

### Satellite/LiDAR Alignment — Projection Fix
- [x] Replaced equirectangular (linear) `geoToLocal`/`localToGeo` with true Web Mercator projection
- [x] Ground plane sizing now uses Mercator meters (`156543.03392 / 2^zoom`) — removed incorrect `cos(lat)` factor that caused scale mismatch
- [x] Ground plane texture upgrade no longer replaces the plane (just swaps the texture) — eliminates the 20ft positional shift bug
- [x] `computeAlignmentUVs()` rewritten for Mercator-consistent UV mapping
- [x] NCC refinement search window widened from ±20px to ±32px for better sub-pixel correction

### Provider-Agnostic Projection Metadata
- [x] `/api/imagery/info` endpoint now returns `projection` field per provider (webmercator, ortho)
- [x] Foundation for future providers (Nearmap, EagleView) with different projection models

### Manual 2D Calibration System
- [x] Mandatory calibration prompt when LiDAR loads for the first time on a project (no saved calibration)
- [x] Full-screen overlay with side-by-side canvases: Google Maps satellite (left) + Solar API co-registered RGB (right)
- [x] User marks 4+ matching house corners on both images — numbered markers with connecting lines
- [x] Auto-detected roof corners from LiDAR elevation data (convex hull of building-class points with angle filtering)
- [x] Magenta markers pre-placed at detected LiDAR corners for guidance
- [x] Similarity transform solver (4-DOF: translation + uniform scale + rotation) via least-squares with Gaussian elimination
- [x] Transform applied to ground plane (`position.x/z`, `scale`, `rotation.y`) for pixel-perfect alignment
- [x] Confirm Calibration button (enabled at 4+ pairs), Clear button, Skip button
- [x] Re-calibrate toolbar button for later adjustments

### Calibration Persistence
- [x] `GET /api/projects/:id/calibration` — returns saved calibration transform + control points
- [x] `PUT /api/projects/:id/calibration` — saves calibration data to project JSON
- [x] Auto-applies saved calibration on future LiDAR loads (skips overlay prompt)

### API Endpoints (new)
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/projects/:id/calibration` | Get saved calibration for a project |
| PUT | `/api/projects/:id/calibration` | Save calibration transform + control points |

---

## Completed — 2026-03-28 (Session 14)

### Design Tool — Nav Submenu Fix
- [x] Fixed submenu persistence when switching between Site/System tabs — `closeAllSubmenus()` called on tab switch

### LiDAR Point Cloud — Aurora-Style Restyle
- [x] Changed color scheme from height-based rainbow to Aurora Solar palette: teal (roof/buildings), blue (ground/trees), dark blue (low vegetation)
- [x] Round circle sprite texture (64x64 canvas) replaces square points
- [x] `sizeAttenuation: true` with world-space sizing (base size 0.8)
- [x] Dynamic point sizing in render loop: grows/shrinks based on camera distance (`clamp(dist * 0.006 + 0.3, 0.5, 1.4)`)
- [x] Reduced point density (`subSteps=1`, `groundSkip=5`) for cleaner appearance
- [x] Removed LiDAR legend overlay from bottom-right corner

### Project Profile — Top Bar Cleanup
- [x] Removed `···` menu button from sub-header bar (kept sidebar `···` menu)

### Nav Rail — Redesign
- [x] Nav rail now matches expanded drawer: logo at top (opens drawer on click), Projects, Database, Settings, Partners icons
- [x] Consistent rail across all pages (main, settings, settings/users, database)
- [x] Rail icons redirect to corresponding pages when clicked

### Partners Section
- [x] `/partners` — Partners list page with table (14 sample partners), search filter, type/status columns
- [x] `/partners/new` — 3-step New Partner wizard:
  - Step 1: Create organization (name, type, address, contact)
  - Step 2: Customize settings & database access
  - Step 3: Add users & teams
  - Client-side step navigation with sidebar progress indicator

### Settings — User Detail Page
- [x] `/settings/users/:uid` — Full user detail page with User Details, Permission, and Region sections
- [x] Loads real user data from `data/users.json`

### Settings — Roles System
- [x] `/settings/roles` — Roles list page with 8 roles (Admin, Team Member, Limited Team Member, Commercial Partner, Proposal Manager, Sales Manager, Sales Rep, Team Manager)
- [x] Type badges (Default/Advanced), user count, project & user access summary, last edited columns
- [x] Clickable rows navigate to role detail
- [x] `/settings/roles/:roleName` — Role detail page with full permissions matrix
- [x] Collapsible sections: Services, Project features & content, Database, Settings
- [x] Permission profiles for Admin (all Y), Team Member (mixed), Limited Team Member (no assign), Commercial Partner (no financing), Proposal Manager, Sales Manager, Sales Rep, Team Manager
- [x] Y/N/D permission indicators with color coding

---

## Completed — 2026-03-28 (Session 15)

### Calibration UX — Full Redesign
- [x] Single large image view replacing cramped side-by-side layout — image fills available viewport
- [x] Tab switcher: LiDAR Image / Satellite Image / Side by Side
- [x] Zoom: scroll wheel with gentle sensitivity (0.06 per tick), +/− buttons, Fit reset button, up to 10x
- [x] Pan: Space+drag to move around zoomed image, grab cursor feedback
- [x] Crosshair overlay at canvas center for precision
- [x] Canvas internal buffer matches display size for sharp rendering at any size
- [x] Markers and connecting lines scale inversely with zoom to stay readable
- [x] Polygon outline closes at 3+ points for visual feedback

### Calibration — Unlimited Points
- [x] Removed 4-point cap — designers can place as many points as desired (minimum 4 still required)
- [x] More points = better least-squares fit = higher accuracy
- [x] UI dynamically shows point count, target matching count, and pair count on confirm button
- [x] `applyAndSaveCalibration()` uses `Math.min(lidar, sat)` matched pairs (not hardcoded 4)
- [x] Auto-switches to Satellite tab after 4 LiDAR points; designer can switch back to add more

### Calibration — Workflow Improvements
- [x] Auto-loads LiDAR on design page entry (no need to click LiDAR button)
- [x] Auto-prompts calibration if no saved calibration exists
- [x] Saved calibrations silently applied on revisit — no re-prompt
- [x] Calibrate button moved from drawing toolbar to top toolbar (next to LiDAR button)
- [x] Calibrate icon turns green when calibration has been applied
- [x] Clicking Calibrate in top toolbar auto-loads LiDAR if not already loaded, then opens calibration

### Layout
- [x] ViewCube moved from bottom-left to bottom-right

---

## Completed — 2026-03-28 (Session 17)

### Roles — Additional Permission Profiles
- [x] Added Proposal Manager role (Advanced, Assigned and team-enabled)
- [x] Added Sales Manager role (Advanced, Assigned-only, financing edit, user management)
- [x] Added Sales Rep role (Advanced, Assigned-only, view-heavy with limited edit)
- [x] Added Team Manager role (Advanced, Assigned and team-enabled, utility/energy edit, user mgmt view)

### LiDAR Point Cloud — Height-Based Color Gradient
- [x] Replaced flat teal/blue color scheme with Aurora-style height gradient
- [x] Color ramp: dark slate blue (ground) → teal/cyan (low) → green (mid) → yellow/orange (upper) → red (tallest)
- [x] Normalized to 0-45ft range with smooth blending between bands

### LiDAR Viewer — Near-Orthographic Camera
- [x] **Design goal:** LiDAR points should always appear directly above their corresponding 2D map positions — no perspective shift when panning. Default view is top-down; user can tilt via ViewCube when they want 3D perspective, and both satellite + LiDAR tilt together.
- [x] Switched from standard PerspectiveCamera (50° FOV) to narrow FOV (5°) with far camera (800 units) — near-orthographic projection eliminates parallax
- [x] Points switched to screen-space pixel sizing (`sizeAttenuation: false`) for consistent visibility at any camera distance
- [x] Dynamic sizing: `1600/dist` formula, range 1.5-6px
- [x] LiDAR opens in true top-down view by default (vcRotX reset to 0)
- [x] User can still tilt via ViewCube/right-drag — both satellite and LiDAR tilt together

### Geocode & Satellite API Routes
- [x] Added missing `GET /api/geocode` — proxies Google Geocoding API, returns lat/lng + formatted address
- [x] Added missing `GET /api/satellite` — proxies Google Static Maps API for satellite imagery
- [x] Both routes protected by existing auth middleware

### API Endpoints (new)
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/geocode?address=` | Geocode address → lat/lng |
| GET | `/api/satellite?lat=&lng=&zoom=` | Proxy satellite image |

---

## Planned — Shading Engine (5 phases)
- [ ] **Phase 1:** Replace `kW × 1400` with Google Solar per-segment sunshine hours for production estimates
- [ ] **Phase 2:** PVWatts API integration — industry-standard AC output with real system losses
- [ ] **Phase 3:** Flux map heatmap overlay — parse Google Solar GeoTIFFs, render on 3D ground plane
- [ ] **Phase 4:** LiDAR shadow casting — ray-trace sun through point cloud for tree/obstruction shade analysis
- [ ] **Phase 5:** Time-of-day shade animation — scrub shadows across roof throughout the day

## Planned — CAD Engine & Equipment Catalog (6 phases)
- [ ] **Phase 1:** Equipment catalog — `data/equipment.json` with real module/inverter/optimizer/battery specs, wire up `/database` page
- [ ] **Phase 2:** Module selection — dropdown in design tool replaces hardcoded 400W panel, stats recalculate live
- [ ] **Phase 3:** Inverter & stringing — string sizing, AutoStringer, DC/AC ratio validation, color-coded strings
- [ ] **Phase 4:** Obstruction & tree tools — draw chimneys/vents/skylights, panels auto-avoid them
- [x] **Phase 5:** Roof modeling — manual drawing, SmartRoof detect, edge/face properties, persistence *(core done, detection accuracy WIP)*
- [ ] **Phase 6:** BOM generation — full bill of materials, CSV export, Sales Mode slide

---

## Session — 2026-03-28

### Navigation & Sidebar
- [x] Retracted rail icons updated to match expanded nav drawer (Projects, Database, Settings, Partners)
- [x] Removed `margin-top:auto` so rail icons are grouped sequentially like the expanded drawer
- [x] All rail instances updated across home, settings, and users settings pages

### Database Page (`/database`)
- [x] New route at `/database` with full Aurora-style layout
- [x] Left sidebar with 3 section groups: Components (Modules, Inverters, DC optimizers, etc.), Quoting (Proposal templates, Adders & discounts, etc.), Operations (Jurisdictions, Suppliers, etc.)
- [x] "Specify component availability" toggle at top of sidebar
- [x] Main area with search bar, All/Enabled tabs, "Request custom component" button
- [x] Empty state placeholder — no components data wired yet
- [x] All Database nav links (`href="#"`) updated to `/database`

### Roles Page (`/settings/roles`)
- [x] New route at `/settings/roles` with full permissions matrix matching Aurora
- [x] Top bar with back arrow and "Admin" label
- [x] Admin role with "Default" badge
- [x] Permissions sections: Project access level, Services, Project features and content, Database, Settings
- [x] Green checkmark and em-dash indicators for all permission rows
- [x] Sub-items with indentation (Site model, Proposal templates > Edit/Set default, Operations > AHJ/Utilities, etc.)
- [x] View links to corresponding settings/database pages
- [x] Sidebar Roles links updated from `/settings` to `/settings/roles`

### Project Detail — Sidebar & Designs Tab
- [x] Removed top customer name/address block with "···" menu from project sidebar
- [x] Designs tab now renders all designs from `project.designs` (was hardcoded to show only "Design 1")
- [x] Each design card links to design page with correct `designId` query param
- [x] Design cards show actual stats (cost, offset, kW) and correct edit timestamps
- [x] Added "..." dropdown menu on each design card with "Rename" option
- [x] Rename uses prompt dialog and saves via existing PUT API

### LiDAR / 3D Viewer
- [x] Replaced USGS 3DEP/Entwine LiDAR fetcher with Google Solar DSM grid generator
- [x] 161×161 grid (25,921 points) sampled via bilinear interpolation within ±15m of pin
- [x] Ground plane satellite imagery now fetches at 50m radius (was 40m)

---

## Other Next Up
- [ ] Customer profile editing (save form edits back to project data)
- [ ] Stage pipeline (make status dropdown functional with real stages)
- [ ] Persistent storage (SQLite — projects lost on server restart)
- [ ] Assignee management (functional assignment, not hardcoded)
- [ ] User authentication
- [ ] Real organization / team management
- [ ] LAZ file processing for full USGS point cloud support
