# Solar CRM — Roadmap

---

## Planned (Future)

### Sun Exposure Overlay — Geometric (Phase 0, pre-shading)

Color each roof section by sun quality based purely on cardinal direction + roof slope + latitude. No LiDAR, no tree shading, no API calls — just geometry.

- **Sun score formula**: per-section azimuth score (south-facing=1.0, north=0.0) × 0.7 + tilt score (pitch matching latitude=optimal) × 0.3
- **Section azimuths**: derived from face azimuth — front trapezoid = face azimuth, back = +180°, hip triangles = ±90°
- **Color gradient**: bright gold `#FFEA00` (best) → gold → orange → dark red → black (worst)
- **Toggle**: existing irradiance button (sun icon, shortcut "I") — add `id="btnSunExposure"`, gold active state
- **State**: `sunExposureActive` flag, stores original materials in `userData.originalMaterial`, restores on toggle off
- **Auto-refresh**: re-apply overlay in `rebuildRoofFace()` when active so pitch/azimuth changes update colors live
- **Insertion points**: sun score functions after shade analysis section (~line 8189), toggle listener after btn3dView (~line 8611), keyboard shortcut in keydown handler (~line 7193)

### Shading Engine (5 phases)

**Phase 1 — Google Solar Production (quick win, ~1 session)**
- Replace flat `kW × 1400 kWh` estimate with per-segment sunshine hours from Google Solar API
- Match drawn panels to nearest roof segment by centroid proximity
- Per-segment formula: `panelCount × 0.4kW × (segmentSunHours / 1000) × derateFactor`
- Update monthly distribution from fixed percentages → Google's monthly flux ratios
- Wire real numbers into Production Panel + Sales Mode

**Phase 2 — PVWatts API (~1 session)**
- Integrate NREL PVWatts API (free key from developer.nrel.gov)
- New endpoint: `GET /api/pvwatts?lat=&lng=&systemSize=&tilt=&azimuth=`
- Returns monthly AC output with real system losses, inverter efficiency, temperature derating, soiling
- Use per-segment tilt/azimuth from drawn panels
- Cache response per project to avoid redundant API calls
- Industry-standard numbers that customers/installers trust

**Phase 3 — Flux Map Heatmap Overlay (~2 sessions)**
- Parse Google Solar monthly flux GeoTIFFs server-side (URLs already fetched via data-layers endpoint)
- New endpoint: `GET /api/solar/flux?lat=&lng=` → per-pixel annual irradiance array + bbox
- Render as colored texture on 3D ground plane (red=high sun, blue=low sun)
- Toggle via existing "Annual flux" button in shade panel
- Optional: month slider to animate Jan→Dec flux maps

**Phase 4 — LiDAR Shadow Casting (~3-4 sessions)**
- Sun position calculation from lat/lng + date/time (SunCalc.js or similar)
- Ray-cast from each roof point toward sun through LiDAR point cloud
- If ray hits tree/obstruction → roof point is shaded at that hour
- Run for representative days (solstices + equinoxes) at hourly intervals
- Generate annual shade map: % of year each point is shaded
- Reduce panel production by per-panel shade percentage
- Enables "remove tree" analysis (delete tree points → recalculate)

**Phase 5 — Time-of-Day Shade Animation (~1 session)**
- Time slider to scrub through hours of the day
- Shadow polygons projected from obstructions onto ground/roof
- Real-time sun position updates shadow direction
- Monthly selector for seasonal variation

### CAD Engine & Equipment Catalog (6 phases)

**Phase 1 — Equipment Catalog & Database Page (~1 session)** ✅ Partially done (2026-03-29)
- ✅ `data/equipment.json` created with module schema (Q.TRON BLK 430W with full mechanical/misc specs)
- ✅ CRUD endpoints: `GET/POST/PUT/DELETE /api/equipment/modules[/:id]`
- Remaining: seed more modules (Canadian Solar, REC, Jinko, Trina, SunPower, LONGi), add inverters/optimizers/batteries
- Remaining: add electrical & temperature spec tabs to equipment schema
- Remaining: wire up `/database` page to render equipment tables with search/filter
- Remaining: inverter fields: manufacturer, model, type (string/micro/hybrid), ratedPower, maxDcInput, MPPT channels, max string size, cost

