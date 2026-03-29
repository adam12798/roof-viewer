# Routing Audit — Non-Functional Clickable Elements

All buttons, links, tabs, and clickable elements outside of Design Mode that are not currently wired to any route or action.

**Last audited:** 2026-03-28 (Session 15)

**Original count:** 71 items
**Fixed:** 18 items (25%)
**Still broken:** 53 items (75%)

---

## NAV DRAWER — ALL FIXED

| # | Label | Status | Notes |
|---|-------|--------|-------|
| 1 | "Database" | FIXED | `href="/database"` — real route |
| 2 | "Partners" | FIXED | `href="/partners"` — real route |
| 3 | "My profile" | FIXED | `href="/settings"` — valid route |
| 4 | "Logout" | FIXED | `href="/logout"` — real route |

## LEFT RAIL

| # | Label | Status | Notes |
|---|-------|--------|-------|
| 5 | List view button (list icon) | BROKEN | `href="/"` — duplicates Projects, no distinct view |
| 6 | Account button (person icon) | BROKEN | `href="/"` — no account page exists |

## CRM ROW CONTEXT MENU

| # | Label | Status | Notes |
|---|-------|--------|-------|
| 7 | "Reassign" | PARTIAL | API endpoint exists but frontend still shows `alert('Reassign coming soon.')` |
| 8 | "Archive" | FIXED | Working `archiveProject()` function + API endpoint |

## PROJECT DETAIL — TOP HEADER

| # | Label | Status | Notes |
|---|-------|--------|-------|
| 9 | Notifications bell | FIXED | `toggleDropdown('notifWrap', event)` — working dropdown |
| 10 | Avatar circle | FIXED | `toggleDropdown('profileWrap', event)` — working dropdown |

## PROJECT DETAIL — SUB-HEADER

| # | Label | Status | Notes |
|---|-------|--------|-------|
| 11 | "..." more button | BROKEN | No menu/dropdown handler |
| 12 | "Remote Assessment Completed" dropdown | BROKEN | Styled as dropdown with chevron, not clickable |
| 13 | "Juliana Imeraj" assignee dropdown | BROKEN | Styled as dropdown with chevron, not clickable |

## PROJECT DETAIL — DASHBOARD TAB

| # | Label | Status | Notes |
|---|-------|--------|-------|
| 14 | "City of Waltham →" link | BROKEN | `href="#"` |
| 15 | "+ New design" button | FIXED | `createNewDesignFromDashboard()` — working |
| 16 | "..." more on design row | BROKEN | Stops propagation but opens nothing |
| 17 | "Learn more about drone mapping →" | BROKEN | `href="#"` |
| 18 | "Import files" button | BROKEN | No onclick |
| 19 | "EagleView" link | BROKEN | `href="#"` |
| 20 | "Expert Models" link | BROKEN | `href="#"` |
| 21 | "Create new request" button | BROKEN | No onclick |
| 22 | "+ New form" button | BROKEN | No onclick |
| 23 | "Learn more about our plan set service →" | BROKEN | `href="#"` |
| 24 | "Request stamp" button | BROKEN | No onclick |

## PROJECT DETAIL — DESIGNS TAB

| # | Label | Status | Notes |
|---|-------|--------|-------|
| 25 | "EagleView" link | BROKEN | `href="#"` |
| 26 | "Expert Models" link | BROKEN | `href="#"` |
| 27 | "Create new request" button | BROKEN | No onclick |
| 28 | "Learn more about drone mapping →" | BROKEN | `href="#"` |
| 29 | "Import files" button | BROKEN | No onclick |
| 30 | "..." more on Design 1 card | BROKEN | Prevents events but opens nothing |
| 31 | Pagination Prev/Next buttons | BROKEN | No handlers, decorative only |

## PROJECT DETAIL — ENERGY TAB

