# Solar CRM — Roadmap

---

## Planned (Future)

### Design Tool
- **Shading engine** — Build and connect the shading engine to power real production calculations.
- **Production panel — live data** — Wire panel count, annual energy, and energy offset to live system calculations (currently mock data). Depends on shading engine.
- **Bill savings tab** — Build out the Bill savings view in the production panel dropdown.
- **Energy usage** — Allow users to add energy usage data; display alongside production in the monthly bar chart.
- **Flyout submenus — functionality** — Connect Panels (Modules, Ground mounts) and String/connect (AutoStringer, Manual string) flyout items to actual design actions.
- **Setbacks — live enforcement** — Apply setback values from the System settings panel to roof segment drawing in real time.
- **Simulate system** — Connect the Simulate system button to a real simulation backend.

### Settings
- **Edit mode** — Hook up the Edit button on the User Profile settings page to persist real profile updates.
- **Organization profile, Apps, Users & licenses, Roles, Teams** — Build out remaining sidebar settings pages.
- **API tokens & Webhooks** — Implement token management and webhook configuration.

### CRM / Projects
- **Project pipeline stages** — Move projects through stages beyond "Remote Assessment".
- **Milestone timeline** — Build out the milestones/timeline system accessible from the design tool right panel.

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
