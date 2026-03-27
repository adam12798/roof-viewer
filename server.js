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
      cursor: pointer;
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

    /* ── Nav drawer overlay ── */
    .nav-drawer-backdrop {
      display: none;
      position: fixed;
      inset: 0;
      z-index: 200;
    }
    .nav-drawer-backdrop.open { display: block; }
    .nav-drawer {
      position: fixed;
      top: 0; left: 0; bottom: 0;
      width: 220px;
      background: #3d0a3f;
      display: flex;
      flex-direction: column;
      z-index: 201;
      transform: translateX(-100%);
      transition: transform 0.22s cubic-bezier(0.4,0,0.2,1);
      padding: 16px 0 0;
    }
    .nav-drawer.open { transform: translateX(0); }
    .nav-drawer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px 16px;
    }
    .nav-drawer-wordmark {
      display: flex;
      align-items: center;
      gap: 9px;
      color: #fff;
      font-size: 1rem;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .nav-drawer-close {
      background: none;
      border: none;
      cursor: pointer;
      color: #b084cc;
      padding: 4px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      transition: color 0.15s, background 0.15s;
    }
    .nav-drawer-close:hover { color: #fff; background: rgba(255,255,255,0.08); }
    .nav-drawer-links {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 4px 10px;
      gap: 2px;
    }
    .nav-drawer-link {
      display: flex;
      align-items: center;
      gap: 11px;
      padding: 9px 12px;
      border-radius: 8px;
      color: #c4a8dc;
      text-decoration: none;
      font-size: 0.9rem;
      font-weight: 500;
      transition: background 0.15s, color 0.15s;
    }
    .nav-drawer-link:hover { background: rgba(255,255,255,0.08); color: #fff; }
    .nav-drawer-link.active { background: #5a1060; color: #fff; }
    .nav-drawer-footer {
      border-top: 1px solid rgba(255,255,255,0.08);
      padding: 14px 10px 20px;
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .nav-drawer-user {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      color: #fff;
      font-size: 0.85rem;
      font-weight: 600;
    }
    .nav-drawer-avatar {
      width: 30px; height: 30px;
      border-radius: 6px;
      background: linear-gradient(135deg,#a855f7,#6366f1);
      display: flex; align-items: center; justify-content: center;
      font-size: 0.72rem; font-weight: 700; color: #fff; flex-shrink: 0;
    }
    .nav-drawer-foot-link {
      display: block;
      padding: 8px 12px;
      color: #c4a8dc;
      text-decoration: none;
      font-size: 0.875rem;
      border-radius: 8px;
      transition: background 0.15s, color 0.15s;
    }
    .nav-drawer-foot-link:hover { background: rgba(255,255,255,0.08); color: #fff; }

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
      background: #e9eaec; border: none; cursor: pointer;
      font-size: 1.1rem; color: #9ca3af; padding: 4px 8px; border-radius: 6px;
      opacity: 1; transition: background 0.15s, color 0.15s, box-shadow 0.15s;
      letter-spacing: 1px;
    }
    .row-menu-btn:hover { background: #d1d5db; color: #374151; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
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

  <!-- Nav drawer -->
  <div class="nav-drawer-backdrop" id="navBackdrop" onclick="closeNavDrawer()"></div>
  <div class="nav-drawer" id="navDrawer">
    <div class="nav-drawer-header">
      <div class="nav-drawer-wordmark">
        <svg width="20" height="20" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
        </svg>
        aurora
      </div>
      <button class="nav-drawer-close" onclick="closeNavDrawer()">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="nav-drawer-links">
      <a class="nav-drawer-link active" href="/">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
        Projects
      </a>
      <a class="nav-drawer-link" href="#">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg>
        Database
      </a>
      <a class="nav-drawer-link" href="/settings">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
        Settings
      </a>
      <a class="nav-drawer-link" href="#">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
        Partners
      </a>
    </div>
    <div class="nav-drawer-footer">
      <div class="nav-drawer-user">
        <div class="nav-drawer-avatar">AB</div>
        Adam Bahou
      </div>
      <a class="nav-drawer-foot-link" href="#">My profile</a>
      <a class="nav-drawer-foot-link" href="#">Logout</a>
    </div>
  </div>

  <!-- Dark left rail -->
  <nav class="rail">
    <div class="rail-logo" onclick="openNavDrawer()">
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
    <a class="rail-btn" href="/settings" title="Settings" style="margin-top:auto;">
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
    function nav(id) { window.location = '/project/' + id + '?tab=dashboard'; }

    function openNavDrawer() {
      document.getElementById('navDrawer').classList.add('open');
      document.getElementById('navBackdrop').classList.add('open');
    }
    function closeNavDrawer() {
      document.getElementById('navDrawer').classList.remove('open');
      document.getElementById('navBackdrop').classList.remove('open');
    }

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

// ── Static assets ──────────────────────────────────────────────────────────────
app.get("/iceberg.png", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "iceberg.png"));
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
        <img src="/iceberg.png" alt="Iceberg" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;object-position:center;background:#0a1f3e;"/>
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 700" style="display:none;width:100%;height:100%;position:absolute;inset:0;">
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

        <div style="position:absolute;bottom:32px;left:0;right:0;text-align:center;color:#fff;font-size:0.82rem;letter-spacing:0.5px;text-shadow:0 1px 4px rgba(0,0,0,0.6);">
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

  const tab = req.query.tab || "dashboard";
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
        <a href="${designUrl}" class="design-card design-card-clickable">
          <span class="dc-open-hint">
            Open
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
          </span>
          <div class="dc-head" style="justify-content:flex-end;gap:10px;">
            <button class="icon-btn" title="More options" onclick="event.preventDefault();event.stopPropagation();">
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
        </a>

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

      <!-- Upload box — Interval data only -->
      <input type="file" id="billFileInput" accept=".pdf,.png,.jpg,.jpeg" style="display:none;" onchange="handleBillFile(this)"/>
      <div class="upload-box" id="energyUploadBox" style="display:none" onclick="document.getElementById('billFileInput').click()" ondragover="event.preventDefault();this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="handleBillDrop(event)">
        <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24">
          <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
          <path d="M20.39 18.39A5 5 0 0018 9h-1.26A8 8 0 103 16.3"/>
        </svg>
        <span class="upload-title">Upload a utility bill</span>
        <span class="upload-sub">Drag and drop or click to browse files on your device</span>
      </div>

      <!-- Interval data rates — Interval data only -->
      <div id="intervalSection" style="display:none">
        <div class="interval-rate-row">
          <div style="flex:1;min-width:0">
            <div class="rate-label">Pre-solar rate</div>
            <div class="rate-custom-wrap" id="preSolarWrap">
              <div class="rate-custom-trigger" onclick="toggleRateDropdown('preSolarWrap',event)">
                <div class="rate-trigger-content">
                  <div class="rate-trigger-group">National Grid - Massachusetts</div>
                  <div class="rate-trigger-value" id="preSolarValue">R-1 Residential</div>
                </div>
                <svg class="rate-trigger-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
              </div>
              <div class="rate-custom-menu" id="preSolarMenu">
                <div class="rate-search-row">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  <input class="rate-search-input" placeholder="Search" oninput="filterRateOptions('preSolarMenu',this.value)"/>
                </div>
                <div class="rate-options-list">
                  <div class="rate-group-label">National Grid - Massachusetts</div>
                  <div class="rate-option" data-group="National Grid - Massachusetts" data-value="R-1-NEM&gt;10kW Residential - Greater than 10 kWs" onclick="selectRate('preSolarWrap','preSolarValue',this)">
                    <span>R-1-NEM&gt;10kW Residential - Greater than 10 kWs</span>
                    <svg class="rate-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div class="rate-option" data-group="National Grid - Massachusetts" data-value="R-2-NEM&gt;10kW Residential Low Income - Greater than 10 kW" onclick="selectRate('preSolarWrap','preSolarValue',this)">
                    <span>R-2-NEM&gt;10kW Residential Low Income - Greater than 10 kW</span>
                    <svg class="rate-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div class="rate-option selected" data-group="National Grid - Massachusetts" data-value="R-1 Residential" onclick="selectRate('preSolarWrap','preSolarValue',this)">
                    <span>R-1 Residential</span>
                    <svg class="rate-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                  <div class="rate-option" data-group="National Grid - Massachusetts" data-value="R-2 Residential - Low Income" onclick="selectRate('preSolarWrap','preSolarValue',this)">
                    <span>R-2 Residential - Low Income</span>
                    <svg class="rate-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <div class="esc-wrap">
            <label class="esc-label">Escalation</label>
            <div class="esc-input-row">
              <input type="number" class="esc-input" value="5"/>
              <span class="esc-unit">%</span>
            </div>
          </div>
        </div>

        <div style="margin-top:16px">
          <div class="rate-label">Post-solar rate</div>
          <div class="rate-custom-wrap" id="postSolarWrap">
            <div class="rate-custom-trigger" onclick="toggleRateDropdown('postSolarWrap',event)">
              <div class="rate-trigger-content">
                <div class="rate-trigger-group">National Grid - Massachusetts</div>
                <div class="rate-trigger-value" id="postSolarValue">R-1-NEM&gt;10kW Residential - Greater than 10 kWs North</div>
              </div>
              <svg class="rate-trigger-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <div class="rate-custom-menu" id="postSolarMenu">
              <div class="rate-search-row">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input class="rate-search-input" placeholder="Search" oninput="filterRateOptions('postSolarMenu',this.value)"/>
              </div>
              <div class="rate-options-list">
                <div class="rate-group-label">National Grid - Massachusetts</div>
                <div class="rate-option nem" data-group="National Grid - Massachusetts" data-value="R-1-NEM&gt;10kW Residential - Greater than 10 kWs" onclick="selectRate('postSolarWrap','postSolarValue',this)">
                  <svg class="rate-nem-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/></svg>
                  <span>R-1-NEM&gt;10kW Residential - Greater than 10 kWs</span>
                  <svg class="rate-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <div class="rate-option nem" data-group="National Grid - Massachusetts" data-value="R-2-NEM&gt;10kW Residential Low Income - Greater than 10 kW" onclick="selectRate('postSolarWrap','postSolarValue',this)">
                  <svg class="rate-nem-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><circle cx="12" cy="12" r="4"/><line x1="12" y1="2" x2="12" y2="4"/><line x1="12" y1="20" x2="12" y2="22"/><line x1="2" y1="12" x2="4" y2="12"/><line x1="20" y1="12" x2="22" y2="12"/><line x1="4.93" y1="4.93" x2="6.34" y2="6.34"/><line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/><line x1="17.66" y1="6.34" x2="19.07" y2="4.93"/><line x1="4.93" y1="19.07" x2="6.34" y2="17.66"/></svg>
                  <span>R-2-NEM&gt;10kW Residential Low Income - Greater than 10 kW</span>
                  <svg class="rate-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <div class="rate-option" data-group="National Grid - Massachusetts" data-value="R-1 Residential" onclick="selectRate('postSolarWrap','postSolarValue',this)">
                  <span>R-1 Residential</span>
                  <svg class="rate-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
                <div class="rate-option" data-group="National Grid - Massachusetts" data-value="R-2 Residential - Low Income" onclick="selectRate('postSolarWrap','postSolarValue',this)">
                  <span>R-2 Residential - Low Income</span>
                  <svg class="rate-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
                </div>
              </div>
            </div>
          </div>
        </div>

        <button class="add-interval-btn">Add interval data</button>
      </div>

      <!-- Input method controls — always visible -->
      <div class="monthly-controls" id="mainControls">
        <div class="control-group">
          <label class="ctrl-label">Input method</label>
          <div class="imethod-wrap" id="imethodWrap">
            <div class="imethod-trigger" id="imethodTrigger" onclick="toggleIMethod(event)">
              <span id="imethodLabel">Monthly estimate (1-12 months)</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </div>
            <div class="imethod-menu" id="imethodMenu">
              <div class="imethod-option" onclick="selectIMethod(this,'Monthly average')">
                <span>Monthly average</span>
                <svg class="imethod-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div class="imethod-option selected" onclick="selectIMethod(this,'Monthly estimate (1-12 months)')">
                <span>Monthly estimate (1-12 months)</span>
                <svg class="imethod-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div class="imethod-option" onclick="selectIMethod(this,'Monthly estimate with existing system')">
                <span>Monthly estimate with existing system</span>
                <svg class="imethod-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div class="imethod-option" onclick="selectIMethod(this,'Annual energy estimate')">
                <span>Annual energy estimate</span>
                <svg class="imethod-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
              <div class="imethod-option" onclick="selectIMethod(this,'Interval data')">
                <span>Interval data</span>
                <svg class="imethod-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>
              </div>
            </div>
          </div>
        </div>
        <!-- Units toggle — Monthly average only -->
        <div class="control-group" id="unitsGroup" style="display:none">
          <label class="ctrl-label">Units</label>
          <div class="unit-toggle">
            <button class="unit-btn active" onclick="setUnit(this,'kwh')">kWh</button>
            <button class="unit-btn" onclick="setUnit(this,'dollar')">$</button>
          </div>
        </div>
        <!-- Location — most modes except Monthly average and Interval data -->
        <div class="control-group" id="locationGroup">
          <label class="ctrl-label">Location</label>
          <select class="ctrl-select" style="min-width:160px;">
            <option>Select location</option>
            <option selected>${esc((project.address||"").split(",")[1]||"").trim()} (AWOS)</option>
          </select>
        </div>
        <!-- Edit existing appliances — Monthly estimate with existing system only -->
        <button class="view-rate-btn" id="editAppliancesBtn" style="display:none;margin-top:18px">Edit existing appliances</button>
      </div>

      <!-- Existing system alert — Monthly estimate with existing system only -->
      <div class="existing-system-alert" id="existingSystemAlert" style="display:none">
        <div style="display:flex;align-items:center;gap:10px;flex:1">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16" stroke-width="3" stroke-linecap="round"/></svg>
          <span>Create a design with an existing system to calculate gross consumption</span>
        </div>
        <a class="existing-system-link" href="#">Go to designs</a>
      </div>

      <!-- Average month input — Monthly average only -->
      <div id="avgMonthSection" style="display:none;margin-bottom:24px">
        <label class="ctrl-label" style="display:block;margin-bottom:6px">Average month</label>
        <div class="avg-month-input-wrap">
          <span class="avg-month-prefix" id="avgMonthPrefix" style="display:none">$</span>
          <input type="number" class="avg-month-input" value="0"/>
          <span class="avg-month-suffix" id="avgMonthSuffix">kWh</span>
        </div>
      </div>

      <!-- Months grid — Monthly estimate modes -->
      <div class="months-grid" id="monthsGrid">
        ${["January","February","March","April","May","June","July","August","September","October","November","December"].map(m=>`
          <div class="month-field">
            <label class="month-label">${m}</label>
            <div class="month-input-row">
              <input type="number" class="month-input" placeholder=""/>
              <span class="month-unit">kWh</span>
            </div>
          </div>`).join("")}
      </div>

      <!-- Annual estimate input — Annual energy estimate only -->
      <div id="annualEstSection" style="display:none;margin-bottom:28px">
        <label class="ctrl-label" style="display:block;margin-bottom:6px">Annual energy estimate</label>
        <div class="annual-input-row">
          <input type="number" class="annual-input" value="0"/>
          <span class="annual-unit">kWh</span>
        </div>
      </div>

      <!-- Tabs -->
      <div class="energy-tabs">
        <button class="etab active" onclick="setETab(this)">Energy usage (kWh)</button>
        <button class="etab" onclick="setETab(this)">Energy bill ($)</button>
      </div>

      <!-- Summary stats -->
      <div class="energy-stats">
        <div>
          <div class="estat-label" id="estatLabel1">Annual energy</div>
          <div class="estat-val" id="estatVal1">—</div>
        </div>
        <div>
          <div class="estat-label">Avg. monthly</div>
          <div class="estat-val" id="estatVal2">—</div>
        </div>
      </div>`;
  }

  else if (tab === "dashboard") {
    const addrParts = (project.address||"").split(",");
    const addrLine1 = esc(addrParts[0]||"—");
    const addrLine2 = esc(addrParts.slice(1).join(",").trim()||"");
    tabContent = `
      <!-- Top two cards -->
      <div class="db-top-row">

        <!-- Customer profile -->
        <div class="db-card">
          <div class="db-card-head">
            <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            Customer profile
            <a class="db-edit-btn" href="/project/${project.id}?tab=customer" title="Edit">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </a>
          </div>
          <div class="db-profile-grid">
            <div class="db-field">
              <div class="db-fl">Name</div>
              <div class="db-fv">${esc(project.customer?.name||"—")}</div>
            </div>
            <div class="db-field">
              <div class="db-fl">Email</div>
              <div class="db-fv">${esc(project.customer?.email||"—")}</div>
            </div>
            <div class="db-field">
              <div class="db-fl">Phone</div>
              <div class="db-fv">${esc(project.customer?.phone||"—")}</div>
            </div>
            <div class="db-field">
              <div class="db-fl">Property type</div>
              <div class="db-fv db-prop-type">
                <svg width="14" height="14" fill="#22c55e" stroke="none" viewBox="0 0 24 24"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><polyline points="9 21 9 12 15 12 15 21" fill="#16a34a"/></svg>
                ${typeLabel}
              </div>
            </div>
            <div class="db-field db-field-full">
              <div class="db-fl">Property address</div>
              <div class="db-fv db-addr">
                <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
                <span>${addrLine1}${addrLine2 ? `<br><span style="padding-left:19px;">${addrLine2}</span>` : ""}</span>
              </div>
            </div>
            <div class="db-field db-field-full">
              <div class="db-fl">Authority Having Jurisdiction</div>
              <div class="db-fv"><a href="#" class="db-link">City of Waltham →</a></div>
            </div>
          </div>
        </div>

        <!-- Energy usage -->
        <div class="db-card">
          <div class="db-card-head">
            <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
            Energy usage
            <a class="db-edit-btn" href="/project/${project.id}?tab=energy" title="Edit">
              <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
            </a>
          </div>
          <div class="db-utility-block">
            <div class="db-fl">Utility provider</div>
            <div class="db-utility-name">Eversource Energy (Formerly NSTAR Electric Company)</div>
            <div class="db-utility-sub">R-1 (A1) Residential</div>
          </div>
          <div class="db-energy-grid">
            <div class="db-field"><div class="db-fl">Avg. monthly bill</div><div class="db-fv">—</div></div>
            <div class="db-field"><div class="db-fl">Avg. monthly energy</div><div class="db-fv">— kWh</div></div>
            <div class="db-field"><div class="db-fl">Annual bill</div><div class="db-fv">—</div></div>
            <div class="db-field"><div class="db-fl">Annual energy</div><div class="db-fv">— kWh</div></div>
          </div>
        </div>

      </div>

      <!-- Designs table -->
      <div class="db-section">
        <div class="db-section-head">
          <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          Designs
          <button class="db-new-btn">
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New design
          </button>
        </div>
        <table class="db-table">
          <thead>
            <tr>
              <th>Name</th><th>Updates</th><th>Milestone</th><th>Cost</th>
              <th>Offset</th><th>Size</th><th>Last edited</th><th></th>
            </tr>
          </thead>
          <tbody>
            <tr class="db-design-row" onclick="location.href='${designUrl}'">
              <td class="db-td-name">Design 1</td>
              <td>—</td>
              <td>—</td>
              <td>$0.00</td>
              <td>0%</td>
              <td>0 kW</td>
              <td>${timeAgo(project.createdAt)}</td>
              <td class="db-td-actions">
                <span class="db-sales-btn">
                  <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                  Sales Mode
                </span>
                <button class="db-more-btn" onclick="event.stopPropagation()">···</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Drone mapping -->
      <div class="db-section">
        <div class="db-inline-section">
          <div class="db-inline-left">
            <div class="db-section-head" style="border:none;padding:0;margin-bottom:10px;">
              <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
              Drone mapping
              <span class="db-beta">Beta</span>
            </div>
            <div class="db-inline-body">
              Upload your raw drone captured images to be processed into custom LIDAR and a custom map image.
              This free beta is available for a limited time while we evaluate performance and usage.
              <br/><a href="#" class="db-link" style="margin-top:8px;display:inline-block;">Learn more about drone mapping →</a>
            </div>
          </div>
          <button class="db-action-btn">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="21 15 21 21 15 21"/><polyline points="3 9 3 3 9 3"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
            Import files
          </button>
        </div>
      </div>

      <!-- Site Model Service -->
      <div class="db-section">
        <div class="db-inline-section">
          <div class="db-inline-left">
            <div class="db-section-head" style="border:none;padding:0;margin-bottom:10px;">
              <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><polyline points="9 21 9 12 15 12 15 21"/></svg>
              Site Model Service
            </div>
            <div class="db-inline-body">
              Request a 3D site model created by one of our experts. Learn more about
              <a href="#" class="db-link">EagleView</a> and <a href="#" class="db-link">Expert Models</a>.
            </div>
          </div>
          <button class="db-action-btn">Create new request</button>
        </div>
      </div>

      <!-- Plan Set Service -->
      <div class="db-section">
        <div class="db-inline-section">
          <div class="db-inline-left">
            <div class="db-section-head" style="border:none;padding:0;margin-bottom:10px;">
              <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              Plan Set Service
              <button class="db-new-btn" style="margin-left:auto;">
                <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New form
              </button>
            </div>
            <div class="db-inline-body">
              Request a permit-ready plan set created by an Aurora expert within 24 hours.
              <br/><a href="#" class="db-link" style="margin-top:8px;display:inline-block;">Learn more about our plan set service →</a>
            </div>
          </div>
        </div>
      </div>

      <!-- Engineering Stamp -->
      <div class="db-section">
        <div class="db-inline-section">
          <div class="db-inline-left">
            <div class="db-section-head" style="border:none;padding:0;margin-bottom:10px;">
              <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
              Engineering Stamp
            </div>
            <div class="db-inline-body">
              Have your plan set stamped by a certified engineer and delivered within 24 hours.
            </div>
          </div>
          <button class="db-action-btn">Request stamp</button>
        </div>
      </div>`;
  }

  else if (tab === "customer") {
    const nameParts = (project.customer?.name||"").split(" ");
    const firstName = esc(nameParts[0]||"");
    const lastName = esc(nameParts.slice(1).join(" ")||"");
    const mapSrc = project.lat && project.lng
      ? `https://maps.googleapis.com/maps/api/staticmap?center=${project.lat},${project.lng}&zoom=16&size=640x520&maptype=satellite&markers=color:red%7C${project.lat},${project.lng}&key=${process.env.GOOGLE_MAPS_KEY||""}`
      : "";
    tabContent = `
      <div class="cp-layout">
        <!-- Left: form -->
        <div class="cp-form">
          <div class="cp-title">
            <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            Customer profile
          </div>

          <div class="cp-row">
            <div class="cp-field">
              <label class="cp-label">First name</label>
              <input class="cp-input" type="text" placeholder="first name" value="${firstName}"/>
            </div>
            <div class="cp-field">
              <label class="cp-label">Last name</label>
              <input class="cp-input" type="text" placeholder="last name" value="${lastName}"/>
            </div>
          </div>

          <div class="cp-row">
            <div class="cp-field">
              <label class="cp-label">Phone</label>
              <div class="cp-phone-wrap">
                <div class="cp-flag">🇺🇸 <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></div>
                <input class="cp-input cp-phone-input" type="tel" placeholder="+1" value="${esc(project.customer?.phone||"")}"/>
              </div>
            </div>
            <div class="cp-field">
              <label class="cp-label">Email</label>
              <input class="cp-input" type="email" placeholder="email address" value="${esc(project.customer?.email||"")}"/>
            </div>
          </div>

          <div class="cp-field cp-field-full">
            <label class="cp-label">Mailing address</label>
            <div class="cp-input cp-addr-input">
              <svg width="14" height="14" fill="none" stroke="#9ca3af" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <span>${esc(project.address||"")}</span>
            </div>
          </div>

          <div class="cp-row cp-row-top" style="margin-top:6px;">
            <div class="cp-field">
              <label class="cp-label">Property address <span class="cp-info-icon">ⓘ</span></label>
              <div class="cp-addr-text">${esc(project.address||"—")}</div>
              ${project.lat ? `<div class="cp-coords">( ${parseFloat(project.lat).toFixed(3)}°, ${parseFloat(project.lng).toFixed(3)}° )</div>` : ""}
            </div>
            <div class="cp-field">
              <label class="cp-label">Property type</label>
              <div class="cp-prop-type">
                <svg width="15" height="15" fill="#22c55e" viewBox="0 0 24 24"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/></svg>
                ${typeLabel}
              </div>
            </div>
          </div>

          <div class="cp-field cp-field-full" style="margin-top:16px;">
            <label class="cp-label">Authority Having Jurisdiction</label>
            <div class="cp-input cp-addr-input">
              <svg width="14" height="14" fill="none" stroke="#9ca3af" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <span>City of ${esc((project.address||"").split(",")[1]||"").trim()}</span>
            </div>
            <a href="#" class="cp-jurisdiction-link">View jurisdiction</a>
          </div>
        </div>

        <!-- Right: satellite map -->
        <div class="cp-map">
          ${mapSrc
            ? `<img src="${mapSrc}" alt="Property satellite view" style="width:100%;height:100%;object-fit:cover;"/>`
            : `<div style="width:100%;height:100%;background:#e5e7eb;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:0.85rem;">No location data</div>`
          }
        </div>
      </div>`;
  }

  else if (tab === "documents") {
    tabContent = `
      <div class="doc-header">
        <div class="doc-title">
          <svg width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>
          Documents
        </div>
        <button class="doc-design-btn">
          Design 1
          <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
      </div>
      <div class="doc-divider"></div>

      <div class="doc-section">
        <div class="doc-section-label">Proposals</div>
        <div class="doc-cards-row">
          <div class="doc-card">
            <div class="doc-card-title">Web</div>
            <div class="doc-card-desc">Create a web proposal</div>
            <div class="doc-card-preview"></div>
            <button class="doc-card-btn">Create proposal</button>
          </div>
          <div class="doc-card">
            <div class="doc-card-title">PDF</div>
            <div class="doc-card-preview"></div>
            <button class="doc-card-btn">Create proposal</button>
          </div>
        </div>
      </div>

      <div class="doc-section">
        <div class="doc-section-label">Agreements <span class="doc-info-icon"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16" stroke-width="3" stroke-linecap="round"/></svg></span></div>
        <div class="doc-section-sub"><em>Powered by Docusign</em></div>
        <div class="doc-cards-row">
          <div class="doc-card">
            <div class="doc-card-title">New agreement</div>
            <div class="doc-card-desc">Select and send new agreements.</div>
            <div class="doc-card-preview"></div>
            <button class="doc-card-btn">New</button>
          </div>
        </div>
      </div>

      <div class="doc-section">
        <div class="doc-section-label">Legacy Agreements <span class="doc-info-icon"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16" stroke-width="3" stroke-linecap="round"/></svg></span></div>
        <div class="doc-cards-row">
          <div class="doc-card">
            <div class="doc-card-title">New agreement</div>
            <div class="doc-card-desc">Select and send new agreements.</div>
            <div class="doc-card-preview"></div>
            <button class="doc-card-btn">New</button>
          </div>
        </div>
      </div>

      <div class="doc-section">
        <div class="doc-section-label">System design</div>
        <div class="doc-cards-row">
          <div class="doc-card">
            <div class="doc-card-title">Shade report</div>
            <div class="doc-card-preview"></div>
            <button class="doc-card-btn">View and download</button>
          </div>
        </div>
      </div>

      <div class="doc-section">
        <div class="doc-section-label">Plan Sets</div>
        <div class="doc-cards-row">
          <div class="doc-card doc-card-empty">
            <svg width="30" height="30" fill="none" stroke="#c0c0c0" stroke-width="1.4" viewBox="0 0 24 24"><circle cx="12" cy="7" r="4"/><path d="M9 11l-3 9h12l-3-9"/><line x1="12" y1="16" x2="12" y2="20" stroke-width="2"/></svg>
            <div class="doc-card-empty-text">Your completed plan sets and stamps will be available to download here.</div>
          </div>
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
      height: 44px; border-bottom: 1px solid #e5e7eb;
      display: flex; align-items: center; padding: 0 16px; flex-shrink: 0; gap: 10px;
    }
    .th-back {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 0.83rem; color: #6b7280; text-decoration: none; white-space: nowrap;
    }
    .th-back:hover { color: #111; }
    .th-center {
      flex: 1; text-align: center; font-size: 0.83rem; color: #9ca3af;
    }
    .th-center strong { color: #111; font-weight: 600; }
    .th-icons { display: flex; align-items: center; gap: 8px; }
    .th-icon-btn {
      background: none; border: none; cursor: pointer; color: #9ca3af;
      padding: 5px; border-radius: 5px; display: flex; align-items: center;
    }
    .th-icon-btn:hover { color: #374151; background: #f3f4f6; }
    .th-avatar {
      width: 28px; height: 28px; border-radius: 50%;
      background: #7c3aed; display: flex; align-items: center; justify-content: center;
      font-size: 0.7rem; font-weight: 700; color: #fff; cursor: pointer;
    }

    /* ── Sub-header ── */
    .sub-header {
      height: 44px; border-bottom: 1px solid #e5e7eb;
      display: flex; align-items: center; padding: 0 16px; gap: 12px;
      flex-shrink: 0; background: #fff;
    }
    .sh-customer-name { font-size: 0.85rem; font-weight: 600; color: #111; white-space: nowrap; }
    .sh-more {
      background: none; border: none; cursor: pointer; color: #9ca3af;
      font-size: 1rem; letter-spacing: 1px; padding: 2px 4px; border-radius: 4px;
    }
    .sh-more:hover { color: #374151; background: #f3f4f6; }
    .progress-wrap { display: flex; align-items: center; gap: 8px; }
    .progress-bar { width: 80px; height: 3px; background: #e5e7eb; border-radius: 2px; }
    .progress-fill { height: 100%; width: 17%; background: #111; border-radius: 2px; }
    .progress-text { font-size: 0.75rem; color: #6b7280; white-space: nowrap; }
    .sh-dropdown {
      display: inline-flex; align-items: center; gap: 6px;
      font-size: 0.82rem; color: #374151; cursor: pointer;
      padding: 5px 10px; border-radius: 6px; border: 1px solid #e5e7eb;
      background: #fff; white-space: nowrap;
    }
    .sh-dropdown:hover { background: #f9fafb; }
    .sh-dropdown svg { color: #9ca3af; }
    .assignee-dot {
      width: 22px; height: 22px; border-radius: 50%;
      background: #dc2626; display: flex; align-items: center; justify-content: center;
      font-size: 0.62rem; font-weight: 700; color: #fff;
    }
    .sh-right { margin-left: auto; display: flex; gap: 8px; }
    .mode-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border-radius: 6px; font-size: 0.8rem; font-weight: 600;
      cursor: pointer; text-decoration: none; border: none; white-space: nowrap;
    }
    .mode-btn-outline { background: #fff; border: 1px solid #e5e7eb; color: #374151; }
    .mode-btn-outline:hover { background: #f9fafb; }
    .mode-btn-dark { background: #111; color: #fff; }
    .mode-btn-dark:hover { background: #333; }
    .mode-btn-design { background: #1f2937; color: #fff; border: none; }
    .mode-btn-design:hover { background: #374151; }
    /* Design mode dropdown */
    .dm-wrap { position: relative; }
    .dm-dropdown {
      display: none; position: absolute; right: 0; top: calc(100% + 6px);
      background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,.12); min-width: 230px; z-index: 200;
      overflow: hidden;
    }
    .dm-dropdown.open { display: block; }
    .dm-design-item {
      display: block; padding: 11px 14px; text-decoration: none;
      border-bottom: 1px solid #f3f4f6; cursor: pointer;
    }
    .dm-design-item:hover { background: #f9fafb; }
    .dm-design-name { font-size: 0.83rem; font-weight: 600; color: #111827; }
    .dm-design-meta { font-size: 0.73rem; color: #6b7280; margin-top: 2px; }
    .dm-create-btn {
      display: flex; align-items: center; gap: 6px;
      width: 100%; padding: 10px 14px; border: none; background: none;
      font-size: 0.8rem; color: #4f46e5; font-weight: 500; cursor: pointer;
      text-align: left;
    }
    .dm-create-btn:hover { background: #f5f3ff; }

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
    .sidebar-more-wrap { position: relative; }
    .sidebar-more {
      background: none; border: none; cursor: pointer; color: #9ca3af;
      font-size: 1.1rem; letter-spacing: 1px; padding: 4px 8px; border-radius: 6px; line-height: 1;
    }
    .sidebar-more:hover { background: #f3f4f6; color: #374151; }
    .sidebar-more-menu {
      display: none; position: absolute; right: 0; top: calc(100% + 4px); z-index: 200;
      background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.1); min-width: 160px; padding: 4px 0;
    }
    .sidebar-more-menu.open { display: block; }
    .sidebar-more-menu .menu-item {
      display: block; width: 100%; text-align: left; padding: 8px 14px;
      border: none; background: none; font-size: 0.85rem; color: #374151; cursor: pointer;
    }
    .sidebar-more-menu .menu-item:hover { background: #f9fafb; }
    .sidebar-more-menu .menu-item.danger { color: #dc2626; }
    .sidebar-more-menu .menu-divider { height: 1px; background: #f3f4f6; margin: 4px 0; }

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
      min-height: 340px; position: relative;
      transition: border-color 0.15s, box-shadow 0.15s, transform 0.15s;
    }
    .design-card:hover {
      border-color: #2563eb;
      box-shadow: 0 0 0 3px rgba(37,99,235,0.1), 0 4px 16px rgba(0,0,0,0.07);
      transform: translateY(-2px);
    }
    .design-card-clickable { cursor: pointer; text-decoration: none; color: inherit; }
    .design-card-clickable .dc-open-hint {
      position: absolute; top: 14px; right: 14px;
      opacity: 0; pointer-events: none;
      display: inline-flex; align-items: center; gap: 4px;
      font-size: 0.75rem; font-weight: 600; color: #2563eb;
      transition: opacity 0.15s;
    }
    .design-card-clickable:hover .dc-open-hint { opacity: 0; }
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
    .upload-box.drag-over { background: #f0f4ff; border-color: #6b7280; }
    .upload-title { font-size: 0.95rem; font-weight: 600; color: #111; display: flex; align-items: center; gap: 7px; }
    .upload-sub { font-size: 0.8rem; color: #9ca3af; }

    .rate-label { font-size: 0.8rem; font-weight: 600; color: #374151; margin-bottom: 6px; }
    .esc-wrap { display: flex; flex-direction: column; gap: 4px; flex-shrink: 0; }
    .esc-label { font-size: 0.75rem; color: #6b7280; font-weight: 600; }
    .esc-input-row { display: flex; align-items: center; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
    .esc-input { width: 60px; padding: 9px 10px; border: none; font-size: 0.85rem; outline: none; background: #f9fafb; }
    .esc-unit { padding: 9px 10px; background: #f3f4f6; font-size: 0.83rem; color: #6b7280; }
    .view-rate-btn {
      padding: 9px 16px; border: 1px solid #e5e7eb; border-radius: 6px;
      background: #fff; font-size: 0.83rem; color: #374151; cursor: pointer; white-space: nowrap;
    }
    .view-rate-btn:hover { background: #f9fafb; }

    /* ── Interval data section ── */
    .interval-rate-row { display: flex; align-items: flex-start; gap: 16px; margin-bottom: 0; }
    .rate-custom-wrap { position: relative; }
    .rate-custom-trigger {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 12px; border: 1px solid #e5e7eb; border-radius: 6px;
      background: #f9fafb; cursor: pointer; gap: 10px;
    }
    .rate-custom-trigger:hover { border-color: #d1d5db; }
    .rate-custom-wrap.open .rate-custom-trigger { border-color: #9ca3af; background: #fff; }
    .rate-trigger-content { flex: 1; min-width: 0; }
    .rate-trigger-group { font-size: 0.72rem; color: #9ca3af; margin-bottom: 2px; }
    .rate-trigger-value { font-size: 0.85rem; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .rate-trigger-arrow { flex-shrink: 0; color: #6b7280; transition: transform 0.15s; }
    .rate-custom-wrap.open .rate-trigger-arrow { transform: rotate(180deg); }
    .rate-custom-menu {
      display: none; position: absolute; top: calc(100% + 4px); left: 0; right: 0;
      background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12); z-index: 300;
    }
    .rate-custom-wrap.open .rate-custom-menu { display: block; }
    .rate-search-row { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid #f3f4f6; }
    .rate-search-input { flex: 1; border: none; outline: none; font-size: 0.85rem; color: #374151; background: transparent; }
    .rate-options-list { max-height: 220px; overflow-y: auto; }
    .rate-group-label { font-size: 0.72rem; color: #9ca3af; padding: 8px 12px 4px; font-weight: 500; }
    .rate-option { display: flex; align-items: center; gap: 8px; padding: 9px 12px; cursor: pointer; font-size: 0.85rem; color: #374151; }
    .rate-option:hover { background: #f9fafb; }
    .rate-option.selected { font-weight: 600; color: #111; }
    .rate-option span { flex: 1; }
    .rate-check { color: #111; opacity: 0; flex-shrink: 0; }
    .rate-option.selected .rate-check { opacity: 1; }
    .rate-nem-icon { flex-shrink: 0; }
    .add-interval-btn { margin-top: 16px; padding: 8px 16px; border: 1px solid #e5e7eb; border-radius: 6px; background: #fff; font-size: 0.85rem; color: #374151; cursor: pointer; }
    .add-interval-btn:hover { background: #f9fafb; }

    /* ── Existing system alert ── */
    .existing-system-alert {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; background: #111; color: #fff; border-radius: 6px;
      margin-bottom: 16px; font-size: 0.85rem; gap: 16px;
    }
    .existing-system-link { color: #fff; font-weight: 600; white-space: nowrap; text-decoration: none; }
    .existing-system-link:hover { text-decoration: underline; }

    /* ── Average month input ── */
    .avg-month-input-wrap {
      display: flex; align-items: center; border: 1px solid #e5e7eb; border-radius: 6px;
      background: #f9fafb; overflow: hidden; max-width: 340px;
    }
    .avg-month-prefix { padding: 9px 4px 9px 12px; font-size: 0.85rem; color: #374151; }
    .avg-month-input { flex: 1; padding: 9px 12px; border: none; background: transparent; font-size: 0.85rem; color: #111; outline: none; min-width: 0; }
    .avg-month-suffix { padding: 9px 12px; font-size: 0.85rem; color: #6b7280; }

    /* ── Annual estimate input ── */
    .annual-input-row {
      display: flex; align-items: center; border: 1px solid #e5e7eb; border-radius: 6px;
      background: #f9fafb; overflow: hidden; max-width: 340px;
    }
    .annual-input { flex: 1; padding: 9px 12px; border: none; background: transparent; font-size: 0.85rem; color: #111; outline: none; min-width: 0; }
    .annual-unit { padding: 9px 12px; font-size: 0.85rem; color: #6b7280; background: #f3f4f6; border-left: 1px solid #e5e7eb; }

    .monthly-controls { display: flex; align-items: flex-start; gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
    .control-group { display: flex; flex-direction: column; gap: 5px; }
    .ctrl-label { font-size: 0.78rem; font-weight: 600; color: #374151; }
    .ctrl-select { padding: 8px 12px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 0.83rem; color: #374151; background: #fff; outline: none; cursor: pointer; }

    /* ── Input method custom dropdown ── */
    .imethod-wrap { position: relative; }
    .imethod-trigger {
      display: flex; align-items: center; justify-content: space-between; gap: 24px;
      padding: 8px 10px 8px 12px; border: 1px solid #e5e7eb; border-radius: 6px;
      font-size: 0.83rem; color: #374151; background: #fff; cursor: pointer;
      min-width: 220px; user-select: none;
    }
    .imethod-trigger:hover { border-color: #d1d5db; }
    .imethod-trigger.open { border-color: #9ca3af; }
    .imethod-trigger svg { flex-shrink: 0; color: #6b7280; transition: transform 0.15s; }
    .imethod-trigger.open svg { transform: rotate(180deg); }
    .imethod-menu {
      position: absolute; top: calc(100% + 4px); left: 0;
      background: #fff; border-radius: 8px; min-width: 100%;
      box-shadow: 0 4px 20px rgba(0,0,0,0.13), 0 1px 4px rgba(0,0,0,0.07);
      z-index: 300; display: none; padding: 4px 0;
    }
    .imethod-wrap.open .imethod-menu { display: block; }
    .imethod-option {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; font-size: 0.84rem; color: #374151; cursor: pointer; gap: 16px;
      white-space: nowrap;
    }
    .imethod-option:hover { background: #f9fafb; }
    .imethod-option.selected { font-weight: 600; color: #111; }
    .imethod-check { color: #111; opacity: 0; flex-shrink: 0; }
    .imethod-option.selected .imethod-check { opacity: 1; }
    .unit-toggle { display: flex; border: 1px solid #e5e7eb; border-radius: 6px; overflow: hidden; }
    .unit-btn { padding: 7px 14px; border: none; background: #fff; font-size: 0.83rem; color: #6b7280; cursor: pointer; }
    .unit-btn.active { background: #111; color: #fff; font-weight: 600; }

    /* ── Month grid ── */
    .months-grid { display: grid; grid-template-columns: repeat(6,1fr); gap: 10px 12px; margin-bottom: 24px; }
    .month-field { display: flex; flex-direction: column; gap: 4px; }
    .month-label { font-size: 0.78rem; color: #6b7280; }
    .month-input-row { display: flex; align-items: center; border: 1px solid #e5e7eb; border-radius: 6px; background: #f9fafb; overflow: hidden; }
    .month-input { flex: 1; padding: 7px 8px; border: none; background: transparent; font-size: 0.85rem; color: #111; outline: none; min-width: 0; }
    .month-input-row:focus-within { border-color: #9ca3af; background: #fff; }
    .month-unit { padding: 7px 8px; font-size: 0.78rem; color: #9ca3af; flex-shrink: 0; }

    .energy-tabs { display: flex; gap: 0; border-bottom: 1px solid #e5e7eb; margin-bottom: 20px; }
    .etab { padding: 9px 16px; border: none; background: none; font-size: 0.85rem; color: #6b7280; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
    .etab.active { color: #111; font-weight: 600; border-bottom-color: #111; }

    .energy-stats { display: flex; gap: 40px; margin-bottom: 20px; }
    .estat-label { font-size: 0.75rem; color: #9ca3af; margin-bottom: 4px; }
    .estat-val { font-size: 2rem; font-weight: 700; color: #111; }
    .estat-unit { font-size: 0.9rem; font-weight: 400; color: #6b7280; }

    /* ── Dashboard tab ── */
    .db-top-row { display: flex; gap: 16px; margin-bottom: 16px; }
    .db-card {
      flex: 1; border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px 24px; min-width: 0;
    }
    .db-card-head {
      display: flex; align-items: center; gap: 8px;
      font-size: 0.9rem; font-weight: 600; color: #111;
      padding-bottom: 16px; border-bottom: 1px solid #f3f4f6; margin-bottom: 18px;
    }
    .db-edit-btn {
      margin-left: auto; background: none; border: none; cursor: pointer;
      color: #9ca3af; padding: 3px; border-radius: 4px; display: flex; align-items: center;
      text-decoration: none;
    }
    .db-edit-btn:hover { color: #374151; background: #f3f4f6; }
    .db-profile-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 24px; }
    .db-field-full { grid-column: 1 / -1; }
    .db-fl { font-size: 0.75rem; color: #9ca3af; margin-bottom: 4px; }
    .db-fv { font-size: 0.85rem; color: #111; }
    .db-prop-type { display: inline-flex; align-items: center; gap: 5px; }
    .db-addr { display: flex; align-items: flex-start; gap: 5px; }
    .db-addr svg { flex-shrink: 0; margin-top: 2px; color: #6b7280; }
    .db-link { color: #2563eb; text-decoration: none; font-size: 0.85rem; }
    .db-link:hover { text-decoration: underline; }
    .db-utility-block { margin-bottom: 18px; }
    .db-utility-name { font-size: 0.85rem; font-weight: 500; color: #111; margin: 4px 0 2px; }
    .db-utility-sub { font-size: 0.78rem; color: #6b7280; }
    .db-energy-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 24px; }

    .db-section {
      border: 1px solid #e5e7eb; border-radius: 10px; margin-bottom: 16px; overflow: hidden;
    }
    .db-section-head {
      display: flex; align-items: center; gap: 8px;
      font-size: 0.88rem; font-weight: 600; color: #111;
      padding: 14px 20px; border-bottom: 1px solid #f3f4f6;
    }
    .db-new-btn {
      margin-left: auto; display: inline-flex; align-items: center; gap: 5px;
      background: none; border: none; cursor: pointer;
      font-size: 0.82rem; font-weight: 600; color: #374151; padding: 4px 0;
    }
    .db-new-btn:hover { color: #111; }
    .db-beta {
      background: #f59e0b; color: #fff; font-size: 0.65rem; font-weight: 700;
      padding: 2px 6px; border-radius: 4px; text-transform: uppercase; letter-spacing: 0.3px;
    }

    /* Designs table */
    .db-table { width: 100%; border-collapse: collapse; }
    .db-table thead tr { border-bottom: 1px solid #f3f4f6; }
    .db-table th {
      padding: 10px 14px; font-size: 0.75rem; color: #9ca3af;
      font-weight: 500; text-align: left; white-space: nowrap;
    }
    .db-table td { padding: 12px 14px; font-size: 0.85rem; color: #374151; }
    .db-design-row { cursor: pointer; transition: background 0.1s; }
    .db-design-row:hover { background: #f9fafb; }
    .db-td-name { font-weight: 500; color: #111; }
    .db-td-actions {
      display: flex; align-items: center; gap: 10px;
      justify-content: flex-end; white-space: nowrap;
    }
    .db-sales-btn {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 5px 10px; border: 1px solid #e5e7eb; border-radius: 6px;
      font-size: 0.78rem; font-weight: 500; color: #374151; background: #fff;
      pointer-events: none;
    }
    .db-more-btn {
      background: none; border: none; cursor: pointer;
      font-size: 0.95rem; color: #9ca3af; padding: 3px 6px; border-radius: 4px;
      letter-spacing: 1px;
    }
    .db-more-btn:hover { color: #374151; background: #f3f4f6; }

    /* Inline sections (body text left, button right) */
    .db-inline-section {
      display: flex; align-items: center; gap: 20px;
      padding: 18px 20px;
    }
    .db-inline-left { flex: 1; min-width: 0; }
    .db-inline-body { font-size: 0.84rem; color: #6b7280; line-height: 1.6; }
    .db-action-btn {
      flex-shrink: 0; padding: 9px 18px; border: 1px solid #d1d5db; border-radius: 7px;
      background: #fff; font-size: 0.84rem; color: #374151; cursor: pointer;
      display: inline-flex; align-items: center; gap: 7px; white-space: nowrap;
      transition: background 0.12s;
    }
    .db-action-btn:hover { background: #f9fafb; }

    /* ── Customer profile tab ── */
    .cp-layout {
      display: flex; gap: 0;
      height: calc(100vh - 92px);
      margin: -28px -32px;
      overflow: hidden;
    }
    .main:has(.cp-layout) { padding: 0; overflow: hidden; }
    .cp-form {
      width: 50%; min-width: 360px; padding: 32px 36px;
      overflow-y: auto; flex-shrink: 0;
    }
    .cp-map {
      flex: 1; background: #e5e7eb; overflow: hidden;
    }
    .cp-map img { display: block; }
    .cp-title {
      display: flex; align-items: center; gap: 10px;
      font-size: 1.25rem; font-weight: 700; color: #111;
      margin-bottom: 28px;
    }
    .cp-title svg { color: #6b7280; }
    .cp-row { display: flex; gap: 16px; margin-bottom: 18px; }
    .cp-row-top { align-items: flex-start; }
    .cp-field { flex: 1; display: flex; flex-direction: column; gap: 6px; }
    .cp-field-full { margin-bottom: 18px; }
    .cp-label {
      font-size: 0.78rem; color: #374151; font-weight: 500;
      display: flex; align-items: center; gap: 5px;
    }
    .cp-info-icon { font-size: 0.75rem; color: #9ca3af; cursor: help; }
    .cp-input {
      padding: 9px 12px; border: 1px solid #e5e7eb; border-radius: 7px;
      font-size: 0.85rem; color: #111; background: #f9fafb;
      outline: none; width: 100%;
    }
    .cp-input:focus { border-color: #9ca3af; background: #fff; }
    .cp-input::placeholder { color: #9ca3af; }
    .cp-addr-input {
      display: flex; align-items: center; gap: 8px;
      padding: 9px 12px; border: 1px solid #e5e7eb; border-radius: 7px;
      font-size: 0.85rem; color: #111; background: #f9fafb;
    }
    .cp-phone-wrap { display: flex; border: 1px solid #e5e7eb; border-radius: 7px; overflow: hidden; background: #f9fafb; }
    .cp-flag {
      display: flex; align-items: center; gap: 4px;
      padding: 9px 10px; border-right: 1px solid #e5e7eb;
      font-size: 0.85rem; cursor: pointer; white-space: nowrap; flex-shrink: 0;
    }
    .cp-phone-input { border: none; border-radius: 0; background: transparent; }
    .cp-addr-text { font-size: 0.85rem; color: #111; line-height: 1.5; }
    .cp-coords { font-size: 0.78rem; color: #6b7280; margin-top: 3px; }
    .cp-prop-type {
      display: inline-flex; align-items: center; gap: 7px;
      font-size: 0.85rem; color: #111; margin-top: 4px;
    }
    .cp-jurisdiction-link {
      display: inline-block; margin-top: 8px;
      font-size: 0.84rem; color: #2563eb; text-decoration: none; font-weight: 500;
    }
    .cp-jurisdiction-link:hover { text-decoration: underline; }

    /* ── Documents tab ── */
    .doc-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 20px;
    }
    .doc-title {
      display: flex; align-items: center; gap: 10px;
      font-size: 1.25rem; font-weight: 700; color: #111;
    }
    .doc-title svg { color: #6b7280; }
    .doc-design-btn {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 12px; border: 1px solid #e5e7eb; border-radius: 6px;
      background: #fff; font-size: 0.83rem; font-weight: 500; color: #374151;
      cursor: pointer;
    }
    .doc-design-btn:hover { background: #f9fafb; }
    .doc-divider { height: 1px; background: #e5e7eb; margin-bottom: 28px; }
    .doc-section { margin-bottom: 32px; }
    .doc-section-label {
      font-size: 0.9rem; font-weight: 600; color: #111;
      margin-bottom: 6px; display: flex; align-items: center; gap: 6px;
    }
    .doc-info-icon { color: #9ca3af; display: inline-flex; align-items: center; cursor: help; }
    .doc-section-sub { font-size: 0.8rem; color: #9ca3af; margin-bottom: 14px; }
    .doc-cards-row { display: flex; gap: 16px; flex-wrap: wrap; }
    .doc-card {
      width: 190px; border: 1px solid #e5e7eb; border-radius: 8px;
      display: flex; flex-direction: column; overflow: hidden;
      background: #fff;
    }
    .doc-card-title {
      font-size: 0.88rem; font-weight: 600; color: #111;
      padding: 14px 14px 4px;
    }
    .doc-card-desc { font-size: 0.78rem; color: #6b7280; padding: 0 14px 10px; line-height: 1.4; }
    .doc-card-preview { flex: 1; min-height: 160px; background: #fff; }
    .doc-card-btn {
      margin: 0 14px 14px; padding: 8px 0;
      border: 1px solid #d1d5db; border-radius: 6px;
      background: #fff; font-size: 0.82rem; color: #374151;
      cursor: pointer; text-align: center;
    }
    .doc-card-btn:hover { background: #f9fafb; }
    .doc-card-empty {
      background: #f9fafb; align-items: center; justify-content: center;
      padding: 40px 20px; text-align: center; border-style: solid; min-height: 240px;
      gap: 12px;
    }
    .doc-card-empty-text { font-size: 0.78rem; color: #9ca3af; line-height: 1.5; }
  </style>
</head>
<body>

  <!-- Top header -->
  <div class="top-header">
    <a class="th-back" href="/">
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg>
      Projects
    </a>
    <div class="th-center">Team Sunshine &nbsp;/&nbsp; <strong>${customerName}</strong></div>
    <div class="th-icons">
      <button class="th-icon-btn" title="Notifications">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
      </button>
      <div class="th-avatar">${customerName[0].toUpperCase()}</div>
    </div>
  </div>

  <!-- Sub-header -->
  <div class="sub-header">
    <div class="sh-customer-name">${customerName}</div>
    <button class="sh-more">···</button>
    <div class="progress-wrap">
      <div class="progress-bar"><div class="progress-fill"></div></div>
      <span class="progress-text">1 / 6</span>
    </div>
    <button class="sh-dropdown">
      Remote Assessment Completed
      <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <button class="sh-dropdown">
      <div class="assignee-dot">J</div>
      Juliana Imeraj
      <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="sh-right">
      <div class="dm-wrap" id="dmWrap">
        <button class="mode-btn mode-btn-design" id="dmBtn" onclick="toggleDmMenu(event)">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          Design mode
          <svg id="dmChevron" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 15 12 9 18 15"/></svg>
        </button>
        <div class="dm-dropdown" id="dmDropdown">
          <a class="dm-design-item" href="${designUrl}">
            <div class="dm-design-name">Design 1</div>
            <div class="dm-design-meta">$46,225.00 · 0% · 10.75 kW</div>
          </a>
          <button class="dm-create-btn">+ Create new design</button>
        </div>
      </div>
      <button class="mode-btn mode-btn-outline">
        <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        Sales mode
        <svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
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
        <div class="sidebar-more-wrap" onclick="event.stopPropagation()">
          <button class="sidebar-more" onclick="toggleSidebarMenu()">···</button>
          <div class="sidebar-more-menu" id="sidebarMoreMenu">
            <button class="menu-item">Rename</button>
            <button class="menu-item">Assign to team</button>
            <div class="menu-divider"></div>
            <button class="menu-item danger">Delete</button>
            <button class="menu-item">Archive</button>
          </div>
        </div>
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
    function handleBillFile(input) {
      if (input.files && input.files[0]) {
        document.getElementById('uploadTitle').textContent = input.files[0].name;
        document.querySelector('.upload-box').style.borderColor = '#6b7280';
      }
    }
    function handleBillDrop(e) {
      e.preventDefault();
      e.currentTarget.classList.remove('drag-over');
      var file = e.dataTransfer.files[0];
      if (file) {
        document.getElementById('uploadTitle').textContent = file.name;
        e.currentTarget.style.borderColor = '#6b7280';
      }
    }

    function setUnit(btn, val) {
      document.querySelectorAll('.unit-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      var prefix = document.getElementById('avgMonthPrefix');
      var suffix = document.getElementById('avgMonthSuffix');
      var label1 = document.getElementById('estatLabel1');
      if (val === 'dollar') {
        if (prefix) prefix.style.display = '';
        if (suffix) suffix.style.display = 'none';
        if (label1) label1.textContent = 'Annual bill';
      } else {
        if (prefix) prefix.style.display = 'none';
        if (suffix) suffix.style.display = '';
        if (label1) label1.textContent = 'Annual energy';
      }
    }

    /* ── Input method dropdown ── */
    function toggleIMethod(e) {
      e.stopPropagation();
      var wrap = document.getElementById('imethodWrap');
      var trigger = document.getElementById('imethodTrigger');
      var isOpen = wrap.classList.contains('open');
      wrap.classList.toggle('open', !isOpen);
      trigger.classList.toggle('open', !isOpen);
    }
    function selectIMethod(el, label) {
      document.querySelectorAll('.imethod-option').forEach(o => o.classList.remove('selected'));
      el.classList.add('selected');
      document.getElementById('imethodLabel').textContent = label;
      document.getElementById('imethodWrap').classList.remove('open');
      document.getElementById('imethodTrigger').classList.remove('open');
      updateEnergyMode(label);
    }
    function updateEnergyMode(mode) {
      var ids = ['unitsGroup','editAppliancesBtn','existingSystemAlert','avgMonthSection','monthsGrid','annualEstSection','intervalSection','energyUploadBox'];
      ids.forEach(function(id) { var el = document.getElementById(id); if (el) el.style.display = 'none'; });
      var locationGroup = document.getElementById('locationGroup');
      if (locationGroup) locationGroup.style.display = 'none';

      if (mode === 'Monthly average') {
        document.getElementById('unitsGroup').style.display = '';
        document.getElementById('avgMonthSection').style.display = '';
      } else if (mode === 'Monthly estimate (1-12 months)') {
        if (locationGroup) locationGroup.style.display = '';
        document.getElementById('monthsGrid').style.display = '';
      } else if (mode === 'Monthly estimate with existing system') {
        if (locationGroup) locationGroup.style.display = '';
        document.getElementById('editAppliancesBtn').style.display = '';
        document.getElementById('existingSystemAlert').style.display = '';
        document.getElementById('monthsGrid').style.display = '';
      } else if (mode === 'Annual energy estimate') {
        if (locationGroup) locationGroup.style.display = '';
        document.getElementById('annualEstSection').style.display = '';
      } else if (mode === 'Interval data') {
        document.getElementById('energyUploadBox').style.display = '';
        document.getElementById('intervalSection').style.display = '';
      }
    }
    document.addEventListener('click', function(e) {
      var wrap = document.getElementById('imethodWrap');
      if (wrap && !wrap.contains(e.target)) { wrap.classList.remove('open'); document.getElementById('imethodTrigger').classList.remove('open'); }
      document.querySelectorAll('.rate-custom-wrap.open').forEach(function(w) {
        if (!w.contains(e.target)) w.classList.remove('open');
      });
    });

    /* ── Rate custom dropdowns ── */
    function toggleRateDropdown(wrapId, e) {
      e.stopPropagation();
      var wrap = document.getElementById(wrapId);
      var isOpen = wrap.classList.contains('open');
      document.querySelectorAll('.rate-custom-wrap.open').forEach(function(w) { w.classList.remove('open'); });
      if (!isOpen) wrap.classList.add('open');
    }
    function selectRate(wrapId, valueElId, optionEl) {
      var wrap = document.getElementById(wrapId);
      wrap.querySelectorAll('.rate-option').forEach(function(o) { o.classList.remove('selected'); });
      optionEl.classList.add('selected');
      var valueEl = document.getElementById(valueElId);
      if (valueEl) valueEl.textContent = optionEl.dataset.value || optionEl.querySelector('span').textContent;
      var groupEl = wrap.querySelector('.rate-trigger-group');
      if (groupEl) groupEl.textContent = optionEl.dataset.group || '';
      wrap.classList.remove('open');
    }
    function filterRateOptions(menuId, query) {
      var menu = document.getElementById(menuId);
      var q = query.toLowerCase();
      menu.querySelectorAll('.rate-option').forEach(function(opt) {
        var text = opt.querySelector('span') ? opt.querySelector('span').textContent.toLowerCase() : '';
        opt.style.display = (!q || text.includes(q)) ? '' : 'none';
      });
    }

    function setETab(btn) {
      document.querySelectorAll('.etab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
    function toggleDmMenu(e) {
      e.stopPropagation();
      document.getElementById('dmDropdown').classList.toggle('open');
    }
    function toggleSidebarMenu() {
      document.getElementById('sidebarMoreMenu').classList.toggle('open');
    }
    document.addEventListener('click', function(e) {
      var dmWrap = document.getElementById('dmWrap');
      if (dmWrap && !dmWrap.contains(e.target)) {
        document.getElementById('dmDropdown').classList.remove('open');
      }
      var smMenu = document.getElementById('sidebarMoreMenu');
      if (smMenu && !smMenu.closest('.sidebar-more-wrap').contains(e.target)) {
        smMenu.classList.remove('open');
      }
    });
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
      padding: 5px 12px;
      border-radius: 7px;
      cursor: pointer;
      font-size: 0.88rem;
      font-weight: 600;
      color: #111;
      background: #fff;
      border: 1.5px solid #d1d5db;
      box-shadow: 0 1px 3px rgba(0,0,0,0.07);
      transition: background 0.15s, border-color 0.15s;
    }
    .tb-design-name:hover { background: #f5f5f5; border-color: #b0b7c3; }
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
    .tb-stats-expand { color: #aaa; cursor: pointer; padding: 2px; transition: transform 0.2s; }
    .tb-stats-expand.open { transform: rotate(180deg); }

    .prod-tabs {
      display: flex;
      border-bottom: 1px solid #eee;
      padding: 0 16px;
    }
    .prod-tab {
      display: flex; align-items: center; gap: 6px;
      padding: 12px 0; margin-right: 20px;
      font-size: 0.85rem; font-weight: 600; color: #aaa;
      border-bottom: 2px solid transparent;
      background: none; border-top: none; border-left: none; border-right: none;
      cursor: pointer; transition: color 0.15s;
    }
    .prod-tab.active { color: #111; border-bottom-color: #111; }
    .prod-tab:hover:not(.active) { color: #555; }

    .prod-body { padding: 16px; }

    .prod-section-title { font-size: 0.95rem; font-weight: 700; color: #111; margin-bottom: 12px; }
    .prod-stats-row { display: flex; gap: 28px; margin-bottom: 20px; }
    .prod-stat-item { }
    .prod-stat-label { font-size: 0.72rem; color: #999; margin-bottom: 2px; }
    .prod-stat-val { font-size: 1.4rem; font-weight: 700; color: #111; }
    .prod-stat-val span { font-size: 0.78rem; font-weight: 400; color: #777; margin-left: 2px; }

    .prod-chart-header {
      display: flex; align-items: center; justify-content: space-between;
      margin-bottom: 10px;
    }
    .prod-chart-title { font-size: 0.82rem; font-weight: 600; color: #111; display: flex; align-items: center; gap: 6px; }
    .prod-chart-copy { background: none; border: 1px solid #e0e0e0; border-radius: 5px; padding: 3px 6px; cursor: pointer; color: #888; font-size: 0.72rem; }
    .prod-chart-copy:hover { background: #f5f5f5; }

    .prod-chart-wrap { position: relative; height: 160px; margin-bottom: 6px; }
    .prod-chart-wrap canvas { width: 100% !important; height: 100% !important; }

    .prod-legend { display: flex; gap: 14px; margin-bottom: 14px; }
    .prod-legend-item { display: flex; align-items: center; gap: 5px; font-size: 0.72rem; color: #555; }
    .prod-legend-dot { width: 10px; height: 10px; border-radius: 2px; }

    .prod-lidar-badge {
      display: flex; align-items: center; gap: 6px;
      font-size: 0.78rem; color: #555;
      margin-bottom: 10px;
    }
    .prod-lidar-badge svg { color: #7c3aed; }

    .prod-advanced {
      display: flex; align-items: center; gap: 4px;
      font-size: 0.78rem; color: #555; cursor: pointer;
      background: none; border: none; padding: 0;
      margin-bottom: 14px;
    }
    .prod-advanced:hover { color: #111; }

    .prod-divider { border: none; border-top: 1px solid #eee; margin: 0 0 14px; }

    .prod-energy-section { }
    .prod-energy-title { font-size: 0.88rem; font-weight: 700; color: #111; margin-bottom: 10px; }
    .prod-no-data {
      display: flex; align-items: center; justify-content: space-between;
      background: #111; color: #fff;
      border-radius: 8px; padding: 12px 16px;
      font-size: 0.82rem;
    }
    .prod-no-data-left { display: flex; align-items: center; gap: 8px; }
    .prod-add-btn {
      background: none; border: none; color: #fff;
      font-size: 0.82rem; font-weight: 600; cursor: pointer;
      white-space: nowrap;
    }
    .prod-add-btn:hover { text-decoration: underline; }
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

    /* ── LEFT PANEL (floating card) ── */
    .left-panel {
      position: absolute;
      top: 14px;
      left: 14px;
      width: 188px;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.18), 0 1px 4px rgba(0,0,0,0.10);
      display: flex;
      flex-direction: column;
      z-index: 20;
      overflow: hidden;
      transition: opacity 0.2s, transform 0.2s;
    }
    .left-panel.collapsed {
      opacity: 0;
      pointer-events: none;
      transform: translateY(-6px);
    }
    .lp-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 12px 8px;
      border-bottom: 1px solid #f0f0f0;
      flex-shrink: 0;
    }
    .lp-grid-icon {
      width: 28px; height: 28px;
      display: flex; align-items: center; justify-content: center;
      color: #555;
    }
    .lp-collapse-btn {
      background: none; border: none; cursor: pointer;
      color: #aaa; font-size: 0.75rem;
      padding: 3px 5px; border-radius: 4px;
      display: flex; align-items: center;
    }
    .lp-collapse-btn:hover { background: #f0f0f0; color: #555; }
    .lp-tabs {
      display: flex;
      border-bottom: 1px solid #f0f0f0;
      flex-shrink: 0;
    }
    .lp-tab {
      flex: 1; text-align: center;
      padding: 8px 0; font-size: 0.82rem;
      cursor: pointer; color: #888;
      border-bottom: 2px solid transparent;
      background: none; border-top: none;
      border-left: none; border-right: none;
      font-weight: 500;
    }
    .lp-tab.active { color: #111; border-bottom-color: #111; }
    .lp-tab:hover:not(.active) { color: #555; }
    .lp-menu { overflow-y: auto; padding: 4px 0; }
    .lp-item {
      display: flex; align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      font-size: 0.83rem; color: #333;
      cursor: pointer; user-select: none; white-space: nowrap;
    }
    .lp-item:hover { background: #f7f7f7; }
    .lp-item-left { display: flex; align-items: center; gap: 10px; }
    .lp-item-icon { color: #666; flex-shrink: 0; }
    .lp-chevron { color: #bbb; }
    .lp-item.active { background: #f0f0f0; }

    /* Flyout submenu */
    .lp-item-wrap { position: relative; }
    .lp-submenu {
      display: none;
      position: absolute;
      top: 0;
      left: calc(100% + 6px);
      background: #fff;
      border-radius: 10px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.16), 0 1px 4px rgba(0,0,0,0.08);
      min-width: 220px;
      z-index: 100;
      overflow: hidden;
      padding: 4px 0;
    }
    .lp-item-wrap.open .lp-submenu { display: block; }
    .lp-subitem {
      display: flex; align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      font-size: 0.83rem; color: #333;
      cursor: pointer; white-space: nowrap;
      gap: 10px;
    }
    .lp-subitem:hover { background: #f7f7f7; }
    .lp-subitem-left { display: flex; align-items: center; gap: 10px; }
    .lp-subitem-key {
      font-size: 0.75rem; color: #aaa;
      font-family: monospace; font-weight: 600;
    }

    /* collapse toggle — small floating button when panel is hidden */
    .lp-toggle-float {
      position: absolute;
      top: 14px; left: 14px;
      z-index: 19;
      width: 32px; height: 32px;
      background: #fff;
      border: 1px solid #ddd;
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.12);
      cursor: pointer;
      display: none;
      align-items: center; justify-content: center;
      color: #555; font-size: 12px;
    }
    .lp-toggle-float.visible { display: flex; }
    .lp-toggle-float:hover { background: #f0f0f0; }

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
      width: 340px;
      background: #fff;
      border-radius: 10px 0 0 10px;
      box-shadow: -4px 0 16px rgba(0,0,0,0.10);
      display: flex;
      flex-direction: column;
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 30;
      color: #111;
      overflow: hidden;
      transition: opacity 0.2s, transform 0.2s;
    }
    .right-panel.hidden {
      opacity: 0;
      pointer-events: none;
      transform: translateX(12px);
    }

    /* ── PRODUCTION BOTTOM DRAWER ── */
    .prod-drawer {
      position: absolute;
      left: 0; right: 0; bottom: 0;
      height: 440px;
      background: #fff;
      border-radius: 14px 14px 0 0;
      box-shadow: 0 -4px 24px rgba(0,0,0,0.13);
      display: flex;
      flex-direction: column;
      z-index: 40;
      transform: translateY(100%);
      transition: transform 0.25s ease;
      overflow: hidden;
    }
    .prod-drawer.open { transform: translateY(0); }
    .prod-drawer-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 14px 18px 0;
      flex-shrink: 0;
    }
    .prod-drawer-tabs {
      display: flex; gap: 0; padding: 0 18px;
      border-bottom: 1px solid #eee; flex-shrink: 0;
    }
    .prod-drawer-tab {
      display: flex; align-items: center; gap: 6px;
      padding: 11px 0; margin-right: 22px;
      font-size: 0.85rem; font-weight: 600; color: #aaa;
      border-bottom: 2px solid transparent;
      background: none; border-top: none; border-left: none; border-right: none;
      cursor: pointer;
    }
    .prod-drawer-tab.active { color: #111; border-bottom-color: #111; }
    .prod-drawer-tab:hover:not(.active) { color: #555; }
    .prod-drawer-close {
      background: none; border: none; cursor: pointer;
      color: #aaa; padding: 4px; border-radius: 4px;
      display: flex; align-items: center;
    }
    .prod-drawer-close:hover { color: #555; background: #f0f0f0; }
    .prod-drawer-body { flex: 1; overflow-y: auto; padding: 16px 18px; }
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
    .rp-body { flex: 1; padding: 0; overflow-y: auto; overflow-x: hidden; }
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

    /* ── Right panel tabs ── */
    .rp-tabs {
      display: flex;
      border-bottom: 1px solid #eee;
      flex-shrink: 0;
      padding: 0 16px;
    }
    .rp-tab {
      padding: 11px 0;
      margin-right: 20px;
      font-size: 0.85rem;
      font-weight: 500;
      color: #888;
      border-bottom: 2px solid transparent;
      cursor: pointer;
      background: none;
      border-top: none; border-left: none; border-right: none;
      transition: color 0.15s;
    }
    .rp-tab.active { color: #111; border-bottom-color: #111; }
    .rp-tab:hover:not(.active) { color: #555; }

    /* ── Settings sections ── */
    .rp-section { padding: 14px 12px 14px; border-bottom: 1px solid #f0f0f0; }
    .rp-section:last-child { border-bottom: none; }
    .rp-section-title { font-size: 0.82rem; font-weight: 700; color: #111; margin-bottom: 14px; }
    .rp-row {
      display: flex; align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .rp-row-label { font-size: 0.82rem; color: #333; }
    .rp-row-label-sub { font-size: 0.72rem; color: #999; margin-top: 1px; }
    .rp-select {
      flex: 1; margin-left: 8px;
      min-width: 0;
      padding: 6px 22px 6px 8px;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      font-size: 0.8rem; color: #111;
      background: #fff;
      appearance: none;
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
      background-repeat: no-repeat;
      background-position: right 6px center;
      cursor: pointer;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .rp-reset-link { font-size: 0.78rem; color: #4a90e2; cursor: pointer; margin-bottom: 12px; display: block; text-align: right; }
    .rp-reset-link:hover { text-decoration: underline; }
    .rp-input-row { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
    .rp-input-label { font-size: 0.78rem; color: #555; margin-bottom: 4px; }
    .rp-input {
      flex: 1;
      min-width: 0;
      max-width: 72px;
      padding: 6px 8px;
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      font-size: 0.83rem; color: #111;
      background: #f9f9f9;
      outline: none;
    }
    .rp-input:focus { border-color: #aaa; background: #fff; }
    .rp-unit { font-size: 0.78rem; color: #888; }
    .rp-two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
    .rp-two-col-item { display: flex; flex-direction: column; gap: 4px; }
    .rp-two-col-item .rp-input-label { font-size: 0.76rem; color: #666; }
    .rp-input-unit-wrap { display: flex; align-items: center; gap: 4px; }
    .rp-input-unit-wrap .rp-input { flex: 1; }
    .rp-toggle-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 4px; }
    .rp-toggle-label { font-size: 0.82rem; color: #333; flex: 1; line-height: 1.4; }
    .rp-toggle {
      position: relative; width: 38px; height: 22px;
      flex-shrink: 0; cursor: pointer;
    }
    .rp-toggle input { opacity: 0; width: 0; height: 0; }
    .rp-toggle-slider {
      position: absolute; inset: 0;
      background: #ccc; border-radius: 22px;
      transition: background 0.2s;
    }
    .rp-toggle-slider::before {
      content: ''; position: absolute;
      width: 16px; height: 16px;
      left: 3px; top: 3px;
      background: #fff; border-radius: 50%;
      transition: transform 0.2s;
    }
    .rp-toggle input:checked + .rp-toggle-slider { background: #111; }
    .rp-toggle input:checked + .rp-toggle-slider::before { transform: translateX(16px); }
    .rp-info-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 13px; height: 13px; border-radius: 50%;
      border: 1px solid #bbb; font-size: 0.6rem; color: #999;
      cursor: default; vertical-align: middle; margin-left: 2px;
      font-style: normal;
    }

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
      height: 30px;
      min-width: 30px;
      border: none; background: none;
      cursor: pointer; border-radius: 5px;
      display: flex; align-items: center; justify-content: center;
      color: #555; padding: 0 6px; gap: 3px;
      font-size: 0.72rem; font-weight: 600; white-space: nowrap;
      position: relative;
    }
    .tb2-btn:hover { background: #f0f0f0; color: #111; }
    .tb2-btn:disabled { color: #ccc; cursor: default; pointer-events: none; }
    .tb2-btn .tb2-chevron { opacity: 0.5; }
    .tb2-btn:hover .tb2-chevron { opacity: 0.8; }
    .tb2-btn .tb2-shortcut { color: #9ca3af; font-size: 0.65rem; font-weight: 700; letter-spacing: 0.02em; }
    .tb2-divider { width: 1px; background: #e5e7eb; height: 20px; margin: 0 4px; }

    /* ── Custom toolbar tooltips ── */
    .tb2-tip {
      position: absolute;
      top: calc(100% + 7px);
      left: 50%;
      transform: translateX(-50%);
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 7px;
      box-shadow: 0 4px 14px rgba(0,0,0,0.12);
      padding: 5px 10px;
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.12s;
      z-index: 300;
      font-size: 0.78rem;
      font-weight: 500;
      color: #111;
    }
    .tb2-btn:hover .tb2-tip { opacity: 1; }
    .tb2-tip-key {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: #f3f4f6;
      border: 1px solid #d1d5db;
      border-radius: 4px;
      font-size: 0.68rem;
      font-weight: 700;
      color: #6b7280;
      width: 18px;
      height: 18px;
    }

    /* ── SIM BADGE ── */
    .sim-updated {
      display: flex; align-items: center; gap: 5px;
      font-size: 0.78rem; color: #27ae60; font-weight: 500;
      padding: 0 12px;
      border-right: 1px solid #e5e7eb; height: 100%;
      white-space: nowrap;
    }

    /* ── Top-right icon cluster ── */
    .tb-right-divider { width: 1px; background: #e5e7eb; height: 20px; margin: 0 4px; flex-shrink: 0; }
    .tb-icon-wrap { position: relative; display: flex; align-items: center; }
    .tb-badge {
      position: absolute; top: 2px; right: 2px;
      min-width: 16px; height: 16px; border-radius: 8px;
      background: #f59e0b; color: #fff;
      font-size: 0.6rem; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
      padding: 0 3px; pointer-events: none;
      border: 1.5px solid #fff;
    }
    .tb-avatar-btn {
      display: inline-flex; align-items: center; gap: 4px;
      background: none; border: none; cursor: pointer;
      padding: 4px 6px; border-radius: 6px; color: #555;
    }
    .tb-avatar-btn:hover { background: #f0f0f0; }
    .tb-avatar {
      width: 26px; height: 26px; border-radius: 50%;
      background: #7c3aed; color: #fff;
      font-size: 0.65rem; font-weight: 700;
      display: flex; align-items: center; justify-content: center;
    }
    .tb-dropdown {
      position: absolute; top: calc(100% + 6px); right: 0;
      background: #fff; border-radius: 8px; min-width: 190px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.08);
      z-index: 200; padding: 4px 0;
      display: none;
    }
    .tb-icon-wrap.open .tb-dropdown { display: block; }
    .tb-dropdown-item {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; font-size: 0.84rem; color: #111;
      cursor: pointer; gap: 12px;
    }
    .tb-dropdown-item:hover { background: #f9fafb; }

    /* ── Notifications dropdown ── */
    .notif-dropdown {
      position: absolute; top: calc(100% + 6px); right: 0;
      background: #fff; border-radius: 10px; width: 300px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.08);
      z-index: 200; display: none; overflow: hidden;
    }
    .tb-icon-wrap.open .notif-dropdown { display: block; }
    .notif-header {
      display: flex; align-items: center; justify-content: space-between;
      padding: 13px 16px 11px; border-bottom: 1px solid #f0f0f0;
    }
    .notif-title { font-size: 0.88rem; font-weight: 600; color: #111; }
    .notif-mark-seen { font-size: 0.78rem; color: #9ca3af; cursor: pointer; background: none; border: none; padding: 0; }
    .notif-mark-seen:hover { color: #555; }
    .notif-body {
      padding: 32px 16px; text-align: center;
      font-size: 0.82rem; color: #9ca3af;
      display: flex; align-items: center; justify-content: center;
    }
    .notif-footer {
      display: flex; align-items: center; justify-content: space-between;
      padding: 11px 16px; border-top: 1px solid #f0f0f0;
      font-size: 0.83rem; color: #111; font-weight: 500;
    }
    .notif-footer-add {
      width: 22px; height: 22px; border-radius: 5px; border: 1.5px solid #e0e0e0;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; color: #555; background: none;
    }
    .notif-footer-add:hover { background: #f5f5f5; }

    /* ── Profile dropdown ── */
    .profile-dropdown {
      position: absolute; top: calc(100% + 6px); right: 0;
      background: #fff; border-radius: 8px; min-width: 160px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.14), 0 1px 4px rgba(0,0,0,0.08);
      z-index: 200; padding: 4px 0; display: none;
    }
    .tb-icon-wrap.open .profile-dropdown { display: block; }
    .profile-dropdown-item {
      display: block; padding: 10px 16px; font-size: 0.84rem; color: #111;
      cursor: pointer; text-decoration: none;
    }
    .profile-dropdown-item:hover { background: #f9fafb; }

    /* ── Save changes modal ── */
    .save-modal-backdrop {
      position: fixed; inset: 0; z-index: 1000;
      background: rgba(0,0,0,0.32);
      display: flex; align-items: center; justify-content: center;
      animation: backdropIn 0.15s ease;
    }
    @keyframes backdropIn { from { opacity:0 } to { opacity:1 } }
    .save-modal {
      background: #fff; border-radius: 14px;
      padding: 32px 28px 24px; width: 380px; max-width: calc(100vw - 40px);
      box-shadow: 0 20px 60px rgba(0,0,0,0.22), 0 4px 16px rgba(0,0,0,0.10);
      animation: modalIn 0.18s cubic-bezier(0.34,1.56,0.64,1);
      display: flex; flex-direction: column; align-items: center; text-align: center;
    }
    @keyframes modalIn { from { opacity:0; transform:scale(0.92) translateY(8px) } to { opacity:1; transform:scale(1) translateY(0) } }
    .save-modal-icon {
      width: 48px; height: 48px; border-radius: 12px;
      background: #f3f4f6; display: flex; align-items: center; justify-content: center;
      color: #374151; margin-bottom: 16px;
    }
    .save-modal-title { font-size: 1rem; font-weight: 700; color: #111; margin-bottom: 8px; }
    .save-modal-sub { font-size: 0.85rem; color: #6b7280; line-height: 1.5; margin-bottom: 24px; }
    .save-modal-actions { display: flex; gap: 8px; width: 100%; }
    .save-modal-btn {
      flex: 1; padding: 10px 0; border-radius: 8px; font-size: 0.86rem;
      font-weight: 600; cursor: pointer; border: none; transition: background 0.12s;
    }
    .save-modal-discard { background: #f3f4f6; color: #6b7280; }
    .save-modal-discard:hover { background: #e5e7eb; color: #374151; }
    .save-modal-cancel { background: #f3f4f6; color: #374151; }
    .save-modal-cancel:hover { background: #e5e7eb; }
    .save-modal-save { background: #111; color: #fff; flex: 1.5; }
    .save-modal-save:hover { background: #333; }
  </style>
</head>
<body>

  <!-- TOP BAR -->
  <div class="topbar">
    <div class="topbar-left">
      <a class="tb-back" href="#" onclick="handleBack(event)">
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
      <div class="tb-right-divider"></div>

      <!-- Monitor / Sales Mode dropdown -->
      <div class="tb-icon-wrap" id="salesModeWrap">
        <button class="tb-icon-btn" title="Sales Mode" onclick="toggleSalesDropdown(event)">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        </button>
        <div class="tb-dropdown" id="salesDropdown">
          <div class="tb-dropdown-item">
            <span>Go to Sales Mode</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
          </div>
        </div>
      </div>

      <!-- Help with badge -->
      <div class="tb-icon-wrap">
        <button class="tb-icon-btn" title="Help">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17" stroke-width="3" stroke-linecap="round"/></svg>
          <span class="tb-badge">4</span>
        </button>
      </div>

      <!-- Bell -->
      <div class="tb-icon-wrap" id="notifWrap">
        <button class="tb-icon-btn" title="Notifications" onclick="toggleDropdown('notifWrap', event)">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
        </button>
        <div class="notif-dropdown">
          <div class="notif-header">
            <span class="notif-title">Notifications</span>
            <button class="notif-mark-seen">Mark all as seen</button>
          </div>
          <div class="notif-body">There are no more notifications from the last 30 days.</div>
          <div class="notif-footer">
            <span>Assign new milestone</span>
            <button class="notif-footer-add">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
          </div>
        </div>
      </div>

      <!-- User avatar + chevron -->
      <div class="tb-icon-wrap" id="profileWrap">
        <button class="tb-avatar-btn" title="Account" onclick="toggleDropdown('profileWrap', event)">
          <span class="tb-avatar">AB</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="profile-dropdown">
          <a class="profile-dropdown-item" href="#">My profile</a>
          <a class="profile-dropdown-item" href="#">Logout</a>
        </div>
      </div>
    </div>
  </div>

  <!-- TOOLBAR 2 -->
  <div class="toolbar2">
    <button class="tb2-btn" id="undoBtn" disabled>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg>
      <span class="tb2-tip">Undo</span>
    </button>
    <button class="tb2-btn" id="redoBtn" disabled>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 11-2.13-9.36L23 10"/></svg>
      <span class="tb2-tip">Redo</span>
    </button>
    <div class="tb2-divider"></div>
    <!-- Downloads -->
    <button class="tb2-btn">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
      <svg class="tb2-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
      <span class="tb2-tip">Downloads</span>
    </button>
    <!-- View settings -->
    <button class="tb2-btn">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
      <svg class="tb2-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
      <span class="tb2-tip">View settings</span>
    </button>
    <div class="tb2-divider"></div>
    <!-- Sun path -->
    <button class="tb2-btn">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17c3-4 6-6 9-6s6 2 9 6"/></svg>
      <span class="tb2-tip">Sun path</span>
    </button>
    <!-- LIDAR -->
    <button class="tb2-btn">
      <svg width="16" height="16" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">
        <line x1="28" y1="4" x2="28" y2="17"/>
        <line x1="38" y1="2" x2="38" y2="13"/>
        <rect x="44" y="2" width="12" height="11" rx="2"/>
        <line x1="62" y1="2" x2="62" y2="13"/>
        <line x1="72" y1="4" x2="72" y2="17"/>
        <rect x="22" y="22" width="56" height="34" rx="10"/>
        <line x1="35" y1="29" x2="43" y2="43"/>
        <line x1="47" y1="29" x2="55" y2="43"/>
        <path d="M22 38 Q10 44 10 54"/>
        <path d="M78 38 Q90 44 90 54"/>
        <path d="M10 54 Q10 66 22 66 L78 66 Q90 66 90 54"/>
        <line x1="33" y1="66" x2="33" y2="76"/>
        <line x1="50" y1="66" x2="50" y2="76"/>
        <line x1="67" y1="66" x2="67" y2="76"/>
        <line x1="16" y1="79" x2="84" y2="79"/>
      </svg>
      <span class="tb2-shortcut">L</span>
      <span class="tb2-tip">LIDAR <span class="tb2-tip-key">L</span></span>
    </button>
    <!-- Irradiance -->
    <button class="tb2-btn">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
      <span class="tb2-shortcut">I</span>
      <span class="tb2-tip">Irradiance <span class="tb2-tip-key">I</span></span>
    </button>
    <div class="tb2-divider"></div>
    <!-- Design Mode extensions -->
    <button class="tb2-btn">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
      <svg class="tb2-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
      <span class="tb2-tip">No Design Mode extensions</span>
    </button>
    <!-- Electrical configuration -->
    <button class="tb2-btn">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3v7a6 6 0 006 6 6 6 0 006-6V3"/><line x1="4" y1="3" x2="20" y2="3"/></svg>
      <span class="tb2-tip">Electrical configuration</span>
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
        <div class="lp-item-wrap" id="wrapFire">
          <div class="lp-item" id="menuFire">
            <div class="lp-item-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22V12M12 12L7 7M12 12l5-5M7 7V3h10v4"/><path d="M3 22h18"/></svg>
              Fire pathways
            </div>
            <svg class="lp-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
          </div>
          <div class="lp-submenu" id="fireSubmenu">
            <div class="lp-subitem">
              <div class="lp-subitem-left">
                <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="6" r="2"/><path d="M12 8v5"/><path d="M9 11l3 3 3-3"/><path d="M6 21v-2a3 3 0 013-3h6a3 3 0 013 3v2"/></svg>
                Auto place fire pathways
              </div>
            </div>
            <div class="lp-subitem">
              <div class="lp-subitem-left">
                <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="6" r="2"/><path d="M12 8v5"/><path d="M9 11l3-3 3 3"/><path d="M6 21v-2a3 3 0 013-3h6a3 3 0 013 3v2"/></svg>
                Draw fire pathways
              </div>
            </div>
          </div>
        </div>
        <div class="lp-item-wrap">
          <div class="lp-item">
            <div class="lp-item-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
              AutoDesigner
            </div>
          </div>
        </div>
        <div class="lp-item-wrap" id="menuPanelsWrap">
          <div class="lp-item" id="menuPanels">
            <div class="lp-item-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              Panels
            </div>
            <svg class="lp-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
          </div>
          <div class="lp-submenu" id="panelsSubmenu">
            <div class="lp-subitem">
              <div class="lp-subitem-left">
                <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                Modules
              </div>
              <span class="lp-subitem-key">M</span>
            </div>
            <div class="lp-subitem">
              <div class="lp-subitem-left">
                <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
                Ground mounts
              </div>
              <span class="lp-subitem-key">P</span>
            </div>
          </div>
        </div>
        <div class="lp-item-wrap" id="wrapComponents">
          <div class="lp-item" id="menuComponents">
            <div class="lp-item-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>
              Components
            </div>
            <svg class="lp-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
          </div>
          <div class="lp-submenu" id="componentsSubmenu">
            <div class="lp-subitem">
              <div class="lp-subitem-left">
                <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="10" rx="1"/><path d="M6 7V5m12 2V5"/></svg>
                Inverter
              </div>
              <span class="lp-subitem-key">V</span>
            </div>
            <div class="lp-subitem">
              <div class="lp-subitem-left">
                <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="1"/><line x1="8" y1="5" x2="8" y2="19"/><line x1="16" y1="5" x2="16" y2="19"/></svg>
                Combiner
              </div>
              <span class="lp-subitem-key">B</span>
            </div>
            <div class="lp-subitem">
              <div class="lp-subitem-left">
                <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
                Load center
              </div>
            </div>
            <div class="lp-subitem">
              <div class="lp-subitem-left">
                <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/></svg>
                Main service panel
              </div>
            </div>
            <div class="lp-subitem">
              <div class="lp-subitem-left">
                <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="3" x2="12" y2="7"/></svg>
                Meter
              </div>
            </div>
            <div class="lp-subitem">
              <div class="lp-subitem-left">
                <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M8 6V4m8 2V4"/></svg>
                Disconnect
              </div>
            </div>
            <div class="lp-subitem">
              <div class="lp-subitem-left">
                <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="8" width="20" height="8" rx="1"/><line x1="6" y1="8" x2="6" y2="16"/><line x1="10" y1="8" x2="10" y2="16"/><line x1="14" y1="8" x2="14" y2="16"/><line x1="18" y1="8" x2="18" y2="16"/></svg>
                Racking
              </div>
            </div>
            <div class="lp-subitem">
              <div class="lp-subitem-left">
                <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 010 14.14M4.93 4.93a10 10 0 000 14.14"/></svg>
                Configure existing equipment
              </div>
            </div>
          </div>
        </div>
        <div class="lp-item-wrap" id="menuStringWrap">
          <div class="lp-item" id="menuString">
            <div class="lp-item-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/></svg>
              String / connect
            </div>
            <svg class="lp-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
          </div>
          <div class="lp-submenu" id="stringSubmenu">
            <div class="lp-subitem">
              <div class="lp-subitem-left">
                <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/></svg>
                AutoStringer
              </div>
            </div>
            <div class="lp-subitem">
              <div class="lp-subitem-left">
                <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 3H5a2 2 0 00-2 2v4m6-6h10a2 2 0 012 2v4M9 3v18m0 0h10a2 2 0 002-2V9M9 21H5a2 2 0 01-2-2V9m0 0h18"/></svg>
                Manual string
              </div>
              <span class="lp-subitem-key">C</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- MAP -->
    <div class="map-wrap" style="position:relative;">
      <div id="map"></div>

      <!-- Floating re-open button (shown when panel is collapsed) -->
      <button class="lp-toggle-float" id="lpToggleFloat" title="Show panel">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 5l7 7-7 7"/><path d="M5 5l7 7-7 7"/></svg>
      </button>

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
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="rp-close" id="closeRightPanel" style="margin-right:4px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="rp-tabs">
        <button class="rp-tab active" id="rpTabSystem">System</button>
        <button class="rp-tab" id="rpTabSimulation">Simulation</button>
      </div>
      <div class="rp-body" id="rpBody">

        <!-- Setbacks -->
        <div class="rp-section">
          <div class="rp-section-title">Setbacks</div>

          <div class="rp-row">
            <div class="rp-row-label">Jurisdiction</div>
            <select class="rp-select">
              <option>My Jurisdiction</option>
              <option>Custom</option>
            </select>
          </div>
          <a class="rp-reset-link">Reset to jurisdiction setbacks</a>

          <div class="rp-row" style="margin-bottom:6px;">
            <div class="rp-row-label">Default setback</div>
            <div class="rp-input-unit-wrap" style="flex:1;margin-left:12px;">
              <input class="rp-input" type="number" value="0.5" step="0.1"/>
              <span class="rp-unit">ft</span>
            </div>
          </div>

          <div class="rp-two-col">
            <div class="rp-two-col-item">
              <div class="rp-input-label">Eaves</div>
              <div class="rp-input-unit-wrap"><input class="rp-input" type="number" value="0"/><span class="rp-unit">ft</span></div>
            </div>
            <div class="rp-two-col-item">
              <div class="rp-input-label">Hips</div>
              <div class="rp-input-unit-wrap"><input class="rp-input" type="number" value="0"/><span class="rp-unit">ft</span></div>
            </div>
          </div>
          <div class="rp-two-col">
            <div class="rp-two-col-item">
              <div class="rp-input-label">Rakes</div>
              <div class="rp-input-unit-wrap"><input class="rp-input" type="number" value="0"/><span class="rp-unit">ft</span></div>
            </div>
            <div class="rp-two-col-item">
              <div class="rp-input-label">Ridges</div>
              <div class="rp-input-unit-wrap"><input class="rp-input" type="number" value="0"/><span class="rp-unit">ft</span></div>
            </div>
          </div>
          <div class="rp-two-col">
            <div class="rp-two-col-item">
              <div class="rp-input-label">Valleys</div>
              <div class="rp-input-unit-wrap"><input class="rp-input" type="number" value="0"/><span class="rp-unit">ft</span></div>
            </div>
            <div class="rp-two-col-item">
              <div class="rp-input-label">Obstructions</div>
              <div class="rp-input-unit-wrap"><input class="rp-input" type="number" value="0"/><span class="rp-unit">ft</span></div>
            </div>
          </div>

          <div class="rp-toggle-row">
            <span class="rp-toggle-label">Apply on dormers</span>
            <label class="rp-toggle">
              <input type="checkbox" checked/>
              <span class="rp-toggle-slider"></span>
            </label>
          </div>
        </div>

        <!-- Ground mount spacing -->
        <div class="rp-section">
          <div class="rp-section-title">Ground mount spacing</div>
          <div class="rp-row" style="margin-bottom:10px;">
            <div class="rp-row-label">Row spacing</div>
            <div class="rp-input-unit-wrap" style="flex:1;margin-left:12px;">
              <input class="rp-input" type="number" placeholder=""/>
              <span class="rp-unit">in</span>
            </div>
          </div>
          <div class="rp-row" style="align-items:flex-start;">
            <div class="rp-row-label">Module spacing</div>
            <div style="flex:1;margin-left:12px;">
              <div class="rp-two-col" style="margin-bottom:0;">
                <div class="rp-two-col-item">
                  <div class="rp-input-label">Row</div>
                  <div class="rp-input-unit-wrap"><input class="rp-input" type="number" placeholder=""/><span class="rp-unit">in</span></div>
                </div>
                <div class="rp-two-col-item">
                  <div class="rp-input-label">Column</div>
                  <div class="rp-input-unit-wrap"><input class="rp-input" type="number" placeholder=""/><span class="rp-unit">in</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Temperature -->
        <div class="rp-section">
          <div class="rp-section-title">Temperature</div>
          <div class="rp-row" style="align-items:flex-start;">
            <div>
              <div class="rp-row-label">Temperature</div>
              <div class="rp-row-label-sub">Data from ASHRAE</div>
            </div>
            <div style="flex:1;margin-left:12px;">
              <div class="rp-two-col" style="margin-bottom:0;">
                <div class="rp-two-col-item">
                  <div class="rp-input-label">Min</div>
                  <div class="rp-input-unit-wrap"><input class="rp-input" type="number" value="-16.1"/><span class="rp-unit">°F</span></div>
                </div>
                <div class="rp-two-col-item">
                  <div class="rp-input-label">Max</div>
                  <div class="rp-input-unit-wrap"><input class="rp-input" type="number" value="87.1"/><span class="rp-unit">°F</span></div>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>

      <!-- Simulation tab body (hidden by default) -->
      <div class="rp-body" id="rpBodySim" style="display:none;">

        <div class="rp-section">
          <div class="rp-section-title">Simulation</div>
          <div class="rp-row" style="margin-bottom:10px;">
            <div class="rp-row-label">Simulation engine</div>
            <select class="rp-select"><option>Auto</option><option>Aurora</option><option>PVWatts</option></select>
          </div>
          <div class="rp-toggle-row" style="margin-bottom:10px;">
            <span class="rp-toggle-label">Shading engine</span>
            <label class="rp-toggle"><input type="checkbox" checked/><span class="rp-toggle-slider"></span></label>
          </div>
          <div class="rp-toggle-row" style="margin-bottom:10px;">
            <span class="rp-toggle-label">Use horizon shading</span>
            <label class="rp-toggle"><input type="checkbox" checked/><span class="rp-toggle-slider"></span></label>
          </div>
          <div class="rp-toggle-row" style="margin-bottom:10px;">
            <span class="rp-toggle-label">Use LIDAR shading <span class="rp-info-icon">i</span></span>
            <label class="rp-toggle"><input type="checkbox" checked/><span class="rp-toggle-slider"></span></label>
          </div>
          <div class="rp-toggle-row">
            <span class="rp-toggle-label">Use module's light-induced degradation and annual degradation data, if available <span class="rp-info-icon">i</span></span>
            <label class="rp-toggle"><input type="checkbox" checked/><span class="rp-toggle-slider"></span></label>
          </div>
        </div>

        <div class="rp-section">
          <div class="rp-section-title">Aurora</div>
          <div class="rp-row" style="margin-bottom:10px;">
            <div class="rp-row-label">Weather dataset</div>
            <select class="rp-select"><option>NREL-PSM</option><option>NSRDB</option></select>
          </div>
          <div class="rp-row" style="margin-bottom:10px;">
            <div class="rp-row-label">Weather station</div>
            <select class="rp-select"><option>44.81, -68.78</option></select>
          </div>
          <div class="rp-row" style="margin-bottom:10px;">
            <div class="rp-row-label">Irradiance model</div>
            <select class="rp-select"><option>Perez</option><option>Hay-Davies</option></select>
          </div>
          <div class="rp-toggle-row" style="margin-bottom:10px;">
            <span class="rp-toggle-label">Inverter clipping</span>
            <label class="rp-toggle"><input type="checkbox" checked/><span class="rp-toggle-slider"></span></label>
          </div>
          <div class="rp-toggle-row">
            <span class="rp-toggle-label">Submodule simulation</span>
            <label class="rp-toggle"><input type="checkbox" checked/><span class="rp-toggle-slider"></span></label>
          </div>
        </div>

        <div class="rp-section">
          <div class="rp-section-title">PVWatts</div>
          <div class="rp-row" style="margin-bottom:10px;">
            <div class="rp-row-label">Weather dataset</div>
            <select class="rp-select"><option>NSRDB - PSM3</option><option>NREL-PSM</option></select>
          </div>
          <div class="rp-row" style="margin-bottom:10px;">
            <div class="rp-row-label">Inverter efficiency</div>
            <div class="rp-input-unit-wrap" style="flex:1;margin-left:12px;">
              <input class="rp-input" type="number" value="97"/>
              <span class="rp-unit">%</span>
            </div>
          </div>
          <div class="rp-row">
            <div class="rp-row-label">DC-to-AC ratio</div>
            <div class="rp-input-unit-wrap" style="flex:1;margin-left:12px;">
              <input class="rp-input" type="number" value="1.5" step="0.1"/>
            </div>
          </div>
        </div>

        <div class="rp-section">
          <div class="rp-section-title">System losses (annual)</div>
          <div class="rp-row" style="margin-bottom:10px;">
            <div class="rp-row-label">Module nameplate rating</div>
            <div class="rp-input-unit-wrap" style="flex:1;margin-left:12px;"><input class="rp-input" type="number" value="1"/><span class="rp-unit">%</span></div>
          </div>
          <div class="rp-row" style="margin-bottom:10px;">
            <div class="rp-row-label">Mismatch <span class="rp-info-icon">i</span></div>
            <div class="rp-input-unit-wrap" style="flex:1;margin-left:12px;"><input class="rp-input" type="number" value="1.5"/><span class="rp-unit">%</span></div>
          </div>
          <div class="rp-row" style="margin-bottom:10px;">
            <div class="rp-row-label">Connections</div>
            <div class="rp-input-unit-wrap" style="flex:1;margin-left:12px;"><input class="rp-input" type="number" value="0.5"/><span class="rp-unit">%</span></div>
          </div>
          <div class="rp-row" style="margin-bottom:10px;">
            <div class="rp-row-label">Light-induced degradation <span class="rp-info-icon">i</span></div>
            <div class="rp-input-unit-wrap" style="flex:1;margin-left:12px;"><input class="rp-input" type="number" value="1.5"/><span class="rp-unit">%</span></div>
          </div>
          <div class="rp-row" style="margin-bottom:10px;">
            <div class="rp-row-label">Wiring</div>
            <div class="rp-input-unit-wrap" style="flex:1;margin-left:12px;"><input class="rp-input" type="number" value="2"/><span class="rp-unit">%</span></div>
          </div>
          <div class="rp-row" style="margin-bottom:10px;">
            <div class="rp-row-label">Soiling</div>
            <div class="rp-input-unit-wrap" style="flex:1;margin-left:12px;">
              <input class="rp-input" type="number" value="2" style="max-width:60px;"/>
              <span class="rp-unit">%</span>
              <select class="rp-select" style="margin-left:6px;flex:0 0 auto;width:90px;"><option>Annual</option><option>Monthly</option></select>
            </div>
          </div>
          <div class="rp-row" style="margin-bottom:10px;">
            <div class="rp-row-label">Availability</div>
            <div class="rp-input-unit-wrap" style="flex:1;margin-left:12px;"><input class="rp-input" type="number" value="2"/><span class="rp-unit">%</span></div>
          </div>
          <div class="rp-row-label" style="margin-bottom:10px;">Shading <span style="color:#f59e0b;">&#9651;</span></div>
          <div class="rp-row" style="margin-bottom:10px;">
            <div class="rp-row-label">Age</div>
            <div class="rp-input-unit-wrap" style="flex:1;margin-left:12px;"><input class="rp-input" type="number" value="0"/><span class="rp-unit">%</span></div>
          </div>
          <div class="rp-row" style="margin-bottom:10px;">
            <div class="rp-row-label">Snow</div>
            <div class="rp-input-unit-wrap" style="flex:1;margin-left:12px;">
              <input class="rp-input" type="number" value="7" style="max-width:60px;"/>
              <span class="rp-unit">%</span>
              <select class="rp-select" style="margin-left:6px;flex:0 0 auto;width:90px;"><option>Annual</option><option>Monthly</option></select>
            </div>
          </div>
          <div class="rp-row" style="margin-bottom:14px;">
            <div class="rp-row-label">Other</div>
            <div class="rp-input-unit-wrap" style="flex:1;margin-left:12px;"><input class="rp-input" type="number" value="0.5"/><span class="rp-unit">%</span></div>
          </div>
          <div class="rp-row" style="border-top:1px solid #eee;padding-top:12px;">
            <div class="rp-row-label" style="font-weight:600;">Estimated total loss</div>
            <span style="font-size:0.88rem;font-weight:600;color:#111;">16.8%</span>
          </div>
        </div>

      </div>

    </div>

  </div><!-- /workspace -->

  <!-- PRODUCTION BOTTOM DRAWER -->
  <div class="prod-drawer" id="prodDrawer">
    <div class="prod-drawer-header">
      <div></div>
      <button class="prod-drawer-close" id="closeProdDrawer">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
    <div class="prod-drawer-tabs">
      <button class="prod-drawer-tab active" id="drawerTabProduction">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        Production
      </button>
      <button class="prod-drawer-tab" id="drawerTabBill">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
        Bill savings
      </button>
    </div>
    <div class="prod-drawer-body">
      <div class="prod-section-title">Production</div>
      <div class="prod-stats-row">
        <div class="prod-stat-item">
          <div class="prod-stat-label">Panels</div>
          <div class="prod-stat-val" id="prodPanels">25</div>
        </div>
        <div class="prod-stat-item">
          <div class="prod-stat-label">Annual energy</div>
          <div class="prod-stat-val">9,371<span>kWh</span></div>
        </div>
        <div class="prod-stat-item">
          <div class="prod-stat-label">Energy offset</div>
          <div class="prod-stat-val">—<span>%</span></div>
        </div>
      </div>
      <div class="prod-chart-header">
        <div class="prod-chart-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          Monthly production (kWh)
        </div>
        <button class="prod-chart-copy" title="Copy">&#10697;</button>
      </div>
      <div class="prod-chart-wrap">
        <canvas id="prodChart"></canvas>
      </div>
      <div class="prod-legend">
        <div class="prod-legend-item"><div class="prod-legend-dot" style="background:#e53e3e;"></div>Energy usage</div>
        <div class="prod-legend-item"><div class="prod-legend-dot" style="background:#f6ad55;"></div>New system production</div>
      </div>
      <div class="prod-lidar-badge">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 010 8.49M7.76 16.24a6 6 0 010-8.49M20.49 3.51a12 12 0 010 16.97M3.51 20.49a12 12 0 010-16.97"/></svg>
        LIDAR shading is enabled
        <span class="rp-info-icon">i</span>
      </div>
      <button class="prod-advanced">
        Advanced
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
      </button>
      <hr class="prod-divider"/>
      <div class="prod-energy-section">
        <div class="prod-energy-title">Energy usage</div>
        <div class="prod-no-data">
          <div class="prod-no-data-left">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            No energy usage data
          </div>
          <button class="prod-add-btn">Add energy usage</button>
        </div>
      </div>
    </div>
  </div>

  <script>
    var map, marker, drawingManager;
    var segments = [];
    var selectedSegment = null;
    var currentMode = 'select';

    /* ── Production bottom drawer ── */
    var prodDrawer = document.getElementById('prodDrawer');
    var prodExpand = document.querySelector('.tb-stats-expand');

    function openProdDrawer() {
      prodDrawer.classList.add('open');
      if (prodExpand) prodExpand.classList.add('open');
      drawProdChart();
    }
    function closeProdDrawer() {
      prodDrawer.classList.remove('open');
      if (prodExpand) prodExpand.classList.remove('open');
    }

    document.querySelector('.tb-stats').addEventListener('click', openProdDrawer);
    document.getElementById('closeProdDrawer').addEventListener('click', closeProdDrawer);

    document.getElementById('drawerTabProduction').addEventListener('click', function() {
      this.classList.add('active');
      document.getElementById('drawerTabBill').classList.remove('active');
    });
    document.getElementById('drawerTabBill').addEventListener('click', function() {
      this.classList.add('active');
      document.getElementById('drawerTabProduction').classList.remove('active');
    });


    var prodChartDrawn = false;
    function drawProdChart() {
      if (prodChartDrawn) return;
      prodChartDrawn = true;
      var canvas = document.getElementById('prodChart');
      var ctx = canvas.getContext('2d');
      var W = canvas.offsetWidth; var H = canvas.offsetHeight;
      canvas.width = W; canvas.height = H;

      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var production = [220,280,870,1010,1060,1200,1250,1220,880,490,220,120];
      var usage =      [180,210,600, 800, 900,1100,1150,1100,750,420,190,100];
      var maxVal = 1400;
      var padL = 60, padR = 10, padT = 10, padB = 36;
      var chartW = W - padL - padR;
      var chartH = H - padT - padB;
      var barGroup = chartW / months.length;
      var barW = barGroup * 0.35;

      // gridlines
      var gridLines = [0,200,400,600,800,1000,1200,1400];
      ctx.font = '9px sans-serif'; ctx.fillStyle = '#aaa'; ctx.textAlign = 'right';
      gridLines.forEach(function(v) {
        var y = padT + chartH - (v / maxVal) * chartH;
        ctx.strokeStyle = '#eee'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
        ctx.fillText(v + ' kWh', padL - 4, y + 3);
      });

      // bars
      months.forEach(function(m, i) {
        var x = padL + i * barGroup + barGroup * 0.1;
        // usage (red)
        var uH = (usage[i] / maxVal) * chartH;
        ctx.fillStyle = '#e53e3e';
        ctx.fillRect(x, padT + chartH - uH, barW, uH);
        // production (amber)
        var pH = (production[i] / maxVal) * chartH;
        ctx.fillStyle = '#f6ad55';
        ctx.fillRect(x + barW + 2, padT + chartH - pH, barW, pH);
        // month label
        ctx.fillStyle = '#888'; ctx.textAlign = 'center';
        ctx.fillText(m, x + barW, H - 6);
      });
    }

    /* ── Panel toggle logic ── */
    var leftPanel = document.getElementById('leftPanel');
    var rightPanel = document.getElementById('rightPanel');
    var leftCollapsed = false;
    var rightHidden = false;

    var toggleFloat = document.getElementById('lpToggleFloat');
    document.getElementById('collapseLeft').addEventListener('click', function() {
      leftCollapsed = true;
      leftPanel.classList.add('collapsed');
      toggleFloat.classList.add('visible');
    });
    toggleFloat.addEventListener('click', function() {
      leftCollapsed = false;
      leftPanel.classList.remove('collapsed');
      toggleFloat.classList.remove('visible');
    });
    document.getElementById('closeRightPanel').addEventListener('click', function() {
      rightHidden = true;
      rightPanel.classList.add('hidden');
    });
    document.getElementById('toggleRightPanel').addEventListener('click', function() {
      rightHidden = !rightHidden;
      rightPanel.classList.toggle('hidden', rightHidden);
    });

    /* ── Flyout submenus ── */
    function setupFlyout(itemId, wrapId) {
      var item = document.getElementById(itemId);
      var wrap = document.getElementById(wrapId);
      if (!item || !wrap) return;
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        var isOpen = wrap.classList.contains('open');
        // close all
        document.querySelectorAll('.lp-item-wrap.open').forEach(function(el) { el.classList.remove('open'); });
        document.querySelectorAll('.lp-item.active').forEach(function(el) { el.classList.remove('active'); });
        if (!isOpen) {
          wrap.classList.add('open');
          item.classList.add('active');
        }
      });
    }
    setupFlyout('menuPanels', 'menuPanelsWrap');
    setupFlyout('menuString', 'menuStringWrap');
    document.addEventListener('click', function() {
      document.querySelectorAll('.lp-item-wrap.open').forEach(function(el) { el.classList.remove('open'); });
      document.querySelectorAll('.lp-item.active').forEach(function(el) { el.classList.remove('active'); });
    });

    /* ── Left panel tab switching ── */
    document.getElementById('tabSite').addEventListener('click', function() {
      this.classList.add('active');
      document.getElementById('tabSystem').classList.remove('active');
    });
    document.getElementById('tabSystem').addEventListener('click', function() {
      this.classList.add('active');
      document.getElementById('tabSite').classList.remove('active');
    });

    /* ── Right panel tab switching ── */
    function switchRpTab(active) {
      ['rpTabSystem','rpTabSimulation'].forEach(function(id) {
        document.getElementById(id).classList.toggle('active', id === active);
      });
      document.getElementById('rpBody').style.display = active === 'rpTabSystem' ? '' : 'none';
      document.getElementById('rpBodySim').style.display = active === 'rpTabSimulation' ? '' : 'none';
    }
    document.getElementById('rpTabSystem').addEventListener('click', function() { switchRpTab('rpTabSystem'); });
    document.getElementById('rpTabSimulation').addEventListener('click', function() { switchRpTab('rpTabSimulation'); });

    /* ── Submenu flyout toggle ── */
    var submenus = [
      { wrap: 'wrapFire',       item: 'menuFire' },
      { wrap: 'menuPanelsWrap', item: 'menuPanels' },
      { wrap: 'wrapComponents', item: 'menuComponents' },
      { wrap: 'menuStringWrap', item: 'menuString' }
    ];
    submenus.forEach(function(s) {
      var wrap = document.getElementById(s.wrap);
      var item = document.getElementById(s.item);
      if (!wrap || !item) return;
      item.addEventListener('click', function(e) {
        var isOpen = wrap.classList.contains('open');
        // close all
        submenus.forEach(function(x) {
          var w = document.getElementById(x.wrap);
          var i = document.getElementById(x.item);
          if (w) w.classList.remove('open');
          if (i) i.classList.remove('active');
        });
        if (!isOpen) {
          wrap.classList.add('open');
          item.classList.add('active');
        }
      });
    });
    // close submenus when clicking outside
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.lp-item-wrap')) {
        submenus.forEach(function(s) {
          var w = document.getElementById(s.wrap);
          var i = document.getElementById(s.item);
          if (w) w.classList.remove('open');
          if (i) i.classList.remove('active');
        });
      }
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
        zoom: 21,
        maxZoom: 23,
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
        markDirty();
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

    /* ── Dropdowns ── */
    var allDropdownWraps = ['salesModeWrap', 'notifWrap', 'profileWrap'];
    function toggleDropdown(id, e) {
      e.stopPropagation();
      var isOpen = document.getElementById(id).classList.contains('open');
      allDropdownWraps.forEach(function(w) {
        var el = document.getElementById(w);
        if (el) el.classList.remove('open');
      });
      if (!isOpen) document.getElementById(id).classList.add('open');
    }
    function toggleSalesDropdown(e) { toggleDropdown('salesModeWrap', e); }
    document.addEventListener('click', function() {
      allDropdownWraps.forEach(function(w) {
        var el = document.getElementById(w);
        if (el) el.classList.remove('open');
      });
    });

    /* ── Save / dirty state ── */
    var isDirty = false;
    var pendingNav = null;

    function markDirty() { isDirty = true; }

    function handleBack(e) {
      e.preventDefault();
      if (!isDirty) { history.back(); return; }
      pendingNav = function() { history.back(); };
      showModal();
    }

    function showModal() {
      var m = document.getElementById('saveModal');
      m.style.display = 'flex';
    }
    function closeModal() {
      document.getElementById('saveModal').style.display = 'none';
      pendingNav = null;
    }
    function handleModalBackdrop(e) {
      if (e.target === document.getElementById('saveModal')) closeModal();
    }
    function discardAndLeave() {
      isDirty = false;
      document.getElementById('saveModal').style.display = 'none';
      if (pendingNav) pendingNav();
    }
    function saveAndLeave() {
      // Flash the save icon, mark clean, then navigate
      var btn = document.querySelector('.save-modal-save');
      btn.textContent = 'Saving…';
      btn.disabled = true;
      setTimeout(function() {
        isDirty = false;
        document.getElementById('saveModal').style.display = 'none';
        if (pendingNav) pendingNav();
      }, 600);
    }
  </script>
  <script src="https://maps.googleapis.com/maps/api/js?key=${API_KEY}&libraries=drawing,geometry&callback=initMap" async defer></script>

  <!-- Save changes modal -->
  <div id="saveModal" class="save-modal-backdrop" style="display:none;" onclick="handleModalBackdrop(event)">
    <div class="save-modal">
      <div class="save-modal-icon">
        <svg width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
      </div>
      <div class="save-modal-title">Save changes?</div>
      <div class="save-modal-sub">You have unsaved changes to Design 1. Would you like to save before leaving?</div>
      <div class="save-modal-actions">
        <button class="save-modal-btn save-modal-discard" onclick="discardAndLeave()">Discard</button>
        <button class="save-modal-btn save-modal-cancel" onclick="closeModal()">Cancel</button>
        <button class="save-modal-btn save-modal-save" onclick="saveAndLeave()">Save changes</button>
      </div>
    </div>
  </div>

</body>
</html>`);
});

// ── Settings page ──────────────────────────────────────────────────────────────
app.get("/settings", (req, res) => {
  const now = new Date();
  const longDate = now.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "short", day: "numeric" });
  const shortDate = now.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Settings — Solar CRM</title>
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
      width: 32px; height: 32px;
      background: linear-gradient(135deg,#c084fc,#818cf8);
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      margin-bottom: 10px; flex-shrink: 0;
    }
    .rail-btn {
      width: 36px; height: 36px;
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; color: #7c5fa0;
      transition: all 0.15s;
      border: none; background: none; text-decoration: none;
    }
    .rail-btn:hover, .rail-btn.active { background: #2d1045; color: #e2d4f0; }

    .settings-shell { flex: 1; display: flex; overflow: hidden; }

    .settings-sidebar {
      width: 210px; flex-shrink: 0;
      border-right: 1px solid #e5e7eb;
      overflow-y: auto;
      padding: 20px 0 20px;
      background: #fafafa;
    }
    .sidebar-group {
      padding: 0 12px;
      margin-bottom: 4px;
    }
    .sidebar-group + .sidebar-group {
      margin-top: 4px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
    }
    .sidebar-section-label {
      font-size: 0.68rem; font-weight: 700;
      color: #b0b7c3; text-transform: uppercase;
      letter-spacing: 0.6px;
      padding: 0 4px 6px;
    }
    .sidebar-item {
      display: block; padding: 6px 8px;
      font-size: 0.84rem; color: #4b5563;
      text-decoration: none; border-radius: 6px;
      transition: background 0.1s, color 0.1s;
      margin-bottom: 1px;
    }
    .sidebar-item:hover { background: #ede9f6; color: #1a0828; }
    .sidebar-item.active {
      background: #ede9f6; color: #1a0828; font-weight: 600;
      position: relative;
    }
    .sidebar-item.active::before {
      content: '';
      position: absolute; left: -12px; top: 6px; bottom: 6px;
      width: 3px; background: #7c3aed; border-radius: 0 2px 2px 0;
    }

    .settings-main { flex: 1; overflow-y: auto; padding: 32px 40px; }

    .settings-header {
      display: flex; align-items: center;
      justify-content: space-between; margin-bottom: 32px;
    }
    .settings-header h1 { font-size: 1.6rem; font-weight: 700; color: #111; }
    .btn-edit {
      display: inline-flex; align-items: center; gap: 7px;
      padding: 8px 18px; background: #111; color: #fff;
      border-radius: 8px; font-size: 0.85rem; font-weight: 600;
      border: none; cursor: pointer; transition: background 0.15s;
    }
    .btn-edit:hover { background: #333; }

    .profile-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 40px;
    }

    .section-heading {
      display: flex; align-items: center; gap: 8px;
      font-size: 0.95rem; font-weight: 700; color: #111;
      margin-bottom: 20px; padding-bottom: 12px;
      border-bottom: 1px solid #e5e7eb;
    }
    .section-heading svg { color: #6b7280; flex-shrink: 0; }

    .field { margin-bottom: 18px; }
    .field-label { font-size: 0.75rem; color: #6b7280; margin-bottom: 3px; }
    .field-value { font-size: 0.9rem; color: #111; }
    .field-value.muted { color: #9ca3af; }

    hr.divider { border: none; border-top: 1px solid #e5e7eb; margin: 24px 0; }

    .region-preview {
      background: #f9fafb; border: 1px solid #e5e7eb;
      border-radius: 8px; padding: 14px 16px; margin-top: 16px;
    }
    .region-preview-title {
      font-size: 0.75rem; font-weight: 600; color: #6b7280; margin-bottom: 10px;
    }
    .region-preview-row {
      display: flex; justify-content: space-between;
      font-size: 0.82rem; color: #374151; padding: 3px 0;
    }

    .info-icon {
      display: inline-flex; align-items: center; justify-content: center;
      width: 14px; height: 14px; border-radius: 50%;
      border: 1px solid #9ca3af; font-size: 0.6rem; color: #9ca3af;
      cursor: default; vertical-align: middle; margin-left: 3px;
    }
    .account-status-label { font-size: 0.85rem; font-weight: 600; color: #111; margin-bottom: 3px; }
    .account-status-desc { font-size: 0.82rem; color: #6b7280; }
    .account-status-desc a { color: #4a90e2; text-decoration: none; }
    .account-status-desc a:hover { text-decoration: underline; }
  </style>
</head>
<body>

  <nav class="rail">
    <div class="rail-logo">
      <svg width="18" height="18" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
      </svg>
    </div>
    <a class="rail-btn" href="/" title="Projects">
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
    <a class="rail-btn active" href="/settings" title="Settings" style="margin-top:auto;">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
      </svg>
    </a>
    <a class="rail-btn" href="/settings" title="Account">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
      </svg>
    </a>
  </nav>

  <div class="settings-shell">
    <aside class="settings-sidebar">
      <div class="sidebar-group">
        <div class="sidebar-section-label">Account</div>
        <a class="sidebar-item active" href="/settings">User profile</a>
        <a class="sidebar-item" href="/settings">Organization profile</a>
        <a class="sidebar-item" href="/settings">Apps</a>
      </div>

      <div class="sidebar-group">
        <div class="sidebar-section-label">User management</div>
        <a class="sidebar-item" href="/settings">Users and licenses</a>
        <a class="sidebar-item" href="/settings">Roles</a>
        <a class="sidebar-item" href="/settings">Teams</a>
      </div>

      <div class="sidebar-group">
        <div class="sidebar-section-label">Pricing &amp; financing</div>
        <a class="sidebar-item" href="/settings">Pricing defaults</a>
        <a class="sidebar-item" href="/settings">Financing</a>
        <a class="sidebar-item" href="/settings">Utility and tax rates</a>
      </div>

      <div class="sidebar-group">
        <div class="sidebar-section-label">Projects and designs</div>
        <a class="sidebar-item" href="/settings">Statuses and warnings</a>
        <a class="sidebar-item" href="/settings">Design</a>
        <a class="sidebar-item" href="/settings">Financing integrations</a>
        <a class="sidebar-item" href="/settings">Performance simulations</a>
      </div>

      <div class="sidebar-group">
        <div class="sidebar-section-label">API</div>
        <a class="sidebar-item" href="/settings">API tokens</a>
        <a class="sidebar-item" href="/settings">Webhooks</a>
      </div>

      <div class="sidebar-group">
        <div class="sidebar-section-label">Plan sets</div>
        <a class="sidebar-item" href="/settings">Contractor profiles</a>
      </div>
    </aside>

    <main class="settings-main">
      <div class="settings-header">
        <h1>User profile</h1>
        <button class="btn-edit" onclick="alert('Edit coming soon!')">
          <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          Edit
        </button>
      </div>

      <div class="profile-grid">

        <!-- Profile -->
        <div>
          <div class="section-heading">
            <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
            Profile
          </div>
          <div class="field"><div class="field-label">First name</div><div class="field-value">Adam</div></div>
          <div class="field"><div class="field-label">Last name</div><div class="field-value">Bahou</div></div>
          <div class="field"><div class="field-label">Job function</div><div class="field-value muted">—</div></div>
          <div class="field"><div class="field-label">Phone number</div><div class="field-value muted">—</div></div>
          <div class="field"><div class="field-label">Email address</div><div class="field-value">adam@teamsunshine.solar</div></div>
          <hr class="divider"/>
          <div class="section-heading">
            <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
            Account
          </div>
          <div class="account-status-label">Account status</div>
          <div class="account-status-desc">To close your account, <a href="#">contact us</a>.</div>
        </div>

        <!-- Region -->
        <div>
          <div class="section-heading">
            <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
            </svg>
            Region
          </div>
          <div class="field"><div class="field-label">Regional formatting</div><div class="field-value">United States (my org)</div></div>
          <div class="field"><div class="field-label">Temperature</div><div class="field-value">Fahrenheit</div></div>
          <div class="field"><div class="field-label">Measurement system</div><div class="field-value">Imperial (US)</div></div>
          <div class="field"><div class="field-label">Currency</div><div class="field-value">US Dollar ($, USD)</div></div>
          <div class="region-preview">
            <div class="region-preview-title">Regional formatting</div>
            <div class="region-preview-row"><span>${longDate}</span><span>$1,234.56</span></div>
            <div class="region-preview-row"><span>${shortDate}</span><span>30 lb</span></div>
            <div class="region-preview-row"><span>77°F</span><span>5'6"</span></div>
          </div>
        </div>

        <!-- Permission -->
        <div>
          <div class="section-heading">
            <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
            Permission
          </div>
          <div class="field">
            <div class="field-label">License type <span class="info-icon">i</span></div>
            <div class="field-value">Premium</div>
          </div>
          <div class="field">
            <div class="field-label">Role <span class="info-icon">i</span></div>
            <div class="field-value">Admin</div>
          </div>
        </div>

      </div>
    </main>
  </div>

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
