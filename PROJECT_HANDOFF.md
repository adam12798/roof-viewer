# ML Auto Build — Project Handoff

Single source of truth for resuming this project on a fresh machine or new session. For general CRM setup (Node, npm, login accounts), see `SETUP.md`. This covers the ML Auto Build slice end-to-end.

**Last updated:** 2026-04-19 (V2P1 structural coherence / mirrored-pair logic)
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
**Banked config:** Status-aware banner, 14 reason labels (including `google_solar_pitch_mismatch`, `google_solar_pitch_corrected`, `p9_build_unmatched`, `p9_low_match_fraction`, `p9_low_match_confidence`, `v2p0_ground_surface_detected`), Undo/Dismiss buttons, `pointer-events:auto` only on `needs_review`.
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
**Status:** BANKED. 20 Meadow face[3] flagged ground-like (h=0.07m, auto_accept→needs_review). 13 Richardson face[0] flagged ground-like (h=0.37m, double-flagged with p9). 15 Veteran (clean) all structure-like (h=4.2-4.6m), no regression. 175 Warwick all structure-like (h=4-7.7m). See triage §12.
**Reopen trigger:** False positive on a legitimate low-pitch roof section, or a ground-level surface that evades all three guards.

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