**Phase 2 — Module Selection in Design Tool (~1 session)**
- Module dropdown in right panel System tab (above Setbacks) showing enabled modules
- Replace hardcoded `1.0m × 1.7m / 400W / $2,300/kW` with selected module specs
- `fillPanels3d()` uses `currentModule.width/height/wattage` dynamically
- Panel count, system kW, and cost recalculate on module change
- Save `moduleId` with design — load correct module on design open
- Portrait/landscape orientation toggle swaps width/height

**Phase 3 — Inverter, Optimizer & Stringing (~2 sessions)**
- Inverter + optimizer dropdowns in System tab (below Module)
- String sizing logic: max panels per string from `inverter.maxInputVoltage / module.Vmp` (temperature-adjusted via ASHRAE min temp + tempCoeff)
- DC/AC ratio validation (warn if too high)
- AutoStringer: auto-assign panels to strings, color-code by string in 3D view
- Manual string: click panels to assign to active string
- String summary in right panel: per-string panel count, voltage, power
- Save `inverterId`, `optimizerId`, `strings[]` with design

**Phase 4 — Obstruction & Tree Tools (~1 session)**
- Wire up existing obstruction submenu items (rectangle, circle, polygon, chimney, vent, skylight, etc.)
- Drawing modes: click-drag for rect/circle, click-to-place for polygon
- Preset shapes with default dimensions (chimney 0.6m², vent 0.3m diameter, etc.)
- Panel exclusion: `fillPanels3d()` skips panels overlapping obstructions (with setback buffer)
- Tree tool: circular obstruction with canopy radius + height (shade casting connects to Shading Engine Phase 4)
- Save `obstructions[]` with design

**Phase 5 — Roof Modeling Improvements (~1-2 sessions)** 🔧 In progress (2026-03-29)
- ✅ Manual roof face drawing in 3D (click vertices, dblclick/Enter to complete)
- ✅ Draggable vertex handles, live edge measurements (ft), face selection (cyan highlight)
- ✅ Edge & face properties panel (Pitch, Azimuth, Height, Area)
- ✅ SmartRoof click-to-detect: flood-fill DSM + Solar API segment splitting
- ✅ Persistence: roof faces save/load with design
- Remaining: improve SmartRoof detection accuracy (higher-res imagery, better edge snapping)
- Remaining: 3D tilt rendering — rotate face mesh by pitch angle in Three.js
- Remaining: ridge/valley line rendering between adjacent faces
- Remaining: snap-to-point — click near LiDAR points to snap vertices to real edges
- Remaining: LAZ file processing for full USGS 3DEP point cloud support

**Phase 6 — BOM Generation (~1 session)**
- `generateBOM()` computes full bill of materials from design equipment + panel count
- Includes: modules × count, inverters × computed quantity, optimizers × count (if applicable), racking estimate, wiring, disconnects
- New endpoint: `GET /api/projects/:id/designs/:designId/bom`
- BOM tab in production panel dropdown (alongside Production + Bill Savings)
- Table: component, manufacturer, model, qty, unit cost, line total + grand total
- Export CSV button
- New Sales Mode slide: "System Components" showing BOM table
- System cost derived from BOM total (replaces hardcoded `kW × $2,300`)

**Dependency chain:**
```
Phase 1 (Catalog) → Phase 2 (Modules) → Phase 3 (Stringing) → Phase 6 (BOM)
                                       → Phase 4 (Obstructions) — independent
                                       → Phase 5 (Roof Modeling) — independent
```

### Document Routing Rules Engine (6 phases) ✅ v1 Shipped (2026-04-16)

Surfaces the right agreement templates on each project's Documents tab based on project/design signals, so sales reps don't hunt through the full template library. Evaluator is pure and CRM-side; it never touches ML/CAD internals.

**Phase 1 — Template routing schema + editor UI** ✅ Shipped (2026-04-15)
- ✅ Optional `routing` block on every template in `data/agreementTemplates.json` (category, requirement, lifecycle, sequence, triggers)
- ✅ "Document routing" panel in the template editor right sidebar; persists through save/load
- ✅ No regression to existing document/signing flow

