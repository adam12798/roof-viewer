# V3P0 Replay Results

Generated: 2026-04-20T15:34:01.966Z
Batch size: 12 — succeeded: 12, failed: 0

## Status distribution

| Status | Count |
|---|---:|
| auto_accept | 1 |
| needs_review | 10 |
| reject | 1 |

## Runtime summary

| Metric | ms |
|---|---:|
| min | 3320 |
| median | 4569 |
| mean | 4514 |
| max | 5987 |

## Bucket counts

| Bucket | Count |
|---|---:|
| fast_under_10s | 12 |
| needs_review | 10 |
| weak_pair_coverage | 4 |
| likely_ground_issue | 2 |
| contradiction_present | 2 |
| clean_auto_accept | 1 |
| ground_suppression_triggered | 1 |
| p8_corrected | 1 |
| weak_whole_roof_story | 1 |
| high_uncertainty | 1 |
| reject | 1 |

## Per-case summary

| Case | Prior→Final | Faces | Runtime | WholeRoof | Support | Risk | Damp | FinalScore | V2P7 triggers | Reasons / errors |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| 15 Veteran Rd | auto_accept→auto_accept | 3 | 4353 | 0.96 | 0.96 | 0.00 | 0.15 | 0.98 | — | — |
| 726 School St | needs_review→needs_review | 3 | 4431 | 0.52 | 0.53 | 0.20 | 0.00 | 0.67 | — | v2_weak_pair_coverage, dense_roof_anomaly, majority_planes_need_review, google_solar_pitch_mismatch, v2p0_ground_surface_detected |
| 20 Meadow Dr | needs_review→needs_review | 3 | 3320 | 0.73 | 0.77 | 0.20 | 0.00 | 0.79 | — | v2_ground_suppression_material, v2p0_ground_surface_detected, v2p0_ground_surface_suppressed |
| 225 Gibson St | needs_review→needs_review | 6 | 4644 | 0.66 | 0.65 | 0.00 | 0.00 | 0.83 | — | dense_roof_anomaly, google_solar_pitch_mismatch, google_solar_pitch_corrected |
| 175 Warwick | needs_review→needs_review | 4 | 5061 | 0.54 | 0.52 | 0.10 | 0.00 | 0.71 | — | v2_weak_pair_coverage, dense_roof_anomaly, majority_planes_need_review, google_solar_pitch_mismatch |
| Lawrence | needs_review→needs_review | 6 | 4718 | 0.69 | 0.70 | 0.00 | 0.00 | 0.81 | — | dense_roof_anomaly |
| 583 Westford St | needs_review→needs_review | 5 | 5987 | 0.89 | 0.89 | 0.00 | 0.15 | 0.95 | — | dense_roof_anomaly |
| 13 Richardson St | needs_review→needs_review | 5 | 4914 | 0.81 | 0.79 | 0.00 | 0.09 | 0.90 | — | dense_roof_anomaly, build_tilt_quality_low |
| 11 Ash Road | needs_review→needs_review | 4 | 4207 | 0.96 | 0.96 | 0.00 | 0.15 | 0.98 | — | build_tilt_quality_low |
| 254 Foster St | needs_review→needs_review | 3 | 4569 | 0.32 | 0.28 | 0.65 | 0.00 | 0.20 | low_consistency_with_uncertainty, aggregate_risk_elevated | v2_low_consistency, v2_high_uncertainty, v2_weak_pair_coverage, crm_soft_gate_applied, dense_roof_anomaly, majority_planes_need_review |
| 42 Tanager St | —→reject | 0 | 3428 | — | — | — | — | — | — | pipeline_reject, usable_gate_very_low |
| 21 Stoddard | needs_review→needs_review | 8 | 4531 | 0.75 | 0.74 | 0.00 | 0.08 | 0.87 | — | dense_roof_anomaly |

## Recommended cases for visual review

| Priority | Case | Reasons |
|---:|---|---|
| 13 | 254 Foster St | contradiction_present, weak_whole_roof_story, high_uncertainty |
| 10 | 42 Tanager St | reject |
| 5 | Lawrence | contradiction_present |
| 4 | 20 Meadow Dr | ground_suppression_triggered, likely_ground_issue |
| 2 | 726 School St | likely_ground_issue |
| 1 | 225 Gibson St | needs_review_only |
| 1 | 175 Warwick | needs_review_only |
| 1 | 583 Westford St | needs_review_only |
| 1 | 13 Richardson St | needs_review_only |
| 1 | 11 Ash Road | needs_review_only |
| 1 | 21 Stoddard | needs_review_only |

Also include a random sample of `clean_auto_accept` cases for sanity checking.
