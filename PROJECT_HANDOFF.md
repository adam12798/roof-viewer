# ML Auto Build — Project Handoff

Single source of truth for resuming this project on a fresh machine or new session. For general CRM setup (Node, npm, login accounts), see `SETUP.md`. This covers the ML Auto Build slice end-to-end.

**Last updated:** 2026-04-19 (RANSAC robust plane fitting implemented and validated)
**Repos:** CRM at `adam12798/roof-viewer`, ML at `adam12798/ML`
**Active triage log:** `ML_AUTO_BUILD_TRIAGE_STATUS.md` (complete — 32 rows bucketed)

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
| Geometry cleanup (steep-face filter) | Working; drop pitch > 60° | `ml_ui_server.py:782` |
| Geometry cleanup (narrow-face filter) | Working; drop short side < 2.0m | `ml_ui_server.py:802` |
| Geometry cleanup (small-relative filter) | Working; drop area < 10% of max surviving | `ml_ui_server.py:822` |
| Geometry cleanup (bad-fit steep filter) | Working; RFE>0.30 + tilt>40° + ratio<0.50 | `ml_ui_server.py:859` |
| Batch validation harness | Working; 19 ref props, offline re-run | `/ML/batch_validate.py` |
| Per-face diagnostics | Working; face_diagnostics in cleanup debug | `ml_ui_server.py:949` |
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

**Reordered 2026-04-18 based on completed 32-row triage pass and expanded validation** (see `ML_AUTO_BUILD_TRIAGE_STATUS.md`). Distribution confirmed — `wrong_pitch` is the dominant failure mode at 58% of successful builds. Geometry cleanup (Rules D–G) validated against all 91 non-rejected drafts.

1. ~~Build-level quality gate.~~ **DONE** — see §8.13. Rule: `n_cleaned >= 2 AND faces_above_40° / n_cleaned >= 0.40`. Downgrades `auto_accept` → `needs_review`, appends `build_tilt_quality_low` reason. Live-validated on 18 properties: 6 flagged (5 wrong_pitch, 1 ugly), 0 clean false positives. All 3 primary targets caught.
2. **Recover 7 missing labeled rows.** (Deprioritized — confirmed 0 missing clean. The 7 missing are 4 wrong_pitch + 1 reject_correct + 1 reject_too_strict + 1 ugly.)
3. **Resolve §4.2 duplicate draft ID.** `mld_mo39na4r9jej` is labeled for both "74 Gates" and "14 Warren Ave" — only one draft exists. Identify which address is correct.
4. **Vertex snapping across adjacent ML faces.** `gap_overlap` = 0 across all 32 rows. Deprioritized. Re-promote only if new evidence surfaces.
5. **Revisit usable-gate floor (0.20).** 5 `reject_correct` vs 3 `reject_too_strict` (5:3). Still not enough signal. 52 New Spaulding (usable ≈ 0.154) remains the reference.
6. **Legacy roof buttons.** "Auto detect roof" and "Smart roof" coexist with ML Auto Build. Product decision: hide, remove, or keep as fallback.

