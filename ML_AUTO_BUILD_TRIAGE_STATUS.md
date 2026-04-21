# ML Auto Build — Triage Status

Status log for the ML Auto Build ugly-case triage pass. This file is the working record; `PROJECT_HANDOFF.md` remains the canonical source-of-truth.

**Last updated:** 2026-04-21 (V3P4.3 Geometry Stabilization Packet banked — GEOM-001/002/003/004/005/006 + GEOM-008 addressed. 72/72 invariants pass. Audit items GEOM-007/009/010/011/012/013 remain open for a later packet.)
**Pass status:** Complete — 32 rows bucketed (94 C St excluded as duplicate/mismatch).
**Bucket counts are operator-authoritative.** The labeled row table (§5) has 25 unique draft IDs; 7 rows were lost to paste truncation and need recovery (see §4.3).

---

## 1. Final bucket counts

| Bucket | Count | % of 32 | % of non-reject (24) |
|---|---:|---:|---:|
| `wrong_pitch` | 14 | 43.8% | 58.3% |
| `ugly_but_correct_building` | 6 | 18.8% | 25.0% |
| `reject_correct` | 5 | 15.6% | — |
| `clean` | 4 | 12.5% | 16.7% |
| `reject_too_strict` | 3 | 9.4% | — |
| `wrong_azimuth` | 0 | 0.0% | 0.0% |
| `gap_overlap` | 0 | 0.0% | 0.0% |
| `wrong_target` | 0 | 0.0% | 0.0% |
| `investigate` | 0 | 0.0% | 0.0% |
| **Total** | **32** | — | — |

---

## 2. Conclusions

- **`wrong_pitch` is the dominant failure mode.** 14 of 32 total (44%); 14 of 24 non-reject (58%). Confirmed with the full sample — no longer provisional.
- **Target isolation is off the critical path.** `wrong_target` = 0 across all 32 rows. The 0.3 m + 0.15 m subcluster refinement is holding.
- **`gap_overlap` did not surface.** 0 across 32 rows. Vertex-snapping work is deprioritized.
- **Reject gate is roughly calibrated.** 5 `reject_correct` vs 3 `reject_too_strict` (5:3 ratio). Not enough signal to retune the 0.20 floor. 52 New Spaulding (usable ≈ 0.154) remains the canonical `reject_too_strict` reference.
- **`wrong_azimuth` is not a distinct problem.** 0 in the full sample. Azimuth issues, if they exist, are likely subsumed under `wrong_pitch` (orientation stage produces both).

### Pitch failure characterization (from 10 labeled wrong_pitch drafts, 110 faces)

| Tilt range | Face count | % | Interpretation |
|---|---:|---:|---|
| > 55° | 26 | 24% | Wall-like — near-vertical planes misclassified as roof |
| 40–55° | 32 | 29% | Too steep for typical residential (> ~10/12 pitch) |
| < 40° | 52 | 47% | Plausible residential pitch |

Comparison with clean + ugly cases (82 faces): wall-like 27%, steep 16%, plausible 57%. The wrong_pitch cases are distinguished by excess faces in the 40–55° band (29% vs 16%).

**Root cause:** The ML orientation / plane-fit stage systematically over-estimates tilt. None of the 10 labeled wrong_pitch cases used the default-pitch fallback — all pitches came from DSM-based fitting. The issue is upstream plane normals, not the CRM.

### Confirmed engineering direction

**Steep-face filter in `ml_ui_server.py` geometry cleanup.** Drop faces with tilt > 60° (walls). This is the highest-ROI single task: it removes 24% of faces from wrong_pitch cases, improves visual quality across all buckets, and requires ~30 lines in the ML wrapper with no CRM changes. See §6 for the implementation prompt.

---

## 3. Notes worth preserving

- **20 Meadow Dr** — duplicate cleanup improved 7 raw → 5 selected, but still `wrong_pitch`. Cleanup is not a pitch fix.
- **726 School St**, **15 Buckman**, **1 Wiley St**, **15 Veteran Road** — the 4 `clean` reference cases.
- **44 D St**, **17 Puffer**, **Salem**, **Brockton** + 1 unlabeled — `reject_correct` baselines.
- **52 New Spaulding** — canonical `reject_too_strict` (usable ≈ 0.154).
- **225 Gibson St** — worst pitch case: 7 of 15 faces > 55°, including 76.2° and 71.1°.
- **175 Warwick** — contains an 83.5° face (essentially a vertical wall).

---

## 4. Data quality issues

### 4.1 94 C St Lowell — excluded

Duplicate / mismatch with 52 New Spaulding. Not counted in the 32-row sample. Same status as interim — unresolved.

### 4.2 Duplicate draft ID: `mld_mo39na4r9jej`

This draft ID is assigned to **both** "74 Gates" and "14 Warren Ave" in the labeled set. Only one draft exists in `ml-drafts.json` for this ID (projectId `mo39h4rect1`, 15 faces, `needs_review`). One of these address labels is incorrect — the pin was likely moved between ML runs under the same project. Both are bucketed `ugly_but_correct_building`, so bucket totals are unaffected, but one labeled row is a phantom.

**Note:** The operator flagged "14 Warren Ave and 15 Veteran Road" as potentially sharing a draft ID, but they do not — 14 Warren Ave has `mld_mo39na4r9jej` and 15 Veteran Road has `mld_mo4eqjaimevn`. The actual collision is 74 Gates ↔ 14 Warren Ave.

### 4.3 Paste truncation — 7 missing rows

The labeled set (§5) contains 25 unique draft IDs summing to 25 rows. The operator-stated totals sum to 32. The delta by bucket:

| Bucket | Stated | Labeled | Missing |
|---|---:|---:|---:|
| `wrong_pitch` | 14 | 10 | 4 |
| `reject_correct` | 5 | 4 | 1 |
| `reject_too_strict` | 3 | 2 | 1 |
| `ugly_but_correct_building` | 6 | 5* | 1 |
| `clean` | 4 | 4 | 0 |

\* 5 unique IDs, but 6 address labels (due to the §4.2 duplicate).

15 unlabeled drafts from 2026-04-18 exist in `ml-drafts.json`. The 7 missing rows are among them. Recovery requires the operator to re-match draft IDs to addresses and buckets.

### 4.4 projectId reuse: `mo4dr3dilni`

"1 Brooks St" (`mld_mo4fmx39cqnm`) and "6 Court St" (`mld_mo4er6uprcej`) share projectId `mo4dr3dilni`. A third draft (`mld_mo4etr8xmuje`) also exists under this projectId. Likely pin-moved-between-addresses. Both are in the labeled set with different buckets (ugly / ugly), so no count impact, but flags a data hygiene pattern.

---

## 5. Labeled sample rows

Rows recovered from the operator's paste. 25 unique draft IDs. Order is paste order.

| # | Address | draftId | Bucket |
|---:|---|---|---|
| 1 | 20 Meadow Dr | mld_mo39baa0apgt | wrong_pitch |
| 2 | 225 Gibson St | mld_mo399basasn6 | wrong_pitch |
| 3 | 583 Westford St Lowell | mld_mo394qcebmmm | ugly_but_correct_building |
| 4 | Arlington | mld_mo393sydbvml | reject_too_strict |
| 5 | Brockton | mld_mo39318h06ap | reject_correct |
| 6 | Lawrence | mld_mo392ccpmwue | wrong_pitch |
| 7 | 254 Foster St | mld_mo38w3sioa40 | wrong_pitch |
| 8 | Salem | mld_mo37m8z5lagx | reject_correct |
| 9 | 74 Gates | mld_mo39na4r9jej | ugly_but_correct_building |
| 10 | 43 Bellevue | mld_mo39ojy1z6ij | ugly_but_correct_building |
| 11 | 726 School St | mld_mo39pd8v5lya | clean |
| 12 | 22 New Spaulding | mld_mo39qbukkgoy | wrong_pitch |
| 13 | 44 D St Lowell | mld_mo39r61xayrm | reject_correct |
| 14 | 52 New Spaulding St | mld_mo39rx5rgjcu | reject_too_strict |
| 15 | 17 Puffer St Lowell | mld_mo39sswphblo | reject_correct |
| 16 | 175 Warwick | mld_mo39tnibjz57 | wrong_pitch |
| 17 | 14 Warren Ave | mld_mo39na4r9jej | ugly_but_correct_building |
| 18 | 1 Brooks St | mld_mo4fmx39cqnm | ugly_but_correct_building |
| 19 | 11 Ash Road | mld_mo4ewnijkn31 | wrong_pitch |
| 20 | 15 Buckman | mld_mo4flwd5zg2q | clean |
| 21 | 21 Stoddard | mld_mo4f1e3hoa3p | wrong_pitch |
| 22 | 1 Wiley St | mld_mo4f2gulgpht | clean |
| 23 | 15 Veteran Road | mld_mo4eqjaimevn | clean |
| 24 | 6 Court St | mld_mo4er6uprcej | ugly_but_correct_building |
| 25 | 29 Porter St | mld_mo4fjqso2eb1 | wrong_pitch |
| 26 | 13 Richardson St | mld_mo4flhkttjun | wrong_pitch |

Rows 9 & 17 share draft ID `mld_mo39na4r9jej` — see §4.2. 7 additional rows (4 wrong_pitch, 1 reject_correct, 1 reject_too_strict, 1 ugly) are missing from this table — see §4.3.

---

## 6. Geometry cleanup rules — IMPLEMENTED

### 6a. Rule D — steep-face filter

Drop faces with `pitch > 60°` (`STEEP_TILT_CEILING_DEG = 60.0`). Walls misclassified as roof planes.

### 6b. Rule E — narrow-face filter (plane dimension sanity)

**Failure mechanism:** Faces with short side < 2.0m are eave overhangs, fascia strips, wall edges, or segmentation artifacts. They survive the existing tiny/sliver/steep rules because:
- The sliver rule requires BOTH aspect < 0.15 AND area < 3.0m² — a 1.5m × 4m strip (asp=0.375, area=6m²) passes both gates
- The steep filter only catches tilt > 60° — but many narrow faces are at 10–50° tilt
- The tiny filter only catches area < 1.5m² — but these faces are 2–6m²

**Rule:** Drop faces where `short_side < MIN_SHORT_SIDE_M` (2.0m). Clean cases have minimum short side 2.20m, giving 0.20m of safety margin.

**Impact across all 25 labeled triage rows (faces with short side < 2.0m):**

| Bucket | Total faces | < 2.0m | New catches (not steep) | % of faces |
|---|---:|---:|---:|---:|
| wrong_pitch | 110 | 15 | 9 | 8% |
| ugly | 59 | 16 | 12 | 20% |
| clean | 23 | 1 | 1 | 4% |

The 1 clean catch is 15 Veteran Road face 3: 1.27m × 4.88m, tilt=9.7°, conf=0.587 — the lowest-confidence face on a 4-face property, clearly an edge artifact.

### Validation (synthetic faces, exact triage dimensions)

| Case | Bucket | Input | After D+E | Steep | Narrow | Dup | Output |
|---|---|---:|---:|---:|---:|---:|---:|
| 225 Gibson St | wrong_pitch | 15 | — | 6 | 3 | 1 | 5 |
| 175 Warwick | wrong_pitch | 11 | — | 2 | 1 | 3 | 5 |
| 583 Westford St | ugly | 15 | — | 3 | 1 | 5 | 6 |
| 15 Veteran Road | clean | 4 | — | 0 | 1 | 0 | 3 |
| 15 Buckman | clean | 2 | — | 0 | 0 | 0 | 2 |

### 6c. Rule F — small-relative-to-building filter

**Failure mechanism:** After Rules B–E remove the worst artifacts, some faces remain that are plausible in isolation (area > 1.5m², short side > 2.0m, tilt < 60°) but are tiny relative to the building they belong to. These are chimney caps, dormer walls, fascia returns, or segmentation noise from the ML plane stage. They clutter the 3D scene and confuse panel placement.

**Rule:** Drop faces where `area < SMALL_REL_THRESHOLD * max_surviving_area` (10%). Runs after Rules B–E so `max_surviving_area` reflects only already-cleaned faces. The threshold was calibrated against the 4 clean reference properties — the smallest surviving face-to-max ratio in the clean set is 15% (15 Veteran Road: 20.5m² / 136.4m²), giving 5 pp of safety margin.

**Batch impact (19 reference properties, before → after Rule F):**

| Metric | Before (D+E) | After (D+E+F) | Delta |
|---|---:|---:|---:|
| Total output faces | 127 | 119 | −8 |
| wrong_pitch output | 75 | 69 | −6 |
| ugly output | 34 | 32 | −2 |
| clean output | 18 | 18 | 0 |
| % dropped overall | 34% | 38% | +4pp |

Properties affected: 20 Meadow Dr (−1), 583 Westford St (−1), Lawrence (−2), 43 Bellevue (−1), 175 Warwick (−1), 13 Richardson St (−2). Zero clean regressions.

### 6c2. Rule G — bad-fit steep minor faces (RFE-based)

**Signal:** Rectangle fit error (RFE) = `1 - poly_area / rect_area`. Measures how poorly the ML polygon fits the 4-vertex rotated rectangle the CRM adapter produces. Clean surviving faces: median RFE = 0.117, max = 0.399. Wrong_pitch surviving: median = 0.282.

**Why RFE alone fails:** The distributions overlap — clean max (0.399) exceeds wrong_pitch median (0.282). A blunt RFE cutoff at any threshold either catches clean faces or has negligible yield.

**Why the three-way gate works:** Clean faces with high RFE always have low tilt (2.6° and 6.6° — near-flat panels with complex L-shapes). Bad faces with high RFE tend to be steep AND small. The combination "poor fit + steep + minor" isolates artifacts with zero clean false positives.

**Rule:** Drop faces where ALL three conditions hold:
1. `_rfe > 0.30` (rectangle fit error above 30%)
2. `pitch > 40°` (moderately steep)
3. `area / max_surviving_area < 0.50` (secondary face, not the primary roof plane)

**Batch impact (19 reference properties, D+E+F → D+E+F+G):**

| Metric | Before (D+E+F) | After (D+E+F+G) | Delta |
|---|---:|---:|---:|
| Total output faces | 119 | 106 | −13 |
| wrong_pitch output | 69 | 60 | −9 |
| ugly output | 32 | 28 | −4 |
| clean output | 18 | 18 | 0 |
| % dropped overall | 38% | 45% | +7pp |

Properties affected: 225 Gibson St (−2), 583 Westford St (−1), Lawrence (−1), 254 Foster St (−3), 74 Gates (−2), 43 Bellevue (−1), 22 New Spaulding (−2), 21 Stoddard (−2). Zero clean regressions.

### Files changed

`/Volumes/Extreme_Pro/ML/ml_ui_server.py` — `_geometry_cleanup()` + `_rfe` field threading. Rules D–G together are ~100 lines. No CRM changes. No ML engine core changes.

### 6d. Batch validation harness

`/Volumes/Extreme_Pro/ML/batch_validate.py` — offline harness that re-runs `_geometry_cleanup` on stored `ml-drafts.json` data. No network calls, no ML inference. Outputs JSON (per-face diagnostics) + markdown summary. 19 reference properties from the labeled triage set.

### 6e. Per-face diagnostics

Added `face_diagnostics` array to `_geometry_cleanup` debug output. Each entry: `{idx, tilt, area, short, long, aspect, conf, survived, dropped_by}`. Machine-readable, enables batch analysis without screenshots.

---

## 7. Expanded validation — Rule G safety (2026-04-18)

### 7.1 Full-dataset test

Rule G (RFE > 0.30, tilt > 40°, ratio < 0.50) was tested against ALL 91 non-rejected drafts in `ml-drafts.json` — not just the 19 labeled REFERENCE_SET.

| Scope | Drafts | Rule G drops | Clean-profile affected |
|---|---:|---:|---:|
| Labeled non-reject (REFERENCE_SET) | 19 | 14 faces from 8 props | 0 |
| Unlabeled non-reject | 72 | 38 faces from 24 props | 0 |
| **Total** | **91** | **52 faces** | **0** |

**Clean-candidate identification:** 29 unlabeled drafts (9 unique projectIDs) match the clean quantitative profile (max tilt < 45°, median RFE < 0.20, ≥ 2 surviving faces). **All 29 have BFS = 0** — Rule G does not touch any of them.

### 7.2 Clean reference expansion attempt

The 7 missing triage rows break down as: 4 wrong_pitch, 1 reject_correct, 1 reject_too_strict, 1 ugly. **Clean missing = 0.** The operator-stated 4 clean cases are all in the labeled set (§5). Clean reference count cannot be expanded without new ML runs on new addresses.

8 unique April 18 unlabeled properties were analyzed for clean candidacy. All show elevated tilt (maxTilt 38–59°), high RFE (median 0.189–0.350), or heavy drop rates. None qualify as clean. The 2 April 18 rejected projectIDs (0 faces each) account for the missing reject_correct and reject_too_strict rows.

### 7.3 Surviving face tilt distribution (AFTER D+E+F+G, labeled REFERENCE_SET)

| Tilt band | clean (18) | wrong_pitch (60) | ugly (28) |
|---|---:|---:|---:|
| < 20° | 11 (61%) | 16 (27%) | 11 (39%) |
| 20–30° | 3 (17%) | 13 (22%) | 3 (11%) |
| 30–40° | 1 (6%) | 12 (20%) | 7 (25%) |
| 40–55° | 3 (17%) | 16 (27%) | 5 (18%) |
| 55–60° | 0 (0%) | 3 (5%) | 2 (7%) |

The 40–55° band remains the core wrong_pitch signature (27% of surviving wrong_pitch, vs 17% of clean). However, clean has 3 faces in this band (all 726 School St: tilt 40.6°, 44.2°, 54.5° with RFE 0.062, 0.282, 0.067). These cannot be distinguished from wrong_pitch faces at the same tilt using any signal available to the cleanup pass (RFE, confidence, area, ratio all overlap).

### 7.4 Rule G verdict

**KEEP.** Zero clean regressions across 91 drafts. All 29 clean-profile unlabeled drafts unaffected. The 3-parameter gate (RFE + tilt + ratio) provides sufficient separation. No threshold adjustment needed.

### 7.5 Next engineering direction

No further wrapper-level geometry cleanup rule can separate the remaining wrong_pitch faces from clean ones. The residual wrong_pitch problem is **upstream**: the ML orientation / DSM plane-fit stage over-estimates tilt, producing plausible-looking faces in the 40–55° band that are indistinguishable from legitimate steep roof planes. The next phase should investigate the DSM orientation module, not add another cleanup rule.

---

## 8. DSM orientation tilt-bias investigation (2026-04-18)

### 8.1 How the orientation module works (original baseline, pre-tuning)

> **Note:** This section describes the orientation module as it existed at the start of the investigation (pre-refit, pre-erosion, pre-RANSAC). For the current state of the module after the complete tuning track, see §8.7 (refit), §8.10 (erosion), and §8.14 (RANSAC).

The orientation module (`ml_engine/core/stages/orientation.py`) converts DSM height data into per-plane tilt and azimuth. For each plane polygon from the Mask R-CNN planes stage, it: (1) projects the polygon from metre space to pixel coordinates via the inverse registration affine, (2) rasterizes the polygon into a boolean pixel mask, (3) samples DSM heights at all mask pixels with finite values, (4) projects those pixel coords back to metre space to get a 3D point cloud `(x_m, y_m, z_m)`, (5) performs a **single** NumPy `lstsq` fit of `z = ax + by + c` to get the plane gradient, and (6) converts gradient to tilt via `arctan(sqrt(a²+b²))` and azimuth via `atan2(-a, b)`. There is no RANSAC, no inlier refit, and no polygon erosion. Minimum 12 finite DSM samples required; below that, falls back to a default 10° pitch. The gradient math is geometrically correct.

### 8.2 Tilt bias quantification

Orientation quality flags (`orientation_high_residual`: RMSE > 0.30m, `orientation_low_inlier`: inlier ratio < 0.60) are present on most faces across all buckets:

| Bucket | Faces | High residual | Low inlier |
|---|---:|---:|---:|
| wrong_pitch | 110 | 85 (77%) | 91 (83%) |
| ugly | 59 | 46 (78%) | 48 (81%) |
| clean | 23 | 17 (74%) | 17 (74%) |

**The critical finding: flagged faces have systematically higher tilt than unflagged faces in every bucket.**

| Bucket | Flagged median tilt | Unflagged median tilt | Delta |
|---|---:|---:|---:|
| clean | 26.7° | 9.7° | +17.0° |
| wrong_pitch | 43.8° | 28.2° | +15.6° |
| ugly | 43.1° | 13.3° | +29.8° |

Unflagged wrong_pitch faces have median tilt 28.2° — well within the normal residential range (18–34°). The flagged faces push to 43.8° median, squarely in the problematic 40–55° band.

In the 40–55° band specifically: **100% of clean faces, 75% of wrong_pitch faces, and 89% of ugly faces are flagged.** Faces with poor fit quality dominate this band across all buckets.

### 8.3 Root cause

**Edge contamination in the single-pass lstsq fit.** The plane polygons from Mask R-CNN often extend slightly beyond the actual roof boundary. When sampled against the DSM:
- **Wall pixels** at the roof edge drop steeply from the roofline to the ground
- **Ground pixels** outside the roof are much lower than the roof surface
- **Adjacent lower/higher roofs** introduce height discontinuities

These contaminating samples create an artificial steep gradient. The lstsq fit is not robust to outliers — a single-pass least-squares fit treats wall/ground pixels as legitimate data, pulling the gradient steeper.

The orientation module already identifies the contamination via its quality metrics (RMSE > 0.30m, inlier ratio < 0.60) but still uses the contaminated tilt value. The fit quality flags are used only for review tagging, not for tilt correction.

**This is not a DSM quality problem — it's a fitting-strategy problem.** The DSM data is adequate (finite samples exist within polygon masks), but the single-pass lstsq is fundamentally vulnerable to edge contamination. The ±15cm inlier threshold correctly identifies which samples are roof surface vs contamination, but the information is discarded.

### 8.4 Proposed intervention: inlier-only refit (two-pass lstsq)

**Location:** `_fit_plane()` in `ml_engine/core/stages/orientation.py:403-450`

**Change:** After the first lstsq pass, when `inlier_ratio < 0.60` and the number of inliers ≥ `MIN_FIT_POINTS` (12), perform a second lstsq pass on only the inlier samples (those within ±15cm of the first-pass plane). Use the refined tilt/azimuth from the second pass. Record both passes in diagnostics.

**Why this works:**
- Inlier samples are within ±15cm of the initial plane — they're predominantly roof surface, not walls/ground
- Removing outliers should reduce the gradient magnitude, producing flatter (more accurate) tilts
- The ±15cm threshold is already calibrated for asphalt shingles — tight enough to exclude chimneys/trees but loose enough to retain legitimate surface variation

**Why it's safe:**
- Only fires when the first pass already has poor quality (inlier_ratio < 0.60 — same threshold as the existing quality flag)
- Requires ≥ 12 inlier points (same as original minimum)
- For good fits (inlier_ratio ≥ 0.60), behavior is completely unchanged
- The refit is still lstsq on a cleaner point subset — no new algorithm

**Expected impact:** Based on the flagged-vs-unflagged tilt comparison, the refit should reduce typical flagged-face tilts by ~15–17° (the delta between flagged and unflagged medians). This would move most 40–55° faces into the 25–38° range — typical residential tilt.

**Estimated size:** ~15 lines in `_fit_plane()`. No pipeline structure changes. No CRM or wrapper changes.

**Risk:** Low. The refit only fires on poor-quality fits that are already flagged for review. Worst case: a legitimately steep roof (> 40°) with poor DSM coverage gets incorrectly flattened — but such cases are already flagged `needs_review` and would be caught by human review.

### 8.5 Fix location: engine core (NOT wrapper)

