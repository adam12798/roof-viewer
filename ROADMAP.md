# Solar CRM — Roadmap

---

## Planned (Future)

### 3D CAD & LiDAR (Phase 2-3)
- **Per-pixel flux heatmap** — Render Google Solar flux GeoTIFF directly on the map as a true shade/sun overlay (currently using approximated polygons).
- **LAZ file processing** — Server-side LAZ decoding for full USGS 3DEP point cloud support (currently limited to Entwine streaming).
- **Snap-to-point roof tracing** — Trace ridge, hip, valley, eave lines by snapping to LiDAR building points.
- **Auto-detect roof planes** — Algorithmically detect roof planes from point cloud geometry.
- **Obstruction detection** — Auto-mark vents, chimneys, trees with real heights from LiDAR/DSM.
- **Shadow simulation** — Animate shadows at any time/date using real tree/structure heights + sun position math.
- **3D panel placement** — Place solar panels on the 3D roof model with snap-to-ridge alignment.
- **Export measurements** — Export roof dimensions and CAD data for permit drawings.

### Design Tool
- **Production panel — live data** — Wire panel count, annual energy, and energy offset to live system calculations (currently mock data). Depends on shading engine.
- **Bill savings tab** — Build out the Bill savings view in the production panel dropdown.
- **Flyout submenus — functionality** — Connect Panels (Modules, Ground mounts) and String/connect (AutoStringer, Manual string) flyout items to actual design actions.
- **Setbacks — live enforcement** — Apply setback values from the System settings panel to roof segment drawing in real time.
- **Simulate system** — Connect the Simulate system button to a real simulation backend.

### Settings
- **Edit mode** — Hook up the Edit button on the User Profile settings page to persist real profile updates.
- **Organization profile, Apps, Users & licenses, Roles, Teams** — Build out remaining sidebar settings pages.
- **API tokens & Webhooks** — Implement token management and webhook configuration.

### Routing & Navigation
- **70 non-functional clickable elements identified** — Full audit in `ROUTING.md`. Includes dead `href="#"` links, buttons with no onclick handlers, placeholder alerts, broken redirects (`/crm` → should be `/`), styled dropdowns with no logic, and editable inputs that never save. Covers nav drawer, left rail, CRM context menu, project detail (all tabs), sales mode CTA, and settings sidebar.

### CRM / Projects
- **Project pipeline stages** — Move projects through stages beyond "Remote Assessment".
- **Milestone timeline** — Build out the milestones/timeline system accessible from the design tool right panel.

---

## Completed — 2026-03-27 (Session 8)

### Design Tool — Zoom
- Trackpad two-finger zoom enabled, min zoom 18, CSS extra zoom up to +20 levels
- Scroll/pinch seamlessly chains into CSS zoom past Google's max tile level

### Multi-Design System
- `designs` array on project data model with full CRUD API (create, save, switch, list)
- Design dropdown in topbar — switch between designs with save prompt for unsaved changes
- Segment persistence (paths, panels, tilt, azimuth, stats) saved per design
- "+ New design" on dashboard creates design and opens design tool
- Dashboard designs table renders all designs dynamically

### Customer Profile
- Satellite image fills entire right half, higher resolution (1280x1280, zoom 19), no marker pin

### UI Cleanup
- Removed Copy button from production chart

---

## Completed — 2026-03-27 (Session 7)

### 3D LiDAR Viewer — "Cup on Paper" Architecture
- Overhauled 3D viewer: one-click "LiDAR" button in toolbar auto-loads DSM + satellite + LiDAR
- Flat satellite ground plane at Y=0 with 3D elevation mesh on top (transparent below 2ft)
- Geo-referenced coordinate system (`geoToLocal`) aligns DSM mesh and LiDAR points in real meter-offset space
- LiDAR radius reduced to ~50ft (target property only), server-side spatial thinning for performance
- Removed grid/axes, satellite toggle — clean scene with just satellite base + 3D terrain

---

## Completed — 2026-03-27 (Session 6)

### 3D Engine Overhaul
- Fixed crash (`controls3d.target` undefined) and blue-only screen on 3D view open
- Moved GeoTIFF parsing server-side — eliminated unreliable browser CDN dependency
- New `/api/solar/dsm-elevation` endpoint returns elevation data + satellite image as base64 PNG
- Satellite imagery draped as texture on 3D terrain mesh (Google Solar `rgbUrl`)
- Satellite/Elevation toggle button to switch between photo and height-colored views
- LiDAR button now toggles visibility (loads on first click, toggles on/off after)
- 3D viewer auto-loads DSM on open, brighter grid, better error handling
- Added `geotiff` + `pngjs` npm dependencies

