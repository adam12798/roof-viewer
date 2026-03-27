require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.GOOGLE_API_KEY;

app.use(express.json());

const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 48" width="32" height="48"><path d="M16 0C7.163 0 0 7.163 0 16c0 12 16 32 16 32s16-20 16-32C32 7.163 24.837 0 16 0z" fill="#4a90e2" stroke="white" stroke-width="2"/><circle cx="16" cy="16" r="7" fill="white"/></svg>`;
const PIN_URL = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(PIN_SVG);

// ── Data helpers ───────────────────────────────────────────────────────────────
function loadProjects() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "data/projects.json"), "utf8")); }
  catch { return []; }
}
function saveProjects(projects) {
  fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "data/projects.json"), JSON.stringify(projects, null, 2));
}
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 5); }

// ── Shared CSS fragments ───────────────────────────────────────────────────────
const BASE_RESET = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: #fff;
    color: #111;
  }
`;

// ── CRM home page ─────────────────────────────────────────────────────────────
app.get("/", (req, res) => {
  const projects = loadProjects();

  function timeAgo(iso) {
    if (!iso) return "—";
    const sec = Math.floor((Date.now() - new Date(iso)) / 1000);
    if (sec < 60) return "Just now";
    if (sec < 3600) return Math.floor(sec/60) + "m ago";
    if (sec < 86400) return Math.floor(sec/3600) + "h ago";
    return Math.floor(sec/86400) + "d ago";
  }

  const rowsData = projects.map((p, i) => `{
    "id":"${p.id}",
    "name":${JSON.stringify(p.projectName || p.customer?.name || "Untitled")},
    "customer":${JSON.stringify(p.customer?.name || "")},
    "address":${JSON.stringify(p.address || "")},
    "type":${JSON.stringify(p.propertyType || "residential")},
    "updated":${JSON.stringify(timeAgo(p.createdAt))}
  }`).join(",");

  const tableRows = projects.map((p, i) => {
    const hasCustomName = !!(p.projectName && p.projectName.trim());
    const name = hasCustomName ? esc(p.projectName) : esc(p.address || "Untitled project");
    const nameStyle = hasCustomName ? "" : "color:#9ca3af;font-style:italic;";
    const customerName = esc(p.customer?.name || "—");
    const address = esc(p.address || "—");
    const isRes = p.propertyType !== "commercial";
    const typeIcon = isRes
      ? `<svg width="16" height="16" fill="#16a34a" viewBox="0 0 24 24"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><polyline points="9 21 9 12 15 12 15 21" fill="white" stroke="none"/></svg>`
      : `<svg width="16" height="16" fill="#6b7280" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="18" rx="1"/></svg>`;
    return `<tr class="data-row" data-id="${p.id}" data-name="${name.toLowerCase()}" data-customer="${customerName.toLowerCase()}" data-address="${address.toLowerCase()}" data-type="${(p.propertyType||'residential').toLowerCase()}">
      <td class="td-check"><input type="checkbox" class="row-check" onchange="updateSelection()"/></td>
      <td class="td-name" onclick="nav('${p.id}')">${name}</td>
      <td class="td-muted" onclick="nav('${p.id}')">—</td>
      <td class="td-addr" onclick="nav('${p.id}')">${address}</td>
      <td onclick="nav('${p.id}')">${typeIcon}</td>
      <td class="td-muted" onclick="nav('${p.id}')">${customerName}</td>
      <td onclick="nav('${p.id}')">
        <div style="width:100px;height:3px;background:#e5e7eb;border-radius:2px;margin-bottom:4px;">
          <div style="width:17%;height:100%;background:#111;border-radius:2px;"></div>
        </div>
        <span style="font-size:0.75rem;color:#6b7280;">Remote Assessment</span>
      </td>
      <td class="td-muted" onclick="nav('${p.id}')">—</td>
      <td class="td-muted" onclick="nav('${p.id}')">—</td>
      <td class="td-muted" onclick="nav('${p.id}')">${timeAgo(p.createdAt)}</td>
      <td onclick="nav('${p.id}')">
        <div style="width:28px;height:28px;border-radius:50%;background:#4a90e2;display:flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;color:#fff;">
          ${(p.customer?.name || "?")[0].toUpperCase()}
        </div>
      </td>
      <td class="td-menu" onclick="event.stopPropagation()">
        <button class="row-menu-btn" onclick="toggleMenu(event,'${p.id}')">···</button>
        <div class="row-menu" id="menu-${p.id}">
          <button class="menu-item" onclick="renameProject('${p.id}')">Rename</button>
          <button class="menu-item" onclick="reassignProject('${p.id}')">Reassign</button>
          <div class="menu-divider"></div>
          <button class="menu-item" onclick="archiveProject('${p.id}')">Archive</button>
          <button class="menu-item danger" onclick="deleteProject('${p.id}')">Delete</button>
        </div>
      </td>
    </tr>`;
  }).join("");

  const emptyRow = `<tr><td colspan="12" style="text-align:center;padding:64px 20px;color:#9ca3af;font-size:0.9rem;">
    No projects yet. <a href="/new" style="color:#111;font-weight:600;text-decoration:underline;">Create your first →</a>
  </td></tr>`;

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Projects — Solar CRM</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #fff;
      color: #111;
      display: flex;
      height: 100vh;
      overflow: hidden;
    }

    /* ── Dark left rail ── */
    .rail {
      width: 52px;
      background: #1a0828;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 14px 0;
      gap: 6px;
      flex-shrink: 0;
    }
    .rail-logo {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg,#c084fc,#818cf8);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 10px;
      flex-shrink: 0;
    }
    .rail-btn {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #7c5fa0;
      transition: all 0.15s;
      border: none;
      background: none;
      text-decoration: none;
    }
    .rail-btn:hover, .rail-btn.active { background: #2d1045; color: #e2d4f0; }

    /* ── Main area ── */
    .main { flex: 1; display: flex; flex-direction: column; overflow: hidden; }

    /* ── Top bar ── */
    .topbar {
      height: 52px;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding: 0 24px;
      flex-shrink: 0;
      gap: 12px;
    }
    .btn-new {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 8px 16px;
      background: #111;
      color: #fff;
      border-radius: 7px;
      font-size: 0.85rem;
      font-weight: 600;
      text-decoration: none;
      transition: background 0.15s;
    }
    .btn-new:hover { background: #333; }

    /* ── Content ── */
    .content { flex: 1; overflow-y: auto; padding: 28px 28px 20px; }

    .page-title {
      font-size: 1.7rem;
      font-weight: 700;
      color: #111;
      margin-bottom: 20px;
    }

    /* ── Toolbar (search + filter) ── */
    .toolbar {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 16px;
    }
    .search-wrap {
      position: relative;
      flex: 0 0 220px;
    }
    .search-wrap svg {
      position: absolute;
      left: 10px;
      top: 50%;
      transform: translateY(-50%);
      color: #9ca3af;
      pointer-events: none;
    }
    .search-wrap input {
      width: 100%;
      padding: 8px 12px 8px 32px;
      border: 1px solid #e5e7eb;
      border-radius: 7px;
      font-size: 0.85rem;
      color: #111;
      background: #fff;
      outline: none;
    }
    .search-wrap input:focus { border-color: #9ca3af; }
    .search-wrap input::placeholder { color: #9ca3af; }
    .filter-wrap { position: relative; }
    .filter-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border: 1px solid #e5e7eb;
      border-radius: 7px;
      background: #fff;
      font-size: 0.83rem;
      color: #6b7280;
      cursor: pointer;
      transition: all 0.15s;
    }
    .filter-btn:hover, .filter-btn.active { border-color: #9ca3af; color: #111; background: #f9fafb; }

    /* Filter panel */
    .filter-panel {
      display: none;
      position: absolute;
      top: calc(100% + 6px);
      left: 0;
      width: 340px;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.1);
      z-index: 200;
      overflow: hidden;
    }
    .filter-panel.open { display: block; }

    .filter-tabs {
      display: flex;
      border-bottom: 1px solid #e5e7eb;
      overflow-x: auto;
      padding: 0 4px;
    }
    .filter-tab {
      padding: 10px 12px;
      font-size: 0.82rem;
      color: #6b7280;
      cursor: pointer;
      border: none;
      background: none;
      border-bottom: 2px solid transparent;
      margin-bottom: -1px;
      white-space: nowrap;
      transition: all 0.12s;
    }
    .filter-tab:hover { color: #111; }
    .filter-tab.active { color: #111; font-weight: 600; border-bottom-color: #111; }

    .filter-search-wrap {
      padding: 10px 12px;
      border-bottom: 1px solid #f3f4f6;
      position: relative;
    }
    .filter-search-wrap svg {
      position: absolute; left: 22px; top: 50%; transform: translateY(-50%); color: #9ca3af;
    }
    .filter-search-input {
      width: 100%; padding: 7px 10px 7px 32px;
      border: 1px solid #e5e7eb; border-radius: 6px;
      font-size: 0.83rem; color: #111; outline: none; background: #f9fafb;
    }
    .filter-search-input:focus { border-color: #9ca3af; background: #fff; }
    .filter-search-input::placeholder { color: #9ca3af; }

    .filter-count { padding: 8px 14px 4px; font-size: 0.75rem; color: #9ca3af; }

    .filter-options { max-height: 220px; overflow-y: auto; padding: 4px 0; }
    .filter-option {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 14px; cursor: pointer; transition: background 0.08s;
    }
    .filter-option:hover { background: #f9fafb; }
    .filter-option input[type="checkbox"] {
      width: 15px; height: 15px; accent-color: #7c3aed; cursor: pointer; flex-shrink: 0;
    }
    .filter-option label { font-size: 0.85rem; color: #374151; cursor: pointer; }

    .filter-footer {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px;
      border-top: 1px solid #e5e7eb;
    }
    .filter-apply {
      font-size: 0.83rem; font-weight: 600; color: #374151;
      background: none; border: none; cursor: pointer; padding: 4px 0;
    }
    .filter-apply:hover { color: #111; }
    .filter-clear {
      font-size: 0.83rem; color: #9ca3af;
      background: none; border: none; cursor: pointer; padding: 4px 0;
    }
    .filter-clear:hover { color: #374151; }
    .bulk-bar {
      display: none;
      align-items: center;
      gap: 10px;
      margin-left: auto;
      font-size: 0.83rem;
      color: #6b7280;
    }
    .bulk-bar.visible { display: flex; }
    .bulk-action {
      padding: 6px 12px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      background: #fff;
      font-size: 0.82rem;
      color: #374151;
      cursor: pointer;
    }
    .bulk-action:hover { background: #f9fafb; }

    /* ── Table ── */
    .table-wrap { border: 1px solid #e5e7eb; border-radius: 10px; overflow: hidden; }
    table { width: 100%; border-collapse: collapse; }
    thead th {
      text-align: left;
      font-size: 0.72rem;
      font-weight: 600;
      color: #9ca3af;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      padding: 10px 14px;
      background: #fff;
      border-bottom: 1px solid #e5e7eb;
      white-space: nowrap;
    }
    th.th-check, td.td-check {
      width: 40px;
      padding: 10px 8px 10px 16px;
    }
    tbody tr.data-row {
      border-bottom: 1px solid #f3f4f6;
      transition: background 0.08s;
      cursor: pointer;
    }
    tbody tr.data-row:last-child { border-bottom: none; }
    tbody tr.data-row:hover { background: #fafafa; }
    tbody tr.data-row.selected { background: #f5f3ff; }
    tbody td { padding: 12px 14px; vertical-align: middle; font-size: 0.85rem; }
    .td-name { font-weight: 600; color: #111; min-width: 160px; }
    .td-muted { color: #9ca3af; }
    .td-addr { color: #6b7280; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    input[type="checkbox"] {
      width: 15px; height: 15px; cursor: pointer;
      accent-color: #7c3aed;
    }

    .no-results { display: none; text-align: center; padding: 48px; color: #9ca3af; font-size: 0.9rem; }

    /* Row menu */
    td.td-menu { width: 40px; padding: 0 8px; text-align: center; position: relative; }
    .row-menu-btn {
      background: none; border: none; cursor: pointer;
      font-size: 1.1rem; color: #9ca3af; padding: 4px 8px; border-radius: 6px;
      opacity: 0; transition: opacity 0.1s, background 0.1s;
      letter-spacing: 1px;
    }
    .data-row:hover .row-menu-btn { opacity: 1; }
    .row-menu-btn:hover { background: #f3f4f6; color: #374151; }
    .row-menu {
      display: none; position: absolute; right: 4px; top: 100%; z-index: 100;
      background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.1); min-width: 150px; padding: 4px 0;
    }
    .row-menu.open { display: block; }
    .menu-item {
      display: block; width: 100%; text-align: left;
      padding: 8px 14px; border: none; background: none;
      font-size: 0.85rem; color: #374151; cursor: pointer;
    }
    .menu-item:hover { background: #f9fafb; }
    .menu-item.danger { color: #dc2626; }
    .menu-item.danger:hover { background: #fef2f2; }
    .menu-divider { border-top: 1px solid #e5e7eb; margin: 4px 0; }
  </style>
</head>
<body>

  <!-- Dark left rail -->
  <nav class="rail">
    <div class="rail-logo">
      <svg width="18" height="18" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
      </svg>
    </div>
    <a class="rail-btn active" href="/" title="Projects">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    </a>
    <a class="rail-btn" href="/" title="List">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
        <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
      </svg>
    </a>
    <a class="rail-btn" href="/" title="Settings" style="margin-top:auto;">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
      </svg>
    </a>
    <a class="rail-btn" href="/" title="Account">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
      </svg>
    </a>
  </nav>

  <!-- Main content -->
  <div class="main">
    <div class="topbar">
      <a class="btn-new" href="/new">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        New project
      </a>
    </div>

    <div class="content">
      <div class="page-title">Projects</div>

      <div class="toolbar">
        <div class="search-wrap">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="text" id="searchInput" placeholder="Search" oninput="filterRows()"/>
        </div>
        <div class="filter-wrap">
          <button class="filter-btn" id="filterBtn" onclick="toggleFilterPanel()">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
            </svg>
            Filter
          </button>
          <div class="filter-panel" id="filterPanel">
            <!-- Tabs -->
            <div class="filter-tabs">
              <button class="filter-tab active" onclick="setFilterTab(this,'type')">Type</button>
              <button class="filter-tab" onclick="setFilterTab(this,'status')">Status</button>
              <button class="filter-tab" onclick="setFilterTab(this,'teams')">Teams</button>
              <button class="filter-tab" onclick="setFilterTab(this,'orgs')">Organizations</button>
              <button class="filter-tab" onclick="setFilterTab(this,'general')">General</button>
            </div>
            <!-- Search -->
            <div class="filter-search-wrap">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
              </svg>
              <input class="filter-search-input" id="filterSearch" placeholder="Search" oninput="filterOptionSearch()"/>
            </div>
            <div class="filter-count" id="filterCount">Showing ${projects.length} of ${projects.length}</div>
            <!-- Options -->
            <div class="filter-options" id="filterOptions">
              <!-- Populated by JS based on active tab -->
            </div>
            <div class="filter-footer">
              <button class="filter-apply" onclick="applyFilter()">Apply filter</button>
              <button class="filter-clear" onclick="clearFilter()">Clear</button>
            </div>
          </div>
        </div>
        <div class="bulk-bar" id="bulkBar">
          <span id="selCount">0 selected</span>
          <button class="bulk-action" onclick="deselectAll()">Deselect all</button>
        </div>
      </div>

      <div class="table-wrap">
        <table id="projectTable">
          <thead>
            <tr>
              <th class="th-check"><input type="checkbox" id="selectAll" onchange="toggleAll(this)"/></th>
              <th>Name</th>
              <th>Updates</th>
              <th>Address</th>
              <th>Type</th>
              <th>Customer name</th>
              <th>Status</th>
              <th>Organization</th>
              <th>Team</th>
              <th>Last updated</th>
              <th>Assignee</th>
              <th style="width:48px;"></th>
            </tr>
          </thead>
          <tbody id="tableBody">
            ${projects.length ? tableRows : emptyRow}
          </tbody>
        </table>
        <div class="no-results" id="noResults">No projects match your search.</div>
      </div>
    </div>
  </div>

  <script>
    function nav(id) { window.location = '/project/' + id; }

    function filterRows() {
      var q = document.getElementById('searchInput').value.toLowerCase().trim();
      var rows = document.querySelectorAll('.data-row');
      var visible = 0;
      rows.forEach(function(row) {
        var text = (row.dataset.name + ' ' + row.dataset.customer + ' ' + row.dataset.address).toLowerCase();
        var show = !q || text.includes(q);
        row.style.display = show ? '' : 'none';
        if (show) visible++;
      });
      document.getElementById('noResults').style.display = (visible === 0 && q) ? 'block' : 'none';
    }

    function toggleAll(cb) {
      document.querySelectorAll('.row-check').forEach(function(c) { c.checked = cb.checked; });
      updateSelection();
    }

    function updateSelection() {
      var checked = document.querySelectorAll('.row-check:checked').length;
      var total = document.querySelectorAll('.row-check').length;
      document.getElementById('selectAll').checked = checked === total && total > 0;
      document.getElementById('selectAll').indeterminate = checked > 0 && checked < total;
      document.getElementById('selCount').textContent = checked + ' selected';
      document.getElementById('bulkBar').classList.toggle('visible', checked > 0);
      document.querySelectorAll('.data-row').forEach(function(row) {
        row.classList.toggle('selected', row.querySelector('.row-check').checked);
      });
    }

    function deselectAll() {
      document.querySelectorAll('.row-check').forEach(function(c) { c.checked = false; });
      document.getElementById('selectAll').checked = false;
      document.getElementById('selectAll').indeterminate = false;
      updateSelection();
    }

    // ── Filter panel ──────────────────────────────────────────────────────────
    var filterTab = 'type';
    var activeFilters = { type: [], status: [] };

    var filterData = {
      type: ['Residential', 'Commercial'],
      status: ['Remote Assessment Completed', 'Permit Submitted', 'Installation Scheduled', 'Completed'],
      teams: ['Team Sunshine', 'Team Alpha', 'Team Beta'],
      orgs: ['Internal', 'Green Enterprises'],
      general: ['Has assignee', 'No assignee', 'Created this week', 'Created this month']
    };

    function toggleFilterPanel() {
      var panel = document.getElementById('filterPanel');
      var btn = document.getElementById('filterBtn');
      var isOpen = panel.classList.contains('open');
      panel.classList.toggle('open', !isOpen);
      btn.classList.toggle('active', !isOpen);
      if (!isOpen) renderFilterOptions();
    }

    function setFilterTab(el, tab) {
      filterTab = tab;
      document.querySelectorAll('.filter-tab').forEach(function(t) { t.classList.remove('active'); });
      el.classList.add('active');
      document.getElementById('filterSearch').value = '';
      renderFilterOptions();
    }

    function renderFilterOptions(query) {
      query = (query || '').toLowerCase();
      var opts = filterData[filterTab] || [];
      var html = opts.filter(function(o) { return !query || o.toLowerCase().includes(query); })
        .map(function(o) {
          var checked = (activeFilters[filterTab] || []).includes(o) ? 'checked' : '';
          return '<label class="filter-option"><input type="checkbox" ' + checked + ' onchange="toggleFilterVal(\\'' + o + '\\')" /><span style="font-size:0.85rem;color:#374151;">' + o + '</span></label>';
        }).join('');
      document.getElementById('filterOptions').innerHTML = html || '<div style="padding:16px 14px;font-size:0.83rem;color:#9ca3af;">No options</div>';
    }

    function filterOptionSearch() {
      renderFilterOptions(document.getElementById('filterSearch').value);
    }

    function toggleFilterVal(val) {
      if (!activeFilters[filterTab]) activeFilters[filterTab] = [];
      var idx = activeFilters[filterTab].indexOf(val);
      if (idx === -1) activeFilters[filterTab].push(val);
      else activeFilters[filterTab].splice(idx, 1);
    }

    function applyFilter() {
      var types = activeFilters['type'] || [];
      document.querySelectorAll('.data-row').forEach(function(row) {
        var rowType = row.getAttribute('data-type') || '';
        var typeMatch = types.length === 0 || types.some(function(t) { return rowType.toLowerCase().includes(t.toLowerCase()); });
        row.style.display = typeMatch ? '' : 'none';
      });
      document.getElementById('filterPanel').classList.remove('open');
      document.getElementById('filterBtn').classList.remove('active');
      var btn = document.getElementById('filterBtn');
      var hasActive = Object.values(activeFilters).some(function(a) { return a.length > 0; });
      btn.style.borderColor = hasActive ? '#7c3aed' : '';
      btn.style.color = hasActive ? '#7c3aed' : '';
    }

    function clearFilter() {
      activeFilters = { type: [], status: [], teams: [], orgs: [], general: [] };
      renderFilterOptions();
      document.querySelectorAll('.data-row').forEach(function(row) { row.style.display = ''; });
      var btn = document.getElementById('filterBtn');
      btn.style.borderColor = '';
      btn.style.color = '';
    }

    // Close filter panel on outside click
    document.addEventListener('click', function(e) {
      var wrap = document.querySelector('.filter-wrap');
      if (wrap && !wrap.contains(e.target)) {
        document.getElementById('filterPanel').classList.remove('open');
        document.getElementById('filterBtn').classList.remove('active');
      }
    });

    function toggleMenu(e, id) {
      var menu = document.getElementById('menu-' + id);
      var isOpen = menu.classList.contains('open');
      // close all open menus
      document.querySelectorAll('.row-menu.open').forEach(function(m) { m.classList.remove('open'); });
      if (!isOpen) menu.classList.add('open');
    }

    // Close menus when clicking outside
    document.addEventListener('click', function() {
      document.querySelectorAll('.row-menu.open').forEach(function(m) { m.classList.remove('open'); });
    });

    function renameProject(id) {
      var row = document.querySelector('[data-id="' + id + '"]');
      var nameCell = row ? row.querySelector('.td-name') : null;
      var current = nameCell ? nameCell.textContent.trim() : '';
      var newName = prompt('Rename project:', current);
      if (newName && newName.trim() && newName.trim() !== current) {
        fetch('/api/projects/' + id + '/rename', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName.trim() })
        }).then(function(r) { if (r.ok) location.reload(); });
      }
    }

    function reassignProject(id) {
      alert('Reassign coming soon.');
    }

    function archiveProject(id) {
      if (confirm('Archive this project?')) {
        fetch('/api/projects/' + id, { method: 'DELETE', headers: { 'X-Action': 'archive' } })
          .then(function(r) { if (r.ok) location.reload(); });
      }
    }

    function deleteProject(id) {
      if (confirm('Permanently delete this project? This cannot be undone.')) {
        fetch('/api/projects/' + id, { method: 'DELETE' })
          .then(function(r) { if (r.ok) location.reload(); });
      }
    }
  </script>

</body>
</html>`);
});