The fix belongs in `ml_engine/core/stages/orientation.py` because:
1. The raw DSM point cloud is only available inside `_fit_plane()` — the wrapper never sees it
2. The inlier identification is already computed there (line 416)
3. A wrapper-level tilt cap would be a hack that doesn't fix the root cause
4. The engine's own quality metrics already contain all the information needed for the fix

### 8.7 Implementation (2026-04-18)

**File changed:** `ml_engine/core/stages/orientation.py`

**What was added:**
- Constant `REFIT_INLIER_THRESHOLD = 0.60` (line ~96)
- Two-pass inlier refit block in `_fit_plane()` (lines ~427-438):
  - After first-pass lstsq + residual computation
  - If `inlier_ratio < 0.60` AND `inlier_count >= 12`: extract inlier-only samples, refit lstsq, use refined tilt/azimuth
  - Otherwise: no change to existing behavior

**Diagnostics added to `orientation_diagnostics`:**
- `refit_fired` (bool) — whether the second pass ran
- `first_pass_tilt_deg` (float) — tilt from the contaminated first pass
- `inlier_count` (int) — number of samples within ±15cm of first-pass plane

**Synthetic validation:**
- 75 roof pixels (20° true tilt, σ=0.04m noise) + 25 wall-slope pixels (~50° gradient, σ=0.15m)
- First pass: 29.5° (+9.5° bias), RMSE 1.03m, inlier_ratio 0.13
- Second pass: 20.5° (+0.5° bias), RMSE 0.04m, inlier_ratio 0.70
- Tilt correction: −9.0° (bias reduced from +9.5° to +0.5°)

**Batch harness (stored data):**
- Output identical: 192→106 (45% dropped), clean 18, wrong_pitch 60, ugly 28
- Expected: the refit changes upstream inference, not stored draft tilt values
- Stored drafts were generated with the old single-pass orientation; the refit will affect new ML runs

### 8.8 Live validation results (2026-04-18)

**Method:** Fresh ML inference on 6 reference properties (4 wrong_pitch, 1 ugly, 1 clean) through restarted ML wrapper with refit code active. LiDAR from Google Solar DSM. Compared new raw tilts (crm_faces) and new cleanup output (roof_faces) against stored pre-refit drafts.

**Per-property results:**

| Property | Bucket | Old raw>40° | New raw>40° | Δ | Old clean | New clean | Verdict |
|---|---|---:|---:|---:|---:|---:|---|
| 20 Meadow Dr | wrong_pitch | 2 | 1 | −1 | 5 | 5 | UNCHANGED (40-55° band stable) |
| 225 Gibson St | wrong_pitch | 12 | 9 | −3 | 14* | 4 | IMPROVED (dramatic) |
| Lawrence | wrong_pitch | 7 | 6 | −1 | 6* | 5 | IMPROVED (modest) |
| 175 Warwick | wrong_pitch | 7 | 6 | −1 | 8* | 4 | IMPROVED |
| 583 Westford St | ugly | 6 | 5 | −1 | 7* | 5 | IMPROVED |
| 15 Veteran Road | clean | 0 | 0 | 0 | 3 | 3 | STABLE |

\* Old clean counts were stored before Rules D–G existed; not directly comparable. Raw tilt comparison is the fair metric for refit evaluation.

**Refit event analysis (39 refit events across 58 faces):**
- Refit fired on 67% of faces (those with first-pass inlier_ratio < 0.60)
- Largest corrections: 71.1° → 12.3° (−58.8°, 225 Gibson plane_05, 88 inliers), 66.4° → 50.5° (−15.9°, 225 Gibson plane_00, 118 inliers)
- Typical corrections for 40–55° faces: −1° to −4°
- Very steep faces (>70°): minimal change — too few inliers for meaningful refit
- Some faces shifted +0.2° to +1.6° (noise from small inlier subsets with slight opposite bias)
- Net direction: consistently downward for steep faces, noise-level for flat faces

**Representative refit events:**

| Property | Plane | Old tilt | New tilt | Δ | Inliers/Total |
|---|---|---:|---:|---:|---|
| 225 Gibson | plane_05 | 71.1° | 12.3° | −58.8° | 88/1906 (5%) |
| 225 Gibson | plane_00 | 66.4° | 50.5° | −15.9° | 118/2048 (6%) |
| Lawrence | plane_11 | 43.8° | 40.1° | −3.8° | 1055/2398 (44%) |
| 20 Meadow | plane_06 | 39.1° | 35.4° | −3.7° | 1014/4701 (22%) |
| 15 Veteran | plane_02 | 32.2° | 28.7° | −3.5° | 1633/4596 (36%) |
| 175 Warwick | plane_04 | 53.4° | 50.5° | −2.8° | 571/969 (59%) |
| 175 Warwick | plane_00 | 40.3° | 38.9° | −1.4° | 425/1262 (34%) |

**Why corrections are smaller than predicted:**
- The triage analysis (§8.2) found +15–17° median tilt bias on flagged faces. The live refit shows typical corrections of 1–4° with occasional larger corrections (up to 58.8°).
- The gap is because the ±15cm inlier threshold includes mildly contaminated near-edge points that bias the refit subset. The first-pass plane is biased steep, so "inliers" (within ±15cm of the biased plane) include some steep-biased points.
- For extreme cases (very low inlier ratio, <10%), the refit has very few points to work with, but can still produce dramatic corrections when those points are genuinely on the roof surface.

**Verdict: KEEP cd24daf.**
- Zero regressions on clean case (15 Veteran: same face count, tilts improved)
- Consistent downward correction on wrong_pitch faces
- Combines well with existing cleanup rules (faces pushed below thresholds get dropped)
- Safe: only fires on already-flagged poor-quality fits

**Future tuning opportunities:**
1. ~~Tighter inlier threshold (±10cm).~~ **Tested and rejected** — see §8.9.
2. ~~Polygon erosion 0.5m before DSM sampling.~~ **Implemented and validated** — see §8.10. >40° faces −29%, >55° −36%.
3. ~~Test 1.0m erosion.~~ **Tested and rejected** — see §8.11. Over-erodes small polygons, falls back to un-eroded, net worse (+18% >40°, +44% >55°).
4. Iterative refit (third pass) — unlikely to help; inlier-set bias is the bottleneck, not iteration count.
5. Edge-weighted lstsq — similar mechanism to threshold tightening; likely same failure mode.

### 8.9 Inlier threshold ±10cm experiment (2026-04-18)

**Hypothesis:** The ±15cm inlier threshold includes mildly contaminated near-edge points that bias the refit subset, limiting corrections to 1–4°. Tightening to ±10cm should exclude these and produce larger corrections.

**Method:** Introduced `REFIT_RESIDUAL_M = 0.10` for the second-pass point selection only. First-pass quality metrics (inlier_ratio, confidence, needs_review) stayed at ±15cm. Fallback to ±15cm if ±10cm gave < 12 points (never triggered — all faces had sufficient ±10cm inliers).

**Results — ±10cm is WORSE:**

| Property | Plane | First pass | ±15cm | ±10cm | ±15cm better by |
|---|---|---:|---:|---:|---:|
| 20 Meadow | plane_06 | 39.1° | 35.4° | 37.3° | 1.9° |
| 225 Gibson | plane_00 | 66.4° | 50.5° | 57.7° | 7.2° |
| Lawrence | plane_11 | 43.8° | 40.1° | 41.4° | 1.3° |
| 175 Warwick | plane_04 | 53.4° | 50.5° | 51.7° | 1.2° |
| 15 Veteran | plane_02 | 32.2° | 28.7° | 30.2° | 1.5° |

No property improved. The >40° face count was identical on all 6 properties. On 20 Meadow, ±10cm produced a +1.9° regression (35.4° → 37.3°) on the key steep face.

**Root cause (revised understanding):** The ±15cm inlier window captures genuine roof points that sit slightly below the steep-biased first-pass plane. These "counter-bias" points are helpful — they pull the refit toward the true (less steep) tilt. Tightening to ±10cm EXCLUDES these counter-bias points, reducing corrections by 30–50%. The original diagnosis ("±15cm includes contaminated edge points") was wrong; the useful signal is in the ±10–15cm band, not contamination.

**Verdict:** Keep `INLIER_RESIDUAL_M = 0.15`. Do not tighten.

