# ML Auto Build — Triage Status

Interim status log for the ML Auto Build ugly-case triage pass. This file is the working record; `PROJECT_HANDOFF.md` remains the canonical source-of-truth.

**Last updated:** 2026-04-17
**Pass status:** Interim — 16 rows locked of 30-property target (53%).
**Not final.** Distribution and leading hypothesis below are provisional.

---

## 1. Interim bucket counts (locked sample)

| Bucket | Count | % of 16 |
|---|---:|---:|
| `wrong_pitch` | 6 | 37.5% |
| `reject_correct` | 4 | 25.0% |
| `ugly_but_correct_building` | 3 | 18.8% |
| `reject_too_strict` | 2 | 12.5% |
| `clean` | 1 | 6.3% |
| `wrong_azimuth` | 0 | 0.0% |
| `gap_overlap` | 0 | 0.0% |
| `wrong_target` | 0 | 0.0% |
| `investigate` | 0 | 0.0% |
| **Total locked** | **16** | — |

Counts are as reported by the operator. Percentages computed from those counts.

---

## 2. Interim conclusions (provisional)

- **Among successful builds, `wrong_pitch` is currently the dominant failure mode** (6 of 10 non-reject rows = 60% of the successful-build subset).
- **Target isolation appears to have moved off the critical path.** `wrong_target` is currently 0 in the locked sample. Earlier sessions' target-isolation refinements (0.3 m primary + 0.15 m subcluster, plus duplicate cleanup) look effective so far.
- **`gap_overlap` is also absent from the locked sample.** Vertex-snapping work (handoff §I.2) is therefore **not** the leading candidate for the next engineering task based on this sample. This may change as the remaining 14 rows come in — multiface and rowhouse categories are under-sampled so far.
- **Reject gate looks roughly calibrated.** 4 `reject_correct` vs 2 `reject_too_strict` (2:1 ratio). Not yet enough signal to retune the 0.20 usable-gate floor. 52 New Spaulding is the clearest `reject_too_strict` reference at usable score ≈ 0.154.

### Leading engineering hypothesis (provisional)

Pitch / plane quality on **successful** builds — i.e., the upstream ML orientation / plane-fit stage — is the most likely highest-ROI next track. Not called as the final winner; requires confirmation with the remaining 14 rows.

---

## 3. Notes worth preserving

- **20 Meadow Dr** — duplicate cleanup improved the result from 7 raw → 5 selected faces, but the roof still renders visually `wrong_pitch`. Cleanup is not a pitch fix.
- Several successful cases are landing on the correct building but still show overly steep / cliff-like / awkward planes — the "ugly successful" pattern predicted by the handoff.
- **726 School St** is the locked sample's one `clean` reference case.
- **44 D St** and **17 Puffer** both look like fair rejects; pair them as `reject_correct` baselines.
- **52 New Spaulding** is the clearest `reject_too_strict` borderline (usable ≈ 0.154). Save as the canonical gate-floor tuning reference.

---

## 4. Unresolved data / mapping issues

### 4.1 94 C St Lowell — duplicate / mismatch with 52 New Spaulding

Recent draft captures show 94 C St appearing to be mismatched or duplicated with 52 New Spaulding in `data/ml-drafts.json`. **94 C St is NOT counted as a locked independent row** in the 16-row sample above. Resolve before including in the final 30.

Possible causes to check:
- Pin moved between two addresses under the same `projectId` without a new design being created.
- `projectId` collision / reuse across addresses.
- Draft id mapping in the triage spreadsheet.

### 4.2 Transcription artifact on one locked bullet

The operator's handoff paste contained one line that merged two rows with a garbled separator (`"—t1 —"`). Two legitimate draft IDs appear on that line:
- `mld_mo37m8z5lagx` — associated with **Salem** (projectId `mnhm2fmoweo`).
- `mld_mo39na4r9jej` — bucket `ugly_but_correct_building` in the paste; **address and projectId were not clearly captured**.

