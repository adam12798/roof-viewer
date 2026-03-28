# Interrupt — Product Roadmap

## Completed This Session (Session 3)

- **Notes tab** — Full rich text editor with formatting toolbar (B/I/U/S/lists/link), auto-save to API, attachments dropzone with drag & drop
- **CRM search & filter** — Unified filtering across all 5 tabs (Type, Status, Teams, Orgs, General); search + filters combine; live count updates
- **Sales Mode slideshow** — Full-screen dark-themed 6-slide presentation (Welcome → Home → Energy → Design → Savings → Next Steps); arrow/keyboard/dot navigation; all 3 entry points wired
- **Design tool flyout fix** — Fixed broken side menu submenus (duplicate handlers + missing stopPropagation)
- **Energy usage bar chart** — Live canvas chart with orange bars, hatch pattern for estimates, auto-scaled grid; annual estimate distributes with seasonal weighting

---

## Completed (Session 2)

- **Dashboard tab** — Redesigned to match Aurora Solar: two-card top row (Customer profile + Energy usage) + full-width section cards (Designs table, Drone mapping, Site Model Service, Plan Set Service, Engineering Stamp)
- **Designs tab** — Three hover-selectable cards (blue border + shadow + lift on hover); Design 1 navigates to /design; Sales Mode removed from Design 1 card
- **Customer profile tab** — Split layout: editable form on left (name, phone, email, addresses, property type, AHJ) + Google Static Maps satellite image on right
- **Documents tab** — Five sections: Proposals (Web + PDF cards), Agreements (Docusign), Legacy Agreements, System design (Shade report), Plan Sets (empty state)
- **Design page — flyout submenus** — Fire pathways flyout (Auto place / Draw fire pathways) and Components flyout (Inverter V, Combiner B, Load center, Main service panel, Meter, Disconnect, Racking, Configure existing equipment); only one open at a time; closes on outside click
- **Design page — save modal** — Custom in-page "Save changes?" modal (not browser native dialog); triggered when navigating away with unsaved polygon work; Discard / Cancel / Save actions
- **Design page — top-right icon cluster** — Monitor icon + Sales Mode dropdown ("Go to Sales Mode" + gear), help ? with amber badge "4", bell, AB avatar + chevron
- **Design page — toggle fix** — Long label text ("Use module's light-induced degradation…") no longer overflows; fixed with `flex: 1` on label and `flex-shrink: 0` on toggle
- **Sub-header** — Customer name + ··· menu, progress bar, stage dropdown, assignee dropdown, Design mode link (→ /design), Sales mode button (visual only)
- **CRM nav** — Clicking a project row routes to `/project/:id?tab=dashboard`

---

## Completed This Session (Session 7)

- **LiDAR toolbar button** — Renamed "3D CAD" to "LiDAR" with one-click auto-load of DSM terrain + satellite + LiDAR point cloud
- **Flat satellite ground plane** — Satellite imagery rendered flat at Y=0 ("paper"), 3D elevation mesh sits on top ("cup"); ground-level points <2ft transparent so satellite shows through
- **Geo-referenced alignment** — `geoToLocal()` converts lat/lng to meters offset from design center; DSM mesh sized from real GeoTIFF bbox; LiDAR points in same coordinate space
- **LiDAR optimization** — Radius reduced from 75m to 15m (~50ft, target property only); server-side spatial thinning keeps outer surface points only; 50K point cap
- **Scene cleanup** — Removed grid, axes, satellite/elevation toggle; simplified HUD at bottom-left

---

## Completed (Session 5)

- **CRM row menu fix** — Three-dots menu was clipped by `overflow: hidden`; now works with Rename, Reassign, Archive, Delete
- **Address display** — Full address visible on CRM rows (no more truncation)
- **Sidebar menu** — Project detail sidebar "···" menu wired up: Rename, Assign to team, Delete, Archive
- **Google Solar API** — 3 new endpoints: building insights, data layers, GeoTIFF proxy
- **Shade Analysis** — New panel in design toolbar: sun hours, flux stats, monthly chart, segment list, 3 overlay modes (None/Flux/Shade)
- **3D CAD Viewer** — Three.js-based 3D viewer with DSM terrain mesh + USGS LiDAR point cloud rendering
- **Click-to-measure** — Click any 3D point to measure height above ground (ft/m)
- **USGS 3DEP LiDAR** — Server queries Entwine index + National Map fallback for classified point clouds
- **Extra zoom** — CSS-based magnification beyond Google's max zoom (up to 16x) for precise panel placement

---

## Completed (Session 4)

- **Port change** — Server moved from 3000 → 3001 to avoid conflicts
- **CRM row height** — Increased vertical padding for better readability
- **Energy → Design data flow** — Monthly usage auto-saves via API; design page pulls real usage for chart, offset %, and stats
- **3D ViewCube** — Drag-to-orbit, face-click snap, compass labels, CSS 3D transforms on map plane (flat paper for future CAD)
- **3D navigation** — Spacebar+drag to pan, scroll zoom while tilted, inverted Y for natural feel
- **Production panel** — Moved from bottom to right-side slide-in; stats bar toggles open/closed
- **Settings panel** — Gear icon restored; starts closed on load
- **Map stability** — Locked Google Maps (no drag/scroll) for still design surface; compact toolbars for more workspace

---

## In Progress / Partially Built