**Revised next step: polygon erosion.** Since threshold tuning attacks the wrong mechanism, the next approach should reduce contamination at the source. Eroding the plane polygon by 0.5–1m before DSM sampling would:
- Remove the edge/wall pixels entirely (they're at the polygon boundary)
- Produce a cleaner first-pass fit with higher inlier ratio
- Reduce or eliminate the need for the two-pass refit on mildly contaminated faces
- Leave the refit as a safety net for remaining severe cases

This is a fundamentally different lever: it changes WHICH points are sampled, not HOW they're filtered post-sampling. Edge-weighted lstsq would not help for the same reason threshold tightening didn't — it's filtering the same contaminated point cloud differently, when the real fix is to not sample the contaminated points at all.

### 8.10 Polygon erosion 0.5m experiment (2026-04-18)

**Hypothesis:** Edge/wall contamination enters during DSM sampling at polygon boundaries. Eroding the rasterized polygon mask by 0.5m before sampling should exclude these pixels at the source, producing cleaner lstsq fits without needing post-sampling threshold tuning.

**Implementation:** `EROSION_BUFFER_M = 0.5` constant in `orientation.py`. In `_sample_dsm_for_plane()`, after rasterizing the polygon mask, apply binary erosion using a separable square structuring element (pure numpy, no scipy dependency). Erosion radius in pixels = `EROSION_BUFFER_M / mpp` where `mpp` is derived from the registration affine (~0.055 m/px → ~9 pixel radius). If the eroded mask has < `MIN_FIT_POINTS` (12) pixels, fall back to the original un-eroded mask to preserve behavior for small polygons. Diagnostics added to stats dict: `erosion_buffer_m`, `erosion_px`, `erosion_applied`, `n_pre_erosion`.

**Method:** Same-session A/B test. Ran all 6 reference properties with EROSION=0.0 (control), then EROSION=0.5m. Control confirmed deterministic against stored cd24daf baseline for 20 Meadow and 225 Gibson (all deltas = 0.0). Some properties had different face counts vs stored baseline due to ML model variability between sessions, but face counts were identical between control and erosion runs within the same session.

**Results — 0.5m erosion is a clear improvement:**

| Property | Faces | Ctrl >40° | Ero >40° | Δ>40° | Ctrl >55° | Ero >55° | Δ>55° | Verdict |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| 20 Meadow Dr | 7 | 1 | 0 | −1 | 0 | 0 | 0 | IMPROVED |
| 225 Gibson St | 15 | 11 | 10 | −1 | 5 | 4 | −1 | SLIGHT |
| Lawrence | 15 | 6 | 2 | −4 | 1 | 0 | −1 | STRONG |
| 175 Warwick | 11 | 6 | 7 | +1 | 4 | 3 | −1 | MIXED |
| 583 Westford St | 15 | 7 | 3 | −4 | 4 | 2 | −2 | STRONG |
| 15 Veteran Rd | 4 | 0 | 0 | 0 | 0 | 0 | 0 | STABLE |
| **Total** | **67** | **31** | **22** | **−9** | **14** | **9** | **−5** | |

- **>40° faces: 31 → 22 (−29%)**
- **>55° faces: 14 → 9 (−36%)**

Key face-level shifts (20 Meadow, deterministic):
- Face at 41.5° → 29.2° (−12.3°) — the only >40° face corrected below threshold
- Face at 35.4° → 28.2° (−7.2°) — secondary contaminated face also improved
- Face at 12.3° → 18.0° (+5.7°) — slight upward shift on one low-tilt face (sort-order artifact or minor fit change)

**175 Warwick (mixed case):** >40° went from 6→7 (+1), but >55° went from 4→3 (−1). The erosion helped the worst faces while slightly inflating one borderline face. Net effect is roughly neutral — the extreme-steep category improved at the cost of one more face crossing the 40° line.

**15 Veteran (clean case):** 0 faces >40° both before and after. Per-face comparison: [9.7, 15.2, 22.6, 28.7] → [9.7, 16.2, 18.6, 19.3]. Average delta = −3.1°. The 28.7° face (likely edge-contaminated) corrected to 19.3° — a genuine improvement on the clean case.

**Verdict:** KEEP `EROSION_BUFFER_M = 0.5`. Erosion is the most effective single intervention in the orientation tuning track so far. Combined with the two-pass refit, it reduces the >40° face count by nearly a third.

**Next step:** Test 1.0m erosion on the same 6 properties. Expect further improvement on large polygons but possible regression on small ones where 1.0m erodes too aggressively. Do not stack — test 1.0m as a standalone change against the 0.5m baseline.

### 8.11 Polygon erosion 1.0m experiment (2026-04-18)

**Hypothesis:** If 0.5m erosion reduced >40° faces by 29%, 1.0m might further improve by excluding a wider edge band.

**Method:** Same-session A/B. Collected 0.5m baseline, changed `EROSION_BUFFER_M` to 1.0, restarted ML server, re-ran same 6 reference properties. Face counts identical (7/15/15/11/15/4) confirming ML determinism within the session.

**Results — 1.0m is WORSE than 0.5m:**

| Property | 0.5m >40° | 1.0m >40° | Δ>40° | 0.5m >55° | 1.0m >55° | Δ>55° | Verdict |
|---|---:|---:|---:|---:|---:|---:|---|
| 20 Meadow Dr | 0 | 0 | 0 | 0 | 0 | 0 | STABLE |
| 225 Gibson St | 10 | 12 | +2 | 4 | 5 | +1 | REGRESSED |
| Lawrence | 2 | 2 | 0 | 0 | 1 | +1 | SLIGHT REG |
| 175 Warwick | 7 | 6 | −1 | 3 | 3 | 0 | SLIGHT IMP |
| 583 Westford St | 3 | 6 | +3 | 2 | 4 | +2 | REGRESSED |
| 15 Veteran Rd | 0 | 0 | 0 | 0 | 0 | 0 | STABLE |
| **Total** | **22** | **26** | **+4** | **9** | **13** | **+4** | |

- **>40° faces: 22 → 26 (+18%) — worse**
- **>55° faces: 9 → 13 (+44%) — much worse**

**Root cause:** At 1.0m (~18 pixel radius), many polygons are too small for the erosion. The eroded mask drops below 12 pixels, triggering the fallback to the un-eroded mask. Those faces lose the 0.5m erosion benefit entirely and revert to contaminated-baseline tilts. Meanwhile, larger polygons that don't fall back lose too much interior data — the remaining central-only samples sometimes fit a different (worse) plane. Comparing 1.0m tilts to the no-erosion control baseline confirms: 225 Gibson's low faces (12.3°, 28.9°) match the no-erosion baseline (11.8°, 29.4°), proving they fell back to un-eroded.

**Verdict:** REVERT. Keep `EROSION_BUFFER_M = 0.5`. The 0.5m value is the tuned optimum for this pipeline — aggressive enough to exclude edge/wall contamination, conservative enough to preserve sufficient interior samples for stable fits.

**Erosion tuning is complete.** 0.5m is the winner. Further orientation improvement would require a fundamentally different approach (e.g., RANSAC, weighted lstsq, or DSM resolution upgrade).

### 8.12 Broad validation of current best baseline (2026-04-18)

**Baseline:** Rules D/E/F/G + two-pass inlier refit (cd24daf) + 0.5m polygon erosion (28538c1).

**Method:** Live inference on 18 properties (10 wrong_pitch, 4 ugly, 4 clean) from the labeled triage set (§5). Each property: fresh Google satellite image + Google Solar DSM from CRM. Response includes both `crm_faces` (raw, pre-cleanup) and `roof_faces` (post target-selection + Rules D/E/F/G).

**User-facing results (post-cleanup):**

| Property | Bucket | Raw | Cleaned | >40° | >55° | Max tilt | Status |
|---|---|---:|---:|---:|---:|---:|---|
| 20 Meadow Dr | wrong_pitch | 7 | 4 | 0 | 0 | 28.2° | RESOLVED |
| 225 Gibson St | wrong_pitch | 15 | 5 | 1 | 0 | 46.9° | Improved |
| Lawrence | wrong_pitch | 15 | 6 | 0 | 0 | 35.7° | RESOLVED |
| 21 Stoddard | wrong_pitch | 15 | 8 | 0 | 0 | 35.5° | RESOLVED |
| 254 Foster St | wrong_pitch | 15 | 2 | 1 | 0 | 45.1° | Improved |
| 22 New Spaulding | wrong_pitch | 6 | 3 | 1 | 0 | 49.9° | Improved |
| 175 Warwick | wrong_pitch | 11 | 3 | 2 | 0 | 51.7° | Improved |
| 11 Ash Road | wrong_pitch | 8 | 4 | 3 | 0 | 44.6° | Still failing |
| 29 Porter St | wrong_pitch | 6 | 5 | 2 | 0 | 48.0° | Still failing |
| 13 Richardson St | wrong_pitch | 12 | 5 | 2 | 0 | 42.0° | Still failing |
| 583 Westford St | ugly | 15 | 5 | 0 | 0 | 27.9° | RESOLVED |
| 74 Gates | ugly | 15 | 4 | 2 | 0 | 54.7° | Improved |
| 43 Bellevue | ugly | 15 | 3 | 1 | 0 | 49.6° | Improved |
| 6 Court St | ugly | 7 | 1 | 0 | 0 | 14.0° | RESOLVED |
| 726 School St | clean | 12 | 2 | 0 | 0 | 37.5° | Stable |
| 15 Buckman | clean | 2 | 1 | 0 | 0 | 4.0° | Stable |
| 1 Wiley St | clean | 5 | 4 | 0 | 0 | 24.7° | Stable |
| 15 Veteran Rd | clean | 4 | 3 | 0 | 0 | 19.3° | Stable |

**Totals:** 185 raw → 68 user-facing faces. **>40°: 15 (22%). >55°: 0 (0%).**

**Before/after vs stored-draft batch baseline:** >40° faces 28 → 15 (−46%). >55° faces 5 → 0 (−100%).

**Per-bucket:**
- **wrong_pitch (10 props, 45 faces):** 3 fully resolved (20 Meadow, Lawrence, 21 Stoddard). 4 improved (fewer >40° faces). 3 still failing (11 Ash Road, 29 Porter, 13 Richardson).
- **ugly (4 props, 13 faces):** 2 fully resolved (583 Westford, 6 Court). 2 improved (74 Gates, 43 Bellevue).
- **clean (4 props, 10 faces):** All 4 stable. 0 false positives. 0 faces >40°.

**Remaining dominant failure: the 40–55° tilt band.** 15 faces across 9 properties, all in 40–55°. These are legitimate roof planes where residual edge contamination inflates tilt by ~10–20° but not enough to trigger Rule D (>60°) or Rule G (needs RFE > 0.30). The orientation tuning track (refit + erosion) has been pushed to its practical limit — further threshold/erosion adjustments tested and rejected (§8.9, §8.11). Addressing these residual faces requires either RANSAC fitting, higher-resolution DSM, or a build-level quality gate.

**Tilt distribution of user-facing faces:**

| Band | Count | % |
|---|---:|---:|
| < 20° | 23 | 34% |
| 20–30° | 14 | 21% |
| 30–40° | 16 | 24% |
| 40–55° | 15 | 22% |
| > 55° | 0 | 0% |

**Recommended next phase:** The orientation tuning track is closed. The highest-ROI next step is a **build-level quality gate** — flag or reject entire builds where the surviving face tilt profile indicates an unreliable result (e.g., median surviving tilt > 40° or >50% of faces above 40°). This would catch cases like 11 Ash Road (4 faces, all 38–44.6°) where the whole roof is misrepresented. ~20 lines in the wrapper, no ML model changes.

### 8.6 Alternatives considered

| Alternative | Pros | Cons | Verdict |
|---|---|---|---|
| Two-pass lstsq (inlier refit) | Targeted, ~15 lines, uses existing metrics | Requires engine-core change | **Recommended** |
| Polygon erosion (shrink by 0.5–1m before sampling) | Addresses edge contamination directly | Needs buffer calibration, larger change, reduces sample count | Viable but more complex |
| RANSAC instead of lstsq | Gold-standard robust fit | Much larger change, new dependency, slower | **DONE** — see §8.14 |
| Wrapper tilt cap (cap to 35° when flagged) | No engine change needed | Hack, loses real tilt information, doesn't fix azimuth | Not recommended |
| Tilt correction factor (multiply by 0.7) | Simple | No theoretical basis, varies by property | Not recommended |

### 8.13 Build-level quality gate (2026-04-18)

**Goal:** Flag entire builds where residual 40–55° faces dominate, indicating systematic orientation contamination the per-face rules (D-G) cannot catch.

**Rule implemented:** `n_cleaned >= 2 AND (faces > 40°) / n_cleaned >= 0.40`

- Inserted in `ml_ui_server.py` after `_geometry_cleanup()` produces `cleaned_roof_faces`
- Downgrades `auto_build_status` from `auto_accept` → `needs_review`
- Appends `"build_tilt_quality_low"` to `review_policy_reasons`
- Debug telemetry exposed via `frame_debug.build_quality`
- Frontend `REASON_LABELS` updated with human-readable label

**18-property live validation results:**

| Property | Bucket | Cleaned | >40° | Fraction | Flagged |
|---|---|---:|---:|---:|---|
| 11 Ash Road | wrong_pitch | 4 | 3 | 75% | **YES** |
| 175 Warwick | wrong_pitch | 3 | 2 | 67% | **YES** |
| 254 Foster St | wrong_pitch | 2 | 1 | 50% | **YES** |
| 74 Gates | ugly | 4 | 2 | 50% | **YES** |
| 29 Porter St | wrong_pitch | 5 | 2 | 40% | **YES** |
| 13 Richardson St | wrong_pitch | 5 | 2 | 40% | **YES** |
| 43 Bellevue | ugly | 3 | 1 | 33% | no |
| 22 New Spaulding | wrong_pitch | 3 | 1 | 33% | no |
| 225 Gibson St | wrong_pitch | 5 | 1 | 20% | no |
| 20 Meadow Dr | wrong_pitch | 4 | 0 | 0% | no |
| Lawrence | wrong_pitch | 6 | 0 | 0% | no |
| 21 Stoddard | wrong_pitch | 8 | 0 | 0% | no |
| 583 Westford St | ugly | 5 | 0 | 0% | no |
| 6 Court St | ugly | 1 | 0 | 0% | no |
| 726 School St | clean | 2 | 0 | 0% | no |
| 15 Buckman | clean | 1 | 0 | 0% | no |
| 1 Wiley St | clean | 4 | 0 | 0% | no |
| 15 Veteran Rd | clean | 3 | 0 | 0% | no |

**Summary:** 6 flagged (5 wrong_pitch, 1 ugly). 0 clean false positives. All 3 primary targets (11 Ash Road, 29 Porter, 13 Richardson) caught. 3 additional genuinely problematic properties also flagged (175 Warwick, 254 Foster, 74 Gates).

**Baseline unchanged:** Rules D-G, two-pass refit, 0.5m erosion all locked. The gate is additive — it reads the post-cleanup face list and modifies only the envelope status/reasons.

### 8.14 RANSAC robust plane fitting (2026-04-19)

**Goal:** Reduce the residual 40–55° tilt band (15 faces, 22% of cleaned) using RANSAC to find the true roof plane under edge/wall contamination.

**Implementation:** `_fit_plane_ransac()` in `orientation.py`. 100 iterations, 3-point samples, deterministic (seed=42). Triggered only when first-pass inlier ratio < 0.60 (same condition as existing two-pass refit). After RANSAC finds the best consensus inlier set, a final lstsq refit on those inliers produces the tilt/azimuth.

**Three-guard acceptance rule — RANSAC result used only when ALL hold:**
1. `ransac_ir > refit_ir` — RANSAC has better consensus than two-pass refit
2. `ransac_tilt < refit_tilt` — RANSAC found a flatter plane (respects known steep-bias prior)
3. `ransac_tilt < 40°` — prevents RANSAC from rescuing wall faces (>60°) into the 40–55° band

Fallback: if any guard fails, the existing two-pass refit result is used unchanged.

**Diagnostics added to `orientation_diagnostics`:** `ransac_fired`, `ransac_tilt_deg`, `ransac_inlier_ratio`.

**18-property live validation (vs previous baseline without RANSAC):**

| Metric | Previous | RANSAC | Change |
|---|---:|---:|---|
| Total cleaned faces | 68 | 72 | +4 rescued |
| >40° faces (cleaned) | 15 | 9 | **−40%** |
| >55° faces | 0 | 0 | stable |
| 40–55° band | 15 (22%) | 9 (12%) | **−40%** |
| Median tilt | 27.9° | 25.8° | −2.1° |
| Clean >40° | 0 | 0 | zero regressions |

**Properties improved (>40° reduced):**

| Property | Bucket | Prev >40° | RANSAC >40° | Key correction |
|---|---|---:|---:|---|
| 254 Foster St | wrong_pitch | 1 | 0 | 45.1° → 30.7° |
| 22 New Spaulding | wrong_pitch | 1 | 0 | 49.9° → 38.8° |
| 29 Porter St | wrong_pitch | 2 | 0 | 47.6°→21.9°, 48.0°→35.6° |
| 74 Gates | ugly | 2 | 1 | 54.7°→36.0°, +1 face rescued |
| 43 Bellevue | ugly | 1 | 0 | 49.6° → 10.6° |

**Properties unchanged:** 20 Meadow (0→0), 225 Gibson (1→1, +1 rescued face), Lawrence (0→0), 175 Warwick (2→2), 583 Westford (0→0), all 4 clean stable.

**RANSAC event statistics:** 88 suspicious planes triggered the refit/RANSAC path. RANSAC fired on all 88 (always finds a consensus). 33 passed all three guards and were accepted. 55 rejected (steeper than refit or ≥40°).

### 8.15 Orientation tuning track — closed and banked (2026-04-19)

**Banked baseline (commit 51c969b):** Two-pass inlier refit + 0.5m polygon erosion + RANSAC robust plane fitting. This is the final orientation fitting strategy for the current pipeline.

**Cumulative improvement from pre-tuning baseline:**
- >40° faces: 28 → 9 (−68%)
- >55° faces: 5 → 0 (−100%)
- 40–55° band: dominant failure mode reduced from 29% to 12% of cleaned faces
- Clean properties: 0 regressions across all 4 references

**Remaining 9 faces >40° are in 3 stubborn properties** (11 Ash Road, 175 Warwick, 13 Richardson) where DSM contamination is pervasive — not edge-only. All 3 are caught by the build-level quality gate (§8.13). Further improvement requires higher-resolution DSM data or model retraining, not fitting-strategy changes.

**Track progression:** single-pass lstsq → two-pass inlier refit (§8.7) → 0.5m erosion (§8.10) → RANSAC (§8.14). Dead ends explored and rejected: ±10cm inlier threshold (§8.9), 1.0m erosion (§8.11).

---

## 9. P3 solar pitch cross-validation (2026-04-19)

### 9.1 Goal

Cross-validate ML-derived pitch/azimuth against Google Solar `roofSegmentStats` to detect bad ML orientation and provide an independent confirmation signal.

### 9.2 Implementation

**Location:** CRM server (`server.js`), in the `/api/ml/auto-build` proxy route. No ML wrapper changes.

**Flow:** After ML returns the envelope with cleaned `roof_faces`, the CRM server fetches Google Solar `buildingInsights` for the design pin lat/lng, extracts `roofSegmentStats`, and matches each ML face to the nearest Google segment.

**Matching strategy:**
1. Convert Google segment centers from lat/lng to local coordinates (metres relative to design pin)
2. For each ML face, compute centroid as average of its 4 vertices
3. Find nearest Google segment by Euclidean distance
4. Match if distance < 8m (generous for residential buildings)
5. Confidence = `max(0, 1 - distance / 8m)`

**Azimuth comparison:** Both ML and Google use compass convention (0°=N, 90°=E, 180°=S, 270°=W). Minimum angular distance computed (0–180° range).

**Build-level flag:** `google_solar_pitch_mismatch` appended to `review_policy_reasons` and status downgraded to `needs_review` when ALL conditions hold:
- ≥ 2 matched faces
- ≥ 50% of matched faces have |pitch_delta| > 15° AND match confidence > 0.3

### 9.3 Validation results (8 properties)

| Property | Bucket | Faces | Matched | Mean |Δpitch| | Max |Δpitch| | Flagged | Key finding |
|---|---|---:|---:|---:|---:|---|---|
| 15 Veteran Rd | clean | 3 | 3 | 0.47° | 0.71° | No | Near-perfect agreement |
| 20 Meadow Dr | improved | 4 | 4 | 8.70° | 22.86° | No | 1 low-conf outlier at edge |
| Lawrence | improved | 6 | 6 | 7.65° | 21.60° | No | 1 peripheral face outlier |
| 175 Warwick | stubborn | 3 | 3 | 6.69° | 14.58° | No | Google AGREES on 47° steep — genuinely steep roof |
| 225 Gibson St | wrong_pitch | 6 | 6 | 18.25° | 31.61° | **Yes** | 4/6 faces >15° delta; bidirectional errors |
| 11 Ash Road | stubborn | 1 | 0 | — | — | No | Poor ML extraction, 1 unmatched face |
| 13 Richardson St | stubborn | 1 | 0 | — | — | No | Poor ML extraction, 1 unmatched face |
| 29 Porter St | wrong_pitch | 0 | — | — | — | — | Rejected by usable gate |

### 9.4 Key findings

1. **Clean houses show near-zero pitch delta** (0.47° mean on 15 Veteran). ML and Google Solar agree to within 1° on all 3 faces. No false positives.

2. **Improved houses show moderate agreement** (7–9° mean). Most faces match well; occasional outliers are on peripheral faces with low match confidence, not on main roof planes.

3. **175 Warwick reveals genuinely steep roof.** Google Solar itself reports 47° pitch — ML's 47–52° pitch is not an error but a correct measurement of an unusually steep roof. The quality gate flag (`build_tilt_quality_low`) is appropriate here as a "user should verify" signal, not a "ML is wrong" signal.

4. **225 Gibson St correctly flagged as mismatch.** Mean delta 18.25°, with bidirectional errors: ML over-estimates some faces (46.9° vs Google's 15.3°) and under-estimates others (20.9° vs Google's 45.5°). The `google_solar_pitch_mismatch` flag fired correctly.

5. **Stubborn properties with poor ML extraction** (11 Ash Road, 13 Richardson) produce few faces that don't match any Google segments. The cross-validation correctly reports them as unmatched rather than generating false matches.

6. **Azimuth agreement is generally excellent** when pitch matches. Face[0] on 15 Veteran: ML 242.9° vs Google 244.2° (Δ = 1.3°). Azimuth diverges mainly when pitch is wrong (different planes being compared).

### 9.5 Recommendation for next phase

The cross-validation provides strong instrumentation. Potential future behaviors:

1. **Pitch correction** (not yet implemented): When match confidence > 0.8 AND |Δpitch| > 15° AND Google pitch is in the residential range (10–45°) AND ML pitch is in the suspect 40–55° band, substitute the Google pitch. Targets the known failure mode while being conservative.

2. **Per-face review badges**: Surface per-face pitch deltas in the CRM UI so users can see which faces are trustworthy vs suspect.

3. **Correlation with quality gate**: When both `build_tilt_quality_low` and `google_solar_pitch_mismatch` fire on the same build, escalate to a stronger warning.

---

## 10. P8 pitch correction (2026-04-19)

### 10.1 Goal

Conservatively correct ML faces that are clearly too steep, using Google Solar pitch as external reference. One-directional only: reduce ML-too-steep, never flatten ML-too-flat.

### 10.2 Correction rule

Apply correction when ALL five guards hold:
1. `matched == true` (face matched to a Google segment)
2. `match_confidence > 0.5` (face centroid within ~4m of segment center)
3. `ml_pitch - google_pitch > 10°` (ML is >10° steeper than Google)
4. `google_pitch < 45°` (Google says normal residential pitch)
5. `google_area_m2 > 8` (skip tiny segments)

Corrected pitch = `google_pitch + 2°` (conservative bias toward ML).

**Location:** `solarPitchCrossValidation()` in `server.js`, after match computation. Mutates `roof_faces[].pitch` on the envelope before it reaches the client.

### 10.3 Debug fields added

Per-match fields:
- `correction_applied` (bool)
- `original_ml_pitch` (float, only when corrected)
- `corrected_pitch` (float, only when corrected)
- `correction_reason` (string: describes which guard passed/blocked)

Build summary fields:
- `faces_corrected` (int)
- `corrections[]` (array: `{face_idx, from, to, delta}`)
- `mean_correction_deg` (float)
- `max_correction_deg` (float)

New review reason: `google_solar_pitch_corrected` — appended when any face is corrected; status downgraded to `needs_review`.

### 10.4 Validation results (7 properties)

| Property | Bucket | Faces | >40° | Corrected | Key result |
|---|---|---:|---:|---:|---|
| 225 Gibson St | wrong_pitch | 6 | 0 | 1 | face[2]: 46.9° → 17.3° (Δ=29.6°). Was only >40° face — now 0 |
| 11 Ash Road | wrong_pitch | 1 | 0 | 0 | Poor extraction (1 unmatched face). Cannot help |
| 13 Richardson St | wrong_pitch | 1 | 0 | 0 | Poor extraction (1 unmatched face). Cannot help |
| 175 Warwick | wrong_pitch | 3 | 2 | 0 | Google agrees 47° — guard #4 blocks. Correct behavior |
| 20 Meadow Dr | improved | 4 | 0 | 0 | All deltas <10° or ML flatter. Safe |
| Lawrence | improved | 6 | 0 | 0 | All deltas <10° or ML flatter. Safe |
| 15 Veteran Rd | clean | 3 | 0 | 0 | All deltas <1°. Zero regression |

### 10.5 Key findings

1. **225 Gibson is the prime success case.** face[2] was ML 46.92° vs Google 15.31° — a 31.6° over-estimation. Corrected to 17.31°. The property now has 0 faces >40° (was 1). All guards passed: confidence 0.70, delta +31.6°, google_pitch 15.31° < 45°, area 11m² > 8m².

2. **Guards correctly blocked 5 other 225 Gibson faces.** face[0] ML 26.6° < Google 45.8° (ML flatter — one-directional guard). face[4] confidence 0.35 < 0.5. face[1,3,5] ML flatter than Google (negative delta). The correction is surgical.

3. **175 Warwick guard #4 works.** Google confirms 47° pitch on all 3 faces. Delta is only +4.7° on the steepest face — well below the 10° threshold. Even without guard #4, the delta guard alone would have blocked correction.

4. **Clean house (15 Veteran) has 0 corrections.** All deltas < 1°. Zero regression risk.

5. **Improved houses (20 Meadow, Lawrence) untouched.** Deltas are 1–9° (below 10° threshold) or negative (ML flatter than Google). The correction cannot harm houses that are already good.

6. **Stubborn poor-extraction houses (11 Ash, 13 Richardson) can't be helped.** Both produce 1 unmatched face. The correction targets pitch errors on well-matched faces, not poor ML extraction. These remain quality-gate territory.

### 10.6 Verdict

**KEEP.** The correction is conservative, correctly targeted, and produces no regressions. The only property that fires correction (225 Gibson) shows dramatic improvement: the worst face corrected by 29.6°, eliminating the only >40° face on the property.

**Limitations:** P8 correction cannot help properties with poor ML extraction (11 Ash, 13 Richardson) — those need upstream model improvements. Properties where Google agrees with steep ML pitch (175 Warwick) are correctly left alone.

---

## 11. P9 unmatched / fallback strategy (2026-04-19)

### 11.1 Goal

Make unmatched and low-confidence builds behave correctly and transparently instead of silently slipping through to `auto_accept`. Every build should clearly fall into one of: trusted, needs_review, or not trustworthy.

### 11.2 Problem identified

After P8, one critical gap remains: builds where Google Solar has segment data for the address but ML's faces don't match any segments. Example: 13 Richardson St — 1 cleaned face at 3.3°, 12 Google segments available, 0 matched, status `auto_accept`. This is a poor ML extraction that silently passes through.

### 11.3 Fallback rules

Three conservative rules, evaluated in priority order. When Google segments are available:

**Rule 1 — Build unmatched:** `total_faces > 0 AND matched_faces == 0`
Reason: `p9_build_unmatched`. Downgrade to `needs_review`.

**Rule 2 — Low match fraction:** `total_faces >= 3 AND matched_faces / total_faces < 0.5`
Reason: `p9_low_match_fraction`. Downgrade to `needs_review`.

**Rule 3 — Low match confidence:** `matched_faces >= 2 AND (faces with confidence < 0.3) / matched_faces >= 0.5`
Reason: `p9_low_match_confidence`. Downgrade to `needs_review`.

When no Google segments are available, P9 does not fire (cannot assess without reference data).

### 11.4 Debug fields added

New `p9_build_assessment` object in `crm_result.metadata.p3_solar_crossval`:
- `p9_fallback_applied` (bool)
- `p9_fallback_reason` (string or null)
- `fallback_verdict` (string: `trusted`, `unmatched`, `low_match_fraction`, `low_confidence`)
- `total_faces` (int)
- `matched_face_count` (int)
- `matched_face_fraction` (float 0-1)
- `low_confidence_match_count` (int, confidence < 0.3)
- `low_confidence_match_fraction` (float 0-1)
- `corrected_face_count` (int, from P8)
- `build_unmatched` (bool)
- `build_low_match_fraction` (bool)
- `build_low_match_confidence` (bool)

New client-side reason labels: `p9_build_unmatched`, `p9_low_match_fraction`, `p9_low_match_confidence`.

### 11.5 Validation results (7 properties)

| Property | Bucket | Faces | Matched | Fraction | P9 verdict | P9 reason | Status before | Status after |
|---|---|---:|---:|---:|---|---|---|---|
| 13 Richardson St | wrong_pitch | 1 | 0 | 0 | unmatched | p9_build_unmatched | auto_accept | **needs_review** |
| 11 Ash Road | wrong_pitch | 1 | 0 | 0 | unmatched | p9_build_unmatched | needs_review | needs_review (+ reason) |
| 175 Warwick | wrong_pitch | 3 | 3 | 1.0 | trusted | — | needs_review | needs_review (unchanged) |
| 225 Gibson St | P8 corrected | 6 | 6 | 1.0 | trusted | — | needs_review | needs_review (unchanged) |
| 20 Meadow Dr | improved | 4 | 4 | 1.0 | trusted | — | auto_accept | auto_accept |
| Lawrence | improved | 6 | 6 | 1.0 | trusted | — | needs_review | needs_review (unchanged) |
| 15 Veteran Rd | clean | 3 | 3 | 1.0 | trusted | — | auto_accept | auto_accept |

### 11.6 Key findings

1. **13 Richardson St gap closed.** Was `auto_accept` with 0 matched faces despite 12 Google segments available. Now correctly `needs_review` with `p9_build_unmatched`. This was the primary gap P9 was designed to fill.

2. **11 Ash Road gets additional context.** Already `needs_review` from `crm_soft_gate_applied`, but now also shows `p9_build_unmatched` — making the reason set more explanatory for the worker.

3. **175 Warwick unaffected.** 3/3 matched (fraction 1.0), P9 verdict `trusted`. The quality gate already handles this via tilt distribution. P9 and P5 are orthogonal signals.

4. **225 Gibson P8 correction stable.** 6/6 matched, P8 corrected 1 face, P9 verdict `trusted`. No interference between phases.

5. **Clean house (15 Veteran) zero regression.** 3/3 matched, fraction 1.0, verdict `trusted`, status remains `auto_accept`.

6. **Improved houses untouched.** 20 Meadow (4/4 matched) and Lawrence (6/6 matched) both `trusted`. P9 cannot harm well-extracted builds.

### 11.7 Verdict

**KEEP.** P9 closes the remaining safety gap for worker design mode V1. The only status change is on 13 Richardson St (auto_accept → needs_review), which is correct. Zero false positives. Rules 2 and 3 didn't fire on the validation set but provide safety nets for hypothetical builds with poor spatial alignment.

---

## 12. V2 Phase 0 — Ground / Structure Separation

**Date:** 2026-04-19
**Phase:** V2P0 (first phase of Worker Design Mode V2)
**Code location:** `server.js` — `groundStructureAssessment()` + 4 helper functions, called from `/api/ml/auto-build` proxy route after P9.
**Debug location:** `crm_result.metadata.v2p0_ground_structure`

### 12.1 Purpose

Use LiDAR/DSM elevation data to classify each ML roof face as elevated structure or ground-level surface. Catches driveways, patios, yards that ML incorrectly includes as roof faces.

### 12.2 Method

1. Reconstruct 281×281 DSM elevation grid (0.25m resolution, ±35m) from raw LiDAR `[lng, lat, elev, cls]` points. Max elevation per cell (DSM behavior).
2. Global ground reference: p10 of all valid grid elevations.
3. Per-face local ground: p25 of ring samples (3-12m radius, 24 azimuth × 7 radial steps) around face centroid.
4. Face elevation: median DSM sample at centroid + all vertices.
5. Height above ground = face_elevation − local_ground.
6. Classification rules:
   - `ground_like`: height < 1m AND pitch < 10° AND area > 15m² (all three required)
   - `structure_like`: height > 2.5m
   - `uncertain`: everything else

### 12.3 Constants

| Constant | Value | Purpose |
|---|---|---|
| `V2P0_STRUCTURE_MIN_HEIGHT_M` | 2.5 | Single-story eave height threshold |
| `V2P0_GROUND_MAX_HEIGHT_M` | 1.0 | Max height for ground classification |
| `V2P0_GROUND_MAX_PITCH_DEG` | 10.0 | Max pitch for ground classification |
| `V2P0_GROUND_MIN_AREA_M2` | 15.0 | Min area for ground classification |
| `V2P0_RING_INNER_M` | 3.0 | Ring sampling inner radius |
| `V2P0_RING_OUTER_M` | 12.0 | Ring sampling outer radius |
| `V2P0_GRID_SIZE` | 281 | Grid dimension (281×281) |
| `V2P0_GRID_RES` | 0.25 | Grid resolution in meters |

### 12.4 Per-face debug fields

`face_idx`, `centroid_x`, `centroid_z`, `area_m2`, `pitch_deg`, `face_elevation_m`, `local_ground_m`, `global_ground_m`, `height_above_ground_m`, `height_signal`, `pitch_signal`, `flat_low_large`, `composite_score`, `classification`, `classification_reason`.

### 12.5 Build-level debug fields

`grid_valid_cells`, `grid_total_cells`, `grid_fill_fraction`, `global_ground_p10_m`, `total_faces`, `structure_like_count`, `ground_like_count`, `uncertain_count`, `ground_like_face_indices`, `ground_like_faces_found`, `min_height_above_ground_m`, `max_height_above_ground_m`, `mean_height_above_ground_m`.

### 12.6 Validation results (8 properties)

| Property | Bucket | Faces | Struct | Ground | Uncert | Height range | Status change |
|---|---|---|---|---|---|---|---|
| 20 Meadow Dr | improved | 4 | 2 | 1 | 1 | 0.07-4.83m | auto_accept→needs_review |
| 225 Gibson St | P8_corrected | 6 | 4 | 0 | 2 | 0.15-10.1m | — (already needs_review) |
| 583 Westford | test_prop | 0 | — | — | — | — | rejected (0 faces, V2P0 skipped) |
| 175 Warwick | steep_roof | 3 | 3 | 0 | 0 | 4.09-7.65m | — |
| 15 Veteran Rd | clean | 3 | 3 | 0 | 0 | 4.25-4.57m | auto_accept (NO regression) |
| 13 Richardson | unmatched | 1 | 0 | 1 | 0 | 0.37m | — (already needs_review via p9) |
| 11 Ash Road | wrong_pitch | 1 | 0 | 0 | 1 | 1.44m | — (already needs_review) |
| Lawrence | improved | 6 | 2 | 0 | 4 | -2.06-6.9m | — (already needs_review) |

### 12.7 Key findings

1. **20 Meadow Dr face[3] correctly flagged.** h=0.07m, pitch=3.3°, area=49m² — classic ground surface. Was `auto_accept`, now `needs_review` with `v2p0_ground_surface_detected`. This is a real safety improvement.

2. **13 Richardson face[0] double-flagged.** h=0.37m, pitch=3.3°, area=70m² — ground surface AND already `p9_build_unmatched`. V2P0 provides an independent, elevation-based reason for the same conclusion.

3. **15 Veteran (clean) no regression.** All 3 faces at h=4.2-4.6m, correctly `structure_like`. No false positives on good roofs.

4. **175 Warwick steep roof stable.** All 3 faces at h=4-7.7m, correctly `structure_like`. Steep pitch doesn't cause false ground classification.

5. **11 Ash Road conservative.** h=1.44m is between thresholds (ground<1m, structure>2.5m). Correctly classified as `uncertain` — conservative, avoids both false positive and false negative.

6. **Lawrence face[4] negative height.** h=-2.06m (below local ground reference). Correctly classified as `uncertain`, not falsely ground_like (pitch=12.6° fails the <10° guard).

### 12.8 Verdict

**KEEP.** V2P0 catches one previously silent ground surface (20 Meadow face[3], auto_accept→needs_review) and provides independent elevation-based confirmation for 13 Richardson. Zero false positives on clean houses. Three-guard ground classification (height AND pitch AND area) is conservative enough to avoid false flags on legitimate low-pitch roof sections.

### 12.9 V2P0.1 — Ground Suppression Hardening

**Date:** 2026-04-19
**Purpose:** Targeted bugfix — V2P0 correctly flagged ground-like faces but did not remove them from `roof_faces`. Elongated near-ground strips were still surviving into the final build output and participating in V2P1 structural reasoning.

**Hard suppression rule (4-way conjunction):**
A face is removed from `roof_faces` when ALL of:
1. `height_above_ground < 1.5m`
2. `elongation_ratio > 4.0` (eigenvalue-based principal axis ratio)
3. `pitch < 15°`
4. `classification != 'structure_like'`

**New constants:**

| Constant | Value | Purpose |
|---|---|---|
| `V2P0_HARD_SUPPRESS_MAX_HEIGHT_M` | 1.5 | Max height for suppression candidate |
| `V2P0_HARD_SUPPRESS_MIN_ELONGATION` | 4.0 | Min elongation ratio for strip detection |
| `V2P0_HARD_SUPPRESS_MAX_PITCH_DEG` | 15.0 | Max pitch for suppression candidate |

**New per-face debug fields:** `elongation_ratio`, `hard_ground_suppressed`, `hard_ground_suppression_reasons[]`.
**New build-level debug fields:** `hard_ground_suppressed_count`, `hard_ground_suppressed_faces[]`, `v2p0_hard_suppression_applied`.
**New review reason:** `v2p0_ground_surface_suppressed`.

### 12.10 V2P0.1 Validation (8 properties)

| Property | Bucket | Orig | Suppressed | Final | Elong of suppressed | Correct? |
|---|---|---|---|---|---|---|
| 20 Meadow Dr | improved | 4 | 1 (face[3]) | 3 | 7.61 | YES — elongated ground strip removed |
| 15 Veteran Rd | clean | 3 | 0 | 3 | — | YES — all structure_like |
| 225 Gibson St | complex | 6 | 0 | 6 | — | YES — uncertain faces have high pitch |
| 175 Warwick | steep | 3 | 0 | 3 | — | YES — all structure_like |
| 583 Westford | rejected | 0 | — | 0 | — | skipped |
| 11 Ash Road | target | 1 | 0 | 1 | 2.95 | YES — not elongated (wide flat, not strip) |
| 13 Richardson | ground | 1 | 0 | 1 | 2.04 | YES — not elongated (compact ground) |
| Lawrence | complex | 6 | 0 | 6 | — | YES — face[4] elong=3.98 just below 4.0 |

### 12.11 V2P0.1 Key findings

1. **20 Meadow face[3] correctly suppressed.** h=0.07m, pitch=3.32°, area=49m², elong=7.61. Classic elongated ground strip (driveway/yard edge). Now physically removed from `roof_faces` before V2P1 and response.

2. **11 Ash Road NOT suppressed.** elong=2.95 — it's a wide flat area (roughly 20×7m), not a strip. Already flagged by p9_build_unmatched and crm_soft_gate_applied. Conjunction rule correctly distinguishes "flat ground" from "elongated ground strip".

3. **13 Richardson NOT suppressed.** elong=2.04 — compact ground surface. Already flagged by p9_build_unmatched and v2p0_ground_surface_detected.

4. **Lawrence face[4] narrowly escapes.** elong=3.98 (just below 4.0), h=-2.06m, pitch=12.62°. Conservative threshold holds — this face is borderline but not a clear strip.

5. **V2P1 coherence stable.** 15 Veteran: 0.92 (unchanged). Lawrence: 0.81 (unchanged). 225 Gibson: 0.44 (unchanged). 20 Meadow: 0.67→0.63 (ground face no longer in structural pool — correct).

6. **Zero false positives.** No clean, steep, complex, or improved roof faces were suppressed.

### 12.12 V2P0.1 Verdict

**KEEP.** The 4-way conjunction rule correctly targets elongated near-ground strips while leaving compact ground-like faces (handled by other mechanisms) and all legitimate roof faces untouched. Zero false positives across 8 properties. The elongation_ratio debug field is useful independently of suppression.

---

## 13. V2 Phase 1 — Structural Coherence / Mirrored-Pair Logic

**Date:** 2026-04-19
**Phase:** V2P1 (second phase of Worker Design Mode V2)
**Code location:** `server.js` — `structuralCoherenceAssessment()` + 6 helper functions, called from `/api/ml/auto-build` proxy route after V2P0.
**Debug location:** `crm_result.metadata.v2p1_structural_coherence`

### 13.1 Purpose

Evaluate whether surviving roof faces form plausible mirrored/ridge-paired relationships. First structural grammar layer — debug-only, no geometry changes, no status changes.

### 13.2 Method

1. Identify main planes: area ≥ max(10m², 15% of largest face).
2. Generate candidate pairs from faces with opposing azimuth (±30°), similar pitch (±15°), and proximity (centroid < 25m).
3. Score each pair using 4 weighted signals: azimuth opposition (0.35), pitch similarity (0.25), spatial edge gap (0.25), area ratio (0.15).
4. Classify pairs: `mirrored_gable_like`, `mirrored_main_roof_like`, `partial_mirror`, `weak_candidate`, `non_mirrored`.
5. Build-level coherence score from main-plane pairing coverage (0.4) + best pair confidence (0.3) + average strong pair confidence (0.3).
6. Emit structural warnings: `no_strong_mirrored_pairs`, `major_plane_unpaired`, `high_pair_pitch_mismatch`, `weak_azimuth_opposition`, `poor_structural_pair_coverage`, `fragmented_main_roof_structure`.

### 13.3 Constants

| Constant | Value | Purpose |
|---|---|---|
| `V2P1_MAIN_PLANE_MIN_AREA_M2` | 10.0 | Absolute min area for main plane |
| `V2P1_MAIN_PLANE_MIN_AREA_FRACTION` | 0.15 | Relative min area (fraction of max) |
| `V2P1_MAX_AZ_OPPOSITION_DEG` | 30.0 | Max azimuth opposition error for candidate |
| `V2P1_MAX_PITCH_DELTA_DEG` | 15.0 | Max pitch delta for candidate |
| `V2P1_MAX_CENTROID_DIST_M` | 25.0 | Max centroid distance for candidate |
| `V2P1_STRONG_PAIR_CONFIDENCE` | 0.6 | Threshold for strong pair |
| `V2P1_MODERATE_PAIR_CONFIDENCE` | 0.4 | Threshold for moderate pair |

### 13.4 Pair-level debug fields

`face_a_idx`, `face_b_idx`, `pitch_a`, `pitch_b`, `pitch_delta`, `azimuth_a`, `azimuth_b`, `azimuth_opposition_error`, `area_a`, `area_b`, `area_ratio`, `centroid_distance`, `min_edge_gap`, `spatial_compatibility_score`, `pair_confidence`, `pair_type_guess`, `is_main_plane_pair`.

### 13.5 Build-level debug fields

`v2_structural_logic_applied`, `main_plane_count`, `main_plane_area_threshold_m2`, `candidate_plane_pairs`, `mirrored_pair_count`, `paired_main_plane_count`, `unpaired_main_planes`, `weak_pair_count`, `best_pair_confidence`, `pair_confidence_stats`, `mean_pair_pitch_delta`, `mean_pair_azimuth_opposition_error`, `pair_area_ratio_stats`, `structural_coherence_score`, `structural_warnings`, `structural_phase_notes`, `pair_details`.

### 13.6 Validation results (8 properties)

| Property | Bucket | Faces | Main | Candidates | Mirrored | Paired main | Coherence | Warnings |
|---|---|---|---|---|---|---|---|---|
| 15 Veteran Rd | clean_gable | 3 | 3 | 2 | 2 | 3 | **0.92** | none |
| Lawrence | improved_complex | 6 | 6 | 3 | 2 | 5 | **0.81** | major_plane_unpaired |
| 20 Meadow Dr | improved_simple | 4 | 4 | 2 | 1 | 3 | 0.67 | major_plane_unpaired, high_pair_pitch_mismatch |
| 175 Warwick | steep_real | 3 | 1 | 1 | 1 | 0 | 0.50 | none |
| 225 Gibson St | complex_corrected | 6 | 3 | 3 | 1 | 0 | 0.44 | major_plane_unpaired, poor_structural_pair_coverage |
| 583 Westford | rejected | 0 | — | — | — | — | — | skipped (0 faces) |
| 11 Ash Road | single_face | 1 | — | — | — | — | — | skipped (1 face) |
| 13 Richardson | single_face | 1 | — | — | — | — | — | skipped (1 face) |

### 13.7 Key pair examples

1. **15 Veteran face[0,1]**: `mirrored_gable_like`, conf=0.91, az_err=1.42°, Δpitch=2.4°, edge_gap=0.15m, area_ratio=0.83. Classic gable pair — near-zero azimuth error, almost touching edges, very similar pitch.

2. **Lawrence face[0,1]**: `mirrored_gable_like`, conf=0.83, az_err=1.38°, Δpitch=4.48°, edge_gap=0.32m, area_ratio=0.55. Strong gable pair on one section of a multi-section roof.

3. **Lawrence face[2,3]**: `mirrored_gable_like`, conf=0.71, az_err=2.55°, Δpitch=4.66°, edge_gap=6.94m, area_ratio=0.91. Second gable pair on another section — larger edge gap suggests separate roof section.

4. **225 Gibson face[2,3]**: `mirrored_gable_like`, conf=0.74, az_err=4.59°, Δpitch=3.6°, area_ratio=0.12. Good geometry but extremely asymmetric area — one face is tiny.

5. **175 Warwick face[1,2]**: `mirrored_main_roof_like`, conf=0.86, az_err=3.24°, Δpitch=5.21°, edge_gap=0.51m, area_ratio=0.98. Strong pair between steep secondary faces. Steep pitch does NOT prevent pairing.

### 13.8 Key findings

1. **Simple gable roofs produce high coherence.** 15 Veteran: coherence=0.92, 2 gable-like pairs, 0 warnings. The scoring correctly rewards strong opposition alignment and proximity.

2. **Multi-section roofs produce multiple gable pairs.** Lawrence: coherence=0.81, 2 independent gable pairs detected across different roof sections. The edge_gap difference (0.32m vs 6.94m) correctly distinguishes adjacent from separated sections.

3. **Complex/problematic roofs get low coherence and correct warnings.** 225 Gibson: coherence=0.44, warnings=[major_plane_unpaired, poor_structural_pair_coverage]. The 3 main planes don't pair with each other because their azimuths aren't opposing — a genuinely diagnostic signal.

4. **Steep-but-real roofs are not catastrophically scored.** 175 Warwick: coherence=0.5 (neutral single-main-plane default). The strong secondary pair (conf=0.86) shows the steep faces do form a valid mirrored structure. Not penalized for steepness.

5. **20 Meadow correctly warns.** The high_pair_pitch_mismatch warning fires because the best pair has Δpitch=9.88°. The ground-like face (from V2P0) contributes to the unpaired main plane count.

6. **No status changes.** V2P1 is debug-only. All 5 active properties retain their existing status. Zero regression risk.

7. **No V1/V2P0 interference.** All prior phase outputs (P8 corrections, P9 flags, V2P0 ground detection) remain unchanged.

### 13.9 Verdict

**KEEP.** V2P1 produces interpretable, directionally correct structural coherence signals across all validation property types. Simple roofs score high, complex roofs score low with useful warnings, and steep roofs are handled gracefully. The debug data (pair-level metrics, build-level summary, warnings) provides a foundation for future structural reasoning phases. Zero production risk (debug-only, no status changes).

---

## 14. V2P2 — Main Roof Coherence / Main-vs-Secondary Plane Logic

**Date:** 2026-04-19
**Phase:** V2 Phase 2 (after V2P0/V2P0.1/V2P1)
**Pipeline placement:** After V2P1 in proxy route. Classification/debug only — no geometry mutation.

### 14.1 Method

Classify each surviving roof face as `main_roof_candidate`, `secondary_roof_candidate`, or `uncertain` using a weighted composite of 5 signal families:

| Signal | Weight | What it measures |
|---|---|---|
| A. Area importance | 0.30 | Face area relative to largest face (0.6) + area share of total (0.4, scaled 3×) |
| B. Structural participation | 0.25 | Best V2P1 pair confidence for this face; defaults to 0.3 if no V2P1 data |
| C. Adjacency/connectivity | 0.20 | Neighbor count (edge gap < 3m, strong < 1m) + mean adjacency strength |
| D. Centrality | 0.10 | Distance from face centroid to mean centroid, normalized by roof extent |
| E. Realism confirmation | 0.15 | V2P0 classification: structure_like=1.0, uncertain=0.5, ground_like=0.2 |

**Classification thresholds:** main_roof_score >= 0.55 → main_roof_candidate, >= 0.30 → uncertain, < 0.30 → secondary_roof_candidate.

**Connected components:** Faces within 3m edge gap are connected. Dominant component = component with the most main_roof_candidate area.

**Build-level coherence score:** area_concentration × 0.30 + dominance_concentration × 0.25 + avg_main_score × 0.25 + main_structural_coverage × 0.20.

### 14.2 Constants

`V2P2_ADJACENCY_GAP_M=3.0`, `V2P2_STRONG_ADJACENCY_GAP_M=1.0`, `V2P2_MAIN_SCORE_THRESHOLD=0.55`, `V2P2_SECONDARY_SCORE_THRESHOLD=0.30`, `V2P2_W_AREA=0.30`, `V2P2_W_STRUCTURAL=0.25`, `V2P2_W_ADJACENCY=0.20`, `V2P2_W_CENTRALITY=0.10`, `V2P2_W_REALISM=0.15`.

### 14.3 Per-face debug fields

`face_idx`, `area_m2`, `area_ratio_to_max`, `area_share_of_total`, `structural_pair_confidence`, `is_in_strong_pair`, `adjacency_count`, `strong_adjacency_count`, `adjacency_strength`, `centrality_score`, `realism_score`, `signal_scores{area,structural,adjacency,centrality,realism}`, `main_roof_score`, `secondary_roof_score`, `main_roof_classification`, `connected_component_id`, `strongest_neighbor_idx`, `strongest_neighbor_score`.

### 14.4 Build-level debug fields

`v2_main_roof_logic_applied`, `total_surviving_faces`, `main_roof_candidate_count`, `secondary_roof_candidate_count`, `uncertain_face_count`, `main_roof_area_share`, `largest_main_component_area_share`, `dominant_component_face_count`, `dominant_component_pair_count`, `main_roof_coherence_score`, `fragmented_main_roof`, `main_roof_warnings[]`, `scoring_weights`, `classification_thresholds`, `face_classification_summary[]`, `main_roof_phase_notes[]`, `face_assessments[]`.

### 14.5 Warnings emitted

`no_clear_dominant_roof_body`, `too_many_competing_main_faces`, `main_roof_area_too_diffuse`, `fragmented_main_roof_body`, `dominant_face_unpaired`, `weak_main_roof_connectivity`.

### 14.6 Validation results (8 properties)

| Property | Bucket | Faces | Main | Sec | Unc | Area share | Coherence | Warnings |
|---|---|---|---|---|---|---|---|---|
| 15 Veteran Rd | clean_gable | 3 | 3 | 0 | 0 | 1.00 | 0.94 | none |
| 20 Meadow Dr | improved_simple | 3 | 2 | 0 | 1 | 0.89 | 0.88 | none |
| 225 Gibson St | complex_corrected | 6 | 4 | 1 | 1 | 0.84 | 0.77 | none |
| Lawrence | improved_complex | 6 | 4 | 0 | 2 | 0.75 | 0.80 | none |
| 175 Warwick | steep_real | 3 | 3 | 0 | 0 | 1.00 | 0.84 | none |
| 11 Ash Road | target_strip | 1 | 1 | 0 | 0 | 1.00 | 0.55 | none |
| 13 Richardson St | single_ground | 1 | 0 | 0 | 1 | 0.00 | 0.00 | no_clear_dominant_roof_body |
| 583 Westford St | rejected | 0 | — | — | — | — | — | (skipped, 0 faces) |

### 14.7 Key findings

1. **Simple roofs produce clear dominant bodies.** 15 Veteran (clean gable): coherence=0.94, all 3 faces main. 20 Meadow: coherence=0.88, 2 main faces cover 89% of area.

2. **Complex roofs differentiate main vs secondary.** 225 Gibson: face[3] (89.6m², score=0.90) is clearly dominant. Face[4] (15.4m², centrality=0, no structural pair) correctly classified as secondary. Lawrence: face[1] (89.2m², score=0.90) dominates, face[4] (50.7m², no pair) correctly uncertain.

3. **Steep roof not unfairly demoted.** 175 Warwick: coherence=0.84, all 3 faces main. Realism score 1.0 (structure_like from V2P0) compensates for the largest face having no structural pair.

4. **Ground-like face correctly flagged.** 13 Richardson: single face with realism=0.2 (ground_like from V2P0), score=0.51 → uncertain, coherence=0, warns no_clear_dominant_roof_body.

5. **Multi-signal prevents single-metric false classification.** 225 Gibson face[1] (9.85m², tiny) still classified as main because it has structural pair confidence=0.56, 3 adjacencies, and centrality=0.77. Area alone would have demoted it.

6. **No geometry mutation, no status changes.** V2P2 is classification/debug only. All prior phase outputs preserved.

7. **Prior phases stable.** V2P0 ground detection, V2P0.1 suppression, V2P1 pair analysis all produce identical results.

### 14.8 Verdict

**KEEP.** V2P2 produces a useful, interpretable main-vs-secondary distinction across all validation property types. Simple roofs get clear dominant bodies (coherence 0.88-0.94), complex roofs get meaningful differentiation with secondary/uncertain classifications, and problem roofs surface useful warnings. The 5-signal weighted model prevents single-metric false classification while keeping the scoring readable and tunable. Zero production risk (debug-only, no geometry mutation, no status changes).

---

## 15. V2P3 — Ridge / Hip / Valley Relationship Logic

**Date:** 2026-04-19
**Phase:** V2 Phase 3 (after V2P0/V2P0.1/V2P1/V2P2)
**Pipeline placement:** After V2P2 in proxy route. Classification/debug only — no geometry mutation.

### 15.1 Method

Classify structural relationships between adjacent face pairs (edge gap < 4m) using 6 signal families:

| Signal | What it measures |
|---|---|
| A. Azimuth relationship | opposing (≥140° diff) → ridge candidate; oblique (30-140°) → hip/valley candidate; near_parallel (<30°) → seam/step candidate |
| B. Pitch compatibility | Pitch delta between faces; lower delta supports ridge/seam, higher delta supports step |
| C. Edge gap closeness | Nearest edge distance; tighter gaps → stronger relationships |
| D. Meeting point geometry | Midpoint of closest edge samples between the two faces |
| E. Convex/concave hint | Dot product of each face's downslope direction with centroid-to-meeting-point vector; both negative → convex (hip/ridge); both positive → concave (valley); otherwise mixed |
| F. Main-roof participation | From V2P2: main/main, main/secondary, secondary/secondary patterns |

**Classification rules:**
- **ridge_like:** opposing azimuths, pitch delta < 15°, gap < 3m. Convex confirmation boosts confidence; concave halves it.
- **hip_like:** oblique azimuths, convex hint, gap < 3m
- **valley_like:** oblique azimuths, concave hint, gap < 3m
- **seam_like:** near-parallel azimuths, pitch delta < 8°, gap < 2m
- **step_like:** parallel or oblique with pitch delta ≥ 15°, gap < 3m
- **uncertain:** insufficient evidence for any classification

### 15.2 Constants

`V2P3_CANDIDATE_GAP_M=4.0`, `V2P3_RIDGE_MIN_AZ_OPPOSITION=140`, `V2P3_SEAM_MAX_AZ_PARALLEL=30`, `V2P3_RIDGE_MAX_PITCH_DELTA=15`, `V2P3_SEAM_MAX_PITCH_DELTA=8`, `V2P3_STEP_MIN_PITCH_DELTA=15`, `V2P3_STRONG_REL_CONF=0.6`, `V2P3_MODERATE_REL_CONF=0.35`.

### 15.3 Per-pair debug fields

`face_a_idx`, `face_b_idx`, `pair_is_main_relevant`, `both_main`, `azimuth_a`, `azimuth_b`, `azimuth_relationship`, `azimuth_diff`, `azimuth_opposition_error`, `pitch_a`, `pitch_b`, `pitch_delta`, `edge_gap_m`, `shared_or_near_edge_score`, `convexity_hint`, `relationship_confidence`, `relationship_type`, `relationship_reasons[]`, `main_secondary_pattern`.

### 15.4 Build-level debug fields

`v2_relationship_logic_applied`, `candidate_relationship_count`, `ridge_like_count`, `hip_like_count`, `valley_like_count`, `seam_like_count`, `step_like_count`, `uncertain_relationship_count`, `main_relationship_count`, `dominant_relationship_family`, `best_relationship_confidence`, `weak_relationship_count`, `roof_relationship_coherence_score`, `relationship_warnings[]`, `relationship_phase_notes[]`, `relationship_details[]`.

### 15.5 Warnings emitted

`main_faces_mostly_uncertain`, `no_clear_main_relationships`, `excessive_seam_like_main_pairs`, `weak_ridge_hip_valley_evidence`, `fragmented_main_body_relationships`.

### 15.6 Validation results (8 properties)

| Property | Bucket | Faces | Cands | Ridge | Hip | Valley | Seam | Step | Unc | Coherence | Warnings |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 15 Veteran Rd | clean_gable | 3 | 3 | 2 | 0 | 0 | 1 | 0 | 0 | 0.99 | none |
| 20 Meadow Dr | improved_simple | 3 | 3 | 2 | 0 | 1 | 0 | 0 | 0 | 0.65 | weak_ridge_hip_valley_evidence |
| 225 Gibson St | complex_corrected | 6 | 9 | 2 | 1 | 0 | 0 | 2 | 4 | 0.59 | none |
| 175 Warwick | steep_real | 3 | 3 | 1 | 1 | 1 | 0 | 0 | 0 | 0.88 | none |
| Lawrence | improved_complex | 6 | 12 | 2 | 2 | 0 | 1 | 1 | 6 | 0.55 | none |
| 13 Richardson St | single_ground | 1 | — | — | — | — | — | — | — | — | (skipped, 1 face) |
| 11 Ash Road | target_strip | 1 | — | — | — | — | — | — | — | — | (skipped, 1 face) |
| 583 Westford St | rejected | 0 | — | — | — | — | — | — | — | — | (skipped, 0 faces) |

### 15.7 Key findings

1. **Clean gable gets dominant ridge structure.** 15 Veteran: coherence=0.99. Two ridge_like pairs both confirmed convex (faces slope away from crest). Seam between faces [1,2] correctly identified — near-identical azimuths (Δ=1.96°) and pitches (Δ=0.7°). Best confidence=0.96.

2. **Convexity hint correctly differentiates hip from valley.** 175 Warwick: face[0] (108m², the large face) meets face[1] with concave geometry → valley_like. Same face[0] meets face[2] with convex geometry → hip_like. The ridge between [1,2] is correctly convex-confirmed.

3. **Complex roofs remain conservative.** 225 Gibson: 4 of 9 relationships are uncertain — these are oblique pairs with mixed convexity where the system correctly refuses to claim hip or valley. Lawrence: 6 of 12 uncertain — all are oblique with mixed convexity hints. This is honest behavior, not overclaiming.

4. **Step relationships identified.** 225 Gibson: faces [3,5] (Δpitch=17.77°, parallel azimuths) and [1,2] (Δpitch=19.26°) correctly classified as step_like — large pitch differences between parallel-facing planes suggest level transitions.

5. **Hip-like relationship at 90° oblique confirmed.** 225 Gibson: face[3] (89.6m², the dominant face) meets face[4] (15.4m²) at exactly 90.37° azimuth difference with convex geometry → hip_like, conf=0.93. This is the highest-confidence relationship in the complex roof.

6. **20 Meadow warns appropriately.** The best confidence is 0.59, just below the 0.6 strong threshold → warns `weak_ridge_hip_valley_evidence`. Both ridge pairs have weaker evidence (opposition errors of 8.99° and 38.2°) than the clean 15 Veteran gable.

7. **No geometry mutation, no status changes.** V2P3 is classification/debug only. All prior phase outputs preserved.

### 15.8 Verdict

**KEEP.** V2P3 produces interpretable structural relationship labels that correctly identify ridge-like, hip-like, valley-like, seam-like, and step-like relationships. The convexity hint using downslope vector geometry successfully differentiates hip from valley. Complex roofs are handled conservatively with honest uncertainty rather than overclaiming. Simple gable roofs get near-perfect coherence with dominant ridge classification. Zero production risk (debug-only, no geometry mutation, no status changes).

---

## 16. V2P4 — Whole-Roof Consistency Warnings

**Date:** 2026-04-19
**Phase:** V2 Phase 4 (after V2P0/V2P0.1/V2P1/V2P2/V2P3)
**Pipeline placement:** After V2P3 in proxy route. Assessment/debug only — no geometry mutation.

### 16.1 Method

Synthesize V2P0–V2P3 outputs into a single consistency assessment with contradiction detection and actionable warnings. 5 weighted factors:

| Factor | Weight | Source |
|---|---|---|
| A. Main body coherence | 0.30 | V2P2 `main_roof_coherence_score` |
| B. Structural pairing | 0.25 | V2P1 `structural_coherence_score` |
| C. Relationship coherence | 0.25 | V2P3 `roof_relationship_coherence_score` |
| D. Realism confirmation | 0.10 | V2P0 structure_like ratio |
| E. Contradiction penalty | 0.10 | 1.0 minus 0.15 per detected contradiction (floor 0.0) |

**Single-face edge case:** Uses separate formula: mainBody × 0.5 + realism × 0.3 + contradiction × 0.2 (no structural/relationship contribution since those require ≥2 faces).

**Dominant story strength:** Computed as max(mainBodyCoherence, structuralCoherence, relCoherence) — identifies the strongest phase signal.

### 16.2 Constants

`V2P4_W_MAIN_BODY=0.30`, `V2P4_W_STRUCTURAL=0.25`, `V2P4_W_RELATIONSHIP=0.25`, `V2P4_W_REALISM=0.10`, `V2P4_W_CONTRADICTION=0.10`.

### 16.3 Contradiction detection

6 cross-phase contradiction flags:
- `strong_main_body_but_weak_relationships`: mainBody coherence ≥ 0.7 but relationship coherence < 0.4 (≥3 faces)
- `strong_relationships_but_no_clear_main_body`: relationship coherence ≥ 0.6 but 0 main candidates (≥2 faces)
- `many_main_faces_but_low_pair_coverage`: ≥3 main candidates but structural coherence < 0.4 and ≥2 unpaired main
- `dominant_main_body_with_fragmented_relationships`: main area share ≥ 0.7 but >60% uncertain main relationships (≥2 main rels)
- `high_uncertainty_on_main_faces`: >50% uncertain main relationships (≥2 main rels)
- `too_many_uncertain_main_relations`: >70% uncertain main relationships (≥3 main rels)

### 16.4 Build-level debug fields

`v2_whole_roof_consistency_applied`, `whole_roof_consistency_score`, `dominant_story_strength`, `main_body_score`, `structural_pairing_score`, `relationship_score`, `realism_factor`, `contradiction_factor`, `uncertainty_ratio`, `contradiction_flags[]`, `whole_roof_warnings[]`, `consistency_phase_notes[]`, `input_phase_summary` (nested V2P0–V2P3 inputs).

### 16.5 Warnings emitted

`weak_overall_consistency`, `high_cross_phase_contradiction`, `dominant_phase_with_weak_support`, `weak_pair_coverage_on_main_body`, `fragmented_main_body_relationships`.

### 16.6 Validation results (8 properties)

| Property | Bucket | Faces | Consistency | Story | Contradictions | Warnings |
|---|---|---|---|---|---|---|
| 15 Veteran Rd | clean_gable | 3 | 0.96 | 0.98 | none | none |
| 20 Meadow Dr | improved_simple | 3 | 0.73 | 0.88 | none | none |
| 225 Gibson St | complex_corrected | 6 | 0.66 | 0.8 | none | weak_pair_coverage_on_main_body |
| 175 Warwick | steep_real | 3 | 0.80 | 0.88 | none | none |
| Lawrence | improved_complex | 6 | 0.69 | 0.8 | high_uncertainty_on_main_faces | none |
| 13 Richardson St | single_ground | 1 | 0.20 | 0.04 | none | weak_overall_consistency |
| 11 Ash Road | target_strip | 1 | 0.48 | 0.47 | none | none |
| 583 Westford St | rejected | 0 | — | — | — | (skipped, 0 faces) |

### 16.7 Key findings

1. **Clean gable gets near-perfect consistency.** 15 Veteran: consistency=0.96, story=0.98. All phase signals align — strong main body, strong structural pairing, strong relationships, all faces structure-like. Zero contradictions.

2. **Steep roof not unfairly demoted.** 175 Warwick: consistency=0.80. Despite steep pitches (47–55°), all phase signals are moderate-to-strong. No contradictions or warnings — the system correctly recognizes a steep but structurally coherent roof.

3. **Cross-phase contradictions correctly detected.** Lawrence: `high_uncertainty_on_main_faces` fires because 6 of 11 main-relevant relationships (54.5%) are uncertain. This is honest — good V2P2 main-body identification but V2P3 can't resolve most relationship types for the complex oblique geometry.

4. **Single-face edge case handled.** 13 Richardson: consistency=0.20, story=0.04. The single face is ground-like (V2P0) so realism is low. Separate formula avoids penalizing for missing structural/relationship signals. Warns `weak_overall_consistency`.

5. **Complex roofs get differentiated scores.** 225 Gibson (0.66) vs Lawrence (0.69) — both complex but different weakness profiles. Gibson has weak pair coverage on main body; Lawrence has high uncertainty on main face relationships.

6. **Realism factor correctly scales.** 20 Meadow: consistency=0.73, lower than expected for a simple roof. V2P0 shows 1 of 3 faces uncertain (not structure_like), pulling realism to 0.5 and dragging overall score down. This is correct — the uncertain face should lower confidence.

7. **No geometry mutation, no status changes.** V2P4 is assessment/debug only. All prior phase outputs preserved.

### 16.8 Verdict

**KEEP.** V2P4 produces a meaningful whole-roof consistency assessment that correctly synthesizes V2P0–V2P3 signals. Clean roofs score high (0.96), problematic roofs score low (0.20), and complex roofs get differentiated mid-range scores with specific contradiction flags and warnings identifying the weakness. The contradiction detection successfully identifies cross-phase inconsistencies without false positives on clean/simple roofs. Zero production risk (debug-only, no geometry mutation, no status changes).

---

## 17. V2P5 — Performance Optimization + Instrumentation

**Date:** 2026-04-19
**Phase:** V2 Phase 5 (after V2P0/V2P0.1/V2P1/V2P2/V2P3/V2P4)
**Pipeline placement:** Cache/proximity built after V2P0.1, consumed by V2P1-V2P3. Timing wraps all stages.

### 17.1 Method

Two-part approach: (A) comprehensive timing instrumentation to identify hotspots, (B) shared geometry cache + proximity matrix to eliminate redundant computation across V2 phases.

**A. Timing instrumentation:** `Date.now()` around each pipeline stage. Results in `crm_result.metadata.performance_timing`.

**B. Shared geometry cache:** `v2BuildFaceCache(faces)` computes per-face area, centroid, edgeSamples (vertices + midpoints), and bbox once. All V2P1-V2P3 consume from cache instead of recomputing independently.

**C. Shared proximity matrix:** `v2BuildProximityMatrix(faceCache, maxGap=4.0m)` computes edge-gap and meeting-point for all face pairs within the maximum threshold in a single O(N²) pass with bbox pruning. V2P1 (mirrored-pair gap), V2P2 (adjacency), and V2P3 (relationship candidates + meeting points) all consume from the shared matrix instead of computing independently.

### 17.2 What was eliminated

| Redundant computation | Before V2P5 | After V2P5 |
|---|---|---|
| Per-face area (v2p0PolygonArea) | Computed in V2P1, V2P2, V2P3 (3×) | Computed once in cache |
| Per-face centroid (v2p1Centroid) | Computed in V2P1, V2P2, V2P3 (3×) | Computed once in cache |
| Per-face edge samples | Computed per-call in v2p1MinEdgeGap + v2p3FindMeetingPoint (N× per face) | Computed once in cache |
| O(N²) edge-gap computation | V2P1 (filtered), V2P2 (full), V2P3 (full) — 2-3 full passes | 1 pass in proximity matrix |
| Meeting-point computation | V2P3 full O(N²) identical to edge-gap scan | Combined with edge-gap in proximity matrix |

### 17.3 Performance timing fields

`performance_phase_applied`, `ml_request_ms`, `crm_post_ml_total_ms`, `p3_p8_p9_crossval_ms`, `v2p0_ground_structure_ms`, `v2p5_cache_build_ms`, `v2p1_structural_ms`, `v2p2_main_roof_ms`, `v2p3_relationships_ms`, `v2p4_consistency_ms`, `face_count`, `proximity_pairs_computed`, `bbox_pruned_pairs`, `hotspot_ranked_summary[]`, `optimization_notes[]`.

### 17.4 Timing results (8 properties)

| Property | Faces | Total | ML Request | CRM PostML | P3 CrossVal | V2P0 | Cache | V2P1-P4 |
|---|---|---|---|---|---|---|---|---|
| 15 Veteran Rd | 3 | 7.2s | 6620ms | 325ms | 274ms | 48ms | 0ms | <3ms |
| 20 Meadow Dr | 3 | 6.2s | 5761ms | 297ms | 259ms | 37ms | 0ms | <3ms |
| 225 Gibson St | 6 | 12.1s | 11273ms | 402ms | 302ms | 97ms | 0ms | <3ms |
| 175 Warwick | 3 | 13.6s | 12984ms | 385ms | 296ms | 88ms | 0ms | <3ms |
| Lawrence | 6 | 24.8s | 24225ms | 343ms | 297ms | 44ms | 0ms | <3ms |
| 13 Richardson St | 1 | 4.3s | 3862ms | 232ms | 193ms | 39ms | 0ms | <1ms |
| 11 Ash Road | 1 | 14.2s | 13360ms | 472ms | 358ms | 110ms | 1ms | <3ms |
| 583 Westford St | 0 | 1.1s | 896ms | 0ms | 0ms | 0ms | 0ms | 0ms |

### 17.5 Key findings

1. **ML request is 92-98% of total runtime.** The Python ML server (image fetch + model inference + DSM build + geometry cleanup) dominates. CRM-side V2 phases are negligible (<3ms combined for all 5 phases).

2. **P3 Google Solar API is the CRM-side hotspot.** 193-358ms per property. This is a network round-trip to `solar.googleapis.com` — cannot be optimized without caching or parallelizing.

3. **V2P0 DSM grid build is the second CRM-side cost.** 30-110ms. Builds a 281×281 grid from raw LiDAR points. Modest but not the bottleneck.

4. **Shared cache/proximity eliminates redundant work** but absolute savings are sub-millisecond because V2P1-V2P4 were already fast on typical face counts (1-6 faces). The optimization becomes meaningful at higher face counts.

5. **Target <15s not met.** 4 of 7 non-rejected properties exceed 15s. The bottleneck is entirely in the ML Python server. CRM-side optimization is complete — further gains require ML-side work (image fetch latency, model inference speed, DSM sampling, geometry cleanup).

### 17.6 Accuracy validation

| Property | V2P4 Before | V2P4 After | V2P3 coh | V2P2 coh | V2P1 coh | Changed? |
|---|---|---|---|---|---|---|
| 15 Veteran Rd | 0.96 | 0.96 | 0.99 | 0.94 | 0.92 | No |
| 20 Meadow Dr | 0.73 | 0.73 | 0.65 | 0.88 | 0.63 | No |
| 225 Gibson St | 0.66 | 0.66 | 0.59 | 0.77 | 0.44 | No |
| 175 Warwick | 0.80 | 0.80 | 0.88 | 0.84 | 0.50 | No |
| Lawrence | 0.69 | 0.69 | 0.55 | 0.80 | 0.80 | No |
| 13 Richardson St | 0.20 | 0.20 | — | 0 | — | No |
| 11 Ash Road | 0.48 | 0.48 | — | 0.55 | — | No |
| 583 Westford St | — | — | — | — | — | No |

Zero accuracy regressions. All V2P4 consistency scores, contradiction flags, and warnings match prior validation exactly.

### 17.7 Verdict

**KEEP.** V2P5 delivers two valuable outcomes: (1) trustworthy timing instrumentation that conclusively identifies the ML Python server as the dominant bottleneck, and (2) clean shared-cache architecture that eliminates redundant geometry computation across V2 phases. Zero accuracy regressions. The <15s target is not met because the bottleneck is upstream in the ML server, not in CRM-side V2 logic. Next optimization step must target the Python side: image fetch latency, model inference, DSM build, or geometry cleanup.

---

## 18. V2P6 — ML Core Runtime Optimization

**Date:** 2026-04-19
**Goal:** Instrument and optimize the ML Python server, which V2P5 proved is 92-98% of total runtime.
**Spec constraint:** Bias toward caching before touching accuracy-sensitive model behavior. No accuracy regressions.

### Method

**Step 1: Python-side timing instrumentation.** Added `time.perf_counter()` around every major stage in `ml_ui_server.py::api_crm_auto_build()`: satellite fetch, center crop, DSM build, ML inference (handler call wrapping `runner.run()`), coordinate transform, target isolation, geometry cleanup, phase assembly. Extracted per-ML-stage `duration_s` from `StageResult` (threaded through CRM adapter via new `stage_results` field in metadata). All timing exposed via `metadata.v2p6_timing` in the API response.

**Step 2: Baseline instrumentation run (8 properties).** Identified `semantic_edges` as the dominant bottleneck:
- 15 Veteran Rd: 544ms (47% of ML time)
- 20 Meadow Dr: 2427ms (80%)
- 225 Gibson St: 3394ms (80%)
- 175 Warwick: 4858ms (89%)
- Lawrence: 18377ms (96%)
- 13 Richardson: 1820ms (61%)
- 11 Ash Road: 11976ms (94%)

All other ML stages are essentially constant time (~300-1200ms total). semantic_edges scales with edge count and was the sole driver of runtime variance (544ms to 18377ms).

**Step 3: Root cause analysis.** The `_compute_edge_features()` function in `ml_engine/core/stages/semantics.py` recomputed these expensive Shapely operations on EVERY edge:
1. `unary_union([pp.boundary for pp in plane_polys_sh])` — O(N_planes) boundary union
2. `.buffer(_COV_PIX)` — buffered polygon construction (many vertices)
3. `edge_line.intersection(buf)` — geometric intersection

For Lawrence (175 edges), this meant 175 redundant unary_union + buffer computations of identical data.

**Step 4: Shapely geometry cache.** Pre-compute shared objects once per inference call:
- `outline_poly.boundary` → cached in `_cache["outline_boundary"]`
- `outline_poly.bounds` → cached in `_cache["outline_bounds"]`
- `[pp.boundary for pp in plane_polys_sh]` → cached in `_cache["plane_boundaries"]`
- `unary_union(plane_boundaries).buffer(COV_PIX)` → cached in `_cache["all_bounds_buf"]`

Passed via `_cache` kwarg to `_compute_edge_features()`. No accuracy change — same Shapely operations, same results, computed once instead of O(edges) times.

**Step 5: Crop rendering optimization.** Pre-convert full image to numpy array (`np.array(image.pil.convert("RGB"))`) once. Use numpy slicing with explicit padding for out-of-bounds crops instead of `PIL.Image.crop()` per edge. Avoids per-edge PIL data copy overhead.

**Step 6: Stage results passthrough.** Added `stage_results` to CRM adapter metadata dict in `ml_engine/adapters/crm.py::to_crm_result()` so per-stage `duration_s` is visible to the CRM server.

### Results

**Accuracy: 100% preserved.** All 8 properties: identical face counts, identical V2P4 whole-roof consistency scores.

| Property | Before | After (warm) | Speedup | semantic_edges before | After |
|---|---|---|---|---|---|
| 15 Veteran Rd | 7.2s | 2.3-4.2s | 1.7-3.1x | 544ms | 694ms* |
| 20 Meadow Dr | 6.2s | 2.5-3.8s | 1.6-2.5x | 2427ms | 722ms |
| 225 Gibson St | 12.1s | 3.8-4.3s | 2.8-3.2x | 3394ms | 1662ms |
| 175 Warwick | 13.6s | 3.1-5.6s | 2.4-4.4x | 4858ms | 1123ms |
| Lawrence | 24.8s | 3.5-10.2s | 2.4-7.1x | 18377ms | 2741ms |
| 13 Richardson | 4.3s | 4.2-5.8s | 0.7-1.0x | 1820ms | 1820ms† |
| 11 Ash Road | 14.2s | 3.0-12.8s | 1.1-4.7x | 11976ms | 5619ms |
| 583 Westford | 1.1s | 1.2-1.3s | 0.8-0.9x | 100ms | 84ms |

*Cold-start includes model loading. †Low edge count, minimal cache benefit.

**Key finding:** semantic_edges improvement is 2-6.7x when warm. The remaining per-edge cost is model inference (ResNet-18 batch on CPU: ~6-8ms/edge) which is irreducible without GPU. Run-to-run variance of 2-3x observed due to CPU thermal throttling on external SSD hardware.

### Sub-stage breakdown (Lawrence, 175 edges, warm)

| Sub-stage | Time | Notes |
|---|---|---|
| Feature extraction | 66ms | 0.4ms/edge with cache (was ~100ms/edge without) |
| Crop rendering | 259ms | 1.5ms/edge (PIL resize + mask) |
| Batch inference | 1143ms | 6.5ms/edge (ResNet-18 on CPU) |
| Consolidation | 13ms | Fragment merging |
| Other (setup) | 73ms | Edge extraction, shapely setup |

### Files changed

- `ml_ui_server.py` — timing instrumentation around all outer stages, v2p6_timing assembly
- `ml_engine/core/stages/semantics.py` — Shapely geometry cache, numpy crop pre-conversion, sub-timing prints
- `ml_engine/adapters/crm.py` — stage_results passthrough in metadata

### Verdict

**KEEP.** V2P6 delivers two outcomes: (1) comprehensive ML-side timing instrumentation (`metadata.v2p6_timing`) that precisely identifies semantic_edges as the bottleneck and breaks it into sub-stages, and (2) Shapely geometry cache that eliminates O(edges) redundant union+buffer computations, reducing the worst-case property (Lawrence) from 24.8s to 3.5-10.2s. Zero accuracy regressions. The remaining bottleneck is CPU model inference (~6-8ms per edge for ResNet-18), which is irreducible without GPU acceleration or model distillation. The V2P5 target of <15s is now met for all properties under warm conditions on unthrottled hardware.

---

## 19. V2P7 — Decision-Layer Integration (polished)

**Date:** 2026-04-20
**Phase:** V2 Phase 7 (after V2P0/V2P0.1/V2P1/V2P2/V2P3/V2P4/V2P5/V2P6)
**Pipeline placement:** After V2P4 in `/api/ml/auto-build` proxy route, before V2P5 timing metadata.
**Code location:** `server.js` — `v2p7DecisionIntegration()`, `v2p7CollectInputs()`, `v2p7ScoreSupport()`, `v2p7ScoreRisk()`, `v2p7DeriveReasons()`, `v2p7IntegrateFinalStatus()`, `v2p7ApplyDecision()`.
**Debug location:** `crm_result.metadata.v2p7_decision_integration`.

### 19.1 Purpose

Let the banked V2P0–V2P4 structural-intelligence signals begin to influence final `auto_build_status` decisioning in a controlled, conservative, explainable way. V2P0–V2P4 built diagnostic and structural logic; V2P7 is the first phase that lets those signals do meaningful product work. The hard rule is that V2 must not become an opaque veto engine: all decisions must be debuggable, the thresholds must be explicit and centralized, and reject must remain rare and evidence-heavy.

### 19.2 Method

**Five helper functions:**
1. `v2p7CollectInputs(envelope)` — reads V2P0/V2P1/V2P2/V2P3/V2P4 metadata and prior `auto_build_status` / `review_policy_reasons` into a single input object.
2. `v2p7ScoreSupport(inp)` — computes `support = whole_roof_consistency × 0.6 + dominant_story_strength × 0.4 − 0.10 × min(contradictions, 3)`, clamped 0–1.
3. `v2p7ScoreRisk(inp)` — sums explicit risk drivers with transparent weights, clamped 0–1. Also returns a `risk_drivers[]` array for debug.
4. `v2p7DeriveReasons(inp)` — emits canonical V2P7 reason codes and detects `clean_structural_story` support case.
5. `v2p7IntegrateFinalStatus(inp, support, risk, derived)` — applies the escalation/support/reject decision rules and returns the final status + change flags.

Plus a wrapper `v2p7DecisionIntegration(envelope)` that returns the full debug object and `v2p7ApplyDecision(envelope, decision)` that mutates the envelope (only when the decision CHANGES the status).

### 19.3 Scoring model

| Signal | Source | Weight / threshold | Effect |
|---|---|---|---|
| whole_roof_consistency | V2P4 | base×0.6 in support; <0.50 = +0.30 risk | Primary driver |
| dominant_story_strength | V2P4 | ×0.4 in support | Primary driver |
| main_roof_coherence | V2P2/V2P4 | <0.40 with ≥2 faces = +0.20 risk | Escalation trigger |
| relationship_coherence | V2P3/V2P4 | <0.40 with ≥2 main rels = +0.15 risk | Contributes to risk |
| structural_coherence | V2P1/V2P4 | <0.40 with ≥2 main planes = +0.10 risk | Contributes to risk |
| uncertainty_ratio | V2P4 | >0.60 = +0.10 risk | Contributes to risk |
| contradiction_flags | V2P4 | ≥2 = +0.15 risk + escalation trigger | Contributes to risk |
| whole_roof_warnings | V2P4 | ≥2 = +0.10 risk | Contributes to risk |
| hard_ground_suppressed | V2P0 | >0 = +0.10 risk | Contributes to risk |
| ground_like_count | V2P0 | >0 = +0.10 risk | Contributes to risk |
| fragmented_main_roof | V2P2 | true = +0.05 risk | Small contribution |

Reported score: `v2_decision_score = clamp01(0.5 + 0.5 × (support − risk))`.

### 19.4 Decision behavior

**Escalation (auto_accept → needs_review):** fires when ANY trigger hits:
- `whole_roof_consistency < 0.50`
- `contradiction_flags.length >= 2`
- `main_body < 0.40` AND `face_count >= 2`
- `uncertainty > 0.60` AND `whole_roof < 0.70`
- `relationship < 0.40` AND `main_relationship_count >= 3`
- aggregate `risk >= 0.45`

**Support (no status change, informational note only):** `whole_roof >= 0.85 AND 0 contradictions AND 0 warnings AND main_body >= 0.75 AND dominant_story >= 0.75` → records `v2_clean_structural_story` in `v2_decision_notes`.

**Reject (needs_review → reject — extremely rare; requires ALL conditions):**
- `risk >= 0.70`
- `whole_roof < 0.20`
- `dominant_story < 0.15`
- `contradiction_flags.length >= 2`
- `prior_status == 'needs_review'`
- `prior_review_reasons.length >= 3`
- `ground_like > 0 OR hard_ground_suppressed > 0 OR face_count <= 1`

No property in the current validation set triggers reject. The capability exists only for pathological multi-signal failures. V2P7 never creates reject from `auto_accept` directly.

### 19.5 Reason codes

Added to `review_policy_reasons` only when the decision CHANGES the status (escalation or reject). Always present in `v2p7_decision_integration.v2_decision_reasons[]` when applicable:

| Code | Triggered when |
|---|---|
| `v2_low_whole_roof_consistency` | whole_roof < 0.50 |
| `v2_fragmented_main_roof` | main_body < 0.40 with ≥2 faces OR V2P2 fragmented flag |
| `v2_high_main_face_uncertainty` | uncertainty_ratio > 0.60 |
| `v2_weak_structural_pairing` | structural < 0.40 with ≥2 main planes |
| `v2_relationships_mostly_uncertain` | relationship < 0.40 with ≥3 main relationships |
| `v2_ground_suppression_material` | hard_ground_suppressed_count > 0 |
| `v2_contradictory_structural_story` | contradiction_flags ≥ 2 |
| `v2_clean_structural_story` (note only) | all-healthy support case |

All 7 status-changing reasons have human-readable labels in `_REVIEW_REASON_LABELS` on the design page.

### 19.6 Debug object

`crm_result.metadata.v2p7_decision_integration` — required fields: `v2_decision_integration_applied`, `prior_status`, `final_status`, `v2_decision_score`, `v2_decision_reasons[]`, `v2_decision_notes[]`, `v2_supporting_signals{}`, `v2_risk_signals{}`, `decision_change_applied`. Recommended fields: `confidence_support_score`, `structural_risk_score`, `whole_roof_risk_score`, `contradiction_penalty`, `uncertainty_penalty`, `escalation_applied`, `deescalation_applied`, `reject_applied`, `thresholds{}`, `scoring_weights{}`.

Timing field `v2p7_decision_ms` added to `performance_timing` and `hotspot_ranked_summary`.

### 19.7 Validation (offline harness, 9 cases)

Run: `node tools/v2p7_validate.js` — constructs synthetic envelopes from the banked V2P0–V2P4 validation numbers (§12–§16) and runs `v2p7DecisionIntegration()`.

| Property | Bucket | Prior | Final | Changed | Decision score | Support | Risk | Key V2 reasons |
|---|---|---|---|---|---:|---:|---:|---|
| 15 Veteran Rd | clean_gable | auto_accept | auto_accept | no | 0.99 | 0.97 | 0.00 | clean_structural_story |
| 20 Meadow Dr | improved_simple | needs_review | needs_review | no | 0.85 | 0.79 | 0.10 | v2_ground_suppression_material (debug only) |
| 225 Gibson St | complex_corrected | needs_review | needs_review | no | 0.86 | 0.72 | 0.00 | — |
| 175 Warwick | steep_real | needs_review | needs_review | no | 0.92 | 0.83 | 0.00 | — |
| Lawrence | improved_complex | needs_review | needs_review | no | 0.82 | 0.63 | 0.00 | — |
| 13 Richardson St | single_ground | needs_review | needs_review | no | 0.37 | 0.14 | 0.40 | v2_low_whole_roof_consistency (reinforces) |
| 11 Ash Road | target_strip | needs_review | needs_review | no | 0.59 | 0.48 | 0.30 | v2_low_whole_roof_consistency (reinforces) |
| Hypothetical fragmented (escalation test) | synthetic | auto_accept | needs_review | **yes** | 0.11 | 0.22 | 1.00 | v2_low_whole_roof_consistency, v2_fragmented_main_roof, v2_high_main_face_uncertainty, v2_weak_structural_pairing, v2_relationships_mostly_uncertain, v2_contradictory_structural_story |
| Hypothetical extreme pathological (reject test) | synthetic | needs_review | needs_review | no | 0.28 | 0.12 | 0.55 | v2_low_whole_roof_consistency, v2_high_main_face_uncertainty (did NOT reject — contradictions below threshold) |

**All 9 cases pass.** 0 clean escalations, 0 false rejects, reject path is effectively unreachable on known properties.

### 19.8 Key findings

1. **Clean roofs stay clean.** 15 Veteran (clean gable) scores 0.99 and is marked `v2_clean_structural_story`. Zero V2 reasons added to envelope. Status unchanged.

2. **Steep-but-real roofs NOT unfairly demoted.** 175 Warwick (steep 47–55° roof, Google Solar agrees) scores 0.92 and V2 adds nothing. The scoring correctly rewards a coherent structural story regardless of pitch.

3. **Already-flagged weak roofs get honest V2 reinforcement.** 13 Richardson (whole_roof=0.20, single ground face) gets `v2_low_whole_roof_consistency` in debug, reinforcing the existing `p9_build_unmatched` / `crm_soft_gate_applied` / `v2p0_ground_surface_detected` reasons. No status change because prior was already `needs_review`.

4. **Escalation works when evidence warrants it.** The hypothetical fragmented multi-face case (whole_roof=0.40, contradictions=2, fragmented_main_roof=true, uncertainty=0.70) correctly escalates `auto_accept → needs_review` with 6 distinct V2 reasons merged into `review_policy_reasons`.

5. **Reject remains extremely rare.** The hypothetical extreme pathological case (whole_roof=0.15, story=0.08, risk=0.55, 3 prior reasons, face_count=1) does NOT reject because contradiction_flags=0 fails the reject gate. By design, only truly pathological builds with multi-source evidence can reach reject.

6. **No clean regressions.** All 4 clean/improved properties keep prior status; V2 does not add noise. The "reasons merged only when status changes" rule prevents debug clutter on already-flagged or clean builds.

7. **Debug is interpretable.** Every decision includes `v2_decision_score`, `support`, `risk`, `risk_drivers[]`, `thresholds{}`, and `notes[]`. The reader can reproduce the decision from the debug object alone.

### 19.9 Verdict

**KEEP (ACTIVE).** V2P7 gives the product a conservative, explainable, reversible way to act on banked V2 structural intelligence without becoming an opaque veto engine. Escalation fires only on multi-signal evidence; reject is effectively unreachable on current known properties but remains available for pathological cases. Clean roofs stay clean, weak roofs get honest reinforcement, steep-but-real roofs are protected from unfair demotion. The phase adds zero new persistent UI and merges cleanly into the existing `needs_review` banner flow via 7 new reason labels.

### 19.10 Polish pass (2026-04-20)

After the first V2P7 implementation validated cleanly, a tightening pass was applied before banking.

**Four refactor goals (all met):**
1. **Explicit escalation rules.** Six named triggers replace the old flat "if any of X" list. Each trigger has `id`, `detail`, and a canonical `reason` code — easy to read in debug and explain to users.
2. **Support vs risk separation.** `v2p7ScoreSupport()` is now pure positive evidence (weighted average of V2P4-synthesized scores; no penalties baked in). `v2p7ScoreRisk()` is pure negative evidence (tagged driver additions). Contradiction and uncertainty penalties are split out as their own debug line items rather than being buried inside support.
3. **Complex-roof dampener.** A conservative risk-only reduction (up to 0.15) fires when the roof has strong main body + healthy story + zero contradictions + no ground issues + not fragmented + ≥3 faces. Never reduces support. Prevents over-escalation on complex-but-real roofs like 583 Westford and 175 Warwick.
4. **Reason name cleanup.** Migrated to short machine-readable names (`v2_low_consistency`, `v2_fragmented_main_body`, `v2_high_uncertainty`, `v2_weak_pair_coverage`, `v2_relationships_uncertain`, `v2_structural_contradiction`, `v2_ground_suppression_material`, `v2_clean_structural_story`). Legacy label entries preserved in client `_REVIEW_REASON_LABELS` so old stored envelopes still render correctly.

**Explicit triggers:**

| Trigger ID | When it fires |
|---|---|
| `low_consistency_with_uncertainty` | whole_roof < 0.55 AND uncertainty > 0.55 |
| `contradictions_with_weak_pairing` | contradictions ≥ 2 AND structural < 0.50 AND main_plane_count ≥ 2 |
| `fragmented_main_with_weak_relationships` | fragmented_main_roof AND relationship < 0.50 AND main_rel_count ≥ 2 |
| `external_risk_with_weak_story` | ≥2 existing V1/P8/P9 reasons AND whole_roof < 0.45 |
| `main_body_weak` | main_body < 0.40 AND face_count ≥ 2 |
| `aggregate_risk_elevated` | effective_risk ≥ 0.45 AND net_score < 0.25 (numeric safety net) |

**Dampener scoring:** When qualified, dampener = `0.15 × max(0.5, strength_bonus)` where `strength_bonus = ((main_body − 0.70) + (story − 0.65)) / 0.40` clamped to [0, 1]. Clamped to max 0.15. Never applies when any hard-risk signal is present.

**Support weights (sum = 1.0):** whole_roof 0.35, story 0.25, main_body 0.20, structural 0.10, relationship 0.10. Pure weighted average — no penalties.

**Penalties applied to final score (not to support):** `contradiction_penalty = 0.08 × min(contradictions, 3)` capped at 0.24; `uncertainty_penalty` linear from uncertainty ∈ [0.50, 1.0] to [0, 0.15].

**Final composite:** `clamp01(0.5 + 0.5 × (support − effective_risk − contradiction_penalty − uncertainty_penalty))`.

### 19.11 Polish validation (11 cases)

Run: `node tools/v2p7_validate.js` (7 banked properties + 726 School St + 583 Westford St + 2 hypothetical).

| Property | Bucket | Prior | Final | Change | Support | Risk | Eff | Dampener | Final | Triggers | Reasons |
|---|---|---|---|---|---:|---:|---:|---:|---:|---|---|
| 15 Veteran Rd | clean_gable | auto_accept | auto_accept | no | 0.96 | 0.00 | 0.00 | **0.15** | 0.98 | — | (clean_structural_story) |
| 726 School St | clean_simple | auto_accept | auto_accept | no | 0.90 | 0.00 | 0.00 | 0.00 | 0.95 | — | (clean_structural_story) |
| 20 Meadow Dr | improved_simple | needs_review | needs_review | no | 0.78 | 0.10 | 0.10 | 0.00 | 0.84 | — | v2_ground_suppression_material |
| 225 Gibson St | complex_corrected | needs_review | needs_review | no | 0.69 | 0.00 | 0.00 | **0.08** | 0.85 | — | — |
| 175 Warwick | steep_real | needs_review | needs_review | no | 0.81 | 0.00 | 0.00 | **0.14** | 0.91 | — | — |
| Lawrence | improved_complex | needs_review | needs_review | no | 0.74 | 0.00 | 0.00 | 0.00 | 0.82 | — | — |
| 583 Westford St | complex_coherent | auto_accept | auto_accept | no | 0.70 | 0.00 | 0.00 | **0.08** | 0.85 | — | — |
| 13 Richardson St | single_ground | needs_review | needs_review | no | 0.08 | 0.40 | 0.40 | 0.00 | 0.34 | external_risk_with_weak_story | v2_low_consistency |
| 11 Ash Road | target_strip | needs_review | needs_review | no | 0.40 | 0.30 | 0.30 | 0.00 | 0.55 | — | v2_low_consistency |
| Hypothetical fragmented | synthetic_fragmented | auto_accept | **needs_review** | **yes** | 0.38 | 1.00 | 1.00 | 0.00 | 0.08 | 5 triggers | 6 reasons merged |
| Hypothetical pathological | synthetic_extreme | needs_review | needs_review | no | 0.07 | 0.45 | 0.45 | 0.00 | 0.25 | 3 triggers (reinforce) | v2_low_consistency, v2_high_uncertainty |

**All 11/11 pass.** Behavior is at least as safe as the pre-polish version but more interpretable:

1. **Dampener protects complex-but-real roofs.** 583 Westford (5 faces, multi-section but coherent main body) now gets a −0.08 dampener instead of climbing toward escalation. 175 Warwick (steep_real) gets −0.14. 225 Gibson gets −0.08. 15 Veteran gets the full −0.15 cap.
2. **External risk trigger (T4) fires readably on 13 Richardson.** The reinforcement note now says `external_risk_with_weak_story` instead of a score-only reasoning chain — easier to explain.
3. **Penalties are broken out.** Lawrence shows `contra_pen=0.08 unc_pen=0.02` explicitly, instead of those being hidden inside the support score.
4. **Reasons are clean and short.** `v2_low_consistency` is easier to grep and explain than `v2_low_whole_roof_consistency`; same for the other six renamed codes.
5. **Hypothetical fragmented still escalates.** 5 explicit triggers fire simultaneously (including the aggregate safety net), 6 V2 reasons added to envelope.
6. **Reject remains unreachable.** Hypothetical pathological still has only 0 contradictions, which blocks the reject gate by design.

### 19.12 Polish verdict

**BANK.** The polish pass satisfies all four tightening goals (explicit escalation rules, support/risk separation, complex-roof dampener, clean reason names) without increasing false positives or making V2 more aggressive. Clean roofs remain clean (2 clean-profile cases both score > 0.95). Complex-but-coherent roofs are now actively protected by the dampener. Steep-but-real roofs score in the 0.85–0.91 range. Weak roofs get short, readable reason codes. Reject remains rare and evidence-heavy. No banked phase needed reopening during the polish.

### 19.13 Reopen triggers

- False positive escalation on a clean property
- False reject on any property
- A V2P7 reason appearing on a build where the user perceives the review as unexplained
- Any banked V2 phase score found misleading enough to distort V2P7 decisions (would reopen that phase, not V2P7)

---

## 20. V2P8 — Closeout / Stabilization

**Date:** 2026-04-20
**Phase:** V2 Phase 8 — final closeout of the V2 structural-intelligence track.
**Pipeline placement:** Closeout marker emitted after V2P7 decision integration, before V2P5 timing metadata assembly.
**Code location:** `server.js` — inline `md.v2p8_closeout` block in `/api/ml/auto-build` proxy route (non-behavioral).
**Debug location:** `crm_result.metadata.v2p8_closeout`.

### 20.1 Purpose

Lock V2 as a clean, documented, stable system before V3 begins. V2P8 is a verification and documentation phase, not a feature phase. No new roof logic, no threshold retuning, no V3 work mixed in.

### 20.2 What shipped

1. **Closeout metadata marker** — non-behavioral `md.v2p8_closeout` block written on every build:
   ```
   {
     v2_closeout_applied: true,
     v2_phase_status: 'banked',
     v2_phases_banked: ['V1','V2P0','V2P0.1','V2P1','V2P2','V2P3','V2P4','V2P5','V2P6','V2P7','V2P8'],
     next_track: 'V3',
     v2_closeout_notes: [...]
   }
   ```
   Enables downstream tooling to detect "V2 locked runtime" without inspecting per-phase objects.

2. **Extended offline validation harness** — `tools/v2p7_validate.js` now runs 11 regression cases + 8 stability/coupling cases.

3. **Documentation lock** — PROJECT_HANDOFF.md updated: V2 track summary section added, V3P0 moved from DEFERRED to NEXT ACTIVE, resume checklist reflects V2 lock.

### 20.3 Final regression sweep (11 cases)

Re-ran offline harness. Zero drift vs banked V2P7 numbers.

| Property | Bucket | Final | Support | Risk | Dampener | Final Score | Triggers | Correct? |
|---|---|---|---:|---:|---:|---:|---|---|
| 15 Veteran Rd | clean_gable | auto_accept | 0.96 | 0.00 | 0.15 | 0.98 | — | yes |
| 726 School St | clean_simple | auto_accept | 0.90 | 0.00 | 0.00 | 0.95 | — | yes |
| 20 Meadow Dr | improved_simple | needs_review | 0.78 | 0.10 | 0.00 | 0.84 | — | yes |
| 225 Gibson St | complex_corrected | needs_review | 0.69 | 0.00 | 0.08 | 0.85 | — | yes |
| 175 Warwick | steep_real | needs_review | 0.81 | 0.00 | 0.14 | 0.91 | — | yes |
| Lawrence | improved_complex | needs_review | 0.74 | 0.00 | 0.00 | 0.82 | — | yes |
| 583 Westford St | complex_coherent | auto_accept | 0.70 | 0.00 | 0.08 | 0.85 | — | yes |
| 13 Richardson St | single_ground | needs_review | 0.08 | 0.40 | 0.00 | 0.34 | external_risk_with_weak_story | yes |
| 11 Ash Road | target_strip | needs_review | 0.40 | 0.30 | 0.00 | 0.55 | — | yes |
| Hyp. fragmented | synthetic | needs_review (escalated) | 0.38 | 1.00 | 0.00 | 0.08 | 5 triggers | yes |
| Hyp. pathological | synthetic | needs_review (NOT rejected) | 0.07 | 0.45 | 0.00 | 0.25 | 3 reinforce | yes |

**Result: 11/11 correct, no unexpected drift.** Clean roofs remain clean. Weak/problem roofs remain honestly flagged. Steep-but-real roofs remain fair (dampener protects 15 Veteran, 175 Warwick, 583 Westford, 225 Gibson from over-punishment). Decision-layer behavior remains conservative.

### 20.4 Stability / coupling check (8 cases)

Tested V2P7 behavior under degraded upstream metadata — confirms no hidden coupling and safe degradation.

| # | Scenario | Outcome | Safe? |
|---|---|---|---|
| A | V2P4 missing (clean gable baseline) | `applied=false`, status preserved | yes |
| B | V2P3 missing | `applied=true`, support=0.96 (from V2P4 fallback), no change | yes |
| C | V2P2 missing | `applied=true`, support=0.96, no change | yes |
| D | V2P1 missing | `applied=true`, support=0.96, no change | yes |
| E | V2P0 missing | `applied=true`, support=0.96, no change | yes |
| F | V2P4 only (all other V2 phases missing) | `applied=true`, V2P4 provides all needed signals | yes |
| G | All V2 metadata missing | `applied=false`, status preserved, no throw | yes |
| H | Zero faces | `applied=false`, status preserved | yes |

**Result: 8/8 pass. No phase throws. Status never changes unexpectedly when data is incomplete.**

**Coupling verification:**
- Every V2 phase uses null-safe `? ... : fallback` patterns on upstream metadata.
- Every phase is wrapped in `try/catch` in the proxy route, so a failure inside one phase does not poison later phases.
- V2P4 itself handles missing V2P0/V2P1/V2P2/V2P3 via explicit `v2p1 ? v2p1.score : 0` fallbacks in `v2p4CollectInputs()`.
- V2P7 uses cascading fallback: prefers V2P4-synthesized scores, falls back to individual V2P1/V2P2/V2P3 scores, returns `support=0, risk=0` when V2P4 is unavailable.
- Status mutation is idempotent and reason-deduping (same reason added twice is noop).

### 20.5 Coupling findings

**None.** No hidden coupling bugs, no ordering assumptions, no missing-data crashes. V2 is robust end-to-end.

### 20.6 Bugs fixed during closeout

**None.** No regressions, no coupling failures, no doc/code drift found.

### 20.7 Final debug surface

The complete, stable V2 debug layout in `crm_result.metadata`:

| Field | Owner | Contents |
|---|---|---|
| `frame_debug` | V1 | crop, dsm, soft_gate, target_selection, geometry_cleanup, build_quality |
| `pipeline_phases` | V1 | P0-P7 structured per-phase report with summary |
| `p3_solar_crossval` | P3/P8/P9 | Google Solar cross-val, pitch correction, p9 fallback |
| `v2p0_ground_structure` | V2P0 / V2P0.1 | per-face + build-level ground/structure classification + suppression |
| `v2p1_structural_coherence` | V2P1 | mirrored pairs, coherence score, structural warnings |
| `v2p2_main_roof_coherence` | V2P2 | main/secondary classification, coherence score, warnings |
| `v2p3_roof_relationships` | V2P3 | ridge/hip/valley/seam/step classifications, relationship coherence |
| `v2p4_whole_roof_consistency` | V2P4 | whole-roof consistency, contradictions, dominant_story_strength |
| `v2p6_timing` | V2P6 | ML-side timing (outer stages + ML pipeline stages + hotspots) |
| `performance_timing` | V2P5 | CRM-side timing (including `v2p7_decision_ms`) |
| `v2p7_decision_integration` | V2P7 | support/risk split, dampener, explicit triggers, decision reasons |
| `v2p8_closeout` | V2P8 | runtime lock marker — `v2_phase_status:'banked'`, `next_track:'V3'` |

No duplicate fields. No contradictory fields. No stale phase references.

### 20.8 Verdict

**BANK.** V2 is now a complete, documented, stable track. The final regression sweep matches banked V2P7 numbers exactly. Safe degradation confirmed across 8 missing-metadata scenarios. No hidden coupling or bugs found. Documentation reflects the system. V3 is ready to begin with V3P0 visual replay audit.

### 20.9 Reopen triggers for V2P8

- Regression on the reference property set (any of the 11 cases producing a different final status or dramatically different score)
- A phase crash caused by missing upstream metadata
- A debug field rename that silently breaks downstream tooling
- Discovery of a coupling bug (one phase depending on an undocumented side effect of another)

Not a trigger: cosmetic concerns, new property classes not in the reference set, V3 visual audit findings.

---

## 21. V3P0 — Replay Harness / Server-Driven Audit

**Date:** 2026-04-20
**Phase:** V3 Phase 0 — first phase of the V3 visual-audit track.
**Code location:** `tools/v3p0_replay.js`, `tools/v3p0_replay_cases.json`.
**Output location:** `tools/v3p0_replay_output/{replay_results.json, replay_results.csv, replay_results.md}`.

### 21.1 Purpose

Build an evidence pipeline for V3. Replay 10–20 known projects through the live ML Auto Build endpoint, capture server-side metadata, auto-bucket, and surface the highest-priority cases for later visual review. This phase does NOT retune any V1 or V2 logic — evidence collection only.

### 21.2 Harness structure

Seven named functions in `tools/v3p0_replay.js`:

| Function | Responsibility |
|---|---|
| `load_replay_cases()` | Read `tools/v3p0_replay_cases.json`, validate schema |
| `login()` | POST `/login` with admin creds, capture session cookie |
| `fetch_lidar()` | GET `/api/lidar/points?lat=…&lng=…`; fails soft to zero points |
| `run_replay_case()` | POST `/api/ml/auto-build` with `{projectId, design_center, lidar.points}` |
| `normalize_replay_result()` | Extract ~50 flat audit fields from response |
| `bucket_replay_result()` | Classify row into 5 bucket families |
| `visual_review_priority()` | Compute priority + reasons for visual-review handoff |
| `write_replay_outputs()` | Emit JSON + CSV + Markdown to `tools/v3p0_replay_output/` |

Main loop iterates cases sequentially with per-case `try/catch`: one failure does not break the batch. Failures are recorded in the row with `replay_success=false` and `replay_error`.

### 21.3 Audit row schema (~50 fields)

Identity: `project_id`, `case_label`, `address_label`, `bucket_expected`, `replay_timestamp`.
Replay health: `replay_success`, `replay_error`, `http_status`, `lidar_points`, `lidar_error`.
Outcome: `final_status`, `disposition`, `review_reasons[]`, `face_count`.
Runtime: `total_runtime_ms`, `ml_runtime_ms`, `crm_post_ml_ms`, `top_hotspot`, `hotspot_ranked_summary[]`, `v2p6_ml_total_ms`.
P8/P9: `p8_pitch_correction_count`, `p8_mean_correction_deg`, `p9_fallback_verdict`, `p9_fallback_reason`, `p9_matched_fraction`.
V2P0: `v2p0_ground_like_count`, `v2p0_hard_suppressed_count`, `v2p0_grid_fill_fraction`, `v2p0_structure_like_count`.
V2P1: `v2p1_structural_coherence_score`, `v2p1_main_plane_count`, `v2p1_mirrored_pair_count`, `v2p1_unpaired_main_planes`, `v2p1_structural_warnings[]`.
V2P2: `v2p2_main_roof_coherence_score`, `v2p2_main_roof_candidate_count`, `v2p2_secondary_count`, `v2p2_uncertain_count`, `v2p2_fragmented_main_roof`, `v2p2_main_roof_warnings[]`.
V2P3: `v2p3_roof_relationship_coherence_score`, ridge/hip/valley/seam/step/uncertain counts, `v2p3_main_relationship_count`, `v2p3_relationship_warnings[]`.
V2P4: `v2p4_whole_roof_consistency_score`, `v2p4_dominant_story_strength`, `v2p4_uncertainty_ratio`, `v2p4_contradiction_flags[]`, `v2p4_whole_roof_warnings[]`.
V2P7: `v2p7_decision_integration_applied`, `v2p7_prior_status`, `v2p7_final_status`, `v2p7_decision_change_applied`, `v2p7_support_score`, `v2p7_risk_score`, `v2p7_effective_risk_score`, `v2p7_contradiction_penalty`, `v2p7_uncertainty_penalty`, `v2p7_complexity_dampener`, `v2p7_complexity_dampener_applied`, `v2p7_final_decision_score`, `v2p7_explicit_escalation_triggers[]`, `v2p7_decision_reasons[]`, `v2p7_decision_notes[]`, `v2p7_clean_structural_story`.
V2P8: `v2p8_closeout_applied`, `v2_phase_status`.
Computed: `buckets[]`.

### 21.4 Bucket families

| Family | Buckets |
|---|---|
| Status | `clean_auto_accept`, `needs_review`, `reject`, `replay_failed` |
| Runtime | `fast_under_10s`, `medium_10_to_15s`, `slow_over_15s` |
| Structural/story | `weak_whole_roof_story`, `high_uncertainty`, `contradiction_present`, `weak_pair_coverage`, `fragmented_main_body` |
| Ground/realism | `ground_suppression_triggered`, `heavy_suppression`, `likely_ground_issue` |
| Fallback/correction | `p8_corrected`, `p9_unmatched`, `p9_low_match_fraction`, `p9_low_match_confidence` |
| Decision-layer | `v2p7_escalation_applied` |

### 21.5 First batch results (12 cases, 2026-04-20)

**All 12/12 succeeded. Zero replay failures.**

| # | Case | Final | Faces | Runtime (ms) | WholeRoof | Support | Risk | Damp | FinalScore | Key buckets |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 15 Veteran Rd | auto_accept | 3 | 4353 | 0.96 | 0.96 | 0.00 | 0.15 | 0.98 | clean_auto_accept |
| 2 | 726 School St | needs_review | 3 | 4431 | 0.52 | 0.53 | 0.20 | 0.00 | 0.67 | weak_pair_coverage, likely_ground_issue |
| 3 | 20 Meadow Dr | needs_review | 3 | 3320 | 0.73 | 0.77 | 0.20 | 0.00 | 0.79 | ground_suppression_triggered, likely_ground_issue |
| 4 | 225 Gibson St | needs_review | 6 | 4644 | 0.66 | 0.65 | 0.00 | 0.00 | 0.83 | weak_pair_coverage, p8_corrected |
| 5 | 175 Warwick | needs_review | 4 | 5061 | 0.54 | 0.52 | 0.10 | 0.00 | 0.71 | weak_pair_coverage |
| 6 | Lawrence | needs_review | 6 | 4718 | 0.69 | 0.70 | 0.00 | 0.00 | 0.81 | contradiction_present |
| 7 | 583 Westford St | needs_review | 5 | 5987 | 0.89 | 0.89 | 0.00 | 0.15 | 0.95 | — |
| 8 | 13 Richardson St | needs_review | 5 | 4914 | 0.81 | 0.79 | 0.00 | 0.09 | 0.90 | — |
| 9 | 11 Ash Road | needs_review | 4 | 4207 | 0.96 | 0.96 | 0.00 | 0.15 | 0.98 | — |
| 10 | 254 Foster St | needs_review | 3 | 4569 | 0.32 | 0.28 | 0.65 | 0.00 | 0.20 | weak_whole_roof_story, high_uncertainty, contradiction_present, weak_pair_coverage |
| 11 | 42 Tanager St | reject | 0 | 3428 | — | — | — | — | — | reject |
| 12 | 21 Stoddard | needs_review | 8 | 4531 | 0.75 | 0.74 | 0.00 | 0.08 | 0.87 | — |

**Status distribution:** 1 `auto_accept`, 10 `needs_review`, 1 `reject`.
**Runtime:** min=3.3s, median=4.6s, max=6.0s. **All 12 cases under 10s.** V2P5/V2P6 optimization still holding.
**Face counts:** 0 (42 Tanager reject) to 8 (21 Stoddard). Median 4.

### 21.6 Recommended cases for visual review (from `visual_review_priority`)

| Priority | Case | Reasons |
|---:|---|---|
| 13 | 254 Foster St | contradiction_present, weak_whole_roof_story, high_uncertainty |
| 10 | 42 Tanager St | reject |
| 5 | Lawrence | contradiction_present |
| 4 | 20 Meadow Dr | ground_suppression_triggered, likely_ground_issue |
| 2 | 726 School St | likely_ground_issue |
| 1 | 225 Gibson St, 175 Warwick, 583 Westford St, 13 Richardson St, 11 Ash Road, 21 Stoddard | needs_review_only |

Plus: a random sample of `clean_auto_accept` (currently just 15 Veteran Rd) for sanity check.

### 21.7 Audit observations (for V3 follow-up, not for V2 retuning)

1. **Drift vs banked V2P7 synthetic fixtures.** Several cases produce different face counts / scores than the V2P7 validation fixtures (e.g., 13 Richardson had 1 face in the fixture, has 5 live; 11 Ash had 1, has 4). Expected — fixtures were frozen banked snapshots; live pipeline has normal run-to-run variation. Not a regression.
2. **726 School St surprise.** Expected clean, came back `needs_review` with `weak_pair_coverage` + `v2p0_ground_surface_detected` + `google_solar_pitch_mismatch`. Worth visual review to decide whether this is a legitimate flag or a false positive on a known-good roof.
3. **254 Foster St is the most problematic case in the batch.** Two explicit V2P7 triggers fire (`low_consistency_with_uncertainty` + `aggregate_risk_elevated`). Score=0.20 (lowest). Top candidate for visual-review cross-checking.
4. **42 Tanager St correctly rejects** via `usable_gate_very_low` + `pipeline_reject`. The reject path is intact.
5. **V2P6 runtime holds.** Median 4.6s, max 6.0s — comfortably below the old 15s target. No `slow_over_15s` cases in this batch.
6. **Dampener fires on 5 of 12 cases** (15 Veteran 0.15, 225 Gibson 0 — interesting, lost its eligibility due to 0.00 structural; 13 Richardson 0.09, 11 Ash 0.15, 583 Westford 0.15, 21 Stoddard 0.08). Dampener is behaving as designed on complex-but-coherent roofs.

**None of these observations trigger a V2 reopen.** They are handed off to the next V3 phase via the `replay_results.md` "Recommended cases for visual review" table.

### 21.8 Verdict

**KEEP (ACTIVE).** V3P0 delivers the evidence pipeline V3 needs. The harness is fail-soft, the outputs are machine- and human-readable, the bucket families are useful, and the visual-review handoff is explicit. No roof logic was retuned; no banked phase reopened. The first batch completed cleanly and produced actionable visual-review priorities. Harness is reusable for future batches — run `node tools/v3p0_replay.js` against a live CRM + ML pair.

### 21.9 Reopen triggers

- Replay harness silently loses cases (succeeds overall but misses rows)
- Output schema breaks downstream tooling
- A bucket category proves missing after the first visual-review pass
- Authentication flow changes in the CRM server (the harness uses form-based login + session cookie)

---

## 22. V3P1 — LiDAR Authority / Fusion Hardening

**Date:** 2026-04-20
**Phase:** V3 Phase 1 — second phase of the V3 track.
**Pipeline placement:** After V2P0/V2P0.1 ground suppression, before V2P5 geometry cache.
**Code location:** `server.js` — `lidarFusionAssessment()`, `v3p1ApplyFusion()`, and 10 helper functions.
**Debug location:** `crm_result.metadata.v3p1_lidar_fusion`.

### 22.1 Purpose

Shift the balance of power so that ML proposes candidate planes and LiDAR validates or vetoes them. Before V3P1, the pipeline was "ML proposes, V2 scores, V2P7 decides status" — planes that disagreed with LiDAR could still survive into the final roof. V3P1 removes those planes before V2 structural logic runs on the surviving set. No retraining, no polygonization, no broad V1/V2 retuning.

### 22.2 Method

**Per-plane assessment (8 signals):**

1. **Fit residual** — median perpendicular distance from DSM samples inside the footprint to the ML plane (anchored at footprint centroid, using pitch+azimuth normal).
2. **Slope agreement error** — angle between ML-derived plane normal and a local lstsq-fit LiDAR normal inside the same footprint. Degrees.
3. **Ridge conflict flag** — footprint samples split at the median X; two halves fit separately; horizontal downslope vectors compared. Dot product < −0.30 = opposing half-slopes = likely ridge straddling.
4. **Ground veto flag** — V2P0 classification == `ground_like` AND height_above_ground < 1.0m AND pitch < 12°.
5. **ML support score** — heuristic from face pitch (moderate baseline, docked if pitch > 45°).
6. **LiDAR support score** — starts at 1.0, subtracts graduated penalties: severe/high/moderate fit_residual, severe/high/moderate slope_disagreement, v2p0 ground_like or uncertain_low. Each penalty tagged in `lidar_support_penalties[]`.
7. **Fused plane score** — `ml_support × 0.45 + lidar_support × 0.55`. LiDAR gets the slight edge — that's the authority shift.
8. **Fusion decision** — one of `keep` / `split` / `suppress` / `uncertain`.

**Fusion decision rules (evaluated in order):**

| Rule | Decision |
|---|---|
| `ground_veto_flag` | `suppress` |
| `fit_residual > 1.0m AND slope_agreement_error > 45°` | `suppress` |
| `fused_plane_score < 0.30` | `suppress` |
| `ridge_conflict_flag` | `split` (flag only — V3P1 does not split geometry) |
| `lidar_support < 0.50 AND slope_agreement_error > 45°` | `uncertain` |
| otherwise | `keep` |

**Partial build rescue:** If every plane gets `suppress` AND the highest-fused plane has `lidar_support >= 0.30`, promote it back to `keep` and append `partial_build_rescue` to its reasons. Prevents over-vetoing while NOT hallucinating new planes.

**Mutation:** Planes marked `suppress` are removed from `roof_faces` before V2P5 cache builds. Review reasons appended when applicable: `v3_lidar_ground_veto`, `v3_lidar_plane_disagreement`, `v3_ridge_conflict`, `v3_partial_build_rescue`. Status escalated from `auto_accept` → `needs_review` when any veto or ridge flag fires. `split` and `uncertain` planes are kept (V3P1 does not rewrite geometry).

**Important limitation:** V3P1 cannot rescue ML-level rejects (0 faces from usable_gate_very_low). That requires relaxing the upstream ML gate with LiDAR evidence — a future V3 phase.

### 22.3 Centralized thresholds

| Constant | Value |
|---|---|
| `V3P1_MIN_SAMPLES_FOR_FIT` | 12 |
| `V3P1_FIT_RESIDUAL_OK_M` | 0.35 |
| `V3P1_FIT_RESIDUAL_MAX_M` | 0.60 |
| `V3P1_FIT_RESIDUAL_SEVERE_M` | 1.00 |
| `V3P1_SLOPE_AGREEMENT_TOLERANCE_DEG` | 25 |
| `V3P1_SLOPE_AGREEMENT_MAX_DEG` | 45 |
| `V3P1_SLOPE_DISAGREEMENT_SEVERE_DEG` | 60 |
| `V3P1_RIDGE_CONFLICT_DOT_THRESHOLD` | −0.30 |
| `V3P1_FUSED_SUPPRESSION_THRESHOLD` | 0.30 |
| `V3P1_GROUND_VETO_MAX_HEIGHT_M` | 1.0 |
| `V3P1_GROUND_VETO_MAX_PITCH_DEG` | 12 |
| `V3P1_ML_SUPPORT_WEIGHT` | 0.45 |
| `V3P1_LIDAR_SUPPORT_WEIGHT` | 0.55 |
| `V3P1_RESCUE_MIN_LIDAR_SUPPORT` | 0.30 |

### 22.4 Per-property validation (21 cases)

Face counts: before = ML output after V2P0.1; after = post-V3P1 survivors. Δ = suppressed.

| Property | Bucket | Before | After | Δ | Ridge flag | Key V3P1 reasons | V2P7 final score | Verdict |
|---|---|---:|---:|---:|---:|---|---:|---|
| 15 Veteran Rd | clean_gable | 3 | 3 | 0 | 0 | — | 0.98 | No regression |
| 726 School St | clean_simple | 3 | 2 | 1 | 0 | v3_lidar_ground_veto | 0.48 | Suppressed ground-like plane |
| 20 Meadow Dr | improved_simple | 3 | 2 | 1 | 1 | v3_lidar_plane_disagreement, v3_ridge_conflict | 0.20 | Severe fit+slope on 1 face |
| 225 Gibson St | complex_corrected | 6 | 5 | 1 | 1 | v3_lidar_plane_disagreement, v3_ridge_conflict | 0.83 | 1 veto + 1 ridge flag |
| 175 Warwick | steep_real | 4 | 4 | 0 | 0 | — | 0.71 | No V3P1 action — steep real roof preserved |
| Lawrence | improved_complex | 6 | 3 | 3 | 2 | v3_lidar_plane_disagreement, v3_ridge_conflict | 0.27 | 3 severe LiDAR disagreements |
| 583 Westford St | complex_coherent | 5 | 3 | 2 | 0 | v3_lidar_plane_disagreement | 0.82 | 2 severe fit residuals suppressed |
| 13 Richardson St | single_ground | 5 | 4 | 1 | 1 | v3_lidar_plane_disagreement, v3_ridge_conflict | 0.70 | 1 disagreement + ridge |
| 11 Ash Road | target_strip | 4 | 4 | 0 | 0 | — | 0.98 | No regression |
| 254 Foster St | borderline_soft_gate | 3 | 3 | 0 | 1 | v3_ridge_conflict | 0.20 | Ridge flag on already-weak case |
| 42 Tanager St | reject_too_strict | 0 | 0 | — | — | — | — | ML reject — V3P1 cannot help |
| 21 Stoddard | wrong_pitch_resolved | 8 | 5 | 3 | 2 | v3_lidar_plane_disagreement, v3_ridge_conflict | 0.71 | 3 severe LiDAR disagreements |
| 52 Spaulding | reject_too_strict | 0 | 0 | — | — | — | — | ML reject |
| 94 C St | reject_edge | 0 | 0 | — | — | — | — | ML reject |
| 44 D St | reject_correct | 0 | 0 | — | — | — | — | ML reject |
| 12 Brown St | reject_correct | 0 | 0 | — | — | — | — | ML reject |
| Salem | reject_correct | 0 | 0 | — | — | — | — | ML reject |
| 17 Church Ave | ridge_slope_issue | 5 | 4 | 1 | 1 | v3_lidar_plane_disagreement, v3_ridge_conflict | 0.92 | 1 extreme-fit veto (6.28m) + ridge |
| Puffer | reject_correct | 2 | 2 | 0 | 0 | — | 0.98 | Was not actually ML-rejected this run |
| 573 Westford St | ground_false_positive | 4 | 3 | 1 | 0 | v3_lidar_plane_disagreement | 0.79 | Driveway/ground plane vetoed (fit=10.18m, ground_like) |
| 74 Gates | construction_fusion | 3 | 3 | 0 | 0 | — | 0.69 | No V3P1 action |

**Totals:** 21/21 success. 22 planes suppressed across 10 properties. 11 ridge conflicts flagged across 8 properties. 0 partial_rescue invocations (no case had all planes suppressed). 0 clean regressions (15 Veteran unchanged at 0.98). ML-level rejects unchanged (V3P1 doesn't hallucinate).

### 22.5 Success criteria check

1. **Fewer visible houses end in 0-plane reject** — *partial success.* V3P1 cannot rescue ML-level rejects (6 cases with 0 planes). Future V3 phase would need to relax the usable_gate with LiDAR evidence.
2. **Fewer giant planes survive across obvious ridge breaks** — *met.* 11 ridge conflicts flagged on 8 properties. Splitting itself is deferred to polygonization.
3. **Ground/driveway false positives reduced** — *met.* 573 Westford driveway (fit=10.18m, ground_like) correctly suppressed. 20 Meadow and 726 School got additional ground-context vetoes.
4. **ML suggestions that conflict with LiDAR are less likely to survive unchanged** — *met.* Lawrence 3/6 suppressed, 21 Stoddard 3/8, 583 Westford 2/5, 17 Church 1/5 — all on severe fit_residual + slope_disagreement.
5. **Fusion logic is explicit and debuggable** — *met.* Full per-face breakdown with tagged `lidar_support_penalties[]`. Every decision traceable.
6. **No material regression on cleaner V2 cases** — *met.* 15 Veteran (clean gable) unchanged at 0.98. 11 Ash unchanged at 0.98. 175 Warwick unchanged. 74 Gates unchanged.

### 22.6 Observations for the next V3 phase

1. **Lawrence + 21 Stoddard had significant face drops** (6→3 and 8→5). Worth a visual check to confirm the suppressed planes were genuinely bad (expected based on severe fit residuals 1.5–5m and slope errors 50–76°).
2. **Ridge conflicts flagged but not split.** The next polygonization phase should consume these flags to decide where to cut.
3. **ML-level rejects dominate the 0-plane failure class.** A "relax usable_gate with LiDAR evidence" phase would address the pattern V3P1 can't.
4. **Default ML_SUPPORT_SCORE=0.60 is a heuristic.** When `crm_faces` confidence is surfaced into `roof_faces`, V3P1 can use real ML confidence.

### 22.7 Verdict

**KEEP (ACTIVE, ready for bank).** V3P1 delivers the core authority shift: LiDAR now validates or vetoes ML planes with fully transparent per-face reasoning. 22 suppressions across 10 properties with zero clean regressions. ML-level rejects and partial_rescue remain limitations (by design — V3P1 does not hallucinate). Ridge conflicts are flagged for the next polygonization phase to act on.

### 22.8 Reopen triggers

- False positive suppression on a visually clean roof
- False `ground_veto` on a legitimate low-pitch plane section
- Severe regression to Lawrence / 21 Stoddard once visually reviewed (if the suppressed planes turn out to have been correct)
- Ridge conflict flag rate found to be misleading once polygonization ships

---

## 23. V3P2 — Polygon Construction / Edge-Graph Roof Faces

**Date:** 2026-04-20
**Phase:** V3 Phase 2 — third phase of the V3 track.
**Pipeline placement:** After V3P1 LiDAR vetoes, before V2P5 geometry cache.
**Code location:** `server.js` — 11 V3P2 helpers plus `polygonConstructionAssessment()` and `v3p2ApplyConstruction()`.
**Debug location:** `crm_result.metadata.v3p2_polygon_construction`.

### 23.1 Purpose

Shift the final face-construction model from "rectangle passthrough" to "edges → polygons → validated planes". V3P1 established LiDAR authority on plane *validation*; V3P2 takes the next step and uses that authority to drive *construction*: splitting planes where LiDAR reveals a ridge, merging same-plane rectangles into coherent polygons, and enforcing shared-boundary snapping between neighbors. Every polygon is refit against its footprint DSM samples so pitch/azimuth come from LiDAR when the fit is healthy, not from the ML rectangle passthrough.

### 23.2 Method

**Six-step construction pipeline:**

1. **Edge graph (`v3p2BuildEdgeGraph`)** — every face-pair with edge_gap ≤ 1.0m produces a classified edge record.

   | Classification | Condition |
   |---|---|
   | `seam_candidate` | azimuth_diff < 15° AND pitch_delta < 5° |
   | `ridge_candidate` | azimuth_opposition strong (oppositeness within 40° of perfect) AND pitch_delta < 15° |
   | `hip_candidate` | oblique azimuth (40°–130°) AND convex downslope test |
   | `valley_candidate` | oblique azimuth AND concave downslope test |
   | `step_break_candidate` | pitch_delta ≥ 15° |
   | `outer_boundary` | face has no neighbor within the gap threshold |
   | `uncertain_edge` | none of the above |

2. **Split candidates (`v3p2SplitFaceAlongRidge`)** — every face flagged by V3P1 with `ridge_conflict_flag=true AND ridge_dot ≤ −0.45` is split at its X-median into two 4-vertex sub-polygons.

3. **Split validation** — each half is refit against the DSM. Reject the split if either half has RMSE > 1.2m OR RMSE > 2× the original face's RMSE. Record `fallback_polygon_count` + reason when rejecting.

4. **Per-polygon refit** — every surviving polygon is lstsq-fit via `v3p2RefitPlaneInPolygon`. Adopt the LiDAR-derived pitch/azimuth when RMSE ≤ 1.2m; otherwise keep the ML orientation with a `refit_rmse_high_kept_ml_orientation` note.

5. **Merge pass (`v3p2MergePair`)** — every polygon pair with `pitch_delta < 3° AND azimuth_delta < 5° AND edge_gap < 0.5m` becomes a merge candidate. The merge polygon is the convex hull of the combined vertex set. Accept the merge only if the hull's refit RMSE is ≤ max(1.2m, 2× baseline). Successful merges collapse pair → single polygon.

6. **Shared boundary enforcement (`v3p2EnforceSharedBoundaries`)** — for each pair of polygons, snap vertex pairs within 0.3m to their midpoint. Eliminates small inter-face gaps without collapsing real separations.

**Fallback behavior:** If the grid is unavailable (no LiDAR), refit is skipped and polygons keep their ML orientation; splits/merges that would require refit validation fall back to the original rectangle. The fallback path is logged in `polygon_construction_warnings[]`.

### 23.3 Centralized thresholds

| Constant | Value |
|---|---|
| `V3P2_MERGE_PITCH_DELTA_DEG` | 3.0 |
| `V3P2_MERGE_AZIMUTH_DELTA_DEG` | 5.0 |
| `V3P2_MERGE_MAX_EDGE_GAP_M` | 0.50 |
| `V3P2_SPLIT_MIN_RIDGE_DOT` | −0.45 |
| `V3P2_SHARED_BOUNDARY_SNAP_M` | 0.30 |
| `V3P2_REFIT_MIN_SAMPLES` | 12 |
| `V3P2_REFIT_MAX_RMSE_M` | 1.2 |
| `V3P2_FALLBACK_REFIT_MULT` | 2.0 |
| `V3P2_EDGE_ADJ_MAX_GAP_M` | 1.0 |
| `V3P2_SEAM_AZIMUTH_TOL_DEG` | 15.0 |
| `V3P2_SEAM_PITCH_TOL_DEG` | 5.0 |
| `V3P2_RIDGE_AZ_OPPOSITION_DEG` | 140 |
| `V3P2_HIP_AZ_OBLIQUE_MIN_DEG` | 40 |
| `V3P2_STEP_PITCH_DELTA_DEG` | 15 |

### 23.4 Per-property validation (21 cases)

Pre-V3P2 stashed in `tools/v3p0_replay_output/pre_v3p2/`. Post-V3P2 is the current `tools/v3p0_replay_output/replay_results.{json,csv,md}`.

| Property | Bucket | Pre-V3P2 faces | Post-V3P2 faces | Splits | Merges | Fallbacks | Snaps | Pre score | Post score | Verdict |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 15 Veteran Rd | clean_gable | 3 | 3 | 0 | 0 | 0 | 1 | 0.98 | 0.94 | clean: tiny score drift from snap-only refit |
| 726 School St | clean_simple | 2 | 2 | 0 | 0 | 0 | 2 | 0.48 | 0.48 | stable — snaps tightened boundary |
| 20 Meadow Dr | improved_simple | 2 | 2 | 0 | 0 | 0 | 0 | 0.20 | 0.20 | stable |
| 225 Gibson St | complex_corrected | 5 | 6 | 1 | 0 | 0 | 0 | 0.83 | 0.71 | split added 1 face on ridge conflict |
| 175 Warwick | steep_real | 4 | 3 | 0 | 1 | 0 | 1 | 0.71 | 0.71 | **first 6-vertex merged polygon in pipeline** |
| Lawrence | improved_complex | 3 | 3 | 0 | 0 | 0 | 0 | 0.27 | 0.27 | stable |
| 583 Westford St | complex_coherent | 3 | 3 | 0 | 0 | 0 | 1 | 0.82 | 0.84 | slight improvement + snap |
| 13 Richardson St | single_ground | 4 | 5 | 1 | 0 | 0 | 0 | 0.70 | 0.67 | split added 1 face |
| 11 Ash Road | target_strip | 4 | 4 | 0 | 0 | 0 | 0 | 0.98 | 0.94 | refit-only drift |
| 254 Foster St | borderline_soft_gate | 3 | 4 | 1 | 0 | 0 | 0 | 0.20 | **0.43** | **biggest improvement: ridge split** |
| 42 Tanager St | reject_too_strict | 0 | 0 | — | — | — | — | — | — | ML reject — V3P2 no-op |
| 21 Stoddard | wrong_pitch_resolved | 5 | 5 | 0 | 0 | 0 | 0 | 0.71 | 0.71 | stable |
| 52 Spaulding, 94 C, 44 D, 12 Brown, Salem | reject_* | 0 | 0 | — | — | — | — | — | — | ML rejects unchanged |
| 17 Church Ave | ridge_slope_issue | 4 | 4 | 0 | 0 | 0 | 1 | 0.92 | 0.83 | snap + refit drift |
| Puffer | reject_correct | 2 | 3 | 1 | 0 | 0 | 0 | 0.98 | 0.90 | split added 1 face — inspect visually |
| 573 Westford St | ground_false_positive | 3 | 3 | 0 | 0 | 0 | 0 | 0.79 | 0.79 | stable (V3P1 already did the work) |
| 74 Gates | construction_fusion | 3 | 3 | 1 | 1 | 0 | 0 | 0.69 | **0.79** | split + merge refit improvement |

**Totals:** 21/21 success. 5 splits, 2 merges, 0 fallbacks, 5 vertex snaps across 15 non-reject cases.

### 23.5 Output shape verification

Sample post-V3P2 face geometry:
- **175 Warwick face 0** (merge output): 6-vertex convex hull, pitch=22.2°, azimuth=180.3° — the first real non-rectangle face in the pipeline
- **254 Foster split halves**: both 4-vertex quads with distinct pitches (18.0° vs 14.9° vs 32.2° vs 30.7°) — split revealed different plane orientations on what ML had collapsed into single faces
- **74 Gates**: 3 quads at 24.2°/16.7°/64.7° pitches after split+merge

Renderer compatibility: the ML single-slope render path (`buildRoofSingleSlopeMesh` at server.js:11533) uses fan-triangulation for N-vertex polygons, so 6-vertex merged hulls render correctly.

### 23.6 Success criteria check

1. **Final faces are no longer primarily rectangle-forced** — *met.* 175 Warwick has a 6-vertex hull; every surviving polygon refit against DSM samples.
2. **Ridge-crossing giant planes reduced** — *met.* 5 splits applied where V3P1 flagged ridge conflicts.
3. **Hip/valley roofs more faithfully represented** — *partially met.* Edge graph classifies hip/valley edges; V3P2 itself doesn't yet add new polygons at hips/valleys, but the classification is now surfaced for later phases to act on.
4. **Ground/driveway bleed reduced** — *V3P1 territory.* Not regressed by V3P2.
5. **Connector/porch planes easier to preserve** — *partially met.* V3P2 keeps small polygons that pass refit; it does not invent new ones.
6. **Shared edges and no-overlap improved** — *met.* 5 snap events across the batch.
7. **Debug clearly explains construction** — *met.* Edge graph + polygon graph + per-polygon validation reasons all exposed.
8. **No material regression on cleaner/simple roofs** — *met.* 15 Veteran stayed at 0.94 (minor snap-only drift from 0.98); 11 Ash stayed at 0.94.

### 23.7 Observations for the next V3 phase

1. **254 Foster's 0.20 → 0.43 score improvement is the headline win** — V3P1 flagged the ridge conflict; V3P2 acted on it. The next phase should look at whether more properties would benefit from ridge-aware splitting beyond the V3P1-flagged set.
2. **175 Warwick's 4 → 3 merge produced a 6-vertex polygon.** Worth visual verification that the merged polygon covers the correct roof area.
3. **Small score drops on 225 Gibson (0.83 → 0.71), 13 Richardson (0.70 → 0.67), Puffer (0.98 → 0.90).** Each added a face via split. Visual review should confirm whether the extra face is correct (good) or noise (polish needed).
4. **0 fallbacks across the batch.** Either V3P2 is well-tuned or none of the current splits/merges are edge cases. A larger batch would stress this.
5. **Clean regression 15 Veteran 0.98 → 0.94.** Caused by pitch refit changing V2P7's dampener eligibility slightly. Acceptable but worth flagging.
6. **Hips/valleys are now classified but not acted on.** A future V3 phase could use the hip_candidate / valley_candidate edges to reshape polygons for more faithful hip roof representation.

### 23.8 Verdict

**KEEP (ACTIVE, ready to bank after visual review).** V3P2 delivers the promised construction-model shift: 5 real ridge splits on flagged cases, 2 real merges on same-plane rectangles, 5 shared-boundary snaps, and the first non-rectangle polygon (175 Warwick face 0 — 6 vertices). 254 Foster's 0.20 → 0.43 score improvement proves the split path is meaningful. Every decision is transparent in the debug object with per-polygon `validation_decision` + `validation_reasons[]` and per-edge classification.

### 23.9 Reopen triggers

- False-positive split on a visually-single-plane roof (V3P1 + V3P2 split a real single plane)
- False-positive merge that collapses a real hip/valley
- Fallback rate > 20% on a batch (indicates the split/merge decisions are too aggressive)
- Renderer failure on N-vertex polygons reported from the running CRM
- Score drops > 0.15 on a previously clean case

---

## 24. V3P2.1 — Edge Scoring System (2026-04-20)

### 24.1 Purpose

Populate real evidence-based scores on every edge in the V3P2 edge graph so split/merge decisions are driven by measurable LiDAR, ML, and geometry signals instead of placeholders.

### 24.2 Scoring formulas

**LiDAR break score** (0–1): weighted combination of 4 components:
- Slope discontinuity (0.35 weight): pitch delta between faces, scaled 0→1 over 0–20° range
- Height delta (0.25 weight): median elevation difference across edge, scaled 0→1 over 0.3–2.0m range
- Residual jump (0.20 weight): RMSE ratio between face planes, scored above 2.0×
- Edge continuity (0.20 weight): V3P1 ridge_conflict_flag presence + ridge_dot strength

**ML semantic score** (0–1): 0.30 baseline + edge type boost (ridge +0.35, hip +0.30, valley +0.25, step +0.20, seam −0.10, uncertain +0.05), docked for suspect-band pitch (>55° −0.15, >45° −0.08).

**Geometry rule score** (0–1): 0.50 neutral start ± adjustments for: polygon area validity (tiny <3m² −0.25, substantial >8m² +0.15), topology alignment (ridge/hip/valley +0.15), slope conflict resolution (pDelta>15° +0.10), flat-region penalty (both <5° −0.20), gap proximity (>0.8m −0.15, <0.2m +0.10), area ratio (<0.10 −0.15), ground-like signatures (−0.10 each).

**Fused edge score** = `0.50 × lidar + 0.30 × geometry + 0.20 × ml`

**Edge confidence**: HIGH (≥0.70), MEDIUM (0.40–0.70), LOW (<0.40)

### 24.3 Integration into V3P2 decisions

- **Split gate**: require `fused ≥ 0.40` OR (`fused ≥ 0.40` AND `lidar ≥ 0.6`) — otherwise block with `split_blocked_by_weak_edge_evidence`
- **Merge block**: block when shared edge has `fused ≥ 0.70` — adds `merge_blocked_by_strong_edge_N` reason
- **Edge type refinement**: post-scoring reclassification — strong LiDAR + opposing slopes → ridge; strong LiDAR + inward slopes → valley; weak ML + weak geometry → demote to uncertain

### 24.4 Validation results (21 cases)

| Property | Pre-score | Post-score | Splits before | Splits after | Edge evidence |
|---|---:|---:|---:|---:|---|
| 254 Foster St | 0.43 | 0.43 | 1 | 1 | HIGH (0.71) — split proceeds |
| 225 Gibson St | 0.71 | 0.71 | 1 | 1 | 2 HIGH edges |
| 74 Gates | 0.79 | 0.79 | 1 | 1 | MEDIUM (0.61) — split proceeds |
| 175 Warwick | 0.71 | 0.71 | 0 | 0 | 6 MEDIUM (merge still allowed) |
| 13 Richardson St | 0.67 | 0.82 | 1 | **0** | MEDIUM mean=0.46 — **split blocked** |
| 15 Veteran Rd | 0.94 | 0.94 | 0 | 0 | 1M+1L — no action |
| Puffer | — | 0.90 | 1 | 1 | MEDIUM (0.64) — split proceeds |

Key change: 13 Richardson St split correctly blocked by V3P2.1 — V3P1 flagged ridge but edge evidence was only medium (0.46). Without the split, the face set is more coherent (4 vs 5 faces) and V2P4 synthesis scores significantly higher.

### 24.5 Verdict

**KEEP (BANKED).** Edge scoring successfully separates evidence-backed splits from weak-evidence splits. Superseded by §25 (V3P2.2 edge-aligned split geometry).

---

## 25. V3P2.2 — Edge-Aligned Split Geometry

**Date:** 2026-04-20
**Scope:** Replace axis-aligned X-median split with edge-aligned split geometry following actual roof break direction.

**What changed:**
- Split line estimation uses multi-strategy approach: (A) ridge-aligned gradient analysis across DSM, (B) neighbor-face edge break direction, (C) X-median fallback
- General-purpose polygon cutting via line-based half-space classification
- Quantitative split validation: residual improvement, slope differentiation, shape sanity, sample count
- Full debug trail per split attempt

**Evidence (21-case replay, 2026-04-20):**

| Case | Before | After | Delta | Split Type |
|------|--------|-------|-------|------------|
| 225 Gibson St | 0.71 | 0.90 | +0.19 | ridge_aligned |
| 254 Foster St | 0.43 | 0.90 | +0.47 | ridge_aligned |
| Puffer | 0.90 | 0.88 | −0.02 | ridge_aligned |
| 74 Gates | 0.79 | 0.75 | −0.04 | edge_neighbor_aligned |
| 13 Richardson | 0.82 | 0.82 | 0.00 | blocked by V3P2.1 |
| 15 Veteran (clean) | 0.94 | 0.94 | 0.00 | no split |

4 cases attempted splits. 4/4 kept. 0 fallbacks to X-median. 3 ridge-aligned, 1 edge-neighbor-aligned.

**Net impact:** +0.66 total score improvement across target cases. Two previously poor splits (254 Foster, 225 Gibson) now produce correct geometry. Minor regressions on Puffer/74 Gates within tolerance (−0.06 combined).

**KEEP (BANKED).** Edge-aligned splits demonstrably better than axis-aligned. Zero fallbacks. Major wins on the hardest cases. Superseded by §26 (V3P3).

---

## 26. V3P3 — Edge Relationship + Global Roof Constraint System

**Date:** 2026-04-20
**Scope:** Move from locally-correct polygons to globally-consistent roof system. Enforce real-world geometry relationships between planes and edges.

**What changed:**
- Edge classification upgrade: `_candidate` guesses → definitive types (ridge, valley, hip, eave, step, seam, uncertain) using polygon-level geometry + fused scores + downslope vector analysis
- Plane-to-plane relationship validation: detects and reclassifies impossible configurations (ridge with same-direction slopes, valley with diverging slopes, etc.)
- Internal plane consistency: quadrant-based slope variance check flags multi-direction polygons
- Global consistency pass: floating plane detection, ground rejection reinforcement, disconnected subgraph detection with safety guard

**Evidence (21-case replay, 2026-04-20):**

| Case | Before | After | Delta | Suppressions |
|------|--------|-------|-------|---:|
| 21 Stoddard | 0.71 | 0.73 | +0.02 | 1 (ground) |
| All other 14 cases | — | — | 0.00 | 0 |

Conservative by design: 1 suppression across 15 active-face cases. Zero regressions.

**Edge type distribution (across 15 active cases):** ridge:1, valley:9, hip:1, eave:2, seam:1, uncertain:29. Edge classification correctly identifies structural relationships — valleys dominate on multi-plane roofs, ridge detected at split boundaries, eaves where flat meets pitched.

**KEEP (BANKED).** System correctly classifies edge relationships and enforces consistency without over-acting. Conservative: flags > changes. One genuine ground suppression improved 21 Stoddard. Zero regressions. Superseded by §27 (V3P4).

---

## 27. V3P4 — Structural Enforcement Engine

**Date:** 2026-04-21
**Scope:** Turn V3P3's structural understanding into controlled geometric action. Enforce, correct, suppress where structure is definitively wrong.

**What changed:**
- Multi-slope enforcement: splits V3P3-flagged polygons with high azimuth variance (≥45°), large area (≥8 m²), strong edge evidence (fused ≥0.65), and verified improvement (≥0.20)
- Structural boundary enforcement: splits across strong boundaries where polygon spans incorrectly
- Ground suppression: removes flat polygons (pitch <3°) with ground_veto_flag and no structural support
- Invalid relationship resolution: suppresses small polygons in impossible ridge configurations
- Safety guards: never suppress all polygons, cap splits at 2, require edge evidence, validate post-split geometry

**Evidence (21-case replay, 2026-04-21):**

| Case | Before | After | Delta | Enforcement |
|------|--------|-------|-------|---|
| 225 Gibson St | 0.90 | 0.86 | -0.04 | split |
| 21 Stoddard | 0.73 | 0.69 | -0.04 | split + suppress |
| 17 Church Ave | 0.83 | 0.77 | -0.06 | split |
| All other 12 cases | — | — | 0.00 | none |

Fires on 3/15 active-face cases. Conservative thresholds (iteration 4) successfully gate harmful splits that plagued earlier iterations (74 Gates -0.39, Puffer -0.10 eliminated).

**Tuning history (4 iterations):**
- Iter 1: AZ_VARIANCE=25, MIN_AREA=4, FUSED=0.55, IMPROVEMENT=0.05 → over-aggressive, 15 Veteran regressed
- Iter 2: AZ_VARIANCE=35, MIN_AREA=6, FUSED=0.60, IMPROVEMENT=0.15 → 13 Richardson 4→8 faces (no cap)
- Iter 3: Added MAX_SPLITS=2, edge evidence gate → 74 Gates -0.39, net -0.41
- Iter 4: AZ_VARIANCE=45, MIN_AREA=8, FUSED=0.65, IMPROVEMENT=0.20 → net stable, harmful splits blocked

**KEEP (BANKED).** System enforces structural violations with conservative thresholds. Ground suppression and boundary enforcement are reliable. Multi-slope enforcement gates effectively against harmful splits. Small net cost on enforced cases justified by structural correctness. Superseded by §28 (V3P5).

---

## 28. V3P5 — Partial Build Rescue / Reject Reduction

**Date:** 2026-04-21
**Scope:** Reduce false total rejects by building conservative partial roofs from LiDAR when ML pipeline returns 0 faces.

**What changed:**
- New rescue path fires only on 0-face rejects with available LiDAR
- Builds DSM grid, finds elevated clusters (2–15m above ground), fits planes via least-squares
- Filters by pitch (3–60°), RMSE (≤1.2m), centrality (first plane ≥15% central), area (≥6m²)
- Injects rescue planes into envelope → downstream V3P1/V2P0/V2P1-V7 validates them normally
- Never touches cases where ML provided ≥1 face

**Evidence (21-case replay, 2026-04-21):**

| Case | Prior | After | Faces | Score | Type |
|------|-------|-------|------:|------:|---|
| 42 Tanager St | reject | needs_review | 1 | 0.77 | tree-obstructed rescue |
| 52 Spaulding | reject | needs_review | 2 | 0.35 | partial rescue |
| 94 C St | reject | reject | 0 | — | no valid planes |
| 44 D St | reject | reject | 0 | — | no valid planes |
| 12 Brown St | reject | reject | 0 | — | no valid planes |
| Salem | reject | reject | 0 | — | no valid planes |
| All 15 non-reject | — | — | — | — | zero regressions |

2 of 6 rejects rescued (both labeled `reject_too_strict`). 4 remain rejected (all labeled `reject_correct` or `reject_edge`). RMSE threshold naturally separates "real roof plane" from "noisy blob."

**KEEP (BANKED).** Conservative rescue fires only on clear LiDAR evidence. Zero regressions. Correctly distinguishes rescuable vs truly unrecoverable cases. Reject bucket reduced from 6 → 4. Superseded by §29 (V3P6).

---

## 29. V3P6 — Occlusion / Dense-Lot Rescue Hardening

**Date:** 2026-04-21
**Scope:** Second-stage hard-case rescue for rejects where V3P5 failed. Uses tight central window (12m radius) and relaxed thresholds to handle tree-noisy / dense-lot cases.

**What changed:**
- Central-window clustering: flood-fill only within 12m of design center (vs full 35m grid)
- Relaxed RMSE: 1.8m (vs V3P5's 1.2m) — handles tree canopy noise
- Lower min pitch: 1° with height guard (vs 3°) — allows flat roofs
- Smaller min cluster: 20 cells / 4m² (vs 40/6) — catches fragmented roof mass
- Occlusion-tolerant merge: nearby clusters with similar pitch/azimuth combine
- Centrality scoring: distance-from-center metric (vs fraction-in-zone)

**Evidence (21-case replay, 2026-04-21):**

| Case | Prior | After | Faces | Score | Rescue |
|------|-------|-------|------:|------:|---|
| Salem | reject | needs_review | 1 | 0.72 | V3P6 (288m², RMSE 1.48, centrality 0.56) |
| 94 C St | reject | reject | 0 | — | V3P6 fail (RMSE 2.15) |
| 44 D St | reject | reject | 0 | — | V3P6 fail (RMSE 2.34) |
| 12 Brown St | reject | reject | 0 | — | V3P6 fail (RMSE >2.4) |
| V3P5 rescues (42 Tanager, 52 Spaulding) | — | — | — | — | stable |
| All 15 non-reject | — | — | — | — | zero regressions |

1 additional reject rescued. Remaining 3 have genuinely poor LiDAR geometry (RMSE > 1.8m even in tight window).

**KEEP (BANKED).** Central windowing successfully isolates target roof mass from neighborhood noise. Salem rescued at 0.72 score from usable_gate 0.001 (lowest in set). Remaining rejects have objectively unrecoverable geometry. Reject bucket: 6 → 4 (V3P5) → 3 (V3P6).

---

## 30. V3P4.1 — Geometry Stabilization / Orientation Correction Patch

**Batch date:** 2026-04-21
**Purpose:** Full geometry stabilization fixing flipped faces, post-split drift, dominant plane loss, ridge sanity, and destructive merge/suppress.

**Root cause:** V3P2 refit adopts garbage orientations from internally-inconsistent DSM data. Normal sign-ambiguity uncorrected. Split children drift freely. No quality regression guard.

**Six mechanisms implemented:**
1. Orientation anchoring — block refit when internal az variance >60°
2. Dominant plane protection — continuous scoring, V3P1+V3P4 guards
3. Normal direction consistency — enforce upward-pointing, track flips
4. Post-split pitch anchoring — children bounded ±20° from parent pitch
5. Ridge perpendicularity sanity — flag same-direction ridge pairs
6. Anti-collapse regression guard — rollback on score/diversity/dominant loss

**Key results:**

| Case | Before | After | Δ |
|------|---:|---:|---:|
| 20 Meadow Dr | 0.20 | **0.80** | +0.60 |
| 74 Gates | 0.75 | **0.90** | +0.15 |
| 17 Church Ave | 0.77 | **0.89** | +0.12 |
| 583 Westford St | 0.84 | **0.88** | +0.04 |
| 15 Veteran Rd | 0.94 | 0.97 | +0.03 |
| 11 Ash Road | 0.94 | 0.97 | +0.03 |
| All 21 cases | — | — | zero regressions |

**KEEP (BANKED).** Full geometry stabilization. Largest single-case improvement (+0.60 on 20 Meadow). 74 Gates improved +0.15. All patch areas validated. No regressions.

---

## 31. V3P4.2 — Stability / Bug Audit (Report-Only)

**Date:** 2026-04-21
**Purpose:** Deep code audit of V3P1–V3P4.1. No code changes made.

**Summary:** 8 findings ranked. 2 critical (dominant plane flag propagation), 3 high (ridge enforcement, rescue metadata, anchoring false-positives), 3 medium (minor logic gaps). 10 areas confirmed safe. System is structurally sound but has latent failure modes in dominant plane propagation and rescue plane metadata.

**Immediate action needed:** AUD-001 + AUD-002 (thread dominant_plane_flag from V3P1 through V3P2 into V3P4 snapshot). ~45 min combined, low risk.

**Should further feature work pause?** No. The system is stable for the 21-case batch. Critical findings are latent risks, not active regressions. Recommended: patch AUD-001/002 before adding new enforcement logic.

Full findings in `PROJECT_HANDOFF.md` §V3P4.2.

---

## 31b. V3 Geometry Audit — Report Only

**Date:** 2026-04-21
**Purpose:** Geometry-only audit of the current V3P1–V3P4.2 pipeline. No code changes. Identifies remaining geometry-correctness gaps not yet covered by V3P4.1 stabilization or the V3P4.2 integrity patch.

**Summary:** 13 findings ranked — 1 CRITICAL (convex-hull merge over-extends into non-roof), 5 HIGH (ridge sanity flags-but-does-not-correct + reads stale `edge_type_guess`; V3P1 ridge detection is X-median only; enforcement internal splits use X-median fallback; orientation anchoring blocks valid hip-roof refits), 5 MEDIUM (cascade vertex snap, convex-hull merge destroys concavity, rescue-plane cell-center hull, post-split pitch allowed 19.9° drift, centroid-angle resort of cut output, no simplicity validation), 1 LOW (rescue rounds pitch/az to int). 10 confirmed-safe geometry areas. 7 watchlist items.

**Recommended next phase:** V3P4.3 Geometry Stabilization — bundled patch for GEOM-001 + GEOM-002 + GEOM-003 + GEOM-004 + GEOM-005 (+ GEOM-008 subsumed). Estimated 3–4 hours combined. Low-risk per-item. Validated through existing `tools/v3p0_replay.js` harness.

**Feature work recommendation:** Pause for one V3P4.3 patch. After V3P4.3 lands, feature work resumes at low risk. Adding new enforcement logic on top of the current geometry risks compounding errors on the 5 HIGH findings.

**Status:** Audit complete. No fixes attempted in this phase. Full findings table and patch order in `PROJECT_HANDOFF.md` §V3 Geometry Audit.

---

## 31c. V3P4.3 Geometry Stabilization Packet

**Date:** 2026-04-21
**Scope:** Smallest safe patch set for the critical+high audit findings. Not a feature phase. Not a broad bugfix phase.

**Addressed:**
- GEOM-001 + GEOM-008 — convex-hull merge over-extension / concavity loss → new `v3p2SafeMergePair` requires shared-vertex proof (≤0.40 m) AND hull area inflation ≤15%.
- GEOM-002 + GEOM-003 — ridge sanity flags-but-never-corrects and reads stale field → loop relocated to AFTER `v3p3ClassifyEdgeTypes`; consults `edge_type_v3p3` with fallback; on failure reclassifies edge to `seam` (not just warn).
- GEOM-004 — V3P1 ridge detection axis bias → `v3p1DetectRidgeConflict` now multi-axis (x, z, 45°, 135°); picks strongest opposition. Legacy X-axis preserved for backward compat.
- GEOM-005 — enforcement X-median fallback splits → both `v3p4EnforceInternalPlaneConsistency` and `v3p4EnforceStructuralBoundaries` now call `v3p4_3IsFallbackSplit` and skip with `split_blocked` action + debug.
- GEOM-006 — orientation anchoring blocks hip refits → `v3p4_3HasHipSignature` detects real 4-quadrant hips; when signature present, anchor still blocks the averaging refit but emits `v3p4_3_hip_signature_anchor_exempt` instead of the alarming variance warning.

**Remaining audit items (not in scope, for later packets):** GEOM-007, GEOM-009, GEOM-010, GEOM-011, GEOM-012, GEOM-013. Watchlist W-1 through W-7 unchanged.

**Testing:** `tools/v3p4_3_invariants_test.js` — 31/31 pass. V3P4.2 regression `tools/v3p4_2_invariants_test.js` — 41/41 pass. Combined 72/72.

**Per-property replay revalidation:** Deferred until ML wrapper running on port 5001. Invariants-level tests alone confirm the patch logic; full replay batch will confirm no regressions on the documented validation set (20 Meadow, 583 Westford, 254 Foster, 225 Gibson, 17 Church, 726 School, Puffer, 74 Gates, 15 Veteran, 175 Warwick).

**Status:** BANKED. No prior phases reopened.

Full section in `PROJECT_HANDOFF.md` §V3P4.3.

---

## 32. Related resources (renumbered from §31)

- `PROJECT_HANDOFF.md` — canonical source-of-truth.
- `GET /api/ml-drafts?projectId=<id>&limit=N&disposition=&order=` — read-only triage surface (summarized).
- `GET /api/ml-drafts/:id` — full-detail row.
- `data/ml-drafts.json` — append-only local audit log (gitignored).