| # | Label | Status | Notes |
|---|-------|--------|-------|
| 32 | "Add interval data" button | BROKEN | No onclick |
| 33 | "Go to designs" link | BROKEN | `href="#"` |
| 34 | "Edit existing appliances" button | BROKEN | Hidden, no onclick |
| 35 | "Energy bill ($)" tab | FIXED | `onclick="setETab(this)"` — functional tab toggle |

## PROJECT DETAIL — CUSTOMER PROFILE TAB

| # | Label | Status | Notes |
|---|-------|--------|-------|
| 36 | First name input | BROKEN | Editable but never saved |
| 37 | Last name input | BROKEN | Editable but never saved |
| 38 | Phone input | BROKEN | Editable but never saved |
| 39 | Email input | BROKEN | Editable but never saved |
| 40 | Country flag dropdown | BROKEN | cursor:pointer but no handler |
| 41 | "View jurisdiction" link | BROKEN | `href="#"` |

## PROJECT DETAIL — DOCUMENTS TAB

| # | Label | Status | Notes |
|---|-------|--------|-------|
| 42 | "Design 1" dropdown button | BROKEN | No onclick |
| 43 | "Create proposal" (Web) | BROKEN | No handler |
| 44 | "Create proposal" (PDF) | BROKEN | No handler |
| 45 | "New" (Agreements) | BROKEN | No handler |
| 46 | "New" (Legacy Agreements) | BROKEN | No handler |
| 47 | "View and download" (Shade report) | BROKEN | No handler |

## PROJECT DETAIL — SIDEBAR & DESIGN DROPDOWN

| # | Label | Status | Notes |
|---|-------|--------|-------|
| 48 | Delete action | FIXED | Redirects to `/` (was `/crm`) |
| 49 | Archive action | FIXED | Redirects to `/` (was `/crm`) |
| 50 | "+ Create new design" | FIXED | `createNewDesign()` — working |

## SALES MODE

| # | Label | Status | Notes |
|---|-------|--------|-------|
| 51 | "Let's Get Started" CTA | BROKEN | No onclick handler |

## SETTINGS PAGE

| # | Label | Status | Notes |
|---|-------|--------|-------|
| 52 | "Edit" button | BROKEN | `alert('Edit coming soon!')` — placeholder |
| 53 | "Organization profile" sidebar | BROKEN | Links to `/settings` — no distinct content |
| 54 | "Apps" sidebar | BROKEN | Links to `/settings` — no distinct content |
| 55 | "Users and licenses" sidebar | FIXED | Links to `/settings/users` — distinct route |
| 56 | "Roles" sidebar | FIXED | Links to `/settings/roles` — distinct route |
| 57 | "Teams" sidebar | BROKEN | Links to `/settings` — no distinct content |
| 58 | "Pricing defaults" sidebar | BROKEN | Links to `/settings` — no distinct content |
| 59 | "Financing" sidebar | BROKEN | Links to `/settings` — no distinct content |
| 60 | "Utility and tax rates" sidebar | BROKEN | Links to `/settings` — no distinct content |
| 61 | "Statuses and warnings" sidebar | BROKEN | Links to `/settings` — no distinct content |
| 62 | "Design" sidebar | BROKEN | Links to `/settings` — no distinct content |
| 63 | "Financing integrations" sidebar | BROKEN | Links to `/settings` — no distinct content |
| 64 | "Performance simulations" sidebar | BROKEN | Links to `/settings` — no distinct content |
| 65 | "API tokens" sidebar | BROKEN | Links to `/settings` — no distinct content |
| 66 | "Webhooks" sidebar | BROKEN | Links to `/settings` — no distinct content |
| 67 | "Contractor profiles" sidebar | BROKEN | Links to `/settings` — no distinct content |
| 68 | "contact us" link | BROKEN | `href="#"` |

## SETTINGS — LEFT RAIL

| # | Label | Status | Notes |
|---|-------|--------|-------|
| 69 | Rail logo | FIXED | `onclick="window.location='/'"` — goes home |
| 70 | List view rail button | BROKEN | `href="/"` — duplicate of Projects |
| 71 | Account rail button | BROKEN | `href="/settings"` — already on that page |