**Done since last handoff:**
- ~~Steep-face filter.~~ Rule D: drop pitch > 60°.
- ~~Narrow-face filter (plane dimension sanity).~~ Rule E: drop faces with short side < 2.0m. Catches eave/fascia/edge artifacts that escape the sliver, steep, and tiny rules. Validated: removes 8% of wrong_pitch faces, 20% of ugly faces, 1 low-conf artifact from clean. See `ML_AUTO_BUILD_TRIAGE_STATUS.md` §6b.
- ~~Small-relative filter.~~ Rule F: drop faces with area < 10% of max surviving face. Topology-aware (relative, not absolute). Batch validated on 19 reference properties: −6 wrong_pitch, −2 ugly, 0 clean. See `ML_AUTO_BUILD_TRIAGE_STATUS.md` §6c.
- ~~Bad-fit steep filter (RFE-based).~~ Rule G: drop faces where RFE > 0.30 AND tilt > 40° AND area < 50% of max surviving. Three-way gate ensures no primary faces dropped. Batch: −9 wrong_pitch, −4 ugly, 0 clean. See `ML_AUTO_BUILD_TRIAGE_STATUS.md` §6c2.
- ~~Rule G expanded validation.~~ Tested against all 91 non-rejected drafts (not just 19 labeled). 52 total BFS drops, 0 clean-profile affected. 29 clean-candidate unlabeled drafts all unaffected. Verdict: KEEP. See `ML_AUTO_BUILD_TRIAGE_STATUS.md` §7.
- ~~Batch validation harness + per-face diagnostics.~~ `batch_validate.py` re-runs cleanup offline on stored drafts. `face_diagnostics` array in debug output for machine-readable per-face analysis.
- ~~Two-pass inlier refit in orientation module.~~ `_fit_plane()` in `ml_engine/core/stages/orientation.py`. When first-pass inlier_ratio < 0.60 and inlier count ≥ 12, refits lstsq on inlier-only samples. Diagnostics: `refit_fired`, `first_pass_tilt_deg`, `inlier_count`. Synthetic: +9° bias → +0.5°. Live-validated on 6 properties: 4 improved, 1 unchanged, 1 clean stable. Typical correction: 1–4°, max 58.8° (wall→roof). Zero regressions. See `ML_AUTO_BUILD_TRIAGE_STATUS.md` §8.7–8.8.
- ~~Polygon erosion before DSM sampling.~~ `EROSION_BUFFER_M = 0.5` in `orientation.py`. Binary mask erosion (pure numpy, separable square kernel) applied before DSM sampling in `_sample_dsm_for_plane()`. Falls back to un-eroded mask when eroded pixel count < 12. Live A/B on 6 properties: >40° faces 31→22 (−29%), >55° faces 14→9 (−36%). 4 improved, 1 mixed, 1 stable. See §8.10.
- ~~Orientation tuning track.~~ Complete. Refit (±15cm, two-pass) + erosion (0.5m) are final settings. ±10cm tested and rejected (§8.9). 1.0m erosion tested and rejected (§8.11). Broad validation on 18 properties (§8.12): user-facing >40° faces −46% vs stored baseline, >55° faces −100%. Residual: 15 faces in 40–55° band (22% of cleaned). Cannot improve further without RANSAC or DSM upgrade.
- ~~Build-level quality gate.~~ `STEEP_BAND_DEG=40°, STEEP_FRACTION_GATE=0.40, n_cleaned>=2` in `ml_ui_server.py`. Downgrades `auto_accept` → `needs_review`, appends `build_tilt_quality_low` to `review_policy_reasons`. Frontend label added to `REASON_LABELS`. Debug telemetry in `frame_debug.build_quality`. Live-validated: 6/18 flagged (all genuinely problematic), 0 clean false positives. See §8.13.
- ~~RANSAC robust plane fitting.~~ `_fit_plane_ransac()` in `orientation.py`. 100 iterations, deterministic (seed=42). Fires when first-pass inlier ratio < 0.60. Three-guard acceptance: better ir AND flatter tilt AND tilt < 40°. Falls back to two-pass refit if any guard fails. 18-property validation: >40° faces 15→9 (−40%), 0 clean regressions, +4 genuine faces rescued. See §8.14.
- ~~Finish the 30-property triage pass.~~ 32 rows bucketed (excluding 94 C St). `wrong_pitch` confirmed dominant at 14/32.
- ~~Surface ml-drafts.json as a debug-only page.~~ Read-only JSON triage surface shipped as `GET /api/ml-drafts` (summary + filters) and `GET /api/ml-drafts/:id` (full detail). Enhanced with `summarizeMlDraft()`, disposition filter, sorting, pagination (uncommitted in server.js).

**Do NOT touch right now (unless new evidence surfaces):**
- Usable gate floor (0.20 is well-calibrated; only move with ≥20 more borderline examples).
- Crop size (35m is working; only adjust if larger roofs clip).
- Core ML models (no retraining in this track).

---

## J. Recent milestones (newest first)

