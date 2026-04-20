# V3P0 Replay Results

Generated: 2026-04-20T18:12:53.328Z
Batch size: 21 — succeeded: 21, failed: 0

## Status distribution

| Status | Count |
|---|---:|
| auto_accept | 1 |
| needs_review | 14 |
| reject | 6 |

## Runtime summary

| Metric | ms |
|---|---:|
| min | 2925 |
| median | 4700 |
| mean | 5310 |
| max | 9837 |

## Bucket counts

| Bucket | Count |
|---|---:|
| fast_under_10s | 21 |
| needs_review | 14 |
| weak_pair_coverage | 9 |
| reject | 6 |
| weak_whole_roof_story | 4 |
| likely_ground_issue | 3 |
| ground_suppression_triggered | 2 |
| high_uncertainty | 2 |
| contradiction_present | 2 |
| clean_auto_accept | 1 |
| fragmented_main_body | 1 |
| p8_corrected | 1 |
| heavy_suppression | 1 |

## Per-case summary

| Case | Prior→Final | Faces | Runtime | WholeRoof | Support | Risk | Damp | FinalScore | V2P7 triggers | Reasons / errors |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| 15 Veteran Rd | auto_accept→auto_accept | 3 | 4700 | 0.96 | 0.96 | 0.00 | 0.15 | 0.98 | — | — |
| 726 School St | needs_review→needs_review | 2 | 6968 | 0.48 | 0.46 | 0.50 | 0.00 | 0.48 | aggregate_risk_elevated | v2_low_consistency, v2_weak_pair_coverage, dense_roof_anomaly, majority_planes_need_review, google_solar_pitch_mismatch, v2p0_ground_surface_detected, v3_lidar_ground_veto |
| 20 Meadow Dr | needs_review→needs_review | 2 | 8238 | 0.24 | 0.21 | 0.80 | 0.00 | 0.20 | main_body_weak, aggregate_risk_elevated | v2_low_consistency, v2_fragmented_main_body, v2_weak_pair_coverage, v2_ground_suppression_material, v2p0_ground_surface_detected, v2p0_ground_surface_suppressed, v3_lidar_plane_disagreement, v3_ridge_conflict |
| 225 Gibson St | needs_review→needs_review | 5 | 9837 | 0.65 | 0.65 | 0.00 | 0.08 | 0.83 | — | dense_roof_anomaly, google_solar_pitch_mismatch, google_solar_pitch_corrected, v3_lidar_plane_disagreement, v3_ridge_conflict |
| 175 Warwick | needs_review→needs_review | 4 | 7566 | 0.54 | 0.52 | 0.10 | 0.00 | 0.71 | — | v2_weak_pair_coverage, dense_roof_anomaly, majority_planes_need_review, google_solar_pitch_mismatch |
| Lawrence | needs_review→needs_review | 3 | 4878 | 0.37 | 0.40 | 0.65 | 0.00 | 0.27 | low_consistency_with_uncertainty, contradictions_with_weak_pairing, aggregate_risk_elevated | v2_low_consistency, v2_high_uncertainty, v2_weak_pair_coverage, v2_structural_contradiction, dense_roof_anomaly, v3_lidar_plane_disagreement, v3_ridge_conflict |
| 583 Westford St | needs_review→needs_review | 3 | 4751 | 0.65 | 0.63 | 0.00 | 0.00 | 0.82 | — | dense_roof_anomaly, v3_lidar_plane_disagreement |
| 13 Richardson St | needs_review→needs_review | 4 | 8106 | 0.53 | 0.49 | 0.10 | 0.00 | 0.70 | — | v2_weak_pair_coverage, dense_roof_anomaly, build_tilt_quality_low, v3_lidar_plane_disagreement, v3_ridge_conflict |
| 11 Ash Road | needs_review→needs_review | 4 | 4899 | 0.96 | 0.96 | 0.00 | 0.15 | 0.98 | — | build_tilt_quality_low |
| 254 Foster St | needs_review→needs_review | 3 | 4626 | 0.32 | 0.28 | 0.65 | 0.00 | 0.20 | low_consistency_with_uncertainty, aggregate_risk_elevated | v2_low_consistency, v2_high_uncertainty, v2_weak_pair_coverage, crm_soft_gate_applied, dense_roof_anomaly, majority_planes_need_review, v3_ridge_conflict |
| 42 Tanager St | —→reject | 0 | 3365 | — | — | — | — | — | — | pipeline_reject, usable_gate_very_low |
| 21 Stoddard | needs_review→needs_review | 5 | 4558 | 0.55 | 0.52 | 0.10 | 0.00 | 0.71 | — | v2_weak_pair_coverage, dense_roof_anomaly, v3_lidar_plane_disagreement, v3_ridge_conflict |
| 52 Spaulding | —→reject | 0 | 3129 | — | — | — | — | — | — | pipeline_reject, usable_gate_very_low |
| 94 C St | —→reject | 0 | 2925 | — | — | — | — | — | — | pipeline_reject, usable_gate_very_low |
| 44 D St | —→reject | 0 | 2932 | — | — | — | — | — | — | pipeline_reject, usable_gate_very_low |
| 12 Brown St | —→reject | 0 | 3426 | — | — | — | — | — | — | pipeline_reject, usable_gate_very_low |
| Salem | —→reject | 0 | 4732 | — | — | — | — | — | — | pipeline_reject, usable_gate_very_low |
| 17 Church Ave | needs_review→needs_review | 4 | 4497 | 0.84 | 0.83 | 0.00 | 0.13 | 0.92 | — | usable_gate_low, dense_roof_anomaly, v3_lidar_plane_disagreement, v3_ridge_conflict |
| Puffer | needs_review→needs_review | 2 | 8729 | 0.96 | 0.96 | 0.00 | 0.00 | 0.98 | — | dense_roof_anomaly, majority_planes_need_review, build_tilt_quality_low, v3_lidar_plane_disagreement, v3_ridge_conflict |
| 573 Westford St | needs_review→needs_review | 3 | 4194 | 0.76 | 0.78 | 0.20 | 0.00 | 0.79 | — | v2_ground_suppression_material, v2p0_ground_surface_detected, v2p0_ground_surface_suppressed, v3_lidar_ground_veto |
| 74 Gates | needs_review→needs_review | 3 | 4456 | 0.50 | 0.47 | 0.10 | 0.00 | 0.69 | — | v2_weak_pair_coverage, dense_roof_anomaly, majority_planes_need_review, v3_lidar_plane_disagreement, v3_ridge_conflict |

