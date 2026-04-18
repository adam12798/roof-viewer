# ML Auto Build — Triage Status

Status log for the ML Auto Build ugly-case triage pass. This file is the working record; `PROJECT_HANDOFF.md` remains the canonical source-of-truth.

**Last updated:** 2026-04-18
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

### 8.1 How the orientation module works

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
3. **Test 1.0m erosion** — may further improve large-polygon faces; risk of over-eroding small polygons.
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

### 8.6 Alternatives considered

| Alternative | Pros | Cons | Verdict |
|---|---|---|---|
| Two-pass lstsq (inlier refit) | Targeted, ~15 lines, uses existing metrics | Requires engine-core change | **Recommended** |
| Polygon erosion (shrink by 0.5–1m before sampling) | Addresses edge contamination directly | Needs buffer calibration, larger change, reduces sample count | Viable but more complex |
| RANSAC instead of lstsq | Gold-standard robust fit | Much larger change, new dependency, slower | Overkill for now |
| Wrapper tilt cap (cap to 35° when flagged) | No engine change needed | Hack, loses real tilt information, doesn't fix azimuth | Not recommended |
| Tilt correction factor (multiply by 0.7) | Simple | No theoretical basis, varies by property | Not recommended |

---

## 9. Related resources

- `PROJECT_HANDOFF.md` — canonical source-of-truth.
- `GET /api/ml-drafts?projectId=<id>&limit=N&disposition=&order=` — read-only triage surface (summarized).
- `GET /api/ml-drafts/:id` — full-detail row.
- `data/ml-drafts.json` — append-only local audit log (gitignored).
