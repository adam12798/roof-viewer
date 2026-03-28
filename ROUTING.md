# Routing Audit — Non-Functional Clickable Elements

All buttons, links, tabs, and clickable elements outside of Design Mode that are not currently wired to any route or action. **70 items total.**

---

## NAV DRAWER

| # | Label | Line(s) | Issue | Route TBD |
|---|-------|---------|-------|-----------|
| 1 | "Database" | ~550 | `href="#"` — goes nowhere | |
| 2 | "Partners" | ~558 | `href="#"` — goes nowhere | |
| 3 | "My profile" | ~568 | `href="#"` — goes nowhere | |
| 4 | "Logout" | ~569 | `href="#"` — goes nowhere | |

## LEFT RAIL

| # | Label | Line(s) | Issue | Route TBD |
|---|-------|---------|-------|-----------|
| 5 | List view button (list icon) | ~585 | Links to `/` — duplicate of Projects, no distinct view | |
| 6 | Account button (person icon) | ~596 | Links to `/` — no account page exists | |

## CRM ROW CONTEXT MENU

| # | Label | Line(s) | Issue | Route TBD |
|---|-------|---------|-------|-----------|
| 7 | "Reassign" | ~100 | `alert('Reassign coming soon.')` — placeholder | |
| 8 | "Archive" | ~102 | Sends DELETE instead of archiving — behaves same as Delete | |

## PROJECT DETAIL — TOP HEADER

| # | Label | Line(s) | Issue | Route TBD |
|---|-------|---------|-------|-----------|
| 9 | Notifications bell | ~3035 | No click handler at all | |
| 10 | Avatar circle | ~3038 | cursor:pointer but no handler | |

## PROJECT DETAIL — SUB-HEADER

| # | Label | Line(s) | Issue | Route TBD |
|---|-------|---------|-------|-----------|
| 11 | "..." more button | ~3045 | No handler, no dropdown | |
| 12 | "Remote Assessment Completed" dropdown | ~3050 | Styled as dropdown with chevron, not clickable | |
| 13 | "Juliana Imeraj" assignee dropdown | ~3054 | Styled as dropdown with chevron, not clickable | |

## PROJECT DETAIL — DASHBOARD TAB

| # | Label | Line(s) | Issue | Route TBD |
|---|-------|---------|-------|-----------|
| 14 | "City of Waltham →" link | ~2031 | `href="#"` | |
| 15 | "+ New design" button | ~2065 | No onclick | |
| 16 | "..." more on design row | ~2091 | Stops propagation but does nothing | |
| 17 | "Learn more about drone mapping →" | ~2110 | `href="#"` | |
| 18 | "Import files" button | ~2113 | No onclick | |
| 19 | "EagleView" link | ~2130 | `href="#"` | |
| 20 | "Expert Models" link | ~2130 | `href="#"` | |
| 21 | "Create new request" button | ~2133 | No onclick | |
| 22 | "+ New form" button | ~2144 | No onclick | |
| 23 | "Learn more about our plan set service →" | ~2151 | `href="#"` | |
| 24 | "Request stamp" button | ~2169 | No onclick | |

## PROJECT DETAIL — DESIGNS TAB

| # | Label | Line(s) | Issue | Route TBD |
|---|-------|---------|-------|-----------|
| 25 | "EagleView" link | ~1669 | `href="#"` | |
| 26 | "Expert Models" link | ~1669 | `href="#"` | |
| 27 | "Create new request" button | ~1672 | No onclick | |
| 28 | "Learn more about drone mapping →" | ~1689 | `href="#"` | |
| 29 | "Import files" button | ~1692 | No onclick | |
| 30 | "..." more on Design 1 card | ~1709 | Stops events but opens nothing | |
| 31 | Pagination Prev/Next buttons | ~1740 | No handlers, purely decorative | |

## PROJECT DETAIL — ENERGY TAB

| # | Label | Line(s) | Issue | Route TBD |
|---|-------|---------|-------|-----------|
| 32 | "Add interval data" button | ~1861 | No onclick | |
| 33 | "Go to designs" link | ~1923 | `href="#"` | |
| 34 | "Edit existing appliances" button | ~1914 | No onclick | |
| 35 | "Energy bill ($)" tab | ~1959 | Toggles CSS only, doesn't switch content | |

