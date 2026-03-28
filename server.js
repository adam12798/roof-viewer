require("dotenv").config();
const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;
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
  const designId = newId();
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

    res.json({ error: null, width, height, elevData, satelliteDataUrl, bbox });
  } catch (e) {
    res.status(500).json({ error: "DSM parse failed: " + e.message });
  }
});

// ── USGS 3DEP LiDAR API ──────────────────────────────────────────────────────
app.get("/api/lidar/points", async (req, res) => {
  const { lat, lng, radius } = req.query;
  if (!lat || !lng) return res.status(400).json({ error: "lat and lng required" });
  const r = parseFloat(radius) || 15; // meters (~50ft — just the target property)
  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);

  // Convert radius to approximate degree offset
  const dLat = r / 111320;
  const dLng = r / (111320 * Math.cos(latF * Math.PI / 180));
  const minX = lngF - dLng;
  const maxX = lngF + dLng;
  const minY = latF - dLat;
  const maxY = latF + dLat;

  try {
    // Step 1: Search USGS Entwine index for LiDAR datasets at this location
    const searchUrl = `https://usgs.entwine.io/boundaries/`;
    let boundaries = [];
    try {
      const searchResp = await fetch(searchUrl);
      if (searchResp.ok) {
        const allBoundaries = await searchResp.json();
        // Filter boundaries that contain our point
        boundaries = allBoundaries.filter(b => {
          if (!b.bounds) return false;
          const [bMinX, bMinY, , bMaxX, bMaxY] = b.bounds;
          return lngF >= bMinX && lngF <= bMaxX && latF >= bMinY && latF <= bMaxY;
        });
      }
    } catch(e) { /* entwine search failed, try fallback */ }

    if (boundaries.length > 0) {
      // Found matching LiDAR dataset — try to read points
      const boundary = boundaries[0];
      const eptRoot = boundary.url;

      if (eptRoot) {
        // Read points from EPT endpoint
        const readUrl = `https://usgs.entwine.io/data/read?url=${encodeURIComponent(eptRoot)}&bounds=[${minX},${minY},${maxX},${maxY}]&depthEnd=14`;
        const readResp = await fetch(readUrl);

        if (readResp.ok) {
          const pointData = await readResp.json();
          let points = [];
          if (Array.isArray(pointData)) {
            const raw = pointData.map(p => [
              p.X ?? p.x ?? p[0] ?? 0,
              p.Y ?? p.y ?? p[1] ?? 0,
              p.Z ?? p.z ?? p[2] ?? 0,
              p.Classification ?? p.classification ?? p[3] ?? 0
            ]);
            // Spatial thinning: keep highest point per 0.3m grid cell (outer surface only)
            const cellSize = 0.000003; // ~0.3m in degrees
            const grid = new Map();
            for (const pt of raw) {
              const key = Math.floor(pt[0] / cellSize) + ',' + Math.floor(pt[1] / cellSize);
              const existing = grid.get(key);
              if (!existing || pt[2] > existing[2]) grid.set(key, pt);
            }
            points = Array.from(grid.values()).slice(0, 50000);
          }
          return res.json({
            error: null,
            points,
            bounds: { minX, maxX, minY, maxY },
            dataset: boundary.name || "USGS 3DEP",
            count: points.length
          });
        }
      }

      // EPT root found but point read failed
      return res.json({
        error: null,
        available: true,
        dataset: boundary.name || "USGS 3DEP",
        points: [],
        message: "LiDAR dataset found (" + (boundary.name || "USGS 3DEP") + ") but point streaming unavailable."
      });
    }

    // Step 2: Fallback — check The National Map for available LiDAR products
    const tnmUrl = `https://tnmaccess.nationalmap.gov/api/v1/products?datasets=Lidar%20Point%20Cloud%20(LPC)&bbox=${minX},${minY},${maxX},${maxY}&max=3&outputFormat=JSON`;
    const tnmResp = await fetch(tnmUrl);
    if (tnmResp.ok) {
      const tnmData = await tnmResp.json();
      if (tnmData.items && tnmData.items.length > 0) {
        return res.json({
          error: null,
          available: true,
          dataset: tnmData.items[0].title,
          downloadUrl: tnmData.items[0].downloadURL,
          points: [],
          message: "LiDAR data available: " + tnmData.items[0].title + ". Full point cloud requires LAZ processing."
        });
      }
    }

    return res.json({ error: "No LiDAR coverage found for this location. USGS 3DEP covers ~80% of the US.", points: [] });

  } catch (e) {
    res.status(500).json({ error: "LiDAR query failed: " + e.message, points: [] });
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
  const designUrl = `/design?lat=${project.lat}&lng=${project.lng}&address=${encodeURIComponent(project.address)}&projectId=${project.id}`;
  const salesUrl = `/sales?projectId=${project.id}`;
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
                <button class="db-more-btn" onclick="event.stopPropagation()">···</button>
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
            ? `<img src="${mapSrc}" alt="Property satellite view"/>`
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
          <div class="sidebar-customer-name">${customerName}</div>
          <div class="sidebar-customer-sub">${shortAddr}</div>
        </div>
        <div class="sidebar-more-wrap" onclick="event.stopPropagation()">
          <button class="sidebar-more" onclick="toggleSidebarMenu()">···</button>
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
      var team = prompt('Assign to team member:');
      if (team && team.trim()) {
        fetch('/api/projects/${project.id}/reassign', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ assignee: team.trim() })
        }).then(function(r) { if (r.ok) location.reload(); });
      }
    }
    function sidebarDelete() {
      if (confirm('Are you sure you want to delete this project? This cannot be undone.')) {
        fetch('/api/projects/${project.id}', {
          method: 'DELETE'
        }).then(function(r) { if (r.ok) window.location.href = '/crm'; });
      }
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

</body>
</html>`);
});

// ── Design / Pin screen ────────────────────────────────────────────────────────
app.get("/design", (req, res) => {
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
      overflow: hidden;
    }
    .map-3d-scene {
      position: absolute;
      inset: 0;
      perspective: 1200px;
      overflow: visible;
      z-index: 0;
    }
    .map-3d-plane {
      position: relative;
      width: 100%;
      height: 100%;
      transform-style: preserve-3d;
      transform-origin: center center;
      transition: transform 0.25s ease;
    }
    #map { width: 100%; height: 100%; }
    /* Ensure overlays sit above the 3D scene */
    .draw-toolbar, .map-bottom, .lp-toggle-float { z-index: 10; }

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
      left: 14px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
      pointer-events: all;
      z-index: 10;
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
    }
    .viewcube {
      width: 50px;
      height: 50px;
      position: relative;
      transform-style: preserve-3d;
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
            <div class="lp-subitem"><div class="lp-subitem-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12l9-9 9 9"/><path d="M5 10v9a2 2 0 002 2h10a2 2 0 002-2v-9"/></svg>
              Smart roof</div><span class="lp-subitem-key">R</span>
            </div>
            <div class="lp-subitem"><div class="lp-subitem-left">
              <svg class="lp-item-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/></svg>
              Manual roof face</div>
            </div>
            <div class="lp-subitem"><div class="lp-subitem-left">
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
            <span class="lp-subitem-key" style="margin-left:auto;">T</span>
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
      <div class="map-3d-scene" id="map3dScene">
        <div class="map-3d-plane" id="map3dPlane">
          <div id="map"></div>
        </div>
      </div>
      <!-- LiDAR 3D viewer — sits on top of map, hidden until toggled -->
      <div id="viewer3d" style="display:none;position:absolute;inset:0;z-index:10;">
        <canvas id="canvas3d" style="width:100%;height:100%;display:block;"></canvas>
        <!-- Legend -->
        <div id="lidarLegend" style="position:absolute;bottom:12px;right:12px;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);border-radius:8px;padding:10px 14px;color:#fff;font-size:0.7rem;z-index:20;">
          <div style="font-weight:600;margin-bottom:6px;">LiDAR Legend</div>
          <div style="display:flex;gap:12px;">
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#888;margin-right:4px;"></span>Ground</span>
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#4a90e2;margin-right:4px;"></span>Building</span>
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#22c55e;margin-right:4px;"></span>Vegetation</span>
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#f59e0b;margin-right:4px;"></span>High point</span>
          </div>
        </div>
        <!-- Status -->
        <div id="lidarStatus" style="position:absolute;bottom:12px;left:12px;background:rgba(0,0,0,0.7);backdrop-filter:blur(6px);border-radius:8px;padding:8px 14px;color:#fff;font-size:0.85rem;font-weight:600;z-index:20;"></div>
      </div>

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
        <div style="width:1px;height:24px;background:#555;margin:0 4px;"></div>
        <button class="draw-btn" id="btnShade" title="Shade Analysis">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>
          Shade
        </button>
        <button class="draw-btn" id="btn3dView" title="LiDAR 3D View">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/><circle cx="12" cy="12" r="3"/></svg>
          LiDAR
        </button>
      </div>

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

      <!-- ViewCube — bottom left -->
      <div class="map-controls-bl">
        <div class="viewcube-wrap" id="viewcubeWrap">
          <div class="viewcube-ring"></div>
          <div class="vc-north-arrow" id="vcNorthArrow"></div>
          <div class="viewcube-compass" id="vcCompass">
            <span class="vc-n">N</span>
            <span class="vc-s">S</span>
            <span class="vc-e">E</span>
            <span class="vc-w">W</span>
          </div>
          <div class="viewcube-scene">
            <div class="viewcube" id="viewcube">
              <div class="vc-face vc-top" data-view="top">TOP</div>
              <div class="vc-face vc-bottom" data-view="bottom">BTM</div>
              <div class="vc-face vc-front" data-view="front">N</div>
              <div class="vc-face vc-back" data-view="back">S</div>
              <div class="vc-face vc-left" data-view="left">E</div>
              <div class="vc-face vc-right" data-view="right">W</div>
            </div>
          </div>
        </div>
        <div class="tilt-slider-wrap">
          <input type="range" class="tilt-slider" id="tiltSlider" min="0" max="45" value="0" title="Tilt"/>
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
    var designLat = ${parseFloat(lat)};
    var designLng = ${parseFloat(lng)};
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

    /* ── Submenu flyout toggle ── */
    var submenus = [
      { wrap: 'wrapRoof',           item: 'menuRoof' },
      { wrap: 'wrapObstructions',   item: 'menuObstructions' },
      { wrap: 'wrapSiteComponents', item: 'menuSiteComponents' },
      { wrap: 'wrapFire',           item: 'menuFire' },
      { wrap: 'menuPanelsWrap',     item: 'menuPanels' },
      { wrap: 'wrapComponents',     item: 'menuComponents' },
      { wrap: 'menuStringWrap',     item: 'menuString' }
    ];
    submenus.forEach(function(s) {
      var wrap = document.getElementById(s.wrap);
      var item = document.getElementById(s.item);
      if (!wrap || !item) return;
      item.addEventListener('click', function(e) {
        e.stopPropagation();
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
        zoom: 20,
        maxZoom: 22,
        minZoom: 18,
        mapTypeId: 'satellite',
        tilt: 0,
        disableDefaultUI: true,
        gestureHandling: 'greedy',
        draggable: false,
        scrollwheel: true,
        disableDoubleClickZoom: true,
        keyboardShortcuts: false,
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

      /* Zoom: Google tiles 18-21, then CSS deep zoom beyond */
      var extraZoom = 0;
      var maxExtraZoom = 20;
      var maxTileZoom = 22;

      function applyExtraZoom() {
        var scale = Math.pow(2, extraZoom);
        var mapEl = document.getElementById('map');
        mapEl.style.transform = extraZoom > 0 ? 'scale(' + scale + ')' : '';
        mapEl.style.transformOrigin = 'center center';
      }

      function updateZoomLabel() {
        var el = document.getElementById('zoomLabel');
        if (el) {
          if (extraZoom > 0) {
            el.textContent = maxTileZoom + '+' + extraZoom + 'x';
            el.style.display = '';
          } else {
            el.style.display = 'none';
          }
        }
      }

      document.getElementById('zoomIn').addEventListener('click', function() {
        if (extraZoom > 0 || map.getZoom() >= maxTileZoom) {
          if (extraZoom < maxExtraZoom) {
            extraZoom++;
            applyExtraZoom();
          }
        } else {
          map.setZoom(map.getZoom() + 1);
        }
        updateZoomLabel();
      });
      document.getElementById('zoomOut').addEventListener('click', function() {
        if (extraZoom > 0) {
          extraZoom--;
          applyExtraZoom();
        } else {
          if (map.getZoom() > 18) map.setZoom(map.getZoom() - 1);
        }
        updateZoomLabel();
      });

      /* ── Scroll/pinch zoom with static image deep zoom ── */
      var wheelAccum = 0;
      var wheelThreshold = 80;
      document.getElementById('map').parentNode.addEventListener('wheel', function(e) {
        /* Zooming in past tile max → switch to static image zoom */
        if ((map.getZoom() >= maxTileZoom || extraZoom > 0) && e.deltaY < 0) {
          e.stopPropagation();
          e.preventDefault();
          wheelAccum += Math.abs(e.deltaY);
          if (wheelAccum >= wheelThreshold) {
            wheelAccum = 0;
            if (extraZoom < maxExtraZoom) {
              extraZoom++;
              applyExtraZoom();
              updateZoomLabel();
            }
          }
        } else if (extraZoom > 0 && e.deltaY > 0) {
          e.stopPropagation();
          e.preventDefault();
          wheelAccum += Math.abs(e.deltaY);
          if (wheelAccum >= wheelThreshold) {
            wheelAccum = 0;
            extraZoom--;
            applyExtraZoom();
            updateZoomLabel();
          }
        }
      }, { passive: false, capture: true });

      /* ── Scroll zoom on tilted map ── */
      document.getElementById('map3dScene').addEventListener('wheel', function(e) {
        if (vcRotX > 0 || vcRotZ !== 0) {
          e.preventDefault();
          if (e.deltaY < 0) {
            if (map.getZoom() < maxTileZoom) {
              map.setZoom(map.getZoom() + 1);
            } else if (extraZoom < maxExtraZoom) {
              extraZoom++;
              applyExtraZoom();
            }
          } else {
            if (extraZoom > 0) {
              extraZoom--;
              applyExtraZoom();
            } else {
              map.setZoom(Math.max(map.getZoom() - 1, 18));
            }
          }
          updateZoomLabel();
        }
      }, { passive: false });

      /* ── ViewCube — 3D CAD orbit ── */
      var vcRotX = 0;   // tilt: 0 = top-down, 90 = eye-level
      var vcRotZ = 0;   // heading/spin around vertical axis
      var vcCube = document.getElementById('viewcube');
      var vcWrap = document.getElementById('viewcubeWrap');
      var vcNorth = document.getElementById('vcNorthArrow');
      var vcCompassEl = document.getElementById('vcCompass');
      var tiltSlider = document.getElementById('tiltSlider');
      var map3dPlane = document.getElementById('map3dPlane');
      var map3dScene = document.getElementById('map3dScene');
      var vcDragging = false;
      var vcStartX = 0, vcStartY = 0;
      var vcStartRotX = 0, vcStartRotZ = 0;
      var vcPanX = 0, vcPanY = 0;

      function updateViewCube() {
        // Clamp tilt: 0 = flat top-down, 80 = near eye-level
        vcRotX = Math.max(0, Math.min(80, vcRotX));
        // Normalize heading
        vcRotZ = ((vcRotZ % 360) + 360) % 360;

        // Update the cube to mirror the camera angle
        vcCube.style.transform = 'rotateX(' + vcRotX + 'deg) rotateZ(' + vcRotZ + 'deg)';
        vcNorth.style.transform = 'translateX(-50%) rotate(' + vcRotZ + 'deg)';
        vcCompassEl.style.transform = 'rotate(' + vcRotZ + 'deg)';

        // Apply 3D transform to the map plane (the "flat paper")
        var perspVal = 1200 - (vcRotX * 6);
        if (perspVal < 400) perspVal = 400;
        map3dScene.style.perspective = perspVal + 'px';
        map3dPlane.style.transform = 'translate(' + vcPanX + 'px, ' + vcPanY + 'px) rotateX(' + vcRotX + 'deg) rotateZ(' + vcRotZ + 'deg)';

        tiltSlider.value = vcRotX;
      }

      /* ── Spacebar + drag to pan the 3D view ── */
      var spaceHeld = false;
      var spacePanning = false;
      var spStartX = 0, spStartY = 0;
      var spStartPanX = 0, spStartPanY = 0;

      document.addEventListener('keydown', function(e) {
        if (e.code === 'Space' && !e.repeat && !e.target.matches('input,textarea,select')) {
          e.preventDefault();
          spaceHeld = true;
          map3dScene.style.cursor = 'grab';
        }
      });
      document.addEventListener('keyup', function(e) {
        if (e.code === 'Space') {
          spaceHeld = false;
          spacePanning = false;
          map3dScene.style.cursor = '';
        }
      });

      map3dScene.addEventListener('mousedown', function(e) {
        if (spaceHeld) {
          spacePanning = true;
          spStartX = e.clientX;
          spStartY = e.clientY;
          spStartPanX = vcPanX;
          spStartPanY = vcPanY;
          map3dScene.style.cursor = 'grabbing';
          map3dPlane.style.transition = 'none';
          e.preventDefault();
          e.stopPropagation();
        }
      });

      document.addEventListener('mousemove', function(e) {
        if (spacePanning) {
          vcPanX = spStartPanX + (e.clientX - spStartX);
          vcPanY = spStartPanY + (e.clientY - spStartY);
          updateViewCube();
        }
      });

      document.addEventListener('mouseup', function() {
        if (spacePanning) {
          spacePanning = false;
          map3dScene.style.cursor = spaceHeld ? 'grab' : '';
          map3dPlane.style.transition = 'transform 0.25s ease';
        }
      });

      // Drag to orbit — works from anywhere on the cube
      var vcDidDrag = false;
      vcWrap.addEventListener('mousedown', function(e) {
        vcDragging = true;
        vcDidDrag = false;
        vcStartX = e.clientX;
        vcStartY = e.clientY;
        vcStartRotX = vcRotX;
        vcStartRotZ = vcRotZ;
        map3dPlane.style.transition = 'none';
        e.preventDefault();
      });

      document.addEventListener('mousemove', function(e) {
        if (!vcDragging) return;
        var dx = e.clientX - vcStartX;
        var dy = e.clientY - vcStartY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) vcDidDrag = true;
        vcRotZ = vcStartRotZ - dx * 0.6;
        vcRotX = Math.max(0, Math.min(80, vcStartRotX - dy * 0.3));
        updateViewCube();
      });

      document.addEventListener('mouseup', function() {
        if (vcDragging) {
          vcDragging = false;
          map3dPlane.style.transition = 'transform 0.25s ease';
        }
      });

      // Face clicks — maintain current tilt, just rotate cardinal direction
      // Top/bottom reset tilt; sides keep current tilt and only change heading
      function handleFaceClick(view) {
        map3dPlane.style.transition = 'transform 0.4s ease';
        if (view === 'top') { vcRotX = 0; vcRotZ = 0; }
        else if (view === 'bottom') { vcRotX = 0; vcRotZ = 180; }
        else {
          // Keep current tilt, but if flat (0), bump to a slight angle so user sees the side
          if (vcRotX < 10) vcRotX = 15;
          if (view === 'front') vcRotZ = 0;
          else if (view === 'back') vcRotZ = 180;
          else if (view === 'left') vcRotZ = 90;
          else if (view === 'right') vcRotZ = -90;
        }
        updateViewCube();
        setTimeout(function() { map3dPlane.style.transition = 'transform 0.25s ease'; }, 450);
      }

      vcCube.querySelectorAll('.vc-face').forEach(function(face) {
        face.addEventListener('click', function(e) {
          if (vcDidDrag) return;
          e.stopPropagation();
          handleFaceClick(this.dataset.view);
        });
      });

      // Tilt slider
      tiltSlider.addEventListener('input', function() {
        vcRotX = parseFloat(this.value);
        updateViewCube();
      });
      // Update slider range for full tilt
      tiltSlider.max = 80;

      // Double-click to reset to top-down
      vcWrap.addEventListener('dblclick', function() {
        map3dPlane.style.transition = 'transform 0.4s ease';
        vcRotX = 0;
        vcRotZ = 0;
        vcPanX = 0;
        vcPanY = 0;
        updateViewCube();
        setTimeout(function() { map3dPlane.style.transition = 'transform 0.25s ease'; }, 450);
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
    var projectId = '${projectId || ""}';
    var currentDesignId = '${activeDesignId}';

    function markDirty() { isDirty = true; }

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

    /* Serialize current segments to JSON for saving */
    function serializeSegments() {
      return segments.map(function(seg) {
        var path = seg.getPath().getArray().map(function(ll) { return { lat: ll.lat(), lng: ll.lng() }; });
        return {
          path: path,
          panelCount: seg._panels ? seg._panels.length : 0,
          tilt: seg._tilt || 0,
          azimuth: seg._azimuth || 180
        };
      });
    }

    function getCurrentStats() {
      var totalPanels = 0;
      segments.forEach(function(seg) { if (seg._panels) totalPanels += seg._panels.length; });
      var kw = parseFloat((totalPanels * 0.4).toFixed(2));
      return { cost: Math.round(kw * 2300), offset: ${energyOffset || 0}, kw: kw };
    }

    function saveCurrentDesign(callback) {
      if (!projectId || !currentDesignId) { if (callback) callback(); return; }
      var data = { segments: serializeSegments(), stats: getCurrentStats() };
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
      /* Clear existing segments from map */
      segments.forEach(function(seg) {
        if (seg._panels) seg._panels.forEach(function(p) { p.setMap(null); });
        if (seg._dimLabels) seg._dimLabels.forEach(function(l) { l.setMap(null); });
        if (seg._azArrow) seg._azArrow.setMap(null);
        seg.setMap(null);
      });
      segments = [];
      selectedSegment = null;

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

        /* Restore segments on map */
        if (design.segments && design.segments.length > 0) {
          design.segments.forEach(function(segData) {
            var path = segData.path.map(function(p) { return new google.maps.LatLng(p.lat, p.lng); });
            var polygon = new google.maps.Polygon({
              paths: path,
              strokeColor: '#f5a623',
              strokeOpacity: 1,
              strokeWeight: 2,
              fillColor: '#f5a623',
              fillOpacity: 0.18,
              editable: true,
              draggable: true,
              zIndex: 1,
              map: map
            });
            polygon._tilt = segData.tilt || 0;
            polygon._azimuth = segData.azimuth || 180;
            segments.push(polygon);
            polygon.addListener('click', function() { selectSegment(polygon); });
            fillPanels(polygon);
            addDimensionLabels(polygon);
            addAzimuthArrow(polygon);
          });
          updateStats();
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
      solarRoofPolygons.forEach(function(p) { p.setMap(null); });
      solarRoofPolygons = [];
      var maxSun = (solarData.solarPotential && solarData.solarPotential.maxSunshineHoursPerYear) || 1;

      roofSegs.forEach(function(seg) {
        var center = seg.center;
        if (!center) return;
        var areaM2 = (seg.stats && seg.stats.areaMeters2) || 50;
        var side = Math.sqrt(areaM2) / 2;
        var azRad = (seg.azimuthDegrees || 0) * Math.PI / 180;
        var cLat = center.latitude;
        var cLng = center.longitude;
        var mPerDegLat = 111320;
        var mPerDegLng = 111320 * Math.cos(cLat * Math.PI / 180);
        var dLat = side / mPerDegLat;
        var dLng = side / mPerDegLng;

        var corners = [[-1,-1],[-1,1],[1,1],[1,-1]].map(function(c) {
          var x = c[0] * dLng;
          var y = c[1] * dLat;
          var rx = x * Math.cos(azRad) - y * Math.sin(azRad);
          var ry = x * Math.sin(azRad) + y * Math.cos(azRad);
          return { lat: cLat + ry, lng: cLng + rx };
        });

        var sunHrs = (seg.stats && seg.stats.sunshineQuantiles)
          ? seg.stats.sunshineQuantiles[Math.floor(seg.stats.sunshineQuantiles.length / 2)] : 0;
        var ratio = Math.min(sunHrs / maxSun, 1);
        var r = Math.round(255 * (1 - ratio));
        var g = Math.round(200 * ratio);
        var color = 'rgb(' + r + ',' + g + ',50)';

        var poly = new google.maps.Polygon({
          paths: corners,
          strokeColor: color, strokeOpacity: 0.9, strokeWeight: 2,
          fillColor: color, fillOpacity: 0.25,
          map: null,
          zIndex: 5,
          clickable: false,
        });
        solarRoofPolygons.push(poly);
      });
    }

    function setShadeOverlay(type) {
      shadeOverlayType = type;
      document.querySelectorAll('.shade-overlay-btn').forEach(function(b) { b.classList.remove('active'); });
      var btnId = 'btnOverlay' + type.charAt(0).toUpperCase() + type.slice(1);
      document.getElementById(btnId).classList.add('active');

      if (type === 'none') { clearShadeOverlay(); return; }

      var segs = (solarData.solarPotential && solarData.solarPotential.roofSegmentStats) || [];
      var maxSun = (solarData.solarPotential && solarData.solarPotential.maxSunshineHoursPerYear) || 1;

      solarRoofPolygons.forEach(function(p, i) {
        p.setMap(map);
        var seg = segs[i];
        var sunHrs = (seg && seg.stats && seg.stats.sunshineQuantiles)
          ? seg.stats.sunshineQuantiles[Math.floor(seg.stats.sunshineQuantiles.length / 2)] : 0;
        var ratio = Math.min(sunHrs / maxSun, 1);

        if (type === 'shade') {
          var sr = 1 - ratio;
          var cr = Math.round(80 + 100 * sr);
          var cg = Math.round(50 * (1 - sr));
          var cb = Math.round(150 + 100 * sr);
          var c = 'rgb(' + cr + ',' + cg + ',' + cb + ')';
          p.setOptions({ fillColor: c, strokeColor: c, fillOpacity: 0.35 });
        } else {
          var r = Math.round(255 * (1 - ratio));
          var g = Math.round(200 * ratio);
          var c2 = 'rgb(' + r + ',' + g + ',50)';
          p.setOptions({ fillColor: c2, strokeColor: c2, fillOpacity: 0.25 });
        }
      });
    }

    function clearShadeOverlay() {
      solarRoofPolygons.forEach(function(p) { p.setMap(null); });
    }

    function highlightSolarSegment(i) {
      solarRoofPolygons.forEach(function(p) { p.setMap(map); });
      var poly = solarRoofPolygons[i];
      if (!poly) return;
      poly.setOptions({ fillOpacity: 0.6, strokeWeight: 3 });
      setTimeout(function() {
        poly.setOptions({ fillOpacity: shadeOverlayType === 'shade' ? 0.35 : 0.25, strokeWeight: 2 });
        if (shadeOverlayType === 'none') clearShadeOverlay();
      }, 1500);
      var bounds = new google.maps.LatLngBounds();
      poly.getPath().forEach(function(pt) { bounds.extend(pt); });
      map.panTo(bounds.getCenter());
    }
  </script>
  <script src="https://maps.googleapis.com/maps/api/js?key=${API_KEY}&libraries=drawing,geometry&callback=initMap" async defer></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.152.2/build/three.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/three@0.152.2/examples/js/controls/OrbitControls.js"></script>

  <script>
    /* ── LiDAR 3D VIEW ──
       Simple approach: one Three.js scene with satellite ground plane + LiDAR points.
       OrbitControls handles all navigation (zoom, rotate, pan).
       Toggle on = show scene. Toggle off = back to map. */

    var scene3d, camera3d, renderer3d, controls3d, raycaster3d, mouse3d;
    var lidarPoints = null;
    var groundPlane3d = null;
    var groundLevel = 0;
    var vertExag = 2.0;
    var lidarActive = false;

    // Geo-to-local: meters offset from design center
    var metersPerDegLat = 111320;
    var metersPerDegLng = 111320 * Math.cos((typeof designLat !== 'undefined' ? designLat : 0) * Math.PI / 180);
    function geoToLocal(lat, lng) {
      return {
        x: (lng - designLng) * metersPerDegLng,
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

      camera3d = new THREE.PerspectiveCamera(50, w / h, 0.1, 2000);
      camera3d.position.set(30, 50, 30);
      camera3d.lookAt(0, 0, 0);

      renderer3d = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
      renderer3d.setSize(w, h);
      renderer3d.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      // OrbitControls — full navigation
      controls3d = new THREE.OrbitControls(camera3d, canvas);
      controls3d.enableDamping = true;
      controls3d.dampingFactor = 0.08;
      controls3d.minDistance = 5;
      controls3d.maxDistance = 500;
      controls3d.maxPolarAngle = Math.PI / 2.05; // don't go below ground

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

    function animate3d() {
      requestAnimationFrame(animate3d);
      if (!renderer3d || !lidarActive) return;
      if (controls3d) controls3d.update();
      renderer3d.render(scene3d, camera3d);
    }

    function resize3d() {
      if (!renderer3d || !lidarActive) return;
      var container = document.getElementById('viewer3d');
      var w = container.clientWidth;
      var h = container.clientHeight;
      if (w < 1 || h < 1) return;
      renderer3d.setSize(w, h);
      camera3d.aspect = w / h;
      camera3d.updateProjectionMatrix();
    }

    /* ── Build satellite ground plane (the "paper") ── */
    function buildGroundPlane() {
      if (groundPlane3d) return; // already built
      // Fetch satellite image from DSM endpoint (just need the image, not elevation data)
      fetch('/api/solar/dsm-elevation?lat=' + designLat + '&lng=' + designLng + '&radius=40')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (!data.satelliteDataUrl) return;
          var bbox = data.bbox; // [minLng, minLat, maxLng, maxLat]
          if (!bbox || bbox.length < 4) return;

          var sw = geoToLocal(bbox[1], bbox[0]);
          var ne = geoToLocal(bbox[3], bbox[2]);
          var planeW = ne.x - sw.x;
          var planeH = sw.z - ne.z;
          var cx = (sw.x + ne.x) / 2;
          var cz = (sw.z + ne.z) / 2;

          var geo = new THREE.PlaneGeometry(planeW, planeH);
          geo.rotateX(-Math.PI / 2);

          var img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = function() {
            var texture = new THREE.Texture(img);
            texture.needsUpdate = true;
            var mat = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
            groundPlane3d = new THREE.Mesh(geo, mat);
            groundPlane3d.position.set(cx, -0.1, cz);
            scene3d.add(groundPlane3d);
          };
          img.src = data.satelliteDataUrl;
        })
        .catch(function(e) { console.error('Ground plane error:', e); });
    }

    /* ── Toggle LiDAR view on/off ── */
    var lidarFetched = false;
    var lidarLoading = false;

    document.getElementById('btn3dView').addEventListener('click', function() {
      var viewer = document.getElementById('viewer3d');

      if (lidarActive) {
        // Turn off — hide 3D view, show map
        lidarActive = false;
        viewer.style.display = 'none';
        this.classList.remove('active');
        this.style.background = '';
        this.style.color = '';
        return;
      }

      // Turn on — show 3D view
      viewer.style.display = '';
      lidarActive = true;
      this.classList.add('active');
      this.style.background = '#22c55e';
      this.style.color = '#000';

      if (!scene3d) {
        init3dViewer();
        // Small delay for layout, then resize + load data
        setTimeout(function() {
          resize3d();
          buildGroundPlane();
          loadLidarPoints();
        }, 60);
      } else {
        resize3d();
        if (!lidarFetched) loadLidarPoints();
      }
    });

    function loadLidarPoints() {
      if (lidarFetched || lidarLoading) return;
      if (typeof designLat === 'undefined') {
        setStatus3d('No location — search for an address first');
        return;
      }

      lidarLoading = true;
      setStatus3d('Loading LiDAR points...');

      fetch('/api/lidar/points?lat=' + designLat + '&lng=' + designLng + '&radius=15')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          lidarLoading = false;
          if (data.error) { setStatus3d('LiDAR: ' + data.error); return; }
          if (!data.points || data.points.length === 0) {
            setStatus3d(data.message || 'No LiDAR data for this location');
            return;
          }
          buildLidarPointCloud(data.points);
          lidarFetched = true;
          setStatus3d(data.points.length.toLocaleString() + ' points loaded');
        })
        .catch(function(e) {
          lidarLoading = false;
          setStatus3d('Error: ' + e.message);
        });
    }

    /* ── Build LiDAR point cloud (the "stuff in the glass") ── */
    function buildLidarPointCloud(points) {
      if (lidarPoints) { scene3d.remove(lidarPoints); lidarPoints = null; }

      var positions = new Float32Array(points.length * 3);
      var colors = new Float32Array(points.length * 3);

      var minZ = Infinity, maxZ = -Infinity;
      for (var i = 0; i < points.length; i++) {
        if (points[i][2] < minZ) minZ = points[i][2];
        if (points[i][2] > maxZ) maxZ = points[i][2];
      }
      var zRange = maxZ - minZ || 1;
      groundLevel = minZ;

      for (var i = 0; i < points.length; i++) {
        var p = points[i];
        var cls = p[3] || 0;
        var local = geoToLocal(p[1], p[0]);
        positions[i * 3]     = local.x;
        positions[i * 3 + 1] = (p[2] - minZ) * vertExag;
        positions[i * 3 + 2] = local.z;

        var r, g, b;
        if (cls === 2) { r = 0.5; g = 0.5; b = 0.53; }
        else if (cls === 6) { r = 0.29; g = 0.56; b = 0.89; }
        else if (cls >= 3 && cls <= 5) {
          var ht = (p[2] - minZ) / zRange;
          r = 0.1; g = 0.4 + 0.4 * ht; b = 0.15;
        } else {
          var ht = (p[2] - minZ) / zRange;
          r = 0.3 + 0.6 * ht; g = 0.3 + 0.3 * ht; b = 0.3;
        }
        colors[i * 3] = r;
        colors[i * 3 + 1] = g;
        colors[i * 3 + 2] = b;
      }

      var geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

      var mat = new THREE.PointsMaterial({
        size: 0.3,
        vertexColors: true,
        sizeAttenuation: true,
      });

      lidarPoints = new THREE.Points(geo, mat);
      scene3d.add(lidarPoints);

      // Position camera to see the whole thing
      geo.computeBoundingBox();
      var bb = geo.boundingBox;
      var cx = (bb.max.x + bb.min.x) / 2;
      var cz = (bb.max.z + bb.min.z) / 2;
      var extent = Math.max(bb.max.x - bb.min.x, bb.max.z - bb.min.z);
      var cy = zRange * vertExag * 0.3;

      camera3d.position.set(cx + extent * 0.5, extent * 0.6, cz + extent * 0.5);
      controls3d.target.set(cx, cy, cz);
      controls3d.update();
    }
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
  </style>
</head>
<body>
  <div class="s-topbar">
    <button class="s-exit" onclick="location.href='/project/${projectId}'">
      <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="15 18 9 12 15 6"/></svg> Exit
    </button>
    <div class="s-title" id="slideTitle">Welcome</div>
    <div class="s-counter" id="slideCounter">1 / 6</div>
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
    <!-- Slide 6: Next Steps -->
    <div class="slide" id="slide5">
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
    <div class="s-dots"><button class="s-dot active"></button><button class="s-dot"></button><button class="s-dot"></button><button class="s-dot"></button><button class="s-dot"></button><button class="s-dot"></button></div>
    <button class="s-arrow" id="nextBtn"><svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><polyline points="9 6 15 12 9 18"/></svg></button>
  </div>
  <script>
    var current = 0, total = 6;
    var titles = ['Welcome','Your Home','Energy Profile','Solar Design','Your Savings','Next Steps'];
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
        <a class="sidebar-item" href="/settings/users">Users and licenses</a>
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
    <div class="rail-logo"><svg width="18" height="18" fill="none" stroke="white" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg></div>
    <a class="rail-btn" href="/" title="Projects"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg></a>
    <a class="rail-btn active" href="/settings" title="Settings" style="margin-top:auto;"><svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg></a>
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
        <a class="sidebar-item" href="/settings">Roles</a>
        <a class="sidebar-item" href="/settings">Teams</a>
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