## Recommended cases for visual review

| Priority | Case | Reasons |
|---:|---|---|
| 13 | 20 Meadow Dr | weak_whole_roof_story, fragmented_main_body, ground_suppression_triggered, likely_ground_issue |
| 13 | Lawrence | contradiction_present, weak_whole_roof_story, high_uncertainty |
| 13 | 254 Foster St | contradiction_present, weak_whole_roof_story, high_uncertainty |
| 10 | 42 Tanager St | reject |
| 10 | 52 Spaulding | reject |
| 10 | 94 C St | reject |
| 10 | 44 D St | reject |
| 10 | 12 Brown St | reject |
| 10 | Salem | reject |
| 8 | 573 Westford St | heavy_suppression, ground_suppression_triggered, likely_ground_issue |
| 7 | 726 School St | weak_whole_roof_story, likely_ground_issue |
| 1 | 225 Gibson St | needs_review_only |
| 1 | 175 Warwick | needs_review_only |
| 1 | 583 Westford St | needs_review_only |
| 1 | 13 Richardson St | needs_review_only |
| 1 | 11 Ash Road | needs_review_only |
| 1 | 21 Stoddard | needs_review_only |
| 1 | 17 Church Ave | needs_review_only |
| 1 | Puffer | needs_review_only |
| 1 | 74 Gates | needs_review_only |

Also include a random sample of `clean_auto_accept` cases for sanity checking.