**Phase 2 — Evaluator + grouped Documents tab** ✅ Shipped (2026-04-15)
- ✅ Pure server helpers `extractSignalsFromProject`, `templateMatchesSignals`, `evaluateDocumentsForProject`
- ✅ Documents tab groups routed templates into Required / Recommended / Optional
- ✅ "Why is this showing?" popover per row exposes matched trigger reasons
- ✅ Unrouted templates remain available through "Browse all templates"
- ✅ "Other agreements" section preserves visibility of legacy/manual instances
- ✅ Existing agreement create/send/sign flow unchanged

**Phase 3 — Project signal capture** ✅ Shipped (2026-04-15)
- ✅ Project-level signals persisted: `utility, state, financing, lenderId, hoa, ahj, incentives, nmProgram, partnerId`
- ✅ Active-design metadata persisted: `hasBattery, batteryKwh, panelUpgradeNeeded, roofType`
- ✅ `PATCH /api/projects/:id/signals` + `PATCH /api/projects/:id/designs/:designId/metadata`
- ✅ "Project signals" editor card on CRM dashboard (positioned under Designs table)
- ✅ Evaluator extended with triggers: `financingMethod, lender, partnerId, ahj, netMeteringProgram, roofType, hasBattery, hoaApplicable, incentivePrograms`
- Deferred: in-design-mode mirror UI for these metadata fields (persistence + dashboard-side editing cover the routing use case)

**Phase 4 — Mismatch detection** ✅ Shipped (2026-04-15)
- ✅ `detectAgreementRoutingMismatches` runs on every project render; reuses Phase 2 matcher — no parallel engine
- ✅ "Needs review" section + amber warning banner when existing agreements no longer match current signals or their template was removed
- ✅ Readable reason hints (e.g. "financing changed", "system size exceeds maximum", "Template no longer exists")
- ✅ Derived only — never auto-deletes, auto-replaces, or persists mismatch state
- ✅ Signed agreements are intentionally excluded from mismatch surfacing (done is done)

**Phase 5 — Admin coverage / observability** ✅ Shipped (2026-04-16)
- ✅ `/database/agreement-templates/coverage` admin page, read-only
- ✅ Summary counts (total / routed / unrouted / required / recommended / optional / globally required / combos / gaps)
- ✅ Global templates panel lists routed templates with no meaningful triggers
- ✅ Coverage matrix across synthetic `utility × state × customerType` baseline combos (reuses `templateMatchesSignals`)
- ✅ Gap list for combos with no required template; click-to-expand per-combo template detail
- Limitation: baseline combos assume no battery / no HOA / kW=0 etc., so templates that require those extras intentionally don't appear in the baseline matrix

**Phase 6 — Editor guardrails / validation** ✅ Shipped (2026-04-16)
- ✅ Pure `analyzeTemplateRoutingWarnings(template)` helper
- ✅ Routing checks box in the editor (errors / warnings / info), live-updated as routing fields change
- ✅ Rules: unrouted info · globally required warning · conditional-acts-as-optional warning · missing category/lifecycle warnings · kW min > max error · conflicting top-level vs routing utility/state warnings · empty routing shell info
- ✅ Client-side save-block only for the kW min > max error; warnings/infos never block save
- ✅ "Templates needing attention" section on the coverage page lists any template with errors or warnings

**Design constraints (intentional)**
- Routing logic is isolated from ML/CAD internals — reads only CRM/project-level fields plus safe design metadata scalars (e.g. `design.stats.kw`, `design.hasBattery`).
- Live evaluator semantics are frozen as of Phase 2. Phase 6 adds warnings *about* routing configs but does not change how matching works.
- `conditional` currently behaves like `optional` in the evaluator; the guardrail warns about this rather than changing semantics.
- Save-blocking is deliberately client-side only (admin-only route; low-risk integration).
- Coverage matrix scope is limited to three dimensions in v1 by design.

**Activity & signed-state visibility** (ride-along with Phase 6, 2026-04-16)
- ✅ First-view timestamps (`openedBySalesRepAt`, `openedByCustomerAt`) recorded by `GET /sign/:token`
- ✅ Per-row hover popover on Documents tab shows full chronological timeline: Created → Sent → Opened → Signed
- ✅ Signed rows get a distinct green treatment with checkmark, signed-at timestamp, and signer name