// ── New project form ───────────────────────────────────────────────────────────
app.get("/new", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>New Project — Solar CRM</title>
  <style>
    ${BASE_RESET}
    body {
      display: flex;
      flex-direction: column;
      height: 100vh;
      overflow: hidden;
    }
    .topbar {
      height: 52px;
      background: #fff;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      position: relative;
    }
    .topbar-title { font-size: 0.9rem; font-weight: 600; color: #111; }
    .topbar-back {
      position: absolute;
      left: 24px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      font-size: 0.85rem;
      color: #6b7280;
      text-decoration: none;
      transition: color 0.15s;
    }
    .topbar-back:hover { color: #111; }

    .split { display: flex; flex: 1; min-height: 0; }

    /* Left panel */
    .form-panel {
      width: 54%;
      padding: 48px 64px;
      overflow-y: auto;
      background: #fff;
    }
    .form-panel h2 { font-size: 1.5rem; font-weight: 700; color: #111; margin-bottom: 32px; }

    .field { margin-bottom: 20px; }
    .field label {
      display: block;
      font-size: 0.8rem;
      font-weight: 600;
      color: #374151;
      margin-bottom: 6px;
      text-transform: uppercase;
      letter-spacing: 0.4px;
    }
    .field label .req { color: #ef4444; margin-right: 2px; }

    .input-wrap { position: relative; }
    .input-wrap svg {
      position: absolute;
      left: 11px;
      top: 50%;
      transform: translateY(-50%);
      color: #9ca3af;
      pointer-events: none;
    }
    .input-wrap input {
      width: 100%;
      padding: 10px 14px 10px 36px;
      border: 1px solid #d1d5db;
      border-radius: 7px;
      font-size: 0.9rem;
      color: #111;
      background: #f9fafb;
      outline: none;
      transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
    }
    .input-wrap input:focus {
      border-color: #6b7280;
      background: #fff;
      box-shadow: 0 0 0 3px rgba(107,114,128,0.1);
    }
    .input-wrap input::placeholder { color: #9ca3af; }

    input.plain {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid #d1d5db;
      border-radius: 7px;
      font-size: 0.9rem;
      color: #111;
      background: #f9fafb;
      outline: none;
      transition: border-color 0.15s, background 0.15s, box-shadow 0.15s;
    }
    input.plain:focus {
      border-color: #6b7280;
      background: #fff;
      box-shadow: 0 0 0 3px rgba(107,114,128,0.1);
    }
    input.plain::placeholder { color: #9ca3af; }

    .row-2 { display: flex; gap: 12px; }
    .row-2 .field { flex: 1; margin-bottom: 0; }

    .addr-resolved { font-size: 0.8rem; color: #16a34a; margin-top: 5px; display: none; font-weight: 500; }
    .addr-error { font-size: 0.8rem; color: #dc2626; margin-top: 5px; display: none; }

    /* Toggle */
    .toggle-group { display: flex; gap: 8px; }
    .toggle-btn {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 9px 18px;
      border: 1px solid #d1d5db;
      border-radius: 7px;
      background: #f9fafb;
      font-size: 0.875rem;
      font-weight: 500;
      cursor: pointer;
      color: #6b7280;
      transition: all 0.15s;
    }
    .toggle-btn.active {
      background: #fff;
      border-color: #111;
      color: #111;
      font-weight: 700;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    }

    /* Actions */
    .actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 32px; }
    .btn-cancel {
      background: none;
      border: none;
      font-size: 0.9rem;
      color: #6b7280;
      cursor: pointer;
      padding: 10px 8px;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
    }
    .btn-cancel:hover { color: #111; }
    .btn-create {
      padding: 10px 28px;
      background: #e5e7eb;
      border: none;
      border-radius: 7px;
      font-size: 0.9rem;
      font-weight: 600;
      color: #9ca3af;
      cursor: not-allowed;
      transition: all 0.2s;
    }
    .btn-create.ready { background: #111; color: #fff; cursor: pointer; }
    .btn-create.ready:hover { background: #333; }

    /* Right panel */
    .image-panel {
      flex: 1;
      position: relative;
      background: #060d1f;
      overflow: hidden;
    }
    .image-panel .placeholder {
      position: absolute;
      inset: 0;
    }
  </style>
</head>
<body>

  <div class="topbar">
    <a class="topbar-back" href="/">
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
      Projects
    </a>
    <span class="topbar-title">New project</span>
  </div>

  <div class="split">

    <div class="form-panel">
      <h2>New project</h2>

      <div class="field">
        <label><span class="req">*</span> Property address</label>
        <div class="input-wrap">
          <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="text" id="addrInput" placeholder="Search for an address..." autocomplete="off"/>
        </div>
        <div class="addr-resolved" id="addrResolved"></div>
        <div class="addr-error" id="addrError"></div>
      </div>

      <div class="field">
        <label>Customer name</label>
        <input type="text" class="plain" id="customerName" placeholder="John Smith"/>
      </div>

      <div class="row-2" style="margin-bottom:20px;">
        <div class="field">
          <label>Email</label>
          <input type="email" class="plain" id="customerEmail" placeholder="john@example.com"/>
        </div>
        <div class="field">
          <label>Phone</label>
          <input type="tel" class="plain" id="customerPhone" placeholder="555-555-5555"/>
        </div>
      </div>

      <div class="field">
        <label>Project name</label>
        <input type="text" class="plain" id="projectName" placeholder="e.g. Smith Residence"/>
      </div>

      <div class="field">
        <label>Property type</label>
        <div class="toggle-group">
          <button class="toggle-btn active" id="btnResidential" onclick="setType('residential')">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
              <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><polyline points="9 21 9 12 15 12 15 21"/>
            </svg>
            Residential
          </button>
          <button class="toggle-btn" id="btnCommercial" onclick="setType('commercial')">
            <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" viewBox="0 0 24 24">
              <rect x="2" y="3" width="20" height="18" rx="1"/><line x1="8" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="16" y2="21"/><line x1="2" y1="9" x2="22" y2="9"/><line x1="2" y1="15" x2="22" y2="15"/>
            </svg>
            Commercial
          </button>
        </div>
      </div>

      <div class="actions">
        <a class="btn-cancel" href="/">Cancel</a>
        <button class="btn-create" id="createBtn" disabled>Create</button>
      </div>
    </div>

    <div class="image-panel" id="imagePanel">
      <div class="placeholder" id="placeholder">
        <!-- Iceberg illustration -->
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 700" style="width:100%;height:100%;position:absolute;inset:0;">
          <defs>
            <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#060d1f"/>
              <stop offset="100%" stop-color="#020812"/>
            </linearGradient>
            <linearGradient id="seaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="#0c2044"/>
              <stop offset="100%" stop-color="#04102a"/>
            </linearGradient>
            <linearGradient id="iceCap" x1="0.2" y1="0" x2="0.8" y2="1">
              <stop offset="0%" stop-color="#f0f8ff"/>
              <stop offset="60%" stop-color="#cde8f8"/>
              <stop offset="100%" stop-color="#9dcce8"/>
            </linearGradient>
            <linearGradient id="subIce" x1="0.1" y1="0" x2="0.9" y2="1">
              <stop offset="0%" stop-color="#1a3a6e"/>
              <stop offset="40%" stop-color="#0e2448"/>
              <stop offset="100%" stop-color="#060f22"/>
            </linearGradient>
            <linearGradient id="subIce2" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stop-color="#081830" stop-opacity="0.9"/>
              <stop offset="50%" stop-color="#1a3a6e" stop-opacity="0"/>
              <stop offset="100%" stop-color="#081830" stop-opacity="0.9"/>
            </linearGradient>
            <clipPath id="seaClip">
              <rect x="0" y="265" width="500" height="435"/>
            </clipPath>
          </defs>

          <!-- Background -->
          <rect width="500" height="700" fill="url(#bgGrad)"/>

          <!-- Stars -->
          <circle cx="60" cy="40" r="1" fill="white" opacity="0.5"/>
          <circle cx="130" cy="20" r="1.2" fill="white" opacity="0.4"/>
          <circle cx="200" cy="55" r="0.8" fill="white" opacity="0.6"/>
          <circle cx="320" cy="15" r="1" fill="white" opacity="0.5"/>
          <circle cx="400" cy="45" r="1.2" fill="white" opacity="0.3"/>
          <circle cx="450" cy="80" r="0.8" fill="white" opacity="0.5"/>
          <circle cx="30" cy="100" r="0.9" fill="white" opacity="0.4"/>
          <circle cx="470" cy="130" r="1" fill="white" opacity="0.3"/>
          <circle cx="90" cy="150" r="0.8" fill="white" opacity="0.5"/>
          <circle cx="370" cy="90" r="1" fill="white" opacity="0.4"/>

          <!-- Ice cap (above waterline) — small, jagged, white -->
          <polygon points="
            250,28
            228,65  215,50  200,78  188,60  175,90
            170,120 182,108 190,130 200,115 210,138
            222,125 230,148 240,132 250,155
            260,132 268,148 278,125 288,138
            298,115 308,130 316,108 328,120
            323,90  310,60  298,78  283,50  270,65
          " fill="url(#iceCap)"/>

          <!-- Ice cap shading -->
          <polygon points="250,28 228,65 215,50 200,78 188,60 175,90 170,120 182,108 190,130 200,115 210,138 222,125 230,148 240,132 250,155"
            fill="#a8d4ee" opacity="0.25"/>

          <!-- Waterline transition -->
          <polygon points="
            160,155 168,148 178,160 190,150 200,162
            212,150 224,158 234,148 244,158 250,152
            256,158 266,148 276,158 288,150 300,162
            310,150 320,160 332,148 342,155 340,265
            160,265
          " fill="url(#iceCap)" opacity="0.6"/>

          <!-- Ocean surface -->
          <path d="M0,262 Q62,255 125,262 Q188,270 250,262 Q312,255 375,262 Q438,270 500,262 L500,700 L0,700 Z" fill="url(#seaGrad)"/>

          <!-- Submerged iceberg — very large, dark blue -->
          <polygon points="
            160,265
            340,265
            400,340
            430,430
            420,510
            390,580
            340,630
            280,660
            250,668
            220,660
            160,630
            110,580
            80,510
            70,430
            100,340
          " fill="url(#subIce)"/>

          <!-- Submerged iceberg edge shading -->
          <polygon points="
            160,265 340,265 400,340 430,430 420,510 390,580 340,630 280,660 250,668
          " fill="url(#subIce2)" opacity="0.5"/>

          <!-- Ocean shimmer lines -->
          <path d="M30,278 Q90,272 150,278" stroke="#1a4a8a" stroke-width="1.5" fill="none" opacity="0.35"/>
          <path d="M350,278 Q410,272 470,278" stroke="#1a4a8a" stroke-width="1.5" fill="none" opacity="0.35"/>
          <path d="M20,292 Q80,286 130,292" stroke="#1a4a8a" stroke-width="1" fill="none" opacity="0.2"/>
          <path d="M370,292 Q430,286 480,292" stroke="#1a4a8a" stroke-width="1" fill="none" opacity="0.2"/>

          <!-- Waterline text -->
          <line x1="20" y1="263" x2="145" y2="263" stroke="#2a5a9a" stroke-width="0.8" opacity="0.5" stroke-dasharray="4,4"/>
          <line x1="355" y1="263" x2="480" y2="263" stroke="#2a5a9a" stroke-width="0.8" opacity="0.5" stroke-dasharray="4,4"/>
        </svg>

        <div style="position:absolute;bottom:32px;left:0;right:0;text-align:center;color:#3a5a8a;font-size:0.82rem;letter-spacing:0.5px;">
          Enter an address to preview satellite view
        </div>
      </div>
      <img id="satelliteImg" src="" alt="Satellite view" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity 0.5s ease;"/>
    </div>

  </div>

  <script>
    var confirmedLat = null, confirmedLng = null, confirmedAddress = null;
    var propertyType = 'residential';
    var searchTimer = null;

    function setType(type) {
      propertyType = type;
      document.getElementById('btnResidential').classList.toggle('active', type === 'residential');
      document.getElementById('btnCommercial').classList.toggle('active', type === 'commercial');
    }

    document.getElementById('addrInput').addEventListener('input', function() {
      clearTimeout(searchTimer);
      var val = this.value.trim();
      confirmedLat = null; confirmedLng = null;
      disableCreate();
      if (val.length < 5) return;
      searchTimer = setTimeout(function() { doGeocode(val); }, 600);
    });

    document.getElementById('addrInput').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') { clearTimeout(searchTimer); doGeocode(this.value.trim()); }
    });

    async function doGeocode(address) {
      if (!address) return;
      document.getElementById('addrResolved').style.display = 'none';
      document.getElementById('addrError').style.display = 'none';
      try {
        var res = await fetch('/api/geocode?address=' + encodeURIComponent(address));
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Not found');
        confirmedLat = data.lat;
        confirmedLng = data.lng;
        confirmedAddress = data.formatted_address;

        var el = document.getElementById('addrResolved');
        el.textContent = '✓ ' + confirmedAddress;
        el.style.display = 'block';

        var img = document.getElementById('satelliteImg');
        img.onload = function() {
          document.getElementById('placeholder').style.opacity = '0';
          document.getElementById('placeholder').style.transition = 'opacity 0.5s';
          img.style.opacity = '1';
        };
        img.src = '/api/satellite?lat=' + confirmedLat + '&lng=' + confirmedLng + '&zoom=20';

        enableCreate();
      } catch(err) {
        confirmedLat = null; confirmedLng = null;
        var el = document.getElementById('addrError');
        el.textContent = err.message;
        el.style.display = 'block';
        disableCreate();
      }
    }

    function enableCreate() {
      var btn = document.getElementById('createBtn');
      btn.disabled = false;
      btn.classList.add('ready');
    }
    function disableCreate() {
      var btn = document.getElementById('createBtn');
      btn.disabled = true;
      btn.classList.remove('ready');
    }

    document.getElementById('createBtn').addEventListener('click', async function() {
      if (!confirmedLat) return;
      this.disabled = true;
      this.textContent = 'Creating...';
      try {
        var res = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectName: document.getElementById('projectName').value.trim(),
            propertyType: propertyType,
            address: confirmedAddress,
            lat: confirmedLat,
            lng: confirmedLng,
            customer: {
              name: document.getElementById('customerName').value.trim(),
              email: document.getElementById('customerEmail').value.trim(),
              phone: document.getElementById('customerPhone').value.trim()
            }
          })
        });
        var data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        window.location.href = '/project/' + data.id;
      } catch(err) {
        alert('Error: ' + err.message);
        this.disabled = false;
        this.textContent = 'Create';
        enableCreate();
      }
    });
  </script>

</body>
</html>`);
});

// ── Create project API ─────────────────────────────────────────────────────────
app.post("/api/projects", (req, res) => {
  const { projectName, propertyType, address, lat, lng, customer } = req.body;
  if (!address) return res.status(400).json({ error: "Address is required" });

  const projects = loadProjects();
  const project = {
    id: newId(),
    createdAt: new Date().toISOString(),
    projectName: projectName || "",
    propertyType: propertyType || "residential",
    address,
    lat,
    lng,
    customer: {
      name: customer?.name || "",
      email: customer?.email || "",
      phone: customer?.phone || ""
    }
  };
  projects.push(project);
  saveProjects(projects);
  res.json({ id: project.id });
});

// ── Delete project ─────────────────────────────────────────────────────────────
app.delete("/api/projects/:id", (req, res) => {
  const projects = loadProjects();
  const filtered = projects.filter(p => p.id !== req.params.id);
  if (filtered.length === projects.length) return res.status(404).json({ error: "Not found" });
  saveProjects(filtered);
  res.json({ ok: true });
});

// ── Rename project ─────────────────────────────────────────────────────────────
app.patch("/api/projects/:id/rename", (req, res) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });
  project.projectName = req.body.name || project.projectName;
  saveProjects(projects);
  res.json({ ok: true });
});

// ── Project detail page ────────────────────────────────────────────────────────
app.get("/project/:id", (req, res) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center;"><h2>Project not found</h2><p><a href="/">← Back</a></p></body></html>`);

  const tab = req.query.tab || "designs";
  const designUrl = `/design?lat=${project.lat}&lng=${project.lng}&address=${encodeURIComponent(project.address)}`;
  const customerName = esc(project.customer?.name || project.projectName || "Untitled");
  const shortAddr = esc((project.address || "").split(",").slice(0,2).join(","));
  const typeLabel = project.propertyType === "commercial" ? "Commercial" : "Residential";
  const timeAgo = iso => { if (!iso) return "—"; const s = Math.floor((Date.now()-new Date(iso))/1000); if(s<60)return"Just now"; if(s<3600)return Math.floor(s/60)+"m ago"; if(s<86400)return Math.floor(s/3600)+"h ago"; return Math.floor(s/86400)+"d ago"; };

  // ── Tab content ───────────────────────────────────────────────────────────
  let tabContent = "";

  if (tab === "designs") {
    tabContent = `
      <div class="tab-title">
        <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
        </svg>
        Designs
      </div>

      <div class="cards-row">

        <!-- Site Model Service -->
        <div class="design-card">
          <div class="dc-head">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
              <path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/>
              <polyline points="9 21 9 12 15 12 15 21"/>
            </svg>
            <span class="dc-title">Site Model Service</span>
          </div>
          <div class="dc-body">
            Request a 3D site model created by one of our experts. Learn more about
            <a href="#" class="dc-link">EagleView</a> and <a href="#" class="dc-link">Expert Models</a>.
          </div>
          <div class="dc-footer">
            <button class="dc-btn">Create new request</button>
          </div>
        </div>

        <!-- Drone mapping -->
        <div class="design-card">
          <div class="dc-head">
            <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
            </svg>
            <span class="dc-title">Drone mapping</span>
            <span class="badge-beta">Beta</span>
          </div>
          <div class="dc-body">
            Upload your raw drone captured images to be processed into custom LIDAR and a custom map image.
            This free beta is available for a limited time while we evaluate performance and usage.
            <br/><br/>
            <a href="#" class="dc-link">Learn more about drone mapping →</a>
          </div>
          <div class="dc-footer">
            <button class="dc-btn">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <polyline points="21 15 21 21 15 21"/><polyline points="3 9 3 3 9 3"/>
                <line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/>
              </svg>
              Import files
            </button>
          </div>
        </div>

        <!-- Design 1 -->
        <div class="design-card">
          <div class="dc-head" style="justify-content:flex-end;gap:10px;">
            <a href="${designUrl}" class="sales-mode-btn">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
                <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
              Sales Mode
            </a>
            <button class="icon-btn" title="More options">
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
              </svg>
            </button>
          </div>
          <div style="padding:0 0 16px;">
            <div class="d1-name">Design 1</div>
            <div class="d1-meta">Edited ${timeAgo(project.createdAt)}</div>
          </div>
          <div class="d1-stats">
            <div>
              <div class="stat-label">Cost</div>
              <div class="stat-val">$0.00</div>
            </div>
            <div>
              <div class="stat-label">Offset</div>
              <div class="stat-val">0%</div>
            </div>
          </div>
          <div class="d1-stats" style="margin-top:14px;">
            <div>
              <div class="stat-label">Size</div>
              <div class="stat-val">0 kW</div>
            </div>
          </div>
        </div>

      </div>

      <div class="pagination">
        <button class="page-btn" disabled>
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
          Prev
        </button>
        <span class="page-num active">1</span>
        <button class="page-btn">
          Next
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
        </button>
      </div>`;
  }

  else if (tab === "energy") {
    tabContent = `
      <div class="tab-title">
        <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
        Energy usage
      </div>

      <!-- Upload bill -->
      <div class="upload-box">
        <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
          <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
          <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
        </svg>
        <span class="upload-title">Upload a utility bill</span>
        <span class="upload-sub">Drag and drop or click to browse files on your device</span>
      </div>

      <!-- Rates -->
      <div class="rate-section">
        <div class="rate-label">Pre-solar rate</div>
        <div class="rate-row">
          <div class="rate-select-wrap">
            <select class="rate-select">
              <option>Select utility provider</option>
              <option>Eversource Energy</option>
              <option>National Grid</option>
              <option>Pacific Gas & Electric</option>
              <option>Duke Energy</option>
            </select>
          </div>
          <div class="esc-wrap">
            <label class="esc-label">Escalation</label>
            <div class="esc-input-row">
              <input type="number" class="esc-input" value="5"/>
              <span class="esc-unit">%</span>
            </div>
          </div>
          <button class="view-rate-btn">View pre-solar rate</button>
        </div>
      </div>

      <div class="rate-section">
        <div class="rate-label">Post-solar rate</div>
        <div class="rate-row">
          <div class="rate-select-wrap">
            <select class="rate-select">
              <option>Select post-solar rate</option>
              <option>Net metering</option>
              <option>Time of use</option>
            </select>
          </div>
          <button class="view-rate-btn">View post-solar rate</button>
        </div>
      </div>

      <div class="energy-divider"></div>

      <!-- Monthly inputs -->
      <div class="monthly-controls">
        <div class="control-group">
          <label class="ctrl-label">Input method</label>
          <select class="ctrl-select">
            <option>Monthly estimate (1-12 months)</option>
            <option>Annual estimate</option>
          </select>
        </div>
        <div class="control-group">
          <label class="ctrl-label">Units</label>
          <div class="unit-toggle">
            <button class="unit-btn active" onclick="setUnit(this,'kwh')">kWh</button>
            <button class="unit-btn" onclick="setUnit(this,'dollar')">$</button>
          </div>
        </div>
        <div class="control-group">
          <label class="ctrl-label">Location</label>
          <select class="ctrl-select" style="min-width:160px;">
            <option>Select location</option>
            <option selected>${esc((project.address||"").split(",")[1]||"").trim()} (AWOS)</option>
          </select>
        </div>
        <button class="view-rate-btn" style="margin-top:18px;">Edit existing appliances</button>
      </div>

      <div class="months-grid">
        ${["January","February","March","April","May","June","July","August","September","October","November","December"].map(m=>`
          <div class="month-field">
            <label class="month-label">${m}</label>
            <input type="number" class="month-input" placeholder=""/>
          </div>`).join("")}
      </div>

      <!-- Tabs -->
      <div class="energy-tabs">
        <button class="etab active" onclick="setETab(this)">Energy usage (kWh)</button>
        <button class="etab" onclick="setETab(this)">Energy bill ($)</button>
      </div>

      <!-- Summary stats -->
      <div class="energy-stats">
        <div>
          <div class="estat-label">Annual energy</div>
          <div class="estat-val">0 <span class="estat-unit">kWh</span></div>
        </div>
        <div>
          <div class="estat-label">Avg. monthly</div>
          <div class="estat-val">0 <span class="estat-unit">kWh</span></div>
        </div>
      </div>

      <!-- Bar chart placeholder -->
      <div class="bar-chart">
        ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map(()=>`
          <div class="bar-col">
            <div class="bar-fill" style="height:${Math.random()*0|0}px;"></div>
          </div>`).join("")}
        <div class="chart-lines">
          ${[1,2,3,4,5,6].map(()=>`<div class="chart-line"><span class="chart-line-label">1 kWh</span></div>`).join("")}
        </div>
      </div>`;
  }

  else if (tab === "dashboard") {
    tabContent = `
      <div class="tab-title">
        <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
          <rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>
        </svg>
        Dashboard
      </div>
      <div class="dash-cards">
        <div class="dash-card">
          <div class="dash-card-head">Customer profile</div>
          <div class="dash-grid">
            <div><div class="dg-label">Name</div><div class="dg-val">${esc(project.customer?.name||"—")}</div></div>
            <div><div class="dg-label">Email</div><div class="dg-val">${esc(project.customer?.email||"—")}</div></div>
            <div><div class="dg-label">Phone</div><div class="dg-val">${esc(project.customer?.phone||"—")}</div></div>
            <div><div class="dg-label">Property type</div><div class="dg-val">${typeLabel}</div></div>
            <div style="grid-column:1/-1"><div class="dg-label">Address</div><div class="dg-val">${esc(project.address||"—")}</div></div>
          </div>
        </div>
        <div class="dash-card">
          <div class="dash-card-head">Energy usage</div>
          <div class="dash-grid">
            <div><div class="dg-label">Avg. monthly bill</div><div class="dg-val">—</div></div>
            <div><div class="dg-label">Avg. monthly energy</div><div class="dg-val">—</div></div>
            <div><div class="dg-label">Annual bill</div><div class="dg-val">—</div></div>
            <div><div class="dg-label">Annual energy</div><div class="dg-val">—</div></div>
          </div>
        </div>
      </div>`;
  }

  else if (tab === "customer") {
    tabContent = `
      <div class="tab-title">
        <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
        </svg>
        Customer profile
      </div>
      <div class="dash-card" style="max-width:680px;">
        <div class="dash-grid" style="grid-template-columns:1fr 1fr;gap:20px;">
          <div><div class="dg-label">Name</div><div class="dg-val">${esc(project.customer?.name||"—")}</div></div>
          <div><div class="dg-label">Email</div><div class="dg-val">${esc(project.customer?.email||"—")}</div></div>
          <div><div class="dg-label">Phone</div><div class="dg-val">${esc(project.customer?.phone||"—")}</div></div>
          <div><div class="dg-label">Property type</div><div class="dg-val">${typeLabel}</div></div>
          <div style="grid-column:1/-1"><div class="dg-label">Property address</div><div class="dg-val">${esc(project.address||"—")}</div></div>
        </div>
      </div>`;
  }

  else {
    tabContent = `<div style="padding:40px;color:#9ca3af;font-size:0.9rem;">Coming soon.</div>`;
  }

  function navItem(t, label, iconPath) {
    const active = tab === t;
    return `<a class="nav-item${active?" active":""}" href="/project/${project.id}?tab=${t}">
      <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="${active?"2.2":"1.8"}" viewBox="0 0 24 24">${iconPath}</svg>
      ${label}
    </a>`;
  }

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${customerName} — Solar CRM</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #111; background: #fff; }
    body { display: flex; flex-direction: column; }

    /* ── Top header ── */
    .top-header {
      height: 44px;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      align-items: center;
      padding: 0 20px;
      flex-shrink: 0;
      gap: 12px;
    }
    .th-back {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 0.83rem; color: #6b7280; text-decoration: none;
    }
    .th-back:hover { color: #111; }
    .th-divider { width:1px; height:16px; background:#e5e7eb; }
    .th-breadcrumb { font-size: 0.83rem; color: #9ca3af; }
    .th-breadcrumb strong { color: #111; font-weight: 600; }

    /* ── Sub-header ── */
    .sub-header {
      height: 48px;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      align-items: center;
      padding: 0 20px;
      gap: 16px;
      flex-shrink: 0;
      background: #fff;
    }
    .progress-wrap { display: flex; align-items: center; gap: 8px; }
    .progress-bar { width: 100px; height: 3px; background: #e5e7eb; border-radius: 2px; }
    .progress-fill { height: 100%; width: 17%; background: #111; border-radius: 2px; }
    .progress-text { font-size: 0.78rem; color: #6b7280; white-space: nowrap; }
    .sh-dropdown {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 0.83rem; color: #374151; cursor: pointer;
      padding: 5px 10px; border-radius: 6px; border: 1px solid #e5e7eb;
      background: #fff; white-space: nowrap;
    }
    .sh-dropdown:hover { background: #f9fafb; }
    .sh-dropdown svg { color: #9ca3af; }
    .assignee-dot {
      width: 24px; height: 24px; border-radius: 50%;
      background: #dc2626; display: flex; align-items: center; justify-content: center;
      font-size: 0.65rem; font-weight: 700; color: #fff;
    }
    .sh-right { margin-left: auto; display: flex; gap: 8px; }
    .mode-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 14px; border-radius: 6px; font-size: 0.82rem; font-weight: 600;
      cursor: pointer; text-decoration: none; border: none;
    }
    .mode-btn-outline { background: #fff; border: 1px solid #e5e7eb; color: #374151; }
    .mode-btn-outline:hover { background: #f9fafb; }
    .mode-btn-dark { background: #111; color: #fff; }
    .mode-btn-dark:hover { background: #333; }

    /* ── Body layout ── */
    .body-wrap { display: flex; flex: 1; min-height: 0; }

    /* ── Sidebar ── */
    .sidebar {
      width: 210px; flex-shrink: 0;
      border-right: 1px solid #e5e7eb;
      display: flex; flex-direction: column;
      padding: 16px 0;
    }
    .sidebar-customer {
      padding: 0 16px 16px;
      border-bottom: 1px solid #e5e7eb;
      margin-bottom: 8px;
      display: flex; align-items: flex-start; justify-content: space-between;
    }
    .sidebar-customer-name { font-size: 0.85rem; font-weight: 600; color: #111; line-height: 1.3; }
    .sidebar-customer-sub { font-size: 0.75rem; color: #9ca3af; margin-top: 1px; }
    .sidebar-more { color: #9ca3af; cursor: pointer; font-size: 1rem; line-height: 1; padding: 2px; }

    .nav-item {
      display: flex; align-items: center; gap: 10px;
      padding: 8px 16px;
      font-size: 0.85rem; color: #6b7280;
      text-decoration: none; transition: all 0.12s;
    }
    .nav-item:hover { background: #f9fafb; color: #111; }
    .nav-item.active { background: #f3f4f6; color: #111; font-weight: 700; }
    .nav-item svg { flex-shrink: 0; }

    /* ── Main content ── */
    .main { flex: 1; overflow-y: auto; padding: 28px 32px; }

    /* Tab title */
    .tab-title {
      display: flex; align-items: center; gap: 10px;
      font-size: 1.4rem; font-weight: 700; color: #111;
      margin-bottom: 28px;
    }
    .tab-title svg { color: #6b7280; }

    /* ── Designs tab ── */
    .cards-row { display: flex; gap: 16px; align-items: stretch; }
    .design-card {
      flex: 1; border: 1px solid #e5e7eb; border-radius: 10px;
      display: flex; flex-direction: column; padding: 20px;
      min-height: 340px;
    }
    .dc-head { display: flex; align-items: center; gap: 8px; margin-bottom: 14px; }
    .dc-title { font-size: 0.95rem; font-weight: 700; color: #111; }
    .badge-beta {
      background: #f59e0b; color: #fff; font-size: 0.68rem; font-weight: 700;
      padding: 2px 7px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.3px;
    }
    .dc-body { font-size: 0.85rem; color: #6b7280; line-height: 1.6; flex: 1; }
    .dc-link { color: #2563eb; text-decoration: none; font-weight: 500; }
    .dc-link:hover { text-decoration: underline; }
    .dc-footer { margin-top: 20px; }
    .dc-btn {
      width: 100%; padding: 10px 0; border: 1px solid #d1d5db; border-radius: 7px;
      background: #fff; font-size: 0.87rem; color: #374151; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center; gap: 7px;
      transition: background 0.12s;
    }
    .dc-btn:hover { background: #f9fafb; }

    .sales-mode-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border: 1px solid #e5e7eb; border-radius: 6px;
      font-size: 0.82rem; font-weight: 600; color: #374151;
      text-decoration: none; background: #fff; transition: background 0.12s;
    }
    .sales-mode-btn:hover { background: #f9fafb; }
    .icon-btn { background: none; border: none; cursor: pointer; color: #9ca3af; padding: 4px; }
    .icon-btn:hover { color: #374151; }

    .d1-name { font-size: 1.05rem; font-weight: 700; color: #111; }
    .d1-meta { font-size: 0.78rem; color: #9ca3af; margin-top: 2px; }
    .d1-stats { display: flex; gap: 32px; }
    .stat-label { font-size: 0.75rem; color: #9ca3af; margin-bottom: 3px; }
    .stat-val { font-size: 1rem; font-weight: 600; color: #111; }

    .pagination {
      display: flex; align-items: center; gap: 8px; margin-top: 28px;
    }
    .page-btn {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 7px 14px; border: 1px solid #e5e7eb; border-radius: 6px;
      background: #fff; font-size: 0.83rem; color: #374151; cursor: pointer;
    }
    .page-btn:hover:not(:disabled) { background: #f9fafb; }
    .page-btn:disabled { color: #d1d5db; cursor: not-allowed; }
    .page-num {
      width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center;
      border-radius: 6px; font-size: 0.85rem; font-weight: 600;
    }
    .page-num.active { background: #111; color: #fff; }

    /* ── Energy tab ── */
    .upload-box {
      border: 1px solid #e5e7eb; border-radius: 8px;
      padding: 28px 20px; display: flex; flex-direction: column; align-items: center; gap: 6px;
      cursor: pointer; margin-bottom: 24px;
      transition: background 0.12s;
    }
    .upload-box:hover { background: #f9fafb; }
    .upload-title { font-size: 0.95rem; font-weight: 600; color: #111; display: flex; align-items: center; gap: 7px; }
    .upload-sub { font-size: 0.8rem; color: #9ca3af; }

    .rate-section { margin-bottom: 16px; }
    .rate-label { font-size: 0.8rem; font-weight: 600; color: #374151; margin-bottom: 6px; }
    .rate-row { display: flex; align-items: flex-end; gap: 10px; }
    .rate-select-wrap { flex: 1; }
    .rate-select {
      width: 100%; padding: 9px 12px; border: 1px solid #e5e7eb; border-radius: 6px;
      font-size: 0.85rem; color: #374151; background: #f9fafb; outline: none; cursor: pointer;
    }
    .esc-wrap { display: flex; flex-direction: column; gap: 4px; }
    .esc-label { font-size: 0.75rem; color: #6b7280; }
    .esc-input-row { display: flex; align-items: center; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
    .esc-input { width: 60px; padding: 9px 10px; border: none; font-size: 0.85rem; outline: none; background: #f9fafb; }
    .esc-unit { padding: 9px 10px; background: #f3f4f6; font-size: 0.83rem; color: #6b7280; }
    .view-rate-btn {
      padding: 9px 16px; border: 1px solid #e5e7eb; border-radius: 6px;
      background: #fff; font-size: 0.83rem; color: #374151; cursor: pointer; white-space: nowrap;
    }
    .view-rate-btn:hover { background: #f9fafb; }
    .energy-divider { border: none; border-top: 1px solid #e5e7eb; margin: 20px 0; }

    .monthly-controls { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
    .control-group { display: flex; flex-direction: column; gap: 5px; }
    .ctrl-label { font-size: 0.78rem; font-weight: 600; color: #374151; }
    .ctrl-select { padding: 8px 12px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 0.83rem; color: #374151; background: #fff; outline: none; cursor: pointer; }
    .unit-toggle { display: flex; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
    .unit-btn { padding: 7px 14px; border: none; background: #fff; font-size: 0.83rem; color: #6b7280; cursor: pointer; }
    .unit-btn.active { background: #111; color: #fff; font-weight: 600; }

    .months-grid { display: grid; grid-template-columns: repeat(6,1fr); gap: 10px 12px; margin-bottom: 24px; }
    .month-field { display: flex; flex-direction: column; gap: 4px; }
    .month-label { font-size: 0.78rem; color: #6b7280; }
    .month-input { padding: 7px 10px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 0.85rem; color: #111; background: #f9fafb; outline: none; width: 100%; }
    .month-input:focus { border-color: #9ca3af; background: #fff; }

    .energy-tabs { display: flex; gap: 0; border-bottom: 1px solid #e5e7eb; margin-bottom: 20px; }
    .etab { padding: 9px 16px; border: none; background: none; font-size: 0.85rem; color: #6b7280; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .etab.active { color: #111; font-weight: 600; border-bottom-color: #111; }

    .energy-stats { display: flex; gap: 40px; margin-bottom: 20px; }
    .estat-label { font-size: 0.75rem; color: #9ca3af; margin-bottom: 4px; }
    .estat-val { font-size: 2rem; font-weight: 700; color: #111; }
    .estat-unit { font-size: 0.9rem; font-weight: 400; color: #6b7280; }

    .bar-chart { position: relative; height: 160px; border-left: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb; display: flex; align-items: flex-end; gap: 0; padding: 0 8px; }
    .bar-col { flex: 1; display: flex; align-items: flex-end; justify-content: center; padding: 0 3px; }
    .bar-fill { width: 100%; background: #111; border-radius: 3px 3px 0 0; min-height: 2px; }
    .chart-lines { position: absolute; inset: 0; display: flex; flex-direction: column; justify-content: space-around; pointer-events: none; }
    .chart-line { border-top: 1px solid #f3f4f6; }
    .chart-line-label { font-size: 0.68rem; color: #d1d5db; margin-left: 4px; }

    /* ── Dashboard tab ── */
    .dash-cards { display: flex; gap: 16px; flex-wrap: wrap; }
    .dash-card {
      flex: 1; min-width: 280px; border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px;
    }
    .dash-card-head { font-size: 0.9rem; font-weight: 700; margin-bottom: 16px; color: #111; }
    .dash-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 20px; }
    .dg-label { font-size: 0.72rem; color: #9ca3af; text-transform: uppercase; letter-spacing: 0.4px; margin-bottom: 3px; }
    .dg-val { font-size: 0.875rem; color: #111; }
  </style>
</head>
<body>

  <!-- Top header -->
  <div class="top-header">
    <a class="th-back" href="/">
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
      Projects
    </a>
    <div class="th-divider"></div>
    <div class="th-breadcrumb">Team Sunshine &nbsp;/&nbsp; <strong>${customerName}</strong></div>
  </div>

  <!-- Sub-header -->
  <div class="sub-header">
    <div class="progress-wrap">
      <div class="progress-bar"><div class="progress-fill"></div></div>
      <span class="progress-text">1 / 6</span>
    </div>
    <button class="sh-dropdown">
      Remote Assessment Completed
      <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <button class="sh-dropdown">
      <div class="assignee-dot">${customerName[0]}</div>
      ${customerName}
      <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="sh-right">
      <button class="mode-btn mode-btn-outline">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
        </svg>
        Design mode
        <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <a class="mode-btn mode-btn-dark" href="${designUrl}">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        Sales mode
      </a>
    </div>
  </div>

  <div class="body-wrap">

    <!-- Sidebar -->
    <nav class="sidebar">
      <div class="sidebar-customer">
        <div>
          <div class="sidebar-customer-name">${customerName}</div>
          <div class="sidebar-customer-sub">${shortAddr}</div>
        </div>
        <span class="sidebar-more">···</span>
      </div>

      ${navItem("dashboard","Dashboard",`<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/>`)}
      ${navItem("designs","Designs",`<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>`)}
      ${navItem("energy","Energy usage",`<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>`)}
      ${navItem("notes","Notes",`<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>`)}
      ${navItem("customer","Customer profile",`<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>`)}
      ${navItem("documents","Documents",`<path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/>`)}
    </nav>

    <!-- Main -->
    <div class="main">
      ${tabContent}
    </div>

  </div>

  <script>
    function setUnit(btn, val) {
      document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
    function setETab(btn) {
      document.querySelectorAll('.etab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
  </script>

</body>
</html>`);
});

// ── Design / Pin screen ────────────────────────────────────────────────────────
app.get("/design", (req, res) => {
  const { lat, lng, address, customer } = req.query;
  if (!lat || !lng) return res.redirect("/");
  const safeAddress = (address || "Selected Location").replace(/`/g, "'").replace(/</g, "&lt;");
  const safeCustomer = (customer || safeAddress).replace(/`/g, "'").replace(/</g, "&lt;");
  const now = new Date();
  const saveTime = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true }) + " " +
    now.toLocaleString("en-US", { timeZoneName: "short" }).split(", ")[1]?.split(" ").pop() || "EDT";
  const mapDate = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Design — ${safeAddress}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; overflow: hidden; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #1a1a1a;
      color: #e8e8e8;
      display: flex;
      flex-direction: column;
    }

    /* ── TOP BAR ── */
    .topbar {
      height: 48px;
      background: #fff;
      border-bottom: 1px solid #ddd;
      display: flex;
      align-items: center;
      gap: 0;
      flex-shrink: 0;
      color: #111;
      position: relative;
      z-index: 100;
    }
    .topbar-left {
      display: flex;
      align-items: center;
      gap: 0;
      padding: 0 8px 0 12px;
      border-right: 1px solid #e0e0e0;
      height: 100%;
    }
    .tb-back {
      display: flex;
      align-items: center;
      gap: 6px;
      background: none;
      border: none;
      cursor: pointer;
      color: #555;
      padding: 4px 8px;
      border-radius: 5px;
      font-size: 0.82rem;
      text-decoration: none;
      white-space: nowrap;
      max-width: 200px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tb-back:hover { background: #f0f0f0; color: #111; }
    .tb-back svg { flex-shrink: 0; }
    .tb-divider { width: 1px; background: #e0e0e0; height: 24px; margin: 0 4px; }
    .tb-design-name {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 5px;
      cursor: pointer;
      font-size: 0.88rem;
      font-weight: 600;
      color: #111;
      background: none;
      border: none;
    }
    .tb-design-name:hover { background: #f0f0f0; }
    .topbar-center {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
    }
    .tb-icon-btn {
      width: 34px;
      height: 34px;
      border: none;
      background: none;
      cursor: pointer;
      border-radius: 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #555;
    }
    .tb-icon-btn:hover { background: #f0f0f0; color: #111; }
    .tb-icon-btn.active { background: #f0f0f0; color: #111; }
    .topbar-right {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 12px;
      border-left: 1px solid #e0e0e0;
      height: 100%;
    }
    .tb-stats {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 0 10px;
      font-size: 0.78rem;
    }
    .tb-stat { text-align: center; }
    .tb-stat-label { color: #999; font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.4px; }
    .tb-stat-val { color: #111; font-weight: 600; font-size: 0.82rem; margin-top: 1px; }
    .tb-stat-val.dim { color: #bbb; }
    .tb-stats-expand { color: #aaa; cursor: pointer; padding: 2px; }
    .tb-simulate {
      background: #111;
      color: #fff;
      border: none;
      padding: 7px 14px;
      border-radius: 6px;
      font-size: 0.82rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }
    .tb-simulate:hover { background: #333; }

    /* ── MAIN LAYOUT ── */
    .workspace {
      display: flex;
      flex: 1;
      min-height: 0;
      position: relative;
    }

    /* ── LEFT SIDEBAR ── */
    .left-panel {
      width: 200px;
      background: #fff;
      border-right: 1px solid #ddd;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      transition: width 0.2s ease;
      overflow: hidden;
      position: relative;
      z-index: 10;
    }
    .left-panel.collapsed { width: 0; border-right: none; }
    .lp-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px 8px;
      border-bottom: 1px solid #eee;
      flex-shrink: 0;
    }
    .lp-grid-icon {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #555;
    }
    .lp-collapse-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: #aaa;
      font-size: 0.75rem;
      padding: 3px 5px;
      border-radius: 4px;
      display: flex;
      align-items: center;
    }
    .lp-collapse-btn:hover { background: #f0f0f0; color: #555; }
    .lp-tabs {
      display: flex;
      border-bottom: 1px solid #eee;
      flex-shrink: 0;
    }
    .lp-tab {
      flex: 1;
      text-align: center;
      padding: 9px 0;
      font-size: 0.82rem;
      cursor: pointer;
      color: #888;
      border-bottom: 2px solid transparent;
      background: none;
      border-top: none;
      border-left: none;
      border-right: none;
      font-weight: 500;
    }
    .lp-tab.active {
      color: #111;
      border-bottom-color: #111;
    }
    .lp-tab:hover:not(.active) { color: #555; }
    .lp-menu { flex: 1; overflow-y: auto; padding: 6px 0; }
    .lp-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      font-size: 0.83rem;
      color: #333;
      cursor: pointer;
      user-select: none;
      white-space: nowrap;
    }
    .lp-item:hover { background: #f7f7f7; }
    .lp-item-left { display: flex; align-items: center; gap: 10px; }
    .lp-item-icon { color: #666; flex-shrink: 0; }
    .lp-chevron { color: #bbb; }

    /* collapse toggle button floating on edge of left panel */
    .lp-toggle-float {
      position: absolute;
      left: 0;
      top: 50%;
      transform: translateY(-50%);
      z-index: 20;
      width: 18px;
      height: 48px;
      background: #fff;
      border: 1px solid #ddd;
      border-left: none;
      border-radius: 0 6px 6px 0;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #aaa;
      font-size: 10px;
      transition: left 0.2s ease;
    }
    .lp-toggle-float:hover { background: #f0f0f0; color: #555; }

    /* ── MAP AREA ── */
    .map-wrap {
      flex: 1;
      position: relative;
      min-width: 0;
    }
    #map { width: 100%; height: 100%; }

    /* bottom map bar */
    .map-bottom {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      padding: 10px 14px;
      pointer-events: none;
      z-index: 10;
    }
    .map-source {
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(0,0,0,0.55);
      color: #e0e0e0;
      border-radius: 6px;
      padding: 5px 10px;
      font-size: 0.75rem;
      pointer-events: all;
      backdrop-filter: blur(4px);
    }
    .map-source select {
      background: none;
      border: none;
      color: #e0e0e0;
      font-size: 0.75rem;
      cursor: pointer;
      -webkit-appearance: none;
      padding-right: 12px;
    }
    .map-source-icon {
      width: 26px;
      height: 26px;
      border-radius: 4px;
      background: rgba(255,255,255,0.12);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #ccc;
    }
    .map-source-icon:hover { background: rgba(255,255,255,0.2); }
    .map-controls-br {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      pointer-events: all;
    }
    .map-ctrl-btn {
      width: 36px;
      height: 36px;
      background: #fff;
      border: 1px solid #ccc;
      border-radius: 6px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.75rem;
      font-weight: 700;
      color: #333;
      box-shadow: 0 1px 4px rgba(0,0,0,0.15);
    }
    .map-ctrl-btn:hover { background: #f5f5f5; }
    .compass {
      width: 52px;
      height: 52px;
      background: #fff;
      border: 1px solid #ccc;
      border-radius: 50%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      box-shadow: 0 1px 4px rgba(0,0,0,0.15);
      cursor: pointer;
      position: relative;
    }
    .compass-needle {
      width: 0;
      height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-bottom: 18px solid #e53935;
      margin-bottom: 2px;
    }
    .compass-label { font-size: 0.62rem; font-weight: 700; color: #555; letter-spacing: 0.5px; }
    .zoom-btns {
      display: flex;
      flex-direction: column;
      background: #fff;
      border: 1px solid #ccc;
      border-radius: 6px;
      overflow: hidden;
      box-shadow: 0 1px 4px rgba(0,0,0,0.15);
    }
    .zoom-btns button {
      width: 36px;
      height: 34px;
      border: none;
      background: none;
      cursor: pointer;
      font-size: 1.1rem;
      font-weight: 400;
      color: #333;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .zoom-btns button:hover { background: #f5f5f5; }
    .zoom-btns button:first-child { border-bottom: 1px solid #e0e0e0; }

    /* ── RIGHT PANEL ── */
    .right-panel {
      width: 300px;
      background: #fff;
      border-left: 1px solid #ddd;
      display: flex;
      flex-direction: column;
      flex-shrink: 0;
      transition: width 0.2s ease, opacity 0.2s ease;
      overflow: hidden;
      color: #111;
      position: relative;
      z-index: 10;
    }
    .right-panel.hidden { width: 0; opacity: 0; }
    .rp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid #eee;
      flex-shrink: 0;
    }
    .rp-title {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 0.9rem;
      font-weight: 600;
      color: #111;
    }
    .rp-close {
      background: none;
      border: none;
      cursor: pointer;
      color: #aaa;
      padding: 3px;
      border-radius: 4px;
      display: flex;
      align-items: center;
    }
    .rp-close:hover { color: #555; background: #f0f0f0; }
    .rp-body { flex: 1; padding: 16px; overflow-y: auto; }
    .rp-desc { font-size: 0.8rem; color: #777; line-height: 1.5; margin-bottom: 16px; }
    .rp-desc a { color: #4a90e2; text-decoration: none; }
    .rp-assign-btn {
      display: flex;
      align-items: center;
      justify-content: space-between;
      width: 100%;
      padding: 10px 0;
      border: none;
      background: none;
      cursor: pointer;
      font-size: 0.85rem;
      color: #111;
      font-weight: 500;
      border-bottom: 1px solid #eee;
      margin-bottom: 16px;
    }
    .rp-assign-btn:hover { color: #4a90e2; }
    .rp-saved {
      font-size: 0.75rem;
      color: #aaa;
      margin-bottom: 4px;
    }
    .rp-design-name { font-size: 0.88rem; color: #555; font-weight: 500; }

    /* drawing toolbar */
    .draw-toolbar {
      position: absolute;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 4px;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(6px);
      border-radius: 8px;
      padding: 6px 8px;
      z-index: 20;
    }
    .draw-btn {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 3px;
      padding: 7px 12px;
      border-radius: 6px;
      background: none;
      border: none;
      cursor: pointer;
      color: #ccc;
      font-size: 0.65rem;
      font-weight: 500;
      min-width: 56px;
    }
    .draw-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
    .draw-btn.active { background: rgba(255,255,255,0.18); color: #fff; }
    .draw-btn svg { flex-shrink: 0; }

    /* ── TOOLBAR 2 ── */
    .toolbar2 {
      height: 40px;
      background: #fff;
      border-bottom: 1px solid #e5e7eb;
      display: flex;
      align-items: center;
      padding: 0 10px;
      gap: 2px;
      flex-shrink: 0;
      z-index: 90;
    }
    .tb2-btn {
      width: 30px; height: 30px;
      border: none; background: none;
      cursor: pointer; border-radius: 5px;
      display: flex; align-items: center; justify-content: center;
      color: #555;
    }
    .tb2-btn:hover { background: #f0f0f0; color: #111; }
    .tb2-btn:disabled { color: #ccc; cursor: default; pointer-events: none; }
    .tb2-divider { width: 1px; background: #e5e7eb; height: 20px; margin: 0 6px; }

    /* ── SIM BADGE ── */
    .sim-updated {
      display: flex; align-items: center; gap: 5px;
      font-size: 0.78rem; color: #27ae60; font-weight: 500;
      padding: 0 12px;
      border-right: 1px solid #e5e7eb; height: 100%;
      white-space: nowrap;
    }
  </style>
</head>
<body>

  <!-- TOP BAR -->
  <div class="topbar">
    <div class="topbar-left">
      <a class="tb-back" href="#" onclick="history.back()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 18l-6-6 6-6"/></svg>
        <span>${safeCustomer}</span>
      </a>
      <div class="tb-divider"></div>
      <button class="tb-design-name">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        Design 1
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
      </button>
    </div>

    <div class="topbar-center">
      <button class="tb-icon-btn active" title="Site">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      </button>
      <button class="tb-icon-btn" title="Save">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      </button>
      <button class="tb-icon-btn" title="Share / Report">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="10" r="3"/><path d="M7 20.662V19a2 2 0 012-2h6a2 2 0 012 2v1.662"/></svg>
      </button>
    </div>

    <div class="topbar-right">
      <div class="sim-updated" id="simBadge" style="display:none">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#27ae60" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
        Simulation updated
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#aaa" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </div>
      <div class="tb-stats">
        <div class="tb-stat">
          <div class="tb-stat-label">Size</div>
          <div class="tb-stat-val" id="statSize">— kW</div>
        </div>
        <div class="tb-stat">
          <div class="tb-stat-label">Production</div>
          <div class="tb-stat-val" id="statProd">—%</div>
        </div>
        <div class="tb-stat">
          <div class="tb-stat-label">Savings</div>
          <div class="tb-stat-val dim" id="statSavings">—%</div>
        </div>
        <svg class="tb-stats-expand" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
      </div>
      <button class="tb-simulate" id="simulateBtn">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
        Simulate system
      </button>
      <button class="tb-icon-btn" title="History">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </button>
      <button class="tb-icon-btn" title="Settings" id="toggleRightPanel">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
      </button>
    </div>
  </div>

  <!-- TOOLBAR 2 -->
  <div class="toolbar2">
    <button class="tb2-btn" id="undoBtn" title="Undo" disabled>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
    </button>
    <button class="tb2-btn" id="redoBtn" title="Redo" disabled>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.13-9.36L23 10"/></svg>
    </button>
    <div class="tb2-divider"></div>
    <button class="tb2-btn" title="Rotate CCW">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2.5 2v6h6"/><path d="M2.66 15.57a10 10 0 100-7.14"/></svg>
    </button>
    <button class="tb2-btn" title="Rotate CW">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.5 2v6h-6"/><path d="M21.34 15.57a10 10 0 110-7.14"/></svg>
    </button>
    <button class="tb2-btn" title="Flip horizontal">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3H5a2 2 0 00-2 2v14c0 1.1.9 2 2 2h3"/><path d="M16 3h3a2 2 0 012 2v14a2 2 0 01-2 2h-3"/><line x1="12" y1="20" x2="12" y2="4"/></svg>
    </button>
    <div class="tb2-divider"></div>
    <button class="tb2-btn" title="Irradiance / Sun">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
    </button>
    <button class="tb2-btn" title="Grid overlay">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
    </button>
    <button class="tb2-btn" title="Measure">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12h20"/><path d="M6 8v8"/><path d="M18 8v8"/><path d="M10 10v4"/><path d="M14 10v4"/></svg>
    </button>
    <button class="tb2-btn" title="Properties">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="14" y2="12"/><line x1="4" y1="18" x2="18" y2="18"/></svg>
    </button>
  </div>

  <!-- WORKSPACE -->
  <div class="workspace">

    <!-- LEFT PANEL -->
    <div class="left-panel" id="leftPanel">
      <div class="lp-top">
        <div class="lp-grid-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
        </div>
        <button class="lp-collapse-btn" id="collapseLeft" title="Collapse panel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 19l-7-7 7-7"/><path d="M19 19l-7-7 7-7"/></svg>
        </button>
      </div>
      <div class="lp-tabs">
        <button class="lp-tab" id="tabSite">Site</button>
        <button class="lp-tab active" id="tabSystem">System</button>
      </div>
      <div class="lp-menu" id="lpMenu">
        <div class="lp-item">
          <div class="lp-item-left">
            <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22V12M12 12L7 7M12 12l5-5M7 7V3h10v4"/><path d="M3 22h18"/></svg>
            Fire pathways
          </div>
          <svg class="lp-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </div>
        <div class="lp-item">
          <div class="lp-item-left">
            <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            AutoDesigner
          </div>
          <svg class="lp-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </div>
        <div class="lp-item" id="menuPanels">
          <div class="lp-item-left">
            <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
            Panels
          </div>
          <svg class="lp-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </div>
        <div class="lp-item">
          <div class="lp-item-left">
            <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            Components
          </div>
          <svg class="lp-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </div>
        <div class="lp-item">
          <div class="lp-item-left">
            <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/></svg>
            String / connect
          </div>
          <svg class="lp-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
        </div>
      </div>
    </div>

    <!-- MAP -->
    <div class="map-wrap">
      <div id="map"></div>

      <!-- Drawing toolbar -->
      <div class="draw-toolbar">
        <button class="draw-btn active" id="btnSelect" title="Select/Move">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 3l14 9-7 1-4 6z"/></svg>
          Select
        </button>
        <button class="draw-btn" id="btnDrawRoof" title="Draw Roof Segment">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 19 22 19"/></svg>
          Roof
        </button>
        <button class="draw-btn" id="btnPanels" title="Auto-fill Panels">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
          Panels
        </button>
        <button class="draw-btn" id="btnDelete" title="Delete selected">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
          Delete
        </button>
      </div>

      <!-- Bottom map bar -->
      <div class="map-bottom">
        <div class="map-source">
          <select>
            <option>Satellite: ${mapDate}</option>
          </select>
          <div class="map-source-icon" title="Toggle visibility">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
          </div>
          <div class="map-source-icon" title="Grid overlay">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          </div>
          <div class="map-source-icon" title="Measure">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 12h20M12 2v20"/></svg>
          </div>
        </div>
        <div class="map-controls-br">
          <div class="compass" title="Reset North">
            <div class="compass-needle"></div>
            <div class="compass-label">3D</div>
          </div>
          <div class="zoom-btns">
            <button id="zoomIn" title="Zoom in">+</button>
            <button id="zoomOut" title="Zoom out">−</button>
          </div>
        </div>
      </div>
    </div>

    <!-- RIGHT PANEL -->
    <div class="right-panel" id="rightPanel">
      <div class="rp-header">
        <div class="rp-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Milestones
        </div>
        <button class="rp-close" id="closeRightPanel">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="rp-body">
        <p class="rp-desc">Assign a milestone to a design to create a timeline.</p>
        <button class="rp-assign-btn">
          Assign new milestone
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
        <div class="rp-saved">Last saved today at ${saveTime}</div>
        <div class="rp-design-name">Design 1</div>
      </div>
    </div>

  </div><!-- /workspace -->

  <script>
    var map, marker, drawingManager;
    var segments = [];
    var selectedSegment = null;
    var currentMode = 'select';

    /* ── Panel toggle logic ── */
    var leftPanel = document.getElementById('leftPanel');
    var rightPanel = document.getElementById('rightPanel');
    var leftCollapsed = false;
    var rightHidden = false;

    document.getElementById('collapseLeft').addEventListener('click', function() {
      leftCollapsed = !leftCollapsed;
      leftPanel.classList.toggle('collapsed', leftCollapsed);
    });
    document.getElementById('closeRightPanel').addEventListener('click', function() {
      rightHidden = true;
      rightPanel.classList.add('hidden');
    });
    document.getElementById('toggleRightPanel').addEventListener('click', function() {
      rightHidden = !rightHidden;
      rightPanel.classList.toggle('hidden', rightHidden);
    });

    /* ── Tab switching ── */
    document.getElementById('tabSite').addEventListener('click', function() {
      this.classList.add('active');
      document.getElementById('tabSystem').classList.remove('active');
    });
    document.getElementById('tabSystem').addEventListener('click', function() {
      this.classList.add('active');
      document.getElementById('tabSite').classList.remove('active');
    });

    /* ── Draw toolbar ── */
    var drawBtns = ['btnSelect','btnDrawRoof','btnPanels','btnDelete'];
    drawBtns.forEach(function(id) {
      document.getElementById(id).addEventListener('click', function() {
        drawBtns.forEach(function(b){ document.getElementById(b).classList.remove('active'); });
        this.classList.add('active');
        setMode(id);
      });
    });

    function setMode(id) {
      currentMode = id;
      if (!drawingManager) return;
      if (id === 'btnDrawRoof') {
        drawingManager.setDrawingMode(google.maps.drawing.OverlayType.POLYGON);
      } else {
        drawingManager.setDrawingMode(null);
      }
      if (id === 'btnPanels') {
        if (selectedSegment) {
          fillPanels(selectedSegment);
          addDimensionLabels(selectedSegment);
          addAzimuthArrow(selectedSegment);
        } else {
          segments.forEach(function(seg) {
            fillPanels(seg);
            addDimensionLabels(seg);
            addAzimuthArrow(seg);
          });
        }
        updateStats();
      }
    }

    /* ── Map init ── */
    function initMap() {
      var pos = { lat: ${parseFloat(lat)}, lng: ${parseFloat(lng)} };
      map = new google.maps.Map(document.getElementById('map'), {
        center: pos,
        zoom: 20,
        mapTypeId: 'satellite',
        tilt: 0,
        disableDefaultUI: true,
        gestureHandling: 'greedy',
      });

      /* Drawing manager for roof segments */
      drawingManager = new google.maps.drawing.DrawingManager({
        drawingMode: null,
        drawingControl: false,
        polygonOptions: {
          strokeColor: '#f5a623',
          strokeOpacity: 1,
          strokeWeight: 2,
          fillColor: '#f5a623',
          fillOpacity: 0.18,
          editable: true,
          draggable: true,
          zIndex: 1,
        },
      });
      drawingManager.setMap(map);

      google.maps.event.addListener(drawingManager, 'polygoncomplete', function(polygon) {
        segments.push(polygon);
        drawingManager.setDrawingMode(null);
        document.getElementById('btnDrawRoof').classList.remove('active');
        document.getElementById('btnSelect').classList.add('active');
        currentMode = 'btnSelect';
        polygon.addListener('click', function() { selectSegment(polygon); });
        // Auto-fill panels and add dimension labels on draw
        fillPanels(polygon);
        addDimensionLabels(polygon);
        addAzimuthArrow(polygon);
        updateStats();
      });

      /* Zoom buttons */
      document.getElementById('zoomIn').addEventListener('click', function() {
        map.setZoom(map.getZoom() + 1);
      });
      document.getElementById('zoomOut').addEventListener('click', function() {
        map.setZoom(map.getZoom() - 1);
      });

      /* Delete button */
      document.getElementById('btnDelete').addEventListener('click', function() {
        if (selectedSegment) {
          clearSegmentOverlays(selectedSegment);
          selectedSegment.setMap(null);
          segments = segments.filter(function(s){ return s !== selectedSegment; });
          selectedSegment = null;
          updateStats();
        }
      });

      /* Simulate button */
      document.getElementById('simulateBtn').addEventListener('click', function() {
        updateStats();
        document.getElementById('simBadge').style.display = 'flex';
        document.getElementById('statSavings').classList.remove('dim');
      });
    }

    /* ── Panel fill ── */
    function fillPanels(polygon) {
      clearPanels(polygon);
      var path = polygon.getPath();
      var pts = [];
      for (var i = 0; i < path.getLength(); i++) {
        pts.push({ lat: path.getAt(i).lat(), lng: path.getAt(i).lng() });
      }
      var minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
      pts.forEach(function(p) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lng < minLng) minLng = p.lng;
        if (p.lng > maxLng) maxLng = p.lng;
      });
      var lat0 = (minLat + maxLat) / 2;
      var mPerLat = 111000;
      var mPerLng = 111000 * Math.cos(lat0 * Math.PI / 180);
      // Panel: 1.0m tall × 1.7m wide (landscape) with 0.04m gap
      var pH = 1.0 / mPerLat;
      var pW = 1.7 / mPerLng;
      var gH = 0.04 / mPerLat;
      var gW = 0.04 / mPerLng;
      var stepH = pH + gH;
      var stepW = pW + gW;
      polygon._panels = [];
      var lat = minLat + gH;
      while (lat + pH <= maxLat - gH) {
        var lng = minLng + gW;
        while (lng + pW <= maxLng - gW) {
          var cLat = lat + pH / 2;
          var cLng = lng + pW / 2;
          if (pointInPolygon({ lat: cLat, lng: cLng }, pts)) {
            var panel = new google.maps.Polygon({
              paths: [
                { lat: lat,      lng: lng },
                { lat: lat,      lng: lng + pW },
                { lat: lat + pH, lng: lng + pW },
                { lat: lat + pH, lng: lng },
              ],
              strokeColor: '#f5a623',
              strokeOpacity: 0.7,
              strokeWeight: 0.5,
              fillColor: '#1e2a3a',
              fillOpacity: 0.92,
              map: map,
              zIndex: 3,
              clickable: false,
            });
            polygon._panels.push(panel);
          }
          lng += stepW;
        }
        lat += stepH;
      }
    }

    function clearPanels(polygon) {
      if (polygon._panels) {
        polygon._panels.forEach(function(p) { p.setMap(null); });
      }
      polygon._panels = [];
    }

    function clearSegmentOverlays(polygon) {
      clearPanels(polygon);
      if (polygon._dimMarkers) {
        polygon._dimMarkers.forEach(function(m) { m.setMap(null); });
        polygon._dimMarkers = [];
      }
      if (polygon._azimuth) {
        polygon._azimuth.setMap(null);
        polygon._azimuth = null;
      }
    }

    /* ── Dimension labels ── */
    function addDimensionLabels(polygon) {
      if (polygon._dimMarkers) {
        polygon._dimMarkers.forEach(function(m) { m.setMap(null); });
      }
      polygon._dimMarkers = [];
      var path = polygon.getPath();
      var n = path.getLength();
      for (var i = 0; i < n; i++) {
        var p1 = path.getAt(i);
        var p2 = path.getAt((i + 1) % n);
        var dist = google.maps.geometry.spherical.computeDistanceBetween(p1, p2);
        var feet = (dist * 3.28084).toFixed(1);
        var midLat = (p1.lat() + p2.lat()) / 2;
        var midLng = (p1.lng() + p2.lng()) / 2;
        var m = new google.maps.Marker({
          position: { lat: midLat, lng: midLng },
          map: map,
          label: {
            text: feet + ' ft',
            color: '#00e5ff',
            fontSize: '11px',
            fontWeight: '700',
            fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
          },
          icon: { path: google.maps.SymbolPath.CIRCLE, scale: 0 },
          zIndex: 10,
          clickable: false,
        });
        polygon._dimMarkers.push(m);
      }
    }

    /* ── Azimuth arrow ── */
    function addAzimuthArrow(polygon) {
      if (polygon._azimuth) polygon._azimuth.setMap(null);
      var path = polygon.getPath();
      var n = path.getLength();
      var sumLat = 0, sumLng = 0;
      for (var i = 0; i < n; i++) { sumLat += path.getAt(i).lat(); sumLng += path.getAt(i).lng(); }
      var centLat = sumLat / n, centLng = sumLng / n;
      var arrowSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30"><polygon points="11,2 20,26 11,20 2,26" fill="#f5a623" stroke="white" stroke-width="1.5"/></svg>';
      polygon._azimuth = new google.maps.Marker({
        position: { lat: centLat, lng: centLng },
        map: map,
        icon: {
          url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(arrowSvg),
          scaledSize: new google.maps.Size(22, 30),
          anchor: new google.maps.Point(11, 15),
        },
        zIndex: 5,
        clickable: false,
      });
    }

    /* ── Point-in-polygon (ray casting) ── */
    function pointInPolygon(point, polygon) {
      var x = point.lat, y = point.lng, inside = false;
      for (var i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        var xi = polygon[i].lat, yi = polygon[i].lng;
        var xj = polygon[j].lat, yj = polygon[j].lng;
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
          inside = !inside;
        }
      }
      return inside;
    }

    /* ── Stats ── */
    function updateStats() {
      var totalPanels = 0;
      segments.forEach(function(seg) {
        if (seg._panels) totalPanels += seg._panels.length;
      });
      if (totalPanels === 0) return;
      var kw = (totalPanels * 0.4).toFixed(2);
      document.getElementById('statSize').textContent = kw + ' kW';
      document.getElementById('statProd').textContent = '95%';
      document.getElementById('statSavings').textContent = '85%';
    }

    function selectSegment(polygon) {
      if (selectedSegment && selectedSegment !== polygon) {
        selectedSegment.setOptions({ strokeColor: '#f5a623', fillColor: '#f5a623', strokeWeight: 2, fillOpacity: 0.12 });
      }
      selectedSegment = polygon;
      polygon.setOptions({ strokeColor: '#7c3aed', fillColor: '#f5a623', strokeWeight: 2.5, fillOpacity: 0.12 });
    }
  </script>
  <script src="https://maps.googleapis.com/maps/api/js?key=${API_KEY}&libraries=drawing,geometry&callback=initMap" async defer></script>
</body>
</html>`);
});

// ── Helpers ────────────────────────────────────────────────────────────────────
function esc(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

app.listen(PORT, () => {
  console.log(`Solar CRM running at http://localhost:${PORT}`);
});
