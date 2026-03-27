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

#### Other tabs
- [x] Notes, Documents — "Coming soon" placeholder

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

### API Endpoints
| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/geocode?address=` | Geocode address → lat/lng |
| GET | `/api/satellite?lat=&lng=&zoom=` | Proxy satellite image |
| POST | `/api/projects` | Create new project |
| DELETE | `/api/projects/:id` | Delete project |
| PATCH | `/api/projects/:id/rename` | Rename project |

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

## Next Up (not yet built)
- [ ] Solar panel drawing tools on design screen
- [ ] Energy usage chart with real data
- [ ] Reassign project functionality
- [ ] Notes tab
- [ ] Documents tab
- [ ] User authentication
- [ ] Real organization / team management