The bucket totals in §1 are authoritative (provided by the operator). Per-row mapping for these two IDs should be confirmed before the 30-row file is locked. Both IDs are preserved in §5 below so they are not lost.

---

## 5. Locked sample rows

Fully-specified rows from the operator's handoff. Order is paste order, not ranking.

| # | Address | projectId | draftId | Bucket |
|---:|---|---|---|---|
| 1 | 20 Meadow Dr | mn9805q0ddm | mld_mo39baa0apgt | wrong_pitch |
| 2 | 225 Gibson St | mnc01zdwiub | mld_mo399basasn6 | wrong_pitch |
| 3 | 583 Westford St Lowell | mnl5omexvfv | mld_mo394qcebmmm | ugly_but_correct_building |
| 4 | Arlington | mno1jikqx5x | mld_mo393sydbvml | reject_too_strict |
| 5 | Brockton | mo22auk85lc | mld_mo39318h06ap | reject_correct |
| 6 | Lawrence | mo22ewvgze7 | mld_mo392ccpmwue | wrong_pitch |
| 7 | 254 Foster St | mnb6yh8q3v2 | mld_mo38w3sioa40 | wrong_pitch |
| 8 | 43 Bellevue | mo39go6y5hx | mld_mo39ojy1z6ij | ugly_but_correct_building |
| 9 | 726 School St | mo39gat1ykm | mld_mo39pd8v5lya | clean |
| 10 | 22 New Spaulding | mo39fzpbdr5 | mld_mo39qbukkgoy | wrong_pitch |
| 11 | 44 D St Lowell | mo39fj4nitp | mld_mo39r61xayrm | reject_correct |
| 12 | 52 New Spaulding St | mo39fahcilm | mld_mo39rx5rgjcu | reject_too_strict |
| 13 | 17 Puffer St Lowell | mo39et102aj | mld_mo39sswphblo | reject_correct |
| 14 | 175 Warwick | mo39ego79gj | mld_mo39tnibjz57 | wrong_pitch |

Plus two rows with partial data, flagged in §4.2:

| # | Address | projectId | draftId | Bucket |
|---:|---|---|---|---|
| 15 | Salem | mnhm2fmoweo | mld_mo37m8z5lagx | *bucket not cleanly captured in paste — reconcile with §1 totals before finalizing* |
| 16 | *(not captured in paste)* | *(not captured)* | mld_mo39na4r9jej | ugly_but_correct_building |

The 16-row totals in §1 remain authoritative and must not be back-edited from this table until §4.2 is resolved.

---

## 6. Next steps

1. **Continue the triage pass to 30 rows.** Do not make engineering changes off the interim sample alone. Focus the remaining 14 rows on under-represented categories: multiface / complex roof (gable+hip, L/T-plan, dormers), urban attached / rowhouse, detached garage lots. These are the categories most likely to surface `gap_overlap` and `wrong_target` if they exist.
2. **Resolve the 94 C St ↔ 52 New Spaulding mismatch.** Confirm which draft belongs to which address before either is counted toward the final 30.
3. **Reconcile the Salem transcription artifact** (see §4.2). Recover the address for draft `mld_mo39na4r9jej` and confirm the bucket for `mld_mo37m8z5lagx` against the §1 totals.
4. **Hold on engineering changes until the 30-row distribution is complete.** If `wrong_pitch` holds its lead at 30 rows, the next engineering track is upstream plane/pitch quality (see `PROJECT_HANDOFF.md` §I). If a different bucket overtakes it, follow that track instead.

---

## 7. Related resources

- `PROJECT_HANDOFF.md` — canonical source-of-truth.
- `GET /api/ml-drafts?projectId=<id>&limit=N` — read-only triage surface.
- `GET /api/ml-drafts/:id` — full-detail row (confidence report, face vertices, keepouts, review_policy).
- `data/ml-drafts.json` — append-only local audit log (gitignored).
