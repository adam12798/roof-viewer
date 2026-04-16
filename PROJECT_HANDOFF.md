# ML Auto Build — Project Handoff

This document is the single source of truth for picking up ML Auto Build work on a fresh machine or in a new session. It covers what exists, how it's wired, how to run it, what's brittle, and what to do next.

For general CRM setup (Node, npm install, `.env`, login accounts), see `SETUP.md`. This document only covers the ML Auto Build slice.

---

## 1. Project purpose

**What is ML Auto Build?**
A one-click path inside the CRM design editor that runs a trained ML pipeline on a satellite tile + DSM grid around the active design pin and returns a preview 3D roof (plane polygons with real tilt/azimuth) the user can then edit manually.

**Problem it solves.**
Before ML Auto Build, every new design started with either (a) a blank canvas the user draws by hand or (b) the older "Auto detect roof" / "Smart roof" heuristic paths that often produced nothing useful on complex buildings. ML Auto Build gives the user a real starting geometry in ~10–60 seconds for most suburban/urban roofs, so manual editing starts from something close rather than from scratch.

**What it now does inside the CRM.**
- User clicks the ML Auto Build button in the design editor.
- A request is built from the design pin (lat/lng), the imagery URL, and a 281×281 DSM grid sampled around the pin.
- The request is forwarded through a thin Node orchestrator to an out-of-process Python wrapper that crops the image, fits a DSM, runs the pipeline, and returns CRM-shaped `roof_faces` (each with `{vertices, pitch, azimuth, height}`).
- The faces are dropped into the same preview state that the existing `finalizeRoofFace` / `rebuildRoofFace` codepath uses. The user sees the 3D preview immediately.
- **Nothing is persisted to the saved design until the user clicks Save.**

**What is intentionally still not changed.**
- Manual drawing, per-plane editing, dormer placement, tree placement, calibration flow — all untouched.
- Save flow is untouched. `saveCurrentDesign()` is the only path that writes to `data/projects.json`.
- No new persistent UI (no new tab, no settings panel, no review queue UI). The ML Auto Build button is the only new control that was added, and it already existed before this work started.
- Old "Auto detect roof" and "Smart roof" buttons are still present; ML Auto Build is an additive parallel path, not a replacement.

---

## 2. Current architecture

```
 CRM browser                              CRM Node (3001)                       ML wrapper (5001)                      ML engine
 -----------                              ----------------                       -------------------                    ----------
 ML Auto Build button                                                                                                    
   └─ mlAutoBuild()                                                                                                       
      └─ loadLidarPoints() (best-effort)                                                                                  
      └─ mlAutoBuildContinue()                                                                                            
           │ JSON body: lidar.points, image.url, design_center, options            
           ▼                                                                                                              
         POST /api/ml/auto-build  ───────▶ forwards body to ML_ENGINE_URL        POST /api/crm/auto-build               
                                                                                    │ ↳ resolves image bytes              
                                                                                    │   (Google staticmap, scale=2)       
                                                                                    │ ↳ centre-crops to 640×640           
                                                                                    │ ↳ builds SceneInput.elevation       
                                                                                    │   from lidar.points (optional)      
                                                                                    │ ↳ calls handle_crm_auto_build       
                                                                                    │                                  ┌──▶ usable_gate → outline → planes
                                                                                    │                                  │    → orientation (DSM fit or default pitch)
                                                                                    │                                  │    → semantic_edges → keepout
                                                                                    │                                  │    → review_policy
                                                                                    │◀─────────────────────────────────┘
                                                                                    │ ↳ target-building isolation       
                                                                                    │   (cluster ML faces,              
                                                                                    │    keep cluster nearest origin)   
                                                                                    │ ↳ mirror crm_faces → roof_faces   
                                                                                    │   in CRM's {x,z}/pitch/azimuth    
                                                                                    │                                     
                                     appends to data/ml-drafts.json (audit)        response envelope                     
                                     responds { draftId, status, crmResult }  ◀─── with crm_result.roof_faces            
      ◀─ response                                                                                                         
      └─ pushUndo()                                                                                                       
      └─ clearAllRoofFaces()                                                                                              
      └─ faces.forEach(finalizeRoofFace + rebuildRoofFace)    ← same preview codepath used everywhere else                
      └─ preview visible; saved design on disk is unchanged                                                               
```

