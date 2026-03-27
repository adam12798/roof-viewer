# Interrupt — Product Roadmap

## Completed This Session

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

## In Progress / Partially Built

- **Sales Mode** — Button and dropdown item exist but no page/route is built. Needs customer-facing presentation view.
- **Design 1 stats** — Cost, Offset, Size all show `$0.00 / 0% / 0 kW`. Need real values from simulation or manual input.
- **Designs table (dashboard)** — Cost shows `$0.00`, size shows `0 kW`. Should pull from saved design data.
- **Notes tab** — Currently shows "Coming soon".
- **Energy usage tab** — Currently shows "Coming soon".

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
- [ ] **Shading analysis** — Per-panel shade factor overlay (monthly or annual)
- [ ] **Undo / Redo** — Toolbar buttons exist but need full history stack wired up
- [ ] **Measure tool** — Click-to-measure distances on the map
- [ ] **Irradiance overlay** — Sun/shade gradient heatmap on the roof
- [ ] **Save design** — Persist roof segments, panels, components back to project data
- [ ] **Multiple designs** — Support Design 2, Design 3, etc. per project

### Sales Mode
- [ ] **Sales mode page** — Clean customer-facing view: system size, cost, savings, production chart
- [ ] **Proposal PDF export** — Generate a printable proposal from a design
- [ ] **Financing options** — Show loan, lease, PPA payment estimates
- [ ] **Bill comparison chart** — Current bill vs. projected bill with solar

### CRM / Project Management
- [ ] **Create project flow** — Currently creates via address search; add a proper "New project" form
- [ ] **Customer profile editing** — Save edits made in the customer profile form back to project data
- [ ] **Energy usage tab** — Let user enter monthly bills / kWh usage; connect to production offset calc
- [ ] **Authority Having Jurisdiction (AHJ)** — Wire up real city/county lookup
- [ ] **Stage pipeline** — Make the "Remote Assessment Completed" stage dropdown functional with real stages
- [ ] **Assignee management** — Assign team members to projects; currently hardcoded to "Juliana Imeraj"
- [ ] **Notes tab** — Build out the notes/comments tab
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
- [ ] **Search/filter on CRM** — Filter bar exists visually; wire up actual filtering logic
