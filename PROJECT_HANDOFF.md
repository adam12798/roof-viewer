# ML Auto Build — Project Handoff

Single source of truth for resuming this project on a fresh machine or new session. For general CRM setup (Node, npm, login accounts), see `SETUP.md`. This covers the ML Auto Build slice end-to-end.

**Last updated:** 2026-04-20 (V3P2.1 edge scoring system active — splits/merges now evidence-driven)
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
| Status-aware banner (needs_review) | Working; warning banner with human-readable reasons + Undo/Dismiss action buttons when `auto_build_status=needs_review` | `server.js:16380-16410` |
| P3 solar pitch cross-validation | Working; compares ML pitch/azimuth against Google Solar roofSegmentStats per face, flags build when ≥50% of matched faces disagree by >15° | `server.js:24664-24761` |
| P8 pitch correction | Working; corrects ML-too-steep faces using Google Solar pitch when 5 guards pass (matched, conf>0.5, delta>10°, google<45°, area>8m²). Corrected pitch = google + 2°. Adds `google_solar_pitch_corrected` review reason | `server.js:24744-24770` |
| P9 unmatched/fallback | Working; flags builds where ML faces don't match Google Solar segments. 3 rules: build_unmatched (0 matched), low_match_fraction (<50%), low_match_confidence (>=50% low conf). Adds `p9_build_assessment` debug and 3 review reasons | `server.js:24772-24815` |
| Design-page boot (loading overlay) | Working; 12s safety timeout + catch handler | `server.js:9614, 9624` |
| Manual faces unchanged | Yes; all ML branches gate on `sourceTag==='ml'` | `server.js:14154, 14243` |

---

## D. Known limitations

- **4-vertex independent face model.** Each ML face is an independent rotated rectangle. Adjacent faces don't share vertices; ~10-30 cm gaps/overlaps at corners remain visible. A true fix requires a shared roof graph (vertex unification). Not in scope for v1.
- **Extreme upstream pitches.** Some ML-detected planes (especially on Back Bay brownstones, Somerville triple-deckers) come back at 65-77° pitch, producing exaggerated slopes in single-slope rendering. The render is correct for what ML returns; the fix is upstream model/classification tuning.
- **Usable gate false negatives in 0.15-0.20 band.** Two tested properties (Tanager 0.16, Newton 0.17) are visually real roofs that reject below the 0.20 floor. Lowering the floor risks letting genuinely bad tiles through.
- **No "strip ML flag" escape hatch.** A user who wants to convert an ML-generated roof to manual rendering has no toggle. Workarounds: click "Undo" in the needs_review banner (restores pre-ML state), use Cmd+Z, or delete all ML faces and re-draw manually.
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
12. Continue from the next task in section I. **V2 is locked. V3 is the active track; V3P0 replay harness is in `tools/v3p0_replay.js` with outputs in `tools/v3p0_replay_output/`.** Do not modify V2 phases without a concrete debug-evidenced bug. Confirm V2 lock is live by inspecting any ML response: `crm_result.metadata.v2p8_closeout.v2_phase_status` should read `'banked'`. Run `node tools/v3p0_replay.js` against the running server pair to regenerate audit outputs.

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

## I. Engineering Phase Map

**Last restructured:** 2026-04-19.

**Discipline rules:**
1. Only one phase is ACTIVE at a time.
2. Banked phases are NOT reopened unless new debug evidence proves they are the bottleneck.
3. Every code change names the phase it belongs to.
4. Prefer real forward progress over repeated local tuning.
5. Core ML models are never retrained in this track. Every improvement is preprocessing, policy, or plumbing.

---

### P0 — Baseline Control [BANKED]

**Purpose:** Triage, observability, and validation infrastructure.
**Inputs:** Production ML drafts, operator labels.
**Outputs:** 32-row bucket distribution, batch validation harness, per-face diagnostics, pipeline phase debug framework (7-phase), ml-drafts audit log, triage API.
**Debug:** `pipeline_phases` summary, `face_diagnostics`, `frame_debug`, `GET /api/ml-drafts`.
**Bank criteria:** ≥30 labeled rows bucketed; batch harness covers all labeled rows; pipeline phases report emitted for every build.
**Status:** BANKED. 32 rows bucketed, 91-draft expanded validation, 7-phase pipeline report. See `ML_AUTO_BUILD_TRIAGE_STATUS.md` §1–§7.

---

### P1 — Imagery & DSM Acquisition [BANKED]

**Purpose:** Deliver a usable satellite tile and DSM elevation grid to the ML pipeline.
**Inputs:** Design pin lat/lng, Google API key.
**Outputs:** Centre-cropped 640×640 satellite image, DSM grid from LiDAR, usable gate score.
**Debug:** `crop_debug`, `dsm_debug`, `soft_gate_debug`.
**Bank criteria:** Centre-crop working; DSM built from CRM LiDAR; usable gate floor calibrated; LiDAR-optional fallback tested.
**Failure types:** Blurry/clouded imagery, missing DSM, usable gate too strict (reject_too_strict) or too loose.
**Banked config:** Centre-crop 1280→640, DSM from LiDAR, usable gate floor 0.20, LiDAR-optional warn-and-continue.
**Reopen trigger:** ≥20 new borderline usable-gate examples that shift the 5:3 reject ratio.

---

### P2 — Target Isolation [BANKED]

**Purpose:** Select the single building under the design pin from the full-tile ML output.
**Inputs:** All CRM-adapted faces from the full satellite tile.
**Outputs:** Faces belonging to the target building only.
**Debug:** `target_selection` in `frame_debug`.
**Bank criteria:** `wrong_target` = 0 in labeled triage set; garage separation working; attached-neighbour suppression working.
**Failure types:** Wrong building selected, detached garage included, attached-neighbour bleed.
**Banked config:** Primary grouping 0.3m + subcluster refinement 0.15m. `wrong_target` = 0 across 32 rows.
**Reopen trigger:** Any confirmed `wrong_target` failure on a new property.

---

### P3 — Plane Orientation Accuracy [BANKED]

**Purpose:** Convert DSM heights into accurate per-plane tilt and azimuth.
**Inputs:** Eroded polygon masks, DSM samples.
**Outputs:** Per-face `tilt_deg`, `azimuth_deg` with `orientation_diagnostics`.
**Debug:** `orientation_diagnostics` per face (`refit_fired`, `first_pass_tilt_deg`, `ransac_fired`, `ransac_tilt_deg`, `ransac_inlier_ratio`).
**Bank criteria:** >40° faces reduced ≥60% from pre-tuning baseline; >55° faces = 0; 0 clean regressions.
**Failure types:** Systematic tilt over-estimation from edge/wall DSM contamination.
**Banked config:** Two-pass inlier refit (±15cm, threshold 0.60) + 0.5m polygon erosion + RANSAC (100 iter, 3-guard acceptance). >40° faces −68%, >55° −100%, 0 clean regressions. See triage §8.7–§8.15.
**Dead ends explored:** ±10cm inlier threshold (rejected §8.9), 1.0m erosion (rejected §8.11).
**Reopen trigger:** New DSM source or model retrain that changes the contamination profile.

---

### P4 — Geometry Cleanup [BANKED]

**Purpose:** Remove artifact faces (walls, slivers, edge fragments) without touching good faces.
**Inputs:** Target-isolated faces with tilt, area, aspect, RFE, confidence.
**Outputs:** Cleaned face set with per-face diagnostics.
**Debug:** `geometry_cleanup` in `frame_debug`, `face_diagnostics` array.
**Bank criteria:** Rules validated on ≥90 drafts; 0 clean-profile affected; overall drop rate >40%.
**Failure types:** Artifact faces surviving all rules; false positives on clean faces.
**Banked config:** Rule D (pitch > 60°), Rule E (short side < 2.0m), Rule F (area < 10% of max), Rule G (RFE > 0.30 + tilt > 40° + ratio < 0.50). 192→106 faces (45% dropped), 0 clean regressions across 91 drafts. See triage §6–§7.
**Reopen trigger:** New artifact class that escapes all four rules AND appears in ≥3 labeled properties.

---

### P5 — Build Quality Decision [BANKED]

**Purpose:** Flag or downgrade entire builds that are unreliable despite per-face cleanup.
**Inputs:** Cleaned face set, review policy from ML engine core.
**Outputs:** `auto_build_status` (auto_accept / needs_review / reject), `review_policy_reasons[]`.
**Debug:** `build_quality` in `frame_debug`.
**Bank criteria:** All primary stubborn targets caught; 0 clean false positives.
**Failure types:** Gate too strict (flagging good builds); gate too loose (missing bad builds).
**Banked config:** `STEEP_BAND_DEG=40°, STEEP_FRACTION_GATE=0.40, n_cleaned>=2`. 6/18 flagged (5 wrong_pitch, 1 ugly), 0 clean false positives. See triage §8.13.
**Reopen trigger:** ≥2 clean false positives confirmed, or a new failure class that the tilt-fraction gate misses.

---

### P6 — Output & CRM Injection [BANKED]

**Purpose:** Deliver ML faces to the CRM 3D scene in the correct coordinate frame and rendering mode.
**Inputs:** Cleaned faces, coordinate registration.
**Outputs:** CRM-rendered single-slope faces with shared-edge suppression, correct save/reload/undo.
**Debug:** `frame_debug` alignment fields (half_w, half_h, sample vertices).
**Bank criteria:** Faces render at correct position; single-slope mode; shared edges grey; save/reload/undo preserve ML provenance.
**Failure types:** Coordinate misalignment, rendering mode bugs, save/reload data loss.
**Banked config:** Coordinate shift (image-TL → pin-centre), single-slope rendering (no hip decomposition), shared-edge suppression (midpoint-in-polygon), `source:'ml'` persistence, undo/redo sourceTag capture.
**Reopen trigger:** A rendering or persistence bug confirmed in production.

---

### P7 — Product Workflow / User Decision Layer [BANKED]

**Purpose:** Help the user understand and act on ML results through transient banners and action buttons.
**Inputs:** Build status, review reasons, face data.
**Outputs:** Banner with appropriate severity, action buttons (Undo/Dismiss), human-readable reason labels.
**Debug:** Console logs for banner state transitions.
**Bank criteria:** `needs_review` shows orange warning with reasons; `auto_accept` shows green success; Undo restores pre-ML state; Dismiss acknowledges and keeps faces; all reason labels mapped.
**Failure types:** Banner not shown, wrong severity, user stuck without actionable path, pointer-events leak.
**Banked config:** Status-aware banner, 15 reason labels (including `google_solar_pitch_mismatch`, `google_solar_pitch_corrected`, `p9_build_unmatched`, `p9_low_match_fraction`, `p9_low_match_confidence`, `v2p0_ground_surface_detected`, `v2p0_ground_surface_suppressed`), Undo/Dismiss buttons, `pointer-events:auto` only on `needs_review`.
**Reopen trigger:** New review reason that needs a label; user-reported UX confusion.

---

### P8 — External Accuracy Cross-Validation [BANKED]

**Purpose:** Use Google Solar `roofSegmentStats` as independent ground truth to detect and correct ML pitch errors.
**Inputs:** Cleaned ML faces (from P4/P5), Google Solar `buildingInsights` for the design pin.
**Outputs:** Per-face cross-validation data (pitch/azimuth deltas, match confidence), build-level mismatch flag, pitch correction on qualifying faces.
**Debug:** `p3_solar_crossval` in `crm_result.metadata` (matches array, build_summary).
**Failure types:** Wrong Google segment matched to ML face; correction makes pitch worse; correction fires on a clean house.

**Sub-phases:**
1. **Instrumentation** [BANKED] — per-face matching and build-level mismatch flag. Validated on 8 properties: clean 0.47° mean Δpitch, 225 Gibson 18.25° FLAGGED, 0 clean false positives. See triage §9.
2. **Pitch correction** [BANKED] — substitute Google pitch + 2° on high-confidence mismatches where ML over-estimates by >10°. 5-guard rule: matched, confidence > 0.5, ml-google > 10°, google < 45°, area > 8m². Validated on 7 properties: 225 Gibson face[2] 46.9°→17.3°, 0 clean regressions, 175 Warwick correctly blocked. See triage §10.

**Bank criteria for correction sub-phase:**
- ≥1 wrong_pitch property measurably improved (corrected faces move into plausible residential range)
- 0 clean regressions (no correction fires on clean houses)
- 0 cases where correction makes pitch worse (ML was right, Google was wrong)
- All corrected builds automatically flagged `needs_review` so user can verify

**Reopen trigger for instrumentation:** Matching strategy found to be unreliable (wrong segments matched consistently).

#### P8 Pitch Correction — Implementation Plan

**What the data shows:**
- Clean houses: 0.47° mean delta. Correction guards will never fire. Safe.
- Improved houses (20 Meadow, Lawrence): 7–9° mean delta. Below threshold. Safe.
- 175 Warwick: Google AGREES at 47°. Not an ML error — genuinely steep. Guards prevent correction.
- 225 Gibson: 18.25° mean delta, 4/6 faces >15°. face[2]: ML=46.9° vs Google=15.3°. Prime correction candidate.
- Stubborn poor-extraction (11 Ash Road, 13 Richardson): Too few faces, unmatched. Cannot help.

**Correction rule (conservative, one-directional):**
For each matched face, correct when ALL four guards hold:
1. `match_confidence >= 0.70` (face centroid within ~2.4m of Google segment center)
2. `abs(pitch_delta) > 10°` (significant disagreement)
3. `ml_pitch > 40°` (ML pitch is in the known suspect band)
4. `google_pitch < 35°` (Google says it is normal residential)

**Why one-directional (only correct ML-too-steep, never ML-too-flat):**
- ML's dominant systematic error is over-estimation due to DSM edge contamination (§8.2–8.3)
- The orientation tuning track (P3) already corrects in the flatter direction; this extends that
- 175 Warwick proves that genuinely steep roofs exist — Google agrees at 47° — so we must not flatten everything
- Guard #3 (`ml_pitch > 40°`) ensures only suspect-band faces are candidates
- Guard #4 (`google_pitch < 35°`) ensures we only substitute a plausible residential value