Key property: **every arrow in this diagram is additive to what already existed.** The CRM still mutates `data/projects.json` only through the existing save path. `/api/ml/auto-build` never writes a design; it only appends to `data/ml-drafts.json` for audit.

---

## 3. Current end-to-end status

| Concern | Status |
|---|---|
| ML Auto Build button in design editor | Exists (pre-existing) |
| CRM → ML transport | Working; Node forwards to configurable URL |
| Real ML pipeline used (not mock) | Yes — `use_mock=False`, warm `PipelineRunner` |
| Vertex alignment (CRM local frame matches design pin) | Fixed (image-centre-origin shift applied in the wrapper) |
| Target-building isolation (drop neighbours) | Working; shapely cluster filter keeps the cluster nearest origin |
| Centre-crop around pin before inference | Working; 1280→640 (~35 m footprint) |
| DSM elevation threading from CRM → ML | Working; real tilts/azimuths when DSM is supplied |
| CRM-only soft usable gate (floor 0.20) | Working |
| Preview loads into editable roof faces | Working; same `finalizeRoofFace`/`rebuildRoofFace` codepath |
| LiDAR unavailable no longer blocks | Working; warns and continues image-only |
| Missing ML config → actionable error | Working; banner surfaces `detail`+`hint` |
| Auto-save on ML Auto Build | **Not implemented, not wanted** |
| Saved design modified outside user's Save click | **Never** |

---

## 4. Current behaviour / product rules

- **ML Auto Build creates a preview only.** The in-memory `roofFaces3d` / preview state is replaced; `data/projects.json` is not touched.
- **Manual controls stay the same.** Roof drawing, vertex edits, section splits, pitch overrides, dormers, trees — all work against the ML-produced preview exactly as they do against a hand-drawn one.
- **Undo works.** `mlAutoBuild` calls `pushUndo()` before `clearAllRoofFaces()`, so a single undo restores whatever was on screen before the user clicked the button.
- **Reload without saving keeps the old saved design.** Because ML Auto Build only writes to preview state, navigating away or reloading drops the preview and the on-disk design is intact.
- **Save persists the current preview.** The existing Save button calls `saveCurrentDesign()`, which writes whatever is currently in preview — whether it came from ML, manual drawing, or a mix.
- **Old "Auto detect roof" / "Smart roof" buttons still exist.** ML Auto Build is parallel to them; nothing was removed.
- **Standalone ML engine behaviour is unchanged.** Every override used by the CRM (soft gate, DSM threading) is opt-in via explicit parameters; defaults reproduce the engine's original conservative behaviour.

---

## 5. Pipeline sequence (what actually happens on a click)

1. **Client gathers context** (`mlAutoBuild` / `mlAutoBuildContinue` in `server.js` ~L15930).
   - Waits up to ~10 s for `lidarRawPoints` to populate. On timeout or error, shows a yellow warning banner and continues without LiDAR.
   - Builds payload: `projectId`, `designId`, `anchor_dots`, `calibration_offset`, `lidar.points[]`, `image.url`, `design_center{lat,lng}`, `options.pipeline_mode="ml_v2"`.
2. **Node orchestrator** (`POST /api/ml/auto-build` in `server.js` ~L24317).
   - Defaults `ML_ENGINE_URL=http://127.0.0.1:5001`, `ML_AUTO_BUILD_PATH=/api/crm/auto-build`. Env vars override.
   - Forwards the body verbatim; appends the response envelope to `data/ml-drafts.json` for audit; returns `{draftId, status, disposition, reason, crmResult}` to the client.