- **Design 1 stats** — Cost, Offset, Size all show `$0.00 / 0% / 0 kW`. Need real values from simulation or manual input.
- **Designs table (dashboard)** — Cost shows `$0.00`, size shows `0 kW`. Should pull from saved design data.
- **Customer profile editing** — Form exists on customer tab but edits don't save back to project data.
- **Stage pipeline** — Status dropdown shows "Remote Assessment Completed" but is not functional with real stages.

---

## Core Features to Build

### Design Page
- [ ] **Panel spec selector** — Choose module brand/model (wattage, dimensions) before auto-filling panels
- [ ] **Setback rules** — Configurable edge setbacks per roof segment (fire code, HOA, etc.)
- [ ] **Roof pitch / tilt input** — Let user set tilt angle per segment; affects production estimate
- [ ] **Obstruction drawing** — Mark vents, skylights, chimneys to exclude from panel placement
- [ ] **Fire pathways** — Actually draw/place fire pathway zones on the roof (menu items exist but aren't wired up)
- [ ] **AutoDesigner** — Auto-optimize panel placement across all segments
- [ ] **String / connect** — Draw string wiring between panels; AutoStringer and Manual string modes
- [ ] **Components placement** — Place inverter, combiner, meter, disconnect on the map
- [ ] **Production simulation** — Real kWh/year output using tilt, azimuth, location, shading
- [x] **Shading analysis** — Shade panel with sun hours, flux/shade overlays, roof segment stats from Google Solar API
- [ ] **Undo / Redo** — Toolbar buttons exist but need full history stack wired up
- [x] **Measure tool** — Click-to-measure height in 3D CAD viewer (ft/m with visual marker)
- [x] **Irradiance overlay** — Annual flux + shade map overlays on roof segments from Google Solar API
- [ ] **3D CAD roof tracing** — Snap-to-LiDAR roof tracing for ridge/hip/valley lines
- [ ] **Shadow simulation** — Animate shadows using real tree/structure heights + sun path
- [ ] **Per-pixel flux heatmap** — Render Google Solar GeoTIFF as true per-pixel overlay
- [ ] **LAZ processing** — Server-side LAZ decoding for full USGS point cloud support
- [ ] **Save design** — Persist roof segments, panels, components back to project data
- [ ] **Multiple designs** — Support Design 2, Design 3, etc. per project

### Sales Mode
- [x] **Sales mode page** — Full-screen dark-themed 6-slide interactive slideshow with project data, satellite imagery, energy chart, savings comparison, and next steps
- [ ] **Proposal PDF export** — Generate a printable proposal from a design
- [ ] **Financing options** — Show loan, lease, PPA payment estimates
- [ ] **Bill comparison chart** — Current bill vs. projected bill with solar

### CRM / Project Management
- [ ] **Create project flow** — Currently creates via address search; add a proper "New project" form
- [ ] **Customer profile editing** — Save edits made in the customer profile form back to project data
- [x] **Energy usage tab** — Monthly kWh input with live bar chart, annual estimate with seasonal distribution, auto-save to project
- [ ] **Authority Having Jurisdiction (AHJ)** — Wire up real city/county lookup
- [ ] **Stage pipeline** — Make the "Remote Assessment Completed" stage dropdown functional with real stages
- [ ] **Assignee management** — Assign team members to projects; currently hardcoded to "Juliana Imeraj"
- [x] **Notes tab** — Rich text editor with auto-save and attachments dropzone
- [ ] **Documents tab** — File upload/download for permits, contracts, proposals
- [ ] **Activity log** — Show a timeline of changes on the project

### Dashboard Widgets
- [ ] **Energy usage card** — Pull real utility provider data; let user enter avg monthly bill
- [ ] **Design stats** — Show real Cost/Offset/Size values from saved designs (currently all `$0.00`)
- [ ] **Plan Set Service** — Wire up "+ New form" to an actual form flow
- [ ] **Engineering Stamp** — Wire up "Request stamp" to a request workflow
- [ ] **Drone mapping** — Wire up "Import files" to an upload flow

### Auth & Multi-user
- [ ] **Login / authentication** — No auth exists yet; anyone can access all projects
- [ ] **Team management** — Add/remove team members, roles (admin, designer, salesperson)
- [ ] **Project permissions** — Control who can view/edit which projects

### Infrastructure
- [ ] **Persistent storage** — Projects currently stored in-memory (lost on server restart); migrate to SQLite or Postgres
- [ ] **File storage** — For drone images, documents, proposal PDFs
- [ ] **Google Maps API key** — Currently using a key that may have domain restrictions; need production key
- [ ] **Environment config** — Move API keys and secrets to `.env`

---

## Polish / UX
- [ ] **Mobile responsiveness** — App is desktop-only; needs responsive layout
- [ ] **Empty states** — Design 1 card with `$0.00` looks broken; add helpful empty state messaging
- [ ] **Loading states** — Map load, satellite image load, simulation running
- [ ] **Error handling** — Project not found, map API failure, bad address
- [ ] **Keyboard shortcuts** — V (Inverter), B (Combiner), M (Modules), C (Manual string) shown in UI but not wired to actions
- [ ] **Pagination** — Designs tab has Prev/Next buttons that aren't functional
- [x] **Search/filter on CRM** — All 5 filter tabs functional (Type, Status, Teams, Orgs, General); combined with search; live count
