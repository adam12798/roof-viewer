# ML Auto Build — Project Handoff

Single source of truth for resuming this project on a fresh machine or new session. For general CRM setup (Node, npm, login accounts), see `SETUP.md`. This covers the ML Auto Build slice end-to-end.

**Last updated:** 2026-04-17 (late — triage pass interim close-out)
**Repos:** CRM at `adam12798/roof-viewer`, ML at `adam12798/ML`
**Active triage log:** `ML_AUTO_BUILD_TRIAGE_STATUS.md` (interim, 16 of 30 rows locked)

---

## A. Project overview

**Solar CRM design tool** — a web app (Node + Express, port 3001) for designing residential solar installations. Users place panels on a 3D roof model with LiDAR point clouds, satellite imagery, and manual drawing tools. Data lives in `data/projects.json`.

**ML Auto Build** — a one-click path in the design editor that calls an external ML pipeline (Python, port 5001) on a satellite tile + DSM grid around the design pin, returning a preview 3D roof the user can then edit manually.

**Manual roof path** — unchanged. Drawing, vertex edits, section splits, dormers, trees, calibration all work identically whether the starting geometry came from ML or was hand-drawn.

**Product rules (already decided, do not undo):**
- Manual workflow must never change.
- ML Auto Build is preview-only until Save. The saved design on disk never changes outside the user's explicit Save click.
- Standalone ML engine stays conservative by default; CRM-only overrides are allowed when they improve the product experience.
- No new persistent UI for this flow (no tabs, settings pages, review queues). Transient banners only.
- No retraining. Every improvement is preprocessing, policy, or plumbing.

---

## B. Architecture / request flow

```
CRM browser                           CRM Node (3001)                      ML wrapper (5001)                    ML engine core
-----------                           ----------------                     ------------------                   ---------------
ML Auto Build button                  
  mlAutoBuild()  [~L16225]            
    load LiDAR (best-effort, 10s)     
    mlAutoBuildContinue()  [~L16256]  
      POST /api/ml/auto-build ───────► forwards to ML_ENGINE_URL          POST /api/crm/auto-build [~L393]
                                       (default 127.0.0.1:5001)             fetch image (Google staticmap)
                                       [~L24630]                            centre-crop 1280→640 [~L240]
                                                                            build DSM from lidar.points [~L283]
                                                                            handle_crm_auto_build_request
                                                                              usable_gate_min=0.20 [~L499]
                                                                                                             ──► usable_gate
                                                                                                                 outline
                                                                                                                 planes
                                                                                                                 orientation (DSM fit)
                                                                                                                 semantic_edges
                                                                                                                 keepout
                                                                                                                 review_policy
                                                                                                             ◄── MLRoofResult
                                                                            soft-gate override (crm_auto_build.py)
                                                                            CRM-safe face conversion (adapters/crm.py)
                                                                            geometry cleanup [~L683]
                                                                            target-building isolation [~L843]
                                                                              primary grouping (0.3m tolerance)
                                                                              subcluster refinement (0.15m)
                                                                            coordinate shift (image-TL → pin-centre)
                                       appends to ml-drafts.json ◄──────── response envelope
      ◄── { crmResult.roof_faces }
      pushUndo()
      clearAllRoofFaces()
      tag each face sourceTag='ml'
      recomputeMlInternalEdges()
      rebuild: single-slope mode       
        (no hip decomposition)         
        (shared edges muted grey)      
        (walls suppressed on internal) 
      preview visible; disk unchanged  
```

**Save**: `serializeRoofFaces()` [~L10419] includes `source: 'ml'` per face.
**Reload**: `loadDesign()` [~L9169] re-tags faces with `sourceTag='ml'`, calls `recomputeMlInternalEdges()`, rebuilds in single-slope mode.
**Undo/redo**: `captureRoofSnapshot()` [~L14513] captures `sourceTag`; `restoreRoofSnapshot()` [~L14556] re-tags + rehydrates ML faces.

---

## C. Current implementation status