3. **ML wrapper** (`ml_ui_server.py /api/crm/auto-build`).
   - Resolves image bytes (Google Static Maps, `zoom=20`, `scale=2` → real 1280×1280).
   - Computes `true_mpp = 156543.03392 * cos(lat) / 2^20 * 0.5` (≈ 0.055 m/px at US latitudes).
   - **Centre-crops image bytes to 640×640** (~35 m footprint centred on the design pin).
   - **Builds `SceneInput.elevation`** from `lidar.points[]` — rasterises 281×281 DSM, flips south→north to match image, centre-crops to match image footprint. If `lidar.points` is empty or invalid, `scene=None` and orientation falls back to default pitch (logged).
   - Calls `handle_crm_auto_build_request` with `usable_gate_min=0.20`.
4. **ML engine pipeline** (`ml_engine/core/pipeline.py PipelineRunner.run`).
   - **usable_gate** — ResNet-18 image classifier. Short-circuits pipeline when `prob_usable < usable_gate_min`.
   - **outline** — Mask R-CNN produces roof outline polygon.
   - **planes** — Mask R-CNN produces per-plane polygons.
   - **orientation** — DSM fit per plane when `scene.elevation` is present (real tilt+azimuth); default pitch fallback (10°, no azimuth) when absent.
   - **semantic_edges** — edge classification (ridge/eave/valley/rake/hip). Advisory only; never blocks.
   - **keepout** — vent/obstruction zones. Advisory only.
   - **review_policy** — computes `auto_build_status ∈ {auto_accept, needs_review, reject}` and `review_policy_reasons[]`.
5. **Soft-gate override** (handler, `ml_engine/api/crm_auto_build.py`).
   - If `usable_gate_min ≤ raw_usable < 0.50` AND no other hard-reject reasons fired, strip `usable_gate_very_low`/`usable_gate_low`, prepend `crm_soft_gate_applied`, force `auto_build_status="needs_review"`. Never upgrades anything to `auto_accept`.
6. **CRM-safe face conversion** (`ml_engine/adapters/crm.py`).
   - Each plane → `CRMFace` with rectangle-fit vertices, tilt, azimuth, area, confidence, review reasons.
7. **Target-building isolation** (`ml_ui_server.py _select_target_building`).
   - Groups ML faces into connected clusters (shapely dilation ≤0.5 m). Picks the cluster whose area-weighted centroid is nearest origin (= design pin). Ties broken by total area.
8. **Coordinate shift** (`ml_ui_server.py` after envelope).
   - Shifts vertices from image-top-left origin to image-centre origin (= design pin). `x → x - half_w`, `z → y - half_h`. After this step, a vertex at (0,0) is the design pin.
9. **Load into editor** (client).
   - `pushUndo()` → `clearAllRoofFaces()` → `faces.forEach(finalizeRoofFace + rebuildRoofFace)`. Each face is coloured from a preset palette. Preview is live immediately.

---

## 6. Important thresholds / logic

### Usable gate

| Band | Action | Status |
|---|---|---|
| `raw < 0.20` | Hard reject; no geometry | `reject` |
| `0.20 ≤ raw < 0.50` | Pipeline runs; soft gate fires | `needs_review` + `crm_soft_gate_applied` |
| `0.50 ≤ raw < 0.65` | Normal review-policy band | `needs_review` + `usable_gate_low` |
| `raw ≥ 0.65` | Clean | `auto_accept` or `needs_review` based on other signals |

CRM-only. Standalone callers keep the default `usable_gate_min=0.50`.

### Soft-gate invariants

- Never upgrades a result to `auto_accept`.
- Never overrides a downstream hard error (missing outline, no planes, pipeline_error, etc.). Those still reject.
- `crm_soft_gate_applied` always appears as the first entry in `review_policy_reasons` when the soft gate fires.
- Observability fields on envelope: `raw_usable_score`, `effective_usable_gate_min`, `soft_gate_applied`.