**Deferred / future work**
- Permit or document-bundle primitive: a single Documents-tab row that represents a group of templates sent together
- Coverage page filters and drill-down improvements (by category / requirement / state / utility)
- In-design-mode mirror UI for routing-relevant design metadata (battery, roof type, etc.)
- Stronger server-side enforcement for the editor validation rules (currently client-side only)
- Dedicated cleanup/merge UX for duplicate stale agreement instances on a single project
- Broader multi-dimension coverage analysis beyond `utility × state × customerType` (include battery/HOA/financing combinations where practical)
- "Conditional" semantics: if/when we give conditional a distinct runtime behavior, retire the guardrail warning
- Customer-page field types in the PDF editor sidebar (Address, Utility, System kW, etc.) as auto-fill field categories

### Other CAD Features
- **3D panel placement** — Place solar panels on the 3D roof model with snap-to-ridge alignment
- **Export measurements** — Export roof dimensions and CAD data for permit drawings
- **Setbacks — live enforcement** — Apply setback values from System settings to roof segment drawing in real time

### Design Tool
- ~~**Spacebar = pan only**~~ ✅ Done (2026-03-29) — 1:1 pan scale, multi-drag support
- ~~**ViewCube snap**~~ ✅ Done (2026-03-29) — Face clicks snap to true head-on views
- ~~**LiDAR calibration persistence**~~ ✅ Done (2026-03-29) — Fixed race condition, no more visible shift on load
- ~~**Toolbar consolidation**~~ ✅ Done (2026-03-29) — Draw toolbar removed, LiDAR moved to tb2
- ~~**Remove 2D map view**~~ ✅ Done (2026-03-29) — Removed Google Maps JS API, 2D map instance, drawingManager, segments[], panel fill, dimension labels, azimuth arrows, 2D ViewCube, CSS deep zoom. Kept server-side /api/geocode and /api/satellite. Shade panel UI preserved (stubs only).
- **Bill savings tab** — Build out the Bill savings view in the production panel dropdown.
- **Simulate system** — Connect the Simulate system button to a real simulation backend.
- ~~**Sidebar-driven tools**~~ ✅ Partially done (2026-03-29) — Roof submenu wired (Smart roof, Manual, Flat). Obstructions still need wiring.
- **Scroll zoom 1:1** — Apply same dynamic scale to scroll/pinch zoom for consistent feel
- **Animated camera transitions** — Smooth tween between ViewCube positions instead of instant snap

### Settings
- **Edit mode** — Hook up the Edit button on the User Profile settings page to persist real profile updates.
- **Organization profile, Apps** — Build out remaining sidebar settings pages (Roles done in Session 14, Teams done in Session 19).
- **API tokens & Webhooks** — Implement token management and webhook configuration.

### Routing & Navigation
- **53 non-functional clickable elements remain** (18 of 71 fixed) — Full audit in `ROUTING.md`. Nav drawer fully fixed. Remaining: dead `href="#"` links, buttons with no onclick handlers, placeholder alerts, styled dropdowns with no logic, and editable inputs that never save. Covers left rail, CRM context menu, project detail (most tabs), sales mode CTA, and settings sidebar.

### CRM / Projects
- **Project pipeline stages** — Move projects through stages beyond "Remote Assessment".
- **Milestone timeline** — Build out the milestones/timeline system accessible from the design tool right panel.
- **Customer profile editing** — Save edits from the customer profile tab back to project data.
- **Assignee management** — Assign team members to projects (currently hardcoded to "Juliana Imeraj"). CRM Reassign has API but frontend still placeholder.
- **AHJ lookup** — Wire up real city/county Authority Having Jurisdiction lookup.
- **Activity log** — Timeline of changes on each project.

### Sales Mode
- **Proposal PDF export** — Generate a printable proposal from a design.
- **Financing options** — Show loan, lease, PPA payment estimates.
- **Bill comparison chart** — Current bill vs. projected bill with solar.

### Documents
- **File upload/download** — Upload and manage permits, contracts, proposals on the Documents tab.

### Imagery Providers
- ✅ Provider architecture done (2026-03-29) — Google/Nearmap/EagleView abstraction with `/api/imagery/providers`
- **Nearmap integration** — Add `NEARMAP_API_KEY` to `.env`, verify Tile API URL matches account tier
- **EagleView integration** — Add `EAGLEVIEW_API_KEY` + `EAGLEVIEW_CLIENT_ID`, verify Reveal API endpoint
- **Provider selector UI** — Dropdown in design tool to switch imagery source per project
- **Resolution comparison** — Side-by-side view of Google vs Nearmap/EagleView for quality assessment