| Feature | Status | Key location |
|---|---|---|
| CRM ↔ ML transport | Working | `server.js:24630`, `ml_ui_server.py:393` |
| Default ML URL (no env needed) | `http://127.0.0.1:5001/api/crm/auto-build` | `server.js:24627-24628` |
| Centre-crop (1280→640, ~35m) | Working | `ml_ui_server.py:240` |
| DSM/elevation from CRM lidar | Working; falls back to default-pitch when absent | `ml_ui_server.py:283` |
| CRM soft usable gate (floor 0.20) | Working | `ml_ui_server.py:499`, `crm_auto_build.py:301` |
| Target-building isolation | Working; primary 0.3m + subcluster 0.15m | `ml_ui_server.py:843, 1048` |
| Geometry cleanup (duplicate faces) | Working; IoU ≥ 0.15, Δpitch ≤ 5°, Δaz ≤ 10° | `ml_ui_server.py:683` |
| ML-only shared-edge suppression | Working; midpoint-in-polygon classifier | `server.js:11277-11316` |
| ML-only single-slope rendering | Working; no per-face hip decomposition | `server.js:11519-11610` |
| Shared-edge muted grey lines | Working | `server.js:11578` |
| Save/reload ML rehydrate | Working; `source:'ml'` persisted + re-tagged | `server.js:10419, 9244` |
| Undo/redo ML provenance | Working; snapshot captures + restores sourceTag | `server.js:14513, 14556` |
| LiDAR-optional (warn+continue) | Working | `server.js:16225` |
| ML config missing → actionable 503 | Working; banner shows hint+detail | `server.js:24570-24580` |
| Banner severity helper `_mlBanner` | Working; 4 severities: neutral/warning/error/success | `server.js:16210-16222` |
| Design-page boot (loading overlay) | Working; 12s safety timeout + catch handler | `server.js:9614, 9624` |
| Manual faces unchanged | Yes; all ML branches gate on `sourceTag==='ml'` | `server.js:14154, 14243` |

---

## D. Known limitations

- **4-vertex independent face model.** Each ML face is an independent rotated rectangle. Adjacent faces don't share vertices; ~10-30 cm gaps/overlaps at corners remain visible. A true fix requires a shared roof graph (vertex unification). Not in scope for v1.
- **Extreme upstream pitches.** Some ML-detected planes (especially on Back Bay brownstones, Somerville triple-deckers) come back at 65-77° pitch, producing exaggerated slopes in single-slope rendering. The render is correct for what ML returns; the fix is upstream model/classification tuning.
- **Usable gate false negatives in 0.15-0.20 band.** Two tested properties (Tanager 0.16, Newton 0.17) are visually real roofs that reject below the 0.20 floor. Lowering the floor risks letting genuinely bad tiles through.
- **No "strip ML flag" escape hatch.** A user who wants to convert an ML-generated roof to manual rendering has no toggle. The workaround: delete all ML faces, re-draw manually.
- **Legacy ML drafts (saved before source persistence).** Designs saved before the `source:'ml'` field was added load as manual faces (hip-roof rendering). Re-running ML Auto Build + re-saving fixes them.
- **Semantic edges and keepout are advisory only.** They never block the pipeline. Misclassification surfaces as a warning, not a reject.
- **Old roof buttons coexist.** "Auto detect roof" and "Smart roof" still sit next to ML Auto Build. Product decision pending.

---

## E. Current blocker

### NO CURRENT BLOCKER