### Target-building selection

- Dilates each face polygon by 0.5 m, unions, finds connected components → clusters.
- Each cluster's area-weighted centroid is computed in the CRM local frame.
- Pick the cluster with centroid Euclidean-nearest to origin (design pin).
- Pass-through when ≤1 face exists (no filter applied).

### Crop rule

- 640×640 centre crop of the fetched 1280×1280 PNG.
- Preserves `metres_per_pixel` (crop is scale-preserving).
- At `true_mpp ≈ 0.055`, footprint ≈ 35 m × 35 m.
- Skipped gracefully if source image is smaller than target.

---

## 7. What is still weak / not solved

- **Usable gate false-negatives in the 0.15–0.20 band.** Two properties in the broad validation (Tanager at 0.16, Newton at 0.17) are visually real roofs that still reject because they fall below the 0.20 floor. Dropping the floor below 0.20 starts to risk admitting genuinely bad imagery (a few tiles hover in the 0.05–0.15 range on water/tree canopy/low-sun geometry).
- **Target isolation edge case: house + detached garage.** One property (Cambridge SFH+garage) clustered house and garage as a single entity because the 0.5 m dilation touched both. Result preserves 15 faces including the garage. User would have to manually delete garage faces. Not broken; not ideal.
- **Semantic edges and keepout zones are advisory only.** They never hard-block the pipeline. If edge classification or vent detection is wrong, the roof still builds — downstream review sees a warning.
- **Orientation depends on DSM availability and quality.** When LiDAR points are absent or the tile has no DSM coverage from Google Solar, every plane gets the default pitch (10°) fallback. The review_policy surfaces `all_planes_default_pitch` when that happens; otherwise DSM-fit residuals can still be noisy on small planes and surface `orientation_high_residual` / `orientation_low_inlier` per-face.
- **No reviewer UI.** `ml-drafts.json` accumulates every ML call with disposition/reasons for audit, but there's no in-CRM page to browse or filter it. Intentional — no reviewer UI was in scope.
- **Old roof detection buttons coexist.** "Auto detect roof" and "Smart roof" still sit next to ML Auto Build. Not yet decided whether to remove, hide, or keep them as a legacy fallback.

---

## 8. Validation results (latest broad pass, 18 properties)

Sample spans suburban SFH, dense suburban, urban close-neighbour, multifamily, townhouse row, coastal, and a detached-garage case.

- **Usable previews produced:** 10/18 (56%) before soft gate; **13/18 (72%) after** the 0.20 soft gate.
- **Hard rejects:** 8/18 without soft gate; 5/18 with soft gate.
  - 3 "truly bad" rejects (usable < 0.05) stay rejected — correct behaviour.
  - 2 borderline in 0.16–0.17 band still reject — arguable false negatives below the floor.
- **Target-isolation wins:** 9/10 usable cases filtered sensibly (15→7, 11→6, 13→7 on dense lots; pass-through on small clusters). 1 case (Cambridge SFH+garage) merged house+garage — noted above.
- **DSM-fit orientation wins:** 10/10 usable cases used `dsm_fit`. Zero `all_planes_default_pitch` reasons fired when LiDAR was supplied. Plane tilts span a realistic 4°–43° range.
- **Archetypes that tend to succeed:** any roof where the ResNet-18 usable classifier scores ≥ 0.70. Archetype is not predictive — SFH, triple-decker, brownstone row all succeed when imagery is clear.
- **Archetypes that tend to fail:** properties where the Google Static Maps tile is obscured (heavy canopy, low sun angle, water). The classifier signal is the actual driver.

---

## 9. Key files / modules

### CRM repo (`/Volumes/Extreme_Pro/project Interrupt`)

