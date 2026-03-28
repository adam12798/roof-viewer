# Solar CRM — Build Progress

## Overview
A solar proposal and CRM web app built with Node.js + Express, served locally at `http://localhost:3000`. Data is stored in `data/projects.json`. Google Maps APIs handle geocoding, satellite imagery, and interactive maps.

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

---

## Running the App

```bash
cd "project Interrupt"
npm start
# → http://localhost:3000
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

## Next Up (not yet built)
- [ ] Customer profile editing (save form edits back to project data)
- [ ] Stage pipeline (make status dropdown functional with real stages)
- [ ] Persistent storage (SQLite — projects lost on server restart)
- [ ] Assignee management (functional assignment, not hardcoded)
- [ ] User authentication
- [ ] Real organization / team management
- [ ] Render Google Solar flux GeoTIFF as per-pixel heatmap overlay on map
- [ ] CAD tools: snap-to-point roof tracing from LiDAR, auto-detect roof planes
- [ ] Shadow simulation using real tree/structure heights + sun path
- [ ] LAZ file processing for full USGS point cloud support