## PROJECT DETAIL — CUSTOMER PROFILE TAB

| # | Label | Line(s) | Issue | Route TBD |
|---|-------|---------|-------|-----------|
| 36 | First name input | ~2193 | Editable but never saved | |
| 37 | Last name input | ~2195 | Editable but never saved | |
| 38 | Phone input | ~2206 | Editable but never saved | |
| 39 | Email input | ~2211 | Editable but never saved | |
| 40 | Country flag dropdown | ~2205 | cursor:pointer, no handler | |
| 41 | "View jurisdiction" link | ~2244 | `href="#"` | |

## PROJECT DETAIL — DOCUMENTS TAB

| # | Label | Line(s) | Issue | Route TBD |
|---|-------|---------|-------|-----------|
| 42 | "Design 1" dropdown button | ~2265 | Styled as dropdown, no onclick | |
| 43 | "Create proposal" (Web) | ~2279 | No handler | |
| 44 | "Create proposal" (PDF) | ~2284 | No handler | |
| 45 | "New" (Agreements) | ~2297 | No handler | |
| 46 | "New" (Legacy Agreements) | ~2309 | No handler | |
| 47 | "View and download" (Shade report) | ~2320 | No handler | |

## PROJECT DETAIL — SIDEBAR & DESIGN DROPDOWN

| # | Label | Line(s) | Issue | Route TBD |
|---|-------|---------|-------|-----------|
| 48 | Delete action | ~3420 | Redirects to `/crm` which doesn't exist (should be `/`) | |
| 49 | Archive action | ~3426 | Same broken redirect to `/crm` | |
| 50 | "+ Create new design" | ~3071 | No onclick | |

## SALES MODE

| # | Label | Line(s) | Issue | Route TBD |
|---|-------|---------|-------|-----------|
| 51 | "Let's Get Started" CTA | ~7240 | No onclick handler | |

## SETTINGS PAGE

| # | Label | Line(s) | Issue | Route TBD |
|---|-------|---------|-------|-----------|
| 52 | "Edit" button | ~7534 | `alert('Edit coming soon!')` — placeholder | |
| 53 | "Organization profile" sidebar | ~7493 | Links to `/settings` — no distinct content | |
| 54 | "Apps" sidebar | ~7494 | Links to `/settings` — no distinct content | |
| 55 | "Users and licenses" sidebar | ~7499 | Links to `/settings` — no distinct content | |
| 56 | "Roles" sidebar | ~7500 | Links to `/settings` — no distinct content | |
| 57 | "Teams" sidebar | ~7501 | Links to `/settings` — no distinct content | |
| 58 | "Pricing defaults" sidebar | ~7507 | Links to `/settings` — no distinct content | |
| 59 | "Financing" sidebar | ~7508 | Links to `/settings` — no distinct content | |
| 60 | "Utility and tax rates" sidebar | ~7509 | Links to `/settings` — no distinct content | |
| 61 | "Statuses and warnings" sidebar | ~7513 | Links to `/settings` — no distinct content | |
| 62 | "Design" sidebar | ~7514 | Links to `/settings` — no distinct content | |
| 63 | "Financing integrations" sidebar | ~7515 | Links to `/settings` — no distinct content | |
| 64 | "Performance simulations" sidebar | ~7516 | Links to `/settings` — no distinct content | |
| 65 | "API tokens" sidebar | ~7521 | Links to `/settings` — no distinct content | |
| 66 | "Webhooks" sidebar | ~7522 | Links to `/settings` — no distinct content | |
| 67 | "Contractor profiles" sidebar | ~7527 | Links to `/settings` — no distinct content | |
| 68 | "contact us" link | ~7565 | `href="#"` | |

## SETTINGS — LEFT RAIL

| # | Label | Line(s) | Issue | Route TBD |
|---|-------|---------|-------|-----------|
| 69 | Rail logo | ~7460 | No onclick (no nav drawer opener) | |
| 70 | List view rail button | ~7470 | Links to `/` — same as Projects | |
| 71 | Account rail button | ~7481 | Links to `/settings` — already on that page | |