| File | Relevant region | What it does |
|---|---|---|
| `server.js` | `mlAutoBuild()` ~L15930 | LiDAR-optional client flow; warn-and-continue if missing. |
| `server.js` | `mlAutoBuildContinue()` ~L15968 | Builds `mlPayload`; posts to `/api/ml/auto-build`; loads returned `roof_faces` via existing preview codepath. Surfaces `hint`+`detail` in error banner. |
| `server.js` | `POST /api/ml/auto-build` ~L24317 | Thin Node orchestrator. Defaults to `http://127.0.0.1:5001/api/crm/auto-build`. Appends envelope to `data/ml-drafts.json`. Returns actionable 503 on upstream failure. |
| `server.js` | `app.listen` ~L25017 | Boot log prints the effective ML endpoint and whether it came from env or default. |
| `server.js` | `/api/lidar/points` ~L2364 | Fetches 281×281 DSM grid from Google Solar API; used by the client to populate `lidar.points`. |
| `server.js` | `/api/satellite` ~L2229 | Satellite image proxy; used by the ML wrapper as the fallback image source if it can reach the CRM. |
| `data/ml-drafts.json` | — | Append-only audit log of every ML Auto Build call (status, disposition, review reasons, `crm_result`). Read by `GET /api/ml-drafts`. |

### ML repo (`/Volumes/Extreme_Pro/ML`)

| File | What it does |
|---|---|
| `ml_ui_server.py` | Flask server on port 5001. `/api/crm/auto-build` resolves image bytes, centre-crops, builds `SceneInput.elevation` from `lidar.points`, calls the handler with `usable_gate_min=0.20`, runs target-building isolation, shifts to design-pin origin, returns CRM-shaped envelope. `/frame_debug` block surfaces `crop_debug`, `dsm_debug`, `soft_gate_debug`, `target_selection`. |
| `ml_engine/core/pipeline.py` | `run_pipeline` and `PipelineRunner.run` accept `usable_gate_min: float = 0.5`. Short-circuit uses `conf < usable_gate_min`. Default preserves historic behaviour. |
| `ml_engine/api/crm_auto_build.py` | `CRMAutoBuildRequest.usable_gate_min` field. Post-`apply_review_policy` soft-gate override: strip `usable_gate_very_low` when raw usable is in `[usable_gate_min, 0.50)` and no other hard-errors fired; force `auto_build_status="needs_review"`; prepend `crm_soft_gate_applied`. Envelope adds `raw_usable_score`, `effective_usable_gate_min`, `soft_gate_applied`. |
| `ml_engine/adapters/crm.py` | Rich `MLRoofResult` → CRM-safe `crm_faces`. Drops planes below `min_plane_confidence=0.40`. |
| `ml_engine/core/review_policy.py` | Decision table for `auto_build_status`. Hard thresholds: `USABLE_GATE_REJECT=0.40`, `USABLE_GATE_REVIEW=0.65`, `OUTLINE_REJECT=0.35`, `OUTLINE_REVIEW=0.60`, `PLANES_MEAN_REVIEW=0.50`. Unchanged. |
| `ml_engine/core/scene.py` | `SceneInput` and `ElevationSource` shape. DSM `heights_m` must be 2D float32 and image-aligned (north-up). |

### Debug fields worth knowing

Inside every response `envelope.crm_result.metadata.frame_debug`:

- `crop_debug` — `source_wh_px`, `target_wh_px`, `crop_offset`, whether crop actually fired.
- `dsm_debug` — `built`, `final_shape`, `finite_samples`, whether DSM was centre-cropped to match image footprint.
- `soft_gate_debug` — `raw_usable_score`, `effective_usable_gate_min`, `soft_gate_applied`.
- `target_selection` — raw cluster count, selected cluster size, selection reason.
- `sample_raw_vertex` / `sample_shifted_vertex` — one vertex before/after the image-centre origin shift; fastest way to catch alignment regressions.

---

## 10. How to run locally

### Baseline CRM setup

