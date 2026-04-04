require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;
const API_KEY = process.env.GOOGLE_API_KEY;
const BUILD_VERSION = Date.now();

app.use(express.json({ limit: '50mb' }));
app.get("/api/version", (req, res) => res.json({ version: BUILD_VERSION }));

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

// ── User helpers ──────────────────────────────────────────────────────────────
function loadUsers() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "data/users.json"), "utf8")); }
  catch { return []; }
}
function saveUsers(users) {
  fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
  fs.writeFileSync(path.join(__dirname, "data/users.json"), JSON.stringify(users, null, 2));
}

// Persistent session store (survives restarts)
const SESSION_FILE = path.join(__dirname, "data/sessions.json");
function loadSessions() {
  try { return JSON.parse(fs.readFileSync(SESSION_FILE, "utf8")); }
  catch { return {}; }
}
function saveSessions(s) {
  fs.mkdirSync(path.join(__dirname, "data"), { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify(s, null, 2));
}
function createSession(userId) {
  const token = Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const sessions = loadSessions();
  sessions[token] = { userId, createdAt: Date.now() };
  saveSessions(sessions);
  return token;
}
function getSession(req) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/session=([^;]+)/);
  if (!match) return null;
  const sessions = loadSessions();
  const s = sessions[match[1]];
  if (!s) return null;
  const users = loadUsers();
  return users.find(u => u.id === s.userId) || null;
}
function requireAuth(req, res, next) {
  const user = getSession(req);
  if (!user) return res.redirect("/login");
  req.user = user;
  next();
}

// ── Login page ────────────────────────────────────────────────────────────────
app.get("/login", (req, res) => {
  const error = req.query.error ? '<div style="color:#ef4444;font-size:0.85rem;margin-bottom:12px;">Invalid username or password</div>' : '';
  res.send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Login — Solar CRM</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#1a0828;display:flex;align-items:center;justify-content:center;min-height:100vh;color:#fff}
  .login-card{background:#fff;border-radius:16px;padding:40px 36px;width:380px;color:#111;box-shadow:0 20px 60px rgba(0,0,0,0.3)}
  .login-logo{width:48px;height:48px;background:linear-gradient(135deg,#c084fc,#818cf8);border-radius:12px;display:flex;align-items:center;justify-content:center;margin:0 auto 20px}
  h1{text-align:center;font-size:1.4rem;font-weight:700;margin-bottom:6px}
  .subtitle{text-align:center;font-size:0.85rem;color:#6b7280;margin-bottom:28px}
  label{display:block;font-size:0.78rem;font-weight:600;color:#374151;margin-bottom:4px}
  input{width:100%;padding:10px 12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:0.9rem;outline:none;transition:border-color 0.15s;margin-bottom:16px}
  input:focus{border-color:#7c3aed;box-shadow:0 0 0 3px rgba(124,58,237,0.1)}
  button{width:100%;padding:11px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:0.9rem;font-weight:600;cursor:pointer;transition:background 0.15s}
  button:hover{background:#6d28d9}
</style>
</head><body>
<div class="login-card">
  <div class="login-logo">
    <svg width="24" height="24" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
    </svg>
  </div>
  <h1>Solar CRM</h1>
  <div class="subtitle">Sign in to your account</div>
  ${error}
  <form method="POST" action="/login">
    <label>Username</label>
    <input type="text" name="username" autocomplete="username" autofocus required/>
    <label>Password</label>
    <input type="password" name="password" autocomplete="current-password" required/>
    <button type="submit">Sign in</button>
  </form>
</div>
</body></html>`);
});

app.post("/login", express.urlencoded({ extended: false }), (req, res) => {
  const { username, password } = req.body;
  const users = loadUsers();
  const user = users.find(u => u.username === username && u.password === password && u.active);
  if (!user) return res.redirect("/login?error=1");
  const token = createSession(user.id);
  res.setHeader("Set-Cookie", "session=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000");
  res.redirect("/");
});

app.get("/logout", (req, res) => {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/session=([^;]+)/);
  if (match) {
    const sessions = loadSessions();
    delete sessions[match[1]];
    saveSessions(sessions);
  }
  res.setHeader("Set-Cookie", "session=; Path=/; HttpOnly; Max-Age=0");
  res.redirect("/login");
});

// Protect all routes except login and static assets
app.use((req, res, next) => {
  if (req.path === "/login" || req.path === "/logout" || req.path === "/favicon.ico") return next();
  const user = getSession(req);
  if (!user) {
    if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Not authenticated" });
    return res.redirect("/login");
  }
  req.user = user;
  next();
});

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
    const pStatus = (p.status || "Remote Assessment Completed").toLowerCase();
    const pTeam = (p.team || "Team Sunshine").toLowerCase();
    const pOrg = (p.organization || "Internal").toLowerCase();
    const pAssignee = (p.assignee || p.customer?.name || "").toLowerCase();
    const createdISO = p.createdAt || "";
    return `<tr class="data-row" data-id="${p.id}" data-name="${name.toLowerCase()}" data-customer="${customerName.toLowerCase()}" data-address="${address.toLowerCase()}" data-type="${(p.propertyType||'residential').toLowerCase()}" data-status="${pStatus}" data-team="${pTeam}" data-org="${pOrg}" data-assignee="${pAssignee}" data-created="${createdISO}">
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
    .table-wrap { border: 1px solid #e5e7eb; border-radius: 10px; overflow: visible; }
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
    thead th:first-child { border-top-left-radius: 10px; }
    thead th:last-child { border-top-right-radius: 10px; }
    tbody tr:last-child td:first-child { border-bottom-left-radius: 10px; }
    tbody tr:last-child td:last-child { border-bottom-right-radius: 10px; }
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
    tbody td { padding: 18px 14px; vertical-align: middle; font-size: 0.85rem; }
    .td-name { font-weight: 600; color: #111; min-width: 160px; }
    .td-muted { color: #9ca3af; }
    .td-addr { color: #6b7280; max-width: 200px; white-space: normal; word-wrap: break-word; }

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

    /* Rename modal */
    .rename-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.35); z-index:9999; align-items:center; justify-content:center; }
    .rename-overlay.open { display:flex; }
    .rename-modal { background:#fff; border-radius:14px; padding:28px 32px; width:460px; box-shadow:0 20px 60px rgba(0,0,0,0.18); position:relative; }
    .rename-modal-close { position:absolute; top:16px; right:18px; background:none; border:none; font-size:1.3rem; color:#6b7280; cursor:pointer; padding:4px; line-height:1; }
    .rename-modal-close:hover { color:#111; }
    .rename-modal h2 { font-size:1.1rem; font-weight:700; color:#111; margin-bottom:20px; }
    .rename-modal label { display:block; font-size:0.82rem; font-weight:600; color:#111; margin-bottom:6px; }
    .rename-modal input { width:100%; padding:10px 12px; border:1.5px solid #e5e7eb; border-radius:8px; font-size:0.9rem; background:#f9fafb; outline:none; transition:border-color 0.15s; }
    .rename-modal input:focus { border-color:#7c3aed; background:#fff; }
    .rename-modal-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:24px; }
    .rename-modal-actions button { padding:8px 22px; border-radius:8px; font-size:0.88rem; font-weight:600; cursor:pointer; border:none; transition:background 0.15s; }
    .rename-btn-cancel { background:none; color:#374151; }
    .rename-btn-cancel:hover { background:#f3f4f6; }
    .rename-btn-save { background:#e5e7eb; color:#9ca3af; }
    .rename-btn-save.active { background:#7c3aed; color:#fff; }
    .rename-btn-save.active:hover { background:#6d28d9; }
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
      <a class="nav-drawer-link" href="/database">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg>
        Database
      </a>
      <a class="nav-drawer-link" href="/settings">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
        Settings
      </a>
      <a class="nav-drawer-link" href="/partners">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
        Partners
      </a>
      <a class="nav-drawer-link" href="/image-analysis">
        <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
        Image Analysis
      </a>
    </div>
    <div class="nav-drawer-footer">
      <div class="nav-drawer-user">
        <div class="nav-drawer-avatar">AB</div>
        Adam Bahou
      </div>
      <a class="nav-drawer-foot-link" href="/settings">My profile</a>
      <a class="nav-drawer-foot-link" href="/logout">Logout</a>
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
    <a class="rail-btn" href="/database" title="Database">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>
      </svg>
    </a>
    <a class="rail-btn" href="/settings" title="Settings" >
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
      </svg>
    </a>
    <a class="rail-btn" href="/partners" title="Partners">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
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
        <div class="no-results" id="noResults">No projects match your search or filters.</div>
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
      var total = rows.length;
      var visible = 0;

      var types = (activeFilters['type'] || []).map(function(v) { return v.toLowerCase(); });
      var statuses = (activeFilters['status'] || []).map(function(v) { return v.toLowerCase(); });
      var teams = (activeFilters['teams'] || []).map(function(v) { return v.toLowerCase(); });
      var orgs = (activeFilters['orgs'] || []).map(function(v) { return v.toLowerCase(); });
      var general = activeFilters['general'] || [];

      var now = new Date();
      var weekAgo = new Date(now.getTime() - 7 * 86400000);
      var monthAgo = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());

      rows.forEach(function(row) {
        var text = (row.dataset.name + ' ' + row.dataset.customer + ' ' + row.dataset.address).toLowerCase();
        var searchMatch = !q || text.includes(q);

        var typeMatch = types.length === 0 || types.indexOf(row.dataset.type) !== -1;
        var statusMatch = statuses.length === 0 || statuses.some(function(s) { return (row.dataset.status || '').includes(s); });
        var teamMatch = teams.length === 0 || teams.some(function(t) { return (row.dataset.team || '').includes(t); });
        var orgMatch = orgs.length === 0 || orgs.some(function(o) { return (row.dataset.org || '').includes(o); });

        var generalMatch = true;
        if (general.length > 0) {
          var hasAssignee = !!(row.dataset.assignee && row.dataset.assignee.trim());
          var created = row.dataset.created ? new Date(row.dataset.created) : null;
          generalMatch = general.every(function(g) {
            if (g === 'Has assignee') return hasAssignee;
            if (g === 'No assignee') return !hasAssignee;
            if (g === 'Created this week') return created && created >= weekAgo;
            if (g === 'Created this month') return created && created >= monthAgo;
            return true;
          });
        }

        var show = searchMatch && typeMatch && statusMatch && teamMatch && orgMatch && generalMatch;
        row.style.display = show ? '' : 'none';
        if (show) visible++;
      });

      document.getElementById('noResults').style.display = (visible === 0 && (q || hasAnyFilter())) ? 'block' : 'none';
      document.getElementById('filterCount').textContent = 'Showing ' + visible + ' of ' + total;
    }

    function hasAnyFilter() {
      return Object.keys(activeFilters).some(function(k) { return (activeFilters[k] || []).length > 0; });
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
      document.getElementById('filterPanel').classList.remove('open');
      document.getElementById('filterBtn').classList.remove('active');
      filterRows();
      var btn = document.getElementById('filterBtn');
      btn.style.borderColor = hasAnyFilter() ? '#7c3aed' : '';
      btn.style.color = hasAnyFilter() ? '#7c3aed' : '';
    }

    function clearFilter() {
      activeFilters = { type: [], status: [], teams: [], orgs: [], general: [] };
      renderFilterOptions();
      filterRows();
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

    /* ── Rename modal logic ── */
    var renameTargetId = null;
    var renameOriginal = '';
    function renameProject(id) {
      var row = document.querySelector('[data-id="' + id + '"]');
      var nameCell = row ? row.querySelector('.td-name') : null;
      renameOriginal = nameCell ? nameCell.textContent.trim() : '';
      renameTargetId = id;
      var input = document.getElementById('renameInput');
      input.value = renameOriginal;
      updateRenameSave();
      document.getElementById('renameOverlay').classList.add('open');
      setTimeout(function(){ input.focus(); input.select(); }, 50);
    }
    function closeRenameModal() {
      document.getElementById('renameOverlay').classList.remove('open');
      renameTargetId = null;
    }
    function updateRenameSave() {
      var btn = document.getElementById('renameSaveBtn');
      var val = document.getElementById('renameInput').value.trim();
      if (val && val !== renameOriginal) { btn.classList.add('active'); }
      else { btn.classList.remove('active'); }
    }
    function submitRename() {
      var val = document.getElementById('renameInput').value.trim();
      if (!val || val === renameOriginal || !renameTargetId) return;
      fetch('/api/projects/' + renameTargetId + '/rename', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: val })
      }).then(function(r) { if (r.ok) location.reload(); });
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

  <!-- Rename modal -->
  <div class="rename-overlay" id="renameOverlay" onclick="if(event.target===this)closeRenameModal()">
    <div class="rename-modal">
      <button class="rename-modal-close" onclick="closeRenameModal()">&times;</button>
      <h2>Edit name</h2>
      <label>Project name</label>
      <input type="text" id="renameInput" oninput="updateRenameSave()" onkeydown="if(event.key==='Enter')submitRename();if(event.key==='Escape')closeRenameModal();"/>
      <div class="rename-modal-actions">
        <button class="rename-btn-cancel" onclick="closeRenameModal()">Cancel</button>
        <button class="rename-btn-save" id="renameSaveBtn" onclick="submitRename()">Save</button>
      </div>
    </div>
  </div>

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
      <div id="mapPin" style="display:none;position:absolute;top:50%;left:50%;transform:translate(-50%,-100%);cursor:grab;z-index:10;filter:drop-shadow(0 2px 6px rgba(0,0,0,0.4));transition:opacity 0.3s;">
        <svg width="40" height="52" viewBox="0 0 40 52" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M20 0C8.95 0 0 8.95 0 20c0 14.25 18.35 30.85 19.13 31.53a1.25 1.25 0 001.74 0C21.65 50.85 40 34.25 40 20 40 8.95 31.05 0 20 0z" fill="#e53e3e"/>
          <circle cx="20" cy="20" r="8" fill="white"/>
        </svg>
      </div>
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

        var pin = document.getElementById('mapPin');
        pin.style.display = '';
        pin.style.opacity = '0';
        pin.style.top = '50%';
        pin.style.left = '50%';
        setTimeout(function() { pin.style.opacity = '1'; }, 100);

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

    // ── Draggable pin ──
    (function() {
      var pin = document.getElementById('mapPin');
      var panel = document.getElementById('imagePanel');
      var dragging = false, offX = 0, offY = 0;

      pin.addEventListener('mousedown', function(e) {
        e.preventDefault();
        dragging = true;
        pin.style.cursor = 'grabbing';
        var rect = pin.getBoundingClientRect();
        offX = e.clientX - rect.left - rect.width / 2;
        offY = e.clientY - rect.top;
      });

      document.addEventListener('mousemove', function(e) {
        if (!dragging) return;
        var pr = panel.getBoundingClientRect();
        var x = e.clientX - pr.left - offX;
        var y = e.clientY - pr.top - offY;
        pin.style.left = (x / pr.width * 100) + '%';
        pin.style.top = (y / pr.height * 100) + '%';
      });

      document.addEventListener('mouseup', function() {
        if (dragging) {
          dragging = false;
          pin.style.cursor = 'grab';
        }
      });

      // Touch support
      pin.addEventListener('touchstart', function(e) {
        e.preventDefault();
        dragging = true;
        var t = e.touches[0];
        var rect = pin.getBoundingClientRect();
        offX = t.clientX - rect.left - rect.width / 2;
        offY = t.clientY - rect.top;
      }, { passive: false });

      document.addEventListener('touchmove', function(e) {
        if (!dragging) return;
        var t = e.touches[0];
        var pr = panel.getBoundingClientRect();
        var x = t.clientX - pr.left - offX;
        var y = t.clientY - pr.top - offY;
        pin.style.left = (x / pr.width * 100) + '%';
        pin.style.top = (y / pr.height * 100) + '%';
      }, { passive: false });

      document.addEventListener('touchend', function() {
        if (dragging) dragging = false;
      });
    })();
  </script>

</body>
</html>`);
});

// ── Geocode API ───────────────────────────────────────────────────────────────
app.get("/api/geocode", async (req, res) => {
  const address = req.query.address;
  if (!address) return res.status(400).json({ error: "Address is required" });
  const key = process.env.GOOGLE_MAPS_KEY || API_KEY;
  if (!key) return res.status(500).json({ error: "No Google Maps API key configured" });
  try {
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`;
    const resp = await fetch(url);
    const data = await resp.json();
    if (!data.results || !data.results.length) return res.status(404).json({ error: "Address not found" });
    const result = data.results[0];
    res.json({
      lat: result.geometry.location.lat,
      lng: result.geometry.location.lng,
      formatted_address: result.formatted_address
    });
  } catch (err) {
    res.status(500).json({ error: "Geocoding failed" });
  }
});

// ── Create project API ─────────────────────────────────────────────────────────
app.post("/api/projects", (req, res) => {
  const { projectName, propertyType, address, lat, lng, customer } = req.body;
  if (!address) return res.status(400).json({ error: "Address is required" });

  const projects = loadProjects();
  const designId = newId();
  const project = {
    id: newId(),
    createdAt: new Date().toISOString(),
    projectName: projectName || customer?.name || "",
    propertyType: propertyType || "residential",
    address,
    lat,
    lng,
    customer: {
      name: customer?.name || "",
      email: customer?.email || "",
      phone: customer?.phone || ""
    },
    designs: [
      { id: designId, name: "Design 1", createdAt: new Date().toISOString(), segments: [], stats: { cost: 0, offset: 0, kw: 0 } }
    ],
    activeDesignId: designId
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

// ── Update customer profile ───────────────────────────────────────────────────
app.patch("/api/projects/:id/customer", (req, res) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });
  if (!project.customer) project.customer = {};
  const { name, email, phone } = req.body;
  if (name !== undefined) project.customer.name = name;
  if (email !== undefined) project.customer.email = email;
  if (phone !== undefined) project.customer.phone = phone;
  saveProjects(projects);
  res.json({ ok: true });
});

app.patch("/api/projects/:id/reassign", (req, res) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });
  project.assignee = req.body.assignee || project.assignee;
  saveProjects(projects);
  res.json({ ok: true });
});

app.patch("/api/projects/:id/archive", (req, res) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });
  project.status = "Archived";
  saveProjects(projects);
  res.json({ ok: true });
});

app.patch("/api/projects/:id/energy", (req, res) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });
  project.energyUsage = req.body.energyUsage || [];
  saveProjects(projects);
  res.json({ ok: true });
});

app.get("/api/projects/:id/energy", (req, res) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });
  res.json({ energyUsage: project.energyUsage || [] });
});

app.patch("/api/projects/:id/notes", (req, res) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });
  project.notes = req.body.notes || "";
  saveProjects(projects);
  res.json({ ok: true });
});

// ── Equipment API ─────────────────────────────────────────────────────────
function loadEquipment() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "data/equipment.json"), "utf8")); }
  catch { return { modules: [], inverters: [], racking: [] }; }
}
function saveEquipment(eq) {
  fs.writeFileSync(path.join(__dirname, "data/equipment.json"), JSON.stringify(eq, null, 2));
}

// List all equipment
app.get("/api/equipment", (req, res) => {
  res.json(loadEquipment());
});

// List modules
app.get("/api/equipment/modules", (req, res) => {
  res.json(loadEquipment().modules);
});

// Add a module
app.post("/api/equipment/modules", (req, res) => {
  const eq = loadEquipment();
  const mod = {
    id: newId(),
    name: req.body.name || "Unnamed Module",
    manufacturer: req.body.manufacturer || "",
    type: req.body.type || "Default",
    componentType: req.body.componentType || "",
    wattage: req.body.wattage || 0,
    cellQuantity: req.body.cellQuantity || 0,
    efficiency: req.body.efficiency || 0,
    description: req.body.description || "",
    microinverter: req.body.microinverter || false,
    microinverterManufacturer: req.body.microinverterManufacturer || "",
    submoduleSimulation: req.body.submoduleSimulation || false,
    regions: req.body.regions || "All regions",
    domesticContent: req.body.domesticContent || false,
    dimensions: req.body.dimensions || { lengthMm: null, widthMm: null },
    createdAt: new Date().toISOString()
  };
  eq.modules.push(mod);
  saveEquipment(eq);
  res.json(mod);
});

// Update a module
app.put("/api/equipment/modules/:id", (req, res) => {
  const eq = loadEquipment();
  const mod = eq.modules.find(m => m.id === req.params.id);
  if (!mod) return res.status(404).json({ error: "Module not found" });
  Object.assign(mod, req.body, { id: mod.id });
  saveEquipment(eq);
  res.json(mod);
});

// Delete a module
app.delete("/api/equipment/modules/:id", (req, res) => {
  const eq = loadEquipment();
  const idx = eq.modules.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Module not found" });
  eq.modules.splice(idx, 1);
  saveEquipment(eq);
  res.json({ ok: true });
});

// ── Calibration API ─────────────────────────────────────────────────────────
app.get("/api/projects/:id/calibration", (req, res) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });
  res.json(project.calibration || null);
});

app.put("/api/projects/:id/calibration", express.json(), (req, res) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });
  project.calibration = req.body;
  saveProjects(projects);
  res.json({ ok: true });
});

// ── Design CRUD API ──────────────────────────────────────────────────────────
// Ensure project has designs array (migration for old projects)
function ensureDesigns(project) {
  if (!project.designs) {
    const did = newId();
    project.designs = [{ id: did, name: "Design 1", createdAt: new Date().toISOString(), segments: [], stats: { cost: 0, offset: 0, kw: 0 } }];
    project.activeDesignId = did;
  }
  return project;
}

// Get all designs for a project
app.get("/api/projects/:id/designs", (req, res) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });
  ensureDesigns(project);
  saveProjects(projects);
  res.json({ designs: project.designs, activeDesignId: project.activeDesignId });
});

// Save a design (segments + stats)
app.put("/api/projects/:id/designs/:designId", (req, res) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });
  ensureDesigns(project);
  const design = project.designs.find(d => d.id === req.params.designId);
  if (!design) return res.status(404).json({ error: "Design not found" });
  if (req.body.segments !== undefined) design.segments = req.body.segments;
  if (req.body.stats) design.stats = req.body.stats;
  if (req.body.trees !== undefined) design.trees = req.body.trees;
  if (req.body.roofFaces !== undefined) design.roofFaces = req.body.roofFaces;
  if (req.body.name) design.name = req.body.name;
  design.updatedAt = new Date().toISOString();
  saveProjects(projects);
  res.json({ ok: true });
});

// Create a new design
app.post("/api/projects/:id/designs", (req, res) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });
  ensureDesigns(project);
  const num = project.designs.length + 1;
  const design = {
    id: newId(),
    name: req.body.name || ("Design " + num),
    createdAt: new Date().toISOString(),
    segments: [],
    stats: { cost: 0, offset: 0, kw: 0 }
  };
  project.designs.push(design);
  project.activeDesignId = design.id;
  saveProjects(projects);
  res.json(design);
});

// Switch active design
app.patch("/api/projects/:id/designs/active", (req, res) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });
  ensureDesigns(project);
  const design = project.designs.find(d => d.id === req.body.designId);
  if (!design) return res.status(404).json({ error: "Design not found" });
  project.activeDesignId = req.body.designId;
  saveProjects(projects);
  res.json({ ok: true, design });
});

// Delete a design
app.delete("/api/projects/:id/designs/:designId", (req, res) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });
  ensureDesigns(project);
  if (project.designs.length <= 1) return res.status(400).json({ error: "Cannot delete the only design" });
  const idx = project.designs.findIndex(d => d.id === req.params.designId);
  if (idx === -1) return res.status(404).json({ error: "Design not found" });
  project.designs.splice(idx, 1);
  if (project.activeDesignId === req.params.designId) {
    project.activeDesignId = project.designs[0].id;
  }
  saveProjects(projects);
  res.json({ ok: true });
});

// Duplicate a design
app.post("/api/projects/:id/designs/:designId/duplicate", (req, res) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).json({ error: "Not found" });
  ensureDesigns(project);
  const source = project.designs.find(d => d.id === req.params.designId);
  if (!source) return res.status(404).json({ error: "Design not found" });
  const copy = {
    id: newId(),
    name: source.name + " (copy)",
    createdAt: new Date().toISOString(),
    segments: JSON.parse(JSON.stringify(source.segments || [])),
    stats: { ...source.stats },
    trees: JSON.parse(JSON.stringify(source.trees || []))
  };
  project.designs.push(copy);
  saveProjects(projects);
  res.json(copy);
});

// ── Google Solar API ──────────────────────────────────────────────────────────
app.get("/api/solar/building-insights", async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "lat and lng required" });
  try {
    const url = `https://solar.googleapis.com/v1/buildingInsights:findClosest?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=HIGH&key=${API_KEY}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      return res.status(resp.status).json({ error: err.error?.message || "Solar API error" });
    }
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/solar/data-layers", async (req, res) => {
  const { lat, lng, radius } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "lat and lng required" });
  try {
    const r = radius || 50;
    const url = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&radiusMeters=${r}&view=FULL_LAYERS&requiredQuality=HIGH&pixelSizeMeters=0.5&key=${API_KEY}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      return res.status(resp.status).json({ error: err.error?.message || "Solar API error" });
    }
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/solar/geotiff", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "url required" });
  try {
    const separator = url.includes("?") ? "&" : "?";
    const fullUrl = `${url}${separator}key=${API_KEY}`;
    const resp = await fetch(fullUrl);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "Unknown error");
      return res.status(resp.status).json({ error: "GeoTIFF fetch failed: " + resp.status + " " + errText.slice(0, 200) });
    }
    const contentType = resp.headers.get("content-type") || "";
    if (contentType.includes("json") || contentType.includes("html")) {
      const body = await resp.text();
      return res.status(400).json({ error: "Expected TIFF but got: " + contentType + " — " + body.slice(0, 200) });
    }
    res.set("Content-Type", "image/tiff");
    resp.body.pipe(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Satellite imagery providers ──────────────────────────────────────────────
const IMAGERY_PROVIDERS = {
  google: {
    name: "Google Maps",
    available: () => !!(process.env.GOOGLE_MAPS_KEY || API_KEY),
    fetchImage: async (lat, lng, zoom, dims) => {
      const key = process.env.GOOGLE_MAPS_KEY || API_KEY;
      const url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${dims}&scale=2&maptype=satellite&key=${key}`;
      return fetch(url);
    }
  },
  nearmap: {
    name: "Nearmap",
    available: () => !!process.env.NEARMAP_API_KEY,
    fetchImage: async (lat, lng, zoom, dims) => {
      const key = process.env.NEARMAP_API_KEY;
      const [w, h] = dims.split("x").map(Number);
      // Nearmap Tile API — vertical imagery at high resolution
      // Docs: https://docs.nearmap.com/display/ND/Tile+API
      const url = `https://api.nearmap.com/staticmap/v3/staticimage?center=${lat},${lng}&zoom=${zoom}&size=${w}x${h}&maptype=Vert&apikey=${key}`;
      return fetch(url);
    }
  },
  eagleview: {
    name: "EagleView",
    available: () => !!(process.env.EAGLEVIEW_API_KEY && process.env.EAGLEVIEW_CLIENT_ID),
    fetchImage: async (lat, lng, zoom, dims) => {
      const apiKey = process.env.EAGLEVIEW_API_KEY;
      const clientId = process.env.EAGLEVIEW_CLIENT_ID;
      // EagleView Reveal API — high-res ortho imagery
      // Replace with actual endpoint when API access is provisioned
      const url = `https://api.eagleview.com/imagery/v1/ortho?lat=${lat}&lng=${lng}&zoom=${zoom}&client_id=${clientId}&apikey=${apiKey}`;
      return fetch(url);
    }
  }
};

// List available imagery providers
app.get("/api/imagery/providers", (req, res) => {
  const providers = Object.entries(IMAGERY_PROVIDERS).map(([id, p]) => ({
    id, name: p.name, available: p.available()
  }));
  res.json({ providers, default: providers.find(p => p.available)?.id || null });
});

// Satellite imagery proxy — supports provider query param
app.get("/api/satellite", async (req, res) => {
  const { lat, lng, zoom, size, provider: providerParam } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "lat and lng required" });

  // Pick provider: explicit param → first available
  const providerId = providerParam && IMAGERY_PROVIDERS[providerParam]?.available()
    ? providerParam
    : Object.keys(IMAGERY_PROVIDERS).find(k => IMAGERY_PROVIDERS[k].available());

  if (!providerId) return res.status(500).json({ error: "No imagery API key configured" });

  const z = zoom || 20;
  const s = size || "640x640";
  const dims = s.includes("x") ? s : `${s}x${s}`;

  try {
    const resp = await IMAGERY_PROVIDERS[providerId].fetchImage(lat, lng, z, dims);
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "Unknown error");
      return res.status(resp.status).json({ error: `${IMAGERY_PROVIDERS[providerId].name} error: ${errText.slice(0, 200)}` });
    }
    res.set("Content-Type", resp.headers.get("content-type") || "image/png");
    res.set("Cache-Control", "public, max-age=86400");
    res.set("X-Imagery-Provider", providerId);
    resp.body.pipe(res);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── DSM elevation JSON (server-side GeoTIFF parse) ───────────────────────────
app.get("/api/solar/dsm-elevation", async (req, res) => {
  const { lat, lng, radius } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "lat and lng required" });
  try {
    const r = radius || 75;
    const layersUrl = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${lat}&location.longitude=${lng}&radiusMeters=${r}&view=FULL_LAYERS&requiredQuality=HIGH&pixelSizeMeters=0.5&key=${API_KEY}`;
    const layersResp = await fetch(layersUrl);
    if (!layersResp.ok) {
      const err = await layersResp.json().catch(() => ({}));
      return res.status(layersResp.status).json({ error: err.error?.message || "Solar API error" });
    }
    const layers = await layersResp.json();
    const dsmUrl = layers.dsmUrl;
    if (!dsmUrl) return res.json({ error: "No DSM data available for this location" });

    // Fetch DSM and RGB satellite image in parallel
    const dsmSep = dsmUrl.includes("?") ? "&" : "?";
    const rgbUrl = layers.rgbUrl;
    const fetches = [fetch(`${dsmUrl}${dsmSep}key=${API_KEY}`)];
    if (rgbUrl) {
      const rgbSep = rgbUrl.includes("?") ? "&" : "?";
      fetches.push(fetch(`${rgbUrl}${rgbSep}key=${API_KEY}`));
    }
    const [tiffResp, rgbResp] = await Promise.all(fetches);

    if (!tiffResp.ok) return res.status(tiffResp.status).json({ error: "GeoTIFF fetch failed: " + tiffResp.status });

    const GeoTIFF = require("geotiff");

    // Parse DSM elevation
    const buf = await tiffResp.arrayBuffer();
    const tiff = await GeoTIFF.fromArrayBuffer(buf);
    const image = await tiff.getImage();
    const rasters = await image.readRasters();
    const width = image.getWidth();
    const height = image.getHeight();
    const elevData = Array.from(rasters[0]);

    // Compute geographic bbox from known API parameters
    // GeoTIFF getBoundingBox() returns projected coords (UTM), not lat/lng
    // So we derive the bbox from center + dimensions + pixel size
    const latF = parseFloat(lat);
    const lngF = parseFloat(lng);
    const pixelSizeM = 0.5; // matches API request
    const halfWidthM = (width * pixelSizeM) / 2;
    const halfHeightM = (height * pixelSizeM) / 2;
    const dLat = halfHeightM / 111320;
    const dLng = halfWidthM / (111320 * Math.cos(latF * Math.PI / 180));
    const bbox = [lngF - dLng, latF - dLat, lngF + dLng, latF + dLat]; // [minLng, minLat, maxLng, maxLat]

    // Parse RGB satellite image if available
    let satelliteDataUrl = null;
    let rgbBbox = null;
    if (rgbResp && rgbResp.ok) {
      try {
        const { PNG } = require("pngjs");
        const rgbBuf = await rgbResp.arrayBuffer();
        const rgbTiff = await GeoTIFF.fromArrayBuffer(rgbBuf);
        const rgbImage = await rgbTiff.getImage();
        const rgbRasters = await rgbImage.readRasters();
        const rgbW = rgbImage.getWidth();
        const rgbH = rgbImage.getHeight();
        const rBand = rgbRasters[0], gBand = rgbRasters[1], bBand = rgbRasters[2];

        // Compute RGB bbox from actual GeoTIFF metadata (not assumed center)
        const rgbGeoBbox = rgbImage.getBoundingBox(); // [minX, minY, maxX, maxY]
        const rgbIsGeo = Math.abs(rgbGeoBbox[2]) <= 360 && Math.abs(rgbGeoBbox[3]) <= 360;
        if (rgbIsGeo) {
          rgbBbox = [rgbGeoBbox[0], rgbGeoBbox[1], rgbGeoBbox[2], rgbGeoBbox[3]];
        } else {
          // Projected (UTM) — convert using design point as reference
          const mPerDegLat_ = 111320;
          const mPerDegLng_ = 111320 * Math.cos(latF * Math.PI / 180);
          const rgbHalfW = (rgbGeoBbox[2] - rgbGeoBbox[0]) / 2;
          const rgbHalfH = (rgbGeoBbox[3] - rgbGeoBbox[1]) / 2;
          rgbBbox = [
            lngF - rgbHalfW / mPerDegLng_,
            latF - rgbHalfH / mPerDegLat_,
            lngF + rgbHalfW / mPerDegLng_,
            latF + rgbHalfH / mPerDegLat_
          ];
        }

        const png = new PNG({ width: rgbW, height: rgbH });
        for (let i = 0; i < rgbW * rgbH; i++) {
          png.data[i * 4]     = rBand[i];
          png.data[i * 4 + 1] = gBand[i];
          png.data[i * 4 + 2] = bBand[i];
          png.data[i * 4 + 3] = 255;
        }
        const pngBuffer = PNG.sync.write(png);
        satelliteDataUrl = "data:image/png;base64," + pngBuffer.toString("base64");
      } catch (rgbErr) {
        console.error("RGB satellite parse error:", rgbErr.message);
      }
    }

    res.json({ error: null, width, height, elevData, satelliteDataUrl, bbox, rgbBbox });
  } catch (e) {
    res.status(500).json({ error: "DSM parse failed: " + e.message });
  }
});

// ── DSM Grid Points (161×161 elevation grid from Google Solar DSM) ────────────
app.get("/api/lidar/points", async (req, res) => {
  const { lat, lng } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "lat and lng required" });
  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);
  const gridSize = 281;       // 281×281 = ~79,000 points at 0.25m steps
  const halfExtent = 35;      // 35 meters from pin in each direction (~70m × 70m, matches satellite image)

  try {
    const GeoTIFF = require("geotiff");

    // Fetch DSM from Google Solar API — request 75m radius to cover full satellite image extent
    const layersUrl = `https://solar.googleapis.com/v1/dataLayers:get?location.latitude=${latF}&location.longitude=${lngF}&radiusMeters=75&view=FULL_LAYERS&requiredQuality=HIGH&pixelSizeMeters=0.25&key=${API_KEY}`;
    const layersResp = await fetch(layersUrl);
    if (!layersResp.ok) {
      const err = await layersResp.json().catch(() => ({}));
      return res.status(layersResp.status).json({ error: err.error?.message || "Solar API error", points: [] });
    }
    const layers = await layersResp.json();
    const dsmUrl = layers.dsmUrl;
    if (!dsmUrl) return res.json({ error: "No DSM data available for this location", points: [] });

    // Fetch and parse DSM GeoTIFF
    const dsmSep = dsmUrl.includes("?") ? "&" : "?";
    const tiffResp = await fetch(`${dsmUrl}${dsmSep}key=${API_KEY}`);
    if (!tiffResp.ok) return res.json({ error: "DSM fetch failed", points: [] });

    const buf = await tiffResp.arrayBuffer();
    const tiff = await GeoTIFF.fromArrayBuffer(buf);
    const image = await tiff.getImage();
    const rasters = await image.readRasters();
    const imgW = image.getWidth();
    const imgH = image.getHeight();
    const elevData = rasters[0];

    // Use actual GeoTIFF geotransform for accurate coordinate mapping
    const origin = image.getOrigin();     // [originX, originY] in CRS coords
    const resolution = image.getResolution(); // [resX, resY] (resY is negative)
    const tiepoints = image.getTiePoints ? image.getTiePoints() : null;
    // GeoTIFF bbox from actual metadata (projected coords)
    const geoBbox = image.getBoundingBox(); // [minX, minY, maxX, maxY]
    const dsmMinX = geoBbox[0], dsmMinY = geoBbox[1];
    const dsmMaxX = geoBbox[2], dsmMaxY = geoBbox[3];

    // Check if CRS is geographic (lat/lng) or projected (meters/UTM)
    // Google Solar API GeoTIFFs use EPSG:4326-like coords if values are small
    const isGeographic = Math.abs(dsmMaxX) <= 360 && Math.abs(dsmMaxY) <= 360;

    let dsmMinLng, dsmMaxLng, dsmMinLat, dsmMaxLat;
    if (isGeographic) {
      dsmMinLng = dsmMinX; dsmMaxLng = dsmMaxX;
      dsmMinLat = dsmMinY; dsmMaxLat = dsmMaxY;
    } else {
      // Projected coords (UTM) — approximate conversion back to geographic
      // Use the requested center as reference and compute offsets in meters
      const metersPerDegLat_ = 111320;
      const metersPerDegLng_ = 111320 * Math.cos(latF * Math.PI / 180);
      const centerX = (dsmMinX + dsmMaxX) / 2;
      const centerY = (dsmMinY + dsmMaxY) / 2;
      const halfW = (dsmMaxX - dsmMinX) / 2;
      const halfH = (dsmMaxY - dsmMinY) / 2;
      dsmMinLng = lngF - halfW / metersPerDegLng_;
      dsmMaxLng = lngF + halfW / metersPerDegLng_;
      dsmMinLat = latF - halfH / metersPerDegLat_;
      dsmMaxLat = latF + halfH / metersPerDegLat_;
    }

    console.log(`DSM actual bbox: [${dsmMinLng.toFixed(6)}, ${dsmMinLat.toFixed(6)}, ${dsmMaxLng.toFixed(6)}, ${dsmMaxLat.toFixed(6)}] isGeo=${isGeographic}`);

    // Build grid centered on pin, spanning ±halfExtent meters
    const metersPerDegLat = 111320;
    const metersPerDegLng = 111320 * Math.cos(latF * Math.PI / 180);
    const stepM = (halfExtent * 2) / (gridSize - 1);

    const points = [];
    for (let row = 0; row < gridSize; row++) {
      for (let col = 0; col < gridSize; col++) {
        const offsetX = -halfExtent + col * stepM;
        const offsetY = -halfExtent + row * stepM;
        const ptLng = lngF + offsetX / metersPerDegLng;
        const ptLat = latF + offsetY / metersPerDegLat;

        // Map geographic point to pixel using actual DSM bbox
        const normX = (ptLng - dsmMinLng) / (dsmMaxLng - dsmMinLng);
        const normY = 1 - (ptLat - dsmMinLat) / (dsmMaxLat - dsmMinLat);
        const px = normX * (imgW - 1);
        const py = normY * (imgH - 1);

        if (px < 0 || px >= imgW - 1 || py < 0 || py >= imgH - 1) continue;

        // Bilinear interpolation
        const x0 = Math.floor(px), x1 = x0 + 1;
        const y0 = Math.floor(py), y1 = y0 + 1;
        const fx = px - x0, fy = py - y0;
        const e00 = elevData[y0 * imgW + x0];
        const e10 = elevData[y0 * imgW + x1];
        const e01 = elevData[y1 * imgW + x0];
        const e11 = elevData[y1 * imgW + x1];
        const elev = e00 * (1 - fx) * (1 - fy) + e10 * fx * (1 - fy) + e01 * (1 - fx) * fy + e11 * fx * fy;

        if (isNaN(elev) || elev < -100) continue;

        // [lng, lat, elevation, classification=0]
        points.push([ptLng, ptLat, elev, 0]);
      }
    }

    return res.json({
      error: null,
      points,
      bounds: {
        minX: lngF - halfExtent / metersPerDegLng,
        maxX: lngF + halfExtent / metersPerDegLng,
        minY: latF - halfExtent / metersPerDegLat,
        maxY: latF + halfExtent / metersPerDegLat
      },
      dataset: "Google Solar DSM",
      count: points.length
    });
  } catch (e) {
    res.status(500).json({ error: "DSM grid failed: " + e.message, points: [] });
  }
});

// ── Project detail page ────────────────────────────────────────────────────────
app.get("/project/:id", (req, res) => {
  const projects = loadProjects();
  const project = projects.find(p => p.id === req.params.id);
  if (!project) return res.status(404).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center;"><h2>Project not found</h2><p><a href="/">← Back</a></p></body></html>`);

  const tab = req.query.tab || "dashboard";
  ensureDesigns(project);
  saveProjects(projects);
  const allUsers = loadUsers().filter(u => u.active).map(u => ({ id: u.id, firstName: u.firstName, lastName: u.lastName, email: u.email }));
  const designUrl = `/design?lat=${project.lat}&lng=${project.lng}&address=${encodeURIComponent(project.address)}&projectId=${project.id}`;
  const salesUrl = `/sales?projectId=${project.id}`;
  const customerName = esc(project.customer?.name || project.projectName || "Untitled");
  const shortAddr = esc((project.address || "").split(",").slice(0,2).join(","));
  const typeLabel = project.propertyType === "commercial" ? "Commercial" : "Residential";
  const assigneeName = project.assignee || '';
  const assigneeInitials = assigneeName ? assigneeName.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2) : '';
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

        ${project.designs.map(d => {
          const dUrl = designUrl + '&designId=' + d.id;
          const st = d.stats || {};
          return `
        <a href="${dUrl}" class="design-card design-card-clickable" id="dcard-${d.id}">
          <span class="dc-open-hint">
            Open
            <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
          </span>
          <div class="dc-head" style="justify-content:flex-end;gap:10px;position:relative;">
            <button class="icon-btn" title="More options" onclick="event.preventDefault();event.stopPropagation();toggleDesignMenu('${d.id}')">
              <svg width="16" height="16" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>
              </svg>
            </button>
            <div class="dc-menu" id="dmenu-${d.id}">
              <button onclick="event.preventDefault();event.stopPropagation();renameDesign('${project.id}','${d.id}')">Rename</button>
            </div>
          </div>
          <div style="padding:0 0 16px;">
            <div class="d1-name" id="dname-${d.id}">${esc(d.name)}</div>
            <div class="d1-meta">Edited ${timeAgo(d.updatedAt || d.createdAt || project.createdAt)}</div>
          </div>
          <div class="d1-stats">
            <div>
              <div class="stat-label">Cost</div>
              <div class="stat-val">$${(st.cost || 0).toLocaleString("en-US", {minimumFractionDigits:2, maximumFractionDigits:2})}</div>
            </div>
            <div>
              <div class="stat-label">Offset</div>
              <div class="stat-val">${st.offset || 0}%</div>
            </div>
          </div>
          <div class="d1-stats" style="margin-top:14px;">
            <div>
              <div class="stat-label">Size</div>
              <div class="stat-val">${st.kw || 0} kW</div>
            </div>
          </div>
        </a>`;
        }).join('')}

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
      </div>

      <!-- Bar chart -->
      <div class="energy-chart-section" id="energyChartSection" style="display:none">
        <canvas id="energyBarChart" width="900" height="320"></canvas>
        <div class="echart-legend">
          <span class="echart-legend-item"><span class="echart-swatch" style="background:#e8743b"></span> Energy (kWh)</span>
          <span class="echart-legend-item"><span class="echart-swatch echart-swatch-est"></span> Energy estimate (kWh)</span>
        </div>
      </div>`;
  }

  else if (tab === "dashboard") {
    const addrParts = (project.address||"").split(",");
    const addrLine1 = esc(addrParts[0]||"—");
    const addrLine2 = esc(addrParts.slice(1).join(",").trim()||"");
    const dbUsage = project.energyUsage || [];
    const dbHasUsage = dbUsage.length > 0 && dbUsage.some(v => v > 0);
    const dbAnnualUsage = dbUsage.reduce((a, b) => a + b, 0);
    const dbAvgMonthly = dbHasUsage ? Math.round(dbAnnualUsage / 12) : 0;
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
            <div class="db-field"><div class="db-fl">Avg. monthly energy</div><div class="db-fv">${dbHasUsage ? dbAvgMonthly.toLocaleString() + ' kWh' : '— kWh'}</div></div>
            <div class="db-field"><div class="db-fl">Annual bill</div><div class="db-fv">—</div></div>
            <div class="db-field"><div class="db-fl">Annual energy</div><div class="db-fv">${dbHasUsage ? dbAnnualUsage.toLocaleString() + ' kWh' : '— kWh'}</div></div>
          </div>
        </div>

      </div>

      <!-- Designs table -->
      <div class="db-section">
        <div class="db-section-head">
          <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          Designs
          <button class="db-new-btn" onclick="createNewDesignFromDashboard()">
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
            ${project.designs.map(d => `
            <tr class="db-design-row" onclick="location.href='${designUrl}&designId=${d.id}'">
              <td class="db-td-name">${esc(d.name)}</td>
              <td>—</td>
              <td>—</td>
              <td>$${(d.stats?.cost || 0).toLocaleString()}</td>
              <td>${d.stats?.offset || 0}%</td>
              <td>${d.stats?.kw || 0} kW</td>
              <td>${timeAgo(d.updatedAt || d.createdAt)}</td>
              <td class="db-td-actions">
                <span class="db-sales-btn" onclick="event.stopPropagation(); location.href='${salesUrl}'" style="cursor:pointer">
                  <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
                  Sales Mode
                </span>
                <div style="position:relative;display:inline-block">
                  <button class="db-more-btn" onclick="event.stopPropagation(); toggleDesignDropdown('${d.id}')">···</button>
                  <div class="db-dropdown" id="dd-${d.id}">
                    <button onclick="event.stopPropagation(); renameDesignFromDash('${project.id}','${d.id}')">
                      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
                      Rename
                    </button>
                    <button onclick="event.stopPropagation(); duplicateDesignFromDash('${project.id}','${d.id}')">
                      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
                      Duplicate
                    </button>
                    <button class="db-dropdown-danger" onclick="event.stopPropagation(); deleteDesignFromDash('${project.id}','${d.id}','${esc(d.name)}')">
                      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
                      Delete
                    </button>
                  </div>
                </div>
              </td>
            </tr>
            `).join('')}
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
      ? `https://maps.googleapis.com/maps/api/staticmap?center=${project.lat},${project.lng}&zoom=19&size=640x640&scale=2&maptype=satellite&key=${process.env.GOOGLE_MAPS_KEY||""}`
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
              <input class="cp-input" id="cpFirstName" type="text" placeholder="first name" value="${firstName}"/>
            </div>
            <div class="cp-field">
              <label class="cp-label">Last name</label>
              <input class="cp-input" id="cpLastName" type="text" placeholder="last name" value="${lastName}"/>
            </div>
          </div>

          <div class="cp-row">
            <div class="cp-field">
              <label class="cp-label">Phone</label>
              <div class="cp-phone-wrap">
                <div class="cp-flag">🇺🇸 <svg width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></div>
                <input class="cp-input cp-phone-input" id="cpPhone" type="tel" placeholder="+1" value="${esc(project.customer?.phone||"")}"/>
              </div>
            </div>
            <div class="cp-field">
              <label class="cp-label">Email</label>
              <input class="cp-input" id="cpEmail" type="email" placeholder="email address" value="${esc(project.customer?.email||"")}"/>
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

          <div style="margin-top:20px;display:flex;align-items:center;gap:12px;">
            <button id="cpSaveBtn" onclick="saveCustomerProfile()" style="padding:9px 24px;border-radius:8px;border:none;background:#111;color:#fff;font-size:0.85rem;font-weight:600;cursor:pointer;">Save changes</button>
            <span id="cpSaveStatus" style="font-size:0.8rem;color:#16a34a;font-weight:500;opacity:0;transition:opacity 0.3s;"></span>
          </div>
        </div>

        <!-- Right: satellite map with pin -->
        <div class="cp-map">
          ${project.lat && project.lng
            ? `<div style="position:relative;width:100%;height:100%;">
                <img src="/api/satellite?lat=${project.lat}&lng=${project.lng}&zoom=20&width=640&height=640" alt="Property satellite view" style="width:100%;height:100%;object-fit:cover;"/>
                <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-100%);z-index:2;">
                  <svg width="32" height="42" viewBox="0 0 32 42" fill="none"><path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 26 16 26s16-14 16-26C32 7.16 24.84 0 16 0z" fill="#e8682a"/><circle cx="16" cy="16" r="6" fill="#fff"/></svg>
                </div>
              </div>`
            : `<div style="width:100%;height:100%;background:#e5e7eb;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:0.85rem;">No location data</div>`
          }
        </div>
      </div>
      <script>
        function saveCustomerProfile() {
          const first = document.getElementById("cpFirstName").value.trim();
          const last = document.getElementById("cpLastName").value.trim();
          const name = [first, last].filter(Boolean).join(" ");
          const email = document.getElementById("cpEmail").value.trim();
          const phone = document.getElementById("cpPhone").value.trim();
          const btn = document.getElementById("cpSaveBtn");
          const status = document.getElementById("cpSaveStatus");
          btn.disabled = true;
          btn.textContent = "Saving...";
          fetch("/api/projects/${project.id}/customer", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, email, phone })
          })
          .then(r => r.json())
          .then(() => {
            btn.textContent = "Save changes";
            btn.disabled = false;
            status.textContent = "✓ Saved";
            status.style.opacity = "1";
            setTimeout(() => { status.style.opacity = "0"; }, 2500);
          })
          .catch(() => {
            btn.textContent = "Save changes";
            btn.disabled = false;
            status.textContent = "Failed to save";
            status.style.color = "#dc2626";
            status.style.opacity = "1";
          });
        }
      </script>`;
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

  else if (tab === "notes") {
    const savedNotes = esc(project.notes || "");
    tabContent = `
      <div class="notes-layout">
        <div class="notes-col">
          <h2 class="notes-heading">Notes</h2>
          <div class="notes-editor-wrap">
            <div class="notes-editor" id="notesEditor" contenteditable="true">${savedNotes || ""}</div>
            <div class="notes-toolbar">
              <button type="button" class="nt-btn" title="Bold" onclick="document.execCommand('bold')"><b>B</b></button>
              <button type="button" class="nt-btn" title="Italic" onclick="document.execCommand('italic')"><i>I</i></button>
              <button type="button" class="nt-btn" title="Underline" onclick="document.execCommand('underline')"><u>U</u></button>
              <button type="button" class="nt-btn" title="Strikethrough" onclick="document.execCommand('strikeThrough')"><s>S</s></button>
              <button type="button" class="nt-btn" title="Bullet list" onclick="document.execCommand('insertUnorderedList')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.5" fill="currentColor" stroke="none"/></svg>
              </button>
              <button type="button" class="nt-btn" title="Numbered list" onclick="document.execCommand('insertOrderedList')">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="10" y1="6" x2="20" y2="6"/><line x1="10" y1="12" x2="20" y2="12"/><line x1="10" y1="18" x2="20" y2="18"/><text x="2" y="8" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">1</text><text x="2" y="14" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">2</text><text x="2" y="20" font-size="8" fill="currentColor" stroke="none" font-family="sans-serif">3</text></svg>
              </button>
              <button type="button" class="nt-btn" title="Insert link" onclick="insertNoteLink()">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>
              </button>
            </div>
            <div class="notes-save-status" id="notesSaveStatus"></div>
          </div>
        </div>
        <div class="attach-col">
          <h2 class="notes-heading">Attachments</h2>
          <div class="attach-dropzone" id="attachDropzone"
               onclick="document.getElementById('attachFileInput').click()"
               ondragover="event.preventDefault();this.classList.add('drag-over')"
               ondragleave="this.classList.remove('drag-over')"
               ondrop="event.preventDefault();this.classList.remove('drag-over');handleAttachDrop(event)">
            <svg width="24" height="24" fill="none" stroke="#9ca3af" stroke-width="2" viewBox="0 0 24 24"><path d="M12 19V5m0 0l-5 5m5-5l5 5"/></svg>
            <span class="attach-title">Upload attachments</span>
            <span class="attach-sub">Drag and drop or <span class="attach-browse">browse files</span> on your device</span>
          </div>
          <input type="file" id="attachFileInput" multiple hidden onchange="handleAttachPick(this)"/>
          <div class="attach-list" id="attachList"></div>
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

    /* Rename modal */
    .rename-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.35); z-index:9999; align-items:center; justify-content:center; }
    .rename-overlay.open { display:flex; }
    .rename-modal { background:#fff; border-radius:14px; padding:28px 32px; width:460px; box-shadow:0 20px 60px rgba(0,0,0,0.18); position:relative; }
    .rename-modal-close { position:absolute; top:16px; right:18px; background:none; border:none; font-size:1.3rem; color:#6b7280; cursor:pointer; padding:4px; line-height:1; }
    .rename-modal-close:hover { color:#111; }
    .rename-modal h2 { font-size:1.1rem; font-weight:700; color:#111; margin-bottom:20px; }
    .rename-modal label { display:block; font-size:0.82rem; font-weight:600; color:#111; margin-bottom:6px; }
    .rename-modal input { width:100%; padding:10px 12px; border:1.5px solid #e5e7eb; border-radius:8px; font-size:0.9rem; background:#f9fafb; outline:none; transition:border-color 0.15s; }
    .rename-modal input:focus { border-color:#7c3aed; background:#fff; }
    .rename-modal-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:24px; }
    .rename-modal-actions button { padding:8px 22px; border-radius:8px; font-size:0.88rem; font-weight:600; cursor:pointer; border:none; transition:background 0.15s; }
    .rename-btn-cancel { background:none; color:#374151; }
    .rename-btn-cancel:hover { background:#f3f4f6; }
    .rename-btn-save { background:#e5e7eb; color:#9ca3af; }
    .rename-btn-save.active { background:#7c3aed; color:#fff; }
    .rename-btn-save.active:hover { background:#6d28d9; }

    /* Delete confirmation modal */
    .delete-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.35); z-index:9999; align-items:center; justify-content:center; }
    .delete-overlay.open { display:flex; }
    .delete-modal { background:#fff; border-radius:14px; padding:28px 32px; width:460px; box-shadow:0 20px 60px rgba(0,0,0,0.18); position:relative; }
    .delete-modal-close { position:absolute; top:16px; right:18px; background:none; border:none; font-size:1.3rem; color:#6b7280; cursor:pointer; padding:4px; line-height:1; }
    .delete-modal-close:hover { color:#111; }
    .delete-modal h2 { font-size:1.1rem; font-weight:700; color:#111; margin-bottom:12px; }
    .delete-modal p { font-size:0.9rem; color:#6b7280; line-height:1.5; margin:0; }
    .delete-modal-actions { display:flex; justify-content:flex-end; gap:10px; margin-top:24px; }
    .delete-modal-actions button { padding:8px 22px; border-radius:8px; font-size:0.88rem; font-weight:600; cursor:pointer; border:none; transition:background 0.15s; }
    .delete-btn-cancel { background:none; color:#374151; }
    .delete-btn-cancel:hover { background:#f3f4f6; }
    .delete-btn-confirm { background:#991b1b; color:#fff; }
    .delete-btn-confirm:hover { background:#7f1d1d; }

    /* Assign dropdown */
    .assign-wrap { position: relative; }
    .assign-dropdown {
      display: none; position: absolute; top: calc(100% + 6px); left: 0; z-index: 300;
      background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.12); width: 320px;
      max-height: 420px; overflow: hidden; flex-direction: column;
    }
    .assign-dropdown.open { display: flex; }
    .assign-search-wrap {
      display: flex; align-items: center; gap: 8px;
      padding: 10px 14px; border-bottom: 1px solid #f3f4f6;
    }
    .assign-search {
      border: none; outline: none; font-size: 0.88rem; color: #111;
      flex: 1; background: none;
    }
    .assign-search::placeholder { color: #9ca3af; }
    .assign-count {
      padding: 8px 14px; font-size: 0.75rem; color: #9ca3af;
      border-bottom: 1px solid #f3f4f6;
    }
    .assign-count strong { color: #111; font-weight: 600; }
    .assign-list { overflow-y: auto; max-height: 280px; }
    .assign-user {
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; cursor: pointer; transition: background 0.1s;
    }
    .assign-user:hover { background: #f9fafb; }
    .assign-user-info { display: flex; flex-direction: column; }
    .assign-user-name { font-size: 0.88rem; color: #374151; font-weight: 400; }
    .assign-user.active .assign-user-name { font-weight: 700; color: #111; }
    .assign-user-email { font-size: 0.78rem; color: #9ca3af; margin-top: 1px; }
    .assign-user.active .assign-user-email { color: #7c3aed; }
    .assign-check { color: #7c3aed; font-size: 1.1rem; }
    .assign-unassign {
      display: flex; align-items: center; gap: 8px;
      padding: 12px 14px; border: none; background: none;
      font-size: 0.88rem; color: #374151; cursor: pointer;
      border-top: 1px solid #f3f4f6; width: 100%; text-align: left;
    }
    .assign-unassign:hover { background: #f9fafb; }

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

    .dc-menu {
      display: none; position: absolute; right: 0; top: calc(100% + 4px); z-index: 200;
      background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.1); min-width: 120px; padding: 4px 0;
    }
    .dc-menu.open { display: block; }
    .dc-menu button {
      display: block; width: 100%; text-align: left; padding: 8px 14px;
      border: none; background: none; font-size: 0.85rem; color: #374151; cursor: pointer;
    }
    .dc-menu button:hover { background: #f9fafb; }

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

    /* ── Energy bar chart ── */
    .energy-chart-section { margin-top: 8px; }
    .energy-chart-section canvas { width: 100%; height: auto; }
    .echart-legend { display: flex; gap: 24px; justify-content: center; margin-top: 12px; font-size: 0.8rem; color: #6b7280; }
    .echart-legend-item { display: flex; align-items: center; gap: 6px; }
    .echart-swatch { width: 14px; height: 14px; border-radius: 2px; display: inline-block; }
    .echart-swatch-est { background: repeating-linear-gradient(-45deg, #e8743b, #e8743b 2px, #f4a87a 2px, #f4a87a 4px); }

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
    .db-dropdown {
      display: none; position: absolute; right: 0; top: 100%; z-index: 50;
      background: #fff; border: 1px solid #e5e7eb; border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.12); min-width: 160px; padding: 4px 0;
    }
    .db-dropdown.open { display: block; }
    .db-dropdown button {
      display: flex; align-items: center; gap: 8px; width: 100%;
      padding: 8px 14px; border: none; background: none; cursor: pointer;
      font-size: 0.85rem; color: #374151; text-align: left;
    }
    .db-dropdown button:hover { background: #f3f4f6; }
    .db-dropdown-danger { color: #dc2626 !important; }
    .db-dropdown-danger:hover { background: #fef2f2 !important; }

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
      flex: 1; background: #e5e7eb; overflow: hidden; min-height: 100%;
    }
    .cp-map img { display: block; width: 100%; height: 100%; object-fit: cover; }
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

    /* ── Notes tab ── */
    .notes-layout { display: flex; gap: 48px; padding: 32px 40px; }
    .notes-col { flex: 1.2; min-width: 0; }
    .attach-col { flex: 0.8; min-width: 0; }
    .notes-heading { font-size: 1.35rem; font-weight: 600; color: #111; margin-bottom: 18px; }
    .notes-editor-wrap { background: #f5f5f5; border-radius: 10px; overflow: hidden; }
    .notes-editor {
      min-height: 180px; padding: 18px 20px; font-size: 0.9rem; color: #111;
      outline: none; line-height: 1.65; word-wrap: break-word;
    }
    .notes-editor:empty::before {
      content: "Start typing..."; color: #bbb; pointer-events: none;
    }
    .notes-toolbar {
      display: flex; align-items: center; gap: 2px; padding: 8px 12px;
      border-top: 1px solid #e5e5e5; background: #f5f5f5;
    }
    .nt-btn {
      width: 32px; height: 32px; display: flex; align-items: center; justify-content: center;
      background: none; border: none; border-radius: 5px; cursor: pointer;
      color: #555; font-size: 0.88rem; transition: background 0.15s;
    }
    .nt-btn:hover { background: #e8e8e8; color: #111; }
    .notes-save-status {
      padding: 6px 14px; font-size: 0.78rem; color: #9ca3af;
      display: flex; align-items: center; gap: 5px;
    }
    .notes-save-status.saved::before { content: "\\2713"; color: #22c55e; }

    .attach-dropzone {
      border: 2px dashed #d1d5db; border-radius: 12px; padding: 48px 32px;
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      cursor: pointer; transition: background 0.15s, border-color 0.15s;
      text-align: center;
    }
    .attach-dropzone:hover { background: #f9fafb; }
    .attach-dropzone.drag-over { background: #f0f4ff; border-color: #6b7280; }
    .attach-title { font-size: 1.05rem; font-weight: 600; color: #111; display: flex; align-items: center; gap: 8px; }
    .attach-sub { font-size: 0.82rem; color: #9ca3af; }
    .attach-browse { color: #3b82f6; cursor: pointer; }
    .attach-browse:hover { text-decoration: underline; }
    .attach-list { margin-top: 14px; display: flex; flex-direction: column; gap: 8px; }
    .attach-file {
      display: flex; align-items: center; justify-content: space-between;
      background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px;
      padding: 10px 14px; font-size: 0.82rem; color: #333;
    }
    .attach-file-name { display: flex; align-items: center; gap: 8px; }
    .attach-remove {
      background: none; border: none; color: #9ca3af; cursor: pointer;
      font-size: 1rem; padding: 0 4px; transition: color 0.15s;
    }
    .attach-remove:hover { color: #ef4444; }
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
    <div class="progress-wrap">
      <div class="progress-bar"><div class="progress-fill"></div></div>
      <span class="progress-text">1 / 6</span>
    </div>
    <button class="sh-dropdown">
      Remote Assessment Completed
      <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    <div class="assign-wrap" id="assignWrap">
      <button class="sh-dropdown" id="assignBtn" onclick="event.stopPropagation(); toggleAssignDropdown()">
        ${assigneeName ? `<div class="assignee-dot">${assigneeInitials}</div> ${esc(assigneeName)}` : '<span style="color:#9ca3af">Unassigned</span>'}
        <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="assign-dropdown" id="assignDropdown">
        <div class="assign-search-wrap">
          <svg width="14" height="14" fill="none" stroke="#9ca3af" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" class="assign-search" id="assignSearch" placeholder="Search" oninput="filterAssignUsers()" onclick="event.stopPropagation()"/>
        </div>
        <div class="assign-count" id="assignCount"></div>
        <div class="assign-list" id="assignList"></div>
        <button class="assign-unassign" onclick="selectAssignee('')">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          Unassign
        </button>
      </div>
    </div>
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
      <button class="mode-btn mode-btn-outline" onclick="location.href='${salesUrl}'">
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
          <div class="sidebar-customer-name">${project.projectName || 'Untitled'}</div>
          <div class="sidebar-customer-sub">${project.address ? project.address.split(',')[0] : ''}</div>
        </div>
        <div class="sidebar-more-wrap">
          <button class="sidebar-more" onclick="event.stopPropagation(); toggleSidebarMenu()">···</button>
          <div class="sidebar-more-menu" id="sidebarMoreMenu">
            <button class="menu-item" onclick="sidebarRename()">Rename</button>
            <button class="menu-item" onclick="sidebarAssign()">Assign to team</button>
            <div class="menu-divider"></div>
            <button class="menu-item danger" onclick="sidebarDelete()">Delete</button>
            <button class="menu-item" onclick="sidebarArchive()">Archive</button>
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
    var PROJECT_ID = "${project.id}";

    /* ── Create new design from dashboard ── */
    function createNewDesignFromDashboard() {
      fetch('/api/projects/' + PROJECT_ID + '/designs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      }).then(function(r) { return r.json(); }).then(function(design) {
        var designUrl = '/design?lat=${project.lat}&lng=${project.lng}&address=${encodeURIComponent(project.address)}&projectId=${project.id}&designId=' + design.id;
        location.href = designUrl;
      });
    }

    /* ── Design dropdown actions ── */
    function toggleDesignDropdown(designId) {
      document.querySelectorAll('.db-dropdown.open').forEach(function(m) { if (m.id !== 'dd-' + designId) m.classList.remove('open'); });
      document.getElementById('dd-' + designId).classList.toggle('open');
    }
    document.addEventListener('click', function() { document.querySelectorAll('.db-dropdown.open').forEach(function(m) { m.classList.remove('open'); }); });

    function renameDesignFromDash(projectId, designId) {
      document.querySelectorAll('.db-dropdown.open').forEach(function(m) { m.classList.remove('open'); });
      var row = document.querySelector('[data-design-id="' + designId + '"]') || document.getElementById('dd-' + designId).closest('tr');
      var nameCell = row.querySelector('.db-td-name');
      var current = nameCell.textContent.trim();
      var newName = prompt('Rename design:', current);
      if (!newName || newName === current) return;
      fetch('/api/projects/' + projectId + '/designs/' + designId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      }).then(function(r) { return r.json(); }).then(function(data) {
        if (data.ok) nameCell.textContent = newName;
      });
    }

    function duplicateDesignFromDash(projectId, designId) {
      document.querySelectorAll('.db-dropdown.open').forEach(function(m) { m.classList.remove('open'); });
      fetch('/api/projects/' + projectId + '/designs/' + designId + '/duplicate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      }).then(function(r) { return r.json(); }).then(function() {
        location.reload();
      });
    }

    function deleteDesignFromDash(projectId, designId, name) {
      document.querySelectorAll('.db-dropdown.open').forEach(function(m) { m.classList.remove('open'); });
      if (!confirm('Delete "' + name + '"? This cannot be undone.')) return;
      fetch('/api/projects/' + projectId + '/designs/' + designId, {
        method: 'DELETE'
      }).then(function(r) { return r.json(); }).then(function(data) {
        if (data.ok) location.reload();
        else alert(data.error || 'Could not delete design');
      });
    }

    /* ── Energy usage save/load ── */
    function getMonthlyValues() {
      var inputs = document.querySelectorAll('.month-input');
      var vals = [];
      inputs.forEach(function(inp) { vals.push(parseFloat(inp.value) || 0); });
      return vals;
    }

    function saveEnergyUsage() {
      var vals = getMonthlyValues();
      var annual = vals.reduce(function(a,b){ return a+b; }, 0);
      var avg = annual / 12;
      var v1 = document.getElementById('estatVal1');
      var v2 = document.getElementById('estatVal2');
      if (v1) v1.innerHTML = annual > 0 ? annual.toLocaleString() + ' <span class="estat-unit">kWh</span>' : '\\u2014';
      if (v2) v2.innerHTML = avg > 0 ? Math.round(avg).toLocaleString() + ' <span class="estat-unit">kWh</span>' : '\\u2014';

      drawEnergyBar(vals);

      fetch('/api/projects/' + PROJECT_ID + '/energy', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ energyUsage: vals })
      });
    }

    /* ── Energy bar chart ── */
    function drawEnergyBar(vals) {
      var section = document.getElementById('energyChartSection');
      var canvas = document.getElementById('energyBarChart');
      if (!section || !canvas) return;
      var hasData = vals.some(function(v) { return v > 0; });
      section.style.display = hasData ? '' : 'none';
      if (!hasData) return;

      var ctx = canvas.getContext('2d');
      var dpr = window.devicePixelRatio || 1;
      var W = 900, H = 320;
      canvas.width = W * dpr; canvas.height = H * dpr;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, W, H);

      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var maxVal = Math.max.apply(null, vals);
      // Round up to nice grid
      var gridStep = maxVal <= 500 ? 100 : maxVal <= 2000 ? 200 : maxVal <= 5000 ? 500 : 1000;
      var gridMax = Math.ceil(maxVal * 1.1 / gridStep) * gridStep;
      if (gridMax === 0) gridMax = 100;
      var gridLines = Math.round(gridMax / gridStep);

      var pad = { top: 16, right: 20, bottom: 36, left: 70 };
      var chartW = W - pad.left - pad.right;
      var chartH = H - pad.top - pad.bottom;

      // Grid lines + y-axis labels
      ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
      for (var g = 0; g <= gridLines; g++) {
        var val = gridStep * g;
        var y = pad.top + chartH - (val / gridMax) * chartH;
        ctx.strokeStyle = '#e5e7eb'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
        ctx.fillStyle = '#9ca3af'; ctx.font = '11px -apple-system, sans-serif';
        ctx.fillText(val.toLocaleString() + ' kWh', pad.left - 8, y);
      }

      // Bars
      var barGroupW = chartW / 12;
      var barW = barGroupW * 0.5;
      var entered = vals.filter(function(v) { return v > 0; }).length;
      var isEstimate = entered > 0 && entered < 12;

      for (var i = 0; i < 12; i++) {
        var cx = pad.left + barGroupW * i + barGroupW / 2;
        var v = vals[i];
        if (v <= 0) continue;
        var bh = (v / gridMax) * chartH;
        var bx = cx - barW / 2;
        var by = pad.top + chartH - bh;

        // Solid bar
        ctx.fillStyle = '#e8743b';
        ctx.beginPath();
        barRect(ctx, bx, by, barW, bh, 3);
        ctx.fill();

        // Diagonal hatch overlay for estimated months
        if (isEstimate) {
          ctx.save();
          ctx.beginPath();
          barRect(ctx, bx, by, barW, bh, 3);
          ctx.clip();
          ctx.strokeStyle = 'rgba(255,255,255,0.35)';
          ctx.lineWidth = 1.5;
          for (var d = -bh - barW; d < barW + bh; d += 6) {
            ctx.beginPath();
            ctx.moveTo(bx + d, by + bh);
            ctx.lineTo(bx + d + bh, by);
            ctx.stroke();
          }
          ctx.restore();
        }

        // Month label
        ctx.fillStyle = '#6b7280'; ctx.font = '12px -apple-system, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(months[i], cx, H - pad.bottom + 18);
      }
    }

    function barRect(ctx, x, y, w, h, r) {
      if (h < r * 2) r = h / 2;
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.lineTo(x + w, y + h); ctx.lineTo(x, y + h);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    /* ── Annual estimate → distribute evenly and update ── */
    var annualInput = document.querySelector('.annual-input');
    if (annualInput) {
      annualInput.addEventListener('input', function() {
        var total = parseFloat(this.value) || 0;
        // Distribute with seasonal variation (winter higher, summer lower)
        var weights = [1.27,1.09,1.09,0.99,0.92,0.80,0.94,0.93,0.85,0.95,0.99,1.18];
        var wSum = weights.reduce(function(a,b){return a+b;},0);
        var inputs = document.querySelectorAll('.month-input');
        inputs.forEach(function(inp, i) {
          inp.value = Math.round(total * weights[i] / wSum);
        });
        saveEnergyUsage();
      });
    }

    function loadEnergyUsage() {
      fetch('/api/projects/' + PROJECT_ID + '/energy')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.energyUsage && data.energyUsage.length) {
            var inputs = document.querySelectorAll('.month-input');
            data.energyUsage.forEach(function(val, i) {
              if (inputs[i] && val > 0) inputs[i].value = val;
            });
            saveEnergyUsage();
          }
        });
    }

    document.querySelectorAll('.month-input').forEach(function(inp) {
      inp.addEventListener('input', saveEnergyUsage);
    });
    loadEnergyUsage();

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
    function toggleDesignMenu(designId) {
      document.querySelectorAll('.dc-menu.open').forEach(function(m) { if (m.id !== 'dmenu-' + designId) m.classList.remove('open'); });
      document.getElementById('dmenu-' + designId).classList.toggle('open');
    }
    function renameDesign(projectId, designId) {
      document.querySelectorAll('.dc-menu.open').forEach(function(m) { m.classList.remove('open'); });
      var el = document.getElementById('dname-' + designId);
      var current = el.textContent.trim();
      var newName = prompt('Rename design:', current);
      if (!newName || newName === current) return;
      fetch('/api/projects/' + projectId + '/designs/' + designId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName })
      }).then(function(r) { return r.json(); }).then(function(data) {
        if (data.ok) el.textContent = newName;
      });
    }
    document.addEventListener('click', function() { document.querySelectorAll('.dc-menu.open').forEach(function(m) { m.classList.remove('open'); }); });
    var sidebarRenameOriginal = '';
    function sidebarRename() {
      sidebarRenameOriginal = document.querySelector('.sidebar-customer-name').textContent.trim();
      var input = document.getElementById('renameInput');
      input.value = sidebarRenameOriginal;
      updateRenameSave();
      document.getElementById('renameOverlay').classList.add('open');
      setTimeout(function(){ input.focus(); input.select(); }, 50);
    }
    function closeRenameModal() {
      document.getElementById('renameOverlay').classList.remove('open');
    }
    function updateRenameSave() {
      var btn = document.getElementById('renameSaveBtn');
      var val = document.getElementById('renameInput').value.trim();
      if (val && val !== sidebarRenameOriginal) { btn.classList.add('active'); }
      else { btn.classList.remove('active'); }
    }
    function submitRename() {
      var val = document.getElementById('renameInput').value.trim();
      if (!val || val === sidebarRenameOriginal) return;
      fetch('/api/projects/${project.id}/rename', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: val })
      }).then(function(r) { if (r.ok) location.reload(); });
    }
    function sidebarAssign() {
      document.getElementById('sidebarMoreMenu').classList.remove('open');
      toggleAssignDropdown();
    }

    /* ── Assign dropdown ── */
    var ALL_USERS = ${JSON.stringify(allUsers)};
    var CURRENT_ASSIGNEE = ${JSON.stringify(assigneeName)};
    var ORG_NAME = ${JSON.stringify(project.organization || 'Internal')};

    function toggleAssignDropdown() {
      var dd = document.getElementById('assignDropdown');
      var wasOpen = dd.classList.contains('open');
      // close other dropdowns
      document.getElementById('dmDropdown').classList.remove('open');
      if (wasOpen) { dd.classList.remove('open'); return; }
      dd.classList.add('open');
      document.getElementById('assignSearch').value = '';
      filterAssignUsers();
      setTimeout(function(){ document.getElementById('assignSearch').focus(); }, 50);
    }
    function filterAssignUsers() {
      var q = document.getElementById('assignSearch').value.trim().toLowerCase();
      var filtered = ALL_USERS.filter(function(u) {
        var full = (u.firstName + ' ' + u.lastName + ' ' + u.email).toLowerCase();
        return !q || full.indexOf(q) !== -1;
      });
      var list = document.getElementById('assignList');
      var shown = Math.min(filtered.length, 10);
      document.getElementById('assignCount').innerHTML = 'Displaying ' + shown + ' of ' + ALL_USERS.length + ' users in <strong>' + ORG_NAME + '</strong>';
      list.innerHTML = filtered.slice(0, 10).map(function(u) {
        var fullName = u.firstName + ' ' + u.lastName;
        var isActive = fullName === CURRENT_ASSIGNEE;
        return '<div class="assign-user' + (isActive ? ' active' : '') + '" onclick="selectAssignee(\\'' + fullName.replace(/'/g, "\\\\'") + '\\')">' +
          '<div class="assign-user-info">' +
            '<div class="assign-user-name">' + fullName + '</div>' +
            (u.email ? '<div class="assign-user-email">' + u.email + '</div>' : '') +
          '</div>' +
          (isActive ? '<span class="assign-check">✓</span>' : '') +
        '</div>';
      }).join('');
    }
    function selectAssignee(name) {
      document.getElementById('assignDropdown').classList.remove('open');
      fetch('/api/projects/${project.id}/reassign', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assignee: name })
      }).then(function(r) { if (r.ok) location.reload(); });
    }

    function sidebarDelete() {
      document.getElementById('sidebarMoreMenu').classList.remove('open');
      document.getElementById('deleteOverlay').classList.add('open');
    }
    function closeDeleteModal() {
      document.getElementById('deleteOverlay').classList.remove('open');
    }
    function confirmDelete() {
      fetch('/api/projects/${project.id}', {
        method: 'DELETE'
      }).then(function(r) { if (r.ok) window.location.href = '/crm'; });
    }
    function sidebarArchive() {
      fetch('/api/projects/${project.id}/archive', {
        method: 'PATCH'
      }).then(function(r) { if (r.ok) window.location.href = '/crm'; });
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
      var assignWrap = document.getElementById('assignWrap');
      if (assignWrap && !assignWrap.contains(e.target)) {
        document.getElementById('assignDropdown').classList.remove('open');
      }
    });

    /* ── Notes auto-save ── */
    (function() {
      var editor = document.getElementById('notesEditor');
      var status = document.getElementById('notesSaveStatus');
      if (!editor || !status) return;
      var saveTimer = null;
      var projectId = '${project.id}';

      function saveNotes() {
        var html = editor.innerHTML;
        status.className = 'notes-save-status';
        status.textContent = 'Saving...';
        fetch('/api/projects/' + projectId + '/notes', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ notes: html })
        }).then(function(r) { return r.json(); }).then(function() {
          status.className = 'notes-save-status saved';
          status.textContent = ' Saved';
        }).catch(function() {
          status.className = 'notes-save-status';
          status.textContent = 'Save failed';
          status.style.color = '#ef4444';
        });
      }

      editor.addEventListener('input', function() {
        clearTimeout(saveTimer);
        status.className = 'notes-save-status';
        status.textContent = '';
        saveTimer = setTimeout(saveNotes, 800);
      });

      // show Saved on load if content exists
      if (editor.textContent.trim()) {
        status.className = 'notes-save-status saved';
        status.textContent = ' Saved';
      }
    })();

    /* ── Insert link in notes ── */
    function insertNoteLink() {
      var url = prompt('Enter URL:');
      if (url) document.execCommand('createLink', false, url);
    }

    /* ── Attachments (visual) ── */
    var attachFiles = [];
    function renderAttachList() {
      var list = document.getElementById('attachList');
      if (!list) return;
      list.innerHTML = attachFiles.map(function(f, i) {
        return '<div class="attach-file"><span class="attach-file-name"><svg width="14" height="14" fill="none" stroke="#6b7280" stroke-width="2" viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>' + f + '</span><button class="attach-remove" onclick="removeAttach(' + i + ')">&times;</button></div>';
      }).join('');
    }
    function addAttachFiles(fileList) {
      for (var i = 0; i < fileList.length; i++) {
        attachFiles.push(fileList[i].name);
      }
      renderAttachList();
    }
    function removeAttach(idx) {
      attachFiles.splice(idx, 1);
      renderAttachList();
    }
    function handleAttachDrop(e) {
      if (e.dataTransfer && e.dataTransfer.files) addAttachFiles(e.dataTransfer.files);
    }
    function handleAttachPick(input) {
      if (input.files) addAttachFiles(input.files);
      input.value = '';
    }
  </script>

  <!-- Rename modal -->
  <div class="rename-overlay" id="renameOverlay" onclick="if(event.target===this)closeRenameModal()">
    <div class="rename-modal">
      <button class="rename-modal-close" onclick="closeRenameModal()">&times;</button>
      <h2>Edit name</h2>
      <label>Project name</label>
      <input type="text" id="renameInput" oninput="updateRenameSave()" onkeydown="if(event.key==='Enter')submitRename();if(event.key==='Escape')closeRenameModal();"/>
      <div class="rename-modal-actions">
        <button class="rename-btn-cancel" onclick="closeRenameModal()">Cancel</button>
        <button class="rename-btn-save" id="renameSaveBtn" onclick="submitRename()">Save</button>
      </div>
    </div>
  </div>

  <div class="delete-overlay" id="deleteOverlay" onclick="if(event.target===this)closeDeleteModal()">
    <div class="delete-modal">
      <button class="delete-modal-close" onclick="closeDeleteModal()">&times;</button>
      <h2>Delete project</h2>
      <p>Are you sure you want to permanently delete your selected project? This action is irreversible.</p>
      <div class="delete-modal-actions">
        <button class="delete-btn-cancel" onclick="closeDeleteModal()">Cancel</button>
        <button class="delete-btn-confirm" onclick="confirmDelete()">Delete</button>
      </div>
    </div>
  </div>

</body>
</html>`);
});

// ── Design / Pin screen ────────────────────────────────────────────────────────
app.get("/design", (req, res) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  const { lat, lng, address, customer, projectId } = req.query;
  if (!lat || !lng) return res.redirect("/");
  const safeAddress = (address || "Selected Location").replace(/`/g, "'").replace(/</g, "&lt;");
  // Load energy usage and designs from project if available
  let energyUsage = [];
  let designs = [];
  let activeDesignId = "";
  let designIdx = 0;
  if (projectId) {
    const projects = loadProjects();
    const proj = projects.find(p => p.id === projectId);
    if (proj) {
      if (proj.energyUsage) energyUsage = proj.energyUsage;
      ensureDesigns(proj);
      designs = proj.designs;
      activeDesignId = req.query.designId || proj.activeDesignId;
      designIdx = designs.findIndex(d => d.id === activeDesignId);
      if (designIdx < 0) designIdx = 0;
      activeDesignId = designs[designIdx].id;
      saveProjects(projects);
    }
  }
  let hasCalibration = false;
  if (projectId) {
    const projects2 = loadProjects();
    const proj2 = projects2.find(p => p.id === projectId);
    if (proj2 && proj2.calibration && proj2.calibration.tx !== undefined) hasCalibration = true;
  }
  const hasUsageData = energyUsage.length > 0 && energyUsage.some(v => v > 0);
  const annualUsage = energyUsage.reduce((a, b) => a + b, 0);
  const production = [220,280,870,1010,1060,1200,1250,1220,880,490,220,120];
  const annualProduction = production.reduce((a, b) => a + b, 0);
  const energyOffset = hasUsageData ? Math.round((annualProduction / annualUsage) * 100) : 0;
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
      height: 42px;
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
    .tb-design-wrap { position: relative; }
    .tb-design-dropdown {
      display: none; position: absolute; top: calc(100% + 6px); left: 0; min-width: 260px;
      background: #fff; border: 1px solid #e0e0e0; border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.12); z-index: 999; padding: 6px 0;
    }
    .tb-design-dropdown.open { display: block; }
    .tb-dd-item {
      display: flex; flex-wrap: wrap; align-items: center; padding: 10px 16px; cursor: pointer;
      position: relative; transition: background 0.12s;
    }
    .tb-dd-item:hover { background: #f5f5f5; }
    .tb-dd-item.active { background: #faf5ff; }
    .tb-dd-name { font-size: 0.85rem; font-weight: 600; color: #111; width: 100%; }
    .tb-dd-meta { font-size: 0.75rem; color: #888; margin-top: 2px; }
    .tb-dd-check { position: absolute; right: 14px; top: 50%; transform: translateY(-50%); }
    .tb-dd-divider { height: 1px; background: #e5e7eb; margin: 4px 0; }
    .tb-dd-create {
      display: block; width: 100%; text-align: left; padding: 10px 16px; border: none; background: none;
      font-size: 0.84rem; font-weight: 500; color: #333; cursor: pointer;
    }
    .tb-dd-create:hover { background: #f5f5f5; }
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
      position: fixed;
      background: #fff;
      border-radius: 10px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.16), 0 1px 4px rgba(0,0,0,0.08);
      min-width: 220px;
      z-index: 9999;
      overflow: hidden;
      padding: 4px 0;
    }
    .lp-submenu.flyout-visible { display: block; }
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
      overflow: hidden;
    }
    /* Ensure overlays sit above the 3D scene */
    .draw-toolbar, .lp-toggle-float { z-index: 10; }
    .map-bottom { z-index: 20; }

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
    .map-controls-bl {
      position: absolute;
      bottom: 50px;
      right: 14px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      pointer-events: all;
      z-index: 35;
    }
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
    /* ── Roof Edit Banner ── */
    #roofEditBanner {
      display: none;
      position: absolute;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 41;
      background: #f59e0b;
      color: #000;
      border-radius: 10px;
      font-size: 0.85rem;
      font-weight: 600;
      box-shadow: 0 4px 16px rgba(0,0,0,0.25);
      pointer-events: all;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      padding: 8px 18px 6px;
      min-width: 320px;
    }
    #roofEditBanner .reb-title-row {
      display: flex;
      align-items: center;
      width: 100%;
      justify-content: center;
      position: relative;
      font-size: 0.95rem;
      font-weight: 700;
    }
    #roofEditBanner .reb-close {
      position: absolute;
      right: 0;
      top: 0;
      background: none;
      border: none;
      cursor: pointer;
      color: #000;
      font-size: 1rem;
      padding: 0 2px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #roofEditBanner .reb-close span {
      font-size: 0.65rem;
      font-weight: 600;
      opacity: 0.7;
    }
    #roofEditBanner .reb-tools {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 2px 0;
    }
    #roofEditBanner .reb-tools-label {
      font-size: 0.8rem;
      font-weight: 600;
      opacity: 0.8;
    }
    #roofEditBanner .reb-dormer-btn {
      background: none;
      border: 1.5px solid transparent;
      border-radius: 6px;
      cursor: pointer;
      padding: 3px 5px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s, border-color 0.15s;
    }
    #roofEditBanner .reb-dormer-btn:hover {
      background: rgba(0,0,0,0.1);
      border-color: rgba(0,0,0,0.2);
    }
    #roofEditBanner .reb-dormer-btn.active {
      background: rgba(0,0,0,0.18);
      border-color: rgba(0,0,0,0.4);
    }

    /* ── ViewCube ── */
    .viewcube-wrap {
      position: relative;
      width: 90px;
      height: 90px;
      perspective: 300px;
      cursor: grab;
      user-select: none;
    }
    .viewcube-wrap:active { cursor: grabbing; }
    .viewcube-ring {
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 2px solid rgba(180,180,180,0.5);
      pointer-events: none;
    }
    .vc-north-tick {
      position: absolute;
      top: -4px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 6px solid transparent;
      border-right: 6px solid transparent;
      border-top: 10px solid #e53935;
      filter: drop-shadow(0 0 2px rgba(0,0,0,0.4));
      pointer-events: all;
      cursor: pointer;
      padding: 4px;
    }
    .viewcube-compass {
      position: absolute;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    .viewcube-compass span {
      position: absolute;
      font-size: 0.55rem;
      font-weight: 700;
      color: #888;
    }
    .vc-n { top: 2px; left: 50%; transform: translateX(-50%); }
    .vc-s { bottom: 2px; left: 50%; transform: translateX(-50%); }
    .vc-e { right: 4px; top: 50%; transform: translateY(-50%); }
    .vc-w { left: 4px; top: 50%; transform: translateY(-50%); }
    .viewcube-scene {
      width: 50px;
      height: 50px;
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      perspective: 200px;
      pointer-events: all;
    }
    .viewcube {
      width: 50px;
      height: 50px;
      position: relative;
      transform-style: preserve-3d;
      pointer-events: all;
    }
    .vc-face {
      position: absolute;
      width: 50px;
      height: 50px;
      background: rgba(255,255,255,0.92);
      border: 1.5px solid #ccc;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.6rem;
      font-weight: 700;
      color: #555;
      backface-visibility: visible;
      pointer-events: all;
    }
    .vc-face:hover { background: rgba(180,180,180,0.85); cursor: pointer; }
    .vc-face.vc-top { transform: rotateX(90deg) translateZ(25px); background: rgba(245,245,245,0.95); }
    .vc-face.vc-bottom { transform: rotateX(-90deg) translateZ(25px); }
    .vc-face.vc-front { transform: translateZ(25px); }
    .vc-face.vc-back { transform: rotateY(180deg) translateZ(25px); }
    .vc-face.vc-left { transform: rotateY(-90deg) translateZ(25px); }
    .vc-face.vc-right { transform: rotateY(90deg) translateZ(25px); }
    .vc-north-arrow {
      position: absolute;
      top: 6px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-bottom: 10px solid #e53935;
      pointer-events: none;
      z-index: 2;
    }
    .tilt-slider-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    .tilt-slider {
      -webkit-appearance: none;
      appearance: none;
      width: 80px;
      height: 4px;
      background: #ddd;
      border-radius: 2px;
      outline: none;
      transform: rotate(-90deg);
      transform-origin: center;
      margin: 30px 0;
    }
    .tilt-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 14px;
      height: 14px;
      background: #fff;
      border: 2px solid #aaa;
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(0,0,0,0.2);
    }
    .tilt-label {
      font-size: 0.6rem;
      color: #888;
      font-weight: 600;
    }
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

    /* ── EDGE & FACE SIDE PANEL (Aurora-style) ── */
    .ef-panel {
      width: 280px;
      background: #fff;
      border-radius: 10px 0 0 10px;
      box-shadow: -4px 0 16px rgba(0,0,0,0.12);
      display: flex;
      flex-direction: column;
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 35;
      color: #111;
      overflow-y: auto;
      overflow-x: hidden;
      transition: opacity 0.2s, transform 0.2s;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .ef-panel.hidden {
      opacity: 0;
      pointer-events: none;
      transform: translateX(12px);
    }
    .ef-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 16px 12px;
      border-bottom: 1px solid #e8e8e8;
    }
    .ef-header h3 { font-size: 0.95rem; font-weight: 600; margin: 0; color: #111; }
    .ef-delete-btn {
      background: none; border: none; cursor: pointer; color: #999; padding: 4px; border-radius: 4px;
    }
    .ef-delete-btn:hover { color: #dc2626; background: #fef2f2; }
    .ef-section { padding: 14px 16px; border-bottom: 1px solid #f0f0f0; }
    .ef-section:last-child { border-bottom: none; }
    .ef-section-title { font-size: 0.78rem; font-weight: 700; color: #333; margin-bottom: 12px; }
    .ef-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .ef-row:last-child { margin-bottom: 0; }
    .ef-label { font-size: 0.82rem; color: #555; }
    .ef-value { font-size: 0.82rem; color: #111; font-weight: 500; }
    .ef-input {
      width: 72px; padding: 5px 8px; border: 1px solid #ddd; border-radius: 6px;
      font-size: 0.82rem; text-align: right; color: #111; background: #fff; outline: none;
    }
    .ef-input:focus { border-color: #4a90e2; }
    .ef-unit { font-size: 0.75rem; color: #999; margin-left: 4px; min-width: 16px; }
    .ef-checkbox-row { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
    .ef-checkbox-row label { font-size: 0.78rem; color: #777; cursor: pointer; }
    .ef-section-label { font-size: 0.72rem; color: #00bfa5; font-weight: 600; margin-bottom: 8px; }

    /* ── SMARTROOF SIDE PANEL ── */
    .sr-panel {
      width: 300px;
      background: #fff;
      border-radius: 10px 0 0 10px;
      box-shadow: -4px 0 16px rgba(0,0,0,0.12);
      display: flex;
      flex-direction: column;
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      z-index: 36;
      color: #111;
      overflow-y: auto;
      overflow-x: hidden;
      transition: opacity 0.2s, transform 0.2s;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .sr-panel.hidden {
      opacity: 0;
      pointer-events: none;
      transform: translateX(12px);
    }
    .sr-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 16px 12px;
      border-bottom: 1px solid #e8e8e8;
    }
    .sr-header h3 { font-size: 0.95rem; font-weight: 600; margin: 0; color: #111; }
    .sr-header-icons { display: flex; gap: 4px; }
    .sr-header-icons button {
      background: none; border: none; cursor: pointer; color: #666; padding: 4px; border-radius: 4px;
    }
    .sr-header-icons button:hover { color: #111; background: #f5f5f5; }
    .sr-section { padding: 14px 16px; border-bottom: 1px solid #f0f0f0; }
    .sr-section:last-child { border-bottom: none; }
    .sr-btn {
      width: 100%; padding: 10px; background: #fff; color: #111;
      border: 1px solid #ddd; border-radius: 6px; font-size: 0.85rem;
      font-weight: 500; cursor: pointer; text-align: center;
    }
    .sr-btn:hover { background: #f5f5f5; }
    .sr-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
    .sr-row:last-child { margin-bottom: 0; }
    .sr-label { font-size: 0.85rem; color: #555; }
    .sr-value { font-size: 0.85rem; color: #111; font-weight: 500; }
    .sr-input {
      width: 80px; padding: 6px 8px; border: 1px solid #ddd; border-radius: 6px;
      font-size: 0.85rem; text-align: right; color: #111; background: #fafafa; outline: none;
    }
    .sr-input:focus { border-color: #4a90e2; }
    .sr-unit { font-size: 0.75rem; color: #999; margin-left: 4px; }
    .sr-prop-title {
      display: flex; justify-content: space-between; align-items: center;
      margin-bottom: 12px;
    }
    .sr-prop-title span { font-size: 0.88rem; font-weight: 600; color: #222; }
    .sr-prop-title button {
      background: none; border: none; cursor: pointer; color: #999; padding: 2px;
    }
    .sr-prop-row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; }
    .sr-prop-label { font-size: 0.82rem; color: #666; }
    .sr-prop-value { font-size: 0.82rem; color: #999; }
    .sr-type-btn {
      padding: 6px 10px; border: 1px solid #ddd; border-radius: 6px; cursor: pointer;
      background: #fff; color: #666; font-size: 0.85rem;
    }
    .sr-type-btn.active { border-color: #111; background: #333; color: #fff; }

    /* ── TREE PROPERTIES PANEL ── */
    .tree-panel {
      width: 300px;
      background: #fff;
      border-radius: 10px 0 0 10px;
      box-shadow: -4px 0 16px rgba(0,0,0,0.10);
      display: flex;
      flex-direction: column;
      position: absolute;
      top: 0; right: 0; bottom: 0;
      z-index: 35;
      color: #111;
      overflow-y: auto;
      transition: opacity 0.2s, transform 0.2s;
      border-left: 3px solid #22c55e;
    }
    .tree-panel.hidden {
      opacity: 0;
      pointer-events: none;
      transform: translateX(12px);
    }
    .tp-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px 10px;
      border-bottom: 1px solid #f0f0f0;
    }
    .tp-title { font-size: 0.95rem; font-weight: 600; }
    .tp-actions { display: flex; gap: 6px; }
    .tp-action-btn {
      background: none; border: none; cursor: pointer;
      color: #888; padding: 4px; border-radius: 5px;
    }
    .tp-action-btn:hover { background: #f0f0f0; color: #333; }
    .tp-body { padding: 12px 16px; }
    .tp-fit-btn {
      width: 100%;
      padding: 10px;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      background: #fff;
      font-size: 0.85rem;
      font-weight: 500;
      cursor: pointer;
      margin-bottom: 16px;
      color: #111;
    }
    .tp-fit-btn:hover { background: #f9fafb; }
    .tp-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 0;
      border-top: 1px solid #f5f5f5;
    }
    .tp-row:first-child { border-top: none; }
    .tp-label { font-size: 0.83rem; color: #555; }
    .tp-input-wrap {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .tp-input {
      width: 70px;
      padding: 7px 8px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      font-size: 0.85rem;
      text-align: right;
      color: #111;
      background: #f9fafb;
      outline: none;
    }
    .tp-input:focus { border-color: #9ca3af; background: #fff; }
    .tp-unit { font-size: 0.78rem; color: #999; }
    .tp-type-toggle {
      display: flex; gap: 2px;
      background: #f3f4f6;
      border-radius: 6px;
      padding: 2px;
    }
    .tp-type-btn {
      padding: 5px 8px;
      border: none; border-radius: 5px;
      background: none; cursor: pointer;
      color: #888; display: flex; align-items: center; justify-content: center;
    }
    .tp-type-btn.active { background: #111; color: #fff; }
    .tp-toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 0;
      border-top: 1px solid #f5f5f5;
    }
    .tp-toggle-label { font-size: 0.83rem; color: #555; }
    .tp-switch {
      position: relative; width: 38px; height: 22px;
      background: #d1d5db; border-radius: 11px;
      cursor: pointer; transition: background 0.2s;
      border: none;
    }
    .tp-switch.on { background: #22c55e; }
    .tp-switch::after {
      content: ''; position: absolute;
      top: 2px; left: 2px;
      width: 18px; height: 18px;
      background: #fff; border-radius: 50%;
      transition: transform 0.2s;
      box-shadow: 0 1px 3px rgba(0,0,0,0.15);
    }
    .tp-switch.on::after { transform: translateX(16px); }

    /* ── Tree slider row ── */
    .tp-slider-row {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 4px 0 8px;
    }
    .tp-slider-row.visible { display: flex; }
    .tp-slider-btn {
      width: 28px; height: 28px;
      border: 1px solid #d1d5db;
      border-radius: 6px;
      background: #fff;
      color: #555;
      font-size: 1rem; font-weight: 600;
      cursor: pointer;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
      user-select: none;
    }
    .tp-slider-btn:hover { background: #f3f4f6; color: #111; }
    .tp-slider-btn:active { background: #e5e7eb; }
    .tp-slider {
      flex: 1;
      -webkit-appearance: none;
      appearance: none;
      height: 4px;
      background: #e5e7eb;
      border-radius: 2px;
      outline: none;
    }
    .tp-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 14px; height: 14px;
      background: #374151;
      border-radius: 3px;
      cursor: pointer;
    }
    .tp-slider::-moz-range-thumb {
      width: 14px; height: 14px;
      background: #374151;
      border-radius: 3px;
      cursor: pointer;
      border: none;
    }

    /* ── PRODUCTION BOTTOM DRAWER ── */
    .prod-drawer {
      position: absolute;
      top: 0; right: 0; bottom: 0;
      width: 380px;
      background: #fff;
      border-radius: 0;
      box-shadow: -4px 0 24px rgba(0,0,0,0.13);
      display: flex;
      flex-direction: column;
      z-index: 40;
      transform: translateX(100%);
      transition: transform 0.25s ease;
      overflow: hidden;
    }
    .prod-drawer.open { transform: translateX(0); }
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

    /* ── SHADE PANEL ── */
    .shade-panel {
      position: absolute;
      top: 60px;
      left: 12px;
      width: 300px;
      background: #fff;
      border-radius: 10px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.25);
      z-index: 30;
      color: #111;
      overflow: hidden;
    }
    .shade-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid #e5e7eb;
      background: #f9fafb;
    }
    .shade-panel-close {
      background: none; border: none; cursor: pointer; font-size: 1.2rem;
      color: #999; padding: 2px 6px; border-radius: 4px;
    }
    .shade-panel-close:hover { background: #eee; color: #333; }
    .shade-panel-body { padding: 14px; max-height: 500px; overflow-y: auto; }
    .shade-stat-grid {
      display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
      margin-bottom: 14px;
    }
    .shade-stat {
      background: #f3f4f6; border-radius: 8px; padding: 10px;
      text-align: center;
    }
    .shade-stat-value { font-size: 1.1rem; font-weight: 700; color: #111; }
    .shade-stat-label { font-size: 0.68rem; color: #888; margin-top: 2px; }
    .shade-section-label {
      font-size: 0.72rem; font-weight: 600; color: #999;
      text-transform: uppercase; letter-spacing: 0.4px;
      margin: 12px 0 6px;
    }
    .shade-overlay-btns { display: flex; gap: 4px; margin-bottom: 8px; }
    .shade-overlay-btn {
      flex: 1; padding: 6px 4px; font-size: 0.75rem; font-weight: 600;
      border: 1px solid #e5e7eb; border-radius: 6px;
      background: #fff; color: #555; cursor: pointer;
    }
    .shade-overlay-btn:hover { background: #f3f4f6; }
    .shade-overlay-btn.active { background: #111; color: #fff; border-color: #111; }
    .shade-month-chart {
      display: flex; align-items: flex-end; gap: 3px;
      height: 60px; margin-bottom: 8px;
    }
    .shade-month-bar {
      flex: 1; border-radius: 3px 3px 0 0;
      position: relative; cursor: default;
    }
    .shade-month-bar-label {
      position: absolute; bottom: -14px; left: 50%; transform: translateX(-50%);
      font-size: 0.55rem; color: #999;
    }
    .shade-seg-item {
      display: flex; align-items: center; justify-content: space-between;
      padding: 8px 10px; border: 1px solid #e5e7eb; border-radius: 6px;
      margin-bottom: 4px; font-size: 0.8rem; cursor: pointer;
    }
    .shade-seg-item:hover { background: #f9fafb; }
    .shade-seg-pitch { color: #888; font-size: 0.75rem; }
    .shade-seg-flux { font-weight: 600; }

    /* ── LiDAR OVERLAY ── */

    /* ── TOOLBAR 2 ── */
    .toolbar2 {
      height: 34px;
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
    .tb2-btn.tb2-calibrated { color: #22c55e; }
    .tb2-btn.tb2-calibrated:hover { color: #16a34a; background: rgba(34,197,94,0.1); }
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
      <div class="tb-design-wrap" id="tbDesignWrap">
        <button class="tb-design-name" id="tbDesignBtn" onclick="toggleDesignDropdown(event)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          <span id="tbDesignLabel">${designs.length ? designs[designIdx].name : 'Design 1'}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <div class="tb-design-dropdown" id="tbDesignDropdown">
          ${designs.map((d, i) => `
            <div class="tb-dd-item ${d.id === activeDesignId ? 'active' : ''}" data-design-id="${d.id}" onclick="switchDesign('${d.id}')">
              <div class="tb-dd-name">${d.name}</div>
              <div class="tb-dd-meta">\$${(d.stats?.cost || 0).toLocaleString()} · ${d.stats?.offset || 0}% · ${d.stats?.kw || 0} kW</div>
              ${d.id === activeDesignId ? '<svg class="tb-dd-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8b5cf6" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
            </div>
          `).join('')}
          <div class="tb-dd-divider"></div>
          <button class="tb-dd-create" onclick="createNewDesign()">+ Create new design</button>
        </div>
      </div>
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
          <div class="tb-stat-val${hasUsageData ? '' : ' dim'}" id="statSavings">${hasUsageData ? energyOffset + '%' : '—%'}</div>
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
        <button class="tb-icon-btn" title="Sales Mode" onclick="location.href='/sales?projectId=${projectId}'">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>
        </button>
        <div class="tb-dropdown" id="salesDropdown">
          <div class="tb-dropdown-item" onclick="location.href='/sales?projectId=${projectId}'" style="cursor:pointer">
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

      <!-- Settings toggle -->
      <button class="tb-icon-btn" id="toggleRightPanel" title="Settings">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
      </button>

      <!-- User avatar + chevron -->
      <div class="tb-icon-wrap" id="profileWrap">
        <button class="tb-avatar-btn" title="Account" onclick="toggleDropdown('profileWrap', event)">
          <span class="tb-avatar">AB</span>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        <div class="profile-dropdown">
          <a class="profile-dropdown-item" href="/settings">My profile</a>
          <a class="profile-dropdown-item" href="/logout">Logout</a>
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
    <button class="tb2-btn" id="btn3dView">
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
    <!-- Calibrate -->
    <button class="tb2-btn" id="btnCalibrate" title="Calibrate LiDAR/Satellite Alignment">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>
      <span class="tb2-tip">Calibrate</span>
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
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12l9-9 9 9"/><path d="M5 10v9a2 2 0 002 2h10a2 2 0 002-2v-9"/></svg>
        </div>
        <button class="lp-collapse-btn" id="collapseLeft" title="Collapse panel">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M11 19l-7-7 7-7"/><path d="M19 19l-7-7 7-7"/></svg>
        </button>
      </div>
      <div class="lp-tabs">
        <button class="lp-tab active" id="tabSite">Site</button>
        <button class="lp-tab" id="tabSystem">System</button>
      </div>

      <!-- SITE TAB MENU -->
      <div class="lp-menu" id="lpMenuSite">
        <div class="lp-item-wrap" id="wrapRoof">
          <div class="lp-item" id="menuRoof">
            <div class="lp-item-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12l9-9 9 9"/><path d="M5 10v9a2 2 0 002 2h10a2 2 0 002-2v-9"/></svg>
              Roof
            </div>
            <svg class="lp-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
          </div>
          <div class="lp-submenu" id="roofSubmenu">
            <div class="lp-subitem" id="btnAutoDetect"><div class="lp-subitem-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4"/><path d="M12 19v4"/><path d="M1 12h4"/><path d="M19 12h4"/><path d="M4.22 4.22l2.83 2.83"/><path d="M16.95 16.95l2.83 2.83"/><path d="M4.22 19.78l2.83-2.83"/><path d="M16.95 7.05l2.83-2.83"/></svg>
              Auto detect roof</div><span class="lp-subitem-key">A</span>
            </div>
            <div class="lp-subitem" id="btnSmartRoof"><div class="lp-subitem-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12l9-9 9 9"/><path d="M5 10v9a2 2 0 002 2h10a2 2 0 002-2v-9"/></svg>
              Smart roof</div><span class="lp-subitem-key">R</span>
            </div>
            <div class="lp-subitem" id="btnManualRoof"><div class="lp-subitem-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/></svg>
              Manual roof face</div>
            </div>
            <div class="lp-subitem" id="btnFlatRoof"><div class="lp-subitem-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="12" x2="21" y2="12"/></svg>
              Flat roof</div>
            </div>
          </div>
        </div>
        <div class="lp-item-wrap" id="wrapObstructions">
          <div class="lp-item" id="menuObstructions">
            <div class="lp-item-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><line x1="10" y1="6.5" x2="14" y2="6.5"/><line x1="6.5" y1="10" x2="6.5" y2="14"/></svg>
              Obstructions
            </div>
            <svg class="lp-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
          </div>
          <div class="lp-submenu" id="obstructionsSubmenu">
            <div class="lp-subitem"><div class="lp-subitem-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="1"/></svg>
              Rectangle</div><span class="lp-subitem-key">O</span>
            </div>
            <div class="lp-subitem"><div class="lp-subitem-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/></svg>
              Circle</div>
            </div>
            <div class="lp-subitem"><div class="lp-subitem-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 22 22 2 22"/></svg>
              Polygon</div>
            </div>
          </div>
        </div>
        <div class="lp-item-wrap" id="wrapTrees">
          <div class="lp-item" id="menuTrees">
            <div class="lp-item-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22v-5"/><path d="M8 17l4-5 4 5"/><path d="M6 17l6-8 6 8"/><path d="M9 9l3-4 3 4"/></svg>
              Trees
            </div>
            <svg class="lp-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
          </div>
          <div class="lp-submenu" id="treesSubmenu">
            <div class="lp-subitem" id="btnPlaceTree"><div class="lp-subitem-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22v-5"/><path d="M8 17l4-5 4 5"/><path d="M6 17l6-8 6 8"/><path d="M9 9l3-4 3 4"/></svg>
              Place tree</div><span class="lp-subitem-key">T</span>
            </div>
            <div class="lp-subitem" id="btnSelectAllTrees"><div class="lp-subitem-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 12l2 2 4-4"/></svg>
              Select all trees</div>
            </div>
            <div class="lp-subitem" id="btnDeleteAllTrees"><div class="lp-subitem-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
              Delete all trees</div>
            </div>
          </div>
        </div>
        <div class="lp-item-wrap" id="wrapSiteComponents">
          <div class="lp-item" id="menuSiteComponents">
            <div class="lp-item-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>
              Components
            </div>
            <svg class="lp-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M9 18l6-6-6-6"/></svg>
          </div>
          <div class="lp-submenu" id="siteComponentsSubmenu">
            <div class="lp-subitem"><div class="lp-subitem-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><line x1="12" y1="3" x2="12" y2="7"/></svg>
              Meter</div>
            </div>
            <div class="lp-subitem"><div class="lp-subitem-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/></svg>
              Load center</div>
            </div>
            <div class="lp-subitem"><div class="lp-subitem-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/></svg>
              Main service panel</div>
            </div>
          </div>
        </div>
      </div>

      <!-- SYSTEM TAB MENU -->
      <div class="lp-menu" id="lpMenu" style="display:none;">
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
      <!-- 3D viewer -->
      <div id="viewer3d" style="position:absolute;inset:0;z-index:10;">
        <canvas id="canvas3d" style="width:100%;height:100%;display:block;"></canvas>
        <!-- Tree mode banner -->
        <div id="treeModeBanner" style="display:none;position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:40;background:#16a34a;color:#fff;padding:10px 24px;border-radius:10px;font-size:0.85rem;font-weight:600;align-items:center;gap:10px;box-shadow:0 4px 16px rgba(0,0,0,0.25);pointer-events:none;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M12 22v-5"/><path d="M8 17l4-5 4 5"/><path d="M6 17l6-8 6 8"/><path d="M9 9l3-4 3 4"/></svg>
          Tree Mode — Click to place center, move to set radius, click to confirm
        </div>
        <div id="treeBulkBar" style="display:none!important;">
          <span id="treeBulkCount">0</span>
          <button id="btnBulkDeleteTrees"></button>
          <button id="btnBulkDeselectTrees"></button>
        </div>
        <!-- Roof drawing banner -->
        <div id="roofModeBanner" style="display:none;position:absolute;top:12px;left:50%;transform:translateX(-50%);z-index:40;background:#f59e0b;color:#000;padding:10px 24px;border-radius:10px;font-size:0.85rem;font-weight:600;align-items:center;gap:10px;box-shadow:0 4px 16px rgba(0,0,0,0.25);pointer-events:none;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M3 12l9-9 9 9"/><path d="M5 10v9a2 2 0 002 2h10a2 2 0 002-2v-9"/></svg>
          Edit SmartRoof — Click to place vertices, double-click or Enter to complete. Esc to cancel.
        </div>
        <!-- Roof Edit Mode Banner (dormer toolbar) -->
        <div id="roofEditBanner">
          <div class="reb-title-row">
            <span id="rebTitleText">Edit SmartRoof</span>
            <button class="reb-close" id="rebCloseBtn">
              <span>Esc</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
          <div class="reb-tools">
            <span class="reb-tools-label">Insert dormer</span>
            <button class="reb-dormer-btn" data-dormer="gable" title="Gable dormer">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.8"><path d="M4 18v-6l8-6 8 6v6"/><path d="M4 18h16"/><path d="M12 6v4"/><path d="M8 10l4-4 4 4"/></svg>
            </button>
            <button class="reb-dormer-btn" data-dormer="hip" title="Hip dormer">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.8"><path d="M3 18v-5l5-5h8l5 5v5"/><path d="M3 18h18"/><path d="M8 8l2-2h4l2 2"/></svg>
            </button>
            <button class="reb-dormer-btn" data-dormer="shed" title="Shed dormer">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.8"><path d="M4 18v-8l16-4v12"/><path d="M4 18h16"/></svg>
            </button>
          </div>
        </div>
        <!-- Status -->
        <div id="lidarStatus" style="position:absolute;bottom:12px;left:12px;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);border-radius:8px;padding:8px 14px;color:#fff;font-size:0.85rem;font-weight:600;z-index:20;"></div>
        <!-- LiDAR loading overlay -->
        <div id="lidarLoadingOverlay" style="display:none;position:absolute;inset:0;z-index:30;background:rgba(0,0,0,0.4);backdrop-filter:blur(2px);display:none;align-items:center;justify-content:center;">
          <div style="background:rgba(20,20,40,0.9);border-radius:12px;padding:24px 36px;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.4);">
            <div style="width:36px;height:36px;border:3px solid rgba(255,255,255,0.2);border-top-color:#22c55e;border-radius:50%;margin:0 auto 12px;animation:lidarSpin 0.8s linear infinite;"></div>
            <div style="color:#fff;font-size:0.95rem;font-weight:600;">Loading LiDAR Data</div>
            <div id="lidarLoadingMsg" style="color:rgba(255,255,255,0.6);font-size:0.8rem;margin-top:4px;">Fetching elevation points...</div>
          </div>
        </div>
        <style>@keyframes lidarSpin{to{transform:rotate(360deg)}}</style>
        <!-- 3D ViewCube — bottom right, above zoom controls -->
        <div id="viewcube3dControls" style="position:absolute;bottom:120px;right:396px;z-index:50;pointer-events:all;">
          <div class="viewcube-wrap" id="viewcubeWrap3d">
            <div class="viewcube-ring"></div>
            <div class="viewcube-compass" id="vcCompass3d">
              <div class="vc-north-tick"></div>
              <span class="vc-s">S</span>
              <span class="vc-e">E</span>
              <span class="vc-w">W</span>
            </div>
            <div class="viewcube-scene">
              <div class="viewcube" id="viewcube3d">
                <div class="vc-face vc-top" data-view="top">N</div>
                <div class="vc-face vc-bottom" data-view="bottom">S</div>
                <div class="vc-face vc-front" data-view="front">TOP</div>
                <div class="vc-face vc-back" data-view="back">BOT</div>
                <div class="vc-face vc-left" data-view="left">W</div>
                <div class="vc-face vc-right" data-view="right">E</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Calibration overlay — side-by-side -->
      <div id="calibOverlay" style="display:none;position:absolute;inset:0;z-index:50;background:#111;">
        <!-- Header bar -->
        <div style="position:absolute;top:0;left:0;right:0;height:48px;background:#1a1a2e;display:flex;align-items:center;padding:0 16px;z-index:52;gap:12px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>
          <span style="color:#fff;font-weight:600;font-size:0.9rem;">Calibrate Alignment</span>
          <span style="color:#888;font-size:0.78rem;margin-left:4px;">Place matching pins on house corners in both images</span>
          <div style="flex:1"></div>
          <span id="calibPointCount" style="color:#aaa;font-size:0.8rem;">0 point pairs</span>
          <button id="calibClear" style="padding:5px 12px;border:1px solid #555;border-radius:6px;background:none;color:#ccc;font-size:0.78rem;cursor:pointer;">Clear All</button>
          <button id="calibSkip" style="display:none;padding:5px 12px;border:1px solid #555;border-radius:6px;background:none;color:#ccc;font-size:0.78rem;cursor:pointer;">Skip</button>
          <button id="calibConfirm" disabled style="padding:5px 14px;border:none;border-radius:6px;background:#555;color:#888;font-size:0.78rem;font-weight:600;cursor:not-allowed;">Confirm (need 4+ pairs)</button>
        </div>
        <!-- Side-by-side body -->
        <div id="calibBody" style="position:absolute;top:48px;bottom:0;left:0;right:0;display:flex;overflow:hidden;">
          <!-- LEFT: Satellite Image -->
          <div style="flex:1;position:relative;border-right:2px solid #333;">
            <div style="position:absolute;top:8px;left:12px;z-index:53;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);border-radius:6px;padding:4px 10px;display:flex;align-items:center;gap:6px;">
              <div style="width:8px;height:8px;border-radius:50%;background:#3b82f6;"></div>
              <span style="color:#fff;font-size:0.75rem;font-weight:600;">Satellite Image</span>
              <span id="calibSatCount" style="color:#888;font-size:0.7rem;margin-left:4px;">0 pins</span>
            </div>
            <canvas id="calibCanvasSat" style="position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;"></canvas>
            <div id="calibSatLoading" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#888;font-size:0.85rem;">Loading satellite image...</div>
            <!-- Zoom controls -->
            <div style="position:absolute;bottom:16px;right:16px;display:flex;flex-direction:column;gap:4px;z-index:53;">
              <button class="calib-zoom-btn" data-panel="sat" data-action="in" style="width:32px;height:32px;border:none;border-radius:6px;background:rgba(0,0,0,0.7);color:#fff;font-size:1.1rem;cursor:pointer;">+</button>
              <button class="calib-zoom-btn" data-panel="sat" data-action="out" style="width:32px;height:32px;border:none;border-radius:6px;background:rgba(0,0,0,0.7);color:#fff;font-size:1.1rem;cursor:pointer;">-</button>
              <button class="calib-zoom-btn" data-panel="sat" data-action="fit" style="width:32px;height:32px;border:none;border-radius:6px;background:rgba(0,0,0,0.7);color:#fff;font-size:0.65rem;cursor:pointer;">Fit</button>
            </div>
          </div>
          <!-- RIGHT: LiDAR Image -->
          <div style="flex:1;position:relative;">
            <div style="position:absolute;top:8px;left:12px;z-index:53;background:rgba(0,0,0,0.7);backdrop-filter:blur(4px);border-radius:6px;padding:4px 10px;display:flex;align-items:center;gap:6px;">
              <div style="width:8px;height:8px;border-radius:50%;background:#ea580c;"></div>
              <span style="color:#fff;font-size:0.75rem;font-weight:600;">Aerial Image</span>
              <span id="calibLidarCount" style="color:#888;font-size:0.7rem;margin-left:4px;">0 pins</span>
            </div>
            <canvas id="calibCanvasLidar" style="position:absolute;inset:0;width:100%;height:100%;cursor:crosshair;"></canvas>
            <div id="calibLidarLoading" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#888;font-size:0.85rem;">Loading aerial image...</div>
            <!-- Zoom controls -->
            <div style="position:absolute;bottom:16px;right:16px;display:flex;flex-direction:column;gap:4px;z-index:53;">
              <button class="calib-zoom-btn" data-panel="lidar" data-action="in" style="width:32px;height:32px;border:none;border-radius:6px;background:rgba(0,0,0,0.7);color:#fff;font-size:1.1rem;cursor:pointer;">+</button>
              <button class="calib-zoom-btn" data-panel="lidar" data-action="out" style="width:32px;height:32px;border:none;border-radius:6px;background:rgba(0,0,0,0.7);color:#fff;font-size:1.1rem;cursor:pointer;">-</button>
              <button class="calib-zoom-btn" data-panel="lidar" data-action="fit" style="width:32px;height:32px;border:none;border-radius:6px;background:rgba(0,0,0,0.7);color:#fff;font-size:0.65rem;cursor:pointer;">Fit</button>
            </div>
          </div>
        </div>
      </div>

      <!-- Floating re-open button (shown when panel is collapsed) -->
      <button class="lp-toggle-float" id="lpToggleFloat" title="Show panel">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 5l7 7-7 7"/><path d="M5 5l7 7-7 7"/></svg>
      </button>

      <!-- Hidden shade button — referenced by shade analysis JS -->
      <button id="btnShade" style="display:none;"></button>

      <!-- Shade analysis floating panel -->
      <div class="shade-panel" id="shadePanel" style="display:none;">
        <div class="shade-panel-header">
          <span style="font-weight:600;font-size:0.85rem;">Shade Analysis</span>
          <button class="shade-panel-close" id="shadePanelClose">&times;</button>
        </div>
        <div class="shade-panel-body">
          <div id="shadeLoading" style="text-align:center;padding:20px;color:#999;font-size:0.82rem;">
            Loading solar data...
          </div>
          <div id="shadeContent" style="display:none;">
            <div class="shade-stat-grid">
              <div class="shade-stat">
                <div class="shade-stat-value" id="shadeSunHours">—</div>
                <div class="shade-stat-label">Sun hours/yr</div>
              </div>
              <div class="shade-stat">
                <div class="shade-stat-value" id="shadeMaxFlux">—</div>
                <div class="shade-stat-label">Peak kWh/m²/yr</div>
              </div>
              <div class="shade-stat">
                <div class="shade-stat-value" id="shadeRoofArea">—</div>
                <div class="shade-stat-label">Roof area (ft²)</div>
              </div>
              <div class="shade-stat">
                <div class="shade-stat-value" id="shadeSegments">—</div>
                <div class="shade-stat-label">Roof segments</div>
              </div>
            </div>

            <div class="shade-section-label">Overlay</div>
            <div class="shade-overlay-btns">
              <button class="shade-overlay-btn active" id="btnOverlayNone" onclick="setShadeOverlay('none')">None</button>
              <button class="shade-overlay-btn" id="btnOverlayFlux" onclick="setShadeOverlay('flux')">Annual flux</button>
              <button class="shade-overlay-btn" id="btnOverlayShade" onclick="setShadeOverlay('shade')">Shade map</button>
            </div>

            <div class="shade-section-label">Monthly sun hours</div>
            <div class="shade-month-chart" id="shadeMonthChart"></div>

            <div class="shade-section-label">Roof segments</div>
            <div id="shadeSegmentList"></div>
          </div>
        </div>
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
          <div class="zoom-btns">
            <button id="zoomIn" title="Zoom in">+</button>
            <button id="zoomOut" title="Zoom out">−</button>
          </div>
          <div id="zoomLabel" style="display:none;background:rgba(0,0,0,0.7);color:#fff;font-size:0.7rem;padding:3px 7px;border-radius:5px;margin-top:4px;text-align:center;font-weight:600;"></div>
        </div>
      </div>
    </div>

    <!-- TREE PROPERTIES PANEL -->
    <div class="tree-panel hidden" id="treePanel">
      <div class="tp-header">
        <span class="tp-title">Tree</span>
        <div class="tp-actions">
          <button class="tp-action-btn" id="tpDuplicate" title="Duplicate tree">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
          <button class="tp-action-btn" id="tpDelete" title="Delete tree">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
          <button class="tp-action-btn" id="tpClose" title="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
      </div>
      <div class="tp-body">
        <button class="tp-fit-btn" id="tpFitLidar">Fit to LIDAR</button>
        <div class="tp-row">
          <span class="tp-label">Type</span>
          <div class="tp-type-toggle">
            <button class="tp-type-btn active" id="tpTypeDeciduous" title="Deciduous">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="6"/><rect x="11" y="14" width="2" height="6"/></svg>
            </button>
            <button class="tp-type-btn" id="tpTypeConifer" title="Conifer">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l6 10H6z"/><path d="M12 8l5 8H7z"/><rect x="11" y="16" width="2" height="4" fill="currentColor"/></svg>
            </button>
          </div>
        </div>
        <div class="tp-row">
          <span class="tp-label">Height</span>
          <div class="tp-input-wrap">
            <input class="tp-input" id="tpHeight" type="number" step="0.1" min="1">
            <span class="tp-unit">ft</span>
          </div>
        </div>
        <div class="tp-slider-row" id="tpHeightSliderRow">
          <button class="tp-slider-btn" data-input="tpHeight" data-delta="-0.5">&minus;</button>
          <input class="tp-slider" id="tpHeightSlider" type="range" min="1" max="80" step="0.1">
          <button class="tp-slider-btn" data-input="tpHeight" data-delta="0.5">+</button>
        </div>
        <div class="tp-row">
          <span class="tp-label">Crown height</span>
          <div class="tp-input-wrap">
            <input class="tp-input" id="tpCrownHeight" type="number" step="0.1" min="0.5">
            <span class="tp-unit">ft</span>
          </div>
        </div>
        <div class="tp-slider-row" id="tpCrownHeightSliderRow">
          <button class="tp-slider-btn" data-input="tpCrownHeight" data-delta="-0.5">&minus;</button>
          <input class="tp-slider" id="tpCrownHeightSlider" type="range" min="0.5" max="60" step="0.1">
          <button class="tp-slider-btn" data-input="tpCrownHeight" data-delta="0.5">+</button>
        </div>
        <div class="tp-row">
          <span class="tp-label">Crown diameter</span>
          <div class="tp-input-wrap">
            <input class="tp-input" id="tpCrownDiam" type="number" step="0.1" min="1">
            <span class="tp-unit">ft</span>
          </div>
        </div>
        <div class="tp-slider-row" id="tpCrownDiamSliderRow">
          <button class="tp-slider-btn" data-input="tpCrownDiam" data-delta="-0.5">&minus;</button>
          <input class="tp-slider" id="tpCrownDiamSlider" type="range" min="1" max="100" step="0.1">
          <button class="tp-slider-btn" data-input="tpCrownDiam" data-delta="0.5">+</button>
        </div>
        <div class="tp-row">
          <span class="tp-label">Trunk diameter</span>
          <div class="tp-input-wrap">
            <input class="tp-input" id="tpTrunkDiam" type="number" step="0.1" min="0.1">
            <span class="tp-unit">ft</span>
          </div>
        </div>
        <div class="tp-slider-row" id="tpTrunkDiamSliderRow">
          <button class="tp-slider-btn" data-input="tpTrunkDiam" data-delta="-0.1">&minus;</button>
          <input class="tp-slider" id="tpTrunkDiamSlider" type="range" min="0.1" max="10" step="0.1">
          <button class="tp-slider-btn" data-input="tpTrunkDiam" data-delta="0.1">+</button>
        </div>
        <div class="tp-toggle-row">
          <span class="tp-toggle-label">Remove trunk</span>
          <button class="tp-switch" id="tpRemoveTrunk"></button>
        </div>
      </div>
    </div>

    <!-- RIGHT PANEL -->
    <div class="right-panel hidden" id="rightPanel">
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

        <!-- Roof Face Information (shown when roof face/section selected) -->
        <div class="rp-section" id="roofPropsSection" style="display:none;">
          <div class="rp-section-title" style="color:#00e5ff;" id="roofPropsTitle">Roof face information</div>
          <div id="roofSectionInfo" style="margin-bottom:8px;font-size:0.8rem;color:#00bfa5;font-weight:600;display:none;"></div>
          <div style="font-size:0.7rem;color:#999;margin-bottom:4px;font-weight:600;">Characteristics</div>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:0.8rem;color:#ccc;">Azimuth</span>
              <div style="display:flex;align-items:center;gap:4px;">
                <input class="rp-input" type="number" id="roofPropAzimuth" value="180" step="1" min="0" max="360" style="width:70px;text-align:right;"/>
                <span style="font-size:0.75rem;color:#888;min-width:24px;" id="roofPropAzDir"></span>
              </div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:0.8rem;color:#ccc;">Pitch</span>
              <div style="display:flex;align-items:center;gap:4px;">
                <input class="rp-input" type="number" id="roofPropPitch" value="0" step="1" min="0" max="90" style="width:70px;text-align:right;"/>
                <span style="font-size:0.75rem;color:#888;min-width:24px;">deg</span>
              </div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:0.8rem;color:#ccc;">Slope</span>
              <span style="font-size:0.8rem;color:#eee;" id="roofPropSlope">0 / 12</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:0.8rem;color:#ccc;">Area</span>
              <span style="font-size:0.8rem;color:#eee;" id="roofPropArea">0 ft&sup2;</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:0.8rem;color:#ccc;">Eave Height</span>
              <div style="display:flex;align-items:center;gap:4px;">
                <input class="rp-input" type="number" id="roofPropHeight" value="0" step="0.5" min="0" style="width:70px;text-align:right;"/>
                <span style="font-size:0.75rem;color:#888;min-width:24px;">ft</span>
              </div>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:0.8rem;color:#ccc;">Modules</span>
              <span style="font-size:0.8rem;color:#eee;" id="roofPropModules">&mdash;</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <span style="font-size:0.8rem;color:#ccc;">Module coverage</span>
              <span style="font-size:0.8rem;color:#eee;" id="roofPropCoverage">&mdash;</span>
            </div>
          </div>
          <div id="roofEdgeLengthsList" style="margin-top:8px;"></div>
          <button id="btnDeleteRoofSection" style="margin-top:8px;width:100%;padding:6px;background:#e65100;color:#fff;border:none;border-radius:6px;font-size:0.8rem;font-weight:600;cursor:pointer;display:none;">Delete Section</button>
          <button id="btnDeleteRoofFace" style="margin-top:6px;width:100%;padding:6px;background:#dc2626;color:#fff;border:none;border-radius:6px;font-size:0.8rem;font-weight:600;cursor:pointer;">Delete Face</button>
        </div>

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

    <!-- EDGE & FACE SIDE PANEL (Aurora-style) -->
    <div class="ef-panel hidden" id="efPanel">
      <div class="ef-header">
        <h3>Edge & face</h3>
        <button class="ef-delete-btn" id="efDeleteBtn" title="Delete section">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
        </button>
      </div>

      <div class="ef-section">
        <div class="ef-section-label" id="efSectionName"></div>
        <div class="ef-section-title">Face</div>
        <div class="ef-row">
          <span class="ef-label">Pitch</span>
          <div style="display:flex;align-items:center;">
            <input class="ef-input" type="number" id="efPitch" value="0" step="1" min="0" max="90"/>
            <span class="ef-unit">deg</span>
          </div>
        </div>
        <div class="ef-row">
          <span class="ef-label">Slope</span>
          <span class="ef-value" id="efSlope">0 / 12</span>
        </div>
        <div class="ef-checkbox-row">
          <input type="checkbox" id="efApplyAllFaces"/>
          <label for="efApplyAllFaces">Apply to all faces</label>
        </div>
        <div class="ef-row">
          <span class="ef-label">Azimuth</span>
          <div style="display:flex;align-items:center;">
            <input class="ef-input" type="number" id="efAzimuth" value="180" step="1" min="0" max="360"/>
            <span class="ef-unit" id="efAzDir"></span>
          </div>
        </div>
      </div>

      <div class="ef-section">
        <div class="ef-section-title">Edge</div>
        <div class="ef-row">
          <span class="ef-label">Height</span>
          <div style="display:flex;align-items:center;">
            <input class="ef-input" type="number" id="efHeight" value="0" step="0.5" min="0"/>
            <span class="ef-unit">ft</span>
          </div>
        </div>
        <div class="ef-checkbox-row">
          <input type="checkbox" id="efApplyAllEdges"/>
          <label for="efApplyAllEdges">Apply to all edges</label>
        </div>
      </div>

      <div class="ef-section">
        <div class="ef-section-title">Length</div>
        <div id="efEdgeLengths"></div>
      </div>
    </div>

    <!-- DORMER SIDE PANEL -->
    <div class="ef-panel hidden" id="dormerPanel" style="z-index:36;">
      <div class="ef-header">
        <h3>Dormer</h3>
        <div style="display:flex;gap:6px;">
          <button class="ef-delete-btn" id="dpDuplicateBtn" title="Duplicate dormer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
          <button class="ef-delete-btn" id="dpDeleteBtn" title="Delete dormer">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>
          </button>
        </div>
      </div>

      <div class="ef-section">
        <button class="sr-btn" id="dpConvertBtn" style="width:100%;margin-bottom:8px;opacity:0.5;cursor:not-allowed;">Convert to roof</button>
      </div>

      <div class="ef-section">
        <div class="ef-section-title">Shape</div>
        <div class="dp-shape-item" data-type="gable" style="display:flex;align-items:center;gap:10px;padding:6px 4px;cursor:pointer;border-radius:6px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.8"><path d="M4 18v-6l8-6 8 6v6"/><path d="M4 18h16"/></svg>
          <span style="color:#eee;font-size:0.85rem;font-weight:600;">Gable</span>
          <span class="dp-check" style="margin-left:auto;color:#22c55e;display:none;">&#10003;</span>
        </div>
        <div class="dp-shape-item" data-type="hip" style="display:flex;align-items:center;gap:10px;padding:6px 4px;cursor:pointer;border-radius:6px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.8"><path d="M3 18v-5l5-5h8l5 5v5"/><path d="M3 18h18"/></svg>
          <span style="color:#eee;font-size:0.85rem;font-weight:600;">Hip</span>
          <span class="dp-check" style="margin-left:auto;color:#22c55e;display:none;">&#10003;</span>
        </div>
        <div class="dp-shape-item" data-type="shed" style="display:flex;align-items:center;gap:10px;padding:6px 4px;cursor:pointer;border-radius:6px;">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ccc" stroke-width="1.8"><path d="M4 18v-8l16-4v12"/><path d="M4 18h16"/></svg>
          <span style="color:#eee;font-size:0.85rem;font-weight:600;">Shed</span>
          <span class="dp-check" style="margin-left:auto;color:#22c55e;display:none;">&#10003;</span>
        </div>
      </div>

      <div class="ef-section" id="dpPitchRow">
        <div class="ef-row">
          <span class="ef-label">Pitch</span>
          <div style="display:flex;align-items:center;">
            <input class="ef-input" type="number" id="dpPitch" value="15" step="1" min="0" max="90"/>
            <span class="ef-unit">°</span>
          </div>
        </div>
      </div>
      <div class="ef-section" id="dpPitchSideRow" style="display:none;">
        <div class="ef-row">
          <span class="ef-label">Pitch (Side)</span>
          <div style="display:flex;align-items:center;">
            <input class="ef-input" type="number" id="dpPitchSide" value="15" step="1" min="0" max="90"/>
            <span class="ef-unit">°</span>
          </div>
        </div>
      </div>
      <div class="ef-section" id="dpPitchFrontRow" style="display:none;">
        <div class="ef-row">
          <span class="ef-label">Pitch (Front)</span>
          <div style="display:flex;align-items:center;">
            <input class="ef-input" type="number" id="dpPitchFront" value="15" step="1" min="0" max="90"/>
            <span class="ef-unit">°</span>
          </div>
        </div>
      </div>
      <div class="ef-section">
        <div class="ef-section-title" style="font-size:0.75rem;color:#999;font-weight:600;">Dimensions</div>
        <div class="ef-row">
          <span class="ef-label">Width</span>
          <span class="ef-value" id="dpWidth">&mdash;</span>
        </div>
        <div class="ef-row">
          <span class="ef-label">Depth</span>
          <span class="ef-value" id="dpDepth">&mdash;</span>
        </div>
        <div class="ef-row">
          <span class="ef-label">Wall height</span>
          <span class="ef-value" id="dpWallH">&mdash;</span>
        </div>
      </div>
    </div>

    <!-- SMARTROOF SIDE PANEL -->
    <div class="sr-panel hidden" id="smartRoofPanel">
      <div class="sr-header">
        <h3>SmartRoof</h3>
        <div class="sr-header-icons">
          <button id="srDuplicateBtn" title="Duplicate roof">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          </button>
          <button id="srDeleteBtn" title="Delete roof">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
          </button>
        </div>
      </div>

      <div class="sr-section">
        <div style="display:flex;flex-direction:column;gap:8px;">
          <button class="sr-btn" id="srFitLidarBtn">Fit to LIDAR</button>
          <button class="sr-btn" id="srEditRoofBtn">Edit roof</button>
          <button class="sr-btn" id="srMoveBtn">Move</button>
        </div>
      </div>

      <div class="sr-section">
        <div class="sr-row">
          <span class="sr-label">Roof type</span>
          <div style="display:flex;gap:4px;">
            <button class="sr-type-btn active" id="srTypeHip" title="Hip roof">
              <svg width="16" height="14" viewBox="0 0 24 20" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 18L12 4l10 14H2z"/></svg>
            </button>
            <button class="sr-type-btn" id="srTypeFlat" title="Flat roof">
              <svg width="16" height="14" viewBox="0 0 24 20" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12"/></svg>
            </button>
          </div>
        </div>
        <div class="sr-row">
          <span class="sr-label">Height to roof base</span>
          <div style="display:flex;align-items:center;">
            <input class="sr-input" type="number" id="srHeight" value="0" step="0.5" min="0"/>
            <span class="sr-unit">ft</span>
          </div>
        </div>
        <div class="sr-row">
          <span class="sr-label">Stories</span>
          <input class="sr-input" type="number" id="srStories" value="0" step="1" min="0"/>
        </div>
      </div>

      <div class="sr-section">
        <div class="sr-prop-title">
          <span>Roof properties</span>
          <button title="Edit properties">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
          </button>
        </div>
        <div class="sr-prop-row"><span class="sr-prop-label">Roof surface</span><span class="sr-prop-value" id="srRoofSurface">Asphalt Shingle</span></div>
        <div class="sr-prop-row"><span class="sr-prop-label">Framing type</span><span class="sr-prop-value" id="srFramingType">Rafter</span></div>
        <div class="sr-prop-row"><span class="sr-prop-label">Framing size</span><span class="sr-prop-value" id="srFramingSize">2&times;6</span></div>
        <div class="sr-prop-row"><span class="sr-prop-label">Framing spacing</span><span class="sr-prop-value" id="srFramingSpacing">24&quot; o.c.</span></div>
        <div class="sr-prop-row"><span class="sr-prop-label">Decking</span><span class="sr-prop-value" id="srDecking">7/16&quot; OSB</span></div>
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
          <div class="prod-stat-val" id="prodPanels">&mdash;</div>
        </div>
        <div class="prod-stat-item">
          <div class="prod-stat-label">Annual energy</div>
          <div class="prod-stat-val" id="prodEnergy">&mdash;<span>kWh</span></div>
        </div>
        <div class="prod-stat-item">
          <div class="prod-stat-label">Energy offset</div>
          <div class="prod-stat-val">${hasUsageData ? energyOffset : '—'}<span>%</span></div>
        </div>
      </div>
      <div class="prod-chart-header">
        <div class="prod-chart-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          Monthly production (kWh)
        </div>

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
        ${hasUsageData ? `
        <div style="display:flex;gap:28px;margin-bottom:12px;">
          <div>
            <div class="prod-stat-label">Annual usage</div>
            <div class="prod-stat-val">${annualUsage.toLocaleString()}<span>kWh</span></div>
          </div>
          <div>
            <div class="prod-stat-label">Avg. monthly</div>
            <div class="prod-stat-val">${Math.round(annualUsage / 12).toLocaleString()}<span>kWh</span></div>
          </div>
        </div>
        ` : `
        <div class="prod-no-data">
          <div class="prod-no-data-left">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            No energy usage data
          </div>
          <button class="prod-add-btn">Add energy usage</button>
        </div>
        `}
      </div>
    </div>
  </div>

  <script>
    var PAGE_VERSION = ${BUILD_VERSION};
    fetch('/api/version').then(function(r){return r.json()}).then(function(d){
      if(d.version!==PAGE_VERSION){console.log('Page stale, reloading...');location.reload(true);}
    }).catch(function(){});
    var designLat = ${parseFloat(lat)};
    var designLng = ${parseFloat(lng)};

    /* ── Tree placement state ── */
    var trees3d = [];
    var treePlacingMode = false;
    var treePlaceStep = 0;
    var treeCenterPoint = null;
    var treePreviewCircle = null;
    var treePreviewMesh = null;
    var space3dHeld = false;

    /* ── ViewCube drag state (shared so canvas handlers can check it) ── */
    var vcDragging3d = false, vcDidDrag3d = false, vcDragEndTime3d = 0;
    function isViewCubeBusy() { return vcDragging3d || (Date.now() - vcDragEndTime3d < 200); }

    /* ── Roof face drawing state ── */
    var roofFaces3d = [];
    var roofDrawingMode = false;
    var roofDetectMode = false;
    var smartRoofPickMode = false;
    var roofTempVertices = [];
    var roofTempHandles = [];
    var roofTempLines = null;
    var roofSnapGuides = [];       // THREE.Line objects for snap guide lines
    var ridgeLines3d = [];         // THREE.Line objects for detected ridge lines
    var roofSnappedPos = null;     // snapped cursor position {x, z} or null
    var roofSelectedFace = -1;
    var roofSelectedSection = -1;
    var roofEditMode = false; // false = whole-structure mode, true = section-editing mode
    var roofMovingMode = false; // true when user is dragging to move the roof footprint
    var roofMoveStart = null; // {x, z} world coords at drag start
    var roofDraggingHandle = -1;
    var roofDraggingFaceIdx = -1;
    var roofDraggingEdge = -1;
    var roofDraggingEdgeFaceIdx = -1;
    var roofEdgeDragStart = null;
    var roofEdgeDragOrigVerts = null;
    var roofHoveredEdgeFace = -1;
    var roofHoveredEdgeIdx = -1;
    var roofHoveredVertexFace = -1;
    var roofHoveredVertexIdx = -1;
    var roofUndoStack = [];
    var roofRedoStack = [];
    var ROOF_UNDO_MAX = 50;

    /* ── Dormer state ── */
    var dormerPlaceMode = false;
    var dormerPlaceType = '';     // 'gable', 'hip', 'shed'
    var dormerGhostMesh = null;  // THREE.Group preview mesh
    var selectedDormerIdx = -1;  // index into face.dormers[]
    var dormerDraggingHandle = -1;
    var dormerDraggingFaceIdx = -1;
    var dormerDraggingDormerIdx = -1;
    var DORMER_DEFAULT_WIDTH = 2.4;  // meters (~8ft)
    var DORMER_DEFAULT_DEPTH = 2.4;  // meters (~8ft)
    var DORMER_WALL_HEIGHT = 1.2;    // meters (~4ft) — height of dormer cheek walls above roof
    var dormerDragStartVerts = null; // saved verts at drag start for edge-based resize

    /* ── Unified undo stack — captures all interactable actions ── */
    var undoStack = [];
    var redoStack = [];
    var UNDO_MAX = 80;

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

    document.querySelector('.tb-stats').addEventListener('click', function() {
      if (prodDrawer.classList.contains('open')) { closeProdDrawer(); } else { openProdDrawer(); }
    });
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
      var usage = ${hasUsageData ? JSON.stringify(energyUsage) : '[0,0,0,0,0,0,0,0,0,0,0,0]'};
      var allVals = production.concat(usage);
      var maxVal = Math.max.apply(null, allVals);
      maxVal = Math.ceil(maxVal / 200) * 200;
      if (maxVal < 200) maxVal = 200;
      var padL = 60, padR = 10, padT = 10, padB = 36;
      var chartW = W - padL - padR;
      var chartH = H - padT - padB;
      var barGroup = chartW / months.length;
      var barW = barGroup * 0.35;

      // gridlines
      var gridLines = [];
      for (var g = 0; g <= maxVal; g += 200) gridLines.push(g);
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
    var rightHidden = true;

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
    /* setupFlyout calls removed — handled by submenus array below */

    /* ── Left panel tab switching ── */
    document.getElementById('tabSite').addEventListener('click', function() {
      this.classList.add('active');
      document.getElementById('tabSystem').classList.remove('active');
      document.getElementById('lpMenuSite').style.display = '';
      document.getElementById('lpMenu').style.display = 'none';
    });
    document.getElementById('tabSystem').addEventListener('click', function() {
      this.classList.add('active');
      document.getElementById('tabSite').classList.remove('active');
      document.getElementById('lpMenu').style.display = '';
      document.getElementById('lpMenuSite').style.display = 'none';
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

    /* ── Move submenus to body so they escape overflow:hidden ── */
    document.querySelectorAll('.lp-submenu').forEach(function(el) {
      document.body.appendChild(el);
    });

    /* ── Submenu flyout toggle ── */
    var submenus = [
      { wrap: 'wrapRoof',           item: 'menuRoof',           sub: 'roofSubmenu' },
      { wrap: 'wrapObstructions',   item: 'menuObstructions',   sub: 'obstructionsSubmenu' },
      { wrap: 'wrapTrees',          item: 'menuTrees',          sub: 'treesSubmenu' },
      { wrap: 'wrapSiteComponents', item: 'menuSiteComponents', sub: 'siteComponentsSubmenu' },
      { wrap: 'wrapFire',           item: 'menuFire',           sub: 'fireSubmenu' },
      { wrap: 'menuPanelsWrap',     item: 'menuPanels',         sub: 'panelsSubmenu' },
      { wrap: 'wrapComponents',     item: 'menuComponents',     sub: 'componentsSubmenu' },
      { wrap: 'menuStringWrap',     item: 'menuString',         sub: 'stringSubmenu' }
    ];
    function closeAllSubmenus() {
      submenus.forEach(function(x) {
        var w = document.getElementById(x.wrap);
        var i = document.getElementById(x.item);
        var sm = document.getElementById(x.sub);
        if (w) w.classList.remove('open');
        if (i) i.classList.remove('active');
        if (sm) sm.classList.remove('flyout-visible');
      });
    }
    function positionSubmenu(itemEl, submenuEl) {
      var panel = document.getElementById('leftPanel');
      var panelRect = panel.getBoundingClientRect();
      var itemRect = itemEl.getBoundingClientRect();
      submenuEl.style.left = (panelRect.right + 6) + 'px';
      submenuEl.style.top = itemRect.top + 'px';
    }
    submenus.forEach(function(s) {
      var wrap = document.getElementById(s.wrap);
      var item = document.getElementById(s.item);
      var sub = document.getElementById(s.sub);
      if (!wrap || !item || !sub) return;
      item.addEventListener('click', function(e) {
        e.stopPropagation();
        var isOpen = wrap.classList.contains('open');
        closeAllSubmenus();
        if (!isOpen) {
          wrap.classList.add('open');
          item.classList.add('active');
          positionSubmenu(item, sub);
          sub.classList.add('flyout-visible');
        }
      });
    });
    // close submenus when clicking outside
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.lp-item-wrap') && !e.target.closest('.lp-submenu')) {
        closeAllSubmenus();
      }
    });

    /* ── Tree submenu item handlers ── */
    document.getElementById('btnPlaceTree').addEventListener('click', function(e) {
      e.stopPropagation();
      closeAllSubmenus();
      toggleTreeMode();
    });
    document.getElementById('btnSelectAllTrees').addEventListener('click', function(e) {
      e.stopPropagation();
      closeAllSubmenus();
      selectAllTrees();
    });
    document.getElementById('btnDeleteAllTrees').addEventListener('click', function(e) {
      e.stopPropagation();
      closeAllSubmenus();
      deleteAllTrees();
    });

    /* ── Bulk bar button handlers ── */
    document.getElementById('btnBulkDeleteTrees').addEventListener('click', function() {
      if (multiSelectedTrees.length > 0) {
        var sorted = multiSelectedTrees.slice().sort(function(a, b) { return b - a; });
        sorted.forEach(function(i) {
          if (i >= 0 && i < trees3d.length) {
            if (trees3d[i].mesh) scene3d.remove(trees3d[i].mesh);
            trees3d.splice(i, 1);
          }
        });
        multiSelectedTrees = [];
        hoveredTreeIdx = -1;
        selectedTreeIdx = -1;
        document.getElementById('treeBulkBar').style.display = 'none';
        document.getElementById('treePanel').classList.add('hidden');
        markDirty();
      } else if (allTreesSelected) {
        deleteAllTrees();
      }
    });
    document.getElementById('btnBulkDeselectTrees').addEventListener('click', function() {
      if (multiSelectedTrees.length > 0) clearMultiSelect();
      else deselectAllTrees();
    });

    function toggleTreeMode() {
      treePlacingMode = !treePlacingMode;
      var menuTrees = document.getElementById('menuTrees');
      var canvas = document.getElementById('canvas3d');
      var banner = document.getElementById('treeModeBanner');
      if (treePlacingMode) {
        if (menuTrees) menuTrees.classList.add('active');
        if (canvas) canvas.style.cursor = 'crosshair';
        treePlaceStep = 0;
        if (banner) banner.style.display = 'flex';
      } else {
        if (menuTrees) menuTrees.classList.remove('active');
        if (canvas) canvas.style.cursor = '';
        treePlaceStep = 0;
        treeCenterPoint = null;
        removeTreePreview();
        if (banner) banner.style.display = 'none';
      }
    }
    document.addEventListener('keydown', function(e) {
      if ((e.key === 't' || e.key === 'T') && !e.target.matches('input,textarea,select')) {
        toggleTreeMode();
      }
      if (e.key === 'Escape' && allTreesSelected) {
        deselectAllTrees();
        return;
      }
      if (e.key === 'Escape' && treePlacingMode) {
        if (treePlaceStep === 1) {
          treePlaceStep = 0;
          treeCenterPoint = null;
          removeTreePreview();
        } else {
          toggleTreeMode();
        }
      }
    });




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
    var projectId = '${projectId || ""}';
    var currentDesignId = '${activeDesignId}';
    var projectHasCalibration = ${hasCalibration};

    function markDirty() { isDirty = true; updateProductionStats(); }

    function updateProductionStats() {
      // Count total modules across all roof faces
      var totalModules = 0;
      roofFaces3d.forEach(function(f) { totalModules += (f.modules || 0); });
      var prodPanels = document.getElementById('prodPanels');
      if (prodPanels) prodPanels.textContent = totalModules > 0 ? totalModules : '\u2014';
      var prodEnergy = document.getElementById('prodEnergy');
      if (prodEnergy) {
        if (totalModules > 0) {
          // ~400W per module, ~1500 kWh/kW/yr average
          var kWh = Math.round(totalModules * 0.4 * 1500);
          prodEnergy.innerHTML = kWh.toLocaleString() + '<span>kWh</span>';
        } else {
          prodEnergy.innerHTML = '\u2014<span>kWh</span>';
        }
      }
    }

    function handleBack(e) {
      e.preventDefault();
      if (!isDirty) { history.back(); return; }
      pendingNav = function() { history.back(); };
      showModal();
    }

    function showModal() {
      document.querySelector('.save-modal-sub').textContent =
        'You have unsaved changes to ' + document.getElementById('tbDesignLabel').textContent + '. Would you like to save before leaving?';
      document.getElementById('saveModal').style.display = 'flex';
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

    function saveCurrentDesign(callback) {
      if (!projectId || !currentDesignId) { if (callback) callback(); return; }
      var data = { trees: serializeTrees(), roofFaces: serializeRoofFaces() };
      fetch('/api/projects/' + projectId + '/designs/' + currentDesignId, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).then(function() {
        isDirty = false;
        if (callback) callback();
      });
    }

    function saveAndLeave() {
      var btn = document.querySelector('.save-modal-save');
      btn.textContent = 'Saving…';
      btn.disabled = true;
      saveCurrentDesign(function() {
        document.getElementById('saveModal').style.display = 'none';
        btn.textContent = 'Save changes';
        btn.disabled = false;
        if (pendingNav) pendingNav();
      });
    }

    /* ── Design switching ── */
    function toggleDesignDropdown(e) {
      e.stopPropagation();
      document.getElementById('tbDesignDropdown').classList.toggle('open');
    }
    document.addEventListener('click', function(e) {
      var wrap = document.getElementById('tbDesignWrap');
      if (wrap && !wrap.contains(e.target)) {
        document.getElementById('tbDesignDropdown').classList.remove('open');
      }
    });

    function switchDesign(designId) {
      if (designId === currentDesignId) {
        document.getElementById('tbDesignDropdown').classList.remove('open');
        return;
      }
      document.getElementById('tbDesignDropdown').classList.remove('open');
      if (isDirty) {
        pendingNav = function() { loadDesign(designId); };
        showModal();
      } else {
        loadDesign(designId);
      }
    }

    function loadDesign(designId) {
      /* Fetch design data */
      fetch('/api/projects/' + projectId + '/designs/active', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ designId: designId })
      }).then(function(r) { return r.json(); }).then(function(data) {
        currentDesignId = designId;
        isDirty = false;
        var design = data.design;

        /* Update header */
        document.getElementById('tbDesignLabel').textContent = design.name;

        /* Update dropdown active state */
        var items = document.querySelectorAll('.tb-dd-item');
        items.forEach(function(el) {
          el.classList.remove('active');
          var check = el.querySelector('.tb-dd-check');
          if (check) check.remove();
          if (el.getAttribute('data-design-id') === designId) {
            el.classList.add('active');
            var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            svg.setAttribute('class', 'tb-dd-check');
            svg.setAttribute('width', '16');
            svg.setAttribute('height', '16');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('fill', 'none');
            svg.setAttribute('stroke', '#8b5cf6');
            svg.setAttribute('stroke-width', '2.5');
            var polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
            polyline.setAttribute('points', '20 6 9 17 4 12');
            svg.appendChild(polyline);
            el.appendChild(svg);
          }
        });

        /* Restore trees in 3D view */
        trees3d.forEach(function(t) { if (t.mesh) scene3d.remove(t.mesh); });
        trees3d = [];
        if (design.trees && design.trees.length > 0 && typeof THREE !== 'undefined') {
          design.trees.forEach(function(td) {
            var local = geoToLocal(td.lat, td.lng);
            var sceneH = td.height * vertExag;
            var mesh = buildTreeGroup({ x: local.x, z: local.z }, td.radius, sceneH, false);
            scene3d.add(mesh);
            trees3d.push({
              center: { x: local.x, z: local.z },
              radius: td.radius,
              height: td.height,
              mesh: mesh,
              lat: td.lat,
              lng: td.lng
            });
          });
        }

        /* Restore roof faces in 3D view */
        if (typeof clearAllRoofFaces === 'function') clearAllRoofFaces();
        if (design.roofFaces && design.roofFaces.length > 0 && typeof THREE !== 'undefined' && typeof finalizeRoofFace === 'function') {
          design.roofFaces.forEach(function(rf) {
            var fIdx = finalizeRoofFace(rf.vertices, rf.pitch, rf.azimuth, rf.height, rf.deletedSections, rf.sectionPitches);
            // Restore dormers
            if (rf.dormers && rf.dormers.length > 0) {
              var face = roofFaces3d[fIdx];
              rf.dormers.forEach(function(dd) {
                var newD = {
                  type: dd.type,
                  vertices: migrateDormerVerts(dd.vertices),
                  pitch: dd.pitch || 15,
                  pitchSide: dd.pitchSide || 15,
                  pitchFront: dd.pitchFront || 15,
                  mesh: null, outlineLines: null, handleMeshes: [], selected: false
                };
                face.dormers.push(newD);
                rebuildDormer(face, face.dormers.length - 1);
              });
            }
          });
        }
      });
    }

    function createNewDesign() {
      document.getElementById('tbDesignDropdown').classList.remove('open');
      if (!projectId) return;

      function doCreate() {
        fetch('/api/projects/' + projectId + '/designs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        }).then(function(r) { return r.json(); }).then(function(design) {
          /* Add to dropdown */
          var dd = document.getElementById('tbDesignDropdown');
          var divider = dd.querySelector('.tb-dd-divider');
          var item = document.createElement('div');
          item.className = 'tb-dd-item';
          item.setAttribute('data-design-id', design.id);
          item.setAttribute('onclick', "switchDesign('" + design.id + "')");
          item.innerHTML = '<div class="tb-dd-name">' + design.name + '</div>'
            + '<div class="tb-dd-meta">$0 · 0% · 0 kW</div>';
          dd.insertBefore(item, divider);

          /* Switch to the new design */
          loadDesign(design.id);
        });
      }

      if (isDirty) {
        pendingNav = doCreate;
        showModal();
      } else {
        doCreate();
      }
    }

    /* ── SHADE ANALYSIS ── */
    var solarData = null;
    var shadeOverlayType = 'none';
    var solarRoofPolygons = [];

    document.getElementById('btnShade').addEventListener('click', function() {
      var panel = document.getElementById('shadePanel');
      if (panel.style.display === 'none') {
        panel.style.display = '';
        this.classList.add('active');
        if (!solarData) loadSolarData();
      } else {
        panel.style.display = 'none';
        this.classList.remove('active');
        clearShadeOverlay();
      }
    });

    document.getElementById('shadePanelClose').addEventListener('click', function() {
      document.getElementById('shadePanel').style.display = 'none';
      document.getElementById('btnShade').classList.remove('active');
      clearShadeOverlay();
    });

    function loadSolarData() {
      var loading = document.getElementById('shadeLoading');
      var content = document.getElementById('shadeContent');
      loading.style.display = '';
      content.style.display = 'none';
      loading.textContent = 'Loading solar data...';

      fetch('/api/solar/building-insights?lat=' + designLat + '&lng=' + designLng)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.error) {
            loading.textContent = 'Error: ' + data.error;
            return;
          }
          solarData = data;
          loading.style.display = 'none';
          content.style.display = '';
          renderShadePanel();
        })
        .catch(function(e) {
          loading.textContent = 'Failed to load solar data';
        });
    }

    function renderShadePanel() {
      if (!solarData) return;
      var si = solarData.solarPotential || {};
      var maxSun = si.maxSunshineHoursPerYear || 0;

      document.getElementById('shadeSunHours').textContent = Math.round(maxSun).toLocaleString();
      document.getElementById('shadeMaxFlux').textContent = maxSun ? (maxSun * 0.2).toFixed(0) : '—';

      var roofSegs = si.roofSegmentStats || [];
      var totalArea = 0;
      roofSegs.forEach(function(s) { totalArea += (s.stats && s.stats.areaMeters2) || 0; });
      document.getElementById('shadeRoofArea').textContent = Math.round(totalArea * 10.764).toLocaleString();
      document.getElementById('shadeSegments').textContent = roofSegs.length;

      // Monthly chart
      var monthNames = ['J','F','M','A','M','J','J','A','S','O','N','D'];
      var monthlyFactors = [0.045,0.055,0.08,0.095,0.11,0.115,0.12,0.11,0.09,0.075,0.055,0.05];
      var maxBar = 0;
      var monthlyHours = monthlyFactors.map(function(f) {
        var v = maxSun * f;
        if (v > maxBar) maxBar = v;
        return v;
      });
      document.getElementById('shadeMonthChart').innerHTML = monthlyHours.map(function(h, i) {
        var pct = maxBar > 0 ? (h / maxBar * 100) : 0;
        var color = pct > 70 ? '#f59e0b' : (pct > 40 ? '#fbbf24' : '#d1d5db');
        return '<div class="shade-month-bar" style="height:' + pct + '%;background:' + color + ';" title="' + monthNames[i] + ': ' + Math.round(h) + ' hrs">'
          + '<div class="shade-month-bar-label">' + monthNames[i] + '</div></div>';
      }).join('');

      // Segment list
      document.getElementById('shadeSegmentList').innerHTML = roofSegs.map(function(s, i) {
        var pitch = s.pitchDegrees || 0;
        var azimuth = s.azimuthDegrees || 0;
        var area = (s.stats && s.stats.areaMeters2) || 0;
        var dirs = ['N','NE','E','SE','S','SW','W','NW'];
        var dir = dirs[Math.round(azimuth / 45) % 8];
        var sunHrs = (s.stats && s.stats.sunshineQuantiles)
          ? s.stats.sunshineQuantiles[Math.floor(s.stats.sunshineQuantiles.length / 2)] : 0;
        return '<div class="shade-seg-item" onclick="highlightSolarSegment(' + i + ')">'
          + '<div><strong>Segment ' + (i + 1) + '</strong> <span class="shade-seg-pitch">' + Math.round(pitch) + '\\u00B0 ' + dir + '</span></div>'
          + '<div class="shade-seg-flux">' + Math.round(area * 10.764) + ' ft\\u00B2 \\u00B7 ' + Math.round(sunHrs) + ' hrs</div>'
          + '</div>';
      }).join('');

      drawSolarRoofSegments(roofSegs);
    }

    function drawSolarRoofSegments(roofSegs) {
    }

    function setShadeOverlay(type) {
      shadeOverlayType = type;
      document.querySelectorAll('.shade-overlay-btn').forEach(function(b) { b.classList.remove('active'); });
      var btnId = 'btnOverlay' + type.charAt(0).toUpperCase() + type.slice(1);
      document.getElementById(btnId).classList.add('active');
    }

    function clearShadeOverlay() {
    }

    function highlightSolarSegment(i) {
    }
  </script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/build/three.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>

  <script>
    /* ── LiDAR 3D VIEW ──
       Simple approach: one Three.js scene with satellite ground plane + LiDAR points.
       OrbitControls handles all navigation (zoom, rotate, pan).
       Toggle on = show scene. Toggle off = back to map. */

    var scene3d, camera3d, renderer3d, controls3d, raycaster3d, mouse3d;
    var lidarPoints = null;
    var groundPlane3d = null;
    var groundLevel = 0;
    var vertExag = 1.0;
    var lidarActive = true;
    var satExtentM = 0; // satellite ground plane extent in meters
    var satTexture = null; // satellite texture for roof face overlays
    var lidarExtentMX = 0, lidarExtentMY = 0; // LiDAR/RGB image extent in meters
    var lidarCenterOffX = 0, lidarCenterOffZ = 0; // RGB image center offset from design point (meters)

    // Geo-to-local: meters offset from design center
    var metersPerDegLat = 111320;
    function geoToLocal(lat, lng) {
      var mPerDegLng = 111320 * Math.cos(designLat * Math.PI / 180);
      return {
        x: (lng - designLng) * mPerDegLng,
        z: -(lat - designLat) * metersPerDegLat
      };
    }

    function setStatus3d(msg) {
      var el = document.getElementById('lidarStatus');
      if (el) el.textContent = msg || '';
    }

    /* ── Init Three.js scene (once) ── */
    function init3dViewer() {
      if (typeof THREE === 'undefined') {
        setTimeout(init3dViewer, 300);
        return;
      }
      var canvas = document.getElementById('canvas3d');
      var container = document.getElementById('viewer3d');
      var w = container.clientWidth || 800;
      var h = container.clientHeight || 600;

      scene3d = new THREE.Scene();
      scene3d.background = new THREE.Color(0x1a1a2e);

      camera3d = new THREE.PerspectiveCamera(5, w / h, 1, 5000);
      // Dice-on-table default: 30° tilt from above
      camera3d.position.set(0, 530, 0.001);
      camera3d.lookAt(0, 0, 0);

      renderer3d = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
      renderer3d.setSize(w, h);
      renderer3d.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      // OrbitControls — full navigation
      controls3d = new THREE.OrbitControls(camera3d, canvas);
      controls3d.enableDamping = true;
      controls3d.dampingFactor = 0.08;
      controls3d.minDistance = 50;
      controls3d.maxDistance = 3000;
      controls3d.maxPolarAngle = 80 * Math.PI / 180; // cap at 80°
      controls3d.screenSpacePanning = true;
      controls3d.panSpeed = 12;
      // Swap: right-click = orbit, disable built-in left-click rotate
      controls3d.mouseButtons = {
        LEFT: null,
        MIDDLE: THREE.MOUSE.DOLLY,
        RIGHT: THREE.MOUSE.ROTATE
      };
      canvas.addEventListener('contextmenu', function(e) { e.preventDefault(); });

      // Blur any focused input when clicking the 3D canvas so keyboard shortcuts work
      // (document-level handler covers canvas, viewer, calibration panels, etc.)
      document.addEventListener('mousedown', function(e) {
        if (e.target.matches('input,textarea,select,[contenteditable]')) return;
        if (document.activeElement && document.activeElement.matches('input,textarea,select,[contenteditable]')) {
          document.activeElement.blur();
        }
      });

      // Spacebar + drag = pan in 3D view
      var space3dPanning = false;
      var sp3dStartX = 0, sp3dStartY = 0;
      document.addEventListener('keydown', function(e) {
        if (e.code === 'Space' && !e.repeat && !e.target.matches('input,textarea,select') && lidarActive) {
          e.preventDefault();
          space3dHeld = true;
          canvas.style.cursor = 'grab';
          controls3d.enabled = false;
        }
      });
      document.addEventListener('keyup', function(e) {
        if (e.code === 'Space' && lidarActive) {
          e.preventDefault();
          space3dHeld = false;
          space3dPanning = false;
          canvas.style.cursor = '';
          controls3d.enabled = true;
        }
      });
      canvas.addEventListener('pointerdown', function(e) {
        if (space3dHeld && e.button === 0) {
          space3dPanning = true;
          controls3d.enabled = false;
          sp3dStartX = e.clientX;
          sp3dStartY = e.clientY;
          canvas.style.cursor = 'grabbing';
          e.preventDefault();
          e.stopPropagation();
        }
      });
      document.addEventListener('pointermove', function(e) {
        if (space3dPanning && camera3d && controls3d) {
          var dx = e.clientX - sp3dStartX;
          var dy = e.clientY - sp3dStartY;
          sp3dStartX = e.clientX;
          sp3dStartY = e.clientY;
          var distance = camera3d.position.distanceTo(controls3d.target);
          var vFov = camera3d.fov * Math.PI / 180;
          var scale = 2 * distance * Math.tan(vFov / 2) / renderer3d.domElement.clientHeight;
          var forward = new THREE.Vector3();
          camera3d.getWorldDirection(forward);
          forward.y = 0;
          forward.normalize();
          var right = new THREE.Vector3();
          right.crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
          var panOffset = new THREE.Vector3();
          panOffset.addScaledVector(right, -dx * scale);
          panOffset.addScaledVector(forward, dy * scale);
          camera3d.position.add(panOffset);
          controls3d.target.add(panOffset);
        }
      });
      document.addEventListener('pointerup', function() {
        if (space3dPanning) {
          space3dPanning = false;
          canvas.style.cursor = space3dHeld ? 'grab' : '';
          if (!space3dHeld) controls3d.enabled = true;
        }
      });

      // Lights
      scene3d.add(new THREE.AmbientLight(0xffffff, 0.6));
      var sun = new THREE.DirectionalLight(0xffffff, 0.9);
      sun.position.set(30, 50, 20);
      scene3d.add(sun);

      // Raycaster (for future tree height click)
      raycaster3d = new THREE.Raycaster();
      raycaster3d.params.Points = { threshold: 0.5 };
      mouse3d = new THREE.Vector2();

      window.addEventListener('resize', resize3d);
      animate3d();
    }

    // Auto-init 3D viewer on page load
    setTimeout(function() {
      if (!scene3d) {
        init3dViewer();
        setTimeout(function() { resize3d(); buildGroundPlane(); }, 60);
      }
      // Load initial design data (segments, trees, roof faces)
      if (currentDesignId) {
        setTimeout(function() { loadDesign(currentDesignId); }, 200);
      }
    }, 100);

    var HANDLE_PIXEL_SIZE = 7; // desired screen-pixel radius for corner handles
    var EDGE_PIXEL_WIDTH = 1.5; // desired screen-pixel half-width for edge lines

    function getWorldPerPixel() {
      if (!camera3d || !renderer3d) return 1;
      var dist = camera3d.position.distanceTo(controls3d ? controls3d.target : new THREE.Vector3());
      var fov = camera3d.fov * Math.PI / 180;
      var screenH = renderer3d.domElement.clientHeight;
      return 2 * dist * Math.tan(fov / 2) / screenH;
    }

    function updateHandleScales() {
      var worldPerPx = getWorldPerPixel();
      var hs = worldPerPx * HANDLE_PIXEL_SIZE / 0.35;
      var edgeR = worldPerPx * EDGE_PIXEL_WIDTH;
      var edgeScale = edgeR / EDGE_LINE_RADIUS;
      if (typeof roofFaces !== 'undefined' && roofFaces) {
        roofFaces.forEach(function(face) {
          if (face.handleMeshes) {
            face.handleMeshes.forEach(function(h) { h.scale.setScalar(hs); });
          }
          if (face.edgeHandleMeshes) {
            face.edgeHandleMeshes.forEach(function(h) { h.scale.setScalar(hs); });
          }
          if (face.edgeLines && face.edgeLines.children) {
            face.edgeLines.children.forEach(function(cyl) {
              cyl.scale.x = edgeScale;
              cyl.scale.z = edgeScale;
            });
          }
        });
      }
      if (typeof roofFaces3d !== 'undefined' && roofFaces3d) {
        roofFaces3d.forEach(function(face) {
          if (face.handleMeshes) {
            face.handleMeshes.forEach(function(h) { h.scale.setScalar(hs); });
          }
          if (face.edgeHandleMeshes) {
            face.edgeHandleMeshes.forEach(function(h) { h.scale.setScalar(hs); });
          }
        });
      }
    }

    function animate3d() {
      requestAnimationFrame(animate3d);
      if (!renderer3d) return;
      if (controls3d) controls3d.update();
      updateHandleScales();
      renderer3d.render(scene3d, camera3d);
      updateViewCube3d();
    }

    /* ── 3D ViewCube sync ── */
    var vcCube3d = document.getElementById('viewcube3d');
    var vcCompass3d = document.getElementById('vcCompass3d');

    function updateViewCube3d() {
      if (!camera3d || !controls3d || !vcCube3d) return;
      // Spherical coords from camera relative to target
      var dx = camera3d.position.x - controls3d.target.x;
      var dy = camera3d.position.y - controls3d.target.y;
      var dz = camera3d.position.z - controls3d.target.z;
      // polar angle (tilt): 0 = top-down, 90 = eye-level
      var r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      var polarDeg = Math.acos(Math.max(-1, Math.min(1, dy / r))) * (180 / Math.PI);
      // azimuth (heading around Y axis)
      var azimuthDeg = Math.atan2(dx, dz) * (180 / Math.PI);
      vcCube3d.style.transform = 'rotateX(' + polarDeg + 'deg) rotateZ(' + azimuthDeg + 'deg)';
      vcCompass3d.style.transform = 'rotate(' + azimuthDeg + 'deg)';
    }

    // 3D viewcube — face clicks snap to views, drag orbits camera
    (function() {
      var wrap3d = document.getElementById('viewcubeWrap3d');
      if (!wrap3d) return;

      // Stop events from reaching OrbitControls canvas underneath
      ['click','dblclick','wheel'].forEach(function(evt) {
        wrap3d.addEventListener(evt, function(e) { e.stopPropagation(); });
      });

      // ── Drag-to-orbit state (matches 2D viewcube controls) ──
      vcDragging3d = false; vcDidDrag3d = false;
      var vcStartX3d = 0, vcStartY3d = 0;
      var vcStartAzimuth3d = 0, vcStartPolar3d = 0;
      var vcPointerId3d = -1;
      var DEG = Math.PI / 180;

      function getCameraSpherical() {
        var dx = camera3d.position.x - controls3d.target.x;
        var dy = camera3d.position.y - controls3d.target.y;
        var dz = camera3d.position.z - controls3d.target.z;
        var r = Math.sqrt(dx * dx + dy * dy + dz * dz);
        var polar = Math.acos(Math.max(-1, Math.min(1, dy / r)));
        var azimuth = Math.atan2(dx, dz);
        return { r: r, polar: polar, azimuth: azimuth };
      }

      function setCameraFromSpherical(r, polar, azimuth) {
        var t = controls3d.target;
        camera3d.position.set(
          t.x + r * Math.sin(polar) * Math.sin(azimuth),
          t.y + r * Math.cos(polar),
          t.z + r * Math.sin(polar) * Math.cos(azimuth)
        );
        camera3d.lookAt(t);
        controls3d.update();
      }

      // Drag: use pointer capture so moves work even when cursor leaves the cube
      function endViewCubeDrag() {
        if (!vcDragging3d) return;
        vcDragging3d = false;
        vcDragEndTime3d = Date.now();
        if (vcPointerId3d >= 0) {
          try { wrap3d.releasePointerCapture(vcPointerId3d); } catch(ex) {}
        }
        vcPointerId3d = -1;
        wrap3d.style.cursor = 'grab';
        if (controls3d) controls3d.enabled = true;
      }

      wrap3d.addEventListener('pointerdown', function(e) {
        if (!camera3d || !controls3d) return;
        if (e.target.classList.contains('vc-north-tick')) return;
        e.stopPropagation();
        e.preventDefault();
        vcDragging3d = true;
        vcDidDrag3d = false;
        vcStartX3d = e.clientX;
        vcStartY3d = e.clientY;
        var s = getCameraSpherical();
        vcStartAzimuth3d = s.azimuth;
        vcStartPolar3d = s.polar;
        vcPointerId3d = e.pointerId;
        wrap3d.setPointerCapture(e.pointerId);
        wrap3d.style.cursor = 'grabbing';
        controls3d.enabled = false;
      });

      wrap3d.addEventListener('pointermove', function(e) {
        if (!vcDragging3d) return;
        var dx = e.clientX - vcStartX3d;
        var dy = e.clientY - vcStartY3d;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) vcDidDrag3d = true;
        if (!vcDidDrag3d) return;

        var s = getCameraSpherical();
        var newAzimuth = vcStartAzimuth3d - dx * 0.6 * DEG;
        var newPolar = vcStartPolar3d - dy * 0.8 * DEG;
        // Clamp polar: 0° (top-down) to 80° (near ground) — matches 2D cube range
        newPolar = Math.max(0.1 * DEG, Math.min(80 * DEG, newPolar));
        setCameraFromSpherical(s.r, newPolar, newAzimuth);
      });

      wrap3d.addEventListener('pointerup', function(e) {
        endViewCubeDrag();
      });

      wrap3d.addEventListener('pointercancel', function(e) {
        endViewCubeDrag();
      });

      wrap3d.addEventListener('lostpointercapture', function(e) {
        endViewCubeDrag();
      });

      // ── Face clicks — keep current tilt for sides, reset for top/bottom (matches 2D cube) ──
      function handleFaceClick3d(view) {
        if (!camera3d || !controls3d) return;
        var s = getCameraSpherical();
        var r = s.r;
        var polar = s.polar;
        var azimuth = s.azimuth;

        if (view === 'top') {
          polar = 0.001 * DEG; azimuth = 0;
        } else if (view === 'bottom') {
          polar = 179.999 * DEG; azimuth = 0;
        } else {
          polar = 90 * DEG;
          if (view === 'front') azimuth = 0;
          else if (view === 'back') azimuth = Math.PI;
          else if (view === 'left') azimuth = Math.PI / 2;
          else if (view === 'right') azimuth = -Math.PI / 2;
        }
        setCameraFromSpherical(r, polar, azimuth);
      }

      wrap3d.querySelectorAll('.vc-face').forEach(function(face) {
        face.addEventListener('click', function(e) {
          e.stopPropagation();
          if (vcDidDrag3d) { vcDidDrag3d = false; return; }
          handleFaceClick3d(this.dataset.view);
        });
      });

      // North tick click — snap view to face north (keep current tilt)
      var northTick = wrap3d.querySelector('.vc-north-tick');
      if (northTick) {
        northTick.addEventListener('click', function(e) {
          e.stopPropagation();
          if (vcDidDrag3d) { vcDidDrag3d = false; return; }
          if (!camera3d || !controls3d) return;
          var s = getCameraSpherical();
          setCameraFromSpherical(s.r, s.polar, 0);
        });
      }

      // Double-click reset to top-down
      wrap3d.addEventListener('dblclick', function(e) {
        e.stopPropagation();
        if (!camera3d || !controls3d) return;
        var s = getCameraSpherical();
        setCameraFromSpherical(s.r, 0.1 * DEG, 0);
      });
    })();

    function resize3d() {
      if (!renderer3d) return;
      var container = document.getElementById('viewer3d');
      var w = container.clientWidth;
      var h = container.clientHeight;
      if (w < 1 || h < 1) return;
      renderer3d.setSize(w, h);
      camera3d.aspect = w / h;
      camera3d.updateProjectionMatrix();
    }

    /* ── Build satellite ground plane (high-res Google Maps Static API) ── */
    function buildGroundPlane() {
      if (groundPlane3d) return;
      if (typeof designLat === 'undefined') return;

      // Google Maps Static API: zoom=20, size=640, scale=2 → 1280px image
      // Geographic extent = 640 logical pixels at zoom 20 (scale only doubles resolution)
      var metersPerPx = 156543.03392 * Math.cos(designLat * Math.PI / 180) / Math.pow(2, 20);
      var extentM = 640 * metersPerPx;
      satExtentM = extentM;

      console.log('Satellite ground plane: metersPerPx=' + metersPerPx.toFixed(4) +
                  ' extent=' + extentM.toFixed(1) + 'm');

      var geo = new THREE.PlaneGeometry(extentM, extentM);
      geo.rotateX(-Math.PI / 2);

      var img = new Image();
      img.crossOrigin = 'anonymous';

      function frameCamera() {
        var fovRad = camera3d.fov * Math.PI / 180;
        var camDist = (extentM / 2) / Math.tan(fovRad / 2) * 0.87;
        camDist = Math.max(200, Math.min(2000, camDist));
        camera3d.position.set(0, camDist, 0.001);
        controls3d.target.set(0, 0, 0);
        controls3d.update();
      }

      img.onload = function() {
        var texture = new THREE.Texture(img);
        texture.needsUpdate = true;
        satTexture = texture; // store for roof face overlays
        var mat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
        groundPlane3d = new THREE.Mesh(geo, mat);
        groundPlane3d.position.set(0, -0.5, 0);
        scene3d.add(groundPlane3d);
        frameCamera();
      };

      img.onerror = function() {
        // Fallback: render a gray ground plane so the scene isn't empty
        var mat = new THREE.MeshBasicMaterial({ color: 0xd1d5db, side: THREE.DoubleSide });
        groundPlane3d = new THREE.Mesh(geo, mat);
        groundPlane3d.position.set(0, -0.5, 0);
        scene3d.add(groundPlane3d);
        frameCamera();
        setStatus3d('Satellite imagery unavailable — showing placeholder');
      };

      img.src = '/api/satellite?lat=' + designLat + '&lng=' + designLng + '&zoom=20&size=640';
    }

    /* ── Toggle LiDAR point cloud on/off (3D viewer always visible) ── */
    var lidarFetched = false;
    var lidarLoading = false;
    var lidarLoadError = null;
    var lidarVisible = false;

    document.getElementById('btn3dView').addEventListener('click', function() {
      if (!scene3d) return;

      if (lidarVisible) {
        // Hide LiDAR points only
        if (lidarPoints) lidarPoints.visible = false;
        lidarVisible = false;
        this.classList.remove('active');
        this.style.background = '';
        this.style.color = '';
        return;
      }

      // Show LiDAR points
      lidarVisible = true;
      this.classList.add('active');
      this.style.background = '#22c55e';
      this.style.color = '#000';

      if (lidarPoints) {
        lidarPoints.visible = true;
      } else if (!lidarFetched) {
        loadLidarPoints();
      }
    });

    function loadLidarPoints(silent) {
      if (lidarFetched || lidarLoading) return;
      if (typeof designLat === 'undefined') {
        if (!silent) setStatus3d('No location — search for an address first');
        return;
      }

      lidarLoading = true;
      var overlay = document.getElementById('lidarLoadingOverlay');
      if (!silent) {
        setStatus3d('Loading LiDAR points...');
        if (overlay) overlay.style.display = 'flex';
      }

      fetch('/api/lidar/points?lat=' + designLat + '&lng=' + designLng)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          lidarLoading = false;
          if (data.error) {
            if (overlay) overlay.style.display = 'none';
            lidarLoadError = data.error;
            if (!silent) setStatus3d('LiDAR: ' + data.error);
            return;
          }
          if (!data.points || data.points.length === 0) {
            if (overlay) overlay.style.display = 'none';
            lidarLoadError = data.message || 'No LiDAR data for this location';
            if (!silent) setStatus3d(lidarLoadError);
            return;
          }
          if (!silent) {
            if (overlay && overlay.querySelector && overlay.querySelector('span')) {
              overlay.querySelector('span').textContent = 'Aligning LiDAR...';
            } else {
              setStatus3d('Aligning LiDAR...');
            }
          }
          buildLidarPointCloud(data.points);
          lidarFetched = true;
        })
        .catch(function(e) {
          lidarLoading = false;
          if (overlay) overlay.style.display = 'none';
          lidarLoadError = e.message;
          if (!silent) setStatus3d('Error: ' + e.message);
        });
    }

    /* ── Build LiDAR point cloud (the "stuff in the glass") ── */
    var lidarRawPoints = null;

    function buildLidarPointCloud(points) {
      lidarRawPoints = points; // store for roof detection
      if (lidarPoints) { scene3d.remove(lidarPoints); lidarPoints = null; }

      var minZ = Infinity, maxZ = -Infinity;
      for (var i = 0; i < points.length; i++) {
        if (points[i][2] < minZ) minZ = points[i][2];
        if (points[i][2] > maxZ) maxZ = points[i][2];
      }
      var zRange = maxZ - minZ || 1;
      groundLevel = minZ;

      // Filter out ground-level points (within 1m of lowest elevation)
      var groundThreshold = minZ + 1.0;
      var filtered = [];
      for (var i = 0; i < points.length; i++) {
        if (points[i][2] > groundThreshold) filtered.push(points[i]);
      }

      var positions = new Float32Array(filtered.length * 3);
      var colors = new Float32Array(filtered.length * 3);

      // Use groundThreshold as the zero-line so lowest visible points sit at y=0
      for (var i = 0; i < filtered.length; i++) {
        var p = filtered[i];
        var local = geoToLocal(p[1], p[0]);
        positions[i * 3]     = local.x;
        positions[i * 3 + 1] = (p[2] - groundThreshold) * vertExag;
        positions[i * 3 + 2] = local.z;

        // Aurora-style elevation gradient: cyan → green → yellow → orange → red
        var ht = (p[2] - minZ) / zRange;
        var r, g, b;
        if (ht < 0.35) {
          var t = ht / 0.35;
          r = 0.2 * t; g = 0.7 + t * 0.15; b = 0.95 - t * 0.45; // cyan → teal-green
        } else if (ht < 0.55) {
          var t = (ht - 0.35) / 0.2;
          r = 0.2 + t * 0.4; g = 0.85 + t * 0.1; b = 0.5 - t * 0.35; // teal-green → yellow-green
        } else if (ht < 0.75) {
          var t = (ht - 0.55) / 0.2;
          r = 0.6 + t * 0.35; g = 0.95 - t * 0.35; b = 0.15 - t * 0.1; // yellow-green → orange
        } else {
          var t = (ht - 0.75) / 0.25;
          r = 0.95; g = 0.6 - t * 0.4; b = 0.05;              // orange → red
        }
        colors[i * 3] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
      }

      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      // Round point texture (circle instead of square)
      var ptCanvas = document.createElement('canvas');
      ptCanvas.width = 64; ptCanvas.height = 64;
      var ptCtx = ptCanvas.getContext('2d');
      ptCtx.beginPath();
      ptCtx.arc(32, 32, 30, 0, Math.PI * 2);
      ptCtx.fillStyle = '#ffffff';
      ptCtx.fill();
      var ptTexture = new THREE.Texture(ptCanvas);
      ptTexture.needsUpdate = true;

      var mat = new THREE.PointsMaterial({
        size: 3.5,
        map: ptTexture,
        vertexColors: true,
        sizeAttenuation: true,
        depthWrite: true,
        transparent: true,
        alphaTest: 0.5,
      });

      lidarPoints = new THREE.Points(geo, mat);
      lidarPoints.visible = false; // hidden until calibration applied
      lidarPoints.position.y = -0.75;
      scene3d.add(lidarPoints);

      // Auto-align: use Solar API roof segments to correct LiDAR offset
      autoAlignLidar(points, positions, minZ, zRange);
    }

    var autoAlignDone = false;
    var onAutoAlignDone = null; // callback after auto-align finishes

    // ── Two-layer classification color system ──────────────────────────
    //
    // Layer 1: Surface classification (base color for every point)
    //   ROOF surfaces are green regardless of geometry role.
    //
    // Layer 2: Geometry overlay (accent blended onto ROOF base only)
    //   Ridge, eave, valley, step_edge are rendered as tinted ROOF,
    //   NOT as full replacement colors.  This keeps ROOF dominant.
    //
    // CellLabel enum (gradient_detector.py):
    //   0=UNSURE, 1=GROUND, 2=ROOF, 3=LOWER_ROOF, 4=FLAT_ROOF,
    //   5=RIDGE_DOT, 6=NEAR_RIDGE, 7=TREE, 8=EAVE_DOT,
    //   9=RIDGE_EDGE_DOT, 10=VALLEY_DOT, 11=STEP_EDGE, 12=OBSTRUCTION_DOT

    // Surface base colors (Layer 1)
    var SURFACE_COLORS = {
      0:  [0.55, 0.55, 0.55],  // UNSURE         — light gray
      1:  [0.35, 0.35, 0.35],  // GROUND         — gray
      2:  [0.20, 0.85, 0.20],  // ROOF           — green
      3:  [0.15, 0.55, 0.85],  // LOWER_ROOF     — blue (distinct roof surface)
      4:  [0.55, 0.20, 0.80],  // FLAT_ROOF      — purple (distinct roof surface)
      7:  [0.60, 0.35, 0.10],  // TREE           — brown
      12: [1.00, 0.40, 0.70],  // OBSTRUCTION    — pink
    };

    // Geometry overlay accent colors (Layer 2) — blended onto ROOF green
    // These labels are geometry roles ON a roof surface, not surface types.
    var GEOMETRY_ACCENTS = {
      5:  [1.00, 0.10, 0.10],  // RIDGE_DOT      — red accent
      6:  [1.00, 0.70, 0.00],  // NEAR_RIDGE     — amber accent
      8:  [0.00, 0.85, 0.85],  // EAVE_DOT       — cyan accent
      9:  [1.00, 0.45, 0.00],  // RIDGE_EDGE_DOT — orange accent
      10: [0.15, 0.15, 0.90],  // VALLEY_DOT     — blue accent
      11: [0.90, 0.85, 0.15],  // STEP_EDGE      — gold accent
    };

    // Blend ratio: how much geometry accent shows over the ROOF base
    var GEOMETRY_BLEND = 0.55;  // 0 = pure ROOF green, 1 = pure accent

    function _classifyColor(label) {
      // If label has a geometry accent, blend it onto ROOF green
      var accent = GEOMETRY_ACCENTS[label];
      if (accent) {
        var base = SURFACE_COLORS[2]; // ROOF green
        var t = GEOMETRY_BLEND;
        return [
          base[0] * (1 - t) + accent[0] * t,
          base[1] * (1 - t) + accent[1] * t,
          base[2] * (1 - t) + accent[2] * t,
        ];
      }
      // Otherwise use surface color directly
      return SURFACE_COLORS[label] || SURFACE_COLORS[0];
    }

    function recolorLidarByClassification(cellLabelsGrid, gridInfo) {
      if (!lidarPoints || !cellLabelsGrid || !gridInfo) return;
      lidarVisible = true;          // prevent revealLidar() race from hiding points
      lidarPoints.visible = true;
      var geo = lidarPoints.geometry;
      var positions = geo.attributes.position.array;
      var colors = geo.attributes.color.array;
      var n = positions.length / 3;
      var ox = lidarPoints.position.x;
      var oz = lidarPoints.position.z;
      for (var i = 0; i < n; i++) {
        // Buffer positions are raw; Python grid was built with calibration offset applied.
        // Add the Three.js mesh offset to align buffer coords with grid coords.
        var wx = positions[i * 3] + ox;
        var wz = positions[i * 3 + 2] + oz;
        var col = Math.floor((wx - gridInfo.x_origin) / gridInfo.resolution);
        var row = Math.floor((wz - gridInfo.z_origin) / gridInfo.resolution);
        var label = 0;
        if (row >= 0 && row < gridInfo.rows && col >= 0 && col < gridInfo.cols) {
          label = cellLabelsGrid[row][col];
        }
        var c = _classifyColor(label);
        colors[i * 3]     = c[0];
        colors[i * 3 + 1] = c[1];
        colors[i * 3 + 2] = c[2];
      }
      geo.attributes.color.needsUpdate = true;
    }

    function autoAlignLidar(points, positions, minZ, zRange) {
      autoAlignDone = false;
      fetch('/api/solar/building-insights?lat=' + designLat + '&lng=' + designLng)
        .then(function(r) { return r.json(); })
        .then(function(data) {
          var si = data.solarPotential;
          if (!si || !si.roofSegmentStats || si.roofSegmentStats.length === 0) return;

          // Compute area-weighted centroid of roof segments
          var roofX = 0, roofZ = 0, totalArea = 0;
          si.roofSegmentStats.forEach(function(seg) {
            var area = (seg.stats && seg.stats.areaMeters2) || 1;
            var local = geoToLocal(seg.center.latitude, seg.center.longitude);
            roofX += local.x * area;
            roofZ += local.z * area;
            totalArea += area;
          });
          roofX /= totalArea;
          roofZ /= totalArea;

          // Find LiDAR elevation peak centroid (points above median + 1 stdev = likely building)
          var elevs = [];
          for (var i = 0; i < points.length; i++) elevs.push(points[i][2]);
          elevs.sort(function(a, b) { return a - b; });
          var median = elevs[Math.floor(elevs.length / 2)];
          var sumSq = 0;
          for (var i = 0; i < elevs.length; i++) sumSq += (elevs[i] - median) * (elevs[i] - median);
          var stdev = Math.sqrt(sumSq / elevs.length);
          var threshold = median + stdev * 0.5;

          var peakX = 0, peakZ = 0, peakCount = 0;
          for (var i = 0; i < points.length; i++) {
            if (points[i][2] >= threshold) {
              var local = geoToLocal(points[i][1], points[i][0]);
              peakX += local.x;
              peakZ += local.z;
              peakCount++;
            }
          }
          if (peakCount === 0) return;
          peakX /= peakCount;
          peakZ /= peakCount;

          // Apply offset to align LiDAR peaks with roof centroid
          var offsetX = roofX - peakX;
          var offsetZ = roofZ - peakZ;
          if (lidarPoints) {
            lidarPoints.position.x = offsetX;
            lidarPoints.position.z = offsetZ;
            console.log('Auto-align offset: x=' + offsetX.toFixed(2) + ' z=' + offsetZ.toFixed(2));
          }
        })
        .catch(function(e) { console.error('Auto-align error:', e); })
        .finally(function() {
          autoAlignDone = true;
          if (onAutoAlignDone) { onAutoAlignDone(); onAutoAlignDone = null; }
        });
    }

    /* ══════════════════════════════════════════════════════════════════════════
       TREE PLACEMENT TOOL — click center, drag radius, snap to LiDAR height
       ══════════════════════════════════════════════════════════════════════════ */

    function raycastGroundPlane(event) {
      var canvas = document.getElementById('canvas3d');
      var rect = canvas.getBoundingClientRect();
      mouse3d.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse3d.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster3d.setFromCamera(mouse3d, camera3d);
      var plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      var intersection = new THREE.Vector3();
      var hit = raycaster3d.ray.intersectPlane(plane, intersection);
      return hit ? intersection : null;
    }

    function getTreeHeightFromLidar(cx, cz, radius) {
      if (!lidarPoints) return radius * 2 * vertExag;
      var positions = lidarPoints.geometry.attributes.position.array;
      var count = positions.length / 3;
      var ox = lidarPoints.position.x;
      var oy = lidarPoints.position.y || 0;
      var oz = lidarPoints.position.z;
      var maxY = 0;
      var found = false;
      var r2 = radius * radius;
      for (var i = 0; i < count; i++) {
        var px = positions[i * 3] + ox;
        var py = positions[i * 3 + 1] + oy;
        var pz = positions[i * 3 + 2] + oz;
        var dx = px - cx;
        var dz = pz - cz;
        if (dx * dx + dz * dz <= r2) {
          if (py > maxY) maxY = py;
          found = true;
        }
      }
      return found ? maxY : (radius * 2 * vertExag);
    }

    function createTreePreviewCircle(center, radius) {
      removeTreePreview();
      var segs = 64;
      var positions = new Float32Array((segs + 1) * 3);
      for (var i = 0; i <= segs; i++) {
        var theta = (i / segs) * Math.PI * 2;
        positions[i * 3]     = center.x + Math.cos(theta) * radius;
        positions[i * 3 + 1] = 0.1;
        positions[i * 3 + 2] = center.z + Math.sin(theta) * radius;
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      var mat = new THREE.LineBasicMaterial({ color: 0x22c55e, linewidth: 2 });
      treePreviewCircle = new THREE.Line(geo, mat);
      scene3d.add(treePreviewCircle);
    }

    function updateTreePreviewCircle(center, radius) {
      if (!treePreviewCircle) return;
      var positions = treePreviewCircle.geometry.attributes.position.array;
      var segs = 64;
      for (var i = 0; i <= segs; i++) {
        var theta = (i / segs) * Math.PI * 2;
        positions[i * 3]     = center.x + Math.cos(theta) * radius;
        positions[i * 3 + 1] = 0.1;
        positions[i * 3 + 2] = center.z + Math.sin(theta) * radius;
      }
      treePreviewCircle.geometry.attributes.position.needsUpdate = true;
    }

    function updateTreePreviewMesh(center, radius) {
      if (treePreviewMesh) { scene3d.remove(treePreviewMesh); treePreviewMesh = null; }
      var estHeight = radius * 2 * vertExag;
      treePreviewMesh = buildTreeGroup(center, radius, estHeight, true);
      scene3d.add(treePreviewMesh);
    }

    function removeTreePreview() {
      if (treePreviewCircle) { scene3d.remove(treePreviewCircle); treePreviewCircle = null; }
      if (treePreviewMesh) { scene3d.remove(treePreviewMesh); treePreviewMesh = null; }
    }

    function buildTreeGroup(center, radius, sceneHeight, isPreview) {
      var group = new THREE.Group();
      var trunkR = radius * 0.15;
      var trunkH = sceneHeight * 0.35;
      var opacity = isPreview ? 0.4 : 0.85;

      var canopyY = sceneHeight * 0.7;
      var canopyBottom = canopyY - radius;
      var trunkBottom = -1.1;
      var actualTrunkH = canopyBottom - trunkBottom;
      var trunkGeo = new THREE.CylinderGeometry(trunkR, trunkR * 1.2, actualTrunkH, 8);
      var trunkMat = new THREE.MeshLambertMaterial({ color: 0x8B4513, transparent: isPreview, opacity: isPreview ? 0.3 : 1.0 });
      var trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(center.x, trunkBottom + actualTrunkH / 2, center.z);
      group.add(trunk);

      var canopyGeo = new THREE.SphereGeometry(radius, 16, 12);
      var canopyMat = new THREE.MeshLambertMaterial({ color: 0x228B22, transparent: true, opacity: opacity });
      var canopy = new THREE.Mesh(canopyGeo, canopyMat);
      canopy.position.set(center.x, canopyY, center.z);
      group.add(canopy);

      return group;
    }

    function createTreeMesh(center, radius, sceneHeight) {
      var mesh = buildTreeGroup(center, radius, sceneHeight, false);
      scene3d.add(mesh);
      return mesh;
    }

    function finalizeTree(center, radius) {
      var sceneHeight = getTreeHeightFromLidar(center.x, center.z, radius);
      var mesh = createTreeMesh(center, radius, sceneHeight);
      var mPerDegLng = 111320 * Math.cos(designLat * Math.PI / 180);
      var lng = center.x / mPerDegLng + designLng;
      var lat = -(center.z / metersPerDegLat) + designLat;
      trees3d.push({
        center: { x: center.x, z: center.z },
        radius: radius,
        height: sceneHeight / vertExag,
        mesh: mesh,
        lat: lat,
        lng: lng
      });
      markDirty();
    }

    function serializeTrees() {
      return trees3d.map(function(t) {
        return { lat: t.lat, lng: t.lng, radius: t.radius, height: t.height };
      });
    }

    function serializeRoofFaces() {
      return roofFaces3d.map(function(f) {
        return {
          vertices: f.vertices, pitch: f.pitch, sectionPitches: f.sectionPitches,
          azimuth: f.azimuth, height: f.height, color: f.color, deletedSections: f.deletedSections,
          dormers: (f.dormers || []).map(function(d) {
            return { type: d.type, vertices: d.vertices, pitch: d.pitch, pitchSide: d.pitchSide, pitchFront: d.pitchFront };
          })
        };
      });
    }

    /* ── Tree canvas event handlers ── */
    var hoveredTreeIdx = -1;

    function findTreeUnderCursor(event) {
      var canvas = document.getElementById('canvas3d');
      var rect = canvas.getBoundingClientRect();
      mouse3d.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse3d.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster3d.setFromCamera(mouse3d, camera3d);
      for (var i = 0; i < trees3d.length; i++) {
        if (!trees3d[i].mesh) continue;
        var hits = raycaster3d.intersectObjects(trees3d[i].mesh.children, false);
        if (hits.length > 0) return i;
      }
      return -1;
    }

    // mode: 'hover' = white tint, 'selected' = teal tint, falsy = reset
    function setTreeHighlight(idx, mode) {
      if (idx < 0 || idx >= trees3d.length) return;
      var group = trees3d[idx].mesh;
      if (!group) return;
      group.children.forEach(function(child) {
        if (child.material) {
          if (mode === 'hover') {
            if (!child.material._origColor) child.material._origColor = child.material.color.getHex();
            if (child.material._origOpacity === undefined) child.material._origOpacity = child.material.opacity;
            child.material.color.set(0xffffff);
            child.material.opacity = 0.9;
            child.material.transparent = true;
            child.material.needsUpdate = true;
          } else if (mode === 'selected' || mode === true) {
            if (!child.material._origColor) child.material._origColor = child.material.color.getHex();
            if (child.material._origOpacity === undefined) child.material._origOpacity = child.material.opacity;
            child.material.color.set(0x00bfa5);
            child.material.opacity = 0.85;
            child.material.transparent = true;
            child.material.needsUpdate = true;
          } else {
            if (child.material._origColor !== undefined) {
              child.material.color.set(child.material._origColor);
              delete child.material._origColor;
            }
            child.material.opacity = child.material._origOpacity !== undefined ? child.material._origOpacity : child.material.opacity;
            delete child.material._origOpacity;
            child.material.emissive = new THREE.Color(0x000000);
            child.material.needsUpdate = true;
          }
        }
      });
    }

    function deleteTree(idx) {
      if (idx < 0 || idx >= trees3d.length) return;
      var t = trees3d[idx];
      if (t.mesh) scene3d.remove(t.mesh);
      trees3d.splice(idx, 1);
      hoveredTreeIdx = -1;
      if (allTreesSelected) deselectAllTrees();
      markDirty();
    }

    var allTreesSelected = false;

    function selectAllTrees() {
      if (trees3d.length === 0) return;
      allTreesSelected = true;
      for (var i = 0; i < trees3d.length; i++) setTreeHighlight(i, 'selected');
      var bar = document.getElementById('treeBulkBar');
      var count = document.getElementById('treeBulkCount');
      if (bar) bar.style.display = 'flex';
      if (count) count.textContent = trees3d.length;
    }

    function deselectAllTrees() {
      allTreesSelected = false;
      for (var i = 0; i < trees3d.length; i++) setTreeHighlight(i, false);
      var bar = document.getElementById('treeBulkBar');
      if (bar) bar.style.display = 'none';
    }

    function deleteAllTrees() {
      if (trees3d.length === 0) return;
      for (var i = trees3d.length - 1; i >= 0; i--) {
        if (trees3d[i].mesh) scene3d.remove(trees3d[i].mesh);
      }
      trees3d.length = 0;
      hoveredTreeIdx = -1;
      allTreesSelected = false;
      closeTreePanel();
      var bar = document.getElementById('treeBulkBar');
      if (bar) bar.style.display = 'none';
      markDirty();
    }

    (function() {
      var canvas = document.getElementById('canvas3d');
      if (!canvas) return;

      var draggingTreeIdx = -1;
      var isDragging = false;
      var dragStartPos = null;

      canvas.addEventListener('pointerdown', function(e) {
        if (!camera3d || space3dHeld || treePlaceStep !== 0) return;
        if (roofDrawingMode) return;
        if (e.button !== 0) return; // left click only
        if (hoveredTreeIdx >= 0) {
          e.preventDefault();
          e.stopPropagation();
          pushUndo();
          draggingTreeIdx = hoveredTreeIdx;
          isDragging = false;
          var hit = raycastGroundPlane(e);
          dragStartPos = hit ? { x: hit.x, z: hit.z } : null;
          canvas.style.cursor = 'grabbing';
          if (controls3d) controls3d.enabled = false;
        }
      }, true);

      document.addEventListener('pointerup', function(e) {
        if (draggingTreeIdx >= 0) {
          if (isDragging) {
            // Finish drag — update lat/lng
            var t = trees3d[draggingTreeIdx];
            var mPerDegLng = 111320 * Math.cos(designLat * Math.PI / 180);
            t.lng = t.center.x / mPerDegLng + designLng;
            t.lat = -(t.center.z / metersPerDegLat) + designLat;
            markDirty();
            if (selectedTreeIdx === draggingTreeIdx) selectTree(draggingTreeIdx);
          }
          canvas.style.cursor = hoveredTreeIdx >= 0 ? 'grab' : 'crosshair';
          draggingTreeIdx = -1;
          isDragging = false;
          dragStartPos = null;
          if (controls3d) controls3d.enabled = true;
        }
      });

      canvas.addEventListener('click', function(e) {
        if (!treePlacingMode || !camera3d || space3dHeld) return;
        // If we just finished dragging, don't process as a click
        if (isDragging) return;
        // If hovering over existing tree and not mid-placement, ignore click for placement (select instead)
        if (treePlaceStep === 0 && hoveredTreeIdx >= 0) return;
        var hit = raycastGroundPlane(e);
        if (!hit) return;

        if (treePlaceStep === 0) {
          treeCenterPoint = { x: hit.x, z: hit.z };
          createTreePreviewCircle(treeCenterPoint, 0.5);
          treePlaceStep = 1;
          var banner = document.getElementById('treeModeBanner');
          if (banner) banner.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M12 22v-5"/><path d="M8 17l4-5 4 5"/><path d="M6 17l6-8 6 8"/><path d="M9 9l3-4 3 4"/></svg> Move to set canopy radius, click to confirm';
        } else if (treePlaceStep === 1) {
          var dx = hit.x - treeCenterPoint.x;
          var dz = hit.z - treeCenterPoint.z;
          var radius = Math.sqrt(dx * dx + dz * dz);
          radius = Math.max(0.5, Math.min(radius, 15));
          removeTreePreview();
          pushUndo();
          finalizeTree(treeCenterPoint, radius);
          treeCenterPoint = null;
          treePlaceStep = 0;
          var banner = document.getElementById('treeModeBanner');
          if (banner) banner.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><path d="M12 22v-5"/><path d="M8 17l4-5 4 5"/><path d="M6 17l6-8 6 8"/><path d="M9 9l3-4 3 4"/></svg> Tree Mode — Click to place center, move to set radius, click to confirm';
        }
      });

      canvas.addEventListener('pointermove', function(e) {
        if (!camera3d || space3dHeld) return;

        // Tree dragging
        if (draggingTreeIdx >= 0 && dragStartPos) {
          e.preventDefault();
          var hit = raycastGroundPlane(e);
          if (!hit) return;
          var dx = hit.x - dragStartPos.x;
          var dz = hit.z - dragStartPos.z;
          if (!isDragging && (Math.abs(dx) > 0.05 || Math.abs(dz) > 0.05)) isDragging = true;
          if (isDragging) {
            var t = trees3d[draggingTreeIdx];
            t.center.x += dx;
            t.center.z += dz;
            if (t.mesh) {
              t.mesh.children.forEach(function(child) {
                child.position.x += dx;
                child.position.z += dz;
              });
            }
            dragStartPos = { x: hit.x, z: hit.z };
            canvas.style.cursor = 'grabbing';
          }
          return;
        }

        // Tree hover highlight (works in and outside tree mode)
        if (!roofDrawingMode && treePlaceStep === 0 && !isViewCubeBusy()) {
          var idx = findTreeUnderCursor(e);
          if (idx !== hoveredTreeIdx) {
            // Unhover previous: restore to selected teal or default
            if (hoveredTreeIdx >= 0 && !allTreesSelected) {
              if (hoveredTreeIdx === selectedTreeIdx || multiSelectedTrees.indexOf(hoveredTreeIdx) >= 0) {
                setTreeHighlight(hoveredTreeIdx, 'selected');
              } else {
                setTreeHighlight(hoveredTreeIdx, false);
              }
            }
            hoveredTreeIdx = idx;
            if (hoveredTreeIdx >= 0) {
              setTreeHighlight(hoveredTreeIdx, 'hover');
              canvas.style.cursor = 'grab';
            } else {
              canvas.style.cursor = treePlacingMode ? 'crosshair' : '';
            }
          }
        }

        // Preview circle during radius drag
        if (treePlacingMode && treePlaceStep === 1 && treeCenterPoint) {
          var hit = raycastGroundPlane(e);
          if (!hit) return;
          var dx = hit.x - treeCenterPoint.x;
          var dz = hit.z - treeCenterPoint.z;
          var radius = Math.sqrt(dx * dx + dz * dz);
          radius = Math.max(0.5, Math.min(radius, 15));
          updateTreePreviewCircle(treeCenterPoint, radius);
          updateTreePreviewMesh(treeCenterPoint, radius);
        }
      });

      // Clear tree hover when pointer leaves canvas (e.g. moves onto viewcube)
      canvas.addEventListener('pointerleave', function() {
        if (hoveredTreeIdx >= 0) {
          if (hoveredTreeIdx === selectedTreeIdx || multiSelectedTrees.indexOf(hoveredTreeIdx) >= 0) {
            setTreeHighlight(hoveredTreeIdx, 'selected');
          } else if (!allTreesSelected) {
            setTreeHighlight(hoveredTreeIdx, false);
          }
          hoveredTreeIdx = -1;
          canvas.style.cursor = '';
        }
      });

      /* ── Marquee / box-select for trees ── */
      var marqueeActive = false;
      var marqueeStart = null;
      var marqueeEnd = null;
      var marqueeDiv = null;
      var marqueePending = false;

      function createMarqueeDiv() {
        var d = document.createElement('div');
        d.style.cssText = 'position:fixed;border:2px dashed #00bfa5;background:rgba(0,191,165,0.08);pointer-events:none;z-index:50;display:none;';
        document.body.appendChild(d);
        return d;
      }

      // Capture phase — fires BEFORE OrbitControls
      canvas.addEventListener('pointerdown', function(e) {
        if (!camera3d || space3dHeld || roofDrawingMode || treePlaceStep !== 0) return;
        if (e.button !== 0) return;
        if (hoveredTreeIdx >= 0 || draggingTreeIdx >= 0) return;
        // Don't start marquee if cursor is over a roof handle (corner or edge)
        if (findHandleUnderCursor && findHandleUnderCursor(e)) return;
        if (findEdgeHandleUnderCursor && findEdgeHandleUnderCursor(e)) return;
        if (findDormerHandleUnderCursor && findDormerHandleUnderCursor(e)) return;
        marqueeStart = { x: e.clientX, y: e.clientY };
        marqueeEnd = { x: e.clientX, y: e.clientY };
        marqueeActive = false;
        marqueePending = true;
      }, true);

      document.addEventListener('pointermove', function(e) {
        if (!marqueePending || !marqueeStart) return;
        var dx = e.clientX - marqueeStart.x;
        var dy = e.clientY - marqueeStart.y;
        marqueeEnd = { x: e.clientX, y: e.clientY };
        if (!marqueeActive && (Math.abs(dx) > 5 || Math.abs(dy) > 5)) {
          marqueeActive = true;
          if (!marqueeDiv) marqueeDiv = createMarqueeDiv();
          marqueeDiv.style.display = 'block';
          if (controls3d) controls3d.enabled = false;
        }
        if (marqueeActive && marqueeDiv) {
          var left = Math.min(marqueeStart.x, e.clientX);
          var top = Math.min(marqueeStart.y, e.clientY);
          marqueeDiv.style.left = left + 'px';
          marqueeDiv.style.top = top + 'px';
          marqueeDiv.style.width = Math.abs(dx) + 'px';
          marqueeDiv.style.height = Math.abs(dy) + 'px';
        }
      });

      document.addEventListener('pointerup', function(e) {
        if (!marqueePending) return;
        if (marqueeActive && marqueeStart && marqueeEnd) {
          var left = Math.min(marqueeStart.x, marqueeEnd.x);
          var right = Math.max(marqueeStart.x, marqueeEnd.x);
          var top = Math.min(marqueeStart.y, marqueeEnd.y);
          var bottom = Math.max(marqueeStart.y, marqueeEnd.y);
          var rect = canvas.getBoundingClientRect();

          var hits = [];

          for (var i = 0; i < trees3d.length; i++) {
            var t = trees3d[i];
            var pos = new THREE.Vector3(t.center.x, 0, t.center.z);
            pos.project(camera3d);
            var sx = (pos.x * 0.5 + 0.5) * rect.width + rect.left;
            var sy = (-pos.y * 0.5 + 0.5) * rect.height + rect.top;

            if (sx >= left && sx <= right && sy >= top && sy <= bottom) {
              hits.push(i);
            }
          }


          if (hits.length > 0) {
            // Clear previous selection without unhighlighting (we'll re-highlight)
            clearMultiSelect();
            if (selectedTreeIdx >= 0 && selectedTreeIdx < trees3d.length) {
              setTreeHighlight(selectedTreeIdx, false);
            }
            selectedTreeIdx = -1;
            document.getElementById('treePanel').classList.add('hidden');
            // Select the hits
            hits.forEach(function(idx) {
              multiSelectedTrees.push(idx);
              setTreeHighlight(idx, 'selected');
            });
            if (hits.length === 1) {
              selectTreeSingle(hits[0]);
            }
          }

          if (marqueeDiv) marqueeDiv.style.display = 'none';
          marqueeJustFinished = true;
        }
        if (controls3d) controls3d.enabled = true;
        marqueeStart = null;
        marqueeEnd = null;
        marqueeActive = false;
        marqueePending = false;
      });

      // Delete/Backspace to remove hovered tree
      var copiedTree = null;
      document.addEventListener('keydown', function(e) {
        if (e.target.matches('input,textarea,select')) return;
        // Bulk delete all trees
        if ((e.key === 'Delete' || e.key === 'Backspace') && allTreesSelected) {
          e.preventDefault();
          pushUndo();
          deleteAllTrees();
          return;
        }
        // Delete multi-selected trees
        if ((e.key === 'Delete' || e.key === 'Backspace') && multiSelectedTrees.length > 0) {
          e.preventDefault();
          pushUndo();
          // Delete in reverse index order to avoid index shifting
          var sorted = multiSelectedTrees.slice().sort(function(a, b) { return b - a; });
          sorted.forEach(function(i) {
            if (i >= 0 && i < trees3d.length) {
              if (trees3d[i].mesh) scene3d.remove(trees3d[i].mesh);
              trees3d.splice(i, 1);
            }
          });
          multiSelectedTrees = [];
          hoveredTreeIdx = -1;
          selectedTreeIdx = -1;
          var bar = document.getElementById('treeBulkBar');
          if (bar) bar.style.display = 'none';
          document.getElementById('treePanel').classList.add('hidden');
          markDirty();
          return;
        }
        // Delete hovered or selected tree
        if ((e.key === 'Delete' || e.key === 'Backspace') && (hoveredTreeIdx >= 0 || selectedTreeIdx >= 0)) {
          e.preventDefault();
          pushUndo();
          var delIdx = hoveredTreeIdx >= 0 ? hoveredTreeIdx : selectedTreeIdx;
          deleteTree(delIdx);
          closeTreePanel();
        }
        // Cmd/Ctrl+C — copy selected or hovered tree
        if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
          var idx = selectedTreeIdx >= 0 ? selectedTreeIdx : hoveredTreeIdx;
          if (idx >= 0 && idx < trees3d.length) {
            var t = trees3d[idx];
            copiedTree = { radius: t.radius, height: t.height, removeTrunk: t.removeTrunk || false, trunkDiam: t.trunkDiam };
          }
        }
        // Cmd/Ctrl+V — paste tree at slight offset from source or center
        if ((e.metaKey || e.ctrlKey) && e.key === 'v' && copiedTree) {
          e.preventDefault();
          pushUndo();
          var sourceIdx = selectedTreeIdx >= 0 ? selectedTreeIdx : hoveredTreeIdx;
          var baseCenter;
          if (sourceIdx >= 0 && sourceIdx < trees3d.length) {
            baseCenter = { x: trees3d[sourceIdx].center.x + copiedTree.radius * 2.5, z: trees3d[sourceIdx].center.z };
          } else {
            // Paste near camera target
            baseCenter = { x: (controls3d ? controls3d.target.x : 0) + copiedTree.radius * 2, z: (controls3d ? controls3d.target.z : 0) };
          }
          var sceneH = copiedTree.height * vertExag;
          var mesh = buildTreeGroup(baseCenter, copiedTree.radius, sceneH, false);
          if (copiedTree.removeTrunk && mesh.children.length > 0) mesh.children[0].visible = false;
          scene3d.add(mesh);
          var mPerDegLng = 111320 * Math.cos(designLat * Math.PI / 180);
          trees3d.push({
            center: baseCenter,
            radius: copiedTree.radius,
            height: copiedTree.height,
            mesh: mesh,
            lat: -(baseCenter.z / metersPerDegLat) + designLat,
            lng: baseCenter.x / mPerDegLng + designLng,
            removeTrunk: copiedTree.removeTrunk,
            trunkDiam: copiedTree.trunkDiam
          });
          markDirty();
          selectTree(trees3d.length - 1);
        }
      });

      // Click existing tree to select & show panel (works in and outside tree mode)
      // Click empty space to deselect tree and close panel
      var marqueeJustFinished = false;
      canvas.addEventListener('click', function(e) {
        if (marqueeJustFinished) { marqueeJustFinished = false; return; }
        if (treePlaceStep !== 0 || roofDrawingMode || space3dHeld || isViewCubeBusy()) return;
        if (isDragging) return;
        var idx = findTreeUnderCursor(e);
        if (idx >= 0) {
          if (e.metaKey || e.ctrlKey) {
            addToMultiSelect(idx);
          } else {
            selectTree(idx);
          }
          e.stopImmediatePropagation();
        } else if (selectedTreeIdx >= 0 || multiSelectedTrees.length > 0 || allTreesSelected) {
          closeTreePanel();
        }
      });
    })();

    /* ── Tree Properties Panel Logic ── */
    var selectedTreeIdx = -1;
    var multiSelectedTrees = []; // indices of multi-selected trees
    var M_TO_FT = 3.28084;
    var FT_TO_M = 1 / M_TO_FT;

    function clearMultiSelect() {
      multiSelectedTrees.forEach(function(i) {
        if (i >= 0 && i < trees3d.length) setTreeHighlight(i, false);
      });
      multiSelectedTrees = [];
      var bar = document.getElementById('treeBulkBar');
      if (bar) bar.style.display = 'none';
    }

    function addToMultiSelect(idx) {
      // Promote single-selected tree into multi-selection first
      if (selectedTreeIdx >= 0 && multiSelectedTrees.indexOf(selectedTreeIdx) < 0) {
        multiSelectedTrees.push(selectedTreeIdx);
        setTreeHighlight(selectedTreeIdx, 'selected');
      }
      if (multiSelectedTrees.indexOf(idx) >= 0) {
        // Already selected — deselect it
        multiSelectedTrees.splice(multiSelectedTrees.indexOf(idx), 1);
        setTreeHighlight(idx, false);
      } else {
        multiSelectedTrees.push(idx);
        setTreeHighlight(idx, 'selected');
      }
      if (multiSelectedTrees.length > 0) {
        var bar = document.getElementById('treeBulkBar');
        var count = document.getElementById('treeBulkCount');
        if (bar) bar.style.display = 'flex';
        if (count) count.textContent = multiSelectedTrees.length;
      } else {
        var bar = document.getElementById('treeBulkBar');
        if (bar) bar.style.display = 'none';
      }
      // If exactly one in multi-select, show its props; otherwise hide panel
      if (multiSelectedTrees.length === 1) {
        selectTreeSingle(multiSelectedTrees[0]);
      } else {
        selectedTreeIdx = -1;
        document.getElementById('treePanel').classList.add('hidden');
      }
    }

    function selectTree(idx) {
      // Clear any multi-selection
      clearMultiSelect();
      // Unhighlight previous selection
      if (selectedTreeIdx >= 0 && selectedTreeIdx < trees3d.length) {
        setTreeHighlight(selectedTreeIdx, false);
      }
      selectTreeSingle(idx);
    }

    function selectTreeSingle(idx) {
      // Unhighlight previous if different
      if (selectedTreeIdx >= 0 && selectedTreeIdx !== idx && selectedTreeIdx < trees3d.length) {
        setTreeHighlight(selectedTreeIdx, false);
      }
      selectedTreeIdx = idx;
      setTreeHighlight(idx, 'selected');
      var t = trees3d[idx];
      var sceneHeight = t.height * vertExag;
      var crownH = sceneHeight * 0.7;
      var crownDiam = t.radius * 2;
      var trunkDiam = t.radius * 0.15 * 2;
      var removeTrunk = t.removeTrunk || false;

      var hFt = (t.height * M_TO_FT).toFixed(1);
      var chFt = (crownH / vertExag * M_TO_FT).toFixed(1);
      var cdFt = (crownDiam * M_TO_FT).toFixed(1);
      var tdFt = (trunkDiam * M_TO_FT).toFixed(1);
      document.getElementById('tpHeight').value = hFt;
      document.getElementById('tpCrownHeight').value = chFt;
      document.getElementById('tpCrownDiam').value = cdFt;
      document.getElementById('tpTrunkDiam').value = tdFt;
      // Sync sliders
      document.getElementById('tpHeightSlider').value = hFt;
      document.getElementById('tpCrownHeightSlider').value = chFt;
      document.getElementById('tpCrownDiamSlider').value = cdFt;
      document.getElementById('tpTrunkDiamSlider').value = tdFt;
      var sw = document.getElementById('tpRemoveTrunk');
      sw.classList.toggle('on', removeTrunk);
      // Hide any open slider rows
      ['tpHeightSliderRow','tpCrownHeightSliderRow','tpCrownDiamSliderRow','tpTrunkDiamSliderRow'].forEach(function(id) {
        document.getElementById(id).classList.remove('visible');
      });

      document.getElementById('treePanel').classList.remove('hidden');
      document.getElementById('rightPanel').classList.add('hidden');
    }

    function closeTreePanel() {
      if (selectedTreeIdx >= 0 && selectedTreeIdx < trees3d.length) {
        setTreeHighlight(selectedTreeIdx, false);
      }
      selectedTreeIdx = -1;
      clearMultiSelect();
      document.getElementById('treePanel').classList.add('hidden');
    }

    function rebuildSelectedTree() {
      if (selectedTreeIdx < 0 || selectedTreeIdx >= trees3d.length) return;
      var t = trees3d[selectedTreeIdx];
      if (t.mesh) scene3d.remove(t.mesh);

      var sceneHeight = t.height * vertExag;
      t.mesh = buildTreeGroup(t.center, t.radius, sceneHeight, false);

      // Handle trunk removal
      if (t.removeTrunk && t.mesh.children.length > 0) {
        t.mesh.children[0].visible = false;
      }

      scene3d.add(t.mesh);
      markDirty();
    }

    // Close button
    document.getElementById('tpClose').addEventListener('click', closeTreePanel);

    // Delete button
    document.getElementById('tpDelete').addEventListener('click', function() {
      if (selectedTreeIdx >= 0) {
        pushUndo();
        deleteTree(selectedTreeIdx);
        closeTreePanel();
      }
    });

    // Duplicate button
    document.getElementById('tpDuplicate').addEventListener('click', function() {
      if (selectedTreeIdx < 0) return;
      var t = trees3d[selectedTreeIdx];
      var offset = t.radius * 2.5;
      var newCenter = { x: t.center.x + offset, z: t.center.z };
      var sceneHeight = t.height * vertExag;
      var mesh = buildTreeGroup(newCenter, t.radius, sceneHeight, false);
      scene3d.add(mesh);
      var mPerDegLng = 111320 * Math.cos(designLat * Math.PI / 180);
      trees3d.push({
        center: newCenter,
        radius: t.radius,
        height: t.height,
        mesh: mesh,
        lat: -(newCenter.z / metersPerDegLat) + designLat,
        lng: newCenter.x / mPerDegLng + designLng,
        removeTrunk: t.removeTrunk || false
      });
      markDirty();
      selectTree(trees3d.length - 1);
    });

    // Fit to LIDAR
    document.getElementById('tpFitLidar').addEventListener('click', function() {
      if (selectedTreeIdx < 0) return;
      var t = trees3d[selectedTreeIdx];
      var lidarH = getTreeHeightFromLidar(t.center.x, t.center.z, t.radius);
      t.height = lidarH / vertExag;
      rebuildSelectedTree();
      selectTree(selectedTreeIdx);
    });

    // Input change handlers — use 'input' for live updates as user types
    document.getElementById('tpHeight').addEventListener('input', function() {
      if (selectedTreeIdx < 0 || !this.value) return;
      trees3d[selectedTreeIdx].height = parseFloat(this.value) * FT_TO_M;
      rebuildSelectedTree();
    });
    document.getElementById('tpCrownDiam').addEventListener('input', function() {
      if (selectedTreeIdx < 0 || !this.value) return;
      trees3d[selectedTreeIdx].radius = (parseFloat(this.value) * FT_TO_M) / 2;
      rebuildSelectedTree();
      document.getElementById('tpTrunkDiam').value = (trees3d[selectedTreeIdx].radius * 0.15 * 2 * M_TO_FT).toFixed(1);
    });
    document.getElementById('tpCrownHeight').addEventListener('input', function() {
      if (selectedTreeIdx < 0 || !this.value) return;
      var crownHM = parseFloat(this.value) * FT_TO_M;
      trees3d[selectedTreeIdx].height = (crownHM / 0.7);
      rebuildSelectedTree();
      document.getElementById('tpHeight').value = (trees3d[selectedTreeIdx].height * M_TO_FT).toFixed(1);
    });
    document.getElementById('tpTrunkDiam').addEventListener('input', function() {
      if (selectedTreeIdx < 0 || !this.value) return;
      trees3d[selectedTreeIdx].trunkDiam = parseFloat(this.value) * FT_TO_M;
      rebuildSelectedTree();
    });

    /* ── Slider show/hide on input focus ── */
    var sliderPairs = [
      { input: 'tpHeight',      slider: 'tpHeightSlider',      row: 'tpHeightSliderRow' },
      { input: 'tpCrownHeight', slider: 'tpCrownHeightSlider', row: 'tpCrownHeightSliderRow' },
      { input: 'tpCrownDiam',   slider: 'tpCrownDiamSlider',   row: 'tpCrownDiamSliderRow' },
      { input: 'tpTrunkDiam',   slider: 'tpTrunkDiamSlider',   row: 'tpTrunkDiamSliderRow' }
    ];
    sliderPairs.forEach(function(p) {
      var inp = document.getElementById(p.input);
      var slider = document.getElementById(p.slider);
      var row = document.getElementById(p.row);
      // Show slider on focus
      inp.addEventListener('focus', function() {
        // Hide all other slider rows
        sliderPairs.forEach(function(x) { document.getElementById(x.row).classList.remove('visible'); });
        slider.value = parseFloat(inp.value) || 0;
        row.classList.add('visible');
      });
      // Sync slider → input and trigger live update
      slider.addEventListener('input', function() {
        inp.value = parseFloat(slider.value).toFixed(1);
        inp.dispatchEvent(new Event('input'));
      });
    });
    // +/- buttons
    document.querySelectorAll('.tp-slider-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var inp = document.getElementById(btn.getAttribute('data-input'));
        var delta = parseFloat(btn.getAttribute('data-delta'));
        var val = parseFloat(inp.value) + delta;
        var min = parseFloat(inp.min) || 0;
        if (val < min) val = min;
        inp.value = val.toFixed(1);
        inp.dispatchEvent(new Event('input'));
        // Update slider too
        sliderPairs.forEach(function(p) {
          if (p.input === btn.getAttribute('data-input')) {
            document.getElementById(p.slider).value = val;
          }
        });
      });
    });
    // Click outside tree panel closes sliders
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.tree-panel')) {
        sliderPairs.forEach(function(p) { document.getElementById(p.row).classList.remove('visible'); });
      }
    });

    // Remove trunk toggle
    document.getElementById('tpRemoveTrunk').addEventListener('click', function() {
      if (selectedTreeIdx < 0) return;
      this.classList.toggle('on');
      trees3d[selectedTreeIdx].removeTrunk = this.classList.contains('on');
      rebuildSelectedTree();
    });

    // Escape closes panel
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape' && selectedTreeIdx >= 0) {
        closeTreePanel();
      }
    });

    /* ══════════════════════════════════════════════════════════════════════════
       ROOF FACE DRAWING & CAD MODELING ENGINE
       Aurora-style SmartRoof: click to place vertices, polygon roof faces,
       draggable handles, edge measurements, pitch/azimuth properties.
       ══════════════════════════════════════════════════════════════════════════ */

    /* ── Helper: Shoelace area (m²) ── */
    function calcPolygonArea(verts) {
      var n = verts.length, area = 0;
      for (var i = 0; i < n; i++) {
        var j = (i + 1) % n;
        area += verts[i].x * verts[j].z;
        area -= verts[j].x * verts[i].z;
      }
      return Math.abs(area) / 2;
    }

    /* ── Text sprite for edge labels ── */
    function makeTextSprite(text) {
      var canvas = document.createElement('canvas');
      canvas.width = 256; canvas.height = 64;
      var ctx = canvas.getContext('2d');
      ctx.font = 'Bold 26px -apple-system, BlinkMacSystemFont, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
      ctx.strokeText(text, 128, 32);
      ctx.fillStyle = '#fff';
      ctx.fillText(text, 128, 32);
      var tex = new THREE.CanvasTexture(canvas);
      var mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
      var sprite = new THREE.Sprite(mat);
      sprite.scale.set(3.5, 0.875, 1);
      return sprite;
    }

    /* ── Build edge measurement labels ── */
    function buildEdgeLabels(verts) {
      var labels = [];
      for (var i = 0; i < verts.length; i++) {
        var a = verts[i], b = verts[(i + 1) % verts.length];
        var dx = b.x - a.x, dz = b.z - a.z;
        var lengthFt = (Math.sqrt(dx * dx + dz * dz) * 3.28084).toFixed(1);
        var sprite = makeTextSprite(lengthFt + ' ft');
        sprite.position.set((a.x + b.x) / 2, 0.6, (a.z + b.z) / 2);
        scene3d.add(sprite);
        labels.push(sprite);
      }
      return labels;
    }

    /* ── Fit oriented minimum bounding rectangle to a set of points ── */
    function fitRectangle(pts) {
      if (pts.length < 2) return pts;
      var hull = convexHull2d(pts);
      if (hull.length < 2) return pts;

      var bestArea = Infinity, bestRect = null;
      for (var i = 0; i < hull.length; i++) {
        var a = hull[i], b = hull[(i + 1) % hull.length];
        var angle = Math.atan2(b.z - a.z, b.x - a.x);
        var cos = Math.cos(-angle), sin = Math.sin(-angle);

        // Rotate all hull points to align this edge with X axis
        var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (var j = 0; j < hull.length; j++) {
          var rx = hull[j].x * cos - hull[j].z * sin;
          var rz = hull[j].x * sin + hull[j].z * cos;
          if (rx < minX) minX = rx;
          if (rx > maxX) maxX = rx;
          if (rz < minZ) minZ = rz;
          if (rz > maxZ) maxZ = rz;
        }

        var area = (maxX - minX) * (maxZ - minZ);
        if (area < bestArea) {
          bestArea = area;
          // Rotate the 4 corners back to original orientation
          var cosB = Math.cos(angle), sinB = Math.sin(angle);
          bestRect = [
            { x: minX * cosB - minZ * sinB, z: minX * sinB + minZ * cosB },
            { x: maxX * cosB - minZ * sinB, z: maxX * sinB + minZ * cosB },
            { x: maxX * cosB - maxZ * sinB, z: maxX * sinB + maxZ * cosB },
            { x: minX * cosB - maxZ * sinB, z: minX * sinB + maxZ * cosB }
          ];
        }
      }
      return bestRect || pts;
    }

    /* ── Compute shared hip roof geometry ── */
    function computeHipGeometry(verts, pitchDeg) {
      var d01 = Math.sqrt(Math.pow(verts[1].x - verts[0].x, 2) + Math.pow(verts[1].z - verts[0].z, 2));
      var d12 = Math.sqrt(Math.pow(verts[2].x - verts[1].x, 2) + Math.pow(verts[2].z - verts[1].z, 2));
      var v0, v1, v2, v3, longLen, shortLen;
      if (d01 >= d12) {
        v0 = verts[0]; v1 = verts[1]; v2 = verts[2]; v3 = verts[3];
        longLen = d01; shortLen = d12;
      } else {
        v0 = verts[1]; v1 = verts[2]; v2 = verts[3]; v3 = verts[0];
        longLen = d12; shortLen = d01;
      }
      var inset = shortLen / 2;
      var ldx = (v1.x - v0.x) / longLen, ldz = (v1.z - v0.z) / longLen;
      var m0x = (v0.x + v3.x) / 2, m0z = (v0.z + v3.z) / 2;
      var m1x = (v1.x + v2.x) / 2, m1z = (v1.z + v2.z) / 2;
      var r0x = m0x + ldx * inset, r0z = m0z + ldz * inset;
      var r1x = m1x - ldx * inset, r1z = m1z - ldz * inset;
      // Peak = midpoint of ridge, Mf = midpoint of v0-v1 (front), Mb = midpoint of v3-v2 (back)
      var px = (r0x + r1x) / 2, pz = (r0z + r1z) / 2;
      var mfx = (v0.x + v1.x) / 2, mfz = (v0.z + v1.z) / 2;
      var mbx = (v3.x + v2.x) / 2, mbz = (v3.z + v2.z) / 2;
      return { v0: v0, v1: v1, v2: v2, v3: v3, r0x: r0x, r0z: r0z, r1x: r1x, r1z: r1z,
               m0x: m0x, m0z: m0z, m1x: m1x, m1z: m1z, inset: inset, ldx: ldx, ldz: ldz,
               px: px, pz: pz, mfx: mfx, mfz: mfz, mbx: mbx, mbz: mbz };
    }

    /* ── Build 3D hip-roof section meshes (returns array of meshes per section) ── */
    function buildRoofSectionMeshes(verts, color, pitchDeg, deletedSections, selectedSection) {
      var pitch = pitchDeg || 0;
      var ds = deletedSections || [false, false, false, false];
      var ss = (selectedSection !== undefined) ? selectedSection : -1;

      // For non-rectangular or zero-pitch, use flat mesh — single section
      if (verts.length !== 4 || pitch <= 0) {
        var shape = new THREE.Shape();
        shape.moveTo(verts[0].x, -verts[0].z);
        for (var i = 1; i < verts.length; i++) shape.lineTo(verts[i].x, -verts[i].z);
        shape.closePath();
        var geo = new THREE.ShapeGeometry(shape);
        geo.rotateX(-Math.PI / 2);
        return [_applyRoofSectionMaterial(geo, color, 0.05, ss === 0 || ss === -2)];
      }

      var hip = computeHipGeometry(verts, pitch);
      var ridgeY = hip.inset * Math.tan(pitch * Math.PI / 180) + 0.05;
      var baseY = 0.05;

      // Compute section geometry based on deletion pattern
      var sectionPositions = computeSectionGeometry(hip, ds, ridgeY, baseY);

      var meshes = [];
      for (var i = 0; i < 4; i++) {
        if (ds[i] || !sectionPositions[i]) { meshes.push(null); continue; }
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(sectionPositions[i], 3));
        geo.computeVertexNormals();
        meshes.push(_applyRoofSectionMaterial(geo, color, 0, ss === i || ss === -2));
      }
      return meshes;
    }

    /* ── Compute section vertex positions based on deletion pattern ── */
    function computeSectionGeometry(hip, ds, ridgeY, baseY) {
      var h = hip;
      var rY = ridgeY, bY = baseY;
      // Helper to build triangle positions
      function tri(ax,ay,az, bx,by,bz, cx,cy,cz) {
        return [ax,ay,az, bx,by,bz, cx,cy,cz];
      }
      // Helper to build quad positions (2 triangles)
      function quad(ax,ay,az, bx,by,bz, cx,cy,cz, dx,dy,dz) {
        return [ax,ay,az, bx,by,bz, cx,cy,cz, ax,ay,az, cx,cy,cz, dx,dy,dz];
      }

      var anyTrapDel = ds[2] || ds[3];
      var bothTrapDel = ds[2] && ds[3];

      // Case: no trapezoids deleted — original hip roof logic (with hip tri expansion)
      if (!anyTrapDel) {
        var er0x = ds[0] ? h.m0x : h.r0x;
        var er0z = ds[0] ? h.m0z : h.r0z;
        var er1x = ds[1] ? h.m1x : h.r1x;
        var er1z = ds[1] ? h.m1z : h.r1z;
        return [
          // S0: hip tri v0-R0-v3
          tri(h.v0.x,bY,h.v0.z, h.r0x,rY,h.r0z, h.v3.x,bY,h.v3.z),
          // S1: hip tri v1-v2-R1
          tri(h.v1.x,bY,h.v1.z, h.v2.x,bY,h.v2.z, h.r1x,rY,h.r1z),
          // S2: front trap v0-v1-eR1-eR0
          quad(h.v0.x,bY,h.v0.z, h.v1.x,bY,h.v1.z, er1x,rY,er1z, er0x,rY,er0z),
          // S3: back trap v3-eR0-eR1-v2
          quad(h.v3.x,bY,h.v3.z, er0x,rY,er0z, er1x,rY,er1z, h.v2.x,bY,h.v2.z)
        ];
      }

      // Case: both trapezoids deleted — two rectangles split at Mf/Mb
      // Each rectangle slopes from its outer edge (base) up to the center line (ridge)
      if (bothTrapDel) {
        return [
          // S0: rect v0-Mf-Mb-v3 — slopes from v0/v3 (base) up to Mf/Mb (ridge)
          quad(h.v0.x,bY,h.v0.z, h.mfx,rY,h.mfz, h.mbx,rY,h.mbz, h.v3.x,bY,h.v3.z),
          // S1: rect Mf-v1-v2-Mb — slopes from v1/v2 (base) up to Mf/Mb (ridge)
          quad(h.mfx,rY,h.mfz, h.v1.x,bY,h.v1.z, h.v2.x,bY,h.v2.z, h.mbx,rY,h.mbz),
          null, null
        ];
      }

      // Case: only front trap (S2) deleted — ridge collapses to peak P
      if (ds[2] && !ds[3]) {
        return [
          // S0: trap v0-Mf-P-v3
          quad(h.v0.x,bY,h.v0.z, h.mfx,bY,h.mfz, h.px,rY,h.pz, h.v3.x,bY,h.v3.z),
          // S1: trap Mf-v1-v2-P
          quad(h.mfx,bY,h.mfz, h.v1.x,bY,h.v1.z, h.v2.x,bY,h.v2.z, h.px,rY,h.pz),
          null,
          // S3: tri v3-P-v2
          tri(h.v3.x,bY,h.v3.z, h.px,rY,h.pz, h.v2.x,bY,h.v2.z)
        ];
      }

      // Case: only back trap (S3) deleted — ridge collapses to peak P
      if (!ds[2] && ds[3]) {
        return [
          // S0: trap v0-P-Mb-v3
          quad(h.v0.x,bY,h.v0.z, h.px,rY,h.pz, h.mbx,bY,h.mbz, h.v3.x,bY,h.v3.z),
          // S1: trap v1-v2-Mb-P
          quad(h.v1.x,bY,h.v1.z, h.v2.x,bY,h.v2.z, h.mbx,bY,h.mbz, h.px,rY,h.pz),
          // S2: tri v0-v1-P
          tri(h.v0.x,bY,h.v0.z, h.v1.x,bY,h.v1.z, h.px,rY,h.pz),
          null
        ];
      }

      return [null, null, null, null];
    }

    function _applyRoofSectionMaterial(geo, color, yOffset, isSelected) {
      if (isSelected) {
        // Apply satellite texture with teal tint overlay
        var posAttr = geo.attributes.position;
        var uvs = new Float32Array(posAttr.count * 2);
        if (satTexture && satExtentM > 0) {
          for (var i = 0; i < posAttr.count; i++) {
            var wx = posAttr.getX(i);
            var wz = posAttr.getZ(i);
            uvs[i * 2]     = (wx + satExtentM / 2) / satExtentM;
            uvs[i * 2 + 1] = (-wz + satExtentM / 2) / satExtentM;
          }
          geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
          var mat = new THREE.MeshBasicMaterial({
            map: satTexture, color: 0x00bfa5,
            side: THREE.DoubleSide, depthWrite: true,
            polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
          });
        } else {
          for (var i = 0; i < posAttr.count; i++) {
            uvs[i * 2] = 0; uvs[i * 2 + 1] = 0;
          }
          geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
          var mat = new THREE.MeshBasicMaterial({
            color: 0x00bfa5,
            side: THREE.DoubleSide, depthWrite: true,
            polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
          });
        }
        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = yOffset;
        return mesh;
      }
      return _applyRoofMaterial(geo, color, yOffset);
    }

    function _applyRoofMaterial(geo, color, yOffset) {
      if (satTexture && satExtentM > 0) {
        // Compute UVs from world XZ position → satellite texture coords
        var posAttr = geo.attributes.position;
        var uvs = new Float32Array(posAttr.count * 2);
        for (var i = 0; i < posAttr.count; i++) {
          var wx = posAttr.getX(i);
          var wz = posAttr.getZ(i);
          uvs[i * 2]     = (wx + satExtentM / 2) / satExtentM;
          uvs[i * 2 + 1] = (-wz + satExtentM / 2) / satExtentM;
        }
        geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

        var mat = new THREE.MeshBasicMaterial({
          map: satTexture,
          side: THREE.DoubleSide, depthWrite: true,
          polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
        });
        var mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = yOffset;
        return mesh;
      }

      var mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(color),
        transparent: true, opacity: 0.50,
        side: THREE.DoubleSide, depthWrite: true,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
      });
      var mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = yOffset;
      return mesh;
    }

    /* ── Build edge outline lines (tube-based for consistent thickness) ── */
    var EDGE_LINE_RADIUS = 0.06;
    function buildRoofEdgeLines(verts, color) {
      var group = new THREE.Group();
      for (var i = 0; i < verts.length; i++) {
        var mat = new THREE.MeshBasicMaterial({ color: color });
        var a = verts[i], b = verts[(i + 1) % verts.length];
        var ax = a.x, az = a.z, bx = b.x, bz = b.z, y = 0.15;
        var dx = bx - ax, dz = bz - az;
        var len = Math.sqrt(dx * dx + dz * dz);
        if (len < 0.001) continue;
        var cyl = new THREE.Mesh(
          new THREE.CylinderGeometry(EDGE_LINE_RADIUS, EDGE_LINE_RADIUS, len, 6, 1),
          mat
        );
        cyl.position.set((ax + bx) / 2, y, (az + bz) / 2);
        cyl.rotation.z = Math.PI / 2;
        cyl.rotation.x = Math.atan2(dz, dx);
        // Cylinder defaults along Y; rotate to lie flat along segment
        var dir = new THREE.Vector3(dx, 0, dz).normalize();
        var up = new THREE.Vector3(0, 1, 0);
        var quat = new THREE.Quaternion();
        quat.setFromUnitVectors(up, dir);
        cyl.quaternion.copy(quat);
        cyl.userData.edgeIdx = i;
        group.add(cyl);
      }
      return group;
    }

    /* ── Build hip roof interior lines, respecting deleted sections ── */
    function buildHipRoofLines(verts, pitchDeg, deletedSections) {
      if (!verts || verts.length !== 4) return null;
      var ds = deletedSections || [false, false, false, false];

      var hip = computeHipGeometry(verts, pitchDeg);
      var ridgeY = hip.inset * Math.tan((pitchDeg || 10) * Math.PI / 180) + 0.12;
      var baseY = 0.12;

      var positions = [];
      var anyTrapDel = ds[2] || ds[3];
      var bothTrapDel = ds[2] && ds[3];

      if (!anyTrapDel) {
        // No trapezoids deleted — standard hip roof lines
        var re0x = ds[0] ? hip.m0x : hip.r0x;
        var re0z = ds[0] ? hip.m0z : hip.r0z;
        var re1x = ds[1] ? hip.m1x : hip.r1x;
        var re1z = ds[1] ? hip.m1z : hip.r1z;

        if (!ds[0] && !ds[2]) positions.push(hip.v0.x,baseY,hip.v0.z, hip.r0x,ridgeY,hip.r0z);
        if (!ds[0] && !ds[3]) positions.push(hip.v3.x,baseY,hip.v3.z, hip.r0x,ridgeY,hip.r0z);
        if (!ds[1] && !ds[2]) positions.push(hip.v1.x,baseY,hip.v1.z, hip.r1x,ridgeY,hip.r1z);
        if (!ds[1] && !ds[3]) positions.push(hip.v2.x,baseY,hip.v2.z, hip.r1x,ridgeY,hip.r1z);
        // Ridge line
        var anyAlive = !ds[0] || !ds[1] || !ds[2] || !ds[3];
        if (anyAlive) positions.push(re0x,ridgeY,re0z, re1x,ridgeY,re1z);

      } else if (bothTrapDel) {
        // Both trapezoids deleted — ridge line Mf→Mb at ridge height
        if (!ds[0] || !ds[1]) {
          positions.push(hip.mfx,ridgeY,hip.mfz, hip.mbx,ridgeY,hip.mbz);
        }

      } else if (ds[2] && !ds[3]) {
        // Front trap deleted — ridge collapsed to peak P
        // Lines: Mf→P (divider between S0/S1), v3→P and v2→P (borders with S3 triangle)
        if (!ds[0] && !ds[1]) positions.push(hip.mfx,baseY,hip.mfz, hip.px,ridgeY,hip.pz);
        if (!ds[0] && !ds[3]) positions.push(hip.v3.x,baseY,hip.v3.z, hip.px,ridgeY,hip.pz);
        if (!ds[1] && !ds[3]) positions.push(hip.v2.x,baseY,hip.v2.z, hip.px,ridgeY,hip.pz);

      } else if (!ds[2] && ds[3]) {
        // Back trap deleted — ridge collapsed to peak P
        // Lines: Mb→P (divider between S0/S1), v0→P and v1→P (borders with S2 triangle)
        if (!ds[0] && !ds[1]) positions.push(hip.mbx,baseY,hip.mbz, hip.px,ridgeY,hip.pz);
        if (!ds[0] && !ds[2]) positions.push(hip.v0.x,baseY,hip.v0.z, hip.px,ridgeY,hip.pz);
        if (!ds[1] && !ds[2]) positions.push(hip.v1.x,baseY,hip.v1.z, hip.px,ridgeY,hip.pz);
      }

      if (positions.length === 0) return null;

      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      var mat = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 2 });
      return new THREE.LineSegments(geo, mat);
    }

    /* ── Build vertex handle spheres ── */
    function buildRoofHandles(verts) {
      var handles = [];
      verts.forEach(function(v) {
        var sphere = new THREE.Mesh(
          new THREE.SphereGeometry(0.35, 12, 12),
          new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        sphere.position.set(v.x, 0.18, v.z);
        scene3d.add(sphere);
        handles.push(sphere);
      });
      return handles;
    }

    function buildRoofEdgeHandles(verts) {
      var handles = [];
      for (var i = 0; i < verts.length; i++) {
        var a = verts[i], b = verts[(i + 1) % verts.length];
        var mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        var box = new THREE.Mesh(
          new THREE.BoxGeometry(0.35, 0.12, 0.35),
          new THREE.MeshBasicMaterial({ color: 0x00e5ff, visible: false })
        );
        box.position.set(mx, 0.18, mz);
        scene3d.add(box);
        handles.push(box);
      }
      return handles;
    }

    /* ── Build vertical walls beneath roof ── */
    function buildRoofWalls(verts, pitchDeg, deletedSections, wallHeight) {
      var group = new THREE.Group();
      var wallMat = new THREE.MeshBasicMaterial({ color: 0xbbbbbb, side: THREE.DoubleSide });

      function addWall(ax, ay, az, bx, by, bz) {
        var positions = new Float32Array([
          ax, ay, az,  bx, by, bz,  bx, 0, bz,
          ax, ay, az,  bx, 0, bz,   ax, 0, az
        ]);
        var geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.computeVertexNormals();
        group.add(new THREE.Mesh(geo, wallMat));
      }

      var pitch = pitchDeg || 10;
      var ds = deletedSections || [false, false, false, false];
      var wH = wallHeight || 3.0;

      if (verts.length === 4 && pitch > 0) {
        var hip = computeHipGeometry(verts, pitch);
        var ridgeY = hip.inset * Math.tan(pitch * Math.PI / 180) + 0.05;
        var baseY = 0.05;
        var sectionPositions = computeSectionGeometry(hip, ds, ridgeY, baseY);

        for (var si = 0; si < 4; si++) {
          if (ds[si] || !sectionPositions[si]) continue;
          var pos = sectionPositions[si];
          var unique = [];
          for (var j = 0; j < pos.length; j += 3) {
            var vx = pos[j], vy = pos[j+1], vz = pos[j+2];
            var dup = false;
            for (var k = 0; k < unique.length; k++) {
              if (Math.abs(vx - unique[k].x) < 0.01 && Math.abs(vy - unique[k].y) < 0.01 && Math.abs(vz - unique[k].z) < 0.01) { dup = true; break; }
            }
            if (!dup) unique.push({ x: vx, y: vy, z: vz });
          }
          for (var j = 0; j < unique.length; j++) {
            var a = unique[j], b = unique[(j + 1) % unique.length];
            addWall(a.x, a.y + wH, a.z, b.x, b.y + wH, b.z);
          }
        }
      } else {
        var baseY = 0.05;
        for (var i = 0; i < verts.length; i++) {
          var a = verts[i], b = verts[(i + 1) % verts.length];
          addWall(a.x, baseY + wH, a.z, b.x, baseY + wH, b.z);
        }
      }
      return group;
    }

    function getRoofWallHeight(face) {
      return face.height > 0 ? face.height : 3.0;
    }

    /* ── Dormer 3D Geometry ── */

    // Compute dormer vertices from center position, orientation angle, width and depth.
    // Returns 5 vertices forming an arrowhead/house pentagon (triangular footprint):
    //   0=front-left, 1=front-right  (eave edge, local depth -hd, full width)
    //   2=back-right, 4=back-left    (shoulders, local depth 0 = midpoint, full width)
    //   3=peak                       (center-back tip, local depth +hd, width 0)
    //
    // Birds-eye shape:
    //       peak (0, +hd)
    //      /           \
    //  (-hw, 0)       (+hw, 0)   ← shoulders
    //     |               |
    //  (-hw,-hd) ─ (+hw,-hd)    ← eave
    function computeDormerVerts(cx, cz, angle, width, depth) {
      var cos = Math.cos(angle), sin = Math.sin(angle);
      var hw = width / 2, hd = depth / 2;
      // Local→world: x_w = cx + lx*cos - lz*sin,  z_w = cz + lx*sin + lz*cos
      return [
        { x: cx + (-hw)*cos - (-hd)*sin, z: cz + (-hw)*sin + (-hd)*cos }, // 0 front-left  (local -hw, -hd)
        { x: cx + ( hw)*cos - (-hd)*sin, z: cz + ( hw)*sin + (-hd)*cos }, // 1 front-right (local +hw, -hd)
        { x: cx + ( hw)*cos            , z: cz + ( hw)*sin             }, // 2 back-right  (local +hw,   0)
        { x: cx              - ( hd)*sin, z: cz              + ( hd)*cos }, // 3 peak        (local   0, +hd)
        { x: cx + (-hw)*cos            , z: cz + (-hw)*sin             }  // 4 back-left   (local -hw,   0)
      ];
    }

    // Upgrade a saved dormer's vertex list to the current 5-point format.
    // Old dormers have 4 rectangular vertices; recompute from their geometry.
    function migrateDormerVerts(verts) {
      if (verts.length >= 5) return verts.map(function(v) { return { x: v.x, z: v.z }; });
      // Derive center, width, depth, angle from the 4 rectangular corners
      var fl = verts[0], fr = verts[1], br = verts[2], bl = verts[3];
      var cx = (fl.x + fr.x + br.x + bl.x) / 4;
      var cz = (fl.z + fr.z + br.z + bl.z) / 4;
      var width = Math.sqrt(Math.pow(fr.x - fl.x, 2) + Math.pow(fr.z - fl.z, 2));
      var fmx = (fl.x + fr.x) / 2, fmz = (fl.z + fr.z) / 2;
      var bmx = (br.x + bl.x) / 2, bmz = (br.z + bl.z) / 2;
      var depth = Math.sqrt(Math.pow(bmx - fmx, 2) + Math.pow(bmz - fmz, 2));
      var angle = Math.atan2(fr.z - fl.z, fr.x - fl.x);
      return computeDormerVerts(cx, cz, angle, width, depth);
    }

    // Get Y height at a point on the roof surface for a given face and section
    function getRoofSurfaceY(face, px, pz) {
      if (!face || face.vertices.length !== 4 || face.pitch <= 0) return 0.05;
      var hip = computeHipGeometry(face.vertices, face.pitch);
      var ridgeY = hip.inset * Math.tan(face.pitch * Math.PI / 180) + 0.05;
      // Simple: interpolate Y based on distance from nearest edge toward ridge
      // Use perpendicular distance from long edge
      var nx = -hip.ldz, nz = hip.ldx; // normal to long edge (pointing inward)
      var dx = px - hip.v0.x, dz = pz - hip.v0.z;
      var dist = Math.abs(dx * nx + dz * nz);
      var maxDist = hip.inset;
      var t = Math.min(dist / maxDist, 1.0);
      return t * ridgeY + (1 - t) * 0.05;
    }

    // Build 3D dormer mesh (group containing walls + roof + outline + handles)
    function buildDormerMesh(dormer, face, isGhost) {
      var group = new THREE.Group();
      var v = dormer.vertices;
      if (!v || v.length < 5) return group;

      var wH = getRoofWallHeight(face);

      // World Y of each contact point — where the dormer footprint meets the main roof surface.
      var contactY = [];
      for (var i = 0; i < 5; i++) {
        contactY.push(wH + getRoofSurfaceY(face, v[i].x, v[i].z));
      }

      // Dormer wall height — raises the dormer structure above the roof surface.
      // Front vertices get full wallH; back vertices stay on the roof surface.
      var dormerWH = dormer.wallHeight || DORMER_WALL_HEIGHT;
      var eaveY = [];
      eaveY[0] = contactY[0] + dormerWH;  // front-left: full height
      eaveY[1] = contactY[1] + dormerWH;  // front-right: full height
      eaveY[2] = contactY[2];              // back-right: flush with roof
      eaveY[3] = contactY[3];              // peak: flush with roof
      eaveY[4] = contactY[4];              // back-left: flush with roof

      // Dormer dimensions
      var frontW = Math.sqrt(Math.pow(v[1].x - v[0].x, 2) + Math.pow(v[1].z - v[0].z, 2));
      var fmx = (v[0].x + v[1].x) / 2, fmz = (v[0].z + v[1].z) / 2;
      var sideL = Math.sqrt(Math.pow(v[3].x - fmx, 2) + Math.pow(v[3].z - fmz, 2));

      // Ridge height above the front eave — the dormer roof rises from the raised wall top
      var pitch = dormer.pitch || 15;
      var ridgeH;
      if (dormer.type === 'shed') {
        ridgeH = sideL * Math.tan(pitch * Math.PI / 180);
      } else {
        ridgeH = (frontW / 2) * Math.tan(pitch * Math.PI / 180);
      }

      // Front eave mid-height and ridge top
      var frontEaveY = (eaveY[0] + eaveY[1]) / 2;
      var ridgeTopY = frontEaveY + ridgeH;

      // Build geometry based on type
      var wallMat = new THREE.MeshBasicMaterial({
        color: 0xcccccc,
        transparent: isGhost,
        opacity: isGhost ? 0.3 : 1.0,
        side: THREE.DoubleSide
      });

      // Dormer roof: use satellite texture if available (matching main roof)
      var roofMat;
      if (!isGhost && satTexture) {
        roofMat = new THREE.MeshBasicMaterial({
          map: satTexture,
          color: dormer.selected ? 0x00bfa5 : 0xffffff,
          transparent: dormer.selected,
          opacity: dormer.selected ? 0.8 : 1.0,
          side: THREE.DoubleSide,
          depthWrite: true,
          polygonOffset: true,
          polygonOffsetFactor: 1,
          polygonOffsetUnits: 1
        });
      } else {
        roofMat = new THREE.MeshBasicMaterial({
          color: dormer.selected ? 0x00bfa5 : 0x8899aa,
          transparent: true, opacity: isGhost ? 0.3 : (dormer.selected ? 0.6 : 0.5),
          side: THREE.DoubleSide
        });
      }

      function worldToUV(wx, wz) {
        if (!satExtentM) return { u: 0, v: 0 };
        return {
          u: (wx + satExtentM / 2) / satExtentM,
          v: (-wz + satExtentM / 2) / satExtentM
        };
      }
      function addQuad(ax,ay,az, bx,by,bz, cx,cy,cz, dx,dy,dz, mat) {
        var geo = new THREE.BufferGeometry();
        var pos = new Float32Array([ax,ay,az, bx,by,bz, cx,cy,cz, ax,ay,az, cx,cy,cz, dx,dy,dz]);
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        if (mat.map && satExtentM) {
          var uA = worldToUV(ax, az), uB = worldToUV(bx, bz), uC = worldToUV(cx, cz), uD = worldToUV(dx, dz);
          var uvs = new Float32Array([uA.u,uA.v, uB.u,uB.v, uC.u,uC.v, uA.u,uA.v, uC.u,uC.v, uD.u,uD.v]);
          geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        }
        geo.computeVertexNormals();
        group.add(new THREE.Mesh(geo, mat));
      }
      function addTri(ax,ay,az, bx,by,bz, cx,cy,cz, mat) {
        var geo = new THREE.BufferGeometry();
        var pos = new Float32Array([ax,ay,az, bx,by,bz, cx,cy,cz]);
        if (mat.map && satExtentM) {
          var uA = worldToUV(ax, az), uB = worldToUV(bx, bz), uC = worldToUV(cx, cz);
          var uvs = new Float32Array([uA.u,uA.v, uB.u,uB.v, uC.u,uC.v]);
          geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
        }
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        geo.computeVertexNormals();
        group.add(new THREE.Mesh(geo, mat));
      }

      // Ridge and roof geometry — all Y values are world-space (no group offset)
      var midFrontX = (v[0].x + v[1].x) / 2, midFrontZ = (v[0].z + v[1].z) / 2;
      var ridgeFrontX, ridgeFrontZ, ridgeFrontY, ridgeBackX, ridgeBackZ, ridgeBackY;

      if (dormer.type === 'gable') {
        ridgeFrontX = midFrontX; ridgeFrontZ = midFrontZ; ridgeFrontY = ridgeTopY;
        // Ridge back is flush with main roof at the peak contact point
        ridgeBackX = v[3].x; ridgeBackZ = v[3].z; ridgeBackY = eaveY[3];

        // Front gable pediment (triangle above the front wall)
        addTri(v[0].x, eaveY[0], v[0].z, v[1].x, eaveY[1], v[1].z,
               ridgeFrontX, ridgeFrontY, ridgeFrontZ, wallMat);
        // Left roof slope: front-left → ridge-front → ridge-back(peak) → back-left
        addQuad(v[0].x, eaveY[0], v[0].z, ridgeFrontX, ridgeFrontY, ridgeFrontZ,
                ridgeBackX, ridgeBackY, ridgeBackZ, v[4].x, eaveY[4], v[4].z, roofMat);
        // Right roof slope: front-right → back-right → ridge-back(peak) → ridge-front
        addQuad(v[1].x, eaveY[1], v[1].z, v[2].x, eaveY[2], v[2].z,
                ridgeBackX, ridgeBackY, ridgeBackZ, ridgeFrontX, ridgeFrontY, ridgeFrontZ, roofMat);

      } else if (dormer.type === 'hip') {
        var hipInset = sideL * 0.3;
        var dirX = v[3].x - midFrontX, dirZ = v[3].z - midFrontZ;
        var dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ) || 1;
        dirX /= dirLen; dirZ /= dirLen;
        ridgeFrontX = midFrontX + dirX * hipInset; ridgeFrontZ = midFrontZ + dirZ * hipInset;
        ridgeBackX  = v[3].x   - dirX * hipInset; ridgeBackZ  = v[3].z   - dirZ * hipInset;

        var pitchFront = dormer.pitchFront || pitch;
        var hipRidgeY = frontEaveY + (frontW / 2) * Math.tan(pitchFront * Math.PI / 180);
        ridgeFrontY = hipRidgeY; ridgeBackY = hipRidgeY;

        // Back hip: two triangles to the peak contact
        addTri(ridgeBackX, hipRidgeY, ridgeBackZ, v[2].x, eaveY[2], v[2].z,
               v[3].x, eaveY[3], v[3].z, roofMat);
        addTri(ridgeBackX, hipRidgeY, ridgeBackZ, v[3].x, eaveY[3], v[3].z,
               v[4].x, eaveY[4], v[4].z, roofMat);
        // Front triangle
        addTri(v[0].x, eaveY[0], v[0].z, v[1].x, eaveY[1], v[1].z,
               ridgeFrontX, hipRidgeY, ridgeFrontZ, roofMat);
        // Left trapezoid
        addQuad(v[0].x, eaveY[0], v[0].z, ridgeFrontX, hipRidgeY, ridgeFrontZ,
                ridgeBackX, hipRidgeY, ridgeBackZ, v[4].x, eaveY[4], v[4].z, roofMat);
        // Right trapezoid
        addQuad(v[1].x, eaveY[1], v[1].z, v[2].x, eaveY[2], v[2].z,
                ridgeBackX, hipRidgeY, ridgeBackZ, ridgeFrontX, hipRidgeY, ridgeFrontZ, roofMat);

      } else if (dormer.type === 'shed') {
        // Shed rises from front eave heights to back contact + ridgeH
        var sc2 = eaveY[2] + ridgeH, sc3 = eaveY[3] + ridgeH, sc4 = eaveY[4] + ridgeH;
        addTri(v[0].x, eaveY[0], v[0].z, v[1].x, eaveY[1], v[1].z, v[2].x, sc2, v[2].z, roofMat);
        addTri(v[0].x, eaveY[0], v[0].z, v[2].x, sc2, v[2].z, v[3].x, sc3, v[3].z, roofMat);
        addTri(v[0].x, eaveY[0], v[0].z, v[3].x, sc3, v[3].z, v[4].x, sc4, v[4].z, roofMat);
        ridgeFrontX = midFrontX; ridgeFrontZ = midFrontZ; ridgeFrontY = frontEaveY;
        ridgeBackX = v[3].x; ridgeBackZ = v[3].z; ridgeBackY = sc3;
      }

      // Exterior walls around all 5 edges — from Y=0 (ground) to contact height,
      // matching the main roof wall treatment in buildRoofWalls.
      for (var wi = 0; wi < 5; wi++) {
        var wa = wi, wb = (wi + 1) % 5;
        addQuad(v[wa].x, contactY[wa], v[wa].z,
                v[wb].x, contactY[wb], v[wb].z,
                v[wb].x, 0, v[wb].z,
                v[wa].x, 0, v[wa].z, wallMat);
      }

      // Dormer cheek walls — vertical surfaces from roof contact up to dormer eave.
      // Front wall (full wallH rectangle)
      if (dormerWH > 0.01) {
        addQuad(v[0].x, eaveY[0], v[0].z,
                v[1].x, eaveY[1], v[1].z,
                v[1].x, contactY[1], v[1].z,
                v[0].x, contactY[0], v[0].z, wallMat);
        // Left cheek wall (tapers from front wallH to zero at back-left)
        addQuad(v[4].x, eaveY[4], v[4].z,
                v[0].x, eaveY[0], v[0].z,
                v[0].x, contactY[0], v[0].z,
                v[4].x, contactY[4], v[4].z, wallMat);
        // Right cheek wall (tapers from front wallH to zero at back-right)
        addQuad(v[1].x, eaveY[1], v[1].z,
                v[2].x, eaveY[2], v[2].z,
                v[2].x, contactY[2], v[2].z,
                v[1].x, contactY[1], v[1].z, wallMat);
      }

      // White ridge line
      if (!isGhost && (dormer.type === 'gable' || dormer.type === 'hip')) {
        var rX0 = ridgeFrontX, rZ0 = ridgeFrontZ, rX1 = ridgeBackX, rZ1 = ridgeBackZ;
        var rY = ridgeFrontY;
        var rdx = rX1 - rX0, rdz = rZ1 - rZ0;
        var rLen = Math.sqrt(rdx * rdx + rdz * rdz);
        if (rLen > 0.01) {
          var ridgeCyl = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.05, rLen, 6, 1),
            new THREE.MeshBasicMaterial({ color: 0xffffff })
          );
          var rDir = new THREE.Vector3(rdx, 0, rdz).normalize();
          var rQuat = new THREE.Quaternion();
          rQuat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), rDir);
          ridgeCyl.quaternion.copy(rQuat);
          ridgeCyl.position.set((rX0 + rX1) / 2, rY + 0.02, (rZ0 + rZ1) / 2);
          group.add(ridgeCyl);
        }
      }

      // Outline (cyan edges at eave heights)
      if (!isGhost) {
        var outlineGroup = new THREE.Group();
        var EDGE_R = 0.04;
        for (var ei = 0; ei < 5; ei++) {
          var a = v[ei], b = v[(ei + 1) % 5];
          var ay2 = eaveY[ei], by2 = eaveY[(ei + 1) % 5];
          var edx = b.x - a.x, edz = b.z - a.z;
          var elen = Math.sqrt(edx * edx + edz * edz);
          if (elen < 0.01) continue;
          var cyl = new THREE.Mesh(
            new THREE.CylinderGeometry(EDGE_R, EDGE_R, elen, 6, 1),
            new THREE.MeshBasicMaterial({ color: 0x00e5ff })
          );
          cyl.position.set((a.x + b.x) / 2, (ay2 + by2) / 2, (a.z + b.z) / 2);
          cyl.lookAt(b.x, by2, b.z);
          cyl.rotateX(Math.PI / 2);
          outlineGroup.add(cyl);
        }
        group.add(outlineGroup);
        dormer.outlineLines = outlineGroup;
      }

      // No group Y offset — all geometry is in world space
      return group;
    }

    // Build draggable handles for dormer corners
    function buildDormerHandles(dormer, face) {
      var handles = [];
      var wH = getRoofWallHeight(face);
      var dormerWH = dormer.wallHeight || DORMER_WALL_HEIGHT;
      var verts = dormer.vertices;
      // Vertex handles (indices 0–4)
      verts.forEach(function(v, i) {
        var y = getRoofSurfaceY(face, v.x, v.z);
        var wallAdd = (i <= 1) ? dormerWH : 0;
        var sphere = new THREE.Mesh(
          new THREE.SphereGeometry(0.25, 10, 10),
          new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        sphere.position.set(v.x, wH + y + wallAdd + 0.1, v.z);
        sphere.userData.isDormerHandle = true;
        scene3d.add(sphere);
        handles.push(sphere);
      });
      // Edge midpoint handles (indices 5–9): edge i connects vertex i to (i+1)%5
      for (var ei = 0; ei < 5; ei++) {
        var a = verts[ei], b = verts[(ei + 1) % 5];
        var mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        var ya = getRoofSurfaceY(face, a.x, a.z);
        var yb = getRoofSurfaceY(face, b.x, b.z);
        var wallAddA = (ei <= 1) ? dormerWH : 0;
        var wallAddB = (((ei + 1) % 5) <= 1) ? dormerWH : 0;
        var my = wH + (ya + yb) / 2 + (wallAddA + wallAddB) / 2 + 0.1;
        var edgeSphere = new THREE.Mesh(
          new THREE.SphereGeometry(0.18, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0x00e5ff })
        );
        edgeSphere.position.set(mx, my, mz);
        edgeSphere.userData.isDormerHandle = true;
        scene3d.add(edgeSphere);
        handles.push(edgeSphere);
      }
      return handles;
    }

    // Rebuild a dormer's mesh (remove old, create new)
    function rebuildDormer(face, dormerIdx) {
      var d = face.dormers[dormerIdx];
      if (d.mesh) { scene3d.remove(d.mesh); d.mesh = null; }
      if (d.handleMeshes) { d.handleMeshes.forEach(function(h) { scene3d.remove(h); }); }
      d.mesh = buildDormerMesh(d, face, false);
      scene3d.add(d.mesh);
      d.handleMeshes = buildDormerHandles(d, face);
    }

    // Rebuild all dormers on a face
    function rebuildFaceDormers(faceIdx) {
      var face = roofFaces3d[faceIdx];
      if (!face.dormers) return;
      face.dormers.forEach(function(d, di) {
        rebuildDormer(face, di);
      });
    }

    // Remove all dormer meshes from a face
    function clearFaceDormers(face) {
      if (!face.dormers) return;
      face.dormers.forEach(function(d) {
        if (d.mesh) scene3d.remove(d.mesh);
        if (d.handleMeshes) d.handleMeshes.forEach(function(h) { scene3d.remove(h); });
      });
    }

    // Select a dormer
    function selectDormer(faceIdx, dormerIdx) {
      deselectDormer();
      selectedDormerIdx = dormerIdx;
      var face = roofFaces3d[faceIdx];
      var d = face.dormers[dormerIdx];
      d.selected = true;
      rebuildDormer(face, dormerIdx);
      updateDormerPanel(d);
      var dp = document.getElementById('dormerPanel');
      if (dp) dp.classList.remove('hidden');
      var efPanel = document.getElementById('efPanel');
      if (efPanel) efPanel.classList.add('hidden');
    }

    // Deselect current dormer
    function deselectDormer() {
      if (selectedDormerIdx >= 0 && roofSelectedFace >= 0) {
        var face = roofFaces3d[roofSelectedFace];
        if (face && face.dormers[selectedDormerIdx]) {
          face.dormers[selectedDormerIdx].selected = false;
          rebuildDormer(face, selectedDormerIdx);
        }
      }
      selectedDormerIdx = -1;
      var dp = document.getElementById('dormerPanel');
      if (dp) dp.classList.add('hidden');
    }

    // Delete a dormer
    function deleteDormer(faceIdx, dormerIdx) {
      var face = roofFaces3d[faceIdx];
      var d = face.dormers[dormerIdx];
      if (d.mesh) scene3d.remove(d.mesh);
      if (d.handleMeshes) d.handleMeshes.forEach(function(h) { scene3d.remove(h); });
      face.dormers.splice(dormerIdx, 1);
      selectedDormerIdx = -1;
      var dp = document.getElementById('dormerPanel');
      if (dp) dp.classList.add('hidden');
      markDirty();
    }

    // Snap dormer center so front edge aligns with nearest eave
    function snapDormerToEave(face, clickX, clickZ, depth) {
      if (!face || face.vertices.length !== 4) return { x: clickX, z: clickZ };
      var verts = face.vertices;
      var d01 = Math.sqrt(Math.pow(verts[1].x - verts[0].x, 2) + Math.pow(verts[1].z - verts[0].z, 2));
      var d12 = Math.sqrt(Math.pow(verts[2].x - verts[1].x, 2) + Math.pow(verts[2].z - verts[1].z, 2));
      var eaves;
      if (d01 >= d12) {
        eaves = [
          { a: verts[0], b: verts[1] },
          { a: verts[3], b: verts[2] }
        ];
      } else {
        eaves = [
          { a: verts[1], b: verts[2] },
          { a: verts[0], b: verts[3] }
        ];
      }
      var bestDist = Infinity, bestEave = null;
      for (var i = 0; i < eaves.length; i++) {
        var ea = eaves[i].a, eb = eaves[i].b;
        var edx = eb.x - ea.x, edz = eb.z - ea.z;
        var elen = Math.sqrt(edx * edx + edz * edz);
        if (elen < 0.01) continue;
        var nx = -edz / elen, nz = edx / elen;
        var dist = Math.abs((clickX - ea.x) * nx + (clickZ - ea.z) * nz);
        if (dist < bestDist) { bestDist = dist; bestEave = eaves[i]; }
      }
      if (!bestEave) return { x: clickX, z: clickZ };
      var ea = bestEave.a, eb = bestEave.b;
      var edx = eb.x - ea.x, edz = eb.z - ea.z;
      var elen = Math.sqrt(edx * edx + edz * edz);
      var t = ((clickX - ea.x) * edx + (clickZ - ea.z) * edz) / (elen * elen);
      t = Math.max(0.1, Math.min(0.9, t));
      var eaveX = ea.x + t * edx, eaveZ = ea.z + t * edz;
      var nx = -edz / elen, nz = edx / elen;
      var cx = (verts[0].x + verts[1].x + verts[2].x + verts[3].x) / 4;
      var cz = (verts[0].z + verts[1].z + verts[2].z + verts[3].z) / 4;
      if ((cx - eaveX) * nx + (cz - eaveZ) * nz < 0) { nx = -nx; nz = -nz; }
      var hd = depth / 2;
      return { x: eaveX + nx * hd, z: eaveZ + nz * hd };
    }

    // Get downslope angle for a roof face section
    function getRoofSlopeAngle(face) {
      if (!face || face.vertices.length !== 4) return 0;
      // Compute perpendicular to the roof's long edge (eave)
      // so the dormer faces directly down the slope
      var verts = face.vertices;
      var d01 = Math.sqrt(Math.pow(verts[1].x - verts[0].x, 2) + Math.pow(verts[1].z - verts[0].z, 2));
      var d12 = Math.sqrt(Math.pow(verts[2].x - verts[1].x, 2) + Math.pow(verts[2].z - verts[1].z, 2));
      var v0, v1, v2, v3;
      if (d01 >= d12) {
        // v0-v1 is the long edge (eave), slope runs v0->v3 direction
        v0 = verts[0]; v1 = verts[1]; v2 = verts[2]; v3 = verts[3];
      } else {
        // v1-v2 is the long edge, slope runs v1->v0 direction
        v0 = verts[1]; v1 = verts[2]; v2 = verts[3]; v3 = verts[0];
      }
      // Long edge direction
      var ldx = v1.x - v0.x, ldz = v1.z - v0.z;
      // Perpendicular to long edge (pointing from eave toward ridge)
      // The slope direction is from eave midpoint toward ridge
      var mx0 = (v0.x + v1.x) / 2, mz0 = (v0.z + v1.z) / 2;
      var mx1 = (v3.x + v2.x) / 2, mz1 = (v3.z + v2.z) / 2;
      var slopeDx = mx1 - mx0, slopeDz = mz1 - mz0;
      // At angle θ, dormer front faces (sinθ, -cosθ) in XZ plane.
      // For front to face downslope (-slopeDx, -slopeDz): sinθ = -slopeDx, cosθ = slopeDz
      return Math.atan2(-slopeDx, slopeDz);
    }

    // Enter dormer placement mode
    function enterDormerPlaceMode(type) {
      dormerPlaceMode = true;
      dormerPlaceType = type;
      deselectDormer();
      var canvas = document.getElementById('canvas3d');
      canvas.style.cursor = 'crosshair';
      var title = document.getElementById('rebTitleText');
      if (title) title.textContent = 'Place dormer';
      // Highlight active button
      document.querySelectorAll('.reb-dormer-btn').forEach(function(btn) {
        btn.classList.toggle('active', btn.dataset.dormer === type);
      });
      // Create ghost mesh
      createDormerGhost(type);
    }

    // Exit dormer placement mode
    function exitDormerPlaceMode() {
      dormerPlaceMode = false;
      dormerPlaceType = '';
      var canvas = document.getElementById('canvas3d');
      canvas.style.cursor = '';
      var title = document.getElementById('rebTitleText');
      if (title) title.textContent = 'Edit SmartRoof';
      document.querySelectorAll('.reb-dormer-btn').forEach(function(btn) {
        btn.classList.remove('active');
      });
      // Remove ghost
      if (dormerGhostMesh) { scene3d.remove(dormerGhostMesh); dormerGhostMesh = null; }
    }

    // Create ghost dormer preview
    function createDormerGhost(type) {
      if (dormerGhostMesh) { scene3d.remove(dormerGhostMesh); dormerGhostMesh = null; }
      var ghostDormer = {
        type: type,
        vertices: computeDormerVerts(0, 0, 0, DORMER_DEFAULT_WIDTH, DORMER_DEFAULT_DEPTH),
        pitch: 15,
        pitchSide: 15,
        pitchFront: 15,
        selected: false
      };
      // Build with a dummy face for basic positioning
      var dummyFace = { vertices: [{x:-5,z:-5},{x:5,z:-5},{x:5,z:5},{x:-5,z:5}], pitch: 20, height: 3.0, azimuth: 180 };
      dormerGhostMesh = buildDormerMesh(ghostDormer, dummyFace, true);
      dormerGhostMesh.visible = false;
      scene3d.add(dormerGhostMesh);
    }

    // Update ghost dormer position during mouse move
    function updateDormerGhost(event) {
      if (!dormerPlaceMode || !dormerGhostMesh) return;
      var canvas = document.getElementById('canvas3d');
      var rect = canvas.getBoundingClientRect();
      mouse3d.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse3d.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster3d.setFromCamera(mouse3d, camera3d);

      // Try to hit roof section meshes first
      var face = roofSelectedFace >= 0 ? roofFaces3d[roofSelectedFace] : null;
      var hitRoof = false;
      if (face && face.sectionMeshes) {
        var meshes = face.sectionMeshes.filter(function(m) { return !!m; });
        var hits = raycaster3d.intersectObjects(meshes);
        if (hits.length > 0) {
          hitRoof = true;
          var pt = hits[0].point;
          var wH = getRoofWallHeight(face);
          // Remove old ghost, rebuild at hit position with proper orientation
          scene3d.remove(dormerGhostMesh);
          var angle = getRoofSlopeAngle(face);
          var ghostDormer = {
            type: dormerPlaceType,
            vertices: computeDormerVerts(pt.x, pt.z, angle, DORMER_DEFAULT_WIDTH, DORMER_DEFAULT_DEPTH),
            pitch: 15, pitchSide: 15, pitchFront: 15, selected: false
          };
          dormerGhostMesh = buildDormerMesh(ghostDormer, face, true);
          dormerGhostMesh.visible = true;
          scene3d.add(dormerGhostMesh);
        }
      }

      if (!hitRoof) {
        // Fall back to ground plane
        var groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        var intersectPt = new THREE.Vector3();
        raycaster3d.ray.intersectPlane(groundPlane, intersectPt);
        if (intersectPt) {
          scene3d.remove(dormerGhostMesh);
          var ghostDormer2 = {
            type: dormerPlaceType,
            vertices: computeDormerVerts(intersectPt.x, intersectPt.z, 0, DORMER_DEFAULT_WIDTH, DORMER_DEFAULT_DEPTH),
            pitch: 15, pitchSide: 15, pitchFront: 15, selected: false
          };
          var dummyFace2 = { vertices: [{x:-50,z:-50},{x:50,z:-50},{x:50,z:50},{x:-50,z:50}], pitch: 0, height: 0, azimuth: 180 };
          dormerGhostMesh = buildDormerMesh(ghostDormer2, dummyFace2, true);
          dormerGhostMesh.visible = true;
          scene3d.add(dormerGhostMesh);
        }
      }
    }

    // Stamp dormer at current ghost position
    function stampDormer(event) {
      if (!dormerPlaceMode || roofSelectedFace < 0) return false;
      var face = roofFaces3d[roofSelectedFace];
      var canvas = document.getElementById('canvas3d');
      var rect = canvas.getBoundingClientRect();
      mouse3d.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse3d.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster3d.setFromCamera(mouse3d, camera3d);

      // Must hit a roof section
      if (!face.sectionMeshes) return false;
      var meshes = face.sectionMeshes.filter(function(m) { return !!m; });
      var hits = raycaster3d.intersectObjects(meshes);
      if (hits.length === 0) return false;

      var pt = hits[0].point;
      var angle = getRoofSlopeAngle(face);
      pushUndo();

      var snapped = snapDormerToEave(face, pt.x, pt.z, DORMER_DEFAULT_DEPTH);
      var newDormer = {
        type: dormerPlaceType,
        vertices: computeDormerVerts(snapped.x, snapped.z, angle, DORMER_DEFAULT_WIDTH, DORMER_DEFAULT_DEPTH),
        pitch: 15,
        pitchSide: 15,
        pitchFront: 15,
        mesh: null,
        outlineLines: null,
        handleMeshes: [],
        selected: false
      };
      face.dormers.push(newDormer);
      var dIdx = face.dormers.length - 1;
      rebuildDormer(face, dIdx);
      selectDormer(roofSelectedFace, dIdx);
      markDirty();
      return true;
    }

    // Update dormer properties panel
    function updateDormerPanel(d) {
      if (!d) return;
      // Set shape radio
      document.querySelectorAll('.dp-shape-item').forEach(function(item) {
        var check = item.querySelector('.dp-check');
        if (check) check.style.display = item.dataset.type === d.type ? '' : 'none';
      });
      // Set pitch inputs
      var pitchInput = document.getElementById('dpPitch');
      var pitchSideRow = document.getElementById('dpPitchSideRow');
      var pitchFrontRow = document.getElementById('dpPitchFrontRow');
      var pitchRow = document.getElementById('dpPitchRow');
      if (d.type === 'hip') {
        if (pitchRow) pitchRow.style.display = 'none';
        if (pitchSideRow) pitchSideRow.style.display = '';
        if (pitchFrontRow) pitchFrontRow.style.display = '';
        var ps = document.getElementById('dpPitchSide');
        var pf = document.getElementById('dpPitchFront');
        if (ps) ps.value = d.pitchSide || 15;
        if (pf) pf.value = d.pitchFront || 15;
      } else {
        if (pitchRow) pitchRow.style.display = '';
        if (pitchSideRow) pitchSideRow.style.display = 'none';
        if (pitchFrontRow) pitchFrontRow.style.display = 'none';
        if (pitchInput) pitchInput.value = d.pitch || 15;
      }
      // Dimensions
      if (d.vertices && d.vertices.length >= 4) {
        var v = d.vertices;
        var frontW = Math.sqrt(Math.pow(v[1].x - v[0].x, 2) + Math.pow(v[1].z - v[0].z, 2));
        var sideL = Math.sqrt(Math.pow(v[3].x - v[0].x, 2) + Math.pow(v[3].z - v[0].z, 2));
        var dpW = document.getElementById('dpWidth');
        var dpD = document.getElementById('dpDepth');
        var dpWH = document.getElementById('dpWallH');
        if (dpW) dpW.textContent = (frontW * 3.28084).toFixed(1) + ' ft';
        if (dpD) dpD.textContent = (sideL * 3.28084).toFixed(1) + ' ft';
        if (dpWH) dpWH.textContent = '3.6 ft'; // wallH = 1.1m
      }
    }

    /* ── Finalize a roof face (add to scene + array) ── */
    function finalizeRoofFace(verts, pitch, azimuth, height, deletedSections, sectionPitches) {
      var p = pitch || 0;
      var sp = sectionPitches || [p, p, p, p];
      var face = {
        id: 'rf_' + Date.now().toString(36) + '_' + roofFaces3d.length,
        vertices: verts,
        pitch: p,
        sectionPitches: sp.slice(),
        azimuth: azimuth || 180,
        height: height || 0,
        stories: 0,
        roofSurface: 'Asphalt Shingle',
        framingType: 'Rafter',
        framingSize: '2\u00d76',
        framingSpacing: '24" o.c.',
        decking: '7/16" OSB',
        color: '#f5a623',
        mesh: null, edgeLines: null, hipLines: null,
        sectionMeshes: [],
        deletedSections: deletedSections || [false, false, false, false],
        selectedSection: -1,
        handleMeshes: [], edgeHandleMeshes: [], labelSprites: [],
        selected: false,
        dormers: []
      };
      var usePitch = face.pitch || 10;
      var wH = getRoofWallHeight(face);

      // Build walls
      face.wallMesh = buildRoofWalls(verts, usePitch, face.deletedSections, wH);
      scene3d.add(face.wallMesh);

      // Build roof sections (lifted by wall height)
      face.sectionMeshes = buildRoofSectionMeshes(verts, face.color, usePitch, face.deletedSections, -1);
      face.mesh = new THREE.Group();
      face.sectionMeshes.forEach(function(m) { if (m) face.mesh.add(m); });
      face.mesh.position.y = wH;
      scene3d.add(face.mesh);

      face.edgeLines = buildRoofEdgeLines(verts, '#ffffff');
      face.edgeLines.position.y = wH;
      scene3d.add(face.edgeLines);

      face.hipLines = buildHipRoofLines(verts, usePitch, face.deletedSections);
      if (face.hipLines) { face.hipLines.position.y = wH; scene3d.add(face.hipLines); }

      face.handleMeshes = buildRoofHandles(verts);
      face.handleMeshes.forEach(function(h) { h.position.y = wH + 0.18; });

      face.edgeHandleMeshes = buildRoofEdgeHandles(verts);
      face.edgeHandleMeshes.forEach(function(h) { h.position.y = wH + 0.18; });

      face.labelSprites = buildEdgeLabels(verts);
      roofFaces3d.push(face);
      markDirty();
      return roofFaces3d.length - 1;
    }

    /* ── Rebuild a face after vertex edit ── */
    function rebuildRoofFace(idx) {
      var face = roofFaces3d[idx];
      if (face.mesh) scene3d.remove(face.mesh);
      if (face.edgeLines) scene3d.remove(face.edgeLines);
      if (face.hipLines) scene3d.remove(face.hipLines);
      if (face.wallMesh) scene3d.remove(face.wallMesh);
      face.labelSprites.forEach(function(s) { scene3d.remove(s); });

      var usePitch = face.pitch || 10;
      var wH = getRoofWallHeight(face);

      // Rebuild walls
      face.wallMesh = buildRoofWalls(face.vertices, usePitch, face.deletedSections, wH);
      scene3d.add(face.wallMesh);

      // Rebuild roof sections (lifted). Use -2 to highlight ALL sections in whole-structure mode
      var selSec = (face.selected && !roofEditMode) ? -2 : face.selectedSection;
      face.sectionMeshes = buildRoofSectionMeshes(face.vertices, face.color, usePitch, face.deletedSections, selSec);
      face.mesh = new THREE.Group();
      face.sectionMeshes.forEach(function(m) { if (m) face.mesh.add(m); });
      face.mesh.position.y = wH;
      scene3d.add(face.mesh);

      face.edgeLines = buildRoofEdgeLines(face.vertices, face.selected ? '#00e5ff' : '#ffffff');
      face.edgeLines.position.y = wH;
      scene3d.add(face.edgeLines);

      face.hipLines = buildHipRoofLines(face.vertices, usePitch, face.deletedSections);
      if (face.hipLines) { face.hipLines.position.y = wH; scene3d.add(face.hipLines); }
      face.labelSprites = buildEdgeLabels(face.vertices);

      face.vertices.forEach(function(v, i) {
        face.handleMeshes[i].position.set(v.x, wH + 0.18, v.z);
      });
      if (face.edgeHandleMeshes) {
        for (var ei = 0; ei < face.vertices.length; ei++) {
          var ea = face.vertices[ei], eb = face.vertices[(ei + 1) % face.vertices.length];
          face.edgeHandleMeshes[ei].position.set((ea.x + eb.x) / 2, wH + 0.18, (ea.z + eb.z) / 2);
        }
      }
      // Rebuild dormers on this face
      clearFaceDormers(face);
      rebuildFaceDormers(idx);
      markDirty();
    }

    /* ── Remove all roof faces ── */
    function clearAllRoofFaces() {
      roofFaces3d.forEach(function(face) {
        if (face.mesh) scene3d.remove(face.mesh);
        if (face.edgeLines) scene3d.remove(face.edgeLines);
        if (face.hipLines) scene3d.remove(face.hipLines);
        if (face.wallMesh) scene3d.remove(face.wallMesh);
        face.handleMeshes.forEach(function(h) { scene3d.remove(h); });
        if (face.edgeHandleMeshes) face.edgeHandleMeshes.forEach(function(h) { scene3d.remove(h); });
        face.labelSprites.forEach(function(s) { scene3d.remove(s); });
        clearFaceDormers(face);
      });
      roofFaces3d = [];
      roofSelectedFace = -1;
      roofSelectedSection = -1;
      // Remove outline reference lines
      var toRemove = [];
      scene3d.traverse(function(obj) { if (obj.userData && obj.userData.roofOutline) toRemove.push(obj); });
      toRemove.forEach(function(obj) { scene3d.remove(obj); });
    }

    /* ── Delete a single roof section within a face ── */
    function deleteRoofSection(faceIdx, sectionIdx) {
      if (faceIdx < 0 || faceIdx >= roofFaces3d.length) return;
      var face = roofFaces3d[faceIdx];
      if (!face.deletedSections || sectionIdx < 0 || sectionIdx >= face.deletedSections.length) return;
      pushUndo();
      face.deletedSections[sectionIdx] = true;
      face.selectedSection = -1;
      roofSelectedSection = -1;

      // If all sections deleted, remove the entire face
      var allDeleted = face.deletedSections.every(function(d) { return d; });
      if (allDeleted) {
        deleteRoofFace(faceIdx);
        return;
      }
      rebuildRoofFace(faceIdx);
      updateRoofPropsPanel();
    }

    /* ── Delete a single roof face ── */
    function deleteRoofFace(idx) {
      if (idx < 0 || idx >= roofFaces3d.length) return;
      pushUndo();
      var face = roofFaces3d[idx];
      if (face.mesh) scene3d.remove(face.mesh);
      if (face.edgeLines) scene3d.remove(face.edgeLines);
      if (face.hipLines) scene3d.remove(face.hipLines);
      if (face.wallMesh) scene3d.remove(face.wallMesh);
      face.handleMeshes.forEach(function(h) { scene3d.remove(h); });
      if (face.edgeHandleMeshes) face.edgeHandleMeshes.forEach(function(h) { scene3d.remove(h); });
      face.labelSprites.forEach(function(s) { scene3d.remove(s); });
      roofFaces3d.splice(idx, 1);
      if (roofSelectedFace === idx) { roofSelectedFace = -1; roofSelectedSection = -1; }
      else if (roofSelectedFace > idx) roofSelectedFace--;
      updateRoofPropsPanel();
      markDirty();
    }

    /* ── Select / Deselect face and section ── */
    function selectRoofSection(faceIdx, sectionIdx) {
      // Deselect previous
      if (roofSelectedFace >= 0 && roofSelectedFace < roofFaces3d.length) {
        var old = roofFaces3d[roofSelectedFace];
        old.selected = false;
        old.selectedSection = -1;
        rebuildRoofFace(roofSelectedFace);
      }
      roofSelectedFace = faceIdx;
      roofSelectedSection = sectionIdx;
      var face = roofFaces3d[faceIdx];
      face.selected = true;
      face.selectedSection = sectionIdx;
      rebuildRoofFace(faceIdx);
      updateRoofPropsPanel();
      // Show ef-panel when a section is selected
      var efPanel = document.getElementById('efPanel');
      if (efPanel) {
        if (sectionIdx >= 0) {
          efPanel.classList.remove('hidden');
        } else {
          efPanel.classList.add('hidden');
        }
      }
    }

    function selectRoofFace(idx) {
      selectRoofSection(idx, -1);
    }

    function deselectRoofFace() {
      if (dormerPlaceMode) exitDormerPlaceMode();
      if (roofSelectedFace >= 0 && roofSelectedFace < roofFaces3d.length) {
        var old = roofFaces3d[roofSelectedFace];
        old.selected = false;
        old.selectedSection = -1;
        deselectDormer();
        rebuildRoofFace(roofSelectedFace);
      }
      roofSelectedFace = -1;
      roofSelectedSection = -1;
      roofEditMode = false;
      roofMovingMode = false;
      updateRoofPropsPanel();
      // Hide all panels
      var efPanel = document.getElementById('efPanel');
      if (efPanel) efPanel.classList.add('hidden');
      var srPanel = document.getElementById('smartRoofPanel');
      if (srPanel) srPanel.classList.add('hidden');
      var roofProps = document.getElementById('roofPropsSection');
      if (roofProps) roofProps.style.display = 'none';
      var reb = document.getElementById('roofEditBanner');
      if (reb) reb.style.display = 'none';
      var dp = document.getElementById('dormerPanel');
      if (dp) dp.classList.add('hidden');
    }

    /* ── Whole-structure selection (SmartRoof mode) ── */
    function selectRoofWhole(faceIdx) {
      // Deselect previous
      if (roofSelectedFace >= 0 && roofSelectedFace < roofFaces3d.length) {
        var old = roofFaces3d[roofSelectedFace];
        old.selected = false;
        old.selectedSection = -1;
        rebuildRoofFace(roofSelectedFace);
      }
      roofSelectedFace = faceIdx;
      roofSelectedSection = -1;
      roofEditMode = false;
      var face = roofFaces3d[faceIdx];
      face.selected = true;
      face.selectedSection = -1;
      rebuildRoofFace(faceIdx);

      // Show SmartRoof side panel, hide section panels
      var srPanel = document.getElementById('smartRoofPanel');
      var roofProps = document.getElementById('roofPropsSection');
      var efPanel = document.getElementById('efPanel');
      if (srPanel) {
        srPanel.classList.remove('hidden');
        // Populate values
        var srH = document.getElementById('srHeight');
        if (srH) srH.value = (face.height * 3.28084).toFixed(1);
        var srS = document.getElementById('srStories');
        if (srS) srS.value = face.stories || 0;
        // Populate structural properties
        var srSurf = document.getElementById('srRoofSurface');
        if (srSurf) srSurf.textContent = face.roofSurface || 'Asphalt Shingle';
        var srFT = document.getElementById('srFramingType');
        if (srFT) srFT.textContent = face.framingType || 'Rafter';
        var srFS = document.getElementById('srFramingSize');
        if (srFS) srFS.textContent = face.framingSize || '2\u00d76';
        var srFSp = document.getElementById('srFramingSpacing');
        if (srFSp) srFSp.textContent = face.framingSpacing || '24" o.c.';
        var srDk = document.getElementById('srDecking');
        if (srDk) srDk.textContent = face.decking || '7/16" OSB';
      }
      if (roofProps) roofProps.style.display = 'none';
      if (efPanel) efPanel.classList.add('hidden');
      var reb = document.getElementById('roofEditBanner');
      if (reb) reb.style.display = 'none';
      var dp = document.getElementById('dormerPanel');
      if (dp) dp.classList.add('hidden');
    }

    /* ── Enter face-edit mode from SmartRoof ── */
    function enterRoofEditMode() {
      if (roofSelectedFace < 0) return;
      roofEditMode = true;
      // Rebuild to remove whole-structure highlight
      rebuildRoofFace(roofSelectedFace);
      // Hide SmartRoof panel, show section panel
      var srPanel = document.getElementById('smartRoofPanel');
      if (srPanel) srPanel.classList.add('hidden');
      var roofProps = document.getElementById('roofPropsSection');
      if (roofProps) roofProps.style.display = '';
      // Show edit mode banner
      var reb = document.getElementById('roofEditBanner');
      if (reb) { reb.style.display = 'flex'; document.getElementById('rebTitleText').textContent = 'Edit SmartRoof'; }
      updateRoofPropsPanel();
    }

    /* ── Undo / Redo system ── */
    function captureRoofSnapshot() {
      return {
        faces: roofFaces3d.map(function(f) {
          return {
            vertices: f.vertices.map(function(v) { return {x: v.x, z: v.z}; }),
            pitch: f.pitch,
            sectionPitches: f.sectionPitches ? f.sectionPitches.slice() : null,
            azimuth: f.azimuth,
            height: f.height,
            stories: f.stories || 0,
            roofSurface: f.roofSurface,
            framingType: f.framingType,
            framingSize: f.framingSize,
            framingSpacing: f.framingSpacing,
            decking: f.decking,
            color: f.color,
            deletedSections: f.deletedSections.slice(),
            dormers: (f.dormers || []).map(function(d) {
              return {
                type: d.type,
                vertices: d.vertices.map(function(v) { return {x: v.x, z: v.z}; }),
                pitch: d.pitch,
                pitchSide: d.pitchSide,
                pitchFront: d.pitchFront
              };
            })
          };
        }),
        selectedFace: roofSelectedFace,
        selectedSection: roofSelectedSection,
        selectedDormer: selectedDormerIdx
      };
    }

    function restoreRoofSnapshot(snapshot) {
      clearAllRoofFaces();
      snapshot.faces.forEach(function(rf) {
        var fIdx = finalizeRoofFace(rf.vertices, rf.pitch, rf.azimuth, rf.height, rf.deletedSections, rf.sectionPitches);
        // Restore structural properties
        var restoredFace = roofFaces3d[fIdx];
        if (rf.stories !== undefined) restoredFace.stories = rf.stories;
        if (rf.roofSurface) restoredFace.roofSurface = rf.roofSurface;
        if (rf.framingType) restoredFace.framingType = rf.framingType;
        if (rf.framingSize) restoredFace.framingSize = rf.framingSize;
        if (rf.framingSpacing) restoredFace.framingSpacing = rf.framingSpacing;
        if (rf.decking) restoredFace.decking = rf.decking;
        // Restore dormers
        if (rf.dormers && rf.dormers.length > 0) {
          var face = roofFaces3d[fIdx];
          rf.dormers.forEach(function(dd) {
            var newD = {
              type: dd.type,
              vertices: migrateDormerVerts(dd.vertices),
              pitch: dd.pitch,
              pitchSide: dd.pitchSide,
              pitchFront: dd.pitchFront,
              mesh: null, outlineLines: null, handleMeshes: [], selected: false
            };
            face.dormers.push(newD);
            rebuildDormer(face, face.dormers.length - 1);
          });
        }
      });
      roofSelectedFace = snapshot.selectedFace;
      roofSelectedSection = snapshot.selectedSection;
      selectedDormerIdx = snapshot.selectedDormer || -1;
      if (roofSelectedFace >= 0 && roofSelectedFace < roofFaces3d.length) {
        var face = roofFaces3d[roofSelectedFace];
        face.selected = true;
        face.selectedSection = roofSelectedSection;
        rebuildRoofFace(roofSelectedFace);
        if (selectedDormerIdx >= 0 && face.dormers[selectedDormerIdx]) {
          face.dormers[selectedDormerIdx].selected = true;
          rebuildDormer(face, selectedDormerIdx);
        }
      }
      updateRoofPropsPanel();
    }

    function pushRoofUndo() {
      roofUndoStack.push(captureRoofSnapshot());
      if (roofUndoStack.length > ROOF_UNDO_MAX) roofUndoStack.shift();
      roofRedoStack = [];
      updateUndoRedoButtons();
    }

    function roofUndo() {
      if (roofUndoStack.length === 0) return;
      roofRedoStack.push(captureRoofSnapshot());
      restoreRoofSnapshot(roofUndoStack.pop());
      updateUndoRedoButtons();
      markDirty();
    }

    function roofRedo() {
      if (roofRedoStack.length === 0) return;
      roofUndoStack.push(captureRoofSnapshot());
      restoreRoofSnapshot(roofRedoStack.pop());
      updateUndoRedoButtons();
      markDirty();
    }

    /* ── Unified undo/redo — wraps all interactable actions ── */
    function captureTreeSnapshot() {
      return trees3d.map(function(t) {
        return { center: {x: t.center.x, z: t.center.z}, radius: t.radius, height: t.height, lat: t.lat, lng: t.lng };
      });
    }

    function restoreTreeSnapshot(snap) {
      trees3d.forEach(function(t) { if (t.mesh) scene3d.remove(t.mesh); });
      trees3d = [];
      snap.forEach(function(td) {
        var sceneH = td.height * vertExag;
        var mesh = buildTreeGroup({ x: td.center.x, z: td.center.z }, td.radius, sceneH, false);
        scene3d.add(mesh);
        trees3d.push({ center: {x: td.center.x, z: td.center.z}, radius: td.radius, height: td.height, mesh: mesh, lat: td.lat, lng: td.lng });
      });
      hoveredTreeIdx = -1;
      selectedTreeIdx = -1;
    }

    function captureFullSnapshot() {
      return {
        roof: captureRoofSnapshot(),
        trees: captureTreeSnapshot(),
        drawingDots: roofDrawingMode ? {
          vertices: roofTempVertices.map(function(v) { return {x: v.x, z: v.z}; }),
          handleCount: roofTempHandles.length
        } : null
      };
    }

    function pushUndo() {
      undoStack.push(captureFullSnapshot());
      if (undoStack.length > UNDO_MAX) undoStack.shift();
      redoStack = [];
      updateUndoRedoButtons();
    }

    function unifiedUndo() {
      if (undoStack.length === 0) return;
      redoStack.push(captureFullSnapshot());
      var snap = undoStack.pop();

      // Restore roof state
      restoreRoofSnapshot(snap.roof);
      // Restore tree state
      restoreTreeSnapshot(snap.trees);
      // Restore drawing dots if we were/are in drawing mode
      if (snap.drawingDots) {
        // Remove current preview handles
        roofTempHandles.forEach(function(h) { scene3d.remove(h); });
        roofTempHandles = [];
        roofTempVertices = snap.drawingDots.vertices.slice();
        // Recreate preview handles
        roofTempVertices.forEach(function(v) { addRoofPreviewHandle(v.x, v.z); });
        updateRoofPreviewLines();
        clearSnapGuides();
      }

      updateUndoRedoButtons();
      markDirty();
    }

    function unifiedRedo() {
      if (redoStack.length === 0) return;
      undoStack.push(captureFullSnapshot());
      var snap = redoStack.pop();

      restoreRoofSnapshot(snap.roof);
      restoreTreeSnapshot(snap.trees);
      if (snap.drawingDots) {
        roofTempHandles.forEach(function(h) { scene3d.remove(h); });
        roofTempHandles = [];
        roofTempVertices = snap.drawingDots.vertices.slice();
        roofTempVertices.forEach(function(v) { addRoofPreviewHandle(v.x, v.z); });
        updateRoofPreviewLines();
        clearSnapGuides();
      }

      updateUndoRedoButtons();
      markDirty();
    }

    function updateUndoRedoButtons() {
      var undoBtn = document.getElementById('undoBtn');
      var redoBtn = document.getElementById('redoBtn');
      if (undoBtn) undoBtn.disabled = undoStack.length === 0 && roofUndoStack.length === 0;
      if (redoBtn) redoBtn.disabled = redoStack.length === 0 && roofRedoStack.length === 0;
    }

    /* ── Compass direction from azimuth ── */
    function azimuthToCompass(az) {
      var dirs = ['N','NE','E','SE','S','SW','W','NW'];
      var idx = Math.round(((az % 360) + 360) % 360 / 45) % 8;
      return dirs[idx];
    }

    /* ── Update properties panel ── */
    function updateRoofPropsPanel() {
      var section = document.getElementById('roofPropsSection');
      if (!section) return;
      if (roofSelectedFace < 0 || roofSelectedFace >= roofFaces3d.length) {
        section.style.display = 'none';
        return;
      }
      // Only show section panel in edit mode
      if (!roofEditMode) {
        section.style.display = 'none';
        return;
      }
      section.style.display = '';
      var face = roofFaces3d[roofSelectedFace];
      var sectionNames = ['Hip Triangle A', 'Hip Triangle B', 'Front Trapezoid', 'Back Trapezoid'];

      // Determine pitch to display
      var displayPitch = face.pitch;
      if (roofSelectedSection >= 0 && face.sectionPitches && face.sectionPitches[roofSelectedSection] !== undefined) {
        displayPitch = face.sectionPitches[roofSelectedSection];
      }

      document.getElementById('roofPropPitch').value = displayPitch;
      document.getElementById('roofPropAzimuth').value = face.azimuth;
      var azDir = document.getElementById('roofPropAzDir');
      if (azDir) azDir.textContent = '(' + azimuthToCompass(face.azimuth) + ')';
      document.getElementById('roofPropHeight').value = (face.height * 3.28084).toFixed(1);

      // Slope as x/12
      var slopeVal = (12 * Math.tan(displayPitch * Math.PI / 180)).toFixed(1);
      var slopeEl = document.getElementById('roofPropSlope');
      if (slopeEl) slopeEl.textContent = slopeVal + ' / 12';

      // Area
      var areaFt2 = (calcPolygonArea(face.vertices) * 10.7639).toFixed(0);
      var areaEl = document.getElementById('roofPropArea');
      if (areaEl) areaEl.textContent = areaFt2 + ' ft\u00B2';

      // Modules & coverage
      var modEl = document.getElementById('roofPropModules');
      var covEl = document.getElementById('roofPropCoverage');
      var faceModules = face.modules || 0;
      if (modEl) modEl.textContent = faceModules > 0 ? faceModules : '\u2014';
      if (covEl) {
        if (faceModules > 0 && parseFloat(areaFt2) > 0) {
          var moduleFt2 = 17.6;
          var coverage = (faceModules * moduleFt2 / parseFloat(areaFt2) * 100).toFixed(1);
          covEl.textContent = coverage + '%';
        } else {
          covEl.textContent = '\u2014';
        }
      }

      // Edge lengths
      var edgeList = document.getElementById('roofEdgeLengthsList');
      if (edgeList) {
        var html = '<div style="font-size:0.7rem;color:#999;margin-top:8px;font-weight:600;">Edge Lengths</div>';
        for (var i = 0; i < face.vertices.length; i++) {
          var a = face.vertices[i], b = face.vertices[(i + 1) % face.vertices.length];
          var dx = b.x - a.x, dz = b.z - a.z;
          var ft = (Math.sqrt(dx * dx + dz * dz) * 3.28084).toFixed(1);
          html += '<div style="font-size:0.8rem;color:#ccc;padding:2px 0;">Edge ' + (i + 1) + ': ' + ft + ' ft</div>';
        }
        edgeList.innerHTML = html;
      }

      // Section info
      var sectionInfo = document.getElementById('roofSectionInfo');
      var btnDelSection = document.getElementById('btnDeleteRoofSection');
      var title = document.getElementById('roofPropsTitle');
      if (sectionInfo && btnDelSection) {
        if (roofSelectedSection >= 0 && roofSelectedSection < sectionNames.length) {
          sectionInfo.style.display = '';
          sectionInfo.textContent = sectionNames[roofSelectedSection];
          if (title) title.textContent = 'Roof face information';
          btnDelSection.style.display = '';
        } else {
          sectionInfo.style.display = 'none';
          if (title) title.textContent = 'Roof face information';
          btnDelSection.style.display = 'none';
        }
      }

      // Update Edge & Face panel
      updateEfPanel(face, displayPitch, sectionNames);
    }

    function updateEfPanel(face, displayPitch, sectionNames) {
      var efPanel = document.getElementById('efPanel');
      if (!efPanel) return;

      // Section name label
      var efName = document.getElementById('efSectionName');
      if (efName) {
        if (roofSelectedSection >= 0 && roofSelectedSection < sectionNames.length) {
          efName.textContent = sectionNames[roofSelectedSection];
          efName.style.display = '';
        } else {
          efName.style.display = 'none';
        }
      }

      // Pitch
      var efPitch = document.getElementById('efPitch');
      if (efPitch) efPitch.value = displayPitch;

      // Slope x/12
      var efSlope = document.getElementById('efSlope');
      if (efSlope) {
        var sv = (12 * Math.tan(displayPitch * Math.PI / 180)).toFixed(1);
        efSlope.textContent = sv + ' / 12';
      }

      // Azimuth
      var efAz = document.getElementById('efAzimuth');
      if (efAz) efAz.value = face.azimuth;
      var efAzDir = document.getElementById('efAzDir');
      if (efAzDir) efAzDir.textContent = azimuthToCompass(face.azimuth);

      // Height
      var efH = document.getElementById('efHeight');
      if (efH) efH.value = (face.height * 3.28084).toFixed(1);

      // Edge lengths
      var efEdges = document.getElementById('efEdgeLengths');
      if (efEdges) {
        var html = '';
        for (var i = 0; i < face.vertices.length; i++) {
          var a = face.vertices[i], b = face.vertices[(i + 1) % face.vertices.length];
          var dx = b.x - a.x, dz = b.z - a.z;
          var ft = (Math.sqrt(dx * dx + dz * dz) * 3.28084).toFixed(1);
          html += '<div class="ef-row"><span class="ef-label">Edge ' + (i + 1) + '</span><span class="ef-value">' + ft + ' ft</span></div>';
        }
        efEdges.innerHTML = html;
      }
    }

    /* ── Find handle under cursor ── */
    function findHandleUnderCursor(event) {
      var canvas = document.getElementById('canvas3d');
      var rect = canvas.getBoundingClientRect();
      mouse3d.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse3d.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster3d.setFromCamera(mouse3d, camera3d);
      for (var fi = 0; fi < roofFaces3d.length; fi++) {
        var hits = raycaster3d.intersectObjects(roofFaces3d[fi].handleMeshes);
        if (hits.length > 0) {
          var handleIdx = roofFaces3d[fi].handleMeshes.indexOf(hits[0].object);
          return { faceIdx: fi, vertexIdx: handleIdx };
        }
      }
      return null;
    }

    function findEdgeHandleUnderCursor(event) {
      var canvas = document.getElementById('canvas3d');
      var rect = canvas.getBoundingClientRect();
      mouse3d.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse3d.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster3d.setFromCamera(mouse3d, camera3d);
      // Check edge handle box meshes first
      for (var fi = 0; fi < roofFaces3d.length; fi++) {
        if (!roofFaces3d[fi].edgeHandleMeshes) continue;
        var hits = raycaster3d.intersectObjects(roofFaces3d[fi].edgeHandleMeshes);
        if (hits.length > 0) {
          var edgeIdx = roofFaces3d[fi].edgeHandleMeshes.indexOf(hits[0].object);
          return { faceIdx: fi, edgeIdx: edgeIdx };
        }
      }
      // Fall back: click anywhere near an edge line (10px hit zone)
      var gp = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      var pt = new THREE.Vector3();
      if (!raycaster3d.ray.intersectPlane(gp, pt)) return null;
      var threshold = getWorldPerPixel() * 10;
      var bestDist = threshold, bestFace = -1, bestEdge = -1;
      for (var fi = 0; fi < roofFaces3d.length; fi++) {
        var verts = roofFaces3d[fi].vertices;
        if (!verts || verts.length < 3) continue;
        for (var ei = 0; ei < verts.length; ei++) {
          var a = verts[ei], b = verts[(ei + 1) % verts.length];
          var abx = b.x - a.x, abz = b.z - a.z;
          var ab2 = abx * abx + abz * abz;
          if (ab2 < 0.001) continue;
          var t = ((pt.x - a.x) * abx + (pt.z - a.z) * abz) / ab2;
          if (t < 0.05 || t > 0.95) continue;
          var cx = a.x + t * abx, cz = a.z + t * abz;
          var dist = Math.sqrt(Math.pow(pt.x - cx, 2) + Math.pow(pt.z - cz, 2));
          if (dist < bestDist) { bestDist = dist; bestFace = fi; bestEdge = ei; }
        }
      }
      if (bestFace >= 0) return { faceIdx: bestFace, edgeIdx: bestEdge };
      return null;
    }

    /* ── Find face and section mesh under cursor ── */
    function findRoofFaceUnderCursor(event) {
      var canvas = document.getElementById('canvas3d');
      var rect = canvas.getBoundingClientRect();
      mouse3d.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse3d.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster3d.setFromCamera(mouse3d, camera3d);

      // Collect all section meshes for raycasting
      var allMeshes = [];
      var meshMap = [];
      for (var fi = 0; fi < roofFaces3d.length; fi++) {
        var sm = roofFaces3d[fi].sectionMeshes;
        if (!sm) continue;
        for (var si = 0; si < sm.length; si++) {
          if (sm[si]) {
            allMeshes.push(sm[si]);
            meshMap.push({ faceIdx: fi, sectionIdx: si });
          }
        }
      }

      var hits = raycaster3d.intersectObjects(allMeshes);
      if (hits.length > 0) {
        for (var i = 0; i < allMeshes.length; i++) {
          if (allMeshes[i] === hits[0].object) return meshMap[i];
        }
      }
      return { faceIdx: -1, sectionIdx: -1 };
    }

    // Find dormer mesh under cursor
    function findDormerUnderCursor(event) {
      var canvas = document.getElementById('canvas3d');
      var rect = canvas.getBoundingClientRect();
      mouse3d.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse3d.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster3d.setFromCamera(mouse3d, camera3d);

      var allMeshes = [];
      var meshMap = [];
      for (var fi = 0; fi < roofFaces3d.length; fi++) {
        var dormers = roofFaces3d[fi].dormers;
        if (!dormers) continue;
        for (var di = 0; di < dormers.length; di++) {
          if (dormers[di].mesh) {
            dormers[di].mesh.traverse(function(child) {
              if (child.isMesh) {
                allMeshes.push(child);
                meshMap.push({ faceIdx: fi, dormerIdx: di });
              }
            });
          }
        }
      }

      var hits = raycaster3d.intersectObjects(allMeshes);
      if (hits.length > 0) {
        for (var i = 0; i < allMeshes.length; i++) {
          if (allMeshes[i] === hits[0].object) return meshMap[i];
        }
      }
      return { faceIdx: -1, dormerIdx: -1 };
    }

    // Find dormer handle under cursor
    function findDormerHandleUnderCursor(event) {
      var canvas = document.getElementById('canvas3d');
      var rect = canvas.getBoundingClientRect();
      mouse3d.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse3d.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster3d.setFromCamera(mouse3d, camera3d);

      for (var fi = 0; fi < roofFaces3d.length; fi++) {
        var dormers = roofFaces3d[fi].dormers;
        if (!dormers) continue;
        for (var di = 0; di < dormers.length; di++) {
          if (!dormers[di].handleMeshes || dormers[di].handleMeshes.length === 0) continue;
          var hits = raycaster3d.intersectObjects(dormers[di].handleMeshes);
          if (hits.length > 0) {
            var handleIdx = dormers[di].handleMeshes.indexOf(hits[0].object);
            return { faceIdx: fi, dormerIdx: di, handleIdx: handleIdx };
          }
        }
      }
      return null;
    }

    /* ── Drawing mode toggle ── */
    function toggleRoofDrawingMode() {
      if (treePlacingMode) toggleTreeMode();
      if (smartRoofPickMode) { smartRoofPickMode = false; clearRoofPreview(); clearSnapGuides(); roofTempVertices = []; }
      roofDrawingMode = !roofDrawingMode;
      var canvas = document.getElementById('canvas3d');
      var banner = document.getElementById('roofModeBanner');
      if (roofDrawingMode) {
        canvas.style.cursor = 'crosshair';
        roofTempVertices = [];
        clearRoofPreview();
        if (banner) banner.style.display = 'flex';
      } else {
        canvas.style.cursor = '';
        clearRoofPreview();
        roofTempVertices = [];
        if (banner) banner.style.display = 'none';
      }
    }

    /* ── Preview helpers ── */
    function addRoofPreviewHandle(x, z) {
      var sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0xf5a623 })
      );
      sphere.position.set(x, 0.2, z);
      scene3d.add(sphere);
      roofTempHandles.push(sphere);
    }

    function updateRoofPreviewLines() {
      if (roofTempLines) { scene3d.remove(roofTempLines); roofTempLines = null; }
      if (roofTempVertices.length < 2) return;
      var positions = [];
      for (var i = 0; i < roofTempVertices.length; i++) {
        var a = roofTempVertices[i];
        var b = roofTempVertices[(i + 1) % roofTempVertices.length];
        positions.push(a.x, 0.15, a.z, b.x, 0.15, b.z);
      }
      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      roofTempLines = new THREE.LineSegments(geo, new THREE.LineDashedMaterial({
        color: 0xf5a623, dashSize: 0.5, gapSize: 0.3, linewidth: 2
      }));
      roofTempLines.computeLineDistances();
      scene3d.add(roofTempLines);
    }

    function clearRoofPreview() {
      roofTempHandles.forEach(function(h) { scene3d.remove(h); });
      roofTempHandles = [];
      if (roofTempLines) { scene3d.remove(roofTempLines); roofTempLines = null; }
      clearSnapGuides();
    }

    /* ── Snap guides for roof vertex placement ── */
    var SNAP_THRESHOLD = 0.8; // meters — how close cursor must be to snap
    var GUIDE_EXTENT = 80;    // meters — how far guide lines extend
    var snapGuideMat = null;  // shared material for guide lines

    function getSnapGuideMat() {
      if (!snapGuideMat) {
        snapGuideMat = new THREE.LineDashedMaterial({
          color: 0xff6600, dashSize: 0.5, gapSize: 0.3,
          linewidth: 1.2, transparent: true, opacity: 0.85
        });
      }
      return snapGuideMat;
    }

    function clearSnapGuides() {
      roofSnapGuides.forEach(function(g) { scene3d.remove(g); });
      roofSnapGuides = [];
      roofSnappedPos = null;
    }

    function addGuideLine(x1, z1, x2, z2) {
      // Single dashed line — fixed pixel width regardless of zoom
      var lineGeo = new THREE.BufferGeometry();
      lineGeo.setAttribute('position', new THREE.Float32BufferAttribute([x1, 0.25, z1, x2, 0.25, z2], 3));
      var line = new THREE.Line(lineGeo, getSnapGuideMat().clone());
      line.computeLineDistances();
      line.renderOrder = 1000;
      scene3d.add(line);
      roofSnapGuides.push(line);
    }

    function computeSnapGuides(cursorX, cursorZ) {
      clearSnapGuides();
      var n = roofTempVertices.length;
      if (n === 0) return { x: cursorX, z: cursorZ };

      // ── 2nd dot: guide line through v0 in the direction of cursor (180° line) ──
      if (n === 1) {
        var v0 = roofTempVertices[0];
        var dx = cursorX - v0.x;
        var dz = cursorZ - v0.z;
        var len = Math.sqrt(dx * dx + dz * dz);
        if (len > 0.01) {
          var ux = dx / len, uz = dz / len;
          addGuideLine(v0.x - ux * GUIDE_EXTENT, v0.z - uz * GUIDE_EXTENT,
                       v0.x + ux * GUIDE_EXTENT, v0.z + uz * GUIDE_EXTENT);
        }
        return { x: cursorX, z: cursorZ };
      }

      // ── 3rd dot: guide perpendicular to edge v0→v1, from v1 ──
      if (n === 2) {
        var v0 = roofTempVertices[0], v1 = roofTempVertices[1];
        var edx = v1.x - v0.x, edz = v1.z - v0.z;
        var elen = Math.sqrt(edx * edx + edz * edz);
        if (elen > 0.01) {
          // Perpendicular direction from v1
          var px = -edz / elen, pz = edx / elen;
          addGuideLine(v1.x - px * GUIDE_EXTENT, v1.z - pz * GUIDE_EXTENT,
                       v1.x + px * GUIDE_EXTENT, v1.z + pz * GUIDE_EXTENT);
          // Snap: project cursor onto the perpendicular line from v1
          var toX = cursorX - v1.x, toZ = cursorZ - v1.z;
          var perpDist = Math.abs(toX * edx / elen + toZ * edz / elen);
          if (perpDist < SNAP_THRESHOLD) {
            var projDist = toX * px + toZ * pz;
            var snappedX = v1.x + px * projDist;
            var snappedZ = v1.z + pz * projDist;
            roofSnappedPos = { x: snappedX, z: snappedZ };
            return { x: snappedX, z: snappedZ };
          }
        }
        return { x: cursorX, z: cursorZ };
      }

      // ── 4th dot: two guides — from v0 (perpendicular to v0→v1) and from v2 (parallel to v0→v1) ──
      //    Their intersection completes the rectangle.
      if (n === 3) {
        var v0 = roofTempVertices[0], v1 = roofTempVertices[1], v2 = roofTempVertices[2];
        var edx = v1.x - v0.x, edz = v1.z - v0.z;
        var elen = Math.sqrt(edx * edx + edz * edz);
        if (elen > 0.01) {
          var ux = edx / elen, uz = edz / elen;   // along v0→v1
          var px = -uz, pz = ux;                   // perpendicular

          // Guide 1: from v0, perpendicular to v0→v1
          addGuideLine(v0.x - px * GUIDE_EXTENT, v0.z - pz * GUIDE_EXTENT,
                       v0.x + px * GUIDE_EXTENT, v0.z + pz * GUIDE_EXTENT);
          // Guide 2: from v2, parallel to v0→v1
          addGuideLine(v2.x - ux * GUIDE_EXTENT, v2.z - uz * GUIDE_EXTENT,
                       v2.x + ux * GUIDE_EXTENT, v2.z + uz * GUIDE_EXTENT);

          // Intersection = the perfect rectangle corner
          // v0 + t*p = v2 + s*u  →  solve for t
          // t = ((v2-v0) cross u) / (p cross u)  [2D cross = ax*bz - az*bx]
          var crossPU = px * uz - pz * ux;
          if (Math.abs(crossPU) > 0.0001) {
            var dxv = v2.x - v0.x, dzv = v2.z - v0.z;
            var t = (dxv * uz - dzv * ux) / crossPU;
            var snapX = v0.x + px * t;
            var snapZ = v0.z + pz * t;

            // Snap if cursor is close to the intersection
            var dist = Math.sqrt(Math.pow(cursorX - snapX, 2) + Math.pow(cursorZ - snapZ, 2));
            if (dist < SNAP_THRESHOLD * 2) {
              roofSnappedPos = { x: snapX, z: snapZ };
              return { x: snapX, z: snapZ };
            }
          }
        }
        return { x: cursorX, z: cursorZ };
      }

      // 5+ dots: no guides
      return { x: cursorX, z: cursorZ };
    }

    /* ── Smart Roof auto-generate from Solar API ── */
    /* ── ROOF DETECTION ALGORITHMS ── */

    /* Douglas-Peucker line simplification */
    function douglasPeucker(pts, tol) {
      if (pts.length <= 2) return pts;
      var maxDist = 0, maxIdx = 0;
      var a = pts[0], b = pts[pts.length - 1];
      var dx = b.x - a.x, dz = b.z - a.z;
      var lenSq = dx * dx + dz * dz;
      for (var i = 1; i < pts.length - 1; i++) {
        var t = lenSq > 0 ? Math.max(0, Math.min(1, ((pts[i].x - a.x) * dx + (pts[i].z - a.z) * dz) / lenSq)) : 0;
        var px = a.x + t * dx, pz = a.z + t * dz;
        var d = Math.sqrt((pts[i].x - px) * (pts[i].x - px) + (pts[i].z - pz) * (pts[i].z - pz));
        if (d > maxDist) { maxDist = d; maxIdx = i; }
      }
      if (maxDist > tol) {
        var left = douglasPeucker(pts.slice(0, maxIdx + 1), tol);
        var right = douglasPeucker(pts.slice(maxIdx), tol);
        return left.slice(0, -1).concat(right);
      }
      return [pts[0], pts[pts.length - 1]];
    }

    /* Extract building points from raw LiDAR */
    function extractBuildingPoints(rawPoints) {
      if (!rawPoints || rawPoints.length === 0) return { pts3d: [], pts2d: [], grid: null, gridSize: 0, minX: 0, minZ: 0, step: 0 };
      var minElev = Infinity;
      for (var i = 0; i < rawPoints.length; i++) {
        if (rawPoints[i][2] < minElev) minElev = rawPoints[i][2];
      }
      var threshold = minElev + 1.0;

      // Convert all points to local coords and build grid
      var allLocal = [];
      var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (var i = 0; i < rawPoints.length; i++) {
        var p = rawPoints[i];
        var loc = geoToLocal(p[1], p[0]);
        allLocal.push({ x: loc.x, z: loc.z, elev: p[2] });
        if (loc.x < minX) minX = loc.x;
        if (loc.x > maxX) maxX = loc.x;
        if (loc.z < minZ) minZ = loc.z;
        if (loc.z > maxZ) maxZ = loc.z;
      }

      // Build binary grid
      var gridSize = 177;
      var stepX = (maxX - minX) / (gridSize - 1);
      var stepZ = (maxZ - minZ) / (gridSize - 1);
      var step = Math.max(stepX, stepZ) || 0.4;
      var grid = [];
      for (var r = 0; r < gridSize; r++) {
        grid[r] = [];
        for (var c = 0; c < gridSize; c++) grid[r][c] = 0;
      }

      var pts3d = []; // {x, z, elev} building points
      for (var i = 0; i < allLocal.length; i++) {
        var p = allLocal[i];
        var col = Math.round((p.x - minX) / step);
        var row = Math.round((p.z - minZ) / step);
        if (row >= 0 && row < gridSize && col >= 0 && col < gridSize) {
          if (p.elev > threshold) {
            grid[row][col] = 1;
            pts3d.push(p);
          }
        }
      }

      return { pts3d: pts3d, grid: grid, gridSize: gridSize, minX: minX, minZ: minZ, step: step, threshold: threshold };
    }

    /* Marching squares contour tracing on binary grid → boundary points */
    function traceContour(grid, numRows, minX, minZ, step, numCols) {
      var rows = numRows;
      var cols = numCols || numRows; // support separate row/col counts
      // Find a starting edge cell
      var startR = -1, startC = -1;
      for (var r = 0; r < rows - 1 && startR < 0; r++) {
        for (var c = 0; c < cols - 1; c++) {
          var val = (grid[r][c] ? 8 : 0) | (grid[r][c + 1] ? 4 : 0) |
                    (grid[r + 1][c + 1] ? 2 : 0) | (grid[r + 1][c] ? 1 : 0);
          if (val > 0 && val < 15) { startR = r; startC = c; break; }
        }
      }
      if (startR < 0) return [];

      // Walk the contour using marching squares with direction tracking
      var boundary = [];
      var visited = {};
      var r = startR, c = startC;
      var maxIter = rows * cols;
      var prevDr = 0, prevDc = 1; // initial direction: right

      for (var iter = 0; iter < maxIter; iter++) {
        var key = r + ',' + c;
        if (visited[key] && iter > 2) break;
        visited[key] = true;

        var tl = (r >= 0 && c >= 0 && r < rows && c < cols) ? grid[r][c] : 0;
        var tr = (r >= 0 && c + 1 < cols) ? grid[r][c + 1] : 0;
        var br = (r + 1 < rows && c + 1 < cols) ? grid[r + 1][c + 1] : 0;
        var bl = (r + 1 < rows && c >= 0) ? grid[r + 1][c] : 0;
        var val = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);

        // Emit midpoint of the cell
        var cx = minX + (c + 0.5) * step;
        var cz = minZ + (r + 0.5) * step;
        boundary.push({ x: cx, z: cz });

        // March direction based on case (with direction tracking for ambiguous cases)
        var dr = 0, dc = 0;
        if (val === 1 || val === 5 || val === 13) { dr = 1; }
        else if (val === 2 || val === 3 || val === 7) { dc = 1; }
        else if (val === 4 || val === 10 || val === 14) { dr = -1; }
        else if (val === 8 || val === 12 || val === 11) { dc = -1; }
        else if (val === 6) {
          // tr+br filled (left boundary): go up for clockwise, use prev direction for ambiguous
          if (prevDr === 1) { dc = 1; } else { dr = -1; }
        }
        else if (val === 9) {
          // tl+bl filled (right boundary): go down for clockwise, use prev direction for ambiguous
          if (prevDr === -1) { dc = -1; } else { dr = 1; }
        }
        else break;

        prevDr = dr; prevDc = dc;
        r += dr; c += dc;

        if (r < -1 || r >= rows || c < -1 || c >= cols) break;
      }

      return boundary;
    }

    /* Orthogonalize: snap edges to building's dominant axis */
    function orthogonalize(pts) {
      if (pts.length < 4) return pts;

      // Find dominant axis from the longest edge
      var bestLen = 0, domAngle = 0;
      for (var i = 0; i < pts.length; i++) {
        var j = (i + 1) % pts.length;
        var dx = pts[j].x - pts[i].x, dz = pts[j].z - pts[i].z;
        var len = dx * dx + dz * dz;
        if (len > bestLen) { bestLen = len; domAngle = Math.atan2(dz, dx); }
      }
      // Dominant axis unit vectors
      var ax = Math.cos(domAngle), az = Math.sin(domAngle);
      var bx = -az, bz = ax; // perpendicular

      var result = pts.slice();
      for (var pass = 0; pass < 3; pass++) {
        for (var i = 0; i < result.length; i++) {
          var prev = result[(i - 1 + result.length) % result.length];
          var curr = result[i];
          var next = result[(i + 1) % result.length];
          var dx1 = curr.x - prev.x, dz1 = curr.z - prev.z;
          var dx2 = next.x - curr.x, dz2 = next.z - curr.z;
          var angle = Math.abs(Math.atan2(dx1 * dz2 - dz1 * dx2, dx1 * dx2 + dz1 * dz2));
          // If angle is close to 90° (within 15°), snap to dominant axis grid
          if (Math.abs(angle - Math.PI / 2) < 0.26) {
            // Determine which dominant direction the incoming edge is closest to
            var len1 = Math.sqrt(dx1 * dx1 + dz1 * dz1) || 1;
            var edx = dx1 / len1, edz = dz1 / len1;
            var dotA = Math.abs(edx * ax + edz * az);
            var dotB = Math.abs(edx * bx + edz * bz);
            // Perpendicular to incoming edge, aligned to dominant grid
            var nx, nz;
            if (dotA >= dotB) {
              // Incoming edge is along axis A, so next should be along axis B
              nx = bx; nz = bz;
            } else {
              nx = ax; nz = az;
            }
            // Choose sign to match outgoing direction
            var outDot = (next.x - curr.x) * nx + (next.z - curr.z) * nz;
            if (outDot < 0) { nx = -nx; nz = -nz; outDot = -outDot; }
            result[(i + 1) % result.length] = { x: curr.x + nx * outDot, z: curr.z + nz * outDot };
          }
        }
      }
      return result;
    }

    /* RANSAC plane fitting on 3D building points */
    function ransacPlanes(pts3d, maxPlanes) {
      var planes = [];
      var remaining = pts3d.slice();
      var minInliers = Math.max(20, remaining.length * 0.05);

      for (var p = 0; p < maxPlanes && remaining.length > minInliers; p++) {
        var bestPlane = null, bestInliers = [], bestCount = 0;
        var iterations = Math.min(200, remaining.length * 2);

        for (var iter = 0; iter < iterations; iter++) {
          // Pick 3 random points
          var i0 = Math.floor(Math.random() * remaining.length);
          var i1 = Math.floor(Math.random() * remaining.length);
          var i2 = Math.floor(Math.random() * remaining.length);
          if (i0 === i1 || i1 === i2 || i0 === i2) continue;

          var p0 = remaining[i0], p1 = remaining[i1], p2 = remaining[i2];
          // Compute plane normal via cross product
          var ux = p1.x - p0.x, uy = p1.elev - p0.elev, uz = p1.z - p0.z;
          var vx = p2.x - p0.x, vy = p2.elev - p0.elev, vz = p2.z - p0.z;
          var nx = uy * vz - uz * vy;
          var ny = uz * vx - ux * vz;
          var nz = ux * vy - uy * vx;
          var len = Math.sqrt(nx * nx + ny * ny + nz * nz);
          if (len < 0.001) continue;
          nx /= len; ny /= len; nz /= len;
          var d = -(nx * p0.x + ny * p0.elev + nz * p0.z);

          // Count inliers (within 0.3m of plane)
          var inliers = [];
          for (var j = 0; j < remaining.length; j++) {
            var dist = Math.abs(nx * remaining[j].x + ny * remaining[j].elev + nz * remaining[j].z + d);
            if (dist < 0.3) inliers.push(j);
          }

          if (inliers.length > bestCount) {
            bestCount = inliers.length;
            bestPlane = { nx: nx, ny: ny, nz: nz, d: d };
            bestInliers = inliers;
          }
        }

        if (bestCount < minInliers) break;

        // Extract inlier points
        var planePoints = bestInliers.map(function(idx) { return remaining[idx]; });
        // Compute pitch and azimuth from normal
        var pitch = Math.acos(Math.abs(bestPlane.ny)) * 180 / Math.PI;
        var azimuth = Math.atan2(bestPlane.nx, bestPlane.nz) * 180 / Math.PI;
        if (azimuth < 0) azimuth += 360;

        planes.push({ normal: bestPlane, points: planePoints, pitch: pitch, azimuth: azimuth });

        // Remove inliers from remaining (reverse order to preserve indices)
        bestInliers.sort(function(a, b) { return b - a; });
        for (var k = 0; k < bestInliers.length; k++) remaining.splice(bestInliers[k], 1);
      }

      return planes;
    }

    /* Compute concave hull of 2D points (simplified: convex hull + refine) */
    function convexHull2d(pts) {
      if (pts.length < 3) return pts;
      // Graham scan
      pts = pts.slice().sort(function(a, b) { return a.x - b.x || a.z - b.z; });
      var lower = [];
      for (var i = 0; i < pts.length; i++) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop();
        lower.push(pts[i]);
      }
      var upper = [];
      for (var i = pts.length - 1; i >= 0; i--) {
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
        upper.push(pts[i]);
      }
      return lower.slice(0, -1).concat(upper.slice(0, -1));
    }
    function cross(o, a, b) { return (a.x - o.x) * (b.z - o.z) - (a.z - o.z) * (b.x - o.x); }

    /* Build face boundaries from RANSAC planes */
    function planesToFaces(planes) {
      var faces = [];
      var faceColors = ['#f5a623', '#4a9eff', '#22c55e', '#e879f9', '#f97316', '#06b6d4'];
      for (var i = 0; i < planes.length; i++) {
        var plane = planes[i];
        var pts2d = plane.points.map(function(p) { return { x: p.x, z: p.z }; });
        if (pts2d.length < 3) continue;

        // Get boundary of this face's points
        var hull = convexHull2d(pts2d);
        if (hull.length < 3) continue;

        // Simplify
        hull = douglasPeucker(hull, 0.4);
        if (hull.length < 3) continue;

        faces.push({
          vertices: hull,
          pitch: plane.pitch,
          azimuth: plane.azimuth,
          color: faceColors[i % faceColors.length]
        });
      }
      return faces;
    }

    /* ══ ELEVATION FLOOD-FILL ROOF DETECTION ══
       1. Click → find nearest DSM grid cell
       2. Flood-fill to adjacent cells within ±1m elevation of neighbor
       3. Trace boundary of flood-filled region = building footprint
       4. Split into faces using Solar API segment centroids (Voronoi)
       ═══════════════════════════════════════════ */

    /* Build a local elevation grid from raw LiDAR points */
    function buildElevGrid(rawPoints) {
      var minElev = Infinity, minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
      for (var i = 0; i < rawPoints.length; i++) {
        var p = rawPoints[i];
        if (p[2] < minElev) minElev = p[2];
        if (p[1] < minLat) minLat = p[1];
        if (p[1] > maxLat) maxLat = p[1];
        if (p[0] < minLng) minLng = p[0];
        if (p[0] > maxLng) maxLng = p[0];
      }

      // Build grid in local XZ coords
      var allLocal = [];
      var lMinX = Infinity, lMaxX = -Infinity, lMinZ = Infinity, lMaxZ = -Infinity;
      for (var i = 0; i < rawPoints.length; i++) {
        var p = rawPoints[i];
        var loc = geoToLocal(p[1], p[0]);
        allLocal.push({ x: loc.x, z: loc.z, elev: p[2] });
        if (loc.x < lMinX) lMinX = loc.x;
        if (loc.x > lMaxX) lMaxX = loc.x;
        if (loc.z < lMinZ) lMinZ = loc.z;
        if (loc.z > lMaxZ) lMaxZ = loc.z;
      }

      var cellSize = 0.4; // ~matches DSM grid spacing
      var cols = Math.ceil((lMaxX - lMinX) / cellSize) + 1;
      var rows = Math.ceil((lMaxZ - lMinZ) / cellSize) + 1;
      var elev = [];
      for (var r = 0; r < rows; r++) {
        elev[r] = [];
        for (var c = 0; c < cols; c++) elev[r][c] = -9999;
      }

      for (var i = 0; i < allLocal.length; i++) {
        var p = allLocal[i];
        var c = Math.round((p.x - lMinX) / cellSize);
        var r = Math.round((p.z - lMinZ) / cellSize);
        if (r >= 0 && r < rows && c >= 0 && c < cols) {
          if (p.elev > elev[r][c]) elev[r][c] = p.elev; // keep max elevation per cell
        }
      }

      return { elev: elev, rows: rows, cols: cols, minX: lMinX, minZ: lMinZ, cellSize: cellSize, groundElev: minElev };
    }

    /* Flood-fill from a grid cell: spread to neighbors within elevation tolerance */
    function floodFillRoof(grid, startRow, startCol, elevTol, maxRadius) {
      var rows = grid.rows, cols = grid.cols, elev = grid.elev;
      if (startRow < 0 || startRow >= rows || startCol < 0 || startCol >= cols) return [];
      if (elev[startRow][startCol] <= grid.groundElev + 1.0) return [];

      var maxCells = maxRadius ? Math.ceil(maxRadius / grid.cellSize) : Infinity;

      var visited = [];
      for (var r = 0; r < rows; r++) {
        visited[r] = [];
        for (var c = 0; c < cols; c++) visited[r][c] = false;
      }

      var queue = [{ r: startRow, c: startCol }];
      visited[startRow][startCol] = true;
      var filled = [];
      var dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[-1,1],[1,-1],[1,1]]; // 8-connected

      while (queue.length > 0) {
        var cell = queue.shift();
        var cellElev = elev[cell.r][cell.c];
        if (cellElev <= grid.groundElev + 1.0) continue; // below building threshold

        // Max radius constraint from click point
        var dr = cell.r - startRow, dc = cell.c - startCol;
        if (dr * dr + dc * dc > maxCells * maxCells) continue;

        filled.push(cell);

        for (var d = 0; d < 4; d++) {
          var nr = cell.r + dirs[d][0], nc = cell.c + dirs[d][1];
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
          if (visited[nr][nc]) continue;
          visited[nr][nc] = true;
          var neighborElev = elev[nr][nc];
          if (neighborElev <= grid.groundElev + 1.0) continue; // ground
          if (Math.abs(neighborElev - cellElev) > elevTol) continue; // elevation jump = edge
          queue.push({ r: nr, c: nc });
        }
      }
      return filled;
    }

    /* Convert flood-fill cells to a boundary polygon using Moore contour tracing */
    function cellsToBoundary(cells, grid) {
      if (cells.length < 3) return [];

      // Build 2D bitmap of filled cells for fast lookup
      var minR = Infinity, maxR = -Infinity, minC = Infinity, maxC = -Infinity;
      for (var i = 0; i < cells.length; i++) {
        if (cells[i].r < minR) minR = cells[i].r;
        if (cells[i].r > maxR) maxR = cells[i].r;
        if (cells[i].c < minC) minC = cells[i].c;
        if (cells[i].c > maxC) maxC = cells[i].c;
      }
      var bRows = maxR - minR + 3, bCols = maxC - minC + 3; // +3 for 1-cell padding
      var bitmap = [];
      for (var r = 0; r < bRows; r++) {
        bitmap[r] = [];
        for (var c = 0; c < bCols; c++) bitmap[r][c] = 0;
      }
      for (var i = 0; i < cells.length; i++) {
        bitmap[cells[i].r - minR + 1][cells[i].c - minC + 1] = 1;
      }

      // Find starting cell: topmost row, leftmost column
      var startR = -1, startC = -1;
      for (var r = 0; r < bRows && startR < 0; r++) {
        for (var c = 0; c < bCols; c++) {
          if (bitmap[r][c] === 1) { startR = r; startC = c; break; }
        }
      }
      if (startR < 0) return [];

      // Moore boundary trace (clockwise)
      // 8-neighbor directions: 0=up, 1=up-right, 2=right, 3=down-right, 4=down, 5=down-left, 6=left, 7=up-left
      var dr = [-1, -1, 0, 1, 1, 1, 0, -1];
      var dc = [0, 1, 1, 1, 0, -1, -1, -1];

      var contour = [];
      var cr = startR, cc = startC;
      var dir = 6; // start looking left (came from the left since we found leftmost)
      var maxSteps = cells.length * 4; // safety limit
      var steps = 0;

      do {
        contour.push({ r: cr, c: cc });
        // Search clockwise from (dir + 5) % 8 for next boundary cell
        var searchStart = (dir + 5) % 8; // backtrack: turn around and go clockwise
        var found = false;
        for (var i = 0; i < 8; i++) {
          var d = (searchStart + i) % 8;
          var nr = cr + dr[d], nc = cc + dc[d];
          if (nr >= 0 && nr < bRows && nc >= 0 && nc < bCols && bitmap[nr][nc] === 1) {
            dir = d;
            cr = nr;
            cc = nc;
            found = true;
            break;
          }
        }
        if (!found) break;
        steps++;
      } while ((cr !== startR || cc !== startC) && steps < maxSteps);

      if (contour.length < 3) {
        // Fallback to convex hull
        var pts = [];
        for (var i = 0; i < cells.length; i++) {
          var r = cells[i].r, c = cells[i].c;
          var hasEmpty = false;
          for (var d = 0; d < 8; d++) {
            var nr = r - minR + 1 + dr[d], nc = c - minC + 1 + dc[d];
            if (nr < 0 || nr >= bRows || nc < 0 || nc >= bCols || bitmap[nr][nc] === 0) { hasEmpty = true; break; }
          }
          if (hasEmpty) pts.push({ x: grid.minX + c * grid.cellSize, z: grid.minZ + r * grid.cellSize });
        }
        return pts.length >= 3 ? convexHull2d(pts) : [];
      }

      // Convert contour cells back to world coordinates
      var boundary = [];
      for (var i = 0; i < contour.length; i++) {
        var worldC = contour[i].c - 1 + minC; // undo padding offset
        var worldR = contour[i].r - 1 + minR;
        boundary.push({
          x: grid.minX + worldC * grid.cellSize,
          z: grid.minZ + worldR * grid.cellSize
        });
      }
      return boundary;
    }

    /* Split a footprint polygon into faces using Solar API segment centroids */
    function splitBySegments(footprintVerts, segs) {
      if (!segs || segs.length <= 1) {
        // Single face — use the whole footprint
        var pitch = segs && segs.length === 1 ? (segs[0].pitchDegrees || 0) : 0;
        var az = segs && segs.length === 1 ? (segs[0].azimuthDegrees || 180) : 180;
        return [{ vertices: footprintVerts, pitch: pitch, azimuth: az }];
      }

      // Convert segment centers to local coords
      var segLocal = segs.map(function(seg) {
        var loc = geoToLocal(seg.center.latitude, seg.center.longitude);
        return { x: loc.x, z: loc.z, pitch: seg.pitchDegrees || 0, azimuth: seg.azimuthDegrees || 180, area: (seg.stats && seg.stats.areaMeters2) || 50 };
      });

      // Sample many points inside the footprint, assign each to nearest segment
      var minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (var i = 0; i < footprintVerts.length; i++) {
        if (footprintVerts[i].x < minX) minX = footprintVerts[i].x;
        if (footprintVerts[i].x > maxX) maxX = footprintVerts[i].x;
        if (footprintVerts[i].z < minZ) minZ = footprintVerts[i].z;
        if (footprintVerts[i].z > maxZ) maxZ = footprintVerts[i].z;
      }

      // Point-in-polygon test (ray casting)
      function pointInPoly(px, pz, poly) {
        var inside = false;
        for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
          var xi = poly[i].x, zi = poly[i].z, xj = poly[j].x, zj = poly[j].z;
          if ((zi > pz) !== (zj > pz) && px < (xj - xi) * (pz - zi) / (zj - zi) + xi) inside = !inside;
        }
        return inside;
      }

      // Assign grid points to segments (Voronoi-like)
      var segPoints = [];
      for (var s = 0; s < segLocal.length; s++) segPoints[s] = [];

      var step = 0.3;
      for (var x = minX; x <= maxX; x += step) {
        for (var z = minZ; z <= maxZ; z += step) {
          if (!pointInPoly(x, z, footprintVerts)) continue;
          // Find nearest segment center
          var bestSeg = 0, bestDist = Infinity;
          for (var s = 0; s < segLocal.length; s++) {
            var dx = x - segLocal[s].x, dz = z - segLocal[s].z;
            var dist = dx * dx + dz * dz;
            if (dist < bestDist) { bestDist = dist; bestSeg = s; }
          }
          segPoints[bestSeg].push({ x: x, z: z });
        }
      }

      // Build face polygon for each segment that has enough points
      var faces = [];
      for (var s = 0; s < segLocal.length; s++) {
        if (segPoints[s].length < 5) continue;
        var hull = convexHull2d(segPoints[s]);
        if (hull.length < 3) continue;
        hull = douglasPeucker(hull, 0.3);
        if (hull.length < 3) continue;
        faces.push({ vertices: hull, pitch: segLocal[s].pitch, azimuth: segLocal[s].azimuth });
      }

      // If no segment splitting worked, return whole footprint as one face
      if (faces.length === 0) {
        return [{ vertices: footprintVerts, pitch: segs[0].pitchDegrees || 0, azimuth: segs[0].azimuthDegrees || 180 }];
      }
      return faces;
    }

    /* ── Detect roof at clicked point: flood-fill + segment split ── */
    function detectRoofAtPoint(worldX, worldZ) {
      if (!lidarRawPoints || lidarRawPoints.length === 0) return;

      // Build elevation grid
      var grid = buildElevGrid(lidarRawPoints);

      // Account for LiDAR position offset (auto-align / calibration)
      var lidarOffX = lidarPoints ? lidarPoints.position.x : 0;
      var lidarOffZ = lidarPoints ? lidarPoints.position.z : 0;
      var adjX = worldX - lidarOffX;
      var adjZ = worldZ - lidarOffZ;

      // Find grid cell nearest to click
      var clickCol = Math.round((adjX - grid.minX) / grid.cellSize);
      var clickRow = Math.round((adjZ - grid.minZ) / grid.cellSize);

      console.log('=== ROOF DETECT DEBUG ===');
      console.log('Click world:', worldX.toFixed(2), worldZ.toFixed(2));
      console.log('LiDAR offset:', lidarOffX.toFixed(2), lidarOffZ.toFixed(2));
      console.log('Adjusted click:', adjX.toFixed(2), adjZ.toFixed(2));
      console.log('Grid: rows=' + grid.rows + ' cols=' + grid.cols + ' cellSize=' + grid.cellSize);
      console.log('Grid extent X: ' + grid.minX.toFixed(2) + ' to ' + (grid.minX + grid.cols * grid.cellSize).toFixed(2));
      console.log('Grid extent Z: ' + grid.minZ.toFixed(2) + ' to ' + (grid.minZ + grid.rows * grid.cellSize).toFixed(2));
      console.log('Click cell: row=' + clickRow + ' col=' + clickCol);
      console.log('Cell elev:', (clickRow >= 0 && clickRow < grid.rows && clickCol >= 0 && clickCol < grid.cols) ? grid.elev[clickRow][clickCol].toFixed(2) : 'OUT OF BOUNDS');
      console.log('Ground elev:', grid.groundElev.toFixed(2), 'threshold:', (grid.groundElev + 1.0).toFixed(2));

      // Flood-fill from click: follow roof surface, stop at edges
      var filled = floodFillRoof(grid, clickRow, clickCol, 0.6, 20);

      console.log('Flood fill cells:', filled.length);

      if (filled.length < 8) {
        var banner = document.getElementById('roofModeBanner');
        if (banner) banner.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M3 12l9-9 9 9"/><path d="M5 10v9a2 2 0 002 2h10a2 2 0 002-2v-9"/></svg> No building found at click. Try clicking directly on the roof.';
        return;
      }

      // Compute filled region extent
      var fMinR = Infinity, fMaxR = -Infinity, fMinC = Infinity, fMaxC = -Infinity;
      for (var fi = 0; fi < filled.length; fi++) {
        if (filled[fi].r < fMinR) fMinR = filled[fi].r;
        if (filled[fi].r > fMaxR) fMaxR = filled[fi].r;
        if (filled[fi].c < fMinC) fMinC = filled[fi].c;
        if (filled[fi].c > fMaxC) fMaxC = filled[fi].c;
      }
      console.log('Filled extent: rows ' + fMinR + '-' + fMaxR + ' (' + ((fMaxR-fMinR)*grid.cellSize).toFixed(1) + 'm), cols ' + fMinC + '-' + fMaxC + ' (' + ((fMaxC-fMinC)*grid.cellSize).toFixed(1) + 'm)');

      // Trace the boundary of the flood-filled region
      var boundary = cellsToBoundary(filled, grid);
      console.log('Boundary points (raw):', boundary.length);
      if (boundary.length < 3) return;

      // Log boundary extent
      var bMinX = Infinity, bMaxX = -Infinity, bMinZ = Infinity, bMaxZ = -Infinity;
      for (var bi = 0; bi < boundary.length; bi++) {
        if (boundary[bi].x < bMinX) bMinX = boundary[bi].x;
        if (boundary[bi].x > bMaxX) bMaxX = boundary[bi].x;
        if (boundary[bi].z < bMinZ) bMinZ = boundary[bi].z;
        if (boundary[bi].z > bMaxZ) bMaxZ = boundary[bi].z;
      }
      console.log('Boundary extent: X ' + bMinX.toFixed(2) + ' to ' + bMaxX.toFixed(2) + ' (' + (bMaxX-bMinX).toFixed(1) + 'm), Z ' + bMinZ.toFixed(2) + ' to ' + bMaxZ.toFixed(2) + ' (' + (bMaxZ-bMinZ).toFixed(1) + 'm)');

      boundary = douglasPeucker(boundary, 0.25);
      boundary = orthogonalize(boundary);
      console.log('Boundary points (simplified):', boundary.length);
      if (boundary.length < 3) return;

      // Shift boundary vertices by LiDAR offset so they align with satellite
      for (var bi = 0; bi < boundary.length; bi++) {
        boundary[bi].x += lidarOffX;
        boundary[bi].z += lidarOffZ;
      }

      // Split by Solar API segments
      var segs = solarData ? ((solarData.solarPotential || {}).roofSegmentStats || []) : [];
      var faceColors = ['#f5a623', '#4a9eff', '#22c55e', '#e879f9', '#f97316', '#06b6d4'];
      var faces = splitBySegments(boundary, segs);
      var facesFound = 0;

      faces.forEach(function(face, i) {
        var idx = finalizeRoofFace(face.vertices, face.pitch, face.azimuth, 0);
        roofFaces3d[idx].color = faceColors[i % faceColors.length];
        rebuildRoofFace(idx);
        facesFound++;
      });

      var banner = document.getElementById('roofModeBanner');
      if (banner) {
        banner.innerHTML = facesFound > 0
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M3 12l9-9 9 9"/><path d="M5 10v9a2 2 0 002 2h10a2 2 0 002-2v-9"/></svg> Detected ' + facesFound + ' roof face' + (facesFound > 1 ? 's' : '') + '. Click another building or Esc to finish.'
          : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M3 12l9-9 9 9"/><path d="M5 10v9a2 2 0 002 2h10a2 2 0 002-2v-9"/></svg> No roof planes found. Try clicking directly on the building.';
      }
    }

    /* ── Smart Roof: auto-loads LiDAR if needed, then detects ── */
    /* ── Auto Detect Roof via Python roof_geometry service ── */
    function autoDetectRoof() {
      if (roofDrawingMode) toggleRoofDrawingMode();
      if (treePlacingMode) toggleTreeMode();

      var banner = document.getElementById('roofModeBanner');
      if (banner) {
        banner.style.display = 'flex';
        banner.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4"/><path d="M12 19v4"/><path d="M1 12h4"/><path d="M19 12h4"/></svg> Auto-detecting roof structures from LiDAR + imagery...';
      }

      // Ensure LiDAR is loaded first
      if (!lidarRawPoints || lidarRawPoints.length === 0) {
        if (!lidarFetched && !lidarLoading) loadLidarPoints(true);
        var waitCount = 0;
        var waitInterval = setInterval(function() {
          waitCount++;
          if (lidarRawPoints && lidarRawPoints.length > 0 && autoAlignDone) {
            clearInterval(waitInterval);
            autoDetectRoofContinue();
          } else if (waitCount > 60 || lidarLoadError) {
            clearInterval(waitInterval);
            if (banner) banner.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><circle cx="12" cy="12" r="3"/></svg> LiDAR data unavailable — cannot auto-detect.';
            setTimeout(function() { if (banner) banner.style.display = 'none'; }, 4000);
          }
        }, 500);
        return;
      }
      autoDetectRoofContinue();
    }

    function autoDetectRoofContinue() {
      var banner = document.getElementById('roofModeBanner');

      // Build anchor dots from calibration control points (alignment only, NOT roof boundaries)
      var anchorDots = [];
      if (calibSavedTransform && calibSavedTransform.controlPoints) {
        anchorDots = calibSavedTransform.controlPoints.map(function(cp, i) {
          return {
            id: 'dot_' + i,
            x: cp.sat.x,
            z: cp.sat.z,
            lat: designLat + (cp.sat.z / -111320),
            lng: designLng + (cp.sat.x / (111320 * Math.cos(designLat * Math.PI / 180))),
            label: 'calib_' + i
          };
        });
      }

      // Build LiDAR points array: [lng, lat, elevation, class]
      var lidarPts = [];
      if (lidarRawPoints) {
        for (var i = 0; i < lidarRawPoints.length; i++) {
          lidarPts.push(lidarRawPoints[i]);
        }
      }

      // Build request payload (field names must match Python Pydantic schemas)
      var pId = (typeof projectId !== 'undefined' && projectId) ? projectId : 'unknown';
      // Include LiDAR alignment offset so Python pipeline matches satellite
      // Priority: user calibration > auto-align > none
      var calibOffsetX = 0, calibOffsetZ = 0;
      if (calibSavedTransform) {
        calibOffsetX = calibSavedTransform.tx || 0;
        calibOffsetZ = calibSavedTransform.tz || 0;
      } else if (lidarPoints) {
        // Use the auto-align offset applied to the point cloud mesh
        calibOffsetX = lidarPoints.position.x || 0;
        calibOffsetZ = lidarPoints.position.z || 0;
      }
      console.log('Auto-detect using LiDAR offset: x=' + calibOffsetX.toFixed(3) + ' z=' + calibOffsetZ.toFixed(3));
      var payload = {
        project_id: pId,
        anchor_dots: anchorDots,
        calibration_offset: { tx: calibOffsetX, tz: calibOffsetZ },
        lidar: {
          points: lidarPts,
          bounds: [-35, -35, 35, 35],
          resolution: 0.25,
          source: 'google_solar_dsm'
        },
        image: {
          url: '/api/satellite?lat=' + designLat + '&lng=' + designLng + '&zoom=20&size=640',
          width_px: 640,
          height_px: 640,
          geo_bounds: [designLat - 0.000315, designLng - 0.000420, designLat + 0.000315, designLng + 0.000420],
          resolution_m_per_px: 0.109375
        },
        design_center: { lat: designLat, lng: designLng },
        options: {
          confidence_threshold: 0.5,
          max_planes: 20
        }
      };

      if (banner) banner.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4"/><path d="M12 19v4"/><path d="M1 12h4"/><path d="M19 12h4"/></svg> Analyzing roof planes...';

      fetch('/api/roof/auto-detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.error) {
          if (banner) {
            banner.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f44" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> ' + data.error;
            setTimeout(function() { if (banner) banner.style.display = 'none'; }, 6000);
          }
          return;
        }

        // Recolor LiDAR point cloud by cell classification (ROOF/TREE/RIDGE_DOT/etc.)
        console.log('Auto-detect response: cell_labels_grid=' + (data.cell_labels_grid ? data.cell_labels_grid.length + ' rows' : 'null') + ', grid_info=' + (data.grid_info ? JSON.stringify(data.grid_info) : 'null'));
        if (lidarPoints) {
          var pos = lidarPoints.geometry.attributes.position.array;
          console.log('LiDAR buffer sample[0]: x=' + pos[0].toFixed(3) + ' z=' + pos[2].toFixed(3) + ' | offset: x=' + lidarPoints.position.x.toFixed(3) + ' z=' + lidarPoints.position.z.toFixed(3) + ' | world: x=' + (pos[0]+lidarPoints.position.x).toFixed(3) + ' z=' + (pos[2]+lidarPoints.position.z).toFixed(3));
        }
        if (data.cell_labels_grid && data.grid_info) {
          recolorLidarByClassification(data.cell_labels_grid, data.grid_info);
        } else {
          console.warn('No classification grid in response — LiDAR colors unchanged');
        }

        // Prefer direct ridge_line from gradient detector (most accurate)
        if (data.ridge_line) {
          ridgeLines3d.forEach(function(l) { scene3d.remove(l); });
          ridgeLines3d = [];
          var dr = data.ridge_line;
          var EXTEND_M = 1.524; // 5 feet

          // Look up scene Y from the LiDAR grid using the same formula as buildLidarPointCloud
          // Y_scene = (raw_elev - (minElev + 1.0)) * vertExag + lidarPoints.position.y
          function ridgeSceneY(worldX, worldZ) {
            if (!lidarRawPoints) return 0.3;
            var grid = buildElevGrid(lidarRawPoints);
            var lidarOffX = lidarPoints ? lidarPoints.position.x : 0;
            var lidarOffZ = lidarPoints ? lidarPoints.position.z : 0;
            var lx = worldX - lidarOffX;
            var lz = worldZ - lidarOffZ;
            // Sample a small region around the point and take the max elevation
            var bestElev = -Infinity;
            var searchR = 2;
            for (var dr2 = -searchR; dr2 <= searchR; dr2++) {
              for (var dc2 = -searchR; dc2 <= searchR; dc2++) {
                var r = Math.round((lz - grid.minZ) / grid.cellSize) + dr2;
                var c = Math.round((lx - grid.minX) / grid.cellSize) + dc2;
                if (r >= 0 && r < grid.rows && c >= 0 && c < grid.cols) {
                  var e = grid.elev[r][c];
                  if (e > bestElev) bestElev = e;
                }
              }
            }
            if (bestElev === -Infinity) return 0.3;
            var groundThreshold = grid.groundElev + 1.0;
            var lyOff = lidarPoints ? lidarPoints.position.y : -0.75;
            return (bestElev - groundThreshold) * vertExag + lyOff;
          }

          var sx = dr.start.x, sz = dr.start.z;
          var ex = dr.end.x,   ez = dr.end.z;
          var dx2 = ex - sx, dz2 = ez - sz;
          var rlen = Math.sqrt(dx2*dx2 + dz2*dz2);
          if (rlen > 0.001) {
            var nx2 = dx2/rlen, nz2 = dz2/rlen;
            var p1x = sx - nx2*EXTEND_M, p1z = sz - nz2*EXTEND_M;
            var p2x = ex + nx2*EXTEND_M, p2z = ez + nz2*EXTEND_M;
            var y1 = ridgeSceneY(sx, sz);
            var y2 = ridgeSceneY(ex, ez);
            var rGeo = new THREE.BufferGeometry();
            rGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
              p1x, y1, p1z,
              p2x, y2, p2z
            ]), 3));
            var rMat = new THREE.LineBasicMaterial({ color: 0xffcc00, linewidth: 3, depthTest: false });
            var rLine = new THREE.Line(rGeo, rMat);
            rLine.renderOrder = 999;
            scene3d.add(rLine);
            ridgeLines3d.push(rLine);
          }
          if (banner) {
            banner.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><circle cx="12" cy="12" r="3"/></svg> Ridge: ' + (dr.length_m * 3.281).toFixed(1) + ' ft, azimuth ' + Math.round(dr.azimuth_deg) + '°, pitch ' + Math.round(dr.pitch_deg) + '°.';
            setTimeout(function() { if (banner) banner.style.display = 'none'; }, 5000);
          }
          return;
        }

        // Fallback: draw ridge lines from roof graph edge classification
        var ridgeEdges = ((data.roof_graph && data.roof_graph.edges) || []).filter(function(e) {
          return e.edge_type === 'ridge';
        });

        if (ridgeEdges.length === 0) {
          if (banner) {
            banner.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><circle cx="12" cy="12" r="3"/></svg> No ridge lines detected.';
            setTimeout(function() { if (banner) banner.style.display = 'none'; }, 4000);
          }
          return;
        }

        // Remove any previously drawn ridge lines
        ridgeLines3d.forEach(function(l) { scene3d.remove(l); });
        ridgeLines3d = [];

        var EXTEND_M = 1.524; // 5 feet in metres
        var linesCreated = 0;
        var ridgeMat = new THREE.LineBasicMaterial({ color: 0xffcc00, linewidth: 3, depthTest: false });

        ridgeEdges.forEach(function(edge) {
          var sx = edge.start_point.x, sy = edge.start_point.y, sz = edge.start_point.z;
          var ex = edge.end_point.x, ey = edge.end_point.y, ez = edge.end_point.z;

          var dx = ex - sx, dy = ey - sy, dz = ez - sz;
          var len = Math.sqrt(dx*dx + dy*dy + dz*dz);
          if (len < 0.001) return;
          var nx = dx/len, ny = dy/len, nz = dz/len;

          // Extend 5 ft past each endpoint
          var p1x = sx - nx*EXTEND_M, p1y = sy - ny*EXTEND_M, p1z = sz - nz*EXTEND_M;
          var p2x = ex + nx*EXTEND_M, p2y = ey + ny*EXTEND_M, p2z = ez + nz*EXTEND_M;

          var geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
            p1x, p1y, p1z,
            p2x, p2y, p2z
          ]), 3));
          var line = new THREE.Line(geo, ridgeMat);
          line.renderOrder = 999;
          scene3d.add(line);
          ridgeLines3d.push(line);
          linesCreated++;
        });

        if (banner) {
          banner.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 1v4"/><path d="M12 19v4"/><path d="M1 12h4"/><path d="M19 12h4"/></svg> Detected ' + linesCreated + ' ridge line' + (linesCreated > 1 ? 's' : '') + ' (5 ft overhang each side).';
          setTimeout(function() { if (banner) banner.style.display = 'none'; }, 5000);
        }

        // Log confidence for debugging
        if (data.confidence_report) {
          console.log('Roof auto-detect confidence:', data.confidence_report.overall_confidence);
          if (data.confidence_report.disagreements) {
            data.confidence_report.disagreements.forEach(function(d) {
              console.log('  Disagreement:', d.element_id, '- LiDAR:', d.lidar_value, 'Image:', d.image_value);
            });
          }
        }
      })
      .catch(function(err) {
        console.error('Auto-detect roof error:', err);
        if (banner) {
          banner.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#f44" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Auto-detect failed: ' + err.message;
          setTimeout(function() { if (banner) banner.style.display = 'none'; }, 5000);
        }
      });
    }

    function autoGenerateRoof() {
      if (roofDrawingMode) toggleRoofDrawingMode();
      if (treePlacingMode) toggleTreeMode();

      var banner = document.getElementById('roofModeBanner');
      if (banner) {
        banner.style.display = 'flex';
        banner.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M3 12l9-9 9 9"/><path d="M5 10v9a2 2 0 002 2h10a2 2 0 002-2v-9"/></svg> Detecting roof...';
      }

      // Auto-load LiDAR if not loaded yet
      if (!lidarRawPoints || lidarRawPoints.length === 0) {
        if (!lidarFetched && !lidarLoading) {
          loadLidarPoints(true);
        }
        // Poll until LiDAR is ready, then continue
        var waitCount = 0;
        var waitInterval = setInterval(function() {
          waitCount++;
          if (lidarRawPoints && lidarRawPoints.length > 0) {
            clearInterval(waitInterval);
            autoGenerateRoofContinue();
          } else if (waitCount > 60 || lidarLoadError) {
            // 30s timeout or load error
            clearInterval(waitInterval);
            if (banner) banner.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M3 12l9-9 9 9"/><path d="M5 10v9a2 2 0 002 2h10a2 2 0 002-2v-9"/></svg> LiDAR data unavailable for this location.';
          }
        }, 500);
        return;
      }
      autoGenerateRoofContinue();
    }

    function autoGenerateRoofContinue() {
      // Fetch Solar API data in background if not cached
      if (!solarData) {
        fetch('/api/solar/building-insights?lat=' + designLat + '&lng=' + designLng)
          .then(function(r) { return r.json(); })
          .then(function(data) { solarData = data; autoFromCalibIfReady(); })
          .catch(function() { autoFromCalibIfReady(); });
      } else {
        autoFromCalibIfReady();
      }

      function autoFromCalibIfReady() {
        // Use calibration control points as building corners if available
        if (calibSavedTransform && calibSavedTransform.controlPoints && calibSavedTransform.controlPoints.length >= 3) {
          var corners = calibSavedTransform.controlPoints.map(function(cp) {
            return { x: cp.sat.x, z: cp.sat.z };
          });

          // Orthogonalize and generate roof from calibration corners
          var footprint = orthogonalize(corners);
          if (footprint.length < 3) footprint = corners;

          var segs = solarData ? ((solarData.solarPotential || {}).roofSegmentStats || []) : [];
          var faceColors = ['#f5a623', '#4a9eff', '#22c55e', '#e879f9', '#f97316', '#06b6d4'];
          var faces = splitBySegments(footprint, segs);
          var facesFound = 0;

          pushUndo();
          faces.forEach(function(face, i) {
            var idx = finalizeRoofFace(face.vertices, face.pitch, face.azimuth, 0);
            roofFaces3d[idx].color = faceColors[i % faceColors.length];
            rebuildRoofFace(idx);
            facesFound++;
          });

          var banner = document.getElementById('roofModeBanner');
          if (banner) {
            banner.innerHTML = facesFound > 0
              ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M3 12l9-9 9 9"/><path d="M5 10v9a2 2 0 002 2h10a2 2 0 002-2v-9"/></svg> Created ' + facesFound + ' roof face' + (facesFound > 1 ? 's' : '') + ' from calibration corners.'
              : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M3 12l9-9 9 9"/><path d="M5 10v9a2 2 0 002 2h10a2 2 0 002-2v-9"/></svg> No roof faces created.';
            setTimeout(function() { if (banner) banner.style.display = 'none'; }, 4000);
          }
          return;
        }

        // No calibration corners — fall back to corner-picking mode
        smartRoofPickMode = true;
        roofTempVertices = [];
        var canvas = document.getElementById('canvas3d');
        canvas.style.cursor = 'crosshair';
        var banner = document.getElementById('roofModeBanner');
        if (banner) {
          banner.style.display = 'flex';
          banner.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M3 12l9-9 9 9"/><path d="M5 10v9a2 2 0 002 2h10a2 2 0 002-2v-9"/></svg> Click the outside corners of the building. Press Enter or double-click to finish. Esc to cancel.';
        }
      }
    }

    /* ── Finalize SmartRoof from user-picked corners ── */
    function finalizeSmartRoof() {
      if (roofTempVertices.length < 3) return;
      var numCorners = roofTempVertices.length;

      pushUndo();

      // Orthogonalize the user-picked corners
      var footprint = orthogonalize(roofTempVertices.slice());
      if (footprint.length < 3) footprint = roofTempVertices.slice();

      // Split by Solar API segments and assign pitch/azimuth per face
      var segs = solarData ? ((solarData.solarPotential || {}).roofSegmentStats || []) : [];
      var faceColors = ['#f5a623', '#4a9eff', '#22c55e', '#e879f9', '#f97316', '#06b6d4'];
      var faces = splitBySegments(footprint, segs);
      var facesFound = 0;

      faces.forEach(function(face, i) {
        var idx = finalizeRoofFace(face.vertices, face.pitch, face.azimuth, 0);
        roofFaces3d[idx].color = faceColors[i % faceColors.length];
        rebuildRoofFace(idx);
        facesFound++;
      });

      // Clean up
      clearRoofPreview();
      clearSnapGuides();
      roofTempVertices = [];
      smartRoofPickMode = false;
      var canvas = document.getElementById('canvas3d');
      canvas.style.cursor = '';

      var banner = document.getElementById('roofModeBanner');
      if (banner) {
        banner.innerHTML = facesFound > 0
          ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M3 12l9-9 9 9"/><path d="M5 10v9a2 2 0 002 2h10a2 2 0 002-2v-9"/></svg> Created ' + facesFound + ' roof face' + (facesFound > 1 ? 's' : '') + ' from ' + numCorners + ' corners.'
          : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2"><path d="M3 12l9-9 9 9"/><path d="M5 10v9a2 2 0 002 2h10a2 2 0 002-2v-9"/></svg> No roof faces created.';
        setTimeout(function() { if (banner) banner.style.display = 'none'; }, 4000);
      }
    }

    /* ── Roof face canvas event handlers ── */
    (function() {
      var canvas = document.getElementById('canvas3d');
      if (!canvas) return;

      // Click: place vertex, detect roof, or select face
      canvas.addEventListener('click', function(e) {
        if (space3dHeld) return;
        if (treePlacingMode) return;

        if (roofDetectMode) {
          var hit = raycastGroundPlane(e);
          if (!hit) return;
          detectRoofAtPoint(hit.x, hit.z);
          return;
        }

        if (smartRoofPickMode) {
          var hit = raycastGroundPlane(e);
          if (!hit) return;

          var px = roofSnappedPos ? roofSnappedPos.x : hit.x;
          var pz = roofSnappedPos ? roofSnappedPos.z : hit.z;

          // Auto-close: click near first vertex with 3+ vertices → finalize
          if (roofTempVertices.length >= 3) {
            var first = roofTempVertices[0];
            var dx = px - first.x, dz = pz - first.z;
            if (Math.sqrt(dx * dx + dz * dz) < 1.0) {
              finalizeSmartRoof();
              return;
            }
          }

          roofTempVertices.push({ x: px, z: pz });
          addRoofPreviewHandle(px, pz);
          updateRoofPreviewLines();
          clearSnapGuides();
          return;
        }

        if (roofDrawingMode) {
          var hit = raycastGroundPlane(e);
          if (!hit) return;

          // Use snapped position if available
          var px = roofSnappedPos ? roofSnappedPos.x : hit.x;
          var pz = roofSnappedPos ? roofSnappedPos.z : hit.z;

          // Auto-close: if 3+ vertices and click is near the first vertex, close the polygon
          if (roofTempVertices.length >= 3) {
            var first = roofTempVertices[0];
            var dx = px - first.x, dz = pz - first.z;
            if (Math.sqrt(dx * dx + dz * dz) < 1.0) {
              // Snap to rectangle and finalize
              pushUndo();
              var rectVerts = fitRectangle(roofTempVertices);
              finalizeRoofFace(rectVerts, 0, 180, 0);
              clearRoofPreview();
              clearSnapGuides();
              roofTempVertices = [];
              toggleRoofDrawingMode();
              return;
            }
          }

          pushUndo();
          roofTempVertices.push({ x: px, z: pz });
          addRoofPreviewHandle(px, pz);
          updateRoofPreviewLines();
          clearSnapGuides();
          return;
        }

        // Dormer placement mode — stamp dormer on click
        if (dormerPlaceMode) {
          if (stampDormer(e)) return;
        }

        // Not in drawing mode — check for dormer or face/section selection
        if (roofDraggingHandle >= 0 || roofDraggingEdge >= 0 || dormerDraggingHandle >= 0 || isViewCubeBusy()) return;
        if (roofMovingMode) return; // handled by move drag
        // Don't select/deselect if clicking on an edge (edge drag handles this)
        if (findEdgeHandleUnderCursor && findEdgeHandleUnderCursor(e)) return;

        // Check dormer selection first (in edit mode)
        if (roofEditMode && roofSelectedFace >= 0) {
          var dormerHit = findDormerUnderCursor(e);
          if (dormerHit.dormerIdx >= 0) {
            selectDormer(dormerHit.faceIdx, dormerHit.dormerIdx);
            return;
          }
        }

        var hit = findRoofFaceUnderCursor(e);
        if (hit.faceIdx >= 0) {
          if (roofEditMode) {
            deselectDormer();
            selectRoofSection(hit.faceIdx, hit.sectionIdx);
          } else {
            selectRoofWhole(hit.faceIdx);
          }
        } else if (roofSelectedFace >= 0) {
          deselectRoofFace();
        }
      });

      // Double-click: complete polygon OR enter edit mode
      canvas.addEventListener('dblclick', function(e) {
        if (smartRoofPickMode && roofTempVertices.length >= 3) {
          // dblclick fires two clicks, remove the duplicate last vertex
          roofTempVertices.pop();
          if (roofTempHandles.length > 0) {
            scene3d.remove(roofTempHandles.pop());
          }
          finalizeSmartRoof();
          return;
        }
        if (roofDrawingMode && roofTempVertices.length >= 3) {
          // dblclick fires two clicks, remove the duplicate last vertex
          roofTempVertices.pop();
          if (roofTempHandles.length > 0) {
            scene3d.remove(roofTempHandles.pop());
          }
          pushUndo();
          var rectVerts = fitRectangle(roofTempVertices);
          finalizeRoofFace(rectVerts, 0, 180, 0);
          clearRoofPreview();
          roofTempVertices = [];
          toggleRoofDrawingMode();
          return;
        }
        // Double-click on dormer → enter edit mode + select the dormer
        var dblDormerHit = findDormerUnderCursor(e);
        if (dblDormerHit.dormerIdx >= 0) {
          if (!roofEditMode) {
            if (roofSelectedFace !== dblDormerHit.faceIdx) {
              selectRoofWhole(dblDormerHit.faceIdx);
            }
            enterRoofEditMode();
          }
          selectDormer(dblDormerHit.faceIdx, dblDormerHit.dormerIdx);
          return;
        }
        // Double-click on roof → select + enter face edit mode + select tapped section
        if (!roofEditMode) {
          var hit = findRoofFaceUnderCursor(e);
          if (hit.faceIdx >= 0) {
            if (roofSelectedFace !== hit.faceIdx) {
              selectRoofWhole(hit.faceIdx);
            }
            enterRoofEditMode();
            selectRoofSection(hit.faceIdx, hit.sectionIdx);
          }
        }
      });

      // Pointerdown: start dragging handle
      canvas.addEventListener('pointerdown', function(e) {
        if (e.button !== 0) return;
        if (roofDrawingMode || treePlacingMode || space3dHeld || isViewCubeBusy()) return;
        // Move mode: start drag
        if (roofMovingMode && roofSelectedFace >= 0) {
          var hit = raycastGroundPlane(e);
          if (hit) {
            pushUndo();
            roofMoveStart = { x: hit.x, z: hit.z };
            if (controls3d) controls3d.enabled = false;
            e.preventDefault();
            return;
          }
        }
        // Check dormer handles first
        var dh = findDormerHandleUnderCursor(e);
        if (dh) {
          pushUndo();
          dormerDraggingFaceIdx = dh.faceIdx;
          dormerDraggingDormerIdx = dh.dormerIdx;
          dormerDraggingHandle = dh.handleIdx;
          // Save starting verts for edge-symmetric drag
          var ddv = roofFaces3d[dh.faceIdx].dormers[dh.dormerIdx].vertices;
          dormerDragStartVerts = ddv.map(function(v) { return {x: v.x, z: v.z}; });
          if (controls3d) controls3d.enabled = false;
          canvas.style.cursor = 'grabbing';
          e.preventDefault();
          return;
        }
        var found = findHandleUnderCursor(e);
        if (found) {
          pushUndo();
          roofDraggingFaceIdx = found.faceIdx;
          roofDraggingHandle = found.vertexIdx;
          var df = roofFaces3d[found.faceIdx];
          if (df.handleMeshes && df.handleMeshes[found.vertexIdx]) {
            df.handleMeshes[found.vertexIdx].material.color.set(0x00e5ff);
          }
          if (controls3d) controls3d.enabled = false;
          canvas.style.cursor = 'grabbing';
          e.preventDefault();
          return;
        }
        var edgeFound = findEdgeHandleUnderCursor(e);
        if (edgeFound) {
          pushUndo();
          roofDraggingEdgeFaceIdx = edgeFound.faceIdx;
          roofDraggingEdge = edgeFound.edgeIdx;
          var eh = raycastGroundPlane(e);
          roofEdgeDragStart = eh ? { x: eh.x, z: eh.z } : null;
          var eface = roofFaces3d[edgeFound.faceIdx];
          var ei0 = edgeFound.edgeIdx;
          var ei1 = (ei0 + 1) % eface.vertices.length;
          roofEdgeDragOrigVerts = [
            { x: eface.vertices[ei0].x, z: eface.vertices[ei0].z },
            { x: eface.vertices[ei1].x, z: eface.vertices[ei1].z }
          ];
          if (controls3d) controls3d.enabled = false;
          canvas.style.cursor = 'grabbing';
          e.preventDefault();
        }
      });

      // Pointermove: drag handle, snap guides, or show close hint
      canvas.addEventListener('pointermove', function(e) {
        // Snap guides + highlight first vertex in drawing/smart roof mode
        if ((roofDrawingMode || smartRoofPickMode) && roofTempVertices.length > 0) {
          var hit = raycastGroundPlane(e);
          if (hit) {
            computeSnapGuides(hit.x, hit.z);
            if (roofTempVertices.length >= 3 && roofTempHandles.length > 0) {
              var first = roofTempVertices[0];
              var cx = roofSnappedPos ? roofSnappedPos.x : hit.x;
              var cz = roofSnappedPos ? roofSnappedPos.z : hit.z;
              var dx = cx - first.x, dz = cz - first.z;
              var near = Math.sqrt(dx * dx + dz * dz) < 1.0;
              roofTempHandles[0].material.color.set(near ? 0x00e5ff : 0xf5a623);
              roofTempHandles[0].scale.setScalar(near ? 1.5 : 1.0);
              canvas.style.cursor = near ? 'pointer' : 'crosshair';
            }
          }
        }
        // Move mode drag
        if (roofMovingMode && roofMoveStart && roofSelectedFace >= 0) {
          var mHit = raycastGroundPlane(e);
          if (mHit) {
            var dx = mHit.x - roofMoveStart.x;
            var dz = mHit.z - roofMoveStart.z;
            var face = roofFaces3d[roofSelectedFace];
            for (var vi = 0; vi < face.vertices.length; vi++) {
              face.vertices[vi].x += dx;
              face.vertices[vi].z += dz;
            }
            roofMoveStart = { x: mHit.x, z: mHit.z };
            rebuildRoofFace(roofSelectedFace);
          }
          return;
        }
        // Dormer ghost tracking
        if (dormerPlaceMode) {
          updateDormerGhost(e);
        }
        // Dormer handle dragging (edge-symmetric: dragging a corner mirrors its pair on the same edge)
        if (dormerDraggingHandle >= 0) {
          var dhit = raycastGroundPlane(e);
          if (!dhit) return;
          var dface = roofFaces3d[dormerDraggingFaceIdx];
          var dd = dface.dormers[dormerDraggingDormerIdx];
          var dv = dd.vertices;
          var sv = dormerDragStartVerts;
          if (!sv) return;
          var dhi = dormerDraggingHandle;

          // Vertices: 0=front-left, 1=front-right, 2=back-right, 3=peak, 4=back-left
          // Front pair (0,1): mirror width; depth shifts both together. Back untouched.
          // Back pair (2,4): mirror width; depth shifts both together. Front untouched.
          // Peak (3): moves freely on its own. Front untouched.

          // Local axes from original verts
          var frontMidX = (sv[0].x + sv[1].x) / 2, frontMidZ = (sv[0].z + sv[1].z) / 2;
          // Width axis (front-left → front-right)
          var wdx = sv[1].x - sv[0].x, wdz = sv[1].z - sv[0].z;
          var wLen = Math.sqrt(wdx * wdx + wdz * wdz) || 1;
          var wux = wdx / wLen, wuz = wdz / wLen;
          // Depth axis (front-mid → peak)
          var ddx = sv[3].x - frontMidX, ddz = sv[3].z - frontMidZ;
          var dLen = Math.sqrt(ddx * ddx + ddz * ddz) || 1;
          var dux = ddx / dLen, duz = ddz / dLen;

          // Start from original positions
          for (var ci = 0; ci < 5; ci++) {
            dv[ci] = { x: sv[ci].x, z: sv[ci].z };
          }

          if (dhi >= 5) {
            // Edge handle (indices 5–9): edge i connects vertex i to (i+1)%5
            // Move both edge vertices perpendicular to the edge direction
            var edgeI = dhi - 5;
            var edgeJ = (edgeI + 1) % 5;
            var edgeMidX = (sv[edgeI].x + sv[edgeJ].x) / 2;
            var edgeMidZ = (sv[edgeI].z + sv[edgeJ].z) / 2;
            // Edge direction
            var eEdx = sv[edgeJ].x - sv[edgeI].x, eEdz = sv[edgeJ].z - sv[edgeI].z;
            var eLen = Math.sqrt(eEdx * eEdx + eEdz * eEdz) || 1;
            // Normal to edge (perpendicular, pointing outward)
            var enx = -eEdz / eLen, enz = eEdx / eLen;
            // Project mouse delta onto edge normal
            var eDeltaX = dhit.x - edgeMidX, eDeltaZ = dhit.z - edgeMidZ;
            var eProj = eDeltaX * enx + eDeltaZ * enz;
            dv[edgeI] = { x: sv[edgeI].x + enx * eProj, z: sv[edgeI].z + enz * eProj };
            dv[edgeJ] = { x: sv[edgeJ].x + enx * eProj, z: sv[edgeJ].z + enz * eProj };
          } else {
            var deltaX = dhit.x - sv[dhi].x, deltaZ = dhit.z - sv[dhi].z;
            var projW = deltaX * wux + deltaZ * wuz;
            var projD = deltaX * dux + deltaZ * duz;

            if (dhi === 0 || dhi === 1) {
              // Front pair: mirror width, shift both in depth; back untouched
              var wDeltaF = (dhi === 0) ? -projW : projW;
              dv[0] = { x: sv[0].x + wux * (-wDeltaF) + dux * projD, z: sv[0].z + wuz * (-wDeltaF) + duz * projD };
              dv[1] = { x: sv[1].x + wux * ( wDeltaF) + dux * projD, z: sv[1].z + wuz * ( wDeltaF) + duz * projD };
            } else if (dhi === 2 || dhi === 4) {
              // Back pair: mirror width, shift both in depth; front and peak untouched
              var wDeltaB = (dhi === 2) ? projW : -projW;
              dv[2] = { x: sv[2].x + wux * ( wDeltaB) + dux * projD, z: sv[2].z + wuz * ( wDeltaB) + duz * projD };
              dv[4] = { x: sv[4].x + wux * (-wDeltaB) + dux * projD, z: sv[4].z + wuz * (-wDeltaB) + duz * projD };
            } else {
              // Peak (3): free movement, front untouched
              dv[3] = { x: dhit.x, z: dhit.z };
            }
          }

          rebuildDormer(dface, dormerDraggingDormerIdx);
          updateDormerPanel(dd);
          return;
        }
        // Edge handle dragging (perpendicular constraint)
        if (roofDraggingEdge >= 0) {
          var ehit = raycastGroundPlane(e);
          if (!ehit || !roofEdgeDragStart) return;
          var eface = roofFaces3d[roofDraggingEdgeFaceIdx];
          var ei0 = roofDraggingEdge;
          var ei1 = (ei0 + 1) % eface.vertices.length;
          var edx = roofEdgeDragOrigVerts[1].x - roofEdgeDragOrigVerts[0].x;
          var edz = roofEdgeDragOrigVerts[1].z - roofEdgeDragOrigVerts[0].z;
          var elen = Math.sqrt(edx * edx + edz * edz);
          if (elen < 0.001) return;
          var nx = -edz / elen, nz = edx / elen;
          var dmx = ehit.x - roofEdgeDragStart.x;
          var dmz = ehit.z - roofEdgeDragStart.z;
          var proj = dmx * nx + dmz * nz;
          eface.vertices[ei0] = { x: roofEdgeDragOrigVerts[0].x + nx * proj, z: roofEdgeDragOrigVerts[0].z + nz * proj };
          eface.vertices[ei1] = { x: roofEdgeDragOrigVerts[1].x + nx * proj, z: roofEdgeDragOrigVerts[1].z + nz * proj };
          rebuildRoofFace(roofDraggingEdgeFaceIdx);
          if (roofSelectedFace === roofDraggingEdgeFaceIdx) updateRoofPropsPanel();
          return;
        }
        if (roofDraggingHandle >= 0) {
          var hit = raycastGroundPlane(e);
          if (!hit) return;
          var face = roofFaces3d[roofDraggingFaceIdx];
          face.vertices[roofDraggingHandle] = { x: hit.x, z: hit.z };
          rebuildRoofFace(roofDraggingFaceIdx);
          if (roofSelectedFace === roofDraggingFaceIdx) updateRoofPropsPanel();
          return;
        }
        // Vertex hover highlight
        var prevVFace = roofHoveredVertexFace, prevVIdx = roofHoveredVertexIdx;
        roofHoveredVertexFace = -1;
        roofHoveredVertexIdx = -1;
        if (!roofDrawingMode && !roofMovingMode && !dormerPlaceMode) {
          var vtxHover = findHandleUnderCursor(e);
          if (vtxHover) {
            roofHoveredVertexFace = vtxHover.faceIdx;
            roofHoveredVertexIdx = vtxHover.vertexIdx;
            canvas.style.cursor = 'grab';
          }
        }
        if (prevVFace !== roofHoveredVertexFace || prevVIdx !== roofHoveredVertexIdx) {
          if (prevVFace >= 0 && prevVFace < roofFaces3d.length) {
            var pvf = roofFaces3d[prevVFace];
            if (pvf.handleMeshes && pvf.handleMeshes[prevVIdx]) {
              pvf.handleMeshes[prevVIdx].material.color.set(0xffffff);
            }
          }
          if (roofHoveredVertexFace >= 0 && roofHoveredVertexFace < roofFaces3d.length) {
            var hvf = roofFaces3d[roofHoveredVertexFace];
            if (hvf.handleMeshes && hvf.handleMeshes[roofHoveredVertexIdx]) {
              hvf.handleMeshes[roofHoveredVertexIdx].material.color.set(0x00e5ff);
            }
          }
        }
        // Edge hover highlight
        var prevFace = roofHoveredEdgeFace, prevEdge = roofHoveredEdgeIdx;
        roofHoveredEdgeFace = -1;
        roofHoveredEdgeIdx = -1;
        if (!roofDrawingMode && !roofMovingMode && !dormerPlaceMode && roofHoveredVertexFace < 0) {
          var edgeHover = findEdgeHandleUnderCursor(e);
          if (edgeHover) {
            roofHoveredEdgeFace = edgeHover.faceIdx;
            roofHoveredEdgeIdx = edgeHover.edgeIdx;
            canvas.style.cursor = 'grab';
          } else if (!roofDrawingMode) {
            if (prevFace >= 0 && roofHoveredVertexFace < 0) canvas.style.cursor = '';
          }
        }
        // Update edge line colors on hover change
        if (prevFace !== roofHoveredEdgeFace || prevEdge !== roofHoveredEdgeIdx) {
          // Restore previous
          if (prevFace >= 0 && prevFace < roofFaces3d.length) {
            var pf = roofFaces3d[prevFace];
            if (pf.edgeLines && pf.edgeLines.children) {
              pf.edgeLines.children.forEach(function(cyl) {
                if (cyl.userData.edgeIdx === prevEdge) {
                  cyl.material.color.set(pf.selected ? '#00e5ff' : '#ffffff');
                }
              });
            }
          }
          // Highlight new
          if (roofHoveredEdgeFace >= 0 && roofHoveredEdgeFace < roofFaces3d.length) {
            var hf = roofFaces3d[roofHoveredEdgeFace];
            if (hf.edgeLines && hf.edgeLines.children) {
              hf.edgeLines.children.forEach(function(cyl) {
                if (cyl.userData.edgeIdx === roofHoveredEdgeIdx) {
                  cyl.material.color.set('#00e5ff');
                }
              });
            }
          }
        }
      });

      // Pointerup: end drag
      canvas.addEventListener('pointerup', function(e) {
        if (roofMoveStart) {
          roofMoveStart = null;
          if (controls3d) controls3d.enabled = true;
          markDirty();
        }
        if (dormerDraggingHandle >= 0) {
          dormerDraggingHandle = -1;
          dormerDraggingFaceIdx = -1;
          dormerDraggingDormerIdx = -1;
          dormerDragStartVerts = null;
          if (controls3d) controls3d.enabled = true;
          canvas.style.cursor = '';
          markDirty();
        }
        if (roofDraggingEdge >= 0) {
          roofDraggingEdge = -1;
          roofDraggingEdgeFaceIdx = -1;
          roofEdgeDragStart = null;
          roofEdgeDragOrigVerts = null;
          if (controls3d) controls3d.enabled = true;
          canvas.style.cursor = '';
          markDirty();
        }
        if (roofDraggingHandle >= 0) {
          var relFace = roofFaces3d[roofDraggingFaceIdx];
          if (relFace && relFace.handleMeshes && relFace.handleMeshes[roofDraggingHandle]) {
            relFace.handleMeshes[roofDraggingHandle].material.color.set(0xffffff);
          }
          roofDraggingHandle = -1;
          roofDraggingFaceIdx = -1;
          if (controls3d) controls3d.enabled = true;
          canvas.style.cursor = '';
          markDirty();
        }
      });

      // Keyboard: Enter to complete, Escape to cancel, Delete to remove face
      document.addEventListener('keydown', function(e) {
        if (e.target.matches('input,textarea,select')) return;

        // Undo: Cmd+Z / Ctrl+Z
        if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          unifiedUndo();
          return;
        }
        // Redo: Cmd+Shift+Z / Ctrl+Shift+Z
        if ((e.metaKey || e.ctrlKey) && (e.key === 'Z' || (e.key === 'z' && e.shiftKey))) {
          e.preventDefault();
          unifiedRedo();
          return;
        }

        if (e.key === 'Enter' && smartRoofPickMode && roofTempVertices.length >= 3) {
          e.preventDefault();
          finalizeSmartRoof();
          return;
        }

        if (e.key === 'Enter' && roofDrawingMode && roofTempVertices.length >= 3) {
          e.preventDefault();
          pushUndo();
          var rectVerts = fitRectangle(roofTempVertices);
          finalizeRoofFace(rectVerts, 0, 180, 0);
          clearRoofPreview();
          roofTempVertices = [];
          toggleRoofDrawingMode();
          return;
        }

        if (e.key === 'Escape') {
          if (smartRoofPickMode) {
            e.preventDefault();
            clearRoofPreview();
            clearSnapGuides();
            roofTempVertices = [];
            smartRoofPickMode = false;
            var canvas = document.getElementById('canvas3d');
            canvas.style.cursor = '';
            var banner = document.getElementById('roofModeBanner');
            if (banner) banner.style.display = 'none';
            return;
          }
          if (dormerPlaceMode) {
            e.preventDefault();
            exitDormerPlaceMode();
            return;
          }
          if (roofDetectMode) {
            e.preventDefault();
            roofDetectMode = false;
            var canvas = document.getElementById('canvas3d');
            canvas.style.cursor = '';
            var banner = document.getElementById('roofModeBanner');
            if (banner) banner.style.display = 'none';
            return;
          }
          if (roofDrawingMode) {
            e.preventDefault();
            clearRoofPreview();
            roofTempVertices = [];
            toggleRoofDrawingMode();
            return;
          }
          if (roofSelectedFace >= 0) {
            e.preventDefault();
            deselectRoofFace();
            return;
          }
        }

        if ((e.key === 'Delete' || e.key === 'Backspace') && selectedDormerIdx >= 0 && roofSelectedFace >= 0) {
          e.preventDefault();
          pushUndo();
          deleteDormer(roofSelectedFace, selectedDormerIdx);
          return;
        }
        if ((e.key === 'Delete' || e.key === 'Backspace') && roofSelectedFace >= 0 && !roofDrawingMode) {
          e.preventDefault();
          if (roofSelectedSection >= 0) {
            deleteRoofSection(roofSelectedFace, roofSelectedSection);
          } else {
            deleteRoofFace(roofSelectedFace);
          }
          return;
        }
      });

      // Wire up menu items
      var btnManual = document.getElementById('btnManualRoof');
      var btnSmart = document.getElementById('btnSmartRoof');
      var btnFlat = document.getElementById('btnFlatRoof');
      var btnAutoDetect = document.getElementById('btnAutoDetect');
      if (btnAutoDetect) btnAutoDetect.addEventListener('click', function(e) {
        e.stopPropagation();
        autoDetectRoof();
      });
      if (btnManual) btnManual.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleRoofDrawingMode();
      });
      if (btnSmart) btnSmart.addEventListener('click', function(e) {
        e.stopPropagation();
        autoGenerateRoof();
      });
      if (btnFlat) btnFlat.addEventListener('click', function(e) {
        e.stopPropagation();
        toggleRoofDrawingMode(); // same as manual, pitch defaults to 0
      });

      // Undo/redo button click handlers
      var undoBtnEl = document.getElementById('undoBtn');
      var redoBtnEl = document.getElementById('redoBtn');
      if (undoBtnEl) undoBtnEl.addEventListener('click', unifiedUndo);
      if (redoBtnEl) redoBtnEl.addEventListener('click', unifiedRedo);

      // Props panel input listeners
      var pitchInput = document.getElementById('roofPropPitch');
      var azInput = document.getElementById('roofPropAzimuth');
      var heightInput = document.getElementById('roofPropHeight');
      if (pitchInput) pitchInput.addEventListener('change', function() {
        if (roofSelectedFace < 0) return;
        pushUndo();
        var face = roofFaces3d[roofSelectedFace];
        var val = parseFloat(this.value) || 0;
        if (roofSelectedSection >= 0 && face.sectionPitches) {
          face.sectionPitches[roofSelectedSection] = val;
          face.pitch = Math.max.apply(null, face.sectionPitches);
        } else {
          face.pitch = val;
          if (face.sectionPitches) {
            for (var i = 0; i < face.sectionPitches.length; i++) face.sectionPitches[i] = val;
          }
        }
        rebuildRoofFace(roofSelectedFace);
        updateRoofPropsPanel();
      });
      if (azInput) azInput.addEventListener('change', function() {
        if (roofSelectedFace < 0) return;
        pushUndo();
        roofFaces3d[roofSelectedFace].azimuth = parseFloat(this.value) || 0;
        markDirty();
      });
      if (heightInput) heightInput.addEventListener('change', function() {
        if (roofSelectedFace < 0) return;
        pushUndo();
        roofFaces3d[roofSelectedFace].height = (parseFloat(this.value) || 0) / 3.28084;
        markDirty();
      });

      // Delete section button
      var btnDelSection = document.getElementById('btnDeleteRoofSection');
      if (btnDelSection) btnDelSection.addEventListener('click', function() {
        if (roofSelectedFace >= 0 && roofSelectedSection >= 0) {
          deleteRoofSection(roofSelectedFace, roofSelectedSection);
        }
      });

      // Delete face button
      var btnDel = document.getElementById('btnDeleteRoofFace');
      if (btnDel) btnDel.addEventListener('click', function() {
        if (roofSelectedFace >= 0) deleteRoofFace(roofSelectedFace);
      });

      // ── Edge & Face panel input listeners ──
      var efPitchInput = document.getElementById('efPitch');
      var efAzInput = document.getElementById('efAzimuth');
      var efHeightInput = document.getElementById('efHeight');
      var efDeleteBtn = document.getElementById('efDeleteBtn');

      if (efPitchInput) efPitchInput.addEventListener('change', function() {
        if (roofSelectedFace < 0) return;
        pushUndo();
        var face = roofFaces3d[roofSelectedFace];
        var val = parseFloat(this.value) || 0;
        if (roofSelectedSection >= 0 && face.sectionPitches) {
          face.sectionPitches[roofSelectedSection] = val;
          face.pitch = Math.max.apply(null, face.sectionPitches);
        } else {
          face.pitch = val;
          if (face.sectionPitches) {
            for (var i = 0; i < face.sectionPitches.length; i++) face.sectionPitches[i] = val;
          }
        }
        // Sync the old panel pitch input
        var oldPitch = document.getElementById('roofPropPitch');
        if (oldPitch) oldPitch.value = val;
        rebuildRoofFace(roofSelectedFace);
        updateRoofPropsPanel();
      });

      if (efAzInput) efAzInput.addEventListener('change', function() {
        if (roofSelectedFace < 0) return;
        pushUndo();
        roofFaces3d[roofSelectedFace].azimuth = parseFloat(this.value) || 0;
        updateRoofPropsPanel();
        markDirty();
      });

      if (efHeightInput) efHeightInput.addEventListener('change', function() {
        if (roofSelectedFace < 0) return;
        pushUndo();
        roofFaces3d[roofSelectedFace].height = (parseFloat(this.value) || 0) / 3.28084;
        updateRoofPropsPanel();
        markDirty();
      });

      if (efDeleteBtn) efDeleteBtn.addEventListener('click', function() {
        if (roofSelectedFace >= 0 && roofSelectedSection >= 0) {
          deleteRoofSection(roofSelectedFace, roofSelectedSection);
          var efPanel = document.getElementById('efPanel');
          if (efPanel) efPanel.classList.add('hidden');
        }
      });

      // ── SmartRoof panel listeners ──
      var srEditBtn = document.getElementById('srEditRoofBtn');
      if (srEditBtn) srEditBtn.addEventListener('click', function() { enterRoofEditMode(); });

      var srDeleteBtn = document.getElementById('srDeleteBtn');
      if (srDeleteBtn) srDeleteBtn.addEventListener('click', function() {
        if (roofSelectedFace >= 0) deleteRoofFace(roofSelectedFace);
      });

      var srDuplicateBtn = document.getElementById('srDuplicateBtn');
      if (srDuplicateBtn) srDuplicateBtn.addEventListener('click', function() {
        if (roofSelectedFace < 0) return;
        var face = roofFaces3d[roofSelectedFace];
        // Offset duplicate by 2m in x
        var newVerts = face.vertices.map(function(v) { return {x: v.x + 2, z: v.z + 2}; });
        pushUndo();
        var newIdx = finalizeRoofFace(newVerts, face.pitch, face.azimuth, face.height, face.deletedSections.slice(), face.sectionPitches ? face.sectionPitches.slice() : null);
        selectRoofWhole(newIdx);
      });

      // SmartRoof height input — real-time + change with undo
      var srHeightInput = document.getElementById('srHeight');
      if (srHeightInput) {
        srHeightInput.addEventListener('input', function() {
          if (roofSelectedFace < 0) return;
          roofFaces3d[roofSelectedFace].height = (parseFloat(this.value) || 0) / 3.28084;
          rebuildRoofFace(roofSelectedFace);
        });
        srHeightInput.addEventListener('change', function() {
          if (roofSelectedFace < 0) return;
          pushUndo();
          roofFaces3d[roofSelectedFace].height = (parseFloat(this.value) || 0) / 3.28084;
          rebuildRoofFace(roofSelectedFace);
          markDirty();
        });
      }

      // SmartRoof stories input
      var srStoriesInput = document.getElementById('srStories');
      if (srStoriesInput) {
        srStoriesInput.addEventListener('change', function() {
          if (roofSelectedFace < 0) return;
          roofFaces3d[roofSelectedFace].stories = parseInt(this.value) || 0;
          markDirty();
        });
      }

      // SmartRoof Move button
      var srMoveBtn = document.getElementById('srMoveBtn');
      if (srMoveBtn) srMoveBtn.addEventListener('click', function() {
        if (roofSelectedFace < 0) return;
        roofMovingMode = !roofMovingMode;
        srMoveBtn.style.borderColor = roofMovingMode ? '#00e5ff' : '#444';
        srMoveBtn.style.color = roofMovingMode ? '#00e5ff' : '#fff';
        if (roofMovingMode) {
          document.getElementById('canvas3d').style.cursor = 'move';
        } else {
          document.getElementById('canvas3d').style.cursor = '';
        }
      });

      // ── Real-time 'input' listeners for existing panels ──
      // Pitch (roofPropsSection)
      if (pitchInput) pitchInput.addEventListener('input', function() {
        if (roofSelectedFace < 0) return;
        var face = roofFaces3d[roofSelectedFace];
        var val = parseFloat(this.value) || 0;
        if (roofSelectedSection >= 0 && face.sectionPitches) {
          face.sectionPitches[roofSelectedSection] = val;
          face.pitch = Math.max.apply(null, face.sectionPitches);
        } else {
          face.pitch = val;
          if (face.sectionPitches) {
            for (var i = 0; i < face.sectionPitches.length; i++) face.sectionPitches[i] = val;
          }
        }
        rebuildRoofFace(roofSelectedFace);
        updateRoofPropsPanel();
      });

      // Height (roofPropsSection)
      if (heightInput) heightInput.addEventListener('input', function() {
        if (roofSelectedFace < 0) return;
        roofFaces3d[roofSelectedFace].height = (parseFloat(this.value) || 0) / 3.28084;
        rebuildRoofFace(roofSelectedFace);
      });

      // Azimuth (roofPropsSection)
      if (azInput) azInput.addEventListener('input', function() {
        if (roofSelectedFace < 0) return;
        roofFaces3d[roofSelectedFace].azimuth = parseFloat(this.value) || 0;
        updateRoofPropsPanel();
      });

      // Pitch (efPanel)
      if (efPitchInput) efPitchInput.addEventListener('input', function() {
        if (roofSelectedFace < 0) return;
        var face = roofFaces3d[roofSelectedFace];
        var val = parseFloat(this.value) || 0;
        if (roofSelectedSection >= 0 && face.sectionPitches) {
          face.sectionPitches[roofSelectedSection] = val;
          face.pitch = Math.max.apply(null, face.sectionPitches);
        } else {
          face.pitch = val;
          if (face.sectionPitches) {
            for (var i = 0; i < face.sectionPitches.length; i++) face.sectionPitches[i] = val;
          }
        }
        var oldPitch = document.getElementById('roofPropPitch');
        if (oldPitch) oldPitch.value = val;
        rebuildRoofFace(roofSelectedFace);
        updateRoofPropsPanel();
      });

      // Height (efPanel)
      if (efHeightInput) efHeightInput.addEventListener('input', function() {
        if (roofSelectedFace < 0) return;
        roofFaces3d[roofSelectedFace].height = (parseFloat(this.value) || 0) / 3.28084;
        rebuildRoofFace(roofSelectedFace);
        updateRoofPropsPanel();
      });

      // Azimuth (efPanel)
      if (efAzInput) efAzInput.addEventListener('input', function() {
        if (roofSelectedFace < 0) return;
        roofFaces3d[roofSelectedFace].azimuth = parseFloat(this.value) || 0;
        updateRoofPropsPanel();
      });

      // ── Roof Edit Banner: dormer buttons ──
      document.querySelectorAll('.reb-dormer-btn').forEach(function(btn) {
        btn.addEventListener('click', function(e) {
          e.stopPropagation();
          var type = btn.dataset.dormer;
          if (dormerPlaceMode && dormerPlaceType === type) {
            exitDormerPlaceMode();
          } else {
            enterDormerPlaceMode(type);
          }
        });
      });

      var rebCloseBtn = document.getElementById('rebCloseBtn');
      if (rebCloseBtn) rebCloseBtn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (dormerPlaceMode) {
          exitDormerPlaceMode();
        } else {
          deselectRoofFace();
        }
      });

      // ── Dormer panel: shape selector ──
      document.querySelectorAll('.dp-shape-item').forEach(function(item) {
        item.addEventListener('click', function() {
          if (selectedDormerIdx < 0 || roofSelectedFace < 0) return;
          var face = roofFaces3d[roofSelectedFace];
          var d = face.dormers[selectedDormerIdx];
          var newType = item.dataset.type;
          if (d.type === newType) return;
          pushUndo();
          d.type = newType;
          rebuildDormer(face, selectedDormerIdx);
          updateDormerPanel(d);
          markDirty();
        });
      });

      // ── Dormer panel: pitch inputs ──
      var dpPitch = document.getElementById('dpPitch');
      if (dpPitch) dpPitch.addEventListener('input', function() {
        if (selectedDormerIdx < 0 || roofSelectedFace < 0) return;
        var d = roofFaces3d[roofSelectedFace].dormers[selectedDormerIdx];
        d.pitch = parseFloat(this.value) || 0;
        rebuildDormer(roofFaces3d[roofSelectedFace], selectedDormerIdx);
      });

      var dpPitchSide = document.getElementById('dpPitchSide');
      if (dpPitchSide) dpPitchSide.addEventListener('input', function() {
        if (selectedDormerIdx < 0 || roofSelectedFace < 0) return;
        var d = roofFaces3d[roofSelectedFace].dormers[selectedDormerIdx];
        d.pitchSide = parseFloat(this.value) || 0;
        d.pitch = d.pitchSide;
        rebuildDormer(roofFaces3d[roofSelectedFace], selectedDormerIdx);
      });

      var dpPitchFront = document.getElementById('dpPitchFront');
      if (dpPitchFront) dpPitchFront.addEventListener('input', function() {
        if (selectedDormerIdx < 0 || roofSelectedFace < 0) return;
        var d = roofFaces3d[roofSelectedFace].dormers[selectedDormerIdx];
        d.pitchFront = parseFloat(this.value) || 0;
        rebuildDormer(roofFaces3d[roofSelectedFace], selectedDormerIdx);
      });

      // ── Dormer panel: delete & duplicate ──
      var dpDeleteBtn = document.getElementById('dpDeleteBtn');
      if (dpDeleteBtn) dpDeleteBtn.addEventListener('click', function() {
        if (selectedDormerIdx < 0 || roofSelectedFace < 0) return;
        pushUndo();
        deleteDormer(roofSelectedFace, selectedDormerIdx);
      });

      var dpDuplicateBtn = document.getElementById('dpDuplicateBtn');
      if (dpDuplicateBtn) dpDuplicateBtn.addEventListener('click', function() {
        if (selectedDormerIdx < 0 || roofSelectedFace < 0) return;
        var face = roofFaces3d[roofSelectedFace];
        var orig = face.dormers[selectedDormerIdx];
        pushUndo();
        var newDormer = {
          type: orig.type,
          vertices: orig.vertices.map(function(v) { return {x: v.x + 1.5, z: v.z + 1.5}; }),
          pitch: orig.pitch,
          pitchSide: orig.pitchSide,
          pitchFront: orig.pitchFront,
          mesh: null, outlineLines: null, handleMeshes: [], selected: false
        };
        face.dormers.push(newDormer);
        var newIdx = face.dormers.length - 1;
        rebuildDormer(face, newIdx);
        selectDormer(roofSelectedFace, newIdx);
        markDirty();
      });

    })();

    /* ══════════════════════════════════════════════════════════════════════════
       CALIBRATION SYSTEM — side-by-side alignment of satellite + LiDAR
       User places matching control points on house corners in both images,
       then a least-squares similarity transform (tx, tz, scale, rotation)
       is computed and applied to the ground plane.
       ══════════════════════════════════════════════════════════════════════════ */

    var calibrationActive = false;
    var calibSavedTransform = null;
    var calibPoints = { lidar: [], satellite: [] }; // arrays of {px, py} in image-pixel coords
    var calibSatImage = null;
    var calibLidarImage = null;
    var calibPanels = {
      sat:   { zoom: 1, panX: 0, panY: 0, dragging: false, didDrag: false, sx: 0, sy: 0, spx: 0, spy: 0 },
      lidar: { zoom: 1, panX: 0, panY: 0, dragging: false, didDrag: false, sx: 0, sy: 0, spx: 0, spy: 0 }
    };

    // Load satellite image directly from API (no dependency on 3D viewer)
    function loadCalibSatelliteImage(callback) {
      var img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = function() { callback(img); };
      img.onerror = function() { callback(null); };
      img.src = '/api/satellite?lat=' + designLat + '&lng=' + designLng + '&zoom=20&size=640';
    }

    // Load high-res Solar API aerial image for calibration (same source as 3D ground plane)
    function loadCalibLidarImage(callback) {
      fetch('/api/solar/dsm-elevation?lat=' + designLat + '&lng=' + designLng + '&radius=50')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (!data.satelliteDataUrl) { callback(null); return; }
          // Compute LiDAR image extent in meters from RGB-specific bbox (or fallback to DSM bbox)
          var useBbox = data.rgbBbox || data.bbox;
          if (useBbox) {
            var mPerDegLng = 111320 * Math.cos(designLat * Math.PI / 180);
            lidarExtentMX = (useBbox[2] - useBbox[0]) * mPerDegLng;
            lidarExtentMY = (useBbox[3] - useBbox[1]) * 111320;
          }
          var img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = function() { callback(img); };
          img.onerror = function() { callback(null); };
          img.src = data.satelliteDataUrl;
        })
        .catch(function() { callback(null); });
    }

    // Draw one calibration panel (satellite or lidar)
    function drawCalibPanel(canvasId, img, points, color, panelKey) {
      var canvas = document.getElementById(canvasId);
      if (!canvas) return;
      var ctx = canvas.getContext('2d');
      var w = canvas.width, h = canvas.height;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#111';
      ctx.fillRect(0, 0, w, h);

      if (!img) return;
      var p = calibPanels[panelKey];
      var iw = img.width, ih = img.height;
      var fitScale = Math.min(w / iw, h / ih) * 0.85;

      ctx.save();
      ctx.translate(w / 2, h / 2);
      ctx.scale(p.zoom * fitScale, p.zoom * fitScale);
      ctx.translate(p.panX, p.panY);
      ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
      ctx.restore();

      // Draw numbered pin markers
      for (var i = 0; i < points.length; i++) {
        var cx = (points[i].px - iw / 2 + p.panX) * p.zoom * fitScale + w / 2;
        var cy = (points[i].py - ih / 2 + p.panY) * p.zoom * fitScale + h / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 10, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i + 1), cx, cy);
      }
    }

    function drawAllCalibPanels() {
      drawCalibPanel('calibCanvasSat', calibSatImage, calibPoints.satellite, 'rgba(59,130,246,0.9)', 'sat');
      drawCalibPanel('calibCanvasLidar', calibLidarImage, calibPoints.lidar, 'rgba(234,88,12,0.9)', 'lidar');
    }

    // Convert image-pixel pin coords to world (meter) coords for transform solving
    // panelType: 'satellite' or 'lidar'
    function calibPinsToWorld(pins, panelType) {
      var result = [];
      var img = (panelType === 'satellite') ? calibSatImage : calibLidarImage;
      if (!img) return result;
      var iw = img.width, ih = img.height;
      for (var i = 0; i < pins.length; i++) {
        var px = pins[i].px, py = pins[i].py;
        if (panelType === 'satellite') {
          // Satellite: 1280px image covers satExtentM meters, centered on design point
          var mPerPx = satExtentM / iw;
          result.push({ x: (px - iw / 2) * mPerPx, z: (py - ih / 2) * mPerPx });
        } else {
          // LiDAR/RGB: image covers lidarExtentM meters — add center offset to align with design point
          var mPerPxX = lidarExtentMX / iw;
          var mPerPxY = lidarExtentMY / ih;
          result.push({ x: (px - iw / 2) * mPerPxX + lidarCenterOffX, z: (py - ih / 2) * mPerPxY + lidarCenterOffZ });
        }
      }
      return result;
    }

    function updateCalibUI() {
      var nSat = calibPoints.satellite.length, nLidar = calibPoints.lidar.length, n = Math.min(nSat, nLidar);
      var el = document.getElementById('calibPointCount');
      if (el) el.textContent = n + ' point pair' + (n !== 1 ? 's' : '');
      var sc = document.getElementById('calibSatCount'); if (sc) sc.textContent = nSat + ' pin' + (nSat !== 1 ? 's' : '');
      var lc = document.getElementById('calibLidarCount'); if (lc) lc.textContent = nLidar + ' pin' + (nLidar !== 1 ? 's' : '');
      var btn = document.getElementById('calibConfirm');
      if (btn) {
        if (n >= 4) { btn.disabled = false; btn.style.background = '#7c3aed'; btn.style.color = '#fff'; btn.style.cursor = 'pointer'; btn.textContent = 'Confirm (' + n + ' pairs)'; }
        else { btn.disabled = true; btn.style.background = '#555'; btn.style.color = '#888'; btn.style.cursor = 'not-allowed'; btn.textContent = 'Confirm (need ' + (4 - n) + ' more)'; }
      }
    }

    function solveSimilarityTransform(satPts, lidarPts) {
      var n = Math.min(satPts.length, lidarPts.length); if (n < 2) return null;
      var csx=0,csz=0,clx=0,clz=0;
      for (var i=0;i<n;i++){csx+=satPts[i].x;csz+=satPts[i].z;clx+=lidarPts[i].x;clz+=lidarPts[i].z;}
      csx/=n;csz/=n;clx/=n;clz/=n;
      var Sxx=0,Sxz=0,Dx=0;
      for(var i=0;i<n;i++){var sx=satPts[i].x-csx,sz=satPts[i].z-csz,lx=lidarPts[i].x-clx,lz=lidarPts[i].z-clz;Sxx+=sx*lx+sz*lz;Sxz+=sx*lz-sz*lx;Dx+=sx*sx+sz*sz;}
      if(Dx<1e-12)return null;var a=Sxx/Dx,b=Sxz/Dx;
      return{tx:clx-(a*csx-b*csz),tz:clz-(b*csx+a*csz),scale:Math.sqrt(a*a+b*b),rotation:Math.atan2(b,a)};
    }

    var pendingCalibration = null; // stored if LiDAR not yet loaded
    function applyCalibration(cal) {
      if (!cal) return;
      calibSavedTransform = cal;
      if (!lidarPoints) {
        // LiDAR not loaded yet — store and apply when it builds
        pendingCalibration = cal;
        console.log('Calibration stored (LiDAR not yet loaded): tx=' + cal.tx.toFixed(3) + ' tz=' + cal.tz.toFixed(3));
        return;
      }
      // Move LiDAR point cloud (satellite ground plane stays fixed as reference)
      // SET position (not +=) — calibration is the total offset, replaces auto-align
      lidarPoints.position.x = cal.tx;
      lidarPoints.position.z = cal.tz;
      pendingCalibration = null;
      console.log('Calibration applied to LiDAR: tx=' + cal.tx.toFixed(3) + ' tz=' + cal.tz.toFixed(3));
    }

    function openCalibration() {
      calibrationActive=true;calibPoints={lidar:[],satellite:[]};
      calibPanels.sat={zoom:1,panX:0,panY:0,dragging:false,didDrag:false,sx:0,sy:0,spx:0,spy:0};
      calibPanels.lidar={zoom:1,panX:0,panY:0,dragging:false,didDrag:false,sx:0,sy:0,spx:0,spy:0};
      calibSatImage=null;calibLidarImage=null;
      document.getElementById('calibOverlay').style.display='block';
      document.getElementById('calibSatLoading').style.display='flex';
      document.getElementById('calibLidarLoading').style.display='flex';
      requestAnimationFrame(function(){
        var cS=document.getElementById('calibCanvasSat'),cL=document.getElementById('calibCanvasLidar');
        var bE=document.getElementById('calibBody'),hw=Math.floor(bE.clientWidth/2),h=bE.clientHeight;
        cS.width=hw;cS.height=h;cL.width=hw;cL.height=h;
        loadCalibSatelliteImage(function(img){
          calibSatImage=img;document.getElementById('calibSatLoading').style.display='none';
          drawCalibPanel('calibCanvasSat',calibSatImage,calibPoints.satellite,'rgba(59,130,246,0.9)','sat');
        });
        loadCalibLidarImage(function(img){
          calibLidarImage=img;
          var el=document.getElementById('calibLidarLoading');
          if(img){el.style.display='none';}
          else{el.textContent='Aerial image unavailable';el.style.color='#f87171';}
          drawCalibPanel('calibCanvasLidar',calibLidarImage,calibPoints.lidar,'rgba(234,88,12,0.9)','lidar');
        });
        updateCalibUI();
      });
    }
    function closeCalibration(){
      // Only allow closing if calibration has been completed
      if(!projectHasCalibration && !calibSavedTransform){
        console.log('Calibration required — cannot close without completing');
        return;
      }
      calibrationActive=false;document.getElementById('calibOverlay').style.display='none';
    }

    function setupCalibCanvas(canvasId,panelKey,pointsKey,color){
      var canvas=document.getElementById(canvasId);if(!canvas)return;
      canvas.addEventListener('click',function(e){
        var p=calibPanels[panelKey];if(p.didDrag){p.didDrag=false;return;}
        var img=(panelKey==='sat')?calibSatImage:calibLidarImage;if(!img)return;
        var rect=canvas.getBoundingClientRect(),cx=e.clientX-rect.left,cy=e.clientY-rect.top;
        var iw=img.width,ih=img.height,fitScale=Math.min(canvas.width/iw,canvas.height/ih)*0.85;
        var imgPx=(cx-canvas.width/2)/(p.zoom*fitScale)-p.panX+iw/2;
        var imgPy=(cy-canvas.height/2)/(p.zoom*fitScale)-p.panY+ih/2;
        calibPoints[pointsKey].push({px:imgPx,py:imgPy});updateCalibUI();drawAllCalibPanels();
      });
      canvas.addEventListener('wheel',function(e){
        e.preventDefault();var p=calibPanels[panelKey];
        p.zoom=Math.max(0.2,Math.min(10,p.zoom*(e.deltaY>0?0.9:1.1)));
        drawCalibPanel(canvasId,panelKey==='sat'?calibSatImage:calibLidarImage,calibPoints[pointsKey],color,panelKey);
      },{passive:false});
      canvas.addEventListener('mousedown',function(e){
        if(e.button!==0)return;var p=calibPanels[panelKey];
        p.dragging=true;p.didDrag=false;p.sx=e.clientX;p.sy=e.clientY;p.spx=p.panX;p.spy=p.panY;
        canvas.style.cursor='grabbing';e.preventDefault();
      });
      document.addEventListener('mousemove',function(e){
        var p=calibPanels[panelKey];if(!p.dragging)return;
        var img=(panelKey==='sat')?calibSatImage:calibLidarImage;if(!img)return;
        var fitScale=Math.min(canvas.width/img.width,canvas.height/img.height)*0.85;
        var dx=e.clientX-p.sx,dy=e.clientY-p.sy;if(Math.abs(dx)>3||Math.abs(dy)>3)p.didDrag=true;
        p.panX=p.spx+dx/(p.zoom*fitScale);p.panY=p.spy+dy/(p.zoom*fitScale);
        drawCalibPanel(canvasId,panelKey==='sat'?calibSatImage:calibLidarImage,calibPoints[pointsKey],color,panelKey);
      });
      document.addEventListener('mouseup',function(){var p=calibPanels[panelKey];if(p.dragging){p.dragging=false;canvas.style.cursor='crosshair';}});
    }
    setupCalibCanvas('calibCanvasSat','sat','satellite','rgba(59,130,246,0.9)');
    setupCalibCanvas('calibCanvasLidar','lidar','lidar','rgba(234,88,12,0.9)');

    document.querySelectorAll('.calib-zoom-btn').forEach(function(b){b.addEventListener('click',function(){
      var pnl=b.dataset.panel,act=b.dataset.action,p=calibPanels[pnl];
      if(act==='in')p.zoom=Math.min(10,p.zoom*1.3);else if(act==='out')p.zoom=Math.max(0.2,p.zoom/1.3);
      else if(act==='fit'){p.zoom=1;p.panX=0;p.panY=0;}drawAllCalibPanels();
    });});
    document.getElementById('calibClear').addEventListener('click',function(){calibPoints={lidar:[],satellite:[]};updateCalibUI();drawAllCalibPanels();});
    document.getElementById('calibSkip').addEventListener('click',function(){closeCalibration();});
    document.getElementById('calibConfirm').addEventListener('click',function(){
      var n=Math.min(calibPoints.lidar.length,calibPoints.satellite.length);if(n<4)return;
      var satW=calibPinsToWorld(calibPoints.satellite.slice(0,n),'satellite');
      var lidW=calibPinsToWorld(calibPoints.lidar.slice(0,n),'lidar');
      console.log('Calibration debug: satExtentM=' + satExtentM.toFixed(2) + ' lidarExtentMX=' + lidarExtentMX.toFixed(2) + ' lidarExtentMY=' + lidarExtentMY.toFixed(2));
      console.log('Sat pins (meters):', JSON.stringify(satW));
      console.log('LiDAR pins (meters):', JSON.stringify(lidW));
      if(satW.length<4||lidW.length<4){alert('Not enough valid points');return;}

      // Translation-only: average offset to shift LiDAR toward satellite positions
      var tx = 0, tz = 0;
      for (var i = 0; i < n; i++) {
        tx += satW[i].x - lidW[i].x;
        tz += satW[i].z - lidW[i].z;
      }
      tx /= n; tz /= n;
      console.log('Calibration offset: tx=' + tx.toFixed(3) + 'm, tz=' + tz.toFixed(3) + 'm');

      // Sanity check
      if (Math.abs(tx) > 20 || Math.abs(tz) > 20) {
        if (!confirm('Calibration offset is large (' + tx.toFixed(1) + 'm, ' + tz.toFixed(1) + 'm). This may indicate mismatched pins. Apply anyway?')) return;
      }

      var transform = { tx: tx, tz: tz, version: 2 };
      transform.controlPoints = [];
      for (var i = 0; i < n; i++) transform.controlPoints.push({sat: satW[i], lidar: lidW[i]});

      fetch('/api/projects/'+projectId+'/calibration',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(transform)});
      applyCalibration(transform);
      projectHasCalibration = true;
      var btn=document.getElementById('btnCalibrate');if(btn){btn.classList.add('tb2-calibrated');}
      closeCalibration();
    });

    document.getElementById('btnCalibrate').addEventListener('click',function(){
      if(calibrationActive){closeCalibration();return;}
      openCalibration();
    });

    // Auto-open calibration if not done — user must calibrate before designing
    if(!projectHasCalibration){
      setTimeout(function(){ openCalibration(); }, 500);
    }

    var _origBuildLidar=buildLidarPointCloud;
    buildLidarPointCloud=function(points){
      _origBuildLidar(points);

      function revealLidar() {
        if (lidarPoints) lidarPoints.visible = lidarVisible;
        var overlay = document.getElementById('lidarLoadingOverlay');
        if (overlay) overlay.style.display = 'none';
        if (lidarVisible) setStatus3d(points.length.toLocaleString() + ' points loaded');
      }

      // Apply calibration AFTER auto-align finishes to avoid race condition
      function applyAfterAlign() {
        if (pendingCalibration) {
          applyCalibration(pendingCalibration);
          revealLidar();
          return;
        }
        // Auto-load saved calibration (version 2+ only, ignore old pixel-space data)
        fetch('/api/projects/'+projectId+'/calibration')
          .then(function(r){return r.json();})
          .then(function(cal){
            if(cal && cal.version >= 2 && cal.tx !== undefined){
              applyCalibration(cal);
              var btn=document.getElementById('btnCalibrate');
              if(btn) btn.classList.add('tb2-calibrated');
            }
          })
          .catch(function(){})
          .finally(function(){ revealLidar(); });
      }

      if (autoAlignDone) {
        applyAfterAlign();
      } else {
        onAutoAlignDone = applyAfterAlign;
      }
    };

  </script>

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

// ── Sales Mode (Slideshow) ─────────────────────────────────────────────────────
app.get("/sales", (req, res) => {
  const { projectId } = req.query;
  if (!projectId) return res.redirect("/");
  const projects = loadProjects();
  const project = projects.find(p => p.id === projectId);
  if (!project) return res.redirect("/");

  const customerName = esc(project.customer?.name || project.projectName || "Homeowner");
  const address = esc(project.address || "");
  const shortAddr = esc((project.address || "").split(",").slice(0, 2).join(","));
  const lat = project.lat;
  const lng = project.lng;
  const propertyType = project.propertyType === "commercial" ? "Commercial" : "Residential";
  const energyUsage = project.energyUsage || [];
  const hasUsageData = energyUsage.length > 0 && energyUsage.some(v => v > 0);
  const annualUsage = energyUsage.reduce((a, b) => a + (Number(b) || 0), 0);
  const avgMonthlyUsage = Math.round(annualUsage / 12);
  const production = [220, 280, 870, 1010, 1060, 1200, 1250, 1220, 880, 490, 220, 120];
  const annualProduction = production.reduce((a, b) => a + b, 0);
  const systemCost = 46225;
  const systemSize = 10.75;
  const panelCount = Math.round(systemSize * 1000 / 400);
  const avgRate = 0.18;
  const estMonthlyBill = Math.round(avgMonthlyUsage * avgRate) || 185;
  const estAnnualBill = estMonthlyBill * 12;
  const annualSavings = Math.round(annualProduction * avgRate);
  const monthlySavings = Math.round(annualSavings / 12);
  const paybackYears = Math.round(systemCost / annualSavings);
  const savings25yr = annualSavings * 25;
  const offsetPct = hasUsageData && annualUsage > 0 ? Math.min(100, Math.round((annualProduction / annualUsage) * 100)) : 96;
  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const energyJSON = JSON.stringify(energyUsage.map(Number));
  const prodJSON = JSON.stringify(production);

  // 25-year savings spreadsheet data
  const marketIncrease = 0.05;
  const solarEscalator = 1.0299;
  const currentRate = avgRate || 0.217;
  const annualConsumption = annualUsage || 7418;
  const solarRate = 0.32;
  const solarProd = annualProduction || 6100;
  const leftoverConsumption = Math.max(0, annualConsumption - solarProd);
  const coveragePct = ((solarProd / annualConsumption) * 100).toFixed(1);

  let savingsRows = '';
  let totalUtility25 = 0;
  let totalSolar25 = 0;
  let cumulativeSavings = 0;
  for (let yr = 1; yr <= 25; yr++) {
    const utilRate = currentRate * Math.pow(1 + marketIncrease, yr - 1);
    const utilBill = (annualConsumption * utilRate) / 12;
    const solarBill = (solarProd * solarRate * Math.pow(solarEscalator, yr - 1)) / 12;
    const leftoverCost = (leftoverConsumption * utilRate) / 12;
    const totalMonthlyCost = solarBill + leftoverCost;
    const monthlySav = utilBill - totalMonthlyCost;
    cumulativeSavings += monthlySav * 12;
    totalUtility25 += utilBill * 12;
    totalSolar25 += totalMonthlyCost * 12;

    const fmtNum = (n) => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    const label = (yr % 5 === 0 || yr === 1) ? 'Year ' + yr : '';
    const showCum = (yr % 5 === 0) ? '$' + fmtNum(cumulativeSavings) : '';
    savingsRows += '<tr' + (yr % 5 === 0 ? ' class="yr-milestone"' : '') + '>'
      + '<td class="yr-label">' + label + '</td>'
      + '<td class="col-util">$' + fmtNum(utilBill) + '</td>'
      + '<td class="col-solar">$' + fmtNum(solarBill) + '</td>'
      + '<td class="col-left">$' + fmtNum(leftoverCost) + '</td>'
      + '<td class="col-total">$' + fmtNum(totalMonthlyCost) + '</td>'
      + '<td class="col-save">$' + fmtNum(monthlySav * 12) + '</td>'
      + '<td class="col-cum">' + showCum + '</td>'
      + '</tr>';
  }
  const fmtTotal = (n) => n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Sales Mode — ${customerName}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; overflow: hidden; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f0f14; color: #fff; }
    .s-topbar {
      height: 52px; display: flex; align-items: center; justify-content: space-between;
      padding: 0 24px; background: rgba(15,15,20,0.95); border-bottom: 1px solid rgba(255,255,255,0.06);
      position: relative; z-index: 10;
    }
    .s-exit {
      display: flex; align-items: center; gap: 8px; background: none; border: 1px solid rgba(255,255,255,0.12);
      color: #aaa; font-size: 0.82rem; padding: 6px 14px; border-radius: 8px; cursor: pointer; transition: all 0.15s;
    }
    .s-exit:hover { background: rgba(255,255,255,0.06); color: #fff; border-color: rgba(255,255,255,0.25); }
    .s-title { font-size: 0.88rem; font-weight: 500; color: rgba(255,255,255,0.6); position: absolute; left: 50%; transform: translateX(-50%); }
    .s-counter { font-size: 0.82rem; color: rgba(255,255,255,0.35); font-variant-numeric: tabular-nums; }
    .s-viewport { position: relative; flex: 1; overflow: hidden; }
    body { display: flex; flex-direction: column; }
    .slide {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      opacity: 0; pointer-events: none; transition: opacity 0.5s ease;
      padding: 40px 60px; overflow-y: auto;
    }
    .slide.active { opacity: 1; pointer-events: auto; }
    .slide-inner { max-width: 1000px; width: 100%; }
    .s-nav {
      height: 56px; display: flex; align-items: center; justify-content: center; gap: 20px;
      background: rgba(15,15,20,0.95); border-top: 1px solid rgba(255,255,255,0.06);
    }
    .s-arrow {
      width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      background: none; border: 1px solid rgba(255,255,255,0.12); color: #aaa; cursor: pointer; transition: all 0.15s;
    }
    .s-arrow:hover { background: rgba(255,255,255,0.08); color: #fff; border-color: rgba(255,255,255,0.3); }
    .s-arrow:disabled { opacity: 0.2; cursor: default; }
    .s-dots { display: flex; gap: 8px; }
    .s-dot {
      width: 10px; height: 10px; border-radius: 50%; background: rgba(255,255,255,0.15);
      cursor: pointer; transition: all 0.25s; border: none;
    }
    .s-dot.active { background: #c084fc; transform: scale(1.2); }
    .s-dot:hover:not(.active) { background: rgba(255,255,255,0.3); }
    .s-label { font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 2px; color: #c084fc; margin-bottom: 12px; }
    .s-heading { font-size: 2.6rem; font-weight: 700; line-height: 1.15; margin-bottom: 16px; letter-spacing: -1px; }
    .s-divider { width: 60px; height: 3px; background: linear-gradient(90deg, #c084fc, #818cf8); border-radius: 2px; margin-bottom: 4px; }
    .s-accent { color: #c084fc; }
    .s-green { color: #34d399; }
    .welcome-center { text-align: center; }
    .welcome-logo {
      width: 56px; height: 56px; border-radius: 14px;
      background: linear-gradient(135deg, #c084fc, #818cf8);
      display: flex; align-items: center; justify-content: center; margin: 0 auto 28px;
    }
    .welcome-heading { font-size: 3rem; font-weight: 700; letter-spacing: -1.5px; margin-bottom: 8px; }
    .welcome-customer { font-size: 1.3rem; color: rgba(255,255,255,0.6); margin-bottom: 32px; }
    .welcome-meta { display: flex; gap: 24px; justify-content: center; font-size: 0.85rem; color: rgba(255,255,255,0.35); }
    .welcome-meta span { display: flex; align-items: center; gap: 6px; }
    .welcome-divider { width: 80px; height: 3px; background: linear-gradient(90deg, #c084fc, #818cf8); border-radius: 2px; margin: 24px auto; }
    .home-grid { display: grid; grid-template-columns: 1.3fr 1fr; gap: 40px; align-items: center; }
    .home-img { width: 100%; aspect-ratio: 4/3; border-radius: 16px; object-fit: cover; border: 1px solid rgba(255,255,255,0.08); background: #1a1a22; }
    .home-detail { display: flex; flex-direction: column; gap: 20px; }
    .home-detail-item { display: flex; align-items: flex-start; gap: 14px; }
    .home-detail-icon { width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0; background: rgba(192,132,252,0.1); display: flex; align-items: center; justify-content: center; }
    .home-detail-label { font-size: 0.75rem; color: rgba(255,255,255,0.4); text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
    .home-detail-val { font-size: 0.95rem; color: #fff; line-height: 1.4; }
    .energy-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 28px; }
    .energy-stat { text-align: center; }
    .energy-stat-val { font-size: 1.8rem; font-weight: 700; }
    .energy-stat-label { font-size: 0.78rem; color: rgba(255,255,255,0.4); margin-top: 4px; }
    .energy-chart-wrap { background: rgba(255,255,255,0.03); border-radius: 12px; padding: 20px; }
    .energy-empty { text-align: center; padding: 48px; color: rgba(255,255,255,0.3); font-size: 0.9rem; }
    .design-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 40px; align-items: start; }
    .design-specs { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .design-spec { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 20px; text-align: center; }
    .design-spec-val { font-size: 1.6rem; font-weight: 700; margin-bottom: 4px; }
    .design-spec-label { font-size: 0.78rem; color: rgba(255,255,255,0.4); }
    .design-img { width: 100%; aspect-ratio: 4/3; border-radius: 16px; object-fit: cover; border: 1px solid rgba(255,255,255,0.08); background: #1a1a22; }
    .savings-compare { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 28px; }
    .savings-card { border-radius: 16px; padding: 32px; text-align: center; }
    .savings-before { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); }
    .savings-after { background: rgba(52,211,153,0.08); border: 1px solid rgba(52,211,153,0.2); }
    .savings-card-title { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 1.5px; color: rgba(255,255,255,0.4); margin-bottom: 16px; }
    .savings-card-val { font-size: 2.4rem; font-weight: 700; margin-bottom: 4px; }
    .savings-card-sub { font-size: 0.85rem; color: rgba(255,255,255,0.4); }
    .savings-bottom { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
    .savings-badge { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 20px; text-align: center; }
    .savings-badge-val { font-size: 1.6rem; font-weight: 700; margin-bottom: 4px; }
    .savings-badge-label { font-size: 0.78rem; color: rgba(255,255,255,0.4); }
    .steps-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 40px; align-items: start; }
    .step-item { display: flex; gap: 18px; align-items: flex-start; margin-bottom: 24px; }
    .step-num { width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0; background: linear-gradient(135deg, #c084fc, #818cf8); display: flex; align-items: center; justify-content: center; font-size: 0.85rem; font-weight: 700; }
    .step-title { font-size: 1rem; font-weight: 600; margin-bottom: 4px; }
    .step-desc { font-size: 0.85rem; color: rgba(255,255,255,0.45); line-height: 1.5; }
    .cta-card { background: linear-gradient(135deg, rgba(192,132,252,0.12), rgba(129,140,248,0.12)); border: 1px solid rgba(192,132,252,0.2); border-radius: 16px; padding: 32px; text-align: center; }
    .cta-heading { font-size: 1.3rem; font-weight: 600; margin-bottom: 8px; }
    .cta-sub { font-size: 0.88rem; color: rgba(255,255,255,0.5); margin-bottom: 20px; line-height: 1.5; }
    .cta-btn { display: inline-block; padding: 14px 36px; border-radius: 12px; background: linear-gradient(135deg, #c084fc, #818cf8); color: #fff; font-size: 0.95rem; font-weight: 600; border: none; cursor: pointer; transition: transform 0.15s, box-shadow 0.15s; }
    .cta-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 24px rgba(192,132,252,0.3); }
    /* 25-Year Savings Spreadsheet */
    .ss-params { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }
    .ss-param { background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 10px; padding: 14px; }
    .ss-param-label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 1px; color: rgba(255,255,255,0.4); margin-bottom: 4px; }
    .ss-param-val { font-size: 1.05rem; font-weight: 600; }
    .ss-table-wrap { max-height: 420px; overflow-y: auto; border-radius: 10px; border: 1px solid rgba(255,255,255,0.08); }
    .ss-table { width: 100%; border-collapse: collapse; font-size: 0.75rem; font-variant-numeric: tabular-nums; }
    .ss-table thead { position: sticky; top: 0; z-index: 2; }
    .ss-table th { background: rgba(192,132,252,0.15); color: #c084fc; font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.5px; padding: 10px 8px; text-align: right; border-bottom: 1px solid rgba(255,255,255,0.1); }
    .ss-table th:first-child { text-align: left; }
    .ss-table td { padding: 6px 8px; text-align: right; border-bottom: 1px solid rgba(255,255,255,0.04); color: rgba(255,255,255,0.7); }
    .ss-table td:first-child { text-align: left; }
    .ss-table .yr-label { font-weight: 600; color: rgba(255,255,255,0.5); min-width: 50px; }
    .ss-table .col-util { color: #f87171; }
    .ss-table .col-solar { color: #60a5fa; }
    .ss-table .col-left { color: #fbbf24; }
    .ss-table .col-total { color: #c084fc; }
    .ss-table .col-save { color: #34d399; }
    .ss-table .col-cum { color: #34d399; font-weight: 700; }
    .ss-table .yr-milestone td { border-bottom: 1px solid rgba(255,255,255,0.12); }
    .ss-totals { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-top: 16px; }
    .ss-total { border-radius: 10px; padding: 16px; text-align: center; }
    .ss-total-label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
    .ss-total-val { font-size: 1.4rem; font-weight: 700; }
  </style>
</head>
<body>
  <div class="s-topbar">
    <button class="s-exit" onclick="location.href='/project/${projectId}'">
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg> Exit
    </button>
    <div class="s-title" id="slideTitle">Welcome</div>
    <div class="s-counter" id="slideCounter">1 / 7</div>
  </div>
  <div class="s-viewport">
    <!-- Slide 1: Welcome -->
    <div class="slide active" id="slide0">
      <div class="slide-inner welcome-center">
        <div class="welcome-logo"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg></div>
        <div class="s-label">Solar Proposal</div>
        <div class="welcome-heading">Your Solar Proposal</div>
        <div class="welcome-divider"></div>
        <div class="welcome-customer">Prepared for ${customerName}</div>
        <div class="welcome-meta">
          <span><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg> ${shortAddr}</span>
          <span><svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg> ${today}</span>
        </div>
      </div>
    </div>
    <!-- Slide 2: Your Home -->
    <div class="slide" id="slide1">
      <div class="slide-inner">
        <div class="s-label">Property Overview</div>
        <div class="s-heading">Your Home</div>
        <div class="s-divider"></div>
        <div class="home-grid" style="margin-top:28px">
          <img class="home-img" src="/api/satellite?lat=${lat}&lng=${lng}&zoom=19&size=800x600" alt="Satellite view"/>
          <div class="home-detail">
            <div class="home-detail-item"><div class="home-detail-icon"><svg width="18" height="18" fill="none" stroke="#c084fc" stroke-width="2" viewBox="0 0 24 24"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg></div><div><div class="home-detail-label">Address</div><div class="home-detail-val">${address}</div></div></div>
            <div class="home-detail-item"><div class="home-detail-icon"><svg width="18" height="18" fill="none" stroke="#c084fc" stroke-width="2" viewBox="0 0 24 24"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><polyline points="9 21 9 12 15 12 15 21"/></svg></div><div><div class="home-detail-label">Property Type</div><div class="home-detail-val">${propertyType}</div></div></div>
            <div class="home-detail-item"><div class="home-detail-icon"><svg width="18" height="18" fill="none" stroke="#c084fc" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg></div><div><div class="home-detail-label">Coordinates</div><div class="home-detail-val">${lat.toFixed(5)}, ${lng.toFixed(5)}</div></div></div>
            <div class="home-detail-item"><div class="home-detail-icon"><svg width="18" height="18" fill="none" stroke="#c084fc" stroke-width="2" viewBox="0 0 24 24"><path d="M12 22s-8-4.5-8-11.8A8 8 0 0112 2a8 8 0 018 8.2c0 7.3-8 11.8-8 11.8z"/></svg></div><div><div class="home-detail-label">Service Area</div><div class="home-detail-val">${esc((project.address || "").split(",").slice(-2).join(",").trim()) || "Massachusetts"}</div></div></div>
          </div>
        </div>
      </div>
    </div>
    <!-- Slide 3: Energy Profile -->
    <div class="slide" id="slide2">
      <div class="slide-inner">
        <div class="s-label">Current Usage</div>
        <div class="s-heading">Your Energy Profile</div>
        <div class="s-divider"></div>
        ${hasUsageData ? `
        <div class="energy-stats" style="margin-top:24px">
          <div class="energy-stat"><div class="energy-stat-val">${annualUsage.toLocaleString()} <span style="font-size:0.7em;font-weight:400;color:rgba(255,255,255,0.4)">kWh</span></div><div class="energy-stat-label">Annual Usage</div></div>
          <div class="energy-stat"><div class="energy-stat-val">${avgMonthlyUsage.toLocaleString()} <span style="font-size:0.7em;font-weight:400;color:rgba(255,255,255,0.4)">kWh</span></div><div class="energy-stat-label">Avg. Monthly</div></div>
          <div class="energy-stat"><div class="energy-stat-val">$${estMonthlyBill} <span style="font-size:0.7em;font-weight:400;color:rgba(255,255,255,0.4)">/mo</span></div><div class="energy-stat-label">Est. Monthly Bill</div></div>
        </div>
        <div class="energy-chart-wrap"><canvas id="energyChart" width="900" height="280"></canvas></div>
        ` : `
        <div class="energy-stats" style="margin-top:24px">
          <div class="energy-stat"><div class="energy-stat-val">~$${estMonthlyBill} <span style="font-size:0.7em;font-weight:400;color:rgba(255,255,255,0.4)">/mo</span></div><div class="energy-stat-label">Est. Monthly Bill</div></div>
          <div class="energy-stat"><div class="energy-stat-val">~${Math.round(estMonthlyBill / avgRate).toLocaleString()} <span style="font-size:0.7em;font-weight:400;color:rgba(255,255,255,0.4)">kWh</span></div><div class="energy-stat-label">Est. Monthly Usage</div></div>
          <div class="energy-stat"><div class="energy-stat-val">$${estAnnualBill.toLocaleString()} <span style="font-size:0.7em;font-weight:400;color:rgba(255,255,255,0.4)">/yr</span></div><div class="energy-stat-label">Est. Annual Bill</div></div>
        </div>
        <div class="energy-chart-wrap"><div class="energy-empty">
          <svg width="40" height="40" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1.5" viewBox="0 0 24 24" style="margin-bottom:12px"><path d="M12 20V10M6 20V4M18 20v-4"/></svg>
          <div>Detailed energy usage data not yet entered.</div>
          <div style="margin-top:6px;font-size:0.8rem;">Estimates shown above are based on regional averages.</div>
        </div></div>
        `}
      </div>
    </div>
    <!-- Slide 4: Solar Design -->
    <div class="slide" id="slide3">
      <div class="slide-inner">
        <div class="s-label">System Overview</div>
        <div class="s-heading">Your Solar Design</div>
        <div class="s-divider"></div>
        <div class="design-grid" style="margin-top:28px">
          <div>
            <img class="design-img" src="/api/satellite?lat=${lat}&lng=${lng}&zoom=20&size=800x600" alt="Design view"/>
            <div style="text-align:center;margin-top:10px;font-size:0.78rem;color:rgba(255,255,255,0.3);">Design 1 — Satellite View</div>
          </div>
          <div class="design-specs">
            <div class="design-spec"><div class="design-spec-val s-accent">${systemSize} kW</div><div class="design-spec-label">System Size</div></div>
            <div class="design-spec"><div class="design-spec-val">${panelCount}</div><div class="design-spec-label">Solar Panels</div></div>
            <div class="design-spec"><div class="design-spec-val">${annualProduction.toLocaleString()} <span style="font-size:0.55em;font-weight:400">kWh</span></div><div class="design-spec-label">Annual Production</div></div>
            <div class="design-spec"><div class="design-spec-val">$${systemCost.toLocaleString()}</div><div class="design-spec-label">System Cost</div></div>
            <div class="design-spec" style="grid-column:span 2"><div class="design-spec-val s-green">${offsetPct}%</div><div class="design-spec-label">Estimated Energy Offset</div></div>
          </div>
        </div>
      </div>
    </div>
    <!-- Slide 5: Savings -->
    <div class="slide" id="slide4">
      <div class="slide-inner">
        <div class="s-label">Financial Impact</div>
        <div class="s-heading">Your Savings</div>
        <div class="s-divider"></div>
        <div class="savings-compare" style="margin-top:28px">
          <div class="savings-card savings-before">
            <div class="savings-card-title">Before Solar</div>
            <div class="savings-card-val">$${estMonthlyBill}<span style="font-size:0.4em;font-weight:400;color:rgba(255,255,255,0.4)">/mo</span></div>
            <div class="savings-card-sub">$${estAnnualBill.toLocaleString()} per year</div>
          </div>
          <div class="savings-card savings-after">
            <div class="savings-card-title" style="color:#34d399">After Solar</div>
            <div class="savings-card-val s-green">$${Math.max(0, estMonthlyBill - monthlySavings)}<span style="font-size:0.4em;font-weight:400;color:rgba(255,255,255,0.4)">/mo</span></div>
            <div class="savings-card-sub" style="color:rgba(52,211,153,0.6)">Save ~$${monthlySavings}/mo</div>
          </div>
        </div>
        <div class="savings-bottom">
          <div class="savings-badge"><div class="savings-badge-val s-accent">~${paybackYears} yrs</div><div class="savings-badge-label">Payback Period</div></div>
          <div class="savings-badge"><div class="savings-badge-val s-green">$${savings25yr.toLocaleString()}</div><div class="savings-badge-label">25-Year Savings</div></div>
          <div class="savings-badge"><div class="savings-badge-val">${offsetPct}%</div><div class="savings-badge-label">Energy Offset</div></div>
        </div>
      </div>
    </div>
    <!-- Slide 6: 25-Year Savings Breakdown -->
    <div class="slide" id="slide5">
      <div class="slide-inner">
        <div class="s-label">25-Year Projection</div>
        <div class="s-heading">Savings Breakdown</div>
        <div class="s-divider"></div>
        <div class="ss-params" style="margin-top:20px">
          <div class="ss-param"><div class="ss-param-label">Market Increase</div><div class="ss-param-val" style="color:#f87171">5.0%/yr</div></div>
          <div class="ss-param"><div class="ss-param-label">Current Rate</div><div class="ss-param-val">$${currentRate.toFixed(4)}/kWh</div></div>
          <div class="ss-param"><div class="ss-param-label">Annual Consumption</div><div class="ss-param-val">${annualConsumption.toLocaleString()} kWh</div></div>
          <div class="ss-param"><div class="ss-param-label">Solar Rate</div><div class="ss-param-val" style="color:#60a5fa">$${solarRate.toFixed(3)}/kWh</div></div>
          <div class="ss-param"><div class="ss-param-label">Production</div><div class="ss-param-val">${solarProd.toLocaleString()} kWh</div></div>
          <div class="ss-param"><div class="ss-param-label">Coverage</div><div class="ss-param-val" style="color:#34d399">${coveragePct}%</div></div>
        </div>
        <div class="ss-table-wrap">
          <table class="ss-table">
            <thead><tr>
              <th></th>
              <th>Utility Bill</th>
              <th>Solar Billing</th>
              <th>Utility Leftover</th>
              <th>Total Cost</th>
              <th>Annual Savings</th>
              <th>Cumulative</th>
            </tr></thead>
            <tbody>${savingsRows}</tbody>
          </table>
        </div>
        <div class="ss-totals">
          <div class="ss-total" style="background:rgba(248,113,113,0.1);border:1px solid rgba(248,113,113,0.2);">
            <div class="ss-total-label" style="color:#f87171">Total Utility (25yr)</div>
            <div class="ss-total-val" style="color:#f87171">$${fmtTotal(totalUtility25)}</div>
          </div>
          <div class="ss-total" style="background:rgba(192,132,252,0.1);border:1px solid rgba(192,132,252,0.2);">
            <div class="ss-total-label" style="color:#c084fc">Total Solar (25yr)</div>
            <div class="ss-total-val" style="color:#c084fc">$${fmtTotal(totalSolar25)}</div>
          </div>
          <div class="ss-total" style="background:rgba(52,211,153,0.1);border:1px solid rgba(52,211,153,0.2);">
            <div class="ss-total-label" style="color:#34d399">Total Saved (25yr)</div>
            <div class="ss-total-val" style="color:#34d399">$${fmtTotal(cumulativeSavings)}</div>
          </div>
        </div>
      </div>
    </div>
    <!-- Slide 7: Next Steps -->
    <div class="slide" id="slide6">
      <div class="slide-inner">
        <div class="s-label">Getting Started</div>
        <div class="s-heading">Next Steps</div>
        <div class="s-divider"></div>
        <div class="steps-grid" style="margin-top:28px">
          <div>
            <div class="step-item"><div class="step-num">1</div><div><div class="step-title">Site Assessment</div><div class="step-desc">We verify roof condition, measurements, and shading to finalize your design.</div></div></div>
            <div class="step-item"><div class="step-num">2</div><div><div class="step-title">Final Design &amp; Proposal</div><div class="step-desc">Your custom system design is completed with final pricing and financing options.</div></div></div>
            <div class="step-item"><div class="step-num">3</div><div><div class="step-title">Permitting</div><div class="step-desc">We handle all permits and utility interconnection paperwork on your behalf.</div></div></div>
            <div class="step-item"><div class="step-num">4</div><div><div class="step-title">Installation</div><div class="step-desc">Professional installation typically completed in 1-2 days.</div></div></div>
            <div class="step-item"><div class="step-num">5</div><div><div class="step-title">Activation</div><div class="step-desc">Final inspection, utility approval, and your system goes live — start saving from day one.</div></div></div>
          </div>
          <div class="cta-card">
            <div class="cta-heading">Ready to go solar?</div>
            <div class="cta-sub">Take the next step toward energy independence and start saving on your electricity bills.</div>
            <button class="cta-btn">Let's Get Started</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div class="s-nav">
    <button class="s-arrow" id="prevBtn" disabled><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></button>
    <div class="s-dots"><button class="s-dot active"></button><button class="s-dot"></button><button class="s-dot"></button><button class="s-dot"></button><button class="s-dot"></button><button class="s-dot"></button><button class="s-dot"></button></div>
    <button class="s-arrow" id="nextBtn"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="9 6 15 12 9 18"/></svg></button>
  </div>
  <script>
    var current = 0, total = 7;
    var titles = ['Welcome','Your Home','Energy Profile','Solar Design','Your Savings','25-Year Breakdown','Next Steps'];
    var slides = document.querySelectorAll('.slide');
    var dots = document.querySelectorAll('.s-dot');
    var prevBtn = document.getElementById('prevBtn');
    var nextBtn = document.getElementById('nextBtn');
    function goTo(n) {
      if (n < 0 || n >= total) return;
      slides.forEach(function(s,i) { s.classList.toggle('active', i===n); });
      dots.forEach(function(d,i) { d.classList.toggle('active', i===n); });
      current = n;
      document.getElementById('slideTitle').textContent = titles[n];
      document.getElementById('slideCounter').textContent = (n+1)+' / '+total;
      prevBtn.disabled = n === 0; nextBtn.disabled = n === total-1;
      if (n === 2) drawEnergyChart();
    }
    prevBtn.onclick = function() { goTo(current-1); };
    nextBtn.onclick = function() { goTo(current+1); };
    dots.forEach(function(d,i) { d.onclick = function() { goTo(i); }; });
    document.addEventListener('keydown', function(e) {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); goTo(current+1); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); goTo(current-1); }
      if (e.key === 'Escape') location.href = '/project/${projectId}';
    });
    var chartDrawn = false;
    function drawEnergyChart() {
      if (chartDrawn) return;
      var canvas = document.getElementById('energyChart');
      if (!canvas) return;
      chartDrawn = true;
      var ctx = canvas.getContext('2d');
      var W = canvas.width, H = canvas.height;
      var usage = ${energyJSON};
      var prod = ${prodJSON};
      var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      var allVals = usage.concat(prod);
      var maxVal = Math.max.apply(null, allVals.filter(function(v){return v>0;})) || 1500;
      maxVal = maxVal * 1.15;
      var pad = {top:20,right:20,bottom:40,left:55};
      var chartW = W-pad.left-pad.right, chartH = H-pad.top-pad.bottom;
      var barGroupW = chartW/12, barW = barGroupW*0.3;
      ctx.strokeStyle='rgba(255,255,255,0.06)'; ctx.lineWidth=1;
      for(var g=0;g<=4;g++){var gy=pad.top+(chartH/4)*g;ctx.beginPath();ctx.moveTo(pad.left,gy);ctx.lineTo(W-pad.right,gy);ctx.stroke();ctx.fillStyle='rgba(255,255,255,0.3)';ctx.font='11px -apple-system,sans-serif';ctx.textAlign='right';ctx.fillText(Math.round(maxVal-(maxVal/4)*g).toLocaleString(),pad.left-8,gy+4);}
      for(var i=0;i<12;i++){var cx=pad.left+barGroupW*i+barGroupW/2;if(usage[i]>0){var uh=(usage[i]/maxVal)*chartH;ctx.fillStyle='#f87171';ctx.beginPath();rr(ctx,cx-barW-1,pad.top+chartH-uh,barW,uh,3);ctx.fill();}var ph=(prod[i]/maxVal)*chartH;ctx.fillStyle='#fbbf24';ctx.beginPath();rr(ctx,cx+1,pad.top+chartH-ph,barW,ph,3);ctx.fill();ctx.fillStyle='rgba(255,255,255,0.35)';ctx.font='11px -apple-system,sans-serif';ctx.textAlign='center';ctx.fillText(months[i],cx,H-pad.bottom+18);}
      ctx.fillStyle='#f87171';ctx.fillRect(W-200,8,10,10);ctx.fillStyle='rgba(255,255,255,0.5)';ctx.font='11px -apple-system,sans-serif';ctx.textAlign='left';ctx.fillText('Energy Usage',W-186,17);
      ctx.fillStyle='#fbbf24';ctx.fillRect(W-200,24,10,10);ctx.fillStyle='rgba(255,255,255,0.5)';ctx.fillText('Solar Production',W-186,33);
    }
    function rr(ctx,x,y,w,h,r){if(h<r*2)r=h/2;ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.lineTo(x+w,y+h);ctx.lineTo(x,y+h);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
  </script>
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
    <div class="rail-logo" onclick="location.href='/'" style="cursor:pointer">
      <svg width="18" height="18" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
      </svg>
    </div>
    <a class="rail-btn" href="/" title="Projects">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    </a>
    <a class="rail-btn" href="/database" title="Database">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>
      </svg>
    </a>
    <a class="rail-btn active" href="/settings" title="Settings" >
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
      </svg>
    </a>
    <a class="rail-btn" href="/partners" title="Partners">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
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
        <a class="sidebar-item" href="/settings/users">Users and licenses</a>
        <a class="sidebar-item" href="/settings/roles">Roles</a>
        <a class="sidebar-item" href="/settings/teams">Teams</a>
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
          <div class="field"><div class="field-label">First name</div><div class="field-value">${esc(req.user.firstName)}</div></div>
          <div class="field"><div class="field-label">Last name</div><div class="field-value">${esc(req.user.lastName)}</div></div>
          <div class="field"><div class="field-label">Job function</div><div class="field-value${req.user.jobFunction ? '' : ' muted'}">${req.user.jobFunction ? esc(req.user.jobFunction) : '—'}</div></div>
          <div class="field"><div class="field-label">Phone number</div><div class="field-value${req.user.phone ? '' : ' muted'}">${req.user.phone ? esc(req.user.phone) : '—'}</div></div>
          <div class="field"><div class="field-label">Email address</div><div class="field-value">${esc(req.user.email)}</div></div>
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
            <div class="field-value">${esc(req.user.license)}</div>
          </div>
          <div class="field">
            <div class="field-label">Role <span class="info-icon">i</span></div>
            <div class="field-value">${esc(req.user.role)}</div>
          </div>
        </div>

      </div>
    </main>
  </div>

</body>
</html>`);
});

// ── Users API ─────────────────────────────────────────────────────────────────
app.get("/api/users", (req, res) => {
  const users = loadUsers().map(u => ({ ...u, password: undefined }));
  res.json(users);
});

app.post("/api/users", (req, res) => {
  const users = loadUsers();
  const { username, password, firstName, lastName, email, phone, role, license, team, jobFunction } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });
  if (users.find(u => u.username === username)) return res.status(409).json({ error: "Username already exists" });
  const user = {
    id: "u_" + newId(),
    username, password, firstName: firstName || "", lastName: lastName || "",
    email: email || "", phone: phone || "", role: role || "Designer",
    license: license || "Standard", team: team || "", jobFunction: jobFunction || "",
    active: true, createdAt: new Date().toISOString()
  };
  users.push(user);
  saveUsers(users);
  res.json({ ...user, password: undefined });
});

app.patch("/api/users/:id", (req, res) => {
  const users = loadUsers();
  const idx = users.findIndex(u => u.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "User not found" });
  const allowed = ["firstName", "lastName", "email", "phone", "role", "license", "team", "jobFunction", "active", "password"];
  allowed.forEach(k => { if (req.body[k] !== undefined) users[idx][k] = req.body[k]; });
  saveUsers(users);
  res.json({ ...users[idx], password: undefined });
});

app.delete("/api/users/:id", (req, res) => {
  let users = loadUsers();
  users = users.filter(u => u.id !== req.params.id);
  saveUsers(users);
  res.json({ ok: true });
});

// ── Users & Licenses settings page ────────────────────────────────────────────
app.get("/settings/users", (req, res) => {
  const users = loadUsers();
  const activeCount = users.filter(u => u.active).length;
  const userRows = users.map(u => `
    <tr class="ut-row${u.id === req.user.id ? ' ut-you' : ''}${!u.active ? ' ut-inactive' : ''}">
      <td>
        <div class="ut-user">
          <div class="ut-avatar" style="background:${u.active ? '#7c3aed' : '#9ca3af'}">${esc(u.firstName[0] || '?')}${esc(u.lastName[0] || '')}</div>
          <div>
            <div class="ut-name">${esc(u.firstName)} ${esc(u.lastName)}${u.id === req.user.id ? ' <span class="ut-you-badge">You</span>' : ''}</div>
            <div class="ut-email">${esc(u.email)}</div>
          </div>
        </div>
      </td>
      <td>${esc(u.username)}</td>
      <td>${esc(u.role)}</td>
      <td>${esc(u.team || '\u2014')}</td>
      <td><span class="ut-license ut-license-${u.license.toLowerCase()}">${esc(u.license)}</span></td>
      <td><span class="ut-status ut-status-${u.active ? 'active' : 'inactive'}">${u.active ? 'Active' : 'Inactive'}</span></td>
      <td>
        <button class="ut-action-btn" onclick="editUser('${u.id}')" title="Edit">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
      </td>
    </tr>`).join("");

  res.send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Users &amp; Licenses \u2014 Solar CRM</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fff;color:#111;display:flex;height:100vh;overflow:hidden}
  .rail{width:52px;background:#1a0828;display:flex;flex-direction:column;align-items:center;padding:14px 0;gap:6px;flex-shrink:0}
  .rail-logo{width:32px;height:32px;background:linear-gradient(135deg,#c084fc,#818cf8);border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:10px;flex-shrink:0}
  .rail-btn{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#7c5fa0;transition:all 0.15s;border:none;background:none;text-decoration:none}
  .rail-btn:hover,.rail-btn.active{background:#2d1045;color:#e2d4f0}
  .settings-shell{flex:1;display:flex;overflow:hidden}
  .settings-sidebar{width:210px;flex-shrink:0;border-right:1px solid #e5e7eb;overflow-y:auto;padding:20px 0;background:#fafafa}
  .sidebar-group{padding:0 12px;margin-bottom:4px}
  .sidebar-group+.sidebar-group{margin-top:4px;padding-top:12px;border-top:1px solid #e5e7eb}
  .sidebar-section-label{font-size:0.68rem;font-weight:700;color:#b0b7c3;text-transform:uppercase;letter-spacing:0.6px;padding:0 4px 6px}
  .sidebar-item{display:block;padding:6px 8px;font-size:0.84rem;color:#4b5563;text-decoration:none;border-radius:6px;transition:background 0.1s,color 0.1s;margin-bottom:1px}
  .sidebar-item:hover{background:#ede9f6;color:#1a0828}
  .sidebar-item.active{background:#ede9f6;color:#1a0828;font-weight:600;position:relative}
  .sidebar-item.active::before{content:'';position:absolute;left:-12px;top:6px;bottom:6px;width:3px;background:#7c3aed;border-radius:0 2px 2px 0}
  .settings-main{flex:1;overflow-y:auto;padding:32px 40px}
  .settings-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}
  .settings-header h1{font-size:1.6rem;font-weight:700;color:#111}
  .btn-add{display:inline-flex;align-items:center;gap:7px;padding:8px 18px;background:#7c3aed;color:#fff;border-radius:8px;font-size:0.85rem;font-weight:600;border:none;cursor:pointer;transition:background 0.15s}
  .btn-add:hover{background:#6d28d9}
  .ut-summary{display:flex;gap:24px;margin-bottom:24px}
  .ut-stat{background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:14px 20px;min-width:140px}
  .ut-stat-val{font-size:1.5rem;font-weight:700;color:#111}
  .ut-stat-label{font-size:0.75rem;color:#6b7280;margin-top:2px}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;padding:10px 12px;font-size:0.72rem;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.4px;border-bottom:2px solid #e5e7eb}
  td{padding:12px;border-bottom:1px solid #f3f4f6;font-size:0.88rem;color:#374151}
  .ut-row:hover{background:#f9fafb}
  .ut-row.ut-inactive{opacity:0.55}
  .ut-user{display:flex;align-items:center;gap:10px}
  .ut-avatar{width:32px;height:32px;border-radius:50%;color:#fff;font-size:0.72rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .ut-name{font-weight:600;color:#111;font-size:0.88rem}
  .ut-email{font-size:0.75rem;color:#6b7280}
  .ut-you-badge{display:inline-block;background:#ede9f6;color:#7c3aed;font-size:0.65rem;font-weight:700;padding:1px 6px;border-radius:4px;margin-left:4px;vertical-align:middle}
  .ut-license{display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600}
  .ut-license-premium{background:#fef3c7;color:#92400e}
  .ut-license-standard{background:#e0e7ff;color:#3730a3}
  .ut-status{display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.75rem;font-weight:600}
  .ut-status-active{background:#d1fae5;color:#065f46}
  .ut-status-inactive{background:#fee2e2;color:#991b1b}
  .ut-action-btn{background:none;border:1px solid #d1d5db;border-radius:6px;padding:5px 7px;cursor:pointer;color:#6b7280;transition:all 0.15s}
  .ut-action-btn:hover{border-color:#7c3aed;color:#7c3aed;background:#f5f3ff}
  .modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center}
  .modal-overlay.open{display:flex}
  .modal{background:#fff;border-radius:14px;padding:28px 32px;width:440px;box-shadow:0 20px 60px rgba(0,0,0,0.2)}
  .modal h2{font-size:1.15rem;font-weight:700;margin-bottom:20px}
  .modal label{display:block;font-size:0.78rem;font-weight:600;color:#374151;margin-bottom:3px}
  .modal input,.modal select{width:100%;padding:8px 10px;border:1.5px solid #d1d5db;border-radius:7px;font-size:0.88rem;outline:none;margin-bottom:12px;transition:border-color 0.15s}
  .modal input:focus,.modal select:focus{border-color:#7c3aed}
  .modal-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
  .modal-actions button{padding:8px 18px;border-radius:7px;font-size:0.85rem;font-weight:600;cursor:pointer;border:none;transition:background 0.15s}
  .btn-cancel{background:#f3f4f6;color:#374151}.btn-cancel:hover{background:#e5e7eb}
  .btn-save{background:#7c3aed;color:#fff}.btn-save:hover{background:#6d28d9}
</style>
</head><body>
  <nav class="rail">
    <div class="rail-logo" onclick="location.href='/'" style="cursor:pointer"><svg width="18" height="18" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg></div>
    <a class="rail-btn" href="/" title="Projects"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></a>
    <a class="rail-btn" href="/database" title="Database"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg></a>
    <a class="rail-btn active" href="/settings" title="Settings" ><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></a>
    <a class="rail-btn" href="/partners" title="Partners"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></a>
  </nav>
  <div class="settings-shell">
    <aside class="settings-sidebar">
      <div class="sidebar-group"><div class="sidebar-section-label">Account</div>
        <a class="sidebar-item" href="/settings">User profile</a>
        <a class="sidebar-item" href="/settings">Organization profile</a>
        <a class="sidebar-item" href="/settings">Apps</a>
      </div>
      <div class="sidebar-group"><div class="sidebar-section-label">User management</div>
        <a class="sidebar-item active" href="/settings/users">Users and licenses</a>
        <a class="sidebar-item" href="/settings/roles">Roles</a>
        <a class="sidebar-item" href="/settings/teams">Teams</a>
      </div>
      <div class="sidebar-group"><div class="sidebar-section-label">Pricing &amp; financing</div>
        <a class="sidebar-item" href="/settings">Pricing defaults</a>
        <a class="sidebar-item" href="/settings">Financing</a>
        <a class="sidebar-item" href="/settings">Utility and tax rates</a>
      </div>
      <div class="sidebar-group"><div class="sidebar-section-label">Projects and designs</div>
        <a class="sidebar-item" href="/settings">Statuses and warnings</a>
        <a class="sidebar-item" href="/settings">Design</a>
        <a class="sidebar-item" href="/settings">Financing integrations</a>
        <a class="sidebar-item" href="/settings">Performance simulations</a>
      </div>
      <div class="sidebar-group"><div class="sidebar-section-label">API</div>
        <a class="sidebar-item" href="/settings">API tokens</a>
        <a class="sidebar-item" href="/settings">Webhooks</a>
      </div>
      <div class="sidebar-group"><div class="sidebar-section-label">Plan sets</div>
        <a class="sidebar-item" href="/settings">Contractor profiles</a>
      </div>
    </aside>
    <main class="settings-main">
      <div class="settings-header">
        <h1>Users and licenses</h1>
        <button class="btn-add" onclick="openModal()"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add user</button>
      </div>
      <div class="ut-summary">
        <div class="ut-stat"><div class="ut-stat-val">${users.length}</div><div class="ut-stat-label">Total users</div></div>
        <div class="ut-stat"><div class="ut-stat-val">${activeCount}</div><div class="ut-stat-label">Active</div></div>
        <div class="ut-stat"><div class="ut-stat-val">${users.length - activeCount}</div><div class="ut-stat-label">Inactive</div></div>
      </div>
      <table><thead><tr><th>User</th><th>Username</th><th>Role</th><th>Team</th><th>License</th><th>Status</th><th></th></tr></thead>
      <tbody>${userRows}</tbody></table>
    </main>
  </div>

  <div class="modal-overlay" id="userModal">
    <div class="modal">
      <h2 id="modalTitle">Add user</h2>
      <input type="hidden" id="editUserId"/>
      <div class="modal-row"><div><label>First name</label><input id="mFirstName"/></div><div><label>Last name</label><input id="mLastName"/></div></div>
      <div class="modal-row"><div><label>Username</label><input id="mUsername"/></div><div><label>Password</label><input id="mPassword" type="password"/></div></div>
      <label>Email</label><input id="mEmail" type="email"/>
      <label>Phone</label><input id="mPhone"/>
      <div class="modal-row">
        <div><label>Role</label><select id="mRole"><option>Admin</option><option>Designer</option><option>Sales Rep</option><option>Installer</option></select></div>
        <div><label>License</label><select id="mLicense"><option>Premium</option><option>Standard</option></select></div>
      </div>
      <div class="modal-row">
        <div><label>Team</label><select id="mTeam"><option value="">None</option><option>Team Sunshine</option><option>Team Alpha</option><option>Team Beta</option></select></div>
        <div><label>Job function</label><input id="mJobFunction"/></div>
      </div>
      <div class="modal-actions">
        <button class="btn-cancel" onclick="closeModal()">Cancel</button>
        <button class="btn-save" onclick="saveUser()">Save</button>
      </div>
    </div>
  </div>

  <script>
  var currentUsers = ${JSON.stringify(users.map(u => ({ ...u, password: undefined })))};
  function openModal() {
    document.getElementById('editUserId').value = '';
    document.getElementById('modalTitle').textContent = 'Add user';
    ['mFirstName','mLastName','mUsername','mPassword','mEmail','mPhone','mJobFunction'].forEach(function(id){ document.getElementById(id).value = ''; });
    document.getElementById('mRole').value = 'Designer';
    document.getElementById('mLicense').value = 'Standard';
    document.getElementById('mTeam').value = '';
    document.getElementById('mUsername').disabled = false;
    document.getElementById('userModal').classList.add('open');
  }
  function editUser(id) {
    var u = currentUsers.find(function(x){ return x.id === id; });
    if (!u) return;
    document.getElementById('editUserId').value = u.id;
    document.getElementById('modalTitle').textContent = 'Edit user';
    document.getElementById('mFirstName').value = u.firstName;
    document.getElementById('mLastName').value = u.lastName;
    document.getElementById('mUsername').value = u.username;
    document.getElementById('mUsername').disabled = true;
    document.getElementById('mPassword').value = '';
    document.getElementById('mEmail').value = u.email;
    document.getElementById('mPhone').value = u.phone || '';
    document.getElementById('mRole').value = u.role;
    document.getElementById('mLicense').value = u.license;
    document.getElementById('mTeam').value = u.team || '';
    document.getElementById('mJobFunction').value = u.jobFunction || '';
    document.getElementById('userModal').classList.add('open');
  }
  function closeModal() { document.getElementById('userModal').classList.remove('open'); }
  function saveUser() {
    var editId = document.getElementById('editUserId').value;
    var body = { firstName: document.getElementById('mFirstName').value, lastName: document.getElementById('mLastName').value, email: document.getElementById('mEmail').value, phone: document.getElementById('mPhone').value, role: document.getElementById('mRole').value, license: document.getElementById('mLicense').value, team: document.getElementById('mTeam').value, jobFunction: document.getElementById('mJobFunction').value };
    var pw = document.getElementById('mPassword').value;
    if (editId) {
      if (pw) body.password = pw;
      fetch('/api/users/' + editId, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function(){ location.reload(); });
    } else {
      body.username = document.getElementById('mUsername').value;
      body.password = pw || 'password';
      fetch('/api/users', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function(r){ if(!r.ok) return r.json().then(function(d){ alert(d.error); }); location.reload(); });
    }
  }
  document.getElementById('userModal').addEventListener('click', function(e){ if(e.target===this) closeModal(); });
  </script>
</body></html>`);
});

// ── Teams page ───────────────────────────────────────────────────────────────
app.get("/settings/teams", (req, res) => {
  const users = loadUsers();
  // Build teams from user data
  const teamMap = {};
  users.forEach(u => {
    const t = u.team || "Unassigned";
    if (!teamMap[t]) teamMap[t] = { name: t, count: 0, org: u.organization || "Team Sunshine" };
    teamMap[t].count++;
  });
  const teams = Object.values(teamMap).filter(t => t.name !== "Unassigned").sort((a, b) => a.name.localeCompare(b.name));
  const teamRows = teams.map(t => `
    <tr class="tm-row">
      <td style="font-weight:500">${esc(t.name)}</td>
      <td>${t.count}</td>
      <td>\u2014 (${esc(t.org)})</td>
    </tr>`).join("");

  res.send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Teams \u2014 Solar CRM</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fff;color:#111;display:flex;height:100vh;overflow:hidden}
  .rail{width:52px;background:#1a0828;display:flex;flex-direction:column;align-items:center;padding:14px 0;gap:6px;flex-shrink:0}
  .rail-logo{width:32px;height:32px;background:linear-gradient(135deg,#c084fc,#818cf8);border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:10px;flex-shrink:0}
  .rail-btn{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#7c5fa0;transition:all 0.15s;border:none;background:none;text-decoration:none}
  .rail-btn:hover,.rail-btn.active{background:#2d1045;color:#e2d4f0}
  .settings-shell{flex:1;display:flex;overflow:hidden}
  .settings-sidebar{width:210px;flex-shrink:0;border-right:1px solid #e5e7eb;overflow-y:auto;padding:20px 0;background:#fafafa}
  .sidebar-group{padding:0 12px;margin-bottom:4px}
  .sidebar-group+.sidebar-group{margin-top:4px;padding-top:12px;border-top:1px solid #e5e7eb}
  .sidebar-section-label{font-size:0.68rem;font-weight:700;color:#b0b7c3;text-transform:uppercase;letter-spacing:0.6px;padding:0 4px 6px}
  .sidebar-item{display:block;padding:6px 8px;font-size:0.84rem;color:#4b5563;text-decoration:none;border-radius:6px;transition:background 0.1s,color 0.1s;margin-bottom:1px}
  .sidebar-item:hover{background:#ede9f6;color:#1a0828}
  .sidebar-item.active{background:#ede9f6;color:#1a0828;font-weight:600;position:relative}
  .sidebar-item.active::before{content:'';position:absolute;left:-12px;top:6px;bottom:6px;width:3px;background:#7c3aed;border-radius:0 2px 2px 0}
  .settings-main{flex:1;overflow-y:auto;padding:32px 40px}
  .settings-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px}
  .settings-header h1{font-size:1.6rem;font-weight:700;color:#111}
  .btn-add{display:inline-flex;align-items:center;gap:7px;padding:8px 18px;background:#7c3aed;color:#fff;border-radius:8px;font-size:0.85rem;font-weight:600;border:none;cursor:pointer;transition:background 0.15s}
  .btn-add:hover{background:#6d28d9}
  .tm-search{display:flex;align-items:center;gap:12px;margin-bottom:24px}
  .tm-search-input{display:flex;align-items:center;gap:8px;background:#f3f4f6;border-radius:8px;padding:8px 14px;width:300px}
  .tm-search-input input{border:none;background:none;outline:none;font-size:0.88rem;width:100%;color:#111}
  .tm-filter-btn{background:none;border:none;cursor:pointer;color:#6b7280;padding:4px}
  .tm-filter-btn:hover{color:#111}
  table{width:100%;border-collapse:collapse}
  th{text-align:left;padding:10px 12px;font-size:0.72rem;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:0.4px;border-bottom:2px solid #e5e7eb;cursor:pointer}
  th:hover{color:#111}
  td{padding:12px;border-bottom:1px solid #f3f4f6;font-size:0.88rem;color:#374151}
  .tm-row:hover{background:#f9fafb}
  .modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.4);z-index:1000;align-items:center;justify-content:center}
  .modal-overlay.open{display:flex}
  .modal{background:#fff;border-radius:14px;padding:28px 32px;width:440px;box-shadow:0 20px 60px rgba(0,0,0,0.2)}
  .modal h2{font-size:1.15rem;font-weight:700;margin-bottom:20px}
  .modal label{display:block;font-size:0.78rem;font-weight:600;color:#374151;margin-bottom:3px}
  .modal input{width:100%;padding:8px 10px;border:1.5px solid #d1d5db;border-radius:7px;font-size:0.88rem;outline:none;margin-bottom:12px;transition:border-color 0.15s}
  .modal input:focus{border-color:#7c3aed}
  .modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}
  .modal-actions button{padding:8px 18px;border-radius:7px;font-size:0.85rem;font-weight:600;cursor:pointer;border:none;transition:background 0.15s}
  .btn-cancel{background:#f3f4f6;color:#374151}.btn-cancel:hover{background:#e5e7eb}
  .btn-save{background:#7c3aed;color:#fff}.btn-save:hover{background:#6d28d9}
</style>
</head><body>
  <nav class="rail">
    <div class="rail-logo" onclick="location.href='/'" style="cursor:pointer"><svg width="18" height="18" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg></div>
    <a class="rail-btn" href="/" title="Projects"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></a>
    <a class="rail-btn" href="/database" title="Database"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg></a>
    <a class="rail-btn active" href="/settings" title="Settings"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></a>
    <a class="rail-btn" href="/partners" title="Partners"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></a>
  </nav>
  <div class="settings-shell">
    <aside class="settings-sidebar">
      <div class="sidebar-group"><div class="sidebar-section-label">Account</div>
        <a class="sidebar-item" href="/settings">User profile</a>
        <a class="sidebar-item" href="/settings">Organization profile</a>
        <a class="sidebar-item" href="/settings">Apps</a>
      </div>
      <div class="sidebar-group"><div class="sidebar-section-label">User management</div>
        <a class="sidebar-item" href="/settings/users">Users and licenses</a>
        <a class="sidebar-item" href="/settings/roles">Roles</a>
        <a class="sidebar-item active" href="/settings/teams">Teams</a>
      </div>
      <div class="sidebar-group"><div class="sidebar-section-label">Pricing &amp; financing</div>
        <a class="sidebar-item" href="/settings">Pricing defaults</a>
        <a class="sidebar-item" href="/settings">Financing</a>
        <a class="sidebar-item" href="/settings">Utility and tax rates</a>
      </div>
      <div class="sidebar-group"><div class="sidebar-section-label">Projects and designs</div>
        <a class="sidebar-item" href="/settings">Statuses and warnings</a>
        <a class="sidebar-item" href="/settings">Design</a>
        <a class="sidebar-item" href="/settings">Financing integrations</a>
        <a class="sidebar-item" href="/settings">Performance simulations</a>
      </div>
      <div class="sidebar-group"><div class="sidebar-section-label">API</div>
        <a class="sidebar-item" href="/settings">API tokens</a>
        <a class="sidebar-item" href="/settings">Webhooks</a>
      </div>
      <div class="sidebar-group"><div class="sidebar-section-label">Plan sets</div>
        <a class="sidebar-item" href="/settings">Contractor profiles</a>
      </div>
    </aside>
    <main class="settings-main">
      <div class="settings-header">
        <h1>Teams</h1>
        <button class="btn-add" onclick="openTeamModal()"><svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add team</button>
      </div>
      <div class="tm-search">
        <div class="tm-search-input">
          <svg width="15" height="15" fill="none" stroke="#9ca3af" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" placeholder="Search" id="teamSearch" oninput="filterTeams()"/>
        </div>
        <button class="tm-filter-btn" title="Filter">
          <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polygon points="22,3 2,3 10,12.46 10,19 14,21 14,12.46"/></svg>
        </button>
      </div>
      <table>
        <thead><tr><th>Name \u2191</th><th>Users</th><th>Organization</th></tr></thead>
        <tbody id="teamTableBody">${teamRows}</tbody>
      </table>
    </main>
  </div>

  <div class="modal-overlay" id="teamModal">
    <div class="modal">
      <h2>Add team</h2>
      <label>Team name</label>
      <input id="mTeamName" placeholder="Enter team name"/>
      <label>Organization</label>
      <input id="mTeamOrg" value="Team Sunshine"/>
      <div class="modal-actions">
        <button class="btn-cancel" onclick="closeTeamModal()">Cancel</button>
        <button class="btn-save" onclick="saveTeam()">Save</button>
      </div>
    </div>
  </div>

  <script>
  function openTeamModal(){document.getElementById('teamModal').classList.add('open');document.getElementById('mTeamName').value='';document.getElementById('mTeamName').focus();}
  function closeTeamModal(){document.getElementById('teamModal').classList.remove('open');}
  document.getElementById('teamModal').addEventListener('click',function(e){if(e.target===this)closeTeamModal();});
  function saveTeam(){
    var name=document.getElementById('mTeamName').value.trim();
    if(!name){alert('Team name is required');return;}
    // For now just add to the table client-side
    var tbody=document.getElementById('teamTableBody');
    var org=document.getElementById('mTeamOrg').value.trim()||'Team Sunshine';
    var tr=document.createElement('tr');tr.className='tm-row';
    tr.innerHTML='<td style="font-weight:500">'+name+'</td><td>0</td><td>\\u2014 ('+org+')</td>';
    tbody.appendChild(tr);closeTeamModal();
  }
  function filterTeams(){
    var q=document.getElementById('teamSearch').value.toLowerCase();
    var rows=document.querySelectorAll('.tm-row');
    rows.forEach(function(r){r.style.display=r.textContent.toLowerCase().indexOf(q)>=0?'':'none';});
  }
  </script>
</body></html>`);
});

// ── Database page ─────────────────────────────────────────────────────────────
app.get("/database", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Database — Solar CRM</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { height: 100%; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #fff; color: #111;
      display: flex; height: 100vh; overflow: hidden;
    }
    .rail{width:52px;background:#1a0828;display:flex;flex-direction:column;align-items:center;padding:14px 0;gap:6px;flex-shrink:0}
    .rail-logo{width:32px;height:32px;background:linear-gradient(135deg,#c084fc,#818cf8);border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:10px;flex-shrink:0}
    .rail-btn{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#7c5fa0;transition:all 0.15s;border:none;background:none;text-decoration:none}
    .rail-btn:hover,.rail-btn.active{background:#2d1045;color:#e2d4f0}

    .db-topbar {
      height: 48px; display: flex; align-items: center; justify-content: center;
      border-bottom: 1px solid #e5e7eb; padding: 0 20px; flex-shrink: 0;
      font-size: 0.9rem; font-weight: 600; color: #111; position: relative;
    }
    .db-topbar-right {
      position: absolute; right: 20px; display: flex; align-items: center; gap: 14px;
    }
    .db-topbar-icon {
      width: 32px; height: 32px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
      cursor: pointer; color: #6b7280; transition: background 0.15s;
    }
    .db-topbar-icon:hover { background: #f3f4f6; }
    .db-topbar-avatar {
      width: 30px; height: 30px; border-radius: 50%; background: #7c3aed;
      color: #fff; font-size: 0.7rem; font-weight: 700;
      display: flex; align-items: center; justify-content: center; cursor: pointer;
    }

    .db-shell { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .db-body { flex: 1; display: flex; overflow: hidden; }

    .db-sidebar {
      width: 185px; flex-shrink: 0; border-right: 1px solid #e5e7eb;
      overflow-y: auto; padding: 16px 0; background: #fafafa;
      display: flex; flex-direction: column;
    }
    .db-sidebar-toggle {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0 14px 14px; border-bottom: 1px solid #e5e7eb; margin-bottom: 6px;
    }
    .db-sidebar-toggle-label { font-size: 0.72rem; color: #6b7280; line-height: 1.3; }
    .db-toggle {
      width: 36px; height: 20px; background: #7c3aed; border-radius: 10px;
      position: relative; cursor: pointer; border: none; flex-shrink: 0;
    }
    .db-toggle::after {
      content: ''; position: absolute; top: 2px; left: 18px;
      width: 16px; height: 16px; border-radius: 50%; background: #fff;
      transition: left 0.15s;
    }
    .db-sidebar-group { padding: 0 10px; margin-bottom: 2px; }
    .db-sidebar-group + .db-sidebar-group {
      margin-top: 2px; padding-top: 10px; border-top: 1px solid #e5e7eb;
    }
    .db-sidebar-section {
      font-size: 0.65rem; font-weight: 700; color: #b0b7c3;
      text-transform: uppercase; letter-spacing: 0.6px; padding: 0 6px 5px;
    }
    .db-sidebar-item {
      display: block; padding: 5px 8px; font-size: 0.82rem; color: #4b5563;
      text-decoration: none; border-radius: 6px; cursor: pointer;
      transition: background 0.1s, color 0.1s; margin-bottom: 1px;
    }
    .db-sidebar-item:hover { background: #ede9f6; color: #1a0828; }
    .db-sidebar-item.active {
      background: #ede9f6; color: #1a0828; font-weight: 600; position: relative;
    }
    .db-sidebar-item.active::before {
      content: ''; position: absolute; left: -10px; top: 5px; bottom: 5px;
      width: 3px; background: #7c3aed; border-radius: 0 2px 2px 0;
    }
    .db-sidebar-footer {
      padding: 12px 16px; border-top: 1px solid #e5e7eb; margin-top: auto;
    }
    .db-sidebar-footer a { font-size: 0.8rem; color: #6b7280; text-decoration: none; }
    .db-sidebar-footer a:hover { color: #7c3aed; }

    .db-main { flex: 1; overflow-y: auto; padding: 28px 36px; }
    .db-main-header {
      display: flex; align-items: center; justify-content: space-between; margin-bottom: 22px;
    }
    .db-main-header h1 { font-size: 1.5rem; font-weight: 700; }
    .btn-request {
      padding: 9px 18px; background: #111; color: #fff; border: none;
      border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer;
    }
    .btn-request:hover { background: #333; }

    .db-search { width: 280px; padding: 9px 12px 9px 34px; border: 1.5px solid #e5e7eb; border-radius: 8px; font-size: 0.85rem; background: #fafafa; outline: none; }
    .db-search:focus { border-color: #7c3aed; background: #fff; }
    .db-search-wrap { position: relative; margin-bottom: 18px; }
    .db-search-wrap svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: #9ca3af; pointer-events: none; }

    .db-tabs { display: flex; gap: 0; border-bottom: 1px solid #e5e7eb; margin-bottom: 18px; }
    .db-tab {
      padding: 10px 18px; font-size: 0.85rem; color: #6b7280; cursor: pointer;
      border: none; background: none; font-weight: 500;
      border-bottom: 2px solid transparent; transition: all 0.15s;
    }
    .db-tab:hover { color: #111; }
    .db-tab.active { color: #111; font-weight: 700; border-bottom-color: #111; }

    .db-empty { text-align: center; padding: 60px 20px; color: #9ca3af; }
    .db-empty svg { margin-bottom: 12px; }
    .db-empty-title { font-size: 1rem; font-weight: 600; color: #6b7280; margin-bottom: 4px; }
    .db-empty-sub { font-size: 0.85rem; }
  </style>
</head>
<body>
  <nav class="rail">
    <div class="rail-logo" onclick="location.href='/'" style="cursor:pointer"><svg width="18" height="18" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg></div>
    <a class="rail-btn" href="/" title="Projects"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></a>
    <a class="rail-btn active" href="/database" title="Database"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg></a>
    <a class="rail-btn" href="/settings" title="Settings"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></a>
    <a class="rail-btn" href="/partners" title="Partners"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></a>
  </nav>

  <div class="db-shell">
    <div class="db-topbar">
      Database
      <div class="db-topbar-right">
        <div class="db-topbar-icon"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></div>
        <div class="db-topbar-icon"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg></div>
        <div class="db-topbar-avatar">AB</div>
      </div>
    </div>

    <div class="db-body">
      <aside class="db-sidebar">
        <div class="db-sidebar-toggle">
          <div class="db-sidebar-toggle-label">Specify component<br/>availability</div>
          <button class="db-toggle"></button>
        </div>
        <div class="db-sidebar-group">
          <div class="db-sidebar-section">Components</div>
          <a class="db-sidebar-item active">Modules</a>
          <a class="db-sidebar-item">Inverters</a>
          <a class="db-sidebar-item">DC optimizers</a>
          <a class="db-sidebar-item">Combiner boxes</a>
          <a class="db-sidebar-item">Load centers</a>
          <a class="db-sidebar-item">Disconnects</a>
          <a class="db-sidebar-item">Service panels</a>
          <a class="db-sidebar-item">Meters</a>
          <a class="db-sidebar-item">Batteries</a>
          <a class="db-sidebar-item">Energy optimizations</a>
        </div>
        <div class="db-sidebar-group">
          <div class="db-sidebar-section">Quoting</div>
          <a class="db-sidebar-item">Proposal templates</a>
          <a class="db-sidebar-item">Adders &amp; discounts</a>
          <a class="db-sidebar-item">Financing products</a>
          <a class="db-sidebar-item">Incentives</a>
          <a class="db-sidebar-item">Utility rates</a>
          <a class="db-sidebar-item">Agreement templates</a>
          <a class="db-sidebar-item">Legacy agreement templates</a>
        </div>
        <div class="db-sidebar-group">
          <div class="db-sidebar-section">Operations</div>
          <a class="db-sidebar-item">Jurisdictions</a>
          <a class="db-sidebar-item">Suppliers</a>
          <a class="db-sidebar-item">Manufacturers</a>
          <a class="db-sidebar-item">AHJ</a>
        </div>
        <div class="db-sidebar-footer"><a href="#">Contact support</a></div>
      </aside>

      <main class="db-main">
        <div class="db-main-header">
          <h1>Modules</h1>
          <button class="btn-request">Request custom component</button>
        </div>
        <div class="db-search-wrap">
          <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="db-search" type="text" placeholder="Search"/>
        </div>
        <div class="db-tabs">
          <button class="db-tab active">All Modules</button>
          <button class="db-tab">Enabled Modules</button>
        </div>
        <div class="db-empty">
          <svg width="48" height="48" fill="none" stroke="#d1d5db" stroke-width="1.5" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg>
          <div class="db-empty-title">No modules yet</div>
          <div class="db-empty-sub">Components will appear here once added.</div>
        </div>
      </main>
    </div>
  </div>
</body>
</html>`);
});

// ── Roles settings page ──────────────────────────────────────────────────────
app.get("/settings/roles", (req, res) => {
  const ck = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" fill="#2d9d8f"/><path d="M8 12l3 3 5-5" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const dash = `<span style="color:#9ca3af;font-weight:600;">&mdash;</span>`;
  res.send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Roles &mdash; Solar CRM</title>
<style>
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fff;color:#111;display:flex;height:100vh;overflow:hidden}
  .rail{width:52px;background:#1a0828;display:flex;flex-direction:column;align-items:center;padding:14px 0;gap:6px;flex-shrink:0}
  .rail-logo{width:32px;height:32px;background:linear-gradient(135deg,#c084fc,#818cf8);border-radius:8px;display:flex;align-items:center;justify-content:center;margin-bottom:10px;flex-shrink:0}
  .rail-btn{width:36px;height:36px;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#7c5fa0;transition:all 0.15s;border:none;background:none;text-decoration:none}
  .rail-btn:hover,.rail-btn.active{background:#2d1045;color:#e2d4f0}
  .roles-shell{flex:1;display:flex;flex-direction:column;overflow:hidden}
  .roles-topbar{height:48px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #e5e7eb;padding:0 40px;flex-shrink:0}
  .roles-topbar-left{display:flex;align-items:center;gap:10px;font-size:0.9rem;font-weight:600}
  .roles-topbar-left a{color:#6b7280;text-decoration:none;display:flex;align-items:center}
  .roles-topbar-left a:hover{color:#111}
  .roles-topbar-right{font-size:0.9rem;font-weight:600;color:#111}
  .roles-main{flex:1;overflow-y:auto;padding:32px 60px 60px}
  .role-title{display:flex;align-items:center;gap:12px;margin-bottom:32px}
  .role-title h1{font-size:1.6rem;font-weight:700}
  .role-badge{font-size:0.72rem;font-weight:600;border:1.5px solid #d1d5db;border-radius:4px;padding:2px 8px;color:#6b7280}
  .perm-section-title{display:flex;align-items:center;gap:8px;font-size:0.95rem;font-weight:700;margin-bottom:20px}
  .perm-group{margin-bottom:8px;border-bottom:1px solid #e5e7eb;padding-bottom:16px}
  .perm-group:last-child{border-bottom:none}
  .perm-group-header{display:flex;align-items:center;gap:6px;font-size:0.95rem;font-weight:700;cursor:default;padding:12px 0}
  .perm-group-header svg{flex-shrink:0}
  .pt-table{width:100%;border-collapse:collapse;margin-bottom:4px}
  .pt-table th{text-align:left;padding:8px 12px;font-size:0.78rem;font-weight:600;color:#6b7280;background:#f9fafb;border-bottom:1px solid #e5e7eb}
  .pt-table th.cc{text-align:center;width:90px}
  .pt-table td{padding:12px;border-bottom:1px solid #f3f4f6;vertical-align:top}
  .pt-table td.cc{text-align:center;vertical-align:middle}
  .pt{font-weight:700;font-size:0.88rem;color:#111}
  .pd{font-size:0.8rem;color:#6b7280;margin-top:2px;max-width:440px;line-height:1.4}
  .pl{color:#2d9d8f;text-decoration:none;font-weight:500}
  .pl:hover{text-decoration:underline}
  .ps{padding-left:28px}
  .perm-kv{display:flex;align-items:baseline;gap:24px;margin-bottom:6px}
  .perm-kv-label{font-weight:700;font-size:0.88rem}
  .perm-kv-val{font-size:0.88rem}
  .perm-kv-desc{font-size:0.8rem;color:#6b7280;margin-bottom:12px}
</style>
</head><body>
  <nav class="rail">
    <div class="rail-logo"><svg width="18" height="18" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg></div>
    <a class="rail-btn" href="/" title="Projects"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></a>
    <a class="rail-btn" href="/database" title="Database"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg></a>
    <a class="rail-btn active" href="/settings" title="Settings"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></a>
    <a class="rail-btn" href="/partners" title="Partners"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></a>
  </nav>

  <div class="roles-shell">
    <div class="roles-topbar">
      <div class="roles-topbar-left">
        <a href="/settings"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg></a>
        Roles
      </div>
      <div class="roles-topbar-right">Admin</div>
    </div>
    <div class="roles-main">

      <div class="role-title">
        <h1>Admin</h1>
        <span class="role-badge">Default</span>
        <svg width="16" height="16" fill="none" stroke="#9ca3af" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
      </div>

      <div class="perm-section-title">
        <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
        Permissions
      </div>

      <div class="perm-kv"><span class="perm-kv-label">Project access level</span><span class="perm-kv-val">All-access</span></div>
      <div class="perm-kv-desc">Determines how users in this role can access projects in their teams and organizations.</div>

      <table class="pt-table" style="margin-bottom:16px;">
        <thead><tr><th>All-access</th><th class="cc">All partners</th><th class="cc">Tenant</th></tr></thead>
        <tbody><tr><td>Users in this role have access to projects in...</td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr></tbody>
      </table>

      <!-- Services -->
      <div class="perm-group">
        <div class="perm-group-header">Services <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg></div>
        <table class="pt-table">
          <thead><tr><th>Feature access</th><th class="cc">Enabled</th></tr></thead>
          <tbody><tr><td><div class="pt">EagleView Powered Models</div><div class="pd">Allow users in this role to request and accept EagleView Powered Models.</div></td><td class="cc">${ck}</td></tr></tbody>
        </table>
      </div>

      <!-- Project features and content -->
      <div class="perm-group">
        <div class="perm-group-header">Project features and content <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg></div>
        <table class="pt-table">
          <thead><tr><th>Project management</th><th class="cc">Create</th><th class="cc">(re)Assign</th><th class="cc">Edit</th><th class="cc">View</th></tr></thead>
          <tbody><tr><td><div class="pt">Projects</div><div class="pd">Users in this role can edit <strong>all</strong> projects in teams and organizations.</div></td><td class="cc">${ck}</td><td class="cc">${ck}</td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr></tbody>
        </table>
        <table class="pt-table">
          <thead><tr><th>Content access</th><th class="cc">Edit</th><th class="cc">View</th></tr></thead>
          <tbody>
            <tr><td><div class="pt">Pricing</div><div class="pd">Users in this role can view and edit pricing data shown in projects, Design Mode, and Sales Mode.</div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td><div class="pt">Financing settings</div><div class="pd">Users in this role can view and edit financing settings in Design Mode and Sales Mode.</div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td><div class="pt">Design Mode</div><div class="pd">Users in this role can view and edit designs in Design Mode. Users with edit access can view all site models in a project.</div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td class="ps"><div class="pt">Site model</div><div class="pd">Users in this role can edit the site model in Design Mode.</div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td><div class="pt">Sales Mode site and system design</div><div class="pd">Users in this role can edit site and system designs in Sales Mode, including requesting an expert model, editing panels and ground mounts, toggling panels, and, if purchased, running Aurora AI.<br><br><span style="color:#6b7280">Users without edit access can still see and toggle the view layers of 3D designs in their proposal templates.</span></div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td><div class="pt">Utility rate adjustments</div><div class="pd">Users in this role can adjust utility rates in projects, Design Mode, and Sales Mode.</div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td><div class="pt">Energy usage</div><div class="pd">Users in this role can adjust energy usage in Sales Mode.</div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Database -->
      <div class="perm-group">
        <div class="perm-group-header">Database <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg></div>
        <table class="pt-table">
          <thead><tr><th>Page access in Database</th><th class="cc">Edit</th><th class="cc">View</th></tr></thead>
          <tbody>
            <tr><td><div class="pt">Components</div><div class="pd">Components pages, including: Modules, Inverters, DC optimizers, Combiner boxes, Load centers, Disconnects, Service panels, Meters, Batteries, and Energy optimizations.</div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td><div class="pt">Quoting</div><div class="pd">Quoting pages: Adders and discounts, Financing products, and Utility rates.</div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td><div class="pt">Proposal templates</div></td><td class="cc">${dash}</td><td class="cc">${dash}</td></tr>
            <tr><td class="ps"><div class="pt">Edit</div><div class="pd">Create and edit disabled proposal templates. (Only Account Admins can enable templates.)</div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td class="ps"><div class="pt">Set default</div><div class="pd">Set enabled templates as their organization's default proposal template.</div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td><div class="pt">Operations</div><div class="pd">Operations pages: Jurisdictions, Suppliers, Manufacturers, AHJ, and Utilities.</div></td><td class="cc">${dash}</td><td class="cc">${dash}</td></tr>
            <tr><td class="ps"><div class="pt">AHJ</div><div class="pd">Users in this role can view AHJ data. Only Admins can edit AHJs and request changes. View <a class="pl" href="/database">AHJ</a></div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td class="ps"><div class="pt">Utilities</div><div class="pd">Users in this role can view Utilities data. Only Admins can edit Utilities and request changes. View <a class="pl" href="/database">Utilities</a></div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
          </tbody>
        </table>
      </div>

      <!-- Settings -->
      <div class="perm-group">
        <div class="perm-group-header">Settings <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 15l-6-6-6 6"/></svg></div>
        <table class="pt-table">
          <thead><tr><th>Page access in Settings</th><th class="cc">Edit</th><th class="cc">View</th></tr></thead>
          <tbody>
            <tr><td><div class="pt">Account</div><div class="pd">Account pages: User profile, Organization profile, Billing, On-demand services, and Integrations.</div></td><td class="cc">${dash}</td><td class="cc">${dash}</td></tr>
            <tr><td class="ps"><div class="pt">User profile</div><div class="pd">All users have access to their own user profile. Only Admins can set the license type and role of another user. View <a class="pl" href="/settings">User profile</a></div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td class="ps"><div class="pt">Organization profile</div><div class="pd">Only users in an Admin role can view and edit their Organization profile. View <a class="pl" href="/settings">Organization profile</a></div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td><div class="pt">User management</div><div class="pd">User management pages: Users and licenses, Roles, and Teams.</div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td class="ps"><div class="pt">Users and licenses</div><div class="pd">Create and edit users. View <a class="pl" href="/settings/users">Users and licenses</a></div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td class="ps"><div class="pt">Roles</div><div class="pd">Create and edit user roles. View <a class="pl" href="/settings/roles">Roles</a></div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td class="ps"><div class="pt">Teams</div><div class="pd">Assign users to a team. View <a class="pl" href="/settings/teams">Teams</a></div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td><div class="pt">Documents</div><div class="pd">Documents pages: Sales agreements and PDF proposals pages.</div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td><div class="pt">Pricing &amp; financing</div><div class="pd">Pricing and financing pages: Pricing defaults, Utility and tax rates, Financing defaults, and Financing integrations.</div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td><div class="pt">Projects and designs</div><div class="pd">Project and designs pages: Status and warnings, Design defaults, Performance simulations, and Sales Mode customization.</div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td><div class="pt">API</div><div class="pd">API pages: API tokens and Webhooks.</div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
            <tr><td><div class="pt">Plan sets</div><div class="pd">Contractor profiles.</div></td><td class="cc">${ck}</td><td class="cc">${ck}</td></tr>
          </tbody>
        </table>
      </div>

    </div>
  </div>
</body></html>`);
});

// ── Partners ──────────────────────────────────────────────────────────────────
function loadPartners() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "data/partners.json"), "utf8")); }
  catch { return []; }
}
function savePartners(p) {
  fs.writeFileSync(path.join(__dirname, "data/partners.json"), JSON.stringify(p, null, 2));
}

const partnersRailHTML = `
  <nav class="rail">
    <div class="rail-logo" onclick="location.href='/'" style="cursor:pointer">
      <svg width="18" height="18" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
      </svg>
    </div>
    <a class="rail-btn" href="/" title="Projects">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
    </a>
    <a class="rail-btn" href="/database" title="Database">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/>
      </svg>
    </a>
    <a class="rail-btn" href="/settings" title="Settings">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/>
      </svg>
    </a>
    <a class="rail-btn active" href="/partners" title="Partners">
      <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
      </svg>
    </a>
  </nav>`;

app.get("/partners", (req, res) => {
  const partners = loadPartners();
  const rows = partners.map(p => {
    const d = new Date(p.lastUpdated);
    const fmt = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `<tr onclick="location.href='/partners/${p.id}'" style="cursor:pointer">
      <td>${esc(p.name)}</td><td>${p.users}</td><td>${p.teams}</td><td>${fmt}</td></tr>`;
  }).join("");

  res.send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>Partners — Solar CRM</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fff; color: #111; display: flex; height: 100vh; overflow: hidden; }
  .rail { width: 52px; background: #1a0828; display: flex; flex-direction: column; align-items: center; padding: 14px 0; gap: 6px; flex-shrink: 0; }
  .rail-logo { width: 32px; height: 32px; background: linear-gradient(135deg,#c084fc,#818cf8); border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-bottom: 10px; flex-shrink: 0; }
  .rail-btn { width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; cursor: pointer; color: #7c5fa0; transition: all 0.15s; border: none; background: none; text-decoration: none; }
  .rail-btn:hover, .rail-btn.active { background: #2d1045; color: #e2d4f0; }
  .content { flex: 1; overflow-y: auto; padding: 40px 50px; }
  h1 { font-size: 1.8rem; font-weight: 600; margin-bottom: 6px; }
  .subtitle { color: #6b7280; font-size: 0.9rem; margin-bottom: 24px; }
  .subtitle a { color: #4a90e2; text-decoration: none; }
  .subtitle a:hover { text-decoration: underline; }
  .top-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .search-box { position: relative; }
  .search-box input { width: 240px; padding: 8px 12px 8px 34px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.88rem; outline: none; }
  .search-box input:focus { border-color: #818cf8; box-shadow: 0 0 0 2px rgba(129,140,248,0.15); }
  .search-box svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: #9ca3af; }
  .btn-new-partner { display: inline-flex; align-items: center; gap: 6px; padding: 9px 18px; background: #111; color: #fff; border: none; border-radius: 6px; font-size: 0.88rem; font-weight: 500; cursor: pointer; text-decoration: none; }
  .btn-new-partner:hover { background: #333; }
  table { width: 100%; border-collapse: collapse; }
  thead th { text-align: left; font-size: 0.78rem; font-weight: 600; color: #6b7280; padding: 10px 16px; border-bottom: 1px solid #e5e7eb; }
  tbody tr { border-bottom: 1px solid #f3f4f6; transition: background 0.1s; }
  tbody tr:hover { background: #f9fafb; }
  tbody td { padding: 14px 16px; font-size: 0.9rem; }
</style>
</head><body>
${partnersRailHTML}
<div class="content">
  <h1>Partners</h1>
  <p class="subtitle">In partner organizations, you can manage users, settings, and databases. Learn more about partner management <a href="#">here</a>.</p>
  <div class="top-row">
    <div class="search-box">
      <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
      <input type="text" placeholder="Search" id="searchInput" oninput="filterTable()"/>
    </div>
    <a class="btn-new-partner" href="/partners/new">+ New partner</a>
  </div>
  <table>
    <thead><tr><th>Name</th><th>Users</th><th>Teams</th><th>Last updated</th></tr></thead>
    <tbody id="partnerBody">${rows}</tbody>
  </table>
</div>
<script>
function filterTable() {
  const q = document.getElementById('searchInput').value.toLowerCase();
  document.querySelectorAll('#partnerBody tr').forEach(r => {
    r.style.display = r.children[0].textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}
</script>
</body></html>`);
});

app.get("/partners/new", (req, res) => {
  const users = loadUsers();
  const userOpts = users.map(u => `<option value="${u.id}">${esc(u.firstName)} ${esc(u.lastName)}</option>`).join("");

  res.send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>New Partner — Solar CRM</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { height: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #fff; color: #111; }
  .topbar { display: flex; align-items: center; justify-content: space-between; padding: 10px 20px; border-bottom: 1px solid #e5e7eb; }
  .topbar-left { display: flex; align-items: center; gap: 10px; }
  .topbar-left a { color: #111; text-decoration: none; font-size: 0.9rem; font-weight: 500; display: flex; align-items: center; gap: 6px; }
  .topbar-center { font-size: 0.92rem; font-weight: 600; }
  .topbar-right { display: flex; align-items: center; gap: 12px; }
  .topbar-right .avatar { width: 30px; height: 30px; border-radius: 50%; background: #1a0828; color: #fff; display: flex; align-items: center; justify-content: center; font-size: 0.7rem; font-weight: 600; }
  .badge { position: relative; }
  .badge-count { position: absolute; top: -5px; right: -6px; background: #6366f1; color: #fff; font-size: 0.6rem; width: 16px; height: 16px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: 700; }

  .shell { display: flex; height: calc(100vh - 49px); }
  .wizard-sidebar { width: 220px; flex-shrink: 0; background: #f3f4f6; padding: 20px 0; overflow-y: auto; }
  .step { padding: 12px 20px; cursor: pointer; }
  .step.active { background: #d1d5db; }
  .step.completed { cursor: pointer; }
  .step-label { font-size: 0.72rem; color: #9ca3af; font-weight: 500; }
  .step.active .step-label { color: #6b7280; }
  .step-title { font-size: 0.88rem; font-weight: 600; color: #9ca3af; margin-top: 2px; }
  .step.active .step-title { color: #111; }
  .step.completed .step-title { color: #374151; }

  .wizard-main { flex: 1; overflow-y: auto; padding: 36px 50px; }
  .wizard-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .wizard-header h2 { font-size: 1.5rem; font-weight: 600; }
  .wizard-actions { display: flex; align-items: center; gap: 10px; }
  .btn-cancel { background: none; border: none; font-size: 0.88rem; color: #6b7280; cursor: pointer; padding: 8px 14px; }
  .btn-cancel:hover { color: #111; }
  .btn-back { padding: 8px 20px; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; font-size: 0.88rem; cursor: pointer; font-weight: 500; }
  .btn-back:hover { background: #f9fafb; }
  .btn-continue { padding: 8px 20px; border: none; border-radius: 6px; background: #111; color: #fff; font-size: 0.88rem; cursor: pointer; font-weight: 500; }
  .btn-continue:hover { background: #333; }
  .wizard-desc { color: #6b7280; font-size: 0.9rem; margin-bottom: 28px; max-width: 820px; }

  .form-row { display: flex; gap: 40px; margin-bottom: 32px; align-items: flex-start; }
  .form-label-col { flex: 0 0 45%; }
  .form-label-col .label-title { font-size: 0.92rem; font-weight: 600; margin-bottom: 3px; }
  .form-label-col .label-desc { font-size: 0.84rem; color: #6b7280; }
  .form-label-col .label-desc a { color: #4a90e2; text-decoration: none; }
  .form-input-col { flex: 1; }
  .form-input-col input[type="text"] { width: 100%; padding: 9px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.88rem; outline: none; }
  .form-input-col input[type="text"]:focus { border-color: #818cf8; box-shadow: 0 0 0 2px rgba(129,140,248,0.15); }

  .info-card { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 24px 28px; margin-top: 8px; }
  .info-card h3 { font-size: 0.95rem; font-weight: 700; margin-bottom: 14px; }
  .info-columns { display: flex; gap: 60px; }
  .info-col h4 { font-size: 0.84rem; color: #6b7280; margin-bottom: 10px; }
  .info-col .item { display: flex; align-items: center; gap: 8px; font-size: 0.88rem; margin-bottom: 6px; }
  .check-green { color: #22c55e; font-weight: 700; }
  .cross-red { color: #ef4444; font-weight: 700; }

  .radio-group { display: flex; flex-direction: column; gap: 16px; }
  .radio-option { display: flex; align-items: flex-start; gap: 10px; }
  .radio-option input[type="radio"] { margin-top: 4px; accent-color: #111; }
  .radio-option .radio-label { font-size: 0.92rem; font-weight: 600; }
  .radio-option .radio-desc { font-size: 0.84rem; color: #6b7280; margin-top: 2px; }
  .radio-option .radio-desc strong { color: #111; }
  .logo-preview { width: 200px; margin: 12px 0; }
  .ppw-value { font-size: 1.1rem; font-weight: 600; margin-top: 6px; }

  select { width: 100%; padding: 9px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.88rem; outline: none; background: #fff; }
  select:focus { border-color: #818cf8; }

  .tabs { display: flex; gap: 0; border-bottom: 2px solid #e5e7eb; margin-top: 28px; margin-bottom: 16px; }
  .tab { padding: 10px 18px; font-size: 0.88rem; font-weight: 500; color: #6b7280; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; display: flex; align-items: center; gap: 6px; }
  .tab.active { color: #111; border-bottom-color: #111; }
  .tab svg { width: 16px; height: 16px; }
  .empty-msg { text-align: center; color: #9ca3af; padding: 60px 0; font-size: 0.9rem; }
  .note { font-size: 0.82rem; color: #6b7280; margin-top: 8px; }
  .note strong { color: #111; }

  .page { display: none; }
  .page.active { display: block; }
</style>
</head><body>

<div class="topbar">
  <div class="topbar-left">
    <a href="/partners"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7"/></svg> Partners</a>
  </div>
  <div class="topbar-center">New partner</div>
  <div class="topbar-right">
    <div class="badge"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><circle cx="12" cy="17" r=".5"/></svg><span class="badge-count">4</span></div>
    <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/></svg>
    <div class="avatar">AB</div>
  </div>
</div>

<div class="shell">
  <aside class="wizard-sidebar">
    <div class="step active" id="step1nav" onclick="goStep(1)">
      <div class="step-label">Step 1</div>
      <div class="step-title">Create a partner organization</div>
    </div>
    <div class="step" id="step2nav" onclick="goStep(2)">
      <div class="step-label">Step 2</div>
      <div class="step-title">Customize partner settings and database</div>
    </div>
    <div class="step" id="step3nav" onclick="goStep(3)">
      <div class="step-label">Step 3</div>
      <div class="step-title">Add users and teams</div>
    </div>
  </aside>

  <div class="wizard-main">
    <!-- Step 1 -->
    <div class="page active" id="page1">
      <div class="wizard-header">
        <h2>Create a partner organization</h2>
        <div class="wizard-actions">
          <button class="btn-cancel" onclick="location.href='/partners'">Cancel</button>
          <button class="btn-continue" onclick="goStep(2)">Continue</button>
        </div>
      </div>
      <p class="wizard-desc">Add a new partner organization to your tenant. Once your partner is created, you'll be able to add a logo, customize settings, and configure the partner's database.</p>

      <div class="form-row">
        <div class="form-label-col">
          <div class="label-title">* Partner organization name</div>
          <div class="label-desc">Give this partner organization a unique name.</div>
        </div>
        <div class="form-input-col">
          <input type="text" id="partnerName" placeholder="" />
        </div>
      </div>

      <div class="info-card">
        <h3>What's the difference between a partner and a team?</h3>
        <p style="font-size:0.88rem;color:#374151;margin-bottom:16px;">Partners are contained within a tenant and can have their own users, teams, and customized settings and database configurations. Teams can only be created within your tenant or partners organizations. Teams that are contained within partners are subject to their partner's settings.</p>
        <div class="info-columns">
          <div class="info-col">
            <h4>Partner management allows me to:</h4>
            <div class="item"><span class="check-green">&#10004;</span> Limit user and project access</div>
            <div class="item"><span class="check-green">&#10004;</span> Configure database</div>
            <div class="item"><span class="check-green">&#10004;</span> Customize logo</div>
            <div class="item"><span class="check-green">&#10004;</span> Set net price per watt</div>
          </div>
          <div class="info-col">
            <h4>Team management allows me to:</h4>
            <div class="item"><span class="check-green">&#10004;</span> Limit user and project access</div>
            <div class="item"><span class="cross-red">&#10008;</span> Configure database</div>
            <div class="item"><span class="cross-red">&#10008;</span> Customize logo</div>
            <div class="item"><span class="cross-red">&#10008;</span> Set net price per watt</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Step 2 -->
    <div class="page" id="page2">
      <div class="wizard-header">
        <h2>Customize settings and database</h2>
        <div class="wizard-actions">
          <button class="btn-cancel" onclick="location.href='/partners'">Cancel</button>
          <button class="btn-back" onclick="goStep(1)">Back</button>
          <button class="btn-continue" onclick="goStep(3)">Continue</button>
        </div>
      </div>
      <p class="wizard-desc">Customize settings for this partner organization. Further database customizations &mdash; such as assigning adders, discounts, incentives, and modules &mdash; can be made once you've finished creating a partner.</p>

      <div class="form-row">
        <div class="form-label-col">
          <div class="label-title">* Logo</div>
          <div class="label-desc">Choose between adopting your tenant organization's logo in <a href="/settings">Organization Profile</a> or assigning a custom logo to all of your partner organization's projects.</div>
        </div>
        <div class="form-input-col">
          <div class="radio-group">
            <label class="radio-option">
              <input type="radio" name="logo" value="tenant" checked />
              <div>
                <div class="radio-label">Adopt your tenant's logo</div>
                <div class="radio-desc">Automatically apply your tenant organization's logo to all projects within this partner.</div>
                <div style="margin-top:12px;padding:20px;text-align:center;">
                  <div style="font-family:'Brush Script MT',cursive;font-size:2.8rem;color:#e8a838;font-weight:700;line-height:1;">
                    <span style="font-size:1.2rem;color:#111;font-weight:800;letter-spacing:2px;display:block;text-transform:uppercase;">TEAM</span>Sunshine
                  </div>
                </div>
              </div>
            </label>
            <label class="radio-option">
              <input type="radio" name="logo" value="custom" />
              <div>
                <div class="radio-label">Add custom logo</div>
                <div class="radio-desc">Assign a custom logo to this partner. <strong>All projects will automatically adopt this logo.</strong></div>
              </div>
            </label>
          </div>
        </div>
      </div>

      <div class="form-row" style="margin-top:20px;">
        <div class="form-label-col">
          <div class="label-title">* Base price per watt (PPW)</div>
          <div class="label-desc">Choose between adopting your tenant's base PPW in <a href="/settings">Pricing Defaults</a> or setting a custom value for all of this partner's projects.</div>
        </div>
        <div class="form-input-col">
          <div class="radio-group">
            <label class="radio-option">
              <input type="radio" name="ppw" value="tenant" checked />
              <div>
                <div class="radio-label">Adopt your tenant's base PPW</div>
                <div class="radio-desc">Automatically apply your tenant organization's base PPW to all projects within this partner.</div>
                <div class="ppw-value">$4.30</div>
              </div>
            </label>
            <label class="radio-option">
              <input type="radio" name="ppw" value="custom" />
              <div>
                <div class="radio-label">Add a custom base PPW</div>
                <div class="radio-desc">Set a custom base PPW for this partner. <strong>This customization will only apply to new projects; existing projects imported from the tenant will not be affected.</strong></div>
              </div>
            </label>
          </div>
        </div>
      </div>
    </div>

    <!-- Step 3 -->
    <div class="page" id="page3">
      <div class="wizard-header">
        <h2>Add users and teams</h2>
        <div class="wizard-actions">
          <button class="btn-cancel" onclick="location.href='/partners'">Cancel</button>
          <button class="btn-back" onclick="goStep(2)">Back</button>
          <button class="btn-continue" onclick="savePartner()">Save</button>
        </div>
      </div>
      <p class="wizard-desc">Add users and teams to this partner to give access to partner projects. <strong>Admins and tenant Team members who aren't on a team will automatically have access to all partner projects.</strong></p>

      <div class="form-row">
        <div class="form-label-col">
          <div class="label-title">Add users</div>
          <div class="label-desc">Add users to this partner. Users will have access to partner projects based on their role permissions. <strong>Admins are automatically added to all organization teams.</strong> To view permissions by role, go to the <a href="/settings/roles">Roles</a> page.</div>
        </div>
        <div class="form-input-col">
          <div class="radio-group">
            <label class="radio-option">
              <input type="radio" name="userSource" value="tenant" checked />
              <div>
                <div class="radio-label">Individual users from your tenant</div>
                <div class="radio-desc">Move individual users from your tenant to this partner organization.</div>
                <select id="userSelect" style="margin-top:10px;">
                  <option value="">Select users</option>
                  ${userOpts}
                </select>
                <p class="note" style="margin-top:8px;"><strong>Why don't I see all users?</strong> Users can only be moved if they aren't already assigned to a team. They must be moved from their tenant teams in order to be added to this partner organization.</p>
              </div>
            </label>
            <label class="radio-option">
              <input type="radio" name="userSource" value="otherPartner" />
              <div>
                <div class="radio-label">Individual users from another partner</div>
                <div class="radio-desc">Add individual users from another partner to this partner organization.</div>
              </div>
            </label>
            <label class="radio-option">
              <input type="radio" name="userSource" value="teams" />
              <div>
                <div class="radio-label">Teams from your tenant</div>
                <div class="radio-desc">Move teams from your tenant to this partner organization.</div>
              </div>
            </label>
          </div>
        </div>
      </div>

      <div class="tabs">
        <div class="tab active"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Users (0)</div>
        <div class="tab"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg> Admins (${users.length})</div>
        <div class="tab"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg> Teams (0)</div>
      </div>
      <div class="empty-msg">Use the options above to add users to this partner.</div>
    </div>
  </div>
</div>

<script>
let currentStep = 1;
function goStep(n) {
  if (n < 1 || n > 3) return;
  currentStep = n;
  document.querySelectorAll('.page').forEach((p, i) => {
    p.classList.toggle('active', i === n - 1);
  });
  document.querySelectorAll('.step').forEach((s, i) => {
    s.classList.remove('active', 'completed');
    if (i < n - 1) s.classList.add('completed');
    if (i === n - 1) s.classList.add('active');
  });
}

function savePartner() {
  const name = document.getElementById('partnerName').value.trim();
  if (!name) { alert('Please enter a partner name.'); goStep(1); return; }
  fetch('/api/partners', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name })
  }).then(r => r.json()).then(() => {
    location.href = '/partners';
  });
}
</script>
</body></html>`);
});

app.post("/api/partners", (req, res) => {
  const partners = loadPartners();
  const id = "p" + (partners.length + 1) + "_" + Date.now();
  const partner = {
    id,
    name: req.body.name || "Unnamed Partner",
    users: 0,
    teams: 0,
    lastUpdated: new Date().toISOString().split("T")[0]
  };
  partners.push(partner);
  savePartners(partners);
  res.json(partner);
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

// ── Auto-detect roof via Python roof_geometry service ──────────────────────
app.post("/api/roof/auto-detect", async (req, res) => {
  const ROOF_SERVICE = process.env.ROOF_SERVICE_URL || "http://localhost:8000";
  try {
    const resp = await fetch(`${ROOF_SERVICE}/roof/parse`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body)
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      return res.status(resp.status).json({ error: err.detail || "Roof detection service error" });
    }
    const data = await resp.json();
    res.json(data);
  } catch (e) {
    res.status(503).json({ error: "Roof detection service unavailable. Start it with: cd roof_geometry && uvicorn app:app --port 8000" });
  }
});

// ── Image Analysis (standalone image_engine testing page) ────────────────
app.get("/image-analysis", requireAuth, (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<title>Image Analysis — Aurora</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f5f5f5;display:flex;height:100vh;overflow:hidden}
  .rail{width:48px;background:#1a0828;display:flex;flex-direction:column;align-items:center;padding:10px 0;flex-shrink:0}
  .rail-logo{width:32px;height:32px;display:flex;align-items:center;justify-content:center;margin-bottom:16px;cursor:pointer;border-radius:8px}
  .rail-logo:hover{background:rgba(255,255,255,0.1)}
  .rail-btn{width:36px;height:36px;display:flex;align-items:center;justify-content:center;border-radius:8px;color:rgba(255,255,255,0.5);text-decoration:none;margin-bottom:4px;transition:background 0.15s,color 0.15s}
  .rail-btn:hover{background:rgba(255,255,255,0.08);color:#fff}
  .rail-btn.active{background:#5a1060;color:#fff}
  .ia-wrap{flex:1;display:flex;flex-direction:column;overflow:hidden}
  .ia-header{padding:16px 24px;background:#fff;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:12px}
  .ia-header h1{font-size:1.1rem;font-weight:700;color:#111}
  .ia-header .badge{font-size:0.65rem;background:#7c3aed;color:#fff;padding:2px 8px;border-radius:10px;font-weight:600}
  .ia-body{flex:1;overflow-y:auto;padding:24px;display:flex;gap:24px}
  .ia-input-panel{width:380px;flex-shrink:0;display:flex;flex-direction:column;gap:16px}
  .ia-results-panel{flex:1;min-width:0}
  .card{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:16px}
  .card h3{font-size:0.82rem;font-weight:700;color:#374151;margin-bottom:10px;text-transform:uppercase;letter-spacing:0.5px}
  label{display:block;font-size:0.78rem;font-weight:600;color:#4b5563;margin-bottom:4px}
  input[type=text],input[type=number],input[type=file]{width:100%;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:0.82rem;background:#fafafa}
  input[type=file]{padding:5px}
  .field-row{display:flex;gap:8px}
  .field-row>div{flex:1}
  .btn-run{width:100%;padding:10px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:0.85rem;font-weight:700;cursor:pointer;transition:background 0.15s}
  .btn-run:hover{background:#6d28d9}
  .btn-run:disabled{background:#c4b5fd;cursor:not-allowed}
  .status-bar{padding:8px 12px;border-radius:6px;font-size:0.78rem;display:none}
  .status-bar.info{display:block;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe}
  .status-bar.error{display:block;background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
  .status-bar.success{display:block;background:#f0fdf4;color:#16a34a;border:1px solid #bbf7d0}
  .results-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .result-section{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:14px}
  .result-section h4{font-size:0.75rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:8px}
  .result-section.full-width{grid-column:1/-1}
  .debug-img{max-width:100%;border-radius:6px;border:1px solid #e5e7eb;margin-bottom:8px;cursor:pointer}
  .debug-img:hover{border-color:#7c3aed}
  .debug-label{font-size:0.72rem;color:#6b7280;margin-bottom:12px}
  table.data-table{width:100%;font-size:0.75rem;border-collapse:collapse}
  table.data-table th{text-align:left;padding:4px 6px;color:#9ca3af;font-weight:600;border-bottom:1px solid #f3f4f6}
  table.data-table td{padding:4px 6px;color:#374151;border-bottom:1px solid #f9fafb}
  .metric-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px}
  .metric{padding:8px;background:#f9fafb;border-radius:6px}
  .metric-val{font-size:1rem;font-weight:700;color:#111}
  .metric-label{font-size:0.68rem;color:#9ca3af}
  .conf-bar{height:6px;border-radius:3px;background:#e5e7eb;margin-top:4px}
  .conf-fill{height:100%;border-radius:3px;transition:width 0.3s}
  .empty-state{text-align:center;padding:60px 20px;color:#9ca3af;font-size:0.85rem}
  .preview-img{max-width:100%;max-height:200px;border-radius:6px;border:1px solid #e5e7eb;margin-top:8px;object-fit:contain;background:#f9fafb}
  .lightbox{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out}
  .lightbox img{max-width:95vw;max-height:95vh;border-radius:8px}
</style>
</head><body>
  <nav class="rail">
    <div class="rail-logo"><svg width="18" height="18" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg></div>
    <a class="rail-btn" href="/" title="Projects"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></a>
    <a class="rail-btn" href="/database" title="Database"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4.03 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4.03 3 9 3s9-1.34 9-3"/></svg></a>
    <a class="rail-btn" href="/settings" title="Settings"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></a>
    <a class="rail-btn" href="/partners" title="Partners"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg></a>
    <a class="rail-btn active" href="/image-analysis" title="Image Analysis"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></a>
  </nav>

  <div class="ia-wrap">
    <div class="ia-header">
      <h1>Image Analysis</h1>
      <span class="badge">image_engine</span>
    </div>
    <div class="ia-body">
      <!-- Left: Input panel -->
      <div class="ia-input-panel">
        <div class="card">
          <h3>Image Source</h3>
          <label>Upload image file</label>
          <input type="file" id="iaFile" accept="image/*" onchange="iaPreviewFile()"/>
          <div style="text-align:center;color:#9ca3af;font-size:0.72rem;margin:8px 0">— or —</div>
          <label>Image URL</label>
          <input type="text" id="iaUrl" placeholder="https://... or /api/satellite?lat=...&lng=...&zoom=20&size=640"/>
          <img id="iaPreview" class="preview-img" style="display:none"/>
        </div>

        <div class="card">
          <h3>Image Metadata</h3>
          <div class="field-row">
            <div><label>Width (px)</label><input type="number" id="iaWidth" value="640"/></div>
            <div><label>Height (px)</label><input type="number" id="iaHeight" value="640"/></div>
          </div>
          <div style="margin-top:8px">
            <label>Resolution (m/px)</label>
            <input type="number" id="iaRes" value="0.109375" step="0.001"/>
          </div>
          <div style="margin-top:8px">
            <label>Geo bounds (S, W, N, E)</label>
            <div class="field-row">
              <div><input type="number" id="iaBoundS" placeholder="South" step="0.0001"/></div>
              <div><input type="number" id="iaBoundW" placeholder="West" step="0.0001"/></div>
            </div>
            <div class="field-row" style="margin-top:4px">
              <div><input type="number" id="iaBoundN" placeholder="North" step="0.0001"/></div>
              <div><input type="number" id="iaBoundE" placeholder="East" step="0.0001"/></div>
            </div>
          </div>
          <div style="margin-top:8px">
            <label>Design center (lat, lng) — optional</label>
            <div class="field-row">
              <div><input type="number" id="iaCenterLat" placeholder="Latitude" step="0.0001"/></div>
              <div><input type="number" id="iaCenterLng" placeholder="Longitude" step="0.0001"/></div>
            </div>
          </div>
        </div>

        <button class="btn-run" id="iaBtnRun" onclick="iaRunAnalysis()">Run Image Engine</button>
        <div class="status-bar" id="iaStatus"></div>
      </div>

      <!-- Right: Results panel -->
      <div class="ia-results-panel" id="iaResultsPanel">
        <div class="empty-state" id="iaEmpty">Upload an image and click <strong>Run Image Engine</strong> to see results.</div>
        <div class="results-grid" id="iaResults" style="display:none"></div>
        <div id="iaDebugPanel" style="display:none;margin-top:20px">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
            <h3 style="font-size:0.92rem;font-weight:700;color:#111;margin:0">Debug Output</h3>
            <button onclick="iaCopyDebugReport()" style="padding:4px 12px;font-size:0.75rem;border:1px solid #d1d5db;border-radius:5px;background:#fff;cursor:pointer;font-weight:600">Copy Debug Report</button>
          </div>
          <div style="display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px">
            <div id="iaDbgOriginal" style="flex:1;min-width:280px"></div>
            <div id="iaDbgOverlay" style="flex:1;min-width:280px"></div>
          </div>
          <div style="margin-bottom:16px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <h4 style="font-size:0.78rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin:0">Diagnostics JSON</h4>
              <button onclick="iaCopyDiagnostics()" style="padding:2px 10px;font-size:0.7rem;border:1px solid #d1d5db;border-radius:4px;background:#fff;cursor:pointer">Copy JSON</button>
            </div>
            <pre id="iaDbgDiagnostics" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:10px;font-size:0.72rem;overflow-x:auto;max-height:300px;overflow-y:auto;white-space:pre-wrap;word-break:break-word"></pre>
          </div>
          <div>
            <h4 style="font-size:0.78rem;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Planes Summary (max 5)</h4>
            <table class="data-table" id="iaDbgPlanesTable"></table>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Lightbox -->
  <div class="lightbox" id="iaLightbox" style="display:none" onclick="this.style.display='none'">
    <img id="iaLightboxImg"/>
  </div>

<script>
  // File upload → base64
  var iaFileBase64 = null;
  function iaPreviewFile() {
    var file = document.getElementById('iaFile').files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function(e) {
      iaFileBase64 = e.target.result; // data:image/...;base64,...
      document.getElementById('iaPreview').src = iaFileBase64;
      document.getElementById('iaPreview').style.display = 'block';
      // Try to read dimensions
      var img = new Image();
      img.onload = function() {
        document.getElementById('iaWidth').value = img.width;
        document.getElementById('iaHeight').value = img.height;
      };
      img.src = iaFileBase64;
    };
    reader.readAsDataURL(file);
  }

  function iaSetStatus(cls, msg) {
    var el = document.getElementById('iaStatus');
    el.className = 'status-bar ' + cls;
    el.textContent = msg;
  }

  function iaShowLightbox(src) {
    document.getElementById('iaLightboxImg').src = src;
    document.getElementById('iaLightbox').style.display = 'flex';
  }

  function iaRunAnalysis() {
    var btn = document.getElementById('iaBtnRun');
    btn.disabled = true;
    btn.textContent = 'Analyzing...';
    iaSetStatus('info', 'Sending to image_engine pipeline...');

    var imageUrl = document.getElementById('iaUrl').value.trim();
    var widthPx = parseInt(document.getElementById('iaWidth').value) || 640;
    var heightPx = parseInt(document.getElementById('iaHeight').value) || 640;
    var res = parseFloat(document.getElementById('iaRes').value) || 0.109375;
    var bS = parseFloat(document.getElementById('iaBoundS').value) || 0;
    var bW = parseFloat(document.getElementById('iaBoundW').value) || 0;
    var bN = parseFloat(document.getElementById('iaBoundN').value) || 0;
    var bE = parseFloat(document.getElementById('iaBoundE').value) || 0;
    var cLat = parseFloat(document.getElementById('iaCenterLat').value) || ((bS + bN) / 2) || 37.4220;
    var cLng = parseFloat(document.getElementById('iaCenterLng').value) || ((bW + bE) / 2) || -122.0841;

    // If no geo_bounds provided, synthesize from center + resolution
    if (!bS && !bN) {
      var halfH = (heightPx * res / 111320) / 2;
      var halfW = (widthPx * res / (111320 * Math.cos(cLat * Math.PI / 180))) / 2;
      bS = cLat - halfH; bN = cLat + halfH;
      bW = cLng - halfW; bE = cLng + halfW;
    }

    // Determine image source for the payload
    var imagePayload = {
      width_px: widthPx,
      height_px: heightPx,
      geo_bounds: [bS, bW, bN, bE],
      resolution_m_per_px: res
    };
    if (iaFileBase64) {
      imagePayload.url = iaFileBase64;
    } else if (imageUrl) {
      imagePayload.url = imageUrl;
    } else {
      iaSetStatus('error', 'Provide an image file or URL.');
      btn.disabled = false;
      btn.textContent = 'Run Image Engine';
      return;
    }

    var payload = {
      project_id: 'image_analysis_test',
      design_center: { lat: cLat, lng: cLng },
      anchor_dots: [],
      calibration_offset: { tx: 0, tz: 0 },
      lidar: {
        points: [[0, 0, 0]],
        bounds: [-35, -35, 35, 35],
        resolution: 0.25,
        source: 'none'
      },
      image: imagePayload,
      options: {
        pipeline_mode: 'image_engine',
        confidence_threshold: 0.3,
        max_planes: 30
      }
    };

    fetch('/api/roof/auto-detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function(r) { return r.json(); })
    .then(function(data) {
      btn.disabled = false;
      btn.textContent = 'Run Image Engine';
      if (data.error) {
        iaSetStatus('error', 'Error: ' + data.error);
        return;
      }
      iaSetStatus('success', 'Analysis complete — pipeline_mode: ' + (data.metadata ? data.metadata.pipeline_mode_used : 'image_engine'));
      iaRenderResults(data);
    })
    .catch(function(err) {
      btn.disabled = false;
      btn.textContent = 'Run Image Engine';
      iaSetStatus('error', 'Request failed: ' + err.message);
    });
  }

  function iaRenderResults(data) {
    document.getElementById('iaEmpty').style.display = 'none';
    var grid = document.getElementById('iaResults');
    grid.style.display = 'grid';
    grid.innerHTML = '';

    var ier = data.image_engine_result || {};

    // 1. Summary metrics
    var metricsHtml = '<div class="result-section"><h4>Summary</h4><div class="metric-grid">';
    metricsHtml += iaMetric(ier.regions_total || 0, 'Regions detected');
    metricsHtml += iaMetric(ier.regions_promoted || 0, 'Planes promoted');
    metricsHtml += iaMetric((ier.edges || []).length, 'Line segments');
    metricsHtml += iaMetric((ier.ridge_line_candidates || []).length, 'Ridge candidates');
    metricsHtml += iaMetric((ier.obstruction_candidates || []).length, 'Obstructions');
    metricsHtml += iaMetric((ier.dormer_candidates || []).length, 'Dormers');
    metricsHtml += '</div>';
    if (typeof ier.overall_confidence === 'number') {
      var pct = Math.round(ier.overall_confidence * 100);
      var color = pct >= 60 ? '#16a34a' : pct >= 30 ? '#ca8a04' : '#dc2626';
      metricsHtml += '<div style="margin-top:10px"><label>Overall confidence</label><div class="conf-bar"><div class="conf-fill" style="width:'+pct+'%;background:'+color+'"></div></div><div style="font-size:0.72rem;color:#6b7280;margin-top:2px">'+pct+'%</div></div>';
    }
    metricsHtml += '</div>';
    grid.innerHTML += metricsHtml;

    // 2. Diagnostics
    var diag = (ier.metadata || {}).diagnostics || {};
    var diagHtml = '<div class="result-section"><h4>Diagnostics</h4><table class="data-table">';
    Object.keys(diag).forEach(function(k) {
      diagHtml += '<tr><td>'+k.replace(/_/g,' ')+'</td><td style="font-weight:600">'+diag[k]+'</td></tr>';
    });
    diagHtml += '</table></div>';
    grid.innerHTML += diagHtml;

    // 3. Debug overlays (full width)
    var artifacts = ier.debug_artifacts || [];
    if (artifacts.length > 0) {
      var artHtml = '<div class="result-section full-width"><h4>Debug Overlays ('+artifacts.length+')</h4>';
      artifacts.forEach(function(a) {
        var src = 'data:image/png;base64,' + a.image_base64;
        artHtml += '<div class="debug-label">' + (a.name || '') + (a.description ? ' — ' + a.description : '') + '</div>';
        artHtml += '<img class="debug-img" src="'+src+'" onclick="iaShowLightbox(this.src)" title="Click to enlarge"/>';
      });
      artHtml += '</div>';
      grid.innerHTML += artHtml;
    }

    // 4. Candidate regions table
    var regions = (ier.metadata || {}).regions || [];
    if (regions.length > 0) {
      var regHtml = '<div class="result-section full-width"><h4>Candidate Regions ('+regions.length+')</h4><table class="data-table"><tr><th>ID</th><th>Area m\u00B2</th><th>Compact</th><th>Aspect</th><th>Material</th><th>Promoted</th></tr>';
      regions.forEach(function(r) {
        regHtml += '<tr><td>'+r.id+'</td><td>'+r.area_m2+'</td><td>'+r.compactness+'</td><td>'+r.aspect_ratio+'</td><td>'+r.material_hint+'</td><td>'+(r.promoted?'\u2705':'\u274C')+'</td></tr>';
      });
      regHtml += '</table></div>';
      grid.innerHTML += regHtml;
    }

    // 5. Line segments / edges
    var edges = ier.edges || [];
    if (edges.length > 0) {
      var edgeHtml = '<div class="result-section"><h4>Line Segments ('+edges.length+')</h4><table class="data-table"><tr><th>ID</th><th>Length m</th><th>Angle\u00B0</th><th>Conf</th></tr>';
      edges.slice(0, 50).forEach(function(e) {
        edgeHtml += '<tr><td>'+e.id+'</td><td>'+e.length_m+'</td><td>'+e.angle_deg+'</td><td>'+e.confidence+'</td></tr>';
      });
      if (edges.length > 50) edgeHtml += '<tr><td colspan="4" style="color:#9ca3af">... and '+(edges.length-50)+' more</td></tr>';
      edgeHtml += '</table></div>';
      grid.innerHTML += edgeHtml;
    }

    // 6. Obstruction candidates
    var obs = ier.obstruction_candidates || [];
    if (obs.length > 0) {
      var obsHtml = '<div class="result-section"><h4>Obstructions ('+obs.length+')</h4><table class="data-table"><tr><th>ID</th><th>Class</th><th>Area m\u00B2</th><th>Conf</th></tr>';
      obs.forEach(function(o) {
        obsHtml += '<tr><td>'+o.id+'</td><td>'+o.classification+'</td><td>'+o.area_m2+'</td><td>'+o.confidence+'</td></tr>';
      });
      obsHtml += '</table></div>';
      grid.innerHTML += obsHtml;
    }

    // 7. Dormer candidates
    var dorms = ier.dormer_candidates || [];
    if (dorms.length > 0) {
      var dormHtml = '<div class="result-section"><h4>Dormers ('+dorms.length+')</h4><table class="data-table"><tr><th>ID</th><th>Type</th><th>W\u00D7D m</th><th>Conf</th></tr>';
      dorms.forEach(function(d) {
        dormHtml += '<tr><td>'+d.id+'</td><td>'+d.dormer_type+'</td><td>'+d.width_m+'\u00D7'+d.depth_m+'</td><td>'+d.confidence+'</td></tr>';
      });
      dormHtml += '</table></div>';
      grid.innerHTML += dormHtml;
    }

    // 8. Ridge line candidates
    var ridges = ier.ridge_line_candidates || [];
    if (ridges.length > 0) {
      var ridgeHtml = '<div class="result-section"><h4>Ridge Candidates ('+ridges.length+')</h4><table class="data-table"><tr><th>Length m</th><th>Angle\u00B0</th><th>Conf</th></tr>';
      ridges.forEach(function(r) {
        ridgeHtml += '<tr><td>'+r.length_m+'</td><td>'+r.angle_deg+'</td><td>'+r.confidence+'</td></tr>';
      });
      ridgeHtml += '</table></div>';
      grid.innerHTML += ridgeHtml;
    }

    // 9. Timings
    var timings = (ier.metadata || {}).timings || {};
    if (Object.keys(timings).length > 0) {
      var timeHtml = '<div class="result-section"><h4>Timings</h4><table class="data-table">';
      Object.keys(timings).forEach(function(k) {
        timeHtml += '<tr><td>'+k+'</td><td style="font-weight:600">'+timings[k]+'s</td></tr>';
      });
      timeHtml += '</table></div>';
      grid.innerHTML += timeHtml;
    }

    // Populate the Debug Output panel
    iaPopulateDebugPanel(data);
  }

  function iaMetric(val, label) {
    return '<div class="metric"><div class="metric-val">'+val+'</div><div class="metric-label">'+label+'</div></div>';
  }

  // ── Debug Output panel ──────────────────────────────────────────────────
  var iaLastDebugData = null;

  function iaPopulateDebugPanel(data) {
    var ier = data.image_engine_result || {};
    iaLastDebugData = { ier: ier, imageUrl: document.getElementById('iaUrl').value.trim(), fileUsed: !!iaFileBase64 };

    var panel = document.getElementById('iaDebugPanel');
    panel.style.display = 'block';

    // Original image
    var origEl = document.getElementById('iaDbgOriginal');
    var origSrc = iaFileBase64 || iaLastDebugData.imageUrl || '';
    if (origSrc) {
      origEl.innerHTML = '<div style="font-size:0.72rem;color:#6b7280;margin-bottom:4px;font-weight:600">Original Image</div>'
        + '<img src="'+origSrc+'" style="max-width:100%;border-radius:6px;border:1px solid #e5e7eb;cursor:pointer" onclick="iaShowLightbox(this.src)"/>';
    } else {
      origEl.innerHTML = '<div style="font-size:0.72rem;color:#9ca3af">No original image available</div>';
    }

    // Combined overlay — pick first artifact with "combined" or "region" in the name, else first artifact
    var artifacts = ier.debug_artifacts || [];
    var overlayEl = document.getElementById('iaDbgOverlay');
    var overlay = null;
    for (var i = 0; i < artifacts.length; i++) {
      var n = (artifacts[i].name || '').toLowerCase();
      if (n.indexOf('combined') >= 0 || n.indexOf('region') >= 0 || n.indexOf('overlay') >= 0) { overlay = artifacts[i]; break; }
    }
    if (!overlay && artifacts.length > 0) overlay = artifacts[0];
    if (overlay && overlay.image_base64) {
      var oSrc = 'data:image/png;base64,' + overlay.image_base64;
      overlayEl.innerHTML = '<div style="font-size:0.72rem;color:#6b7280;margin-bottom:4px;font-weight:600">'+(overlay.name || 'Overlay')+'</div>'
        + '<img src="'+oSrc+'" style="max-width:100%;border-radius:6px;border:1px solid #e5e7eb;cursor:pointer" onclick="iaShowLightbox(this.src)"/>';
    } else {
      overlayEl.innerHTML = '<div style="font-size:0.72rem;color:#9ca3af">No overlay artifact returned</div>';
    }

    // Diagnostics JSON
    var diag = (ier.metadata || {}).diagnostics || {};
    document.getElementById('iaDbgDiagnostics').textContent = JSON.stringify(diag, null, 2);

    // Planes summary table (max 5)
    var planes = ier.planes || [];
    var tbl = document.getElementById('iaDbgPlanesTable');
    if (planes.length === 0) {
      tbl.innerHTML = '<tr><td style="color:#9ca3af;font-size:0.75rem">No planes promoted</td></tr>';
    } else {
      var html = '<tr><th>#</th><th>Area m\\u00B2</th><th>Confidence</th><th>Vertices</th></tr>';
      planes.slice(0, 5).forEach(function(p, i) {
        var area = p.area_m2 != null ? p.area_m2 : (p.boundary_local ? '~' : '—');
        var conf = p.confidence != null ? p.confidence : '—';
        var verts = '—';
        if (p.boundary_local) verts = p.boundary_local.length;
        else if (p.vertices) verts = p.vertices.length;
        else if (p.boundary_2d) verts = p.boundary_2d.length;
        html += '<tr><td>'+(i+1)+'</td><td>'+area+'</td><td>'+conf+'</td><td>'+verts+'</td></tr>';
      });
      if (planes.length > 5) html += '<tr><td colspan="4" style="color:#9ca3af">... and '+(planes.length-5)+' more planes</td></tr>';
      tbl.innerHTML = html;
    }
  }

  function iaCopyDiagnostics() {
    var text = document.getElementById('iaDbgDiagnostics').textContent;
    iaCopyToClipboard(text, 'Diagnostics JSON copied');
  }

  function iaCopyDebugReport() {
    if (!iaLastDebugData) return;
    var ier = iaLastDebugData.ier;
    var diag = (ier.metadata || {}).diagnostics || {};
    var planes = ier.planes || [];

    var lines = [];
    lines.push('=== Image Engine Debug Report ===');
    lines.push('Timestamp: ' + new Date().toISOString());
    lines.push('');

    // Image reference
    lines.push('-- Image --');
    if (iaLastDebugData.fileUsed) {
      lines.push('Source: uploaded file');
    } else {
      lines.push('Source: ' + (iaLastDebugData.imageUrl || 'none'));
    }
    var imgSize = (ier.metadata || {}).image_size;
    if (imgSize) lines.push('Size: ' + imgSize[0] + 'x' + imgSize[1] + ' px');
    lines.push('');

    // Overlay reference
    var artifacts = ier.debug_artifacts || [];
    lines.push('-- Overlays (' + artifacts.length + ') --');
    artifacts.forEach(function(a) {
      lines.push('  ' + (a.name || 'unnamed') + (a.description ? ': ' + a.description : '') + ' [base64 ' + (a.image_base64 || '').length + ' chars]');
    });
    lines.push('');

    // Diagnostics
    lines.push('-- Diagnostics --');
    lines.push(JSON.stringify(diag, null, 2));
    lines.push('');

    // Planes summary
    lines.push('-- Planes (' + planes.length + ', showing max 5) --');
    planes.slice(0, 5).forEach(function(p, i) {
      var area = p.area_m2 != null ? p.area_m2 : '?';
      var conf = p.confidence != null ? p.confidence : '?';
      var verts = '?';
      if (p.boundary_local) verts = p.boundary_local.length;
      else if (p.vertices) verts = p.vertices.length;
      else if (p.boundary_2d) verts = p.boundary_2d.length;
      lines.push('  #' + (i+1) + ': area=' + area + ' m2, conf=' + conf + ', verts=' + verts);
    });

    iaCopyToClipboard(lines.join('\\n'), 'Debug report copied');
  }

  function iaCopyToClipboard(text, successMsg) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function() {
        iaCopyFlash(successMsg);
      }, function() {
        iaCopyFallback(text, successMsg);
      });
    } else {
      iaCopyFallback(text, successMsg);
    }
  }

  function iaCopyFallback(text, successMsg) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      iaCopyFlash(successMsg);
    } catch (e) {
      iaCopyFlash('Copy failed — select text manually');
    }
    document.body.removeChild(ta);
  }

  function iaCopyFlash(msg) {
    var el = document.getElementById('iaStatus');
    var prev = el.className;
    var prevText = el.textContent;
    el.className = 'status-bar success';
    el.textContent = msg;
    setTimeout(function() { el.className = prev; el.textContent = prevText; }, 1500);
  }
</script>
</body></html>`);
});

app.listen(PORT, () => {
  console.log(`Solar CRM running at http://localhost:${PORT}`);
});