### Infrastructure
- **Persistent storage** — Migrate from JSON files to SQLite or Postgres.
- **File storage** — For drone images, documents, proposal PDFs.

### Theme Redesign — "Solar Warmth" (full reskin)

**Color palette overhaul:**
- Primary: burnt orange `#e8682a` replacing purple `#7c3aed`
- Secondary: teal `#0ea5a0` replacing blue `#4a90e2`
- Sidebar/rail: warm charcoal `#1c1917` replacing cold purple `#1a0828`
- Logo gradient: orange→amber (`#e8682a` → `#f59e0b`) replacing purple→indigo
- Page backgrounds: warm off-white `#fafaf9`, warm dark `#171412`
- Borders/text: warm stone tones replacing cool grays
- CSS custom properties (`:root` vars) for single source of truth

**Fun personality (Claude-style):**
- 20 solar-themed loading quips rotating randomly ("Soaking up some sunshine...", "Consulting the sun gods...", "Convincing electrons to cooperate...", etc.)
- Playful micro-copy: "Welcome back" login, "Let's go" button, fun empty states ("Every solar journey starts with a single rooftop")
- No search results: "No matches -- try casting a wider net"

**Typography:**
- Inter font (Google Fonts) replacing system font stack
- Bolder heading weights (800), tighter letter-spacing

**Animations:**
- `fadeUp` on page content load (opacity + translateY)
- Button `:active` scale(0.97) for tactile feel
- Sidebar logo hover scale(1.08)
- Pulsing dot animation for loading states

**Visual refinements:**
- Warmer shadows: `rgba(28,25,23,...)` replacing `rgba(0,0,0,...)`
- Standardized border-radius: 6/8/12/16px tiers
- Card hover borders shift to brand orange
- Focus rings use warm orange glow

**Scope:** All 8 pages (login, dashboard, new project, project detail, design mode, sales slideshow, settings + sub-pages, database). Layout stays the same — colors, typography, copy, and animations only.

### Polish / UX
- **Mobile responsiveness** — App is desktop-only.
- **Empty states** — Design cards with `$0.00` need helpful messaging.
- **Loading / error states** — Map load, API failures, bad addresses.
- **Undo / Redo** — Toolbar buttons exist in design tool but need history stack.

---

## Completed — 2026-03-29 (Session 21)

### Tree Placement Tool
- Click "Trees" menu or press `T` to enter tree mode — green banner shows instructions
- Two-click workflow: click to set center → move cursor to set canopy radius (live preview circle + ghost tree) → click to finalize
- Tree height auto-snaps to LiDAR point cloud: queries max elevation within canopy radius, accounts for LiDAR offset from calibration alignment
- Tree mesh: brown cylinder trunk (bottom 35%) + green sphere canopy (top 70%), `MeshLambertMaterial` responds to scene lighting
- Hover highlight: trees brighten (emissive glow + opacity boost) when cursor is over them in tree mode, cursor changes to pointer
- Delete: press Delete/Backspace while hovering a tree to remove it
- Persistence: trees save/load with design via `PUT /api/projects/:id/designs/:designId`, duplicated with design copies
- Data model: `{ lat, lng, radius, height }` per tree, stored in `design.trees[]`

### 3D View Controls Swap
- Right-click drag = orbit/rotate (was left-click via OrbitControls default)
- Spacebar + drag = pan along ground plane (fixed sensitivity 0.25, heading-aware, no zoom impact)
- Left-click freed up for tool interactions (tree placement, future panel placement)
- Context menu suppressed on 3D canvas
- Spacebar suppresses all tool interactions (tree clicks, hover, preview) — only pan works while held

### Customer Profile — Save & Satellite Image
- New `PATCH /api/projects/:id/customer` endpoint: persists name, email, phone
- Save button + success indicator on customer profile tab
- Input fields have IDs for JS access (cpFirstName, cpLastName, cpPhone, cpEmail)
- Satellite image replaced: now uses high-res `/api/satellite` endpoint at zoom 20 with orange location pin centered on property (was Google Static Maps)