| Date | Milestone |
|---|---|
| 2026-04-19 | RANSAC robust plane fitting in orientation module. Three-guard acceptance (better ir + flatter tilt + tilt < 40°). 18-property validation: >40° faces 15→9 (−40%), 40–55° band 22%→12%. +4 genuine faces rescued from wall-dropping. 0 clean regressions. 5 properties improved (254 Foster, 22 New Spaulding, 29 Porter, 74 Gates, 43 Bellevue). See §8.14. |
| 2026-04-18 | Build-level quality gate implemented and validated. Rule: `n_cleaned >= 2 AND pct_above_40° >= 40%`. Downgrades auto_accept → needs_review, appends `build_tilt_quality_low`. 18-property live validation: 6 flagged (11 Ash Road 75%, 175 Warwick 67%, 254 Foster 50%, 74 Gates 50%, 29 Porter 40%, 13 Richardson 40%). 0 clean false positives. All 3 primary targets caught. See §8.13. |
| 2026-04-18 | Broad validation of current best baseline (18 properties). User-facing: 185 raw → 68 cleaned faces. >40° faces: 15 (22%). >55° faces: 0 (0%). 3/10 wrong_pitch RESOLVED (20 Meadow, Lawrence, 21 Stoddard). 2/4 ugly RESOLVED (583 Westford, 6 Court). All 4 clean stable. Before/after: >40° −46%, >55° −100%. Remaining failure: 40–55° residual tilt band (15 faces). Orientation tuning track closed. Next: build-level quality gate. See §8.12. |
| 2026-04-18 | 1.0m erosion tested and rejected. Same-session A/B: >40° faces 22→26 (+18%), >55° faces 9→13 (+44%) vs 0.5m. Root cause: at ~18px radius, many polygons fall back to un-eroded mask (< 12 pixels survive), losing the 0.5m benefit. Larger polygons over-eroded. Verdict: 0.5m is the tuned optimum. Orientation tuning track closed. See §8.11. |
| 2026-04-18 | Polygon erosion (0.5m) implemented and validated. `EROSION_BUFFER_M = 0.5` in `orientation.py`, applied as binary mask erosion before DSM sampling. Pure numpy separable square kernel, fallback to un-eroded mask when < 12 pixels survive. A/B test on 6 reference properties (same-session control vs erosion): >40° faces 31→22 (−29%), >55° faces 14→9 (−36%). Per-property: 20 Meadow improved (41.5°→29.2°), Lawrence strong (>40° 6→2), 583 Westford strong (>40° 7→3), 225 Gibson slight (>40° 11→10), 175 Warwick mixed (>40° +1 but >55° −1), 15 Veteran stable. Next: test 1.0m erosion. See §8.10. |
| 2026-04-18 | Inlier threshold ±10cm experiment: tested and rejected. ±10cm reduces corrections by 30–50% vs ±15cm because the ±10–15cm band contains helpful counter-bias roof points, not contamination. Key example: 225 Gibson plane_00 went from 50.5° (±15cm) to 57.7° (±10cm) — worse. All 6 properties: no improvement, some regressions. Revised understanding: the bottleneck is upstream edge contamination in sampled points, not inlier selection. Next: polygon erosion. See §8.9. |
| 2026-04-18 | Two-pass inlier refit live-validated. Fresh inference on 6 reference properties (4 wrong_pitch, 1 ugly, 1 clean). Refit fired on 39/58 faces (67%). Results: 4 improved, 1 unchanged (20 Meadow), 1 clean stable (15 Veteran). Typical corrections: 1–4° downward on 40–55° faces. Max correction: 71.1° → 12.3° (−58.8°, 225 Gibson wall→roof). Zero regressions. Corrections smaller than predicted (1–4° vs 15° expected) because ±15cm inlier threshold includes mildly contaminated edge points. Next: tighter inlier threshold or polygon erosion. See `ML_AUTO_BUILD_TRIAGE_STATUS.md` §8.8. |
| 2026-04-18 | Two-pass inlier refit implemented in `_fit_plane()` (`ml_engine/core/stages/orientation.py:427`). Synthetic validation: 29.5° → 20.5°, RMSE 1.03→0.04m. See §8.7. |
| 2026-04-18 | DSM orientation tilt-bias investigation complete. Root cause: single-pass lstsq in `_fit_plane()` contaminated by edge/wall pixels. 77% of wrong_pitch faces flagged `orientation_high_residual`; flagged faces have +15.6° median tilt vs unflagged (43.8° vs 28.2°). 100% of clean faces in 40–55° band are flagged. Fix identified: two-pass lstsq inlier refit (~15 lines in orientation.py). Expected to move 40–55° faces to 25–38° range. See `ML_AUTO_BUILD_TRIAGE_STATUS.md` §8. |
| 2026-04-18 | Rule G expanded validation: tested against all 91 non-rejected drafts in ml-drafts.json. 52 BFS drops total, 0 clean-profile affected. 29 clean-candidate unlabeled drafts all unaffected. 8 April 18 unlabeled properties analyzed — none qualify as clean (all show elevated tilt/RFE). Clean count confirmed at 4 (0 missing from triage paste). Surviving tilt analysis shows 40–55° band at 27% of wrong_pitch vs 17% of clean — overlap makes further wrapper rules unsafe. Verdict: KEEP Rule G, next phase is upstream DSM orientation investigation. |
| 2026-04-18 | Rule G (bad-fit steep filter) in `_geometry_cleanup()`: RFE>0.30 AND tilt>40° AND area<50% of max surviving. First RFE-based rule — threads `_rfe` from CRM adapter through internal faces. Three-way gate catches poorly-fit, steep, secondary faces with 0 clean false positives. Batch: 192→106 (was 192→119 before Rule G). Catches 9 wrong_pitch + 4 ugly + 0 clean. Cumulative cleanup: 192→106 (45% dropped). |
| 2026-04-18 | Batch debug phase: (1) Per-face diagnostics in `_geometry_cleanup()` debug output — `face_diagnostics` array with idx/tilt/area/short/long/aspect/conf/survived/dropped_by. (2) Batch validation harness `batch_validate.py` — offline re-run on 19 reference properties from stored ml-drafts.json, JSON+markdown output. (3) Rule F (small-relative filter): drop faces with area < 10% of max surviving face. Topology-aware, relative threshold. Batch result: 192→119 (was 192→127). Catches 6 wrong_pitch + 2 ugly + 0 clean additional faces. |
| 2026-04-18 | Narrow-face filter (Rule E) in `_geometry_cleanup()`: drop faces with short side < 2.0m. Catches eave/fascia/edge artifacts surviving steep+sliver+tiny rules. Validated on 5 triage cases: 225 Gibson 15→5, 175 Warwick 11→5, 583 Westford 15→6, 15 Veteran 4→3, 15 Buckman 2→2. Impact: 8% of wrong_pitch faces, 20% of ugly faces, 1 artifact from clean. |
| 2026-04-18 | Steep-face filter shipped in `ml_ui_server.py` `_geometry_cleanup()`. Rule D: drop faces with pitch > 60° (constant `STEEP_TILT_CEILING_DEG = 60.0`). Validated on 225 Gibson (15→9), 726 School (12→7), 583 Westford (15→12), 175 Warwick (11→9). Debug output: `dropped_steep` array in `frame_debug.geometry_cleanup`. No CRM changes. |
| 2026-04-18 | Triage pass complete: 32 rows bucketed. Final distribution: `wrong_pitch` 14, `ugly_but_correct_building` 6, `reject_correct` 5, `clean` 4, `reject_too_strict` 3; `wrong_target` / `gap_overlap` / `wrong_azimuth` all 0. Pitch analysis: 24% of wrong_pitch faces are >55° (walls), 29% are 40-55° (too steep). All from DSM-based orientation, not default-pitch fallback. Next engineering task: steep-face filter (tilt >60°) in ml_ui_server.py cleanup. 7 labeled rows lost to paste truncation; recovery needed. |
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
- `build_quality` — n_cleaned, n_steep_band, steep_fraction, flagged.
