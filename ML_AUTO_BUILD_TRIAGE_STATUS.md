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

## 8. Related resources

- `PROJECT_HANDOFF.md` — canonical source-of-truth.
- `GET /api/ml-drafts?projectId=<id>&limit=N&disposition=&order=` — read-only triage surface (summarized).
- `GET /api/ml-drafts/:id` — full-detail row.
- `data/ml-drafts.json` — append-only local audit log (gitignored).