### Default Project Name
- Project name defaults to customer name when no custom project name is provided at creation

---

## Completed — 2026-03-29 (Session 20)

### LiDAR Calibration — Complete Rewrite
- **Root cause fix**: calibration was computing transforms in raw pixel space then applying to meter-space 3D scene, causing ~100x scale distortion
- Pixel-to-meter conversion in `calibPinsToWorld` now uses `satExtentM` and `rgbBbox` for correct coordinate mapping
- Fixed DSM vs RGB bbox mismatch: server now computes separate `rgbBbox` from RGB GeoTIFF dimensions
- Calibration now moves the LiDAR point cloud (not the satellite ground plane) — satellite stays fixed as reference frame
- Replaced similarity transform with translation-only offset (both systems already in meters, scale/rotation unnecessary)
- Added `version: 2` field to calibration data; auto-load ignores old corrupt pixel-space calibrations
- Cleared all legacy corrupt calibration data from projects.json

### Cache Busting
- `BUILD_VERSION = Date.now()` constant at server start
- `/api/version` endpoint returns current server version
- Design page JS auto-reloads if page version doesn't match server version (eliminates stale cached code)
- Aggressive cache headers: `no-store, no-cache, must-revalidate` + `Pragma: no-cache` + `Expires: 0`

### LiDAR Point Cloud Improvements
- Grid density increased from 121×121 (14.6k points) to 161×161 (25.9k points)
- Point size increased from 2.0 to 4.5 for better visibility when zoomed out
- Ground plane lowered to Y=-0.5 to prevent z-fighting without visible gap from side views

### 3D ViewCube — Fully Functional
- **Draggable orbiting**: click-drag on the cube orbits the 3D camera (horizontal=rotate, vertical=tilt)
- Drag sensitivity matched to 2D map viewcube: horizontal 0.6 deg/px, vertical 0.3 deg/px
- Tilt range 0-80° matching 2D cube
- Face clicks: side views keep current tilt (bump to 30° if near flat), top resets to top-down, bottom goes to 80°
- Double-click resets to top-down view
- `stopPropagation` on all mouse/pointer events prevents OrbitControls interference
- Drag vs click distinguished by 3px movement threshold
- Repositioned above zoom controls (bottom: 120px) with z-index: 50

---

## Completed — 2026-03-28 (Session 19)

### Calibrate Icon Fix
- Calibrate button no longer starts green on page load — only turns green after user actively completes calibration in-session
- Removed server-side `tb2-calibrated` class from initial render
- Removed green class application from `applyCalibration()` (which fires on saved data load)
- Green class now only applied in the save handler when user confirms calibration points

### ViewCube Reorientation
- Front face (default visible): TOP (was S)
- Back face: BOT (was B)
- Top face: N (was TOP)
- Bottom face: S (was BOT)

### Settings — Teams Page
- New `/settings/teams` route with dedicated Teams page
- "Add team" button (purple, top right) matching Users page pattern
- Teams table built dynamically from user data (team assignments)
- Search bar and filter icon
- Add team modal with name and organization fields
- All sidebar "Teams" links updated to `/settings/teams`

### LiDAR Viewer Cleanup
- Removed LiDAR legend overlay (ground/building/vegetation/high point color key)

---

## Completed — 2026-03-28 (Session 18)

### Calibration System — Restored
- Calibration code lost due to accidental `git checkout -- server.js` (uncommitted work from Sessions 13/15)
- Rebuilt: full-screen calibration overlay (LiDAR/Satellite/Side-by-Side tabs), zoom/pan, control point placement
- Rebuilt: `GET/PUT /api/projects/:id/calibration` endpoints
- Rebuilt: auto-prompt on first LiDAR load, silent apply on revisit, green icon indicator
- Rebuilt: 4-DOF similarity transform solver (least-squares), applied to ground plane alignment
- Calibrate button added to drawing toolbar (next to LiDAR)

---

## Completed — 2026-03-28 (Session 17)

### Roles — Full Permission Profiles
- Added Proposal Manager, Sales Manager, Sales Rep, Team Manager permission profiles
- Each role has distinct access levels (Assigned-only vs Assigned and team-enabled)
- All 8 roles now have complete permission matrices