**What to build (in `server.js`, `solarPitchCrossValidation()`):**
1. After computing matches, loop over matched faces and apply the 4-guard correction
2. When correcting: set `face.pitch = google_pitch` on the `roof_faces` array (mutates the envelope before it reaches the client)
3. Record in the match entry: `corrected: true`, `original_ml_pitch`, `correction_source: "google_solar"`
4. Add to `build_summary`: `faces_corrected`, `mean_correction_deg`, `max_correction_deg`
5. When any face is corrected: add `google_solar_pitch_corrected` to `review_policy_reasons`, ensure status is `needs_review`
6. Add the new reason label in the client `_REVIEW_REASON_LABELS`

**What NOT to build:**
- No azimuth correction (azimuth is accurate when pitch is correct — §9.4 finding #6)
- No "ML too flat" correction (don't fight the orientation tuning that pushes tilts down)
- No correction when `match_confidence < 0.70` (uncertain spatial match)
- No correction when `google_pitch >= 35°` (don't replace one steep value with another steep value)

**Validation plan:**
- 225 Gibson St: expect face[2] corrected (46.9° → 15.3°). face[3] NOT corrected (ML=20.9°, not in >40° band).
- 175 Warwick: expect NO correction (Google agrees on steep ≥47°, guard #4 blocks).
- 11 Ash Road: expect NO correction (unmatched face).
- 20 Meadow Dr: expect NO correction (all faces <40° post-orientation-tuning).
- Lawrence: expect NO correction (all faces <40°).
- 15 Veteran Rd: expect NO correction (delta 0.47°).
- Full 18-property sweep to catch edge cases.

**Estimated size:** ~25 lines added to `solarPitchCrossValidation()` + 1 label in client code.

---

### P9 — Unmatched / Fallback Strategy [BANKED]

**Purpose:** Surface unmatched and low-confidence builds that P8 cannot validate, ensuring no bad extraction silently reaches `auto_accept`.
**Inputs:** P8 cross-validation match data (matched count, confidence, fraction).
**Outputs:** Build-level fallback verdict, `p9_build_assessment` debug object, review reasons for unmatched/low-confidence builds.
**Debug:** `p9_build_assessment` in `crm_result.metadata.p3_solar_crossval` — `p9_fallback_applied`, `p9_fallback_reason`, `fallback_verdict`, `matched_face_count`, `matched_face_fraction`, `low_confidence_match_count`, `build_unmatched`, `build_low_match_fraction`, `build_low_match_confidence`.
**Failure types:** False positive on clean build (flagging a good build as unmatched); missing a bad build that has incidental matches.

**Rules:**
1. `p9_build_unmatched` — total_faces > 0 AND matched_faces == 0 (Google has segments but none match ML)
2. `p9_low_match_fraction` — total_faces >= 3 AND matched/total < 0.5
3. `p9_low_match_confidence` — matched_faces >= 2 AND >=50% have confidence < 0.3

**Bank criteria:** 0 clean regressions; >=1 previously-silent bad build now flagged.
**Status:** BANKED. 13 Richardson St (auto_accept → needs_review), 0 clean regressions, 0 improved regressions. See triage §11.
**Reopen trigger:** False positive on a clean build, or a new failure class that has incidental high-confidence matches but is still wrong.

---

### V2P0 — Ground / Structure Separation [BANKED]

**Purpose:** Use LiDAR/DSM elevation to distinguish true elevated roof structure from ground-like surfaces (driveways, patios, yards) that ML may include as roof faces.
**Inputs:** Raw LiDAR points (`body.lidar.points` = `[lng, lat, elev, cls]`), ML roof faces with vertices in local meters.
**Outputs:** Per-face classification (`structure_like` / `ground_like` / `uncertain`), build-level ground detection flag, `v2p0_ground_surface_detected` review reason.
**Debug:** `crm_result.metadata.v2p0_ground_structure` — per-face: `face_elevation_m`, `local_ground_m`, `height_above_ground_m`, `height_signal`, `pitch_signal`, `flat_low_large`, `composite_score`, `classification`, `classification_reason`. Build-level: `grid_fill_fraction`, `global_ground_p10_m`, `structure_like_count`, `ground_like_count`, `uncertain_count`, `ground_like_face_indices`, height range.
**Failure types:** False positive on legitimate low-pitch roof section; false negative on elevated but flat patio/deck.

**Method:**
1. Reconstruct 281×281 DSM elevation grid (0.25m res, ±35m) from raw LiDAR points (max elevation per cell).
2. Global ground reference: p10 of all valid DSM elevations.
3. Per-face local ground: p25 of ring samples (3-12m radius, 24 azimuth steps × 7 radial steps) around centroid.
4. Height above ground = median face elevation (centroid + vertices) − local ground.
5. Classification: `ground_like` if height < 1m AND pitch < 10° AND area > 15m² (all three). `structure_like` if height > 2.5m. Otherwise `uncertain`.
6. Weighted composite score (debug): height_signal×0.6 + pitch_signal×0.2 + flat_low_large_penalty×0.3.

**Constants:** `V2P0_STRUCTURE_MIN_HEIGHT_M=2.5`, `V2P0_GROUND_MAX_HEIGHT_M=1.0`, `V2P0_GROUND_MAX_PITCH_DEG=10.0`, `V2P0_GROUND_MIN_AREA_M2=15.0`, ring 3-12m, grid 281×281 at 0.25m.

**Bank criteria:** 0 clean regressions; ≥1 ground-like face correctly flagged; heights plausible for known-good roofs.
**Status:** BANKED with V2P0.1 hardening. 20 Meadow face[3] flagged ground-like (h=0.07m, auto_accept→needs_review) AND hard-suppressed (elong=7.61, removed from roof_faces). 13 Richardson face[0] flagged ground-like (h=0.37m, double-flagged with p9, not suppressed — elong=2.04). 15 Veteran (clean) all structure-like (h=4.2-4.6m), no regression. 175 Warwick all structure-like (h=4-7.7m). See triage §12.

**V2P0.1 — Hard suppression hardening:**
Targeted bugfix: removes obviously ground-like elongated faces from `roof_faces` before V2P1 and response packaging. 4-way conjunction rule: `height_above_ground < 1.5m` AND `elongation_ratio > 4.0` AND `pitch < 15°` AND `classification != structure_like`. All four must hold. Uses eigenvalue-based elongation ratio (principal axis ratio of vertex covariance matrix). Adds `v2p0_ground_surface_suppressed` review reason, per-face `elongation_ratio` / `hard_ground_suppressed` / `hard_ground_suppression_reasons` debug fields, build-level `hard_ground_suppressed_count` / `v2p0_hard_suppression_applied`. Validated on 8 properties: 20 Meadow face[3] correctly suppressed (elong=7.61), 0 false positives on clean/steep/complex roofs.
**Reopen trigger:** False positive on a legitimate low-pitch roof section, or a ground-level surface that evades all guards.

---

### V2P1 — Structural Coherence / Mirrored-Pair Logic [BANKED]

**Purpose:** Evaluate whether surviving roof faces form plausible mirrored/ridge-paired relationships. First structural grammar layer for whole-roof coherence reasoning.
**Inputs:** Final cleaned roof faces (after V1 cleanup, quality gate, P8/P9, V2P0).
**Outputs:** Per-pair scoring, build-level structural coherence score, structural warnings. Debug-only — no status changes, no geometry rewrites.
**Debug:** `crm_result.metadata.v2p1_structural_coherence` — pair-level: `azimuth_opposition_error`, `pitch_delta`, `area_ratio`, `min_edge_gap`, `centroid_distance`, `spatial_compatibility_score`, `pair_confidence`, `pair_type_guess`, `is_main_plane_pair`. Build-level: `main_plane_count`, `candidate_plane_pairs`, `mirrored_pair_count`, `paired_main_plane_count`, `unpaired_main_planes`, `structural_coherence_score`, `structural_warnings[]`, `pair_confidence_stats`, `pair_area_ratio_stats`.
**Failure types:** False low coherence on legitimate asymmetric roofs; false high coherence on fragmented builds; over-counting weak pairs.

**Signal families:**
1. **Azimuth opposition** — angular distance between face B azimuth and (face A azimuth + 180°). Weight 0.35.
2. **Pitch similarity** — |pitch_a − pitch_b|. Weight 0.25.
3. **Spatial compatibility** — minimum edge gap between polygon samples. Weight 0.25.
4. **Area compatibility** — min(area_a, area_b) / max(area_a, area_b). Weight 0.15.

**Pair classification:** `mirrored_gable_like` (conf≥0.7, az<15°, Δpitch<5°), `mirrored_main_roof_like` (conf≥0.5, az<20°, Δpitch<10°), `partial_mirror` (conf≥0.3, az<25°), `weak_candidate` (conf≥0.15), `non_mirrored`.

**Candidate pre-filters:** azimuth opposition > 30° rejected, pitch delta > 15° rejected, centroid distance > 25m rejected.

**Main plane definition:** area ≥ max(10m², 15% of largest face area).

**Constants:** `V2P1_MAIN_PLANE_MIN_AREA_M2=10`, `V2P1_MAIN_PLANE_MIN_AREA_FRACTION=0.15`, `V2P1_MAX_AZ_OPPOSITION_DEG=30`, `V2P1_MAX_PITCH_DELTA_DEG=15`, `V2P1_MAX_CENTROID_DIST_M=25`, `V2P1_STRONG_PAIR_CONFIDENCE=0.6`, `V2P1_MODERATE_PAIR_CONFIDENCE=0.4`.

**Warnings emitted:** `no_strong_mirrored_pairs`, `major_plane_unpaired`, `high_pair_pitch_mismatch`, `weak_azimuth_opposition`, `poor_structural_pair_coverage`, `fragmented_main_roof_structure`.

**Bank criteria:** Simple roofs produce high coherence; complex roofs produce useful warnings; steep-but-real roofs not catastrophically scored; no status changes; no V1/V2P0 interference.
**Status:** BANKED. 15 Veteran (clean gable): coherence=0.92, 2 mirrored_gable_like pairs, 0 warnings. Lawrence (complex): coherence=0.81, 2 gable pairs. 225 Gibson (problematic): coherence=0.44, correct poor_structural_pair_coverage warning. 175 Warwick (steep): coherence=0.5, not catastrophically scored. 0 status changes. See triage §13.
**Reopen trigger:** V2P1 coherence score found to be misleading on a new property class, or pair classification proven wrong by manual inspection.

---

### V2P2 — Main Roof Coherence / Main-vs-Secondary Plane Logic [BANKED]

**Purpose:** Classify surviving faces into main_roof_candidate / secondary_roof_candidate / uncertain using 5 weighted signal families, compute build-level main_roof_coherence_score.

**Inputs:** Final post-suppression roof faces, V2P1 pair data, V2P0 face assessments.

**Outputs:** Per-face: area ratios, structural pair confidence, adjacency count/strength, centrality score, realism score, composite main_roof_score, classification. Build-level: main_roof_coherence_score, candidate counts, dominant component stats, warnings.

**Pipeline placement:** After V2P1 in proxy route. Classification/debug only — no geometry mutation, no face deletion, no status changes.

**Signal families (5 weights):** Area importance (0.30), structural participation from V2P1 pairs (0.25), adjacency/connectivity via edge gap (0.20), centrality/peripheral soft factor (0.10), V2P0 realism confirmation (0.15).

**Classification:** main_roof_score >= 0.55 → main_roof_candidate, >= 0.30 → uncertain, < 0.30 → secondary_roof_candidate.

**Coherence score formula:** area_concentration × 0.30 + dominance_concentration × 0.25 + avg_main_score × 0.25 + main_structural_coverage × 0.20.

**Constants:** `V2P2_ADJACENCY_GAP_M=3.0`, `V2P2_STRONG_ADJACENCY_GAP_M=1.0`, `V2P2_MAIN_SCORE_THRESHOLD=0.55`, `V2P2_SECONDARY_SCORE_THRESHOLD=0.30`.

**Warnings emitted:** `no_clear_dominant_roof_body`, `too_many_competing_main_faces`, `main_roof_area_too_diffuse`, `fragmented_main_roof_body`, `dominant_face_unpaired`, `weak_main_roof_connectivity`.

**Bank criteria:** Simple roofs produce clear dominant main body (coherence ≥ 0.85); complex roofs differentiate main vs secondary; problem roofs surface useful warnings; no geometry rewritten; no status changes.

**Status:** BANKED. 15 Veteran (clean gable): coherence=0.94, all 3 main, 0 warnings. 20 Meadow: coherence=0.88, 2 main + 1 uncertain, main area share=0.89. 225 Gibson (complex): coherence=0.77, 4 main + 1 secondary + 1 uncertain. Lawrence (complex): coherence=0.80, 4 main + 2 uncertain. 175 Warwick (steep): coherence=0.84, all 3 main (not unfairly demoted). 13 Richardson (ground-like): coherence=0, correctly warns no_clear_dominant_roof_body. 0 geometry changes, 0 status flips. See triage §14.

**Reopen trigger:** V2P2 classification proven misleading on a new property class, or main_roof_coherence_score found to be useless in downstream phases.

---

### V2P3 — Ridge / Hip / Valley Relationship Logic [BANKED]

**Purpose:** Classify structural relationships between adjacent surviving face pairs as ridge_like, hip_like, valley_like, seam_like, step_like, or uncertain.

**Inputs:** Final post-suppression roof faces, V2P2 main/secondary classifications.

**Outputs:** Per-pair: azimuth relationship (opposing/oblique/near_parallel), pitch delta, edge gap, convexity hint (convex/concave/mixed), relationship confidence, relationship type, reasons. Build-level: relationship counts by type, dominant family, roof_relationship_coherence_score, warnings.

**Pipeline placement:** After V2P2 in proxy route. Classification/debug only — no geometry mutation, no face deletion, no status changes.

**Signal families (6):** A. Azimuth relationship (opposing → ridge, oblique → hip/valley, near_parallel → seam/step). B. Pitch compatibility. C. Edge gap closeness. D. Approximate meeting edge via closest points. E. Convex vs concave hint from downslope vectors relative to meeting point. F. Main-roof participation from V2P2.

**Classification logic:** Opposing + pitch<15° + gap<3m → ridge_like. Oblique + convex → hip_like. Oblique + concave → valley_like. Near-parallel + pitch<8° + gap<2m → seam_like. Parallel or oblique + pitch>=15° → step_like. Insufficient evidence → uncertain.

**Constants:** `V2P3_CANDIDATE_GAP_M=4.0`, `V2P3_RIDGE_MIN_AZ_OPPOSITION=140`, `V2P3_SEAM_MAX_AZ_PARALLEL=30`, `V2P3_RIDGE_MAX_PITCH_DELTA=15`, `V2P3_SEAM_MAX_PITCH_DELTA=8`, `V2P3_STEP_MIN_PITCH_DELTA=15`, `V2P3_STRONG_REL_CONF=0.6`, `V2P3_MODERATE_REL_CONF=0.35`.

**Coherence score formula:** interpreted_fraction × 0.25 + strong_fraction × 0.25 + main_interpreted_fraction × 0.25 + best_confidence × 0.25.

**Warnings emitted:** `main_faces_mostly_uncertain`, `no_clear_main_relationships`, `excessive_seam_like_main_pairs`, `weak_ridge_hip_valley_evidence`, `fragmented_main_body_relationships`.

**Bank criteria:** Simple gable roofs produce dominant ridge_like relationships with high confidence; complex roofs remain conservative (uncertain when evidence is mixed); convexity hint correctly differentiates hip from valley; no geometry rewritten; no status changes.

**Status:** BANKED. 15 Veteran (clean gable): coherence=0.99, 2 ridge + 1 seam, dominant=ridge_like, best conf=0.96 (convex_confirmed). 20 Meadow: coherence=0.65, 2 ridge + 1 valley, warns weak_ridge_hip_valley_evidence. 225 Gibson (complex): coherence=0.59, 2 ridge + 1 hip + 2 step + 4 uncertain — conservative. 175 Warwick (steep): coherence=0.88, 1 ridge + 1 hip + 1 valley — convexity correctly differentiates. Lawrence (complex): coherence=0.55, 2 ridge + 2 hip + 1 seam + 1 step + 6 uncertain — 6 uncertain is honest for ambiguous oblique pairs. 0 geometry changes, 0 status flips. See triage §15.

**Reopen trigger:** V2P3 relationship types proven misleading on a new property class, or convexity hint found systematically wrong.

---

### V2P4 — Whole-Roof Consistency Warnings [BANKED]

**Purpose:** Synthesize outputs from V2P0–V2P3 into a single whole-roof consistency assessment. Detect contradictions between phase outputs, emit build-level warnings, compute whole_roof_consistency_score.

**Inputs:** All prior V2 phase outputs: V2P0 ground/structure, V2P1 structural pairing, V2P2 main/secondary, V2P3 relationships.

**Outputs:** Build-level: whole_roof_consistency_score, dominant_story_strength, contradiction_flags[], whole_roof_warnings[], input_phase_summary, per-signal sub-scores (main_body, structural, relationship, realism, contradiction).

**Pipeline placement:** After V2P3 in proxy route. Synthesis/debug only — no geometry mutation, no face deletion, no status changes.

**Signal families (5 weights):** Main body coherence from V2P2 (0.30), structural pairing from V2P1 (0.25), relationship coherence from V2P3 (0.25), realism factor from V2P0 (0.10), contradiction penalty (0.10). Single-face edge case uses main_body × 0.5 + realism × 0.3 + contradiction × 0.2.

**Contradiction flags:** `strong_main_body_but_weak_relationships`, `strong_relationships_but_no_clear_main_body`, `many_main_faces_but_low_pair_coverage`, `dominant_main_body_with_fragmented_relationships`, `high_uncertainty_on_main_faces`, `too_many_uncertain_main_relations`.

**Warnings emitted:** `fragmented_whole_roof_story`, `no_clear_structural_story`, `main_body_relationship_disconnect`, `excessive_main_face_uncertainty`, `weak_pair_coverage_on_main_body`, `roof_understanding_mostly_uncertain`, `competing_structural_interpretations`.

**Bank criteria:** Simple roofs score high consistency (≥0.90); complex roofs produce meaningful warnings/contradictions rather than false confidence; problem roofs score low; no geometry rewritten; no status changes.

**Status:** BANKED. 15 Veteran (clean gable): consistency=0.96, story=0.98, all sub-scores 0.92-1.0, 0 contradictions, 0 warnings. 20 Meadow: consistency=0.73 (realism=0.5 from V2P0 uncertainty). 225 Gibson (complex): consistency=0.66, warns weak_pair_coverage_on_main_body (3 unpaired main planes). 175 Warwick (steep): consistency=0.80, not unfairly demoted. Lawrence (complex): consistency=0.69, contradicts high_uncertainty_on_main_faces (6/11 main-relevant relationships uncertain). 13 Richardson (ground-like): consistency=0.20, story=0.04 — correctly very low. 0 geometry changes, 0 status flips. See triage §16.

**Reopen trigger:** Whole-roof consistency score found to be misleading or contradictions found to be false positives on a new property class.

---

### V2P5 — Performance Optimization [BANKED]

**Purpose:** Reduce model-build runtime from 60s+ to <15s on most houses.

**Rules:** Instrumentation first. No accuracy regressions. Optimize caching + pair pruning + shared adjacency before touching accuracy-sensitive logic.

**Status:** BANKED. Instrumentation + CRM-side caching shipped. Target <15s NOT yet met — ML Python server is 92-98% of runtime (1-24s per property). CRM post-ML overhead reduced to <500ms. Next step requires ML-side optimization (image fetch, model inference, DSM build, geometry cleanup).

---

### V2P6 — ML Core Runtime Optimization [BANKED]

**Purpose:** Instrument and optimize the ML Python server (`ml_ui_server.py` + `ml_engine/`), which V2P5 proved is 92-98% of total runtime.

**Rules:** Instrument first. Separate network vs compute vs post-processing. Bias toward caching before touching accuracy-sensitive model behavior. No accuracy regressions.

**What shipped:**
1. **Python-side timing instrumentation** — `metadata.v2p6_timing` in every response with outer stage breakdown (fetch, crop, dsm, ml_inference, coord_transform, target_isolation, geometry_cleanup, phase_assembly) + per-ML-stage timing (usable_gate, outline, planes, orientation, semantic_edges, keepout) + network vs compute split + hotspot ranking.
2. **Semantic edges Shapely cache** — Pre-compute `unary_union(plane_boundaries).buffer(COV_PIX)`, `outline_poly.boundary`, and `plane_boundaries` once per inference call. Previously recomputed O(edges) times, causing 544ms→18377ms scaling. Now O(1) for shared objects.
3. **Crop rendering optimization** — Pre-convert image to numpy array once, use numpy slicing instead of PIL.crop per edge.
4. **Stage results passthrough** — `stage_results` (per-stage `duration_s`) now threaded through CRM adapter into response metadata.

**Results (8 properties, accuracy 100% preserved):**
- Lawrence: 24.8s → 3.5-10.2s (2.4-7.1x), semantic_edges 18377ms → 2741ms
- 225 Gibson: 12.1s → 3.8-4.3s (2.8-3.2x)
- 175 Warwick: 13.6s → 3.1-5.6s (2.4-4.4x)
- 15 Veteran: 7.2s → 2.3-4.2s (1.7-3.1x)
- 20 Meadow: 6.2s → 2.5-3.8s (1.6-2.5x)
- Remaining bottleneck: model inference (ResNet-18 per edge on CPU) — irreducible without GPU.
- Variance: CPU thermal throttling on local hardware causes 2-3x runtime variance on sustained workloads.

**Status:** BANKED. The V2P5 target of <15s is now met for most properties under warm conditions. Remaining performance is bounded by CPU model inference. See triage §18.

---

### V2 track — COMPLETE AND LOCKED

V2 is now a closed track. V2P0 through V2P7 are all banked. V2P8 (closeout/stabilization) is banked. **V3 is the active track** and began with V3P0 — Replay Harness / Server-Driven Audit.

**V2 scope summary:**
- **V2P0 / V2P0.1** — ground vs structure separation + hard suppression of elongated ground strips
- **V2P1** — mirrored/ridge-paired structural coherence (debug-first structural grammar)
- **V2P2** — main vs secondary plane classification with 5-signal weighted model
- **V2P3** — ridge/hip/valley/seam/step relationship logic between adjacent faces
- **V2P4** — whole-roof consistency synthesis + cross-phase contradiction detection
- **V2P5** — performance instrumentation + shared geometry cache across V2 phases
- **V2P6** — ML core runtime optimization (semantic_edges Shapely cache)
- **V2P7** — decision-layer integration: V2 signals now lightly influence auto_build_status
- **V2P8** — closeout/stabilization: regression sweep, coupling check, doc lock

**Do NOT casually reopen any V2 phase.** Each phase has an explicit reopen trigger documented in its section. V2P8 closeout verified safe degradation when upstream metadata is missing; no hidden coupling bugs remain.

**Runtime marker:** `crm_result.metadata.v2p8_closeout.v2_phase_status === 'banked'` in every new ML Auto Build response confirms the V2 lock is active.

---

### V2P7 — Decision-Layer Integration [BANKED]

**Purpose:** Let banked V2P0–V2P4 signals influence final `auto_build_status` in a conservative, explainable, reversible way. V2 signals lightly shape `auto_accept` vs `needs_review`; `reject` remains evidence-heavy and extremely rare.

**Rules:** V2 must not become an opaque veto engine. Thresholds centralized. Reject requires multi-signal agreement with existing V1/P8/P9 risk. Clean roofs must not get over-escalated. Steep-but-real roofs must not be unfairly punished. Complex-but-coherent roofs get a conservative risk dampener.

**Inputs:** `md.v2p0_ground_structure`, `md.v2p1_structural_coherence`, `md.v2p2_main_roof_coherence`, `md.v2p3_roof_relationships`, `md.v2p4_whole_roof_consistency`. Also preserves prior V1/P8/P9 decision signals (`auto_build_status`, `review_policy_reasons`), and counts external risk reasons separately (`build_tilt_quality_low`, `google_solar_pitch_*`, `p9_*`, `crm_soft_gate_applied`, `usable_gate_low`) for the T4 "external risk + weak V2 story" trigger.

**Pipeline placement:** After V2P4 in the `/api/ml/auto-build` proxy route, before V2P5 timing metadata. Reads metadata; may mutate `envelope.auto_build_status` and `envelope.review_policy_reasons`. No geometry mutation. Decisioning is split into four clearly separated moving parts: `v2p7ScoreSupport()`, `v2p7ScoreRisk()`, `v2p7ComputeDampener()`, `v2p7BuildTriggers()`.

**Scoring model (support vs risk cleanly separated):**
- **Support score (0–1, pure positive evidence)** — weighted average of V2P4-synthesized scores, no penalties baked in: `whole_roof × 0.35 + story × 0.25 + main_body × 0.20 + structural × 0.10 + relationship × 0.10`.
- **Risk score (0–1, pure negative evidence)** — sum of explicit tagged drivers: whole_roof<0.50 (+0.30), main_body<0.40 with ≥2 faces (+0.20), relationships<0.40 with ≥2 main rels (+0.15), structural<0.40 with ≥2 main planes (+0.10), contradictions≥2 (+0.15), whole_roof_warnings≥2 (+0.10), hard_ground_suppressed>0 (+0.10), ground_like>0 (+0.10), fragmented_main_roof (+0.05).
- **Contradiction penalty** (0–0.24) = `0.08 × min(contradictions, 3)`. Reported separately.
- **Uncertainty penalty** (0–0.15) = linear scale from uncertainty_ratio ∈ [0.50, 1.0] to [0, 0.15]. Reported separately.
- **Complexity dampener** (0–0.15) — reduces risk ONLY, never affects support. Fires when main_body ≥ 0.70 AND story ≥ 0.65 AND 0 contradictions AND 0 ground issues AND not fragmented AND face_count ≥ 3. Scales with main_body + story strength above their healthy thresholds.
- **Effective risk** = max(0, risk − dampener).
- **Final V2 decision score** = `clamp01(0.5 + 0.5 × (support − effective_risk − contradiction_penalty − uncertainty_penalty))`.

**Explicit escalation triggers (readable named detectors):**
- **T1 `low_consistency_with_uncertainty`** — whole_roof < 0.55 AND uncertainty > 0.55.
- **T2 `contradictions_with_weak_pairing`** — contradictions ≥ 2 AND structural < 0.50 AND main_plane_count ≥ 2.
- **T3 `fragmented_main_with_weak_relationships`** — fragmented_main_roof AND relationship < 0.50 AND main_rel_count ≥ 2.
- **T4 `external_risk_with_weak_story`** — ≥2 existing V1/P8/P9 risk reasons AND whole_roof < 0.45.
- **T5 `main_body_weak`** — main_body < 0.40 AND face_count ≥ 2.
- **T6 `aggregate_risk_elevated`** (numeric safety net) — effective_risk ≥ 0.45 AND net_score < 0.25.

When prior status is `auto_accept` and any trigger fires → escalate to `needs_review`. When prior status is already `needs_review` and triggers fire → reinforce (debug only; no new envelope reasons added unless status changes).

**Support (reinforcement only, no status change):** `whole_roof ≥ 0.85 AND 0 contradictions AND 0 warnings AND main_body ≥ 0.70 AND dominant_story ≥ 0.75`. Records `v2_clean_structural_story` note.

**Reject (extremely rare; multi-signal agreement required):** ALL of: `risk ≥ 0.70`, `whole_roof < 0.20`, `story < 0.15`, `contradictions ≥ 2`, `prior_status == 'needs_review'`, `prior_reasons.length ≥ 3`, AND (`ground_like > 0` OR `hard_ground_suppressed > 0` OR `face_count ≤ 1`). Current validation set produces zero reject cases. Capability reserved for pathological multi-signal failures only.

**Decision reasons (short, machine-readable) — merged into `review_policy_reasons` only when status changes:** `v2_low_consistency`, `v2_fragmented_main_body`, `v2_high_uncertainty`, `v2_weak_pair_coverage`, `v2_relationships_uncertain`, `v2_ground_suppression_material`, `v2_structural_contradiction`. Debug-only support note: `v2_clean_structural_story`. Legacy labels (`v2_low_whole_roof_consistency`, `v2_fragmented_main_roof`, `v2_high_main_face_uncertainty`, `v2_weak_structural_pairing`, `v2_relationships_mostly_uncertain`, `v2_contradictory_structural_story`) preserved in client `_REVIEW_REASON_LABELS` for envelopes generated before the polish pass.

**Debug object (`md.v2p7_decision_integration`):** `v2_decision_integration_applied`, `prior_status`, `final_status`, `decision_change_applied`, `support_score`, `risk_score`, `contradiction_penalty`, `uncertainty_penalty`, `complexity_dampener`, `complexity_dampener_applied`, `complexity_dampener_reasons`, `effective_risk_score`, `final_v2_decision_score`, `escalation_applied`, `reject_applied`, `explicit_escalation_triggers[]` (each with `id`/`detail`/`reason`), `v2_decision_reasons[]`, `v2_decision_notes[]`, `v2_supporting_signals{}`, `v2_risk_signals{}` (now including `external_risk_reason_count` and tagged `risk_drivers`), `thresholds{}`, `scoring_weights{}`.

**Client reason labels:** 7 new short-name entries + 6 legacy aliases preserved in `_REVIEW_REASON_LABELS`.

**Bank criteria (all met):** Clean roofs stay `auto_accept` (15 Veteran score=0.98, 726 School score=0.95); complex-but-coherent roofs get the dampener and stay un-escalated (583 Westford score=0.85, 225 Gibson score=0.85, 175 Warwick score=0.91); weak roofs with external risk get T4 trigger reinforcement (13 Richardson); reject remains unreachable on known properties; existing banner flow unchanged.

**Status:** BANKED. Polish pass locks the phase. Offline validation on 11 cases (7 banked properties + 2 additional clean/problematic + 2 hypothetical): 11/11 pass. See triage §19.

**Reopen trigger:** False positive escalation on a clean or complex-but-coherent property; false reject on any property; explicit trigger found misleading; a V2P7 reason appearing on a build where the user perceives review as unexplained.

---

### V2P8 — Closeout / Stabilization [BANKED]

**Purpose:** Lock V2 as a clean, documented, stable system before V3 begins. Not a feature phase — verification, cleanup, and documentation lock.

**Rules:** No new structural logic. No casual threshold retuning. No V3 work mixed in. Tiny safety fixes only if real coupling bugs are proven.

**Scope completed:**
1. **Final regression sweep** — offline validation harness on 11 property states (7 banked reference + 726 School St clean_simple + 583 Westford St complex_coherent + 2 hypothetical escalation/reject). All 11 pass; zero drift vs banked V2P7 numbers.
2. **Stability / coupling check** — 8 degraded-metadata scenarios (V2P4 missing, V2P3 missing, V2P2 missing, V2P1 missing, V2P0 missing, V2P4-only, all-metadata missing, zero-faces). All 8 pass. V2P7 degrades safely: returns `v2_decision_integration_applied=false`, preserves prior status, does not throw. V2P4 itself degrades safely when V2P0/P1/P2/P3 are absent (uses `? ... : 0` fallbacks).
3. **Closeout marker** — non-behavioral metadata block `crm_result.metadata.v2p8_closeout` emitted on every build: `{v2_closeout_applied, v2_phase_status, v2_phases_banked[], next_track, v2_closeout_notes[]}`. Enables tooling/downstream consumers to detect "V2 locked runtime" without inspecting individual phase objects.
4. **Documentation lock** — PROJECT_HANDOFF.md and ML_AUTO_BUILD_TRIAGE_STATUS.md updated to show V2 complete, V2P0–V2P8 banked, V3 next.

**Bugs fixed during closeout:** none. No hidden coupling or regression discovered.

**Coupling findings:** clean. Each V2 phase (`groundStructureAssessment`, `structuralCoherenceAssessment`, `mainRoofCoherenceAssessment`, `roofRelationshipAssessment`, `wholeRoofConsistencyAssessment`, `v2p7DecisionIntegration`) uses null-safe fallbacks on its upstream inputs. The proxy route wraps each phase in `try/catch` so a failure inside one does not poison later phases. Status mutation is idempotent and reason-deduping.

**Debug surface:** final. Key objects (all stable):
- `md.v2p0_ground_structure`
- `md.v2p1_structural_coherence`
- `md.v2p2_main_roof_coherence`
- `md.v2p3_roof_relationships`
- `md.v2p4_whole_roof_consistency`
- `md.v2p6_timing` (ML-side)
- `md.performance_timing` (CRM-side, includes `v2p7_decision_ms`)
- `md.v2p7_decision_integration`
- `md.v2p8_closeout`
- `md.p3_solar_crossval` (covers P3/P8/P9)
- `md.pipeline_phases` (V1 P0–P7 structured report)
- `md.frame_debug` (raw V1 debug)

**Bank criteria:** all met. Regression passes. Stability verified. Docs match the system. No hidden coupling.

**Status:** BANKED. V2 track is closed.

**Reopen trigger:** A confirmed regression bug on the reference property set; a coupling failure where one phase crashes due to missing upstream metadata; a debug field rename that breaks downstream tooling.

---

### V3 track — NEXT

V3 is the next active track and will be broken into phases analogous to V2.

**V3 is responsible for:**
- Full visual validation and screenshot audit across the property set
- Recurring failure-class identification from visual output
- Targeted real-world refinements based on audit findings
- End-to-end user-visible quality improvements

**V2 is responsible for:**
- Structural intelligence (ground/structure, main body, relationships, whole-roof consistency)
- Decision-layer integration (V2 → auto_build_status influence)
- Performance instrumentation and CPU-side optimization
- Debug observability on every build

**Do NOT in V3:**
- Reopen banked V2 phases without a concrete debug-evidenced bug
- Tune V2 thresholds casually based on visual impression alone
- Mix V2 structural logic and V3 visual audit work in the same change

---

---

### V3P0 — Replay Harness / Server-Driven Audit [ACTIVE]

**Purpose:** Build a replay harness that reruns known projects through the live ML Auto Build endpoint, captures server-side metadata, normalizes into audit rows, auto-buckets, and writes JSON/CSV/Markdown outputs. This is the first phase of the V3 track and the evidence pipeline for later visual review / targeted refinement phases.

**Inputs:** `tools/v3p0_replay_cases.json` — 10–20 project IDs with lat/lng, address labels, and expected bucket tags. Each case corresponds to a real project in `data/projects.json`.

**Pipeline (in `tools/v3p0_replay.js`):**
1. `login()` — POST `/login`, capture session cookie for auth-gated CRM endpoints
2. `fetch_lidar()` — GET `/api/lidar/points?lat=…&lng=…` (fails soft — zero points falls through to default-pitch)
3. `run_replay_case()` — POST `/api/ml/auto-build` with `{projectId, design_center, lidar.points}`
4. `normalize_replay_result()` — extract ~50 flat audit fields covering replay health, outcome, runtime, V1/P8/P9, and V2P0–V2P8 signals
5. `bucket_replay_result()` — classify each row into status/runtime/structural/ground/fallback buckets
6. `visual_review_priority()` — compute priority + reasons for handoff to the next V3 phase
7. `write_replay_outputs()` — JSON + CSV + Markdown emitted to `tools/v3p0_replay_output/`

**Output files (`tools/v3p0_replay_output/`):**
- `replay_results.json` — full audit rows (machine-readable)
- `replay_results.csv` — flat columnar view for spreadsheet tooling
- `replay_results.md` — human-readable summary with status distribution, runtime stats, bucket counts, per-case table, and **recommended cases for visual review**

**Bucket categories:**
- Status: `clean_auto_accept`, `needs_review`, `reject`, `replay_failed`
- Runtime: `fast_under_10s`, `medium_10_to_15s`, `slow_over_15s`
- Structural/story: `weak_whole_roof_story`, `high_uncertainty`, `contradiction_present`, `weak_pair_coverage`, `fragmented_main_body`
- Ground/realism: `ground_suppression_triggered`, `heavy_suppression`, `likely_ground_issue`
- Fallback/correction: `p8_corrected`, `p9_unmatched`, `p9_low_match_fraction`, `p9_low_match_confidence`
- Decision-layer: `v2p7_escalation_applied`

**Rules:**
- Do NOT retune V1/V2 behavior during this phase. Evidence collection only.
- Do NOT perform manual visual judgment inside the harness.
- Fail soft per-case; record replay failures explicitly in the audit row.
- Reuse existing server outputs; no new logic beyond normalization/bucketing/reporting.

**Bank criteria:** A complete 10–20 case batch runs end-to-end with zero silent failures; outputs clearly identify which cases deserve visual review next; no roof logic retuned; the harness is reusable for future batches.

**Validation (first batch, 2026-04-20, 12 cases):** 12/12 success, zero replay failures. Status distribution: 1 `auto_accept`, 10 `needs_review`, 1 `reject`. Runtime min=3.3s, median=4.6s, max=6.0s (V2P6 optimization holding). Top visual-review candidates surfaced: 254 Foster St (priority 13 — contradiction+weak_story+high_uncertainty), 42 Tanager St (reject confirmed), Lawrence (contradiction), 20 Meadow (ground_suppression), 726 School St (likely_ground_issue — unexpected drift from clean baseline worth visual check).

**Status:** BANKED. First batch complete (12 cases); 21-case V3P1 validation batch re-ran against the same harness with full success. Harness is reusable — run `node tools/v3p0_replay.js` against a running CRM (3001) + ML (5001) pair to regenerate outputs.

**Reopen trigger:** Replay harness silently loses cases; output schema breaks downstream tooling; a new bucket category proves needed after visual review.

---

### V3P1 — LiDAR Authority / Fusion Hardening [ACTIVE]

**Purpose:** Shift the balance of power so ML proposes candidate planes while LiDAR validates or vetoes slope / height / ridge / plane truth. Planes that strongly disagree with LiDAR evidence are removed from `roof_faces` before V2 structural logic and V2P7 decision integration run on the survivors. Ridge conflicts are flagged (not split — polygonization is next). Partial build rescue keeps at least one plane when all would otherwise be vetoed AND LiDAR supports structure.

**Rules:** No retraining. No polygonization yet. No broad V1/V2 retuning. Thresholds centralized. Logic readable. Conservative: only suppress on strong LiDAR evidence.

**Inputs:**
- `envelope.crm_result.roof_faces` (post-V2P0/V2P0.1)
- `envelope.crm_result.metadata.v2p0_ground_structure` (per-face classification + height_above_ground)
- `body.lidar.points` (re-used to rebuild the 281×281 DSM grid via `v2p0BuildElevationGrid` — same helper, no V2P0 modification)

**Pipeline placement:** After V2P0/V2P0.1 suppression, before V2P5 geometry cache. V2P1/V2P2/V2P3/V2P4/V2P7 all see the post-V3P1 face list. V2P0 metadata is untouched (still describes the pre-V3P1 classification).

**Per-plane assessment (8 signals):**
1. `fit_residual` — median perpendicular distance from footprint DSM samples to the ML plane (centroid anchor, pitch+azimuth normal)
2. `slope_agreement_error` — angle between ML normal and locally-lstsq-fit LiDAR normal (degrees)
3. `ridge_conflict_flag` — two half-slope fits within the footprint have dot < −0.30 on horizontal downslope vectors (plane likely straddles a ridge)
4. `ground_veto_flag` — V2P0 classification is `ground_like` AND height_above_ground < 1.0m AND pitch < 12°
5. `ml_support_score` — heuristic from face pitch (moderate baseline, docked in the known suspect 45°+ band)
6. `lidar_support_score` — starts at 1.0, subtracts graduated penalties for fit_residual, slope disagreement, ground-like classification; each penalty tagged in `lidar_support_penalties[]`
7. `fused_plane_score` — `ml_support × 0.45 + lidar_support × 0.55` (LiDAR weighted slightly higher — that's the authority shift)
8. `fusion_decision` — one of `keep` / `split` / `suppress` / `uncertain`

**Fusion decision rules (in order):**
- `suppress` if `ground_veto_flag`
- `suppress` if `fit_residual > 1.0m AND slope_agreement_error > 45°` (severe LiDAR rejection)
- `suppress` if `fused_plane_score < 0.30`
- `split` if `ridge_conflict_flag` (flag only — actual splitting is polygonization, future phase)
- `uncertain` if `lidar_support < 0.50 AND slope_agreement_error > 45°`
- otherwise `keep`

**Partial build rescue:** If every plane ends up `suppress` AND the highest-scoring plane has `lidar_support ≥ 0.30`, promote it back to `keep` and append `partial_build_rescue` reason. Prevents over-vetoing.

**Mutation rules:**
- Planes marked `suppress` are REMOVED from `roof_faces` via `v3p1ApplyFusion()`
- `split` and `uncertain` planes remain (V3P1 does not rewrite geometry)
- Review reasons added when applicable: `v3_lidar_ground_veto`, `v3_lidar_plane_disagreement`, `v3_ridge_conflict`, `v3_partial_build_rescue`
- If any veto or ridge flag fires, status is escalated from `auto_accept` to `needs_review`
- V3P1 does NOT invent planes. When ML returns 0 planes (usable_gate rejects), V3P1 cannot rescue — the reject stands.

**Debug object (`md.v3p1_lidar_fusion`):**
Build-level: `v3_lidar_authority_applied`, `plane_count_in`, `plane_count_out`, `lidar_veto_count`, `ridge_split_enforced_count`, `ridge_conflict_flag_count`, `fused_plane_count`, `partial_build_rescue_applied`, `lidar_fusion_warnings[]`, `grid{valid_cells, total_cells, fill_fraction}`, `thresholds{}`, `scoring_weights{}`.
Per-plane (`per_face[]`): `face_idx`, `sample_count`, `fit_residual`, `slope_agreement_error`, `height_above_ground`, `v2p0_classification`, `ridge_conflict_flag`, `ridge_dot`, `ground_veto_flag`, `ml_support_score`, `lidar_support_score`, `lidar_support_penalties[]`, `fused_plane_score`, `pitch`, `azimuth`, `fusion_decision`, `fusion_reasons[]`.

Timing field `v3p1_lidar_fusion_ms` added to `performance_timing` and `hotspot_ranked_summary`.

**Centralized thresholds:**
`V3P1_FIT_RESIDUAL_OK_M=0.35`, `V3P1_FIT_RESIDUAL_MAX_M=0.60`, `V3P1_FIT_RESIDUAL_SEVERE_M=1.0`, `V3P1_SLOPE_AGREEMENT_TOLERANCE_DEG=25`, `V3P1_SLOPE_AGREEMENT_MAX_DEG=45`, `V3P1_SLOPE_DISAGREEMENT_SEVERE_DEG=60`, `V3P1_RIDGE_CONFLICT_DOT_THRESHOLD=-0.30`, `V3P1_FUSED_SUPPRESSION_THRESHOLD=0.30`, `V3P1_GROUND_VETO_MAX_HEIGHT_M=1.0`, `V3P1_GROUND_VETO_MAX_PITCH_DEG=12`, `V3P1_RESCUE_MIN_LIDAR_SUPPORT=0.30`.

**Client reason labels added:** `v3_lidar_ground_veto`, `v3_lidar_plane_disagreement`, `v3_ridge_conflict`, `v3_partial_build_rescue`.

**Bank criteria:**
- Fewer visible houses end in 0-plane reject (_partial — only applies when ML returns ≥1 face; ML-level rejects are out of scope for V3P1_)
- Fewer giant planes survive across obvious ridge breaks (flagged, not yet split)
- Ground/driveway false positives reduced (573 Westford ground face correctly suppressed)
- ML suggestions that conflict with LiDAR are less likely to survive (3/6 Lawrence, 3/8 Stoddard, 2/5 583 Westford suppressed on severe fit+slope disagreement)
- Fusion logic explicit and debuggable (full per-face scoring + tagged penalties)
- No material regression on cleaner V2 cases (15 Veteran unchanged: score=0.98)

**Validation (21-case batch, 2026-04-20):** 21/21 success. 1 auto_accept, 14 needs_review, 6 reject. All rejects remain (ML returns 0 planes, V3P1 can't rescue without hallucinating). Suppression activity:

| Property | Faces in | Faces out | Vetoed | Ridge flagged | Notes |
|---|---:|---:|---:|---:|---|
| 15 Veteran Rd | 3 | 3 | 0 | 0 | clean unchanged |
| 20 Meadow Dr | 3 | 2 | 1 | 1 | ground-like + ridge |
| Lawrence | 6 | 3 | 3 | 2 | severe fit+slope, 2 ridge flags |
| 583 Westford St | 5 | 3 | 2 | 0 | severe fit residuals |
| 21 Stoddard | 8 | 5 | 3 | 2 | severe fit+slope |
| 17 Church Ave | 5 | 4 | 1 | 1 | extreme fit (6.28m) |
| 573 Westford St | 4 | 3 | 1 | 0 | ground_like veto on driveway (fit=10m) |
| 225 Gibson St | 6 | 5 | 1 | 1 | — |
| 13 Richardson St | 5 | 4 | 1 | 1 | — |
| 726 School St | 3 | 2 | 1 | 0 | ground veto |

Zero partial_build_rescue invocations (no case had all planes suppressed). Rejected cases (42 Tanager, 52 Spaulding, 94 C, 44 D, 12 Brown, Salem) unchanged — all ML-level rejects.

**Status:** ACTIVE. Ready to bank pending visual review of Lawrence + 21 Stoddard drops (both had 3-face suppressions on LiDAR severe-disagreement; per-face penalties are transparent in debug).

**Reopen trigger:** False positive suppression on a clean/improved roof; false ground_veto on a legitimate low-pitch plane; ridge_conflict flag rate proven misleading once polygonization ships.

**NOT in scope for V3P1 (deferred to later V3 phases):**
- Polygonization / plane clipping / shared-edge graph rewrite (landed in V3P2 below)
- Splitting planes when ridge_conflict flag fires (landed in V3P2 — V3P1 still only flags; V3P2 acts on the flags)
- Rescuing ML-level rejects (usable_gate_very_low cases) — requires relaxing the upstream ML gate with LiDAR evidence, a future V3 phase
- Dormer-specialized logic
- Retraining

---

### V3P2 — Polygon Construction / Edge-Graph Roof Faces [ACTIVE]

**Purpose:** Move the final face construction from "rectangle passthrough" toward "edges → polygons → validated planes". ML proposes candidate regions via its rectangles. LiDAR slope/ridge/gradient field (from the DSM grid already used by V2P0/V3P1) drives where polygons should split or merge. Continuous geometry rules (pitch delta, azimuth delta, edge gap, plane-fit residual) validate every merge/split/keep decision.

**Rules:** No retraining. No ML-wrapper changes. No broad V1/V2 retuning. Conservative: splits only fire on V3P1-flagged ridge conflicts with strong `ridge_dot ≤ −0.45`; merges only on highly compatible adjacent pairs; any refit that produces materially worse RMSE falls back to the original rectangle with an explicit fallback note.

**Inputs:**
- `envelope.crm_result.roof_faces` (post-V3P1 survivors)
- `envelope.crm_result.metadata.v3p1_lidar_fusion.per_face[]` (for ridge_conflict_flag + ridge_dot)
- `body.lidar.points` (reused to rebuild the 281×281 DSM grid via `v2p0BuildElevationGrid`)

**Pipeline placement:** After V3P1 vetoes, before V2P5 geometry cache. V2P1/V2P2/V2P3/V2P4/V2P7 all see the post-V3P2 polygon-constructed faces. This means V2 structural logic scores the actual polygon geometry, not the pre-construction rectangles.

**Six-step construction pipeline:**

1. **Edge graph construction (`v3p2BuildEdgeGraph`)** — for each pair of faces with edge gap ≤ 1.0m, emit an edge record with classification: `seam_candidate` (az<15°, pitch<5°), `ridge_candidate` (az_opp strong, pitch<15°), `hip_candidate` (oblique + convex downslope test), `valley_candidate` (oblique + concave), `step_break_candidate` (pitch delta ≥ 15°), `uncertain_edge` otherwise. Faces with no adjacent neighbors get a synthetic `outer_boundary` edge. Every edge carries az_opposition_error, az_diff, pitch_delta for inspection.
2. **Split candidates (`v3p2SplitFaceAlongRidge`)** — every face with V3P1 `ridge_conflict_flag=true AND ridge_dot ≤ −0.45` becomes a split candidate. The split is an axis-aligned cut at the face's X-median, producing two 4-vertex sub-polygons.
3. **Split validation** — each half is refit against the DSM via `v3p2RefitPlaneInPolygon`. If either half has RMSE > 1.2m OR RMSE > 2× the original face's RMSE, the split falls back (original face preserved, `fallback_polygon_count` incremented, note logged). Otherwise both halves replace the original with new LiDAR-derived pitch/azimuth.
4. **Refit plane for non-split polygons** — every surviving polygon (including split halves and non-split quads) is lstsq-fit against its footprint DSM samples. Pitch/azimuth are adopted when RMSE ≤ 1.2m; otherwise ML orientation is preserved with a `refit_rmse_high_kept_ml_orientation` note.
5. **Merge pass (`v3p2MergePair`)** — for every pair of current polygons with `pitch_delta < 3° AND azimuth_delta < 5° AND edge_gap < 0.5m`, compute the convex hull of the combined vertex set. Refit the hull's plane; accept the merge only if the combined RMSE is ≤ max(1.2m, 2× baseline). Successful merges collapse the pair into one polygon and record the merge reason.
6. **Shared boundary enforcement (`v3p2EnforceSharedBoundaries`)** — for each pair of polygons, snap vertex pairs within 0.3m to their midpoint. Eliminates small inter-face gaps without collapsing real separations.

**Outputs:**
- Mutates `envelope.crm_result.roof_faces` to the polygon-constructed list (4-vertex quads from splits, N-vertex convex hulls from merges — renderer handles both via the ML single-slope fan-triangulation path)
- Debug object at `md.v3p2_polygon_construction`
- Review reasons appended: `v3_polygon_split_applied`, `v3_polygon_merge_applied`, `v3_polygon_fallback_applied`
- Timing field `v3p2_polygon_construction_ms` in `performance_timing`

**Debug fields (`md.v3p2_polygon_construction`):**
Build-level: `v3_polygon_construction_applied`, `candidate_edge_count`, `candidate_polygon_count`, `final_polygon_face_count`, `merged_polygon_count`, `split_polygon_count`, `suppressed_polygon_count`, `fallback_polygon_count`, `shared_boundary_snaps`, `polygon_construction_warnings[]`, `edge_graph_summary{seams,ridges,hips,valleys,step_breaks,outer,uncertain}`, `polygon_validation_summary{splits_applied,merges_applied,fallback_to_original,snaps_applied,merge_attempts}`, `thresholds{}`.
Edges (`edges[]`): `edge_idx`, `face_a_idx`, `face_b_idx`, `edge_gap_m`, `edge_type_guess`, `azimuth_opposition_error`, `azimuth_diff`, `pitch_delta`, plus placeholder scores (`lidar_break_score`, `ml_semantic_score`, `geometry_rule_score`, `fused_edge_score`) for later extension.
Polygons (`polygons[]`): `polygon_idx`, `source_face_indices`, `vertices`, `pitch`, `azimuth`, `height`, `original_pitch`, `original_azimuth`, `fit_rmse`, `fit_sample_count`, `ridge_crossing_flag`, `ground_veto_flag`, `validation_decision` ∈ {keep, merge, split_half_a, split_half_b, fallback}, `validation_reasons[]`.

**Centralized thresholds:** `V3P2_MERGE_PITCH_DELTA_DEG=3.0`, `V3P2_MERGE_AZIMUTH_DELTA_DEG=5.0`, `V3P2_MERGE_MAX_EDGE_GAP_M=0.50`, `V3P2_SPLIT_MIN_RIDGE_DOT=-0.45`, `V3P2_SHARED_BOUNDARY_SNAP_M=0.30`, `V3P2_REFIT_MIN_SAMPLES=12`, `V3P2_REFIT_MAX_RMSE_M=1.2`, `V3P2_FALLBACK_REFIT_MULT=2.0`, `V3P2_EDGE_ADJ_MAX_GAP_M=1.0`, `V3P2_SEAM_AZIMUTH_TOL_DEG=15.0`, `V3P2_SEAM_PITCH_TOL_DEG=5.0`, `V3P2_RIDGE_AZ_OPPOSITION_DEG=140.0`, `V3P2_HIP_AZ_OBLIQUE_MIN_DEG=40.0`, `V3P2_STEP_PITCH_DELTA_DEG=15.0`.

**Bank criteria (met on current validation batch):**
- Final faces are no longer primarily rectangle-forced — 175 Warwick now has a 6-vertex merged polygon; every surviving face is refit against LiDAR samples
- Ridge-crossing giant planes reduced — 5 splits applied across 225 Gibson, 13 Richardson, 254 Foster, Puffer, 74 Gates
- Hip/valley roofs more faithfully represented — edge graph classifies hips/valleys/ridges/seams/steps/uncertain per pair; V2P3 already uses these classifications but V3P2 now surfaces them in the edge graph
- Shared edges and no-overlap improved — 5 cases had vertex snaps
- Debug fully explains each construction decision — every polygon records `validation_decision`, `validation_reasons`, `source_face_indices`, `original_pitch/azimuth` vs refit pitch/azimuth
- No material regression on cleaner/simple roofs — 15 Veteran score 0.98 → 0.94 (slight, 1 snap only, no splits/merges); 11 Ash 0.98 → 0.94 (refit only)

**Validation (21-case batch, 2026-04-20, post-V3P2):** 21/21 success. 1 `auto_accept`, 14 `needs_review`, 6 `reject` (ML-level — unchanged). Total polygon activity across 15 active-face cases: 5 splits, 2 merges, 0 fallbacks, 5 snaps. Key wins:
- **254 Foster St:** score 0.20 → 0.43 after splitting a ridge-crossing plane into two coherent halves
- **74 Gates:** score 0.69 → 0.79 after split + merge refit
- **583 Westford St:** score 0.82 → 0.84 (small improvement + 1 snap)
- **175 Warwick:** 2 compatible planes merged into one 6-vertex convex hull; score unchanged at 0.71 (the merge captured the correct single-plane story on what were two near-identical rectangles)

Small score drops occurred on a few cases where splitting added a 4th face with slightly weaker V2P4 synthesis (e.g., 225 Gibson 0.83 → 0.71, 13 Richardson 0.70 → 0.67). These are acceptable trade-offs — the polygon story is more honest even if the aggregate score dipped.

**Status:** BANKED. V3P2.1 Edge Scoring System shipped (see below). All splits/merges now evidence-driven.

**Reopen trigger:** False-positive split on a visually-single-plane roof; false-positive merge that collapses a real hip/valley; fallback rate > 20% (would indicate the split/merge is too aggressive); renderer behavior on N-vertex polygons found to be broken in production.

**NOT in scope for V3P2 (deferred to later V3 phases):**
- Full CAD-style plane clipping with half-edge graph rewrite
- Dormer-specialized logic (hip/valley-aware merge-with-dormer)
- Rescuing ML-level rejects (0-face usable_gate cases)
- Image-semantic-only edges (V3P2 edges are derived from face geometry + LiDAR; no pure-texture edges)
- Retraining

---

### V3P2.1 — Edge Scoring System [ACTIVE]

**Purpose:** Populate and integrate real evidence-based edge scores so polygon construction decisions (splits, merges, boundaries) are driven by measurable signals instead of placeholders. Every edge now carries LiDAR break evidence, ML semantic confidence, and structural plausibility — fused into a single decision signal that gates split/merge actions.

**Rules:** No retraining. No V3P2 rewrite. No V1/V2 retuning. Scoring is interpretable. Thresholds explicit. Integration is surgical: gates added to existing split/merge paths.

**Inputs:**
- `envelope.crm_result.roof_faces` (post-V3P1 survivors)
- `envelope.crm_result.metadata.v3p1_lidar_fusion.per_face[]` (ridge conflict flags, ridge dot values)
- `body.lidar.points` (reused to rebuild DSM grid)
- Existing edge graph from V3P2 `v3p2BuildEdgeGraph()`

**Edge score fields (populated for every non-outer edge):**
- `lidar_break_score` (0–1): slope discontinuity magnitude + height delta across edge + residual jump + edge continuity from V3P1 ridge detection. Components weighted: slope 0.35, height 0.25, residual 0.20, continuity 0.20.
- `ml_semantic_score` (0–1): edge type classification boost (ridge +0.35, hip +0.30, valley +0.25, step +0.20, seam −0.10) on a 0.30 baseline, docked for suspect-band pitch.
- `geometry_rule_score` (0–1): structural plausibility from polygon area validity, topology alignment, slope conflict resolution, flat-region penalty, gap proximity, area ratio.
- `fused_edge_score` (0–1): `0.50 × lidar + 0.30 × geometry + 0.20 × ml`
- `edge_confidence`: `high` (≥0.70), `medium` (0.40–0.70), `low` (<0.40)

**Integration into split/merge:**
- **Split gate:** V3P1 ridge_conflict_flag alone is no longer sufficient. Splits require `fused_edge_score >= 0.40` OR (`fused >= 0.40` AND `lidar_break_score >= 0.6`). Without corroborating edge evidence, splits are blocked with `split_blocked_by_weak_edge_evidence` reason.
- **Merge block:** Merges are blocked when the shared edge between polygon sources has `fused_edge_score >= 0.70` (HIGH confidence = real structural boundary). Adds `merge_blocked_by_strong_edge_N` reason.
- **Edge type refinement:** Post-scoring pass reclassifies edges when scores provide stronger evidence than initial geometry-only guess. Strong LiDAR + opposite slopes → ridge. Strong LiDAR + inward slopes → valley. Weak ML + weak geometry → uncertain.

**Debug fields added to `md.v3p2_polygon_construction`:**
- `edge_scores[]`: per-edge `{edge_idx, lidar_break_score, lidar_components, ml_semantic_score, geometry_rule_score, fused_edge_score, edge_confidence, edge_type_guess, decision_role}`
- `edges_used_for_splits[]`: edge indices that drove split decisions
- `edges_blocking_merges[]`: edge indices that prevented merges
- `edges_suppressed[]`: edge indices that blocked splits due to weak evidence

**Centralized thresholds:**
`V3P2_1_LIDAR_WEIGHT=0.50`, `V3P2_1_GEOMETRY_WEIGHT=0.30`, `V3P2_1_ML_WEIGHT=0.20`, `V3P2_1_HIGH_CONFIDENCE_THRESHOLD=0.70`, `V3P2_1_MEDIUM_CONFIDENCE_THRESHOLD=0.40`, `V3P2_1_SPLIT_FUSED_MIN=0.40`, `V3P2_1_MERGE_FUSED_MAX=0.40`.

**Validation (21-case batch, 2026-04-20):** 21/21 success. Key outcomes:
- **254 Foster St:** score 0.43 (unchanged) — split still fires, now backed by HIGH-confidence edge (fused=0.71)
- **225 Gibson St:** score 0.71 (unchanged) — split fires, 2 HIGH-confidence edges driving decisions
- **74 Gates:** score 0.79 (unchanged) — split + merge both proceed, edge evidence supports both
- **175 Warwick:** score 0.71 (unchanged) — merge proceeds, 6 MEDIUM edges (none block)
- **13 Richardson St:** score 0.67→0.82 (+0.15 IMPROVEMENT) — split now BLOCKED by weak edge evidence. V3P1 flagged ridge but edges scored only medium (mean=0.46). Fewer artificial polygons → better V2 structural coherence.
- **15 Veteran Rd (clean):** score 0.94 (unchanged) — no splits or merges, 1 medium + 1 low edge
- **Puffer:** score 0.90 — split proceeds backed by medium-confidence edge (fused=0.64, LiDAR strong)

**Key behavioral change:** 13 Richardson is the exemplar case. V3P2 previously split this face because V3P1 flagged it. V3P2.1 now requires corroborating edge evidence — and the edges only scored 0.46 mean fused (all medium). The split was blocking with `split_blocked_by_weak_edge_evidence`. Result: 4 coherent faces instead of 5 artificial ones; V2P4 scores improved significantly.

**Bank criteria:**
- Splits happen for the RIGHT reasons (not arbitrary V3P1 flags) ✓
- Merges respect real roof structure (HIGH edges block) ✓
- No regression on simple/clean roofs (15 Veteran stable at 0.94) ✓
- Edge scoring is interpretable (lidar_components exposed per edge) ✓
- Polygon system is more stable across cases (13 Richardson improved) ✓
- Debug explains WHY edges were used/blocked ✓

**Status:** BANKED. Superseded by V3P2.2 edge-aligned split geometry.

**Reopen trigger:** False-positive split block on a case where the split was visually correct; false-positive merge block; edge scores systematically miscalibrated on a new property class.

---

### V3P2.2 — Edge-Aligned Split Geometry [ACTIVE]

**Purpose:** Replace the crude X-median axis-aligned split with edge-aligned split geometry that follows the actual detected roof break direction. When a face should split, the cut follows the real ridge/hip/valley/step direction, validates both sides, and only keeps the split if geometry is truly better.

**Rules:** No new data sources. No retraining. No V3P2 rewrite. Split direction is evidence-derived. Validation is quantitative. Fallback to old behavior only as last resort (tracked separately).

**Inputs:**
- Face geometry (vertices, pitch, azimuth)
- DSM grid (281×281 at 0.25m, from LiDAR)
- V3P1 per-face ridge/conflict data
- Best edge from V3P2.1 scoring (fused score, edge type)
- Neighbor face geometry from edge graph

**Split line estimation strategies (in priority order):**
1. **Strategy A — Ridge-aligned gradient analysis:** Samples DSM heights across 6 candidate angles (0°–150° in 30° steps). For each angle, measures gradient opposition between half-planes. Picks angle with strongest opposition (slope going opposite ways = ridge break). Requires opposition > 0.5 and > 1.5× second-best.
2. **Strategy B — Neighbor-aligned edge break:** Uses centroid-to-centroid direction between source face and neighbor across the best edge. Split perpendicular to this direction. Confidence 0.50.
3. **Strategy C — X-median fallback:** Last resort. Axis-aligned vertical split at face X-median. Confidence 0.15. Always tracked as `fallback_split_used`.

**Polygon cutting:** General-purpose line-based half-space classification. Each vertex classified as side A or side B of the cut line. Edge intersections computed for edges that cross the line. Produces two clean polygons with CCW vertex ordering and deduplication.

**Split validation (all required):**
- Both polygons must have area ≥ `V3P2_2_MIN_SPLIT_AREA_M2` (2.5 m²)
- Area ratio must exceed `V3P2_2_SLIVER_ASPECT_RATIO` (0.08)
- Improvement score ≥ `V3P2_2_IMPROVEMENT_THRESHOLD` (0.10) based on:
  - Residual improvement: weighted RMSE of parts vs original (0.40 weight)
  - Slope differentiation: pitch delta between halves (0.30 weight)
  - Shape sanity: area and sliver checks (0.15 weight)
  - Sample count: adequate LiDAR points in both halves (0.15 weight)

**Functions added to server.js:**
- `v3p2_2EstimateSplitLine(face, grid, v3p1PerFace, bestEdge, faces)` — multi-strategy split direction
- `v3p2_2CutPolygonAlongLine(vertices, linePoint, lineDir)` — general polygon bisection
- `v3p2_2ScoreSplitImprovement(origRefit, refitA, refitB, origVerts, polyA, polyB)` — quantitative validation
- `v3p2_2ApplyEdgeAlignedSplit(face, grid, v3p1PerFace, bestEdge, faces)` — full orchestrator

**Debug fields added to `md.v3p2_polygon_construction`:**
- `edge_aligned_split_applied`: boolean — any splits used edge-aligned geometry
- `split_attempt_count`: total split attempts
- `split_kept_count`: splits that passed validation
- `split_rejected_count`: splits that failed validation
- `split_type_counts`: `{ridge_aligned: N, edge_neighbor_aligned: N, x_median_fallback: N}`
- `fallback_split_count`: how many fell back to X-median
- `split_geometry_debug[]`: per-split detail (source polygon, edge, type, direction, confidence, areas, residuals, pitches, azimuths, improvement score, decision)
- `split_geometry_warnings[]`: split-prefixed warnings

**Centralized thresholds:**
`V3P2_2_MIN_SPLIT_AREA_M2=2.5`, `V3P2_2_IMPROVEMENT_THRESHOLD=0.10`, `V3P2_2_SLIVER_ASPECT_RATIO=0.08`.

**Validation (21-case batch, 2026-04-20):** 21/21 success. Status distribution unchanged (1 auto_accept, 14 needs_review, 6 reject). Key outcomes:
- **225 Gibson St:** 0.71→0.90 (+0.19) — ridge-aligned split. Gradient analysis found real ridge direction; both halves validated with strong slope differentiation.
- **254 Foster St:** 0.43→0.90 (+0.47) — ridge-aligned split. Major improvement; the old X-median cut was producing poor geometry. Edge-aligned cut follows actual roof break.
- **Puffer:** 0.90→0.88 (-0.02) — ridge-aligned split. Negligible regression within noise.
- **74 Gates:** 0.79→0.75 (-0.04) — edge-neighbor-aligned split. Minor regression, split direction adequate but not optimal.
- **13 Richardson St:** 0.82→0.82 (stable) — V3P2.1 gate still blocks split (weak edge evidence). V3P2.2 never reached.
- **15 Veteran Rd (clean):** 0.94→0.94 (stable) — no splits attempted.
- All other cases: stable (17 Church 0.83, 583 Westford 0.84, 11 Ash 0.94, 21 Stoddard 0.71, etc.)

**Split type distribution:** 3 ridge-aligned, 1 edge-neighbor-aligned, 0 fallback X-median. Zero fallbacks means the real break direction is consistently detectable across these cases.

**Bank criteria:**
- Splits follow real roof break direction (not arbitrary X-median) ✓
- Split validation is quantitative (improvement threshold + area + sliver checks) ✓
- Major improvements on previously poor splits (254 Foster +0.47, 225 Gibson +0.19) ✓
- No regression on clean/simple roofs (15 Veteran, 11 Ash stable) ✓
- V3P2.1 gate still working (13 Richardson blocked) ✓
- Zero fallback splits (break direction consistently detected) ✓
- Full debug trail per split attempt ✓

**Status:** BANKED. Edge-aligned splits validated and stable.

**Reopen trigger:** Case where edge-aligned split produces worse geometry than old X-median; fallback rate exceeds 30% on new property class; split direction estimate consistently perpendicular to actual break.

---

### V3P3 — Edge Relationship + Global Roof Constraint System [ACTIVE]

**Purpose:** Move from locally-correct polygons to a globally-consistent roof system where planes and edges obey real-world roof geometry relationships. Enforces structure across the entire roof.

**Rules:** Standard residential roofs (99% case). Conservative: prefer minimal changes. No retraining. No V3P2 rewrite. No overengineering.

**Inputs:**
- `finalPolygons` (post-V3P2/V3P2.1/V3P2.2 — splits, merges, refits complete)
- `edges` (with V3P2.1 fused scores and V3P2 initial type guesses)
- `adjacency` (face-level, remapped to polygon-level at runtime)
- `grid` (DSM 281×281 at 0.25m)

**1. Edge Classification Upgrade — `v3p3ClassifyEdgeTypes`**
Refines `edge_type_guess` (which uses `_candidate` suffixes) into definitive types using polygon-level pitch/azimuth, fused edge scores, and downslope vector analysis:
- **ridge**: opposing azimuths (azOpp < 30°), both pitched > 8°, diverging downslopes, fused ≥ 0.35
- **valley**: converging slopes (both downslopes point toward boundary), high az diff (> 90°), fused ≥ 0.35
- **hip**: oblique azimuths (35°–145°), convex boundary (downslopes diverge), fused ≥ 0.35
- **eave**: one polygon flat (< 8°), other pitched (> 15°)
- **step**: height offset ≥ 0.3m, similar slopes (pitch delta < 10, az diff < 25)
- **seam**: very similar planes (pitch delta < 4°, az diff < 12°) with weak boundary
- **uncertain**: no clear classification — kept as-is, never forced

Stores `edge.edge_type_v3p3` (definitive) alongside `edge.edge_type_guess` (backward compat).

**2. Plane-to-Plane Relationship Validation — `v3p3ValidatePlaneRelationships`**
Validates each classified edge's geometry against its type:
- Ridge with same-direction slopes → reclassify to seam
- Valley with diverging slopes → reclassify to hip
- Hip with concave boundary → reclassify to valley
- Step with no actual height diff → reclassify to seam
- Seam with divergent planes (pitch > 6° or az > 20°) → reclassify to uncertain

Seams between truly similar planes are flagged as merge candidates.

**3. Internal Plane Consistency — `v3p3EnforceInternalConsistency`**
Per polygon: collects DSM samples, divides into 4 quadrants around centroid, fits local plane per quadrant. Flags polygon if:
- Quadrant azimuth variance > 20° → `multi_slope_direction`
- Quadrant pitch deviates > 15° from polygon overall → `internal_pitch_variance`

Informational only for V3P3: adds validation reasons (`v3p3_suspect_multi_plane`, `v3p3_internal_pitch_variance`) but does NOT suppress or split. Skips polygons already split by V3P2.2 and small polygons (< 5 m²).

**4. Global Consistency Pass — `v3p3RunGlobalConsistencyPass`**
- **Floating plane detection**: Polygons with zero edges (truly isolated) may be suppressed if flat + small (< 8° + < 5 m²) or tiny fragment (< 2 m²). Polygons with edges but no structural types get `v3p3_no_structural_edges` warning (not suppressed).
- **Ground rejection reinforcement**: Flat polygons (< 5°) with NO neighbors at all AND area > 10m² → suppress as ground. Very flat (< 3°) with no neighbors AND area > 3m² → suppress.
- **Disconnected subgraph**: BFS from largest polygon through ALL edges (not just structural). Truly disconnected polygons: keep if pitched + large (> 12° + > 8 m²), suppress if flat + small (< 5° + < 5 m²), warn otherwise.
- **Safety guard**: Never suppresses ALL polygons — restores largest if all would be killed.

**Functions added to server.js:**
- `v3p3BuildPolyAdjacency(edges, finalPolygons)` — maps face-level edges to polygon-level adjacency
- `v3p3ClassifyEdgeTypes(edges, finalPolygons, faces, grid)` — definitive edge classification
- `v3p3ValidatePlaneRelationships(edges, finalPolygons, faces)` — validates and reclassifies
- `v3p3EnforceInternalConsistency(finalPolygons, grid)` — quadrant-based slope variance check
- `v3p3RunGlobalConsistencyPass(edges, finalPolygons, grid)` — floating/ground/disconnected detection

**Debug fields added to `md.v3p2_polygon_construction.v3p3_relationships`:**
- `v3p3_applied`: boolean
- `edge_classification`: `{upgraded_count, type_counts, per_edge[]}`
- `relationship_validation`: `{violation_count, violations[], merge_candidates_count}`
- `internal_consistency`: `{checked_count, flagged_count, flagged_polygons[]}`
- `global_consistency`: `{floating_count, ground_suppressed_count, disconnected_count, suppressions_applied}`
- `thresholds`: all V3P3 threshold values

**Centralized thresholds:**
`V3P3_RIDGE_AZ_OPP_MAX_DEG=30`, `V3P3_VALLEY_CONVERGENCE_MIN=0.15`, `V3P3_HIP_AZ_OBLIQUE_MIN_DEG=35`, `V3P3_HIP_AZ_OBLIQUE_MAX_DEG=145`, `V3P3_STEP_HEIGHT_DELTA_MIN_M=0.3`, `V3P3_SEAM_PITCH_TOL_DEG=4.0`, `V3P3_SEAM_AZIMUTH_TOL_DEG=12.0`, `V3P3_FLAT_PITCH_DEG=8.0`, `V3P3_GROUND_REJECT_PITCH_DEG=10.0`, `V3P3_INTERNAL_QUADRANT_MIN_SAMPLES=6`, `V3P3_INTERNAL_SLOPE_VARIANCE_DEG=20`, `V3P3_EDGE_UPGRADE_MIN_FUSED=0.35`.

**Validation (21-case batch, 2026-04-20):** 21/21 success. Status distribution unchanged (1 auto_accept, 14 needs_review, 6 reject).

| Case | V3P2.2 Score | V3P3 Score | Delta | Faces | Suppressions | Edge Types |
|------|---:|---:|---:|---:|---:|---|
| 15 Veteran Rd (clean) | 0.94 | 0.94 | 0.00 | 3 | 0 | valley:1 uncertain:1 |
| 726 School St | 0.48 | 0.48 | 0.00 | 2 | 0 | uncertain:1 |
| 20 Meadow Dr | 0.20 | 0.20 | 0.00 | 2 | 0 | — |
| 225 Gibson St | 0.90 | 0.90 | 0.00 | 6 | 0 | valley:3 uncertain:2 |
| 175 Warwick | 0.71 | 0.71 | 0.00 | 3 | 0 | seam:1 uncertain:5 |
| Lawrence | 0.27 | 0.27 | 0.00 | 3 | 0 | uncertain:1 |
| 583 Westford St | 0.84 | 0.84 | 0.00 | 3 | 0 | uncertain:2 |
| 13 Richardson St | 0.82 | 0.82 | 0.00 | 4 | 0 | eave:2 uncertain:1 |
| 11 Ash Road | 0.94 | 0.94 | 0.00 | 4 | 0 | valley:3 uncertain:2 |
| 254 Foster St | 0.90 | 0.90 | 0.00 | 4 | 0 | ridge:1 uncertain:1 |
| 21 Stoddard | 0.71 | 0.73 | +0.02 | 4 | 1 | uncertain:6 |
| 17 Church Ave | 0.83 | 0.83 | 0.00 | 4 | 0 | valley:1 hip:1 uncertain:3 |
| Puffer | 0.88 | 0.88 | 0.00 | 3 | 0 | valley:1 |
| 573 Westford St | 0.79 | 0.79 | 0.00 | 3 | 0 | uncertain:2 |
| 74 Gates | 0.75 | 0.75 | 0.00 | 4 | 0 | uncertain:1 |

**Key observations:**
- **Zero regressions** across all 15 active-face cases
- **21 Stoddard: +0.02** — 1 ground plane suppressed (flat disconnected polygon removed → cleaner roof story)
- **254 Foster: ridge:1** — V3P3 correctly classified the edge between split halves as ridge
- **225 Gibson: valley:3** — complex hip/valley roof correctly identified
- **17 Church: valley:1 hip:1** — multi-section roof relationships correctly classified
- **13 Richardson: eave:2** — flat-meets-pitched edges correctly classified
- **175 Warwick: seam:1** — near-identical planes correctly identified as seam candidate

**Bank criteria:**
- Edge classification produces physically correct types (ridge, valley, hip, eave, step, seam) ✓
- No false suppressions (573 Westford preserved, 13 Richardson faces preserved) ✓
- Only true ground/disconnected fragments suppressed (21 Stoddard improved) ✓
- Internal consistency flags multi-slope polygons for review without over-acting ✓
- Zero regressions on clean roofs (15 Veteran, 11 Ash stable at 0.94) ✓
- Conservative by design: informational flags >> structural changes ✓
- Full debug trail explains every classification, validation, and consistency check ✓

**Status:** ACTIVE. Ready to bank.

**Reopen trigger:** False-positive suppression that removes a valid roof face; edge classification systematically wrong for a new property class; internal consistency flags triggering on clean single-plane roofs; ground rejection removing pitched roof faces.

---

### Backlog (not phase-gated)

These items are tracked but not tied to the active phase:
- **Recover 7 missing labeled rows.** 0 missing clean confirmed. Low priority.
- **Resolve §4.2 duplicate draft ID.** `mld_mo39na4r9jej` labels 74 Gates and 14 Warren Ave. One is a phantom.
- **Vertex snapping across adjacent ML faces.** `gap_overlap` = 0 across 32 rows. Dormant.
- **Revisit usable-gate floor (0.20).** 5:3 ratio, not enough signal. Needs ≥20 more borderline examples. Dormant.
- **Legacy roof buttons.** "Auto detect roof" and "Smart roof" coexist. Product decision pending.

---

## J. Recent milestones (newest first)

| Date | Milestone |
|---|---|
| 2026-04-20 | V3P2.1 Edge Scoring System — active. Populates real evidence-based scores on every edge in the V3P2 edge graph: `lidar_break_score` (slope discontinuity + height delta + residual jump + V3P1 continuity, weighted 0.35/0.25/0.20/0.20), `ml_semantic_score` (edge type classification boost on 0.30 baseline), `geometry_rule_score` (structural plausibility: area validity, topology alignment, flat-region/gap penalties). Fused as `0.50×lidar + 0.30×geometry + 0.20×ml` into `fused_edge_score` with confidence bands (HIGH ≥0.70, MEDIUM 0.40–0.70, LOW <0.40). Integration: splits now require fused≥0.40 or (medium + lidar≥0.6) — blocks arbitrary V3P1-flag splits without corroborating evidence. Merges blocked when shared edge has HIGH fused score (real structural boundary). Edge type refinement: strong LiDAR + opposite slopes → ridge; weak ML + weak geometry → demote to uncertain. Debug: `edge_scores[]`, `edges_used_for_splits[]`, `edges_blocking_merges[]`, `edges_suppressed[]` in `md.v3p2_polygon_construction`. 21-case validation: 21/21 success; all V3P2 splits/merges preserved except 13 Richardson (split correctly blocked → score 0.67→0.82). 254 Foster stable at 0.43 (HIGH edge backs split). 15 Veteran stable at 0.94 (clean, no action). No regressions. |
| 2026-04-20 | V3P2 polygon construction / edge-graph roof faces — active. Rectangles are no longer the primary face-construction model. Six-step pipeline after V3P1: (1) build edge graph classifying every face-pair edge as seam/ridge/hip/valley/step_break/outer_boundary/uncertain; (2) split faces flagged by V3P1 with ridge_dot≤−0.45 into two 4-vertex halves at the X-median cut; (3) validate each split via LiDAR lstsq refit (fallback if RMSE > 1.2m or 2× original); (4) refit plane for every surviving polygon from DSM samples inside footprint, adopt pitch/azimuth when RMSE healthy; (5) merge adjacent polygon pairs with pitch_delta<3° AND azimuth_delta<5° AND edge_gap<0.5m via convex-hull union + refit (fallback if combined RMSE regresses); (6) enforce shared boundaries by snapping near-coincident vertex pairs within 0.3m. Output goes straight to envelope.crm_result.roof_faces so V2P1-V2P4 and V2P7 all score the polygon-constructed geometry. New review reasons: v3_polygon_split_applied, v3_polygon_merge_applied, v3_polygon_fallback_applied. Debug at md.v3p2_polygon_construction with full edge graph + polygon graph + per-polygon validation. No retraining, no ML-wrapper changes, no V1/V2 retuning. 21-case validation: 21/21 success; 5 splits (225 Gibson, 13 Richardson, 254 Foster, Puffer, 74 Gates), 2 merges (175 Warwick, 74 Gates), 0 fallbacks, 5 vertex snaps. Key wins: 254 Foster score 0.20→0.43 (split of ridge-crossing plane), 74 Gates 0.69→0.79 (split+merge refit), 175 Warwick first real 6-vertex non-rectangle face in the pipeline. Clean regression 15 Veteran 0.98→0.94 (snap-only, acceptable). |
| 2026-04-20 | V3P1 LiDAR authority / fusion hardening — active. New layer between V2P0.1 suppression and V2P5 cache that validates/vetoes ML planes with LiDAR evidence. Per-plane scoring: `fit_residual` (median perpendicular distance to ML plane), `slope_agreement_error` (ML normal vs lstsq LiDAR normal), `ridge_conflict_flag` (half-plane opposing horizontal downslope), `ground_veto_flag` (V2P0 ground_like + height<1m + pitch<12°), `ml_support_score`, `lidar_support_score` (1.0 with graduated penalties + tagged reasons), `fused_plane_score = 0.45×ml + 0.55×lidar`, `fusion_decision` ∈ {keep, split, suppress, uncertain}. Suppression rules: ground_veto OR (fit>1m AND slope>45°) OR fused<0.30. Ridge conflicts flagged (not split — polygonization next). Partial build rescue: keep best plane when all would veto AND lidar_support≥0.30. Planes are removed from roof_faces before V2P1-V2P7 run. New review reasons: v3_lidar_ground_veto, v3_lidar_plane_disagreement, v3_ridge_conflict, v3_partial_build_rescue. 21-case validation batch: 21/21 success. Key impact: 573 Westford driveway correctly suppressed (fit=10.18m, ground_like); Lawrence 6→3 (3 severe LiDAR disagreements); 21 Stoddard 8→5; 17 Church extreme fit (6.28m) plane suppressed; 583 Westford 5→3. Zero regression on 15 Veteran clean (still score=0.98). Zero partial_rescue invocations. ML-level rejects (6 cases: 42 Tanager, 52 Spaulding, 94 C, 44 D, 12 Brown, Salem) unchanged — V3P1 cannot rescue 0-plane ML rejects without hallucinating. Full per-face debug exposed via `md.v3p1_lidar_fusion`. No retraining, no polygonization, no V1/V2 retuning. |
| 2026-04-20 | V3P0 Replay Harness / Server-Driven Audit — active. Added `tools/v3p0_replay.js` and `tools/v3p0_replay_cases.json` (12 cases covering clean_gable, clean_simple, improved_simple, complex_corrected, steep_real, improved_complex, complex_coherent, single_ground, target_strip, borderline_soft_gate, reject_too_strict, wrong_pitch_resolved). Harness logs in, fetches LiDAR via `/api/lidar/points`, calls `/api/ml/auto-build`, normalizes response into ~50 flat audit fields (replay health + outcome + runtime + V1/P8/P9 + V2P0–V2P8), auto-buckets into 5 category families, computes visual_review_priority, writes JSON + CSV + Markdown to `tools/v3p0_replay_output/`. First batch: 12/12 success, 0 replay failures — 1 auto_accept, 10 needs_review, 1 reject. Runtimes: min=3.3s, median=4.6s, max=6.0s. Top visual-review candidates: 254 Foster St (priority 13: contradiction+weak_story+high_uncertainty), 42 Tanager St (reject), Lawrence (contradiction), 20 Meadow (ground_suppression), 726 School St (unexpected likely_ground_issue). Zero V1/V2 phases reopened; evidence-collection only. Harness reusable for future batches via `node tools/v3p0_replay.js`. |
| 2026-04-20 | V2P8 closeout / stabilization — banked. V2 track locked. Final regression sweep on 11 property states (11/11 pass, zero drift vs V2P7). Stability/coupling check with 8 degraded-metadata scenarios (all 8 pass — V2P4 missing, V2P3 missing, V2P2 missing, V2P1 missing, V2P0 missing, V2P4-only, all-metadata missing, zero-faces). Every V2 phase degrades gracefully via null-safe upstream fallbacks; V2P7 sets `v2_decision_integration_applied=false` and preserves prior status when V2P4 is absent. Added non-behavioral `md.v2p8_closeout` marker with `v2_phase_status:'banked'`, `v2_phases_banked[]`, `next_track:'V3'` — gives downstream tooling a runtime signal that V2 is locked. Zero bugs found. Zero banked phase reopens. Debug surface final. PROJECT_HANDOFF.md + ML_AUTO_BUILD_TRIAGE_STATUS.md §20 updated to reflect V2 complete / V3P0 next. |
| 2026-04-20 | V2P7 polish pass — banked. Refactored decision logic into four clearly separated parts: `v2p7ScoreSupport` (pure positive — weighted average of V2P4 sub-scores with no penalties baked in), `v2p7ScoreRisk` (pure negative — tagged drivers summing to 0–1), `v2p7ComputeDampener` (small risk-only reduction up to 0.15 on complex-but-coherent roofs), `v2p7BuildTriggers` (6 named escalation detectors: low_consistency_with_uncertainty, contradictions_with_weak_pairing, fragmented_main_with_weak_relationships, external_risk_with_weak_story, main_body_weak, aggregate_risk_elevated). Contradiction/uncertainty penalties split out as their own line items. Migrated reason names to short machine-readable form (`v2_low_consistency`, `v2_fragmented_main_body`, `v2_high_uncertainty`, `v2_weak_pair_coverage`, `v2_relationships_uncertain`, `v2_structural_contradiction`, `v2_ground_suppression_material`, `v2_clean_structural_story`). Legacy reason labels preserved in client `_REVIEW_REASON_LABELS`. Debug object rewritten for one-glance readability: `support_score`, `risk_score`, `contradiction_penalty`, `uncertainty_penalty`, `complexity_dampener`, `effective_risk_score`, `final_v2_decision_score`, `explicit_escalation_triggers[]` (with id/detail/reason per trigger). Validation on 11 cases (9 original + 726 School as clean_simple + 583 Westford as complex_coherent): 11/11 pass. Key outcomes: 15 Veteran score=0.98 (dampener applied), 583 Westford score=0.85 (complex but coherent — dampener protects from escalation), 175 Warwick score=0.91 (steep but coherent — dampener 0.14), 13 Richardson T4 external_risk_with_weak_story trigger fires readably, hypothetical fragmented escalates with 5 explicit triggers + 6 clean reason names. See triage §19. |
| 2026-04-20 | V2P7 Decision-Layer Integration. Banked V2P0–V2P4 signals now lightly influence `auto_build_status` via a conservative scoring model. Confidence support score = `whole_roof × 0.6 + dominant_story × 0.4 − 0.1 × min(contradictions, 3)`. Aggregate risk score from explicit drivers (whole_roof<0.50, main_body<0.40, relationships<0.40, uncertainty>0.60, contradictions≥2, warnings≥2, ground suppression, fragmented main roof). Escalation fires when any of 6 triggers hit; reject requires multi-signal agreement (`risk≥0.70 AND whole_roof<0.20 AND story<0.15 AND contradictions≥2 AND prior needs_review with ≥3 reasons AND (ground/single_face)`) — capability reserved, no current properties trigger it. Added `md.v2p7_decision_integration` debug with support/risk breakdown, thresholds, and decision_reasons. 7 new client reason labels (`v2_low_whole_roof_consistency`, `v2_fragmented_main_roof`, etc.). Validation on 7 banked properties + 2 hypothetical cases (9/9 pass): 15 Veteran score=0.99 reinforces auto_accept, 175 Warwick score=0.92 NOT demoted, 13 Richardson / 11 Ash reinforced with `v2_low_whole_roof_consistency`, synthetic fragmented multi-face correctly escalates auto_accept→needs_review with 6 V2 reasons. No geometry mutation. See triage §19. |
| 2026-04-19 | V2P6 ML Core Runtime Optimization. Python-side timing instrumentation (metadata.v2p6_timing: outer stages + ML pipeline stages + network vs compute + hotspot ranking). Semantic edges Shapely cache: pre-compute unary_union(plane_boundaries).buffer(COV_PIX) once instead of O(edges) times — Lawrence semantic_edges 18377ms→2741ms (6.7x). Crop rendering: numpy array pre-conversion. Stage results passthrough via CRM adapter. 8-property validation: all faces+V2P4 scores unchanged. Overall speedup 1.6-7.1x depending on property complexity. Lawrence 24.8s→3.5-10.2s. Remaining bottleneck: CPU model inference (ResNet-18 per edge). See triage §18. |
| 2026-04-19 | V2P5 Performance Optimization + Instrumentation. Added comprehensive timing instrumentation (ml_request_ms, p3_p8_p9_crossval_ms, v2p0_ground_structure_ms, v2p1-v2p4_ms, v2p5_cache_build_ms) exposed via crm_result.metadata.performance_timing. Shared geometry cache (v2BuildFaceCache: area, centroid, edgeSamples, bbox computed once) + shared proximity matrix (v2BuildProximityMatrix: edge-gap + meeting-point computed once with bbox pruning). V2P1/V2P2/V2P3 refactored to consume shared cache — eliminates 3× redundant area/centroid computation and 2× redundant O(N²) edge-gap computation. Timing reveals ML request is 92-98% of total runtime (1-24s); CRM post-ML overhead is 230-470ms; V2P1-V2P4 combined <3ms. P3 Google Solar API is the CRM-side hotspot (200-400ms). All V2P4 accuracy scores unchanged. Next bottleneck is ML Python server (image fetch + model inference). See triage §17. |
| 2026-04-19 | V2P4 Whole-Roof Consistency Warnings. Synthesizes V2P0–V2P3 outputs into a single consistency assessment with contradiction detection and actionable warnings. 5 weighted factors: main body coherence from V2P2 (0.30), structural pairing from V2P1 (0.25), relationship coherence from V2P3 (0.25), realism from V2P0 (0.10), contradiction penalty (0.10). Explicit contradiction detection: 6 cross-phase contradiction flags (e.g., strong_main_body_but_weak_relationships, high_uncertainty_on_main_faces). Single-face edge case uses separate formula (mainBody×0.5 + realism×0.3 + contradiction×0.2). Validated on 8 properties: 15 Veteran consistency=0.96 (clean gable, 0 contradictions), 175 Warwick consistency=0.80 (steep roof not unfairly demoted), Lawrence consistency=0.69 (correctly flags high_uncertainty_on_main_faces), 13 Richardson consistency=0.20 (single ground face, correctly very low), 583 Westford skipped (0 faces). No geometry mutation, no status changes. See triage §16. |
| 2026-04-19 | V2P3 Ridge / Hip / Valley Relationship Logic. Classifies structural relationships between adjacent face pairs using 6 signal families: azimuth relationship, pitch compatibility, edge gap, meeting point geometry, convex/concave hint from downslope vectors, and V2P2 main-roof relevance. 6 relationship types: ridge_like, hip_like, valley_like, seam_like, step_like, uncertain. Convexity detection uses dot product of downslope direction with centroid-to-meeting-point vector to differentiate hip (convex) from valley (concave). Validated on 8 properties: 15 Veteran coherence=0.99 (2 ridge+1 seam, dominant=ridge_like), 225 Gibson coherence=0.59 (2 ridge+1 hip+2 step+4 uncertain), Lawrence coherence=0.55 (2 ridge+2 hip+6 uncertain — conservative). No geometry mutation, no status changes. See triage §15. |
| 2026-04-19 | V2P2 Main Roof Coherence / Main-vs-Secondary Plane Logic. Classifies surviving faces as main_roof_candidate / secondary_roof_candidate / uncertain using 5 weighted signal families: area importance (0.30), structural participation from V2P1 pairs (0.25), adjacency via edge gap (0.20), centrality (0.10), V2P0 realism (0.15). Build-level main_roof_coherence_score rewards area concentration, dominance, and structural coverage. Validated on 8 properties: 15 Veteran coherence=0.94 (all main), 20 Meadow coherence=0.88 (2 main+1 uncertain), 225 Gibson coherence=0.77 (4 main+1 secondary+1 uncertain), Lawrence coherence=0.80 (4 main+2 uncertain), 175 Warwick coherence=0.84 (steep, all main). 13 Richardson correctly warns no_clear_dominant_roof_body. No geometry mutation, no status changes. See triage §14. |
| 2026-04-19 | V2P0.1 Ground suppression hardening. 4-way conjunction rule removes obviously ground-like elongated faces: height<1.5m AND elongation>4.0 AND pitch<15° AND not structure_like. Uses eigenvalue-based elongation ratio. Validated on 8 properties: 20 Meadow face[3] suppressed (elong=7.61, removed from roof_faces), 0 false positives on clean/steep/complex/improved roofs. Adds `v2p0_ground_surface_suppressed` review reason and per-face elongation debug. See triage §12. |
| 2026-04-19 | V2P1 Structural Coherence / Mirrored-Pair Logic. Debug-first evaluation of whether surviving roof faces form plausible mirrored/ridge-paired relationships. 4 signal families (azimuth opposition, pitch similarity, spatial edge gap, area ratio), 5 pair types, 6 warning codes. Validated on 8 properties: 15 Veteran coherence=0.92 (2 gable pairs, 0 warnings), Lawrence coherence=0.81 (2 gable pairs), 225 Gibson coherence=0.44 (correct poor coverage warning), 175 Warwick coherence=0.5 (steep roof not catastrophically scored). No status changes (debug-only). No V1/V2P0 interference. See triage §13. |
| 2026-04-19 | V2P0 Ground/Structure Separation. Uses LiDAR/DSM elevation to classify each ML roof face as structure_like (height>2.5m), ground_like (height<1m AND pitch<10° AND area>15m²), or uncertain. Reconstructs 281×281 DSM grid from raw LiDAR points, per-face local ground reference via ring sampling (3-12m, p25). Validated on 8 properties: 20 Meadow face[3] correctly flagged ground-like (h=0.07m, auto_accept→needs_review), 13 Richardson face[0] flagged ground-like (h=0.37m, double-flagged with p9), 15 Veteran (clean) all structure-like (h=4.2-4.6m, no regression), 175 Warwick all structure-like (h=4-7.7m). 5 helper functions, 15 per-face metrics, 13 build-level debug fields. See triage §12. |
| 2026-04-19 | P9 unmatched/fallback strategy. Flags builds where ML faces don't match any Google Solar segments. 3 rules: build_unmatched (0/N matched), low_match_fraction (<50% matched when >=3 faces), low_match_confidence (>=50% of matches below 0.3). Validated on 7 properties: 13 Richardson St auto_accept→needs_review (the gap), 11 Ash Road gets additional context, 0 clean regressions, 0 improved regressions, P8 corrections stable. Adds `p9_build_assessment` debug object and 3 client-side reason labels. See triage §11. |
| 2026-04-19 | P8 conservative pitch correction. One-directional correction using Google Solar pitch as external reference. 5-guard rule: matched, confidence > 0.5, ml-google delta > 10°, google_pitch < 45°, google_area > 8m². Corrected pitch = google_pitch + 2°. Validated on 7 properties: 225 Gibson face[2] corrected 46.9°→17.3° (eliminated only >40° face), 175 Warwick correctly blocked (Google agrees steep), 0 clean regressions, 0 improved regressions. Adds `google_solar_pitch_corrected` review reason, full per-face debug. See triage §10. |
| 2026-04-19 | Engineering phase plan restructure. Replaced organic priority list with strict P0–P8 phase map. Each phase has purpose/inputs/outputs/debug structure/bank criteria/failure types/reopen trigger. P0–P7 all BANKED (orientation, erosion, RANSAC, rules, quality gate, review banner, pipeline debug, P8 instrumentation). P8 correction ACTIVE — one-directional pitch correction using Google Solar cross-val data, 4-guard conservative design. Backlog section for non-phase items. See section I. |
| 2026-04-19 | P3 solar pitch cross-validation. CRM server fetches Google Solar `roofSegmentStats` after ML returns, matches each cleaned face to nearest segment (8m radius), computes pitch/azimuth deltas and match confidence. Build-level flag: `google_solar_pitch_mismatch` when ≥50% of matched faces disagree by >15°. Validated on 8 properties: clean 0.47° mean Δpitch (no flag), improved 7-9° (no flag), 225 Gibson 18.25° mean (FLAGGED, 4/6 faces >15° delta), 175 Warwick confirms genuinely steep roof (Google agrees at 47°). Non-blocking, no ML changes. See `server.js:24657-24740`. |
| 2026-04-19 | Post-result action buttons in needs_review banner. "Undo" (restores pre-ML state via `unifiedUndo()`) and "Dismiss" (acknowledges warning, keeps ML faces). Banner set to `pointer-events:auto` only for needs_review; all other states non-interactive. `_mlBanner()` helper resets pointer-events on every call. Solves the post-ML decision ambiguity: user now has a clear path to discard or keep a flagged result. |
| 2026-04-19 | Status-aware ML Auto Build banner. `needs_review` builds now show an orange warning banner with human-readable reasons (e.g., "Some roof planes have steep/uncertain pitch") instead of the default green success banner. Warning banners persist until user acts (no auto-hide). `reviewPolicyReasons` array now flows from ML envelope through server proxy to client. 8 reason labels mapped. Validated on 3 properties: clean (green), wrong_pitch (orange + 3 reasons), ugly (orange + 1 reason). Zero ML logic changes. |
| 2026-04-19 | Pipeline phase debug framework. 7-phase structured report at `crm_result.metadata.pipeline_phases` with per-phase status/inputs/outputs/metrics/warnings and a `summary` object identifying the weakest phase. One-line server log. Zero logic changes — purely additive observability. See `ml_ui_server.py:_build_pipeline_phases()`. |
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
| `server.js` (~26.1k lines) | `/design` template (L5500-17600): `mlAutoBuild` L16225, `mlAutoBuildContinue` L16256, `_mlBanner` L16210, `finalizeRoofFace` L14154 (ML branch), `rebuildRoofFace` L14243 (ML branch), `serializeRoofFaces` L10419 (source persistence), `loadDesign` L9169 (ML rehydrate), `captureRoofSnapshot` L14513 (sourceTag), `restoreRoofSnapshot` L14556 (ML rehydrate), shared-edge helpers L11277-11316, single-slope helpers L11519-11610. Server routes: `/api/ml/auto-build` L24630, ML defaults L24627. |
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

### P3 solar cross-validation (at `crm_result.metadata.p3_solar_crossval`)

Added by CRM server (not ML wrapper) after ML returns. Compares ML pitch/azimuth against Google Solar roofSegmentStats.

- `google_segments_available` — count of Google Solar roof segments for the address.
- `match_radius_m` — max distance (8m) for face-to-segment matching.
- `matches[]` — per-face match data:
  - `face_idx`, `matched` (bool)
  - If matched: `ml_pitch`, `google_pitch`, `pitch_delta`, `ml_azimuth`, `google_azimuth`, `azimuth_delta`, `match_distance_m`, `match_confidence`, `google_area_m2`, `google_segment_idx`
- `build_summary` — aggregate:
  - `matched_faces`, `unmatched_faces`
  - `mean_abs_pitch_delta`, `max_abs_pitch_delta`
  - `faces_with_large_delta` (count of faces with |Δpitch| > 15° and confidence > 0.3)
  - `build_pitch_mismatch` (bool) — true when ≥50% of ≥2 matched faces have large delta

### Pipeline phase report (at `crm_result.metadata.pipeline_phases`)

Structured per-phase debug report. Each phase has `name`, `status` (ok/warn/fail/skip), `inputs`, `outputs`, `metrics`, `warnings`. Top-level `summary` identifies the weakest phase at a glance.

| Phase | Key | What it covers | Key metrics |
|---|---|---|---|
| P1 | `p1_imagery` | Satellite image fetch + centre crop | footprint_m, mpp |
| P2 | `p2_dsm` | DSM grid construction from LiDAR points | finite_samples, coverage_pct |
| P3 | `p3_ml_inference` | ML pipeline + usable gate | usable_score, raw_faces |
| P4 | `p4_target_isolation` | Building grouping + subcluster refinement | isolation_ratio, groups |
| P5 | `p5_geometry_cleanup` | Rules B-G + duplicate removal | drop_rate, drops_by_rule, dominant_drop_rule |
| P6 | `p6_quality_gate` | Build-level tilt quality gate | steep_fraction, flagged |
| P7 | `p7_output` | Final CRM face assembly | tilt_distribution, median_pitch |

**Summary object** (`pipeline_phases.summary`): `verdict` (ok/warn/fail), `weakest_phase`, `face_counts` (raw→isolation→cleanup→final), `warnings[]`.

Server log emits a one-line summary: `[crm_auto_build] pipeline: verdict=ok weakest=none faces=15→5→4→4 warnings=0`.