---

## Completed — 2026-03-27 (Session 5)

### CRM Fixes
- Fixed three-dots row menu clipped by `overflow: hidden` on table wrapper
- Address column wraps instead of truncating — full address visible
- Project detail sidebar menu wired up: Rename, Assign, Delete, Archive all functional
- New API endpoints: `/api/projects/:id/reassign`, `/api/projects/:id/archive`

### Google Solar API + Shade Analysis
- Three server endpoints: building-insights, data-layers, geotiff proxy
- Shade Analysis panel in design toolbar with sun hours, flux stats, monthly chart, segment list
- Three overlay modes: None, Annual flux (green→red), Shade map (purple)
- Roof segments rendered as colored polygons on Google Maps

### 3D CAD Viewer
- Three.js 3D viewer toggle in design toolbar
- Load DSM: Google Solar elevation GeoTIFF → 3D terrain mesh (color-coded by height)
- Load LiDAR: USGS 3DEP point cloud → classified 3D points (ground/building/vegetation)
- Click-to-measure height with visual marker + height line
- Orbit controls, grid, axes, legend, reset view

### USGS 3DEP LiDAR
- Server endpoint queries Entwine index + National Map API fallback
- Returns classified points or dataset availability info

### Design Tool — Extra Zoom
- CSS scale-based zoom beyond Google's max (up to 16x magnification) for precise panel work

---

## Completed — 2026-03-27 (Session 4)

### Server & CRM
- Port changed from 3000 → 3001 (code + `.env`)
- CRM row height increased for better readability

### Energy Usage → Design Data Flow
- Energy usage auto-saves from monthly inputs to project JSON via new API endpoints
- Design page pulls real usage data: production chart, energy offset %, usage stats
- Dynamic chart Y-axis scaling based on actual data

### Design Tool — 3D ViewCube & Navigation
- 3D ViewCube (bottom-left) with drag-to-orbit, face-click snap, compass labels, north arrow
- CSS 3D transforms treat map as a flat ground plane (ready for future LIDAR/CAD model)
- Side face clicks maintain current tilt, only rotate heading
- Spacebar + drag to pan the 3D perspective view
- Scroll wheel zoom works while tilted
- Sensitivity tuned, inverted Y-axis for natural feel

### Design Tool — Panel & Layout
- Production/energy panel moved from bottom drawer to right-side slide-in (380px)
- Stats bar toggles panel open/closed
- Settings gear icon restored; panel starts closed on load
- Map locked (no accidental drag/scroll) for stable design surface
- Topbar and toolbar2 heights reduced for more workspace

---

## Completed — 2026-03-27 (Session 3)

### Notes Tab
- Full notes tab at `?tab=notes` with two-column layout matching Aurora UI
- Rich text editor (contenteditable) with formatting toolbar: Bold, Italic, Underline, Strikethrough, Bullet list, Numbered list, Link
- Auto-save (800ms debounce) via `PATCH /api/projects/:id/notes`, "Saved" indicator with checkmark
- Attachments dropzone (drag & drop or click to browse) with file list display
- API endpoint persists notes HTML to `projects.json`

### CRM — Search & Filter
- Unified `filterRows()` combines text search with all filter tabs
- **Type** filter: Residential / Commercial (was only partially working)
- **Status** filter: Remote Assessment Completed, Permit Submitted, Installation Scheduled, Completed
- **Teams** filter: Team Sunshine, Team Alpha, Team Beta
- **Organizations** filter: Internal, Green Enterprises
- **General** filter: Has assignee, No assignee, Created this week, Created this month
- Filter count ("Showing X of Y") updates live as search/filter changes
- Filter button turns purple when filters are active

### Sales Mode — Interactive Slideshow
- New route `GET /sales?projectId=ID` serving full-screen, dark-themed 6-slide presentation
- **Slide 1 — Welcome**: Company logo, "Your Solar Proposal", customer name, address, date
- **Slide 2 — Your Home**: Satellite image via existing API proxy, property details (address, type, coordinates, service area)
- **Slide 3 — Energy Profile**: Stats (annual, avg monthly, est. bill) + canvas bar chart with usage vs production; graceful empty state with estimates
- **Slide 4 — Solar Design**: System specs grid (10.75 kW, 27 panels, 9,371 kWh, $46,225, 96% offset) + satellite close-up
- **Slide 5 — Your Savings**: Before/After monthly bill comparison, payback period, 25-year savings, offset %
- **Slide 6 — Next Steps**: 5-step process (site assessment → activation) + "Ready to go solar?" CTA card
- Navigation: arrow buttons, clickable dot indicators, keyboard (ArrowLeft/Right, Space, Escape)
- CSS opacity crossfade transitions, purple accent color matching app branding
- All 3 existing Sales Mode buttons wired: dashboard designs table, project sub-header, design page monitor icon (direct navigate, no dropdown)