### LiDAR Viewer — Height-Based Colors & Near-Orthographic Camera
- Aurora-style height gradient: dark blue (ground) → teal → green → yellow → red (tallest), 0-45ft range
- Switched to narrow FOV (5°) PerspectiveCamera at 800 units — near-orthographic eliminates parallax shift
- Points render in screen-space pixels (`sizeAttenuation: false`) for consistent visibility at any camera distance
- LiDAR opens top-down by default; user can still tilt via ViewCube

### Missing API Routes
- Added `GET /api/geocode` and `GET /api/satellite` — were referenced by client code but never defined as Express routes

---

## Completed — 2026-03-28 (Session 16)

### Tree Placement Tool
- Trees menu item in left panel Site tab activates tree placement mode (click or press T)
- Click ground plane to place tree center, drag outward to set canopy radius
- On release, tree height auto-snaps to LiDAR DSM elevation data (samples max elevation in canopy radius)
- Tree rendered as brown cylinder trunk (bottom 30%) + green sphere canopy (top 70%)
- Escape key or re-clicking Trees exits tree mode
- Elevation grid stored globally from LiDAR load for height queries
- OrbitControls disabled during tree mode to prevent pan conflicts

### ViewCube Labels
- Bottom face label changed from "BTM" to "BOT"
- Cardinal directions reoriented: front=S, back=N, left=W, right=E (die-on-table perspective)

### Known Issue — Pan Sensitivity
- Left-click pan (OrbitControls) sensitivity does not respond to `panSpeed` changes
- Root cause: camera uses FOV 50 at Y=80 but OrbitControls pan math may be dominated by internal distance calculations or the pan handler may not be the one actually executing (multiple overlapping mousedown listeners on canvas)
- `panSpeed` was tested at values from 0.01 to 4.0 with no visible effect
- Spacebar+drag custom pan has separate scale factor (`dist / 60000`) — also needs tuning
- **Needs investigation**: check if OrbitControls is actually handling the pan (vs one of the custom mousedown handlers intercepting first), check Three.js version's pan implementation, consider replacing OrbitControls pan entirely with a from-scratch raycaster-based pan

---

## Completed — 2026-03-28 (Session 15)

### Calibration UX Overhaul
- Full-screen single-image calibration view replacing cramped side-by-side layout
- Tab switcher: LiDAR Image / Satellite Image / Side by Side — each view fills available space
- Zoom: scroll wheel (gentle sensitivity), +/− buttons, Fit reset, up to 10x magnification
- Pan: Space+drag to pan around zoomed image, cursor changes to grab hand
- Crosshair overlay for precise point placement
- Unlimited calibration points (minimum 4) — more points = better least-squares accuracy
- Dynamic UI shows point count, target matching, and confirm button with pair count
- Markers and connecting lines scale inversely with zoom to stay readable at any level
- Auto-switches to Satellite tab after 4 LiDAR points; designer can freely switch back to add more
- Polygon closes at 3+ points for visual feedback

### Calibration Workflow Improvements
- Auto-loads LiDAR on design page entry — no need to click LiDAR button first
- Auto-prompts calibration if no saved calibration exists for the project
- Saved calibrations silently applied on subsequent visits (no re-prompt)
- Calibrate button moved from drawing toolbar to top toolbar (next to LiDAR button)
- Calibrate icon turns green when calibration is active/applied

### Layout
- ViewCube moved from bottom-left to bottom-right

---

## Completed — 2026-03-28 (Session 14)

### LiDAR Viewer — Aurora-Style Restyle
- Teal/cyan/blue color palette replacing height-based rainbow (matches Aurora Solar look)
- Round circle sprite points with dynamic world-space sizing based on camera distance
- Reduced point density for cleaner appearance; removed legend overlay

### Nav Rail Redesign
- Rail matches expanded drawer: logo (opens drawer), Projects, Database, Settings, Partners
- Consistent across all pages

### Partners Section
- `/partners` list page with 14 sample partners, search, type/status columns
- `/partners/new` 3-step wizard (Create org → Customize settings → Add users/teams)

### Settings — Users & Roles
- `/settings/users/:uid` user detail page with real data from users.json
- `/settings/roles` list page with 8 roles and metadata columns
- `/settings/roles/:roleName` detail page with full permissions matrix (Y/N/D indicators, collapsible sections)
- Permission profiles for Admin, Team Member, Limited Team Member, Commercial Partner