Follow `SETUP.md` for Node install, `npm install`, Google Maps API key, login accounts. That covers everything up to the point where `node server.js` boots.

### ML wrapper setup (first time)

```bash
# Python 3.12+ required (Python 3.13 also works).
cd /Volumes/Extreme_Pro/ML           # or wherever you cloned the ML repo
python3 -m venv .venv                # optional; the codebase also works with system Python
source .venv/bin/activate             # if using venv
pip install -r requirements.txt
```

Trained model weights live under `artifacts/`, `artifacts_outline/`, `artifacts_planes_v2/`, `artifacts_semantics_v2/`, `artifacts_obstructions_v2/`. First request after startup loads all of them (~90 s on CPU).

### Environment variables

**CRM side (`project Interrupt/.env`):**
```
GOOGLE_API_KEY=your-google-maps-api-key   # required for satellite + DSM
PORT=3001                                 # optional
ML_ENGINE_URL=http://127.0.0.1:5001       # optional; default matches this
ML_AUTO_BUILD_PATH=/api/crm/auto-build    # optional; default matches this
```

**ML side (export before starting `ml_ui_server.py`):**
```
GOOGLE_API_KEY=...   # or GOOGLE_MAPS_KEY; same key as the CRM uses
```

The ML wrapper needs its own Google key because it fetches the staticmap directly; it does not proxy through the CRM's satellite endpoint (the CRM `requireAuth` middleware would block it).

### Starting both services

```bash
# Terminal 1 — CRM
cd "/Volumes/Extreme_Pro/project Interrupt"
node server.js
# → "Solar CRM running at http://localhost:3001"
# → "ML Auto Build → http://127.0.0.1:5001/api/crm/auto-build (default)"

# Terminal 2 — ML wrapper
cd /Volumes/Extreme_Pro/ML
export GOOGLE_API_KEY=...
python3 ml_ui_server.py
# → "Running on http://127.0.0.1:5001"
```

Open `http://localhost:3001`, log in, open any project's design editor, click **ML Auto Build**.

### Gotchas

- **Restart after env changes.** Node reads env at boot; changing `ML_ENGINE_URL` in `.env` has no effect until you kill and re-start `node server.js`.
- **Restart after ML code changes.** The Python server does not auto-reload. Edit → kill port 5001 → restart.
- **Verify ports are free** before starting. Stale processes are a known trap (see project memory). `lsof -nP -iTCP:3001 -iTCP:5001 -sTCP:LISTEN`.
- **DSM failures are silent-ish.** If Google Solar has no DSM for a lat/lng, `/api/lidar/points` returns `{error, points:[]}`. The client will warn and run image-only. Nothing breaks, but orientations will be default-pitch.

---

## 11. Smoke-test checklist

Quick sanity pass for a fresh machine.

1. **ML server up.** `curl http://127.0.0.1:5001/` returns the ML UI HTML.
2. **CRM up.** Boot log shows `ML Auto Build → http://127.0.0.1:5001/api/crm/auto-build (…)`.
3. **CRM env configured.** `.env` has `GOOGLE_API_KEY`. Without it, `/api/satellite` fails and DSM+image calls die.
4. **Click ML Auto Build** on three test properties:
   - **Good property** (e.g. 20 Meadow Dr, Lowell @ 42.6463,-71.3545). Expect: usable ≥ 0.70, 5–10 roof faces, preview visible within ~10–20 s. Pitch/azimuth varied (not all 10°).
   - **Borderline property** (e.g. 254 Foster St, Lowell @ 42.6322,-71.3378). Expect: soft-gate fires, preview loads with `crm_soft_gate_applied` in review reasons, `needs_review` banner. Preview may need manual cleanup.
   - **Clearly bad property** (e.g. Belmont @ 42.3959,-71.1786). Expect: yellow or red banner showing "ML Auto Build returned no roof faces — disposition: rejected · gate: reject:usable_gate(0.00)". No geometry loaded. On-disk design untouched.