### Design Tool — Flyout Fix
- Fixed side menu flyout submenus (Fire pathways, Panels, Components, String/connect) not opening
- Removed duplicate `setupFlyout()` handlers that conflicted with `submenus` array
- Added `e.stopPropagation()` to prevent document click handler from closing menus immediately

### Energy Usage Tab — Bar Chart
- Live bar chart (canvas) appears when user enters monthly kWh values
- Orange bars with rounded tops, diagonal hatch pattern for estimated values
- Auto-scaled Y-axis with kWh grid lines, month labels on X-axis
- Legend: "Energy (kWh)" solid + "Energy estimate (kWh)" hatched
- Annual energy estimate mode distributes total across months with seasonal weighting
- Chart auto-hides when no data, auto-shows on input

---

## Completed — 2026-03-27 (Session 2)

### Create Project Page
- Replaced SVG iceberg illustration with real iceberg photo (`/iceberg.png`) as the right-panel background
- Dedicated `/iceberg.png` Express route to serve the image reliably

### Design Tool — Top Bar
- **Bell (notifications) dropdown** — Clicking the bell opens a panel with header ("Notifications" + "Mark all as seen"), empty state message, and "Assign new milestone" footer with + button
- **AB avatar dropdown** — Clicking AB opens a dropdown with "My profile" and "Logout" options
- All three dropdowns (sales mode, notifications, profile) are mutually exclusive — opening one closes the others; clicking outside closes all

### Project Detail — Dashboard Tab
- Customer profile pencil button now navigates to `?tab=customer`
- Energy usage pencil button now navigates to `?tab=energy`

### Project Detail — Energy Usage Tab
- **Input method dropdown** — Replaced native `<select>` with custom styled dropdown matching Aurora UI: Monthly average, Monthly estimate (1-12 months) ✓, Monthly estimate with existing system, Annual energy estimate, Interval data. Checkmark on selected option, chevron animates open/closed.
- **Upload utility bill** — Clicking or drag-dropping the upload box opens the native file picker (PDF, PNG, JPG). Shows selected filename after pick. Drag-over highlight state.

---

## Completed — 2026-03-27 (Session 1)

### Settings
- Settings page at `/settings` with full sidebar navigation (Account, User management, Pricing & financing, Projects and designs, API, Plan sets sections)
- User Profile view with Profile, Region, and Permission columns
- Live regional formatting preview box (date, currency, measurements)
- Settings gear icon in CRM home rail now routes to `/settings`

### Design Tool — Left Panel
- Converted left panel from full sidebar to floating card (rounded, drop shadow, overlays map)
- Collapse/reopen toggle with fade animation
- Flyout submenus: **Panels** → Modules (M), Ground mounts (P); **String / connect** → AutoStringer, Manual string (C)

### Design Tool — Right Panel (Gear icon)
- Right panel now overlays the map instead of shifting the layout (floating card, no layout shift)
- **System tab**: Setbacks (jurisdiction dropdown, default + per-edge fields, Apply on dormers toggle), Ground mount spacing (row + module row/column), Temperature (Min/Max from ASHRAE)
- **Simulation tab**: Simulation engine, shading toggles (horizon, LIDAR, degradation), Aurora section (weather dataset, station, irradiance model, clipping, submodule), PVWatts section (weather dataset, inverter efficiency, DC-to-AC ratio), System losses (all fields + estimated total loss 16.8%)
- Panel width and input sizing tuned to eliminate horizontal scroll

### Design Tool — Production Panel
- Clicking the Size/Production/Savings stats in the topbar opens a dropdown production panel
- **Production tab**: panel count, annual energy (9,371 kWh mock), energy offset, monthly bar chart (mock data — red energy usage, amber system production), LIDAR shading badge, Advanced toggle, Energy usage section with "No energy usage data" prompt
- **Bill savings tab**: placeholder ready for future build-out
- Chevron animates open/closed; clicking outside dismisses panel

### Design Tool — Map
- Default zoom increased from 20 → 21 for closer initial view of the house
- Max zoom remains 23