### Misc Fixes
- Design page nav submenu persistence fix (closeAllSubmenus on tab switch)
- Removed top bar `···` menu button on project profile (kept sidebar one)

---

## Completed — 2026-03-28 (Session 13)

### Satellite/LiDAR Alignment — Projection & Calibration
- Web Mercator projection replaces equirectangular approximation in `geoToLocal`/`localToGeo`
- Ground plane sizing fixed (removed `cos(lat)` factor causing scale mismatch)
- Texture swap on existing plane (no replacement) — eliminates 20ft positional shift bug
- `computeAlignmentUVs` rewritten for Mercator-consistent UV mapping; NCC search window widened to ±32px
- `/api/imagery/info` returns `projection` field per provider (webmercator, ortho)

### Manual 2D Calibration System
- Mandatory calibration overlay on first LiDAR load (skipped if saved calibration exists)
- Side-by-side canvases: Google Maps satellite + Solar API co-registered RGB
- User marks 4+ matching house corners — numbered markers with connecting lines
- Auto-detected roof corners from LiDAR (convex hull of building-class points, angle filtering)
- Similarity transform solver (4-DOF: translation + scale + rotation) via least-squares
- Transform applied to ground plane for pixel-perfect alignment
- Re-calibrate toolbar button for adjustments
- Calibration persisted per project via `GET/PUT /api/projects/:id/calibration`

---

## Completed — 2026-03-28 (Session 12)

### 3D Viewer — Navigation & Alignment
- ViewCube tilt bug fixed (heading locked at 0° tilt)
- Spacebar + drag pans camera parallel to ground plane
- High-res satellite imagery aligned to LiDAR via analytical UV mapping + NCC cross-correlation refinement
- Ground plane sized to LiDAR bbox with custom UVs — no more independent size calculations drifting apart
- Solar API co-registered RGB used as ground truth for sub-pixel alignment correction
- Server uses actual GeoTIFF resolution instead of hardcoded 0.5m pixel assumption
- Provider-agnostic: alignment works with any imagery source (Google, Nearmap, EagleView)

---

## Completed — 2026-03-28 (Session 10)

### LiDAR Viewer — Major UX Overhaul
- Point cloud density 2-3x increased via sub-pixel interpolation and reduced ground thinning
- Height-based color scale: blue → green → orange → red (with ft thresholds at 40/80/90 ft)
- ViewCube fully integrated in LiDAR mode — same drag/click/slider behavior as 2D map
- All navigation through ViewCube (disabled direct canvas OrbitControls for consistent UX)
- Camera syncs from 2D map perspective on LiDAR open (tilt, heading, zoom)
- Loading overlay with blur + spinner replaces blank blue screen during data fetch
- Satellite ground plane matches viewer aspect ratio at zoom 20 (high-res, same as 2D map)
- LiDAR button moved to top-left nav menu (removed from bottom toolbar)
- Scroll-to-zoom on 3D canvas

---

## Completed — 2026-03-27 (Session 9)

### Authentication & Users
- **Login system** — Login page at `/login`, session cookie auth (persisted to `data/sessions.json`), 30-day remember-me, `/logout` route
- **User data model** — `data/users.json` with 6 users (admin, juliana, marcus, sarah, derek, lisa) — username/password/role/team/license/status
- **Users & Licenses settings page** — `/settings/users` with user table, summary stats, Add/Edit modal with full CRUD via `/api/users` endpoints
- **Profile uses logged-in user** — Settings user profile page dynamically shows the authenticated user's data
- **Nav drawer & design tool dropdowns** — "My profile" → `/settings`, "Logout" → `/logout` wired up

### UI Improvements
- **Rename modal** — CRM row menu and project detail sidebar rename now open a centered modal (matching Aurora UI) instead of browser `prompt()`
- **ViewCube face labels fixed** — Swapped N/S/E/W to match actual rotation heading; removed CSS transition that caused spinning correction
- **Design tool Site tab** — New Site tab (default) with Roof, Obstructions, Trees, Components menu items and flyout submenus; house icon; System tab unchanged
- **Routing audit** — `ROUTING.md` created with 70 non-functional clickable elements catalogued across all pages

### Settings
- **Users & licenses sidebar link** — Now routes to `/settings/users` instead of dead `/settings` link

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