5. **Undo.** After a successful ML Auto Build, hit Undo. Prior geometry (if any) is restored. Another Undo keeps walking back the history.
6. **Reload without saving.** Refresh the browser. The saved design on disk is what returns — not the ML preview.
7. **Save.** Click Save. Reload. The ML-derived preview now persists as the saved design.
8. **LiDAR-missing path.** Temporarily set an invalid `GOOGLE_API_KEY` and click ML Auto Build. Expect yellow banner "LiDAR unavailable — running ML Auto Build without DSM; pitch/orientation may need review." followed by image-only pipeline run. All plane tilts will be 10° (default pitch).
9. **ML wrapper down.** Kill port 5001, click ML Auto Build. Expect banner "ML Auto Build: ML engine unreachable — request to http://127.0.0.1:5001/api/crm/auto-build failed … · Start the ML wrapper on http://127.0.0.1:5001 …".

---

## 12. Next recommended tasks (priority order)

1. **Broader real-property validation (continue).** Target ≥50 properties spanning more suburbs and more "previously good" coordinates. We currently have 18. Collect real usable scores, face counts, and target-isolation signals into a structured log so regressions are obvious.
2. **Investigate merged house+garage edge case.** Cambridge SFH+garage returned 15 faces in a single cluster. Decide: tighten the 0.5 m dilation, cluster-by-area-ratio, or add a centroid-distance cutoff so a secondary structure > Nm from the pin is dropped.
3. **Surface `ml-drafts.json` as a debug-only table.** Not a full review UI — just a read-only list at `/ml-drafts` or similar, scoped by projectId, so a developer can see which properties soft-gated, which rejected, which had missing DSM. Zero product/UI impact.
4. **Revisit usable-gate floor only if more evidence appears.** Dropping from 0.20 to 0.15 would rescue Tanager/Newton but risks admitting a few genuinely-bad cases. Gather ~20 more borderline examples before moving the number.
5. **Pre-ML crop tuning (only if validation shows need).** 35 m has been robust in the current dataset. If larger roofs surface and clipping shows up, move to 42 m or make it property-size-aware.
6. **Decide what to do with legacy roof buttons.** "Auto detect roof" and "Smart roof" still exist. Options: hide behind a flag, delete, or keep as a documented fallback. This is a product call, not a technical one.

---

## 13. Decisions already made (do not undo accidentally)

- **No manual workflow changes.** Manual drawing, vertex editing, calibration, dormer placement, tree placement — all preserved bit-for-bit.
- **No new persistent UI controls for this flow.** No new buttons, tabs, settings pages, or review queues. Transient banners only.
- **ML Auto Build is preview-only until Save.** The saved design on disk never changes outside the user's Save click.
- **Standalone ML engine stays conservative by default.** Every widening override (soft gate, DSM threading) is opt-in via explicit function parameters. The `run_pipeline` / `PipelineRunner.run` defaults reproduce the engine's historic behaviour exactly.
- **CRM-only overrides are allowed** when the standalone engine's default would produce a worse product experience. The current override set: `usable_gate_min=0.20` and `SceneInput.elevation` built from CRM DSM.
- **Target-building isolation lives in the ML wrapper**, not the ML engine core. The engine returns every plane it finds; the wrapper filters to the design-pin cluster. This keeps the engine's API purely geometric and leaves the CRM-scoped logic on the CRM side of the seam.
- **No retraining on this track.** Every improvement is preprocessing, policy, or plumbing. Model artefacts under `artifacts/` have not been touched.

---

## 14. Footer

- **Last updated:** 2026-04-16
- **Updated by:** Claude (session on `/Volumes/Extreme_Pro/project Interrupt`, branch `main`)
- **Current recommended next task:** Broader real-property validation — expand the dataset from 18 to ≥50 real addresses (items 1 and 2 in §12 feed each other; doing 1 first surfaces more 2-class edge cases).