The design-page rotating-sun boot crash (caused by a stray `}` in the `.catch` block of `mlAutoBuildContinue`'s fetch chain) has been fixed. Client JS now passes `node --check` syntax validation. Verified:

```bash
curl -s "http://127.0.0.1:3001/design?lat=42.6&lng=-71.3&projectId=mn9805q0ddm" \
  -H "Cookie: session=<token>" -o /tmp/page.html
awk '/<script>/{f=1;b="";next}/<\/script>/{if(f)print b;f=0}f{b=b"\n"$0}' /tmp/page.html > /tmp/s.js
node --check /tmp/s.js   # exits 0 — clean parse
```

The first thing to do on the new machine is confirm the design page loads (spinning sun clears within ~3s) before doing anything else.

---

## F. Local run instructions

### Prerequisites

- **Node.js** (tested on v25.7.0; LTS should work)
- **Python 3.12+** (3.13 tested)
- **Google API key** with Maps Static API + Solar API enabled

### CRM start

```bash
cd "/path/to/project Interrupt"
npm install                    # first time only
# Create .env with at minimum:
#   GOOGLE_API_KEY=your-key
#   PORT=3001
node server.js
# Expected output:
#   Solar CRM running at http://localhost:3001
#   ML Auto Build → http://127.0.0.1:5001/api/crm/auto-build (default)
```

### ML wrapper start

```bash
cd /path/to/ML
pip install -r requirements.txt     # first time only
export GOOGLE_API_KEY=your-key      # same key as CRM
export GOOGLE_MAPS_KEY=$GOOGLE_API_KEY
python3 ml_ui_server.py
# Expected output:
#   Running on http://127.0.0.1:5001
# First ML request loads all models (~90s on CPU). Subsequent requests ~10-60s.
```

### Env var reference

| Var | Where | Required | Default |
|---|---|---|---|
| `GOOGLE_API_KEY` | CRM `.env` | Yes | — |
| `PORT` | CRM `.env` | No | 3001 |
| `ML_ENGINE_URL` | CRM `.env` | No | `http://127.0.0.1:5001` |
| `ML_AUTO_BUILD_PATH` | CRM `.env` | No | `/api/crm/auto-build` |
| `GOOGLE_API_KEY` or `GOOGLE_MAPS_KEY` | ML shell env | Yes (for ML) | — |

### Gotchas

- **Restart after env changes.** Node reads `.env` at boot. ML reads shell env at boot. Neither hot-reloads.
- **Kill stale processes before starting.** `lsof -nP -iTCP:3001 -iTCP:5001 -sTCP:LISTEN` — kill any lingering PIDs.
- **Do not use backticks in JS comments** inside the `/design` HTML template in `server.js` (lines ~5500-17600). They terminate the template literal and produce a client-side parse error that freezes the design page. Use double-quotes or plain text in comments.
- **`data/sessions.json`, `data/users.json`, `data/projects.json` are gitignored.** On a fresh clone the app creates them at runtime. Login with admin/password (see `SETUP.md`). On an existing machine they persist on disk.

---

## G. Resume checklist

1. Clone / open both repos.
2. Set `.env` on CRM side (GOOGLE_API_KEY at minimum).
3. `npm install` in CRM dir.
4. `pip install -r requirements.txt` in ML dir.
5. Start CRM: `node server.js` — confirm boot log shows the ML endpoint line.
6. Start ML: `export GOOGLE_API_KEY=... && python3 ml_ui_server.py` — confirm Flask is listening on 5001.
7. Open `http://localhost:3001`, log in (admin / password).
8. Open a project with a valid address → enter design mode → **confirm the spinning sun clears** within ~3s.
9. Click **ML Auto Build** on 20 Meadow Dr. Wait ~10-60s. Expect 5 roof faces in single-slope mode.
10. Click **Save**. Reload the page. Confirm ML faces re-render in single-slope mode (not hip-roof mini-houses).
11. Click **Undo** (Cmd+Z). Confirm prior state restores. Click **Redo** (Cmd+Shift+Z). Confirm ML faces come back in single-slope mode.
12. Continue from the next task in section I.

---

## H. Known validation cases

| Property | Lat, Lng | What it tests |
|---|---|---|
| 20 Meadow Dr, Lowell MA | 42.6463, -71.3545 | Simple SFH; 5 ML faces; single-slope rendering; the canonical "good case" |
| 225 Gibson St, Lowell MA | 42.6324, -71.3392 | Dense multiface (14 faces); complex target isolation |
| 583 Westford St, Lowell MA | 42.6339, -71.3369 | Urban dense; 15 raw → 7 selected; target iso stress test |
| Somerville triple-decker | 42.3942, -71.1022 | Attached-neighbour subcluster refinement (9→8 faces) |
| Back Bay brownstones, Boston | 42.3499, -71.0778 | Rowhouse; 2 faces share one wall; extreme upstream pitch |
| Cambridge SFH + garage | 42.3742, -71.1195 | Detached garage separation (TOLERANCE_M 0.3m); 15→13 after target iso+cleanup |
| Belmont colonial | 42.3959, -71.1786 | Clear reject (usable=0.005); gate works correctly |
| 254 Foster St, Lowell MA | 42.6322, -71.3378 | Borderline soft-gate case (usable=0.24); rescued by 0.20 floor |

---

## I. Next priorities (in order)

**Reordered 2026-04-17 based on interim 16-row triage sample** (see `ML_AUTO_BUILD_TRIAGE_STATUS.md`). Provisional — confirm with remaining 14 rows before committing engineering effort.

1. **Finish the 30-property triage pass.** 16 of 30 rows locked. Remaining 14 should over-sample under-represented categories (multiface, urban attached, detached garage) to give `gap_overlap` and `wrong_target` a fair chance to surface. Do NOT start engineering off the interim sample alone.
2. **Investigate extreme ML pitch values / plane quality on successful builds.** Interim leading hypothesis: `wrong_pitch` is dominant among successful builds (6 of 10 non-reject locked rows). Promoted from #3 based on triage evidence. Likely upstream ML orientation/plane-fit issue; may need CRM-side pitch-clamp guardrail as an interim mitigation. Confirm with full 30-row sample before implementing.
3. **Vertex snapping across adjacent ML faces.** `gap_overlap` is 0 in the locked 16-row sample so far, so this track is demoted pending the remaining 14 rows. Was #2; re-promote if multiface/rowhouse rows change the distribution.
4. **Revisit usable-gate floor (0.20) only after 30 rows.** Current locked sample shows `reject_correct` : `reject_too_strict` = 4 : 2. Not enough signal yet. 52 New Spaulding (usable ≈ 0.154) is the canonical `reject_too_strict` reference.
5. **Legacy roof buttons.** "Auto detect roof" and "Smart roof" coexist with ML Auto Build. Product decision: hide, remove, or keep as fallback.

**Done since last handoff:**
- ~~Surface ml-drafts.json as a debug-only page.~~ Read-only JSON triage surface shipped as `GET /api/ml-drafts` (summary + filters) and `GET /api/ml-drafts/:id` (full detail). No UI yet; browser-readable JSON is sufficient for triage.

**Do NOT touch right now (unless new evidence surfaces):**
- Usable gate floor (0.20 is well-calibrated; only move with ≥20 more borderline examples).
- Crop size (35m is working; only adjust if larger roofs clip).
- Core ML models (no retraining in this track).

---

## J. Recent milestones (newest first)

| Date | Milestone |
|---|---|
| 2026-04-17 (late) | Interim triage pass closed out at 16 of 30 rows. Distribution (provisional): `wrong_pitch` 6, `reject_correct` 4, `ugly_but_correct_building` 3, `reject_too_strict` 2, `clean` 1; `wrong_target` / `gap_overlap` / `wrong_azimuth` / `investigate` all 0. Leading hypothesis for next engineering work is upstream ML pitch / plane quality on successful builds. Full status in `ML_AUTO_BUILD_TRIAGE_STATUS.md`, including unresolved 94 C St ↔ 52 New Spaulding mismatch and a Salem-row transcription artifact. Shipped read-only triage API (`GET /api/ml-drafts`, `GET /api/ml-drafts/:id`). |
| 2026-04-17 | Fixed design-page boot crash (stray `}` in `.catch` block killed client JS parse). Added `_mlBanner` severity helper with 4 explicit levels (neutral/warning/error/success) so banner states never leak across transitions. Fixed undo/redo dropping ML sourceTag — `captureRoofSnapshot` now includes it; `restoreRoofSnapshot` rehydrates ML faces. |
| 2026-04-16 | ML single-slope rendering: ML faces render as tilted quads instead of standalone hip roofs. Shared-edge suppression: midpoint-in-polygon classifier marks internal edges; walls suppressed, edge lines muted grey, labels skipped. Save/reload rehydrate: `source:'ml'` persisted in `serializeRoofFaces`; `loadDesign` re-tags and recomputes on load. |
| 2026-04-16 | Target-isolation refinements: primary tolerance tightened 0.5→0.3m (fixes Cambridge garage); subcluster pass at 0.15m (fixes Somerville attached-neighbour bleed). Geometry cleanup: duplicate faces (IoU ≥ 0.15 + tight orientation) dropped post-isolation. |
| 2026-04-16 | CRM-only soft usable gate (floor 0.20): pipeline continues for borderline imagery; results pinned to needs_review with `crm_soft_gate_applied`. Centre-crop (1280→640) + DSM elevation threading from CRM lidar.points into ML SceneInput. LiDAR-optional: warn-and-continue instead of hard block. Default ML_ENGINE_URL for zero-config local dev. |
| 2026-04-16 | 18-property broad validation pass. Transport, alignment, target-building isolation, and preview load verified end-to-end with real Google Static Maps + Google Solar DSM. |

---

## Key files reference

### CRM repo (`project Interrupt/`)

| File | Key areas |
|---|---|
| `server.js` (~25.3k lines) | `/design` template (L5500-17600): `mlAutoBuild` L16225, `mlAutoBuildContinue` L16256, `_mlBanner` L16210, `finalizeRoofFace` L14154 (ML branch), `rebuildRoofFace` L14243 (ML branch), `serializeRoofFaces` L10419 (source persistence), `loadDesign` L9169 (ML rehydrate), `captureRoofSnapshot` L14513 (sourceTag), `restoreRoofSnapshot` L14556 (ML rehydrate), shared-edge helpers L11277-11316, single-slope helpers L11519-11610. Server routes: `/api/ml/auto-build` L24630, ML defaults L24627. |
| `SETUP.md` | General CRM setup (Node, npm, .env, login accounts). |
| `.env` | `GOOGLE_API_KEY`, `PORT`, optionally `ML_ENGINE_URL`, `ML_AUTO_BUILD_PATH`. |
| `.gitignore` | Excludes `data/sessions.json`, `data/users.json`, `data/projects.json`, `data/uploads/`, `data/organization.json`, `data/ml-drafts.json`, `.claude/`. |
| `data/ml-drafts.json` | Append-only audit log of every ML Auto Build call. Not tracked in git. |

### ML repo (`ML/`)

| File | What it does |
|---|---|
| `ml_ui_server.py` (~1.9k lines) | Flask on 5001. `/api/crm/auto-build`: image fetch, centre-crop L240, DSM build L283, `usable_gate_min=0.20` L499, geometry cleanup L683, target isolation (0.3m L892, subcluster 0.15m L1048), coordinate shift, frame_debug. |
| `ml_engine/core/pipeline.py` | `run_pipeline` + `PipelineRunner.run` accept `usable_gate_min` (default 0.5). |
| `ml_engine/api/crm_auto_build.py` | Soft-gate override post-`apply_review_policy`. `raw_usable_score`, `effective_usable_gate_min`, `soft_gate_applied` on envelope. |
| `ml_engine/core/review_policy.py` | Decision table: `USABLE_GATE_REJECT=0.40`, `USABLE_GATE_REVIEW=0.65`, etc. Unchanged. |
| `ml_engine/adapters/crm.py` | MLRoofResult → CRM-safe `crm_faces`. Drops below `min_plane_confidence=0.40`. |
| `ml_engine/core/scene.py` | `SceneInput` + `ElevationSource` shape (2D float32 numpy, north-up). |

### Debug fields (in every ML response at `crm_result.metadata.frame_debug`)

- `crop_debug` — source/target px, whether crop fired.
- `dsm_debug` — built, shape, finite samples.
- `soft_gate_debug` — raw_usable_score, effective_min, applied.
- `target_selection` — group count, selected size, tolerance, subcluster refinement info.
- `geometry_cleanup` — input/output counts, dropped duplicates/tiny/slivers.
