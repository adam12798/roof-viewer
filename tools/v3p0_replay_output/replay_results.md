# V3P0 Replay Results

Generated: 2026-04-20T18:59:57.916Z
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
| min | 2574 |
| median | 4372 |
| mean | 5066 |
| max | 9349 |

## Bucket counts

| Bucket | Count |
|---|---:|
| fast_under_10s | 21 |
| needs_review | 14 |
| weak_pair_coverage | 10 |
| reject | 6 |
| weak_whole_roof_story | 4 |
| contradiction_present | 4 |
| likely_ground_issue | 3 |
| ground_suppression_triggered | 2 |
| clean_auto_accept | 1 |
| fragmented_main_body | 1 |
| p8_corrected | 1 |
| high_uncertainty | 1 |
| heavy_suppression | 1 |

## Per-case summary

| Case | Prior→Final | Faces | V3P1 in→out veto/ridge | V3P2 sp/mg/fb/sn | Runtime | WholeRoof | FinalScore | V2P7 triggers | Reasons / errors |
|---|---|---:|---|---|---:|---:|---:|---|---|
| 15 Veteran Rd | auto_accept→auto_accept | 3 | 3→3 0/0 | 0/0/0/1 | 4352 | 0.87 | 0.94 | — | — |
| 726 School St | needs_review→needs_review | 2 | 3→2 1/0 | 0/0/0/2 | 7493 | 0.48 | 0.48 | aggregate_risk_elevated | v2_low_consistency, v2_weak_pair_coverage, dense_roof_anomaly, majority_planes_need_review, google_solar_pitch_mismatch, v2p0_ground_surface_detected, v3_lidar_ground_veto |
| 20 Meadow Dr | needs_review→needs_review | 2 | 3→2 1/1 | 0/0/0/0 | 5711 | 0.24 | 0.20 | main_body_weak, aggregate_risk_elevated | v2_low_consistency, v2_fragmented_main_body, v2_weak_pair_coverage, v2_ground_suppression_material, v2p0_ground_surface_detected, v2p0_ground_surface_suppressed, v3_lidar_plane_disagreement, v3_ridge_conflict |
| 225 Gibson St | needs_review→needs_review | 6 | 6→5 1/1 | 1/0/0/0 | 5378 | 0.59 | 0.71 | — | v2_weak_pair_coverage, dense_roof_anomaly, google_solar_pitch_mismatch, google_solar_pitch_corrected, v3_lidar_plane_disagreement, v3_ridge_conflict, v3_polygon_split_applied |
| 175 Warwick | needs_review→needs_review | 3 | 4→4 0/0 | 0/1/0/1 | 9136 | 0.54 | 0.71 | — | v2_weak_pair_coverage, dense_roof_anomaly, majority_planes_need_review, google_solar_pitch_mismatch, v3_polygon_merge_applied |
| Lawrence | needs_review→needs_review | 3 | 6→3 3/2 | 0/0/0/0 | 8079 | 0.38 | 0.27 | low_consistency_with_uncertainty, contradictions_with_weak_pairing, aggregate_risk_elevated | v2_low_consistency, v2_high_uncertainty, v2_weak_pair_coverage, v2_structural_contradiction, dense_roof_anomaly, v3_lidar_plane_disagreement, v3_ridge_conflict |
| 583 Westford St | needs_review→needs_review | 3 | 5→3 2/0 | 0/0/0/1 | 4494 | 0.68 | 0.84 | — | dense_roof_anomaly, v3_lidar_plane_disagreement |
| 13 Richardson St | needs_review→needs_review | 5 | 5→4 1/1 | 1/0/0/0 | 8107 | 0.53 | 0.67 | — | v2_weak_pair_coverage, dense_roof_anomaly, build_tilt_quality_low, v3_lidar_plane_disagreement, v3_ridge_conflict, v3_polygon_split_applied |
| 11 Ash Road | needs_review→needs_review | 4 | 4→4 0/0 | 0/0/0/0 | 4167 | 0.87 | 0.94 | — | build_tilt_quality_low |
| 254 Foster St | needs_review→needs_review | 4 | 3→3 0/1 | 1/0/0/0 | 4052 | 0.39 | 0.43 | — | v2_low_consistency, v2_weak_pair_coverage, crm_soft_gate_applied, dense_roof_anomaly, majority_planes_need_review, v3_ridge_conflict, v3_polygon_split_applied |
| 42 Tanager St | —→reject | 0 | 0→0 0/0 | 0/0/0/0 | 3313 | — | — | — | pipeline_reject, usable_gate_very_low |
| 21 Stoddard | needs_review→needs_review | 5 | 8→5 3/2 | 0/0/0/0 | 4742 | 0.55 | 0.71 | — | v2_weak_pair_coverage, dense_roof_anomaly, v3_lidar_plane_disagreement, v3_ridge_conflict |
| 52 Spaulding | —→reject | 0 | 0→0 0/0 | 0/0/0/0 | 2990 | — | — | — | pipeline_reject, usable_gate_very_low |
| 94 C St | —→reject | 0 | 0→0 0/0 | 0/0/0/0 | 2585 | — | — | — | pipeline_reject, usable_gate_very_low |
| 44 D St | —→reject | 0 | 0→0 0/0 | 0/0/0/0 | 2574 | — | — | — | pipeline_reject, usable_gate_very_low |
| 12 Brown St | —→reject | 0 | 0→0 0/0 | 0/0/0/0 | 3325 | — | — | — | pipeline_reject, usable_gate_very_low |
| Salem | —→reject | 0 | 0→0 0/0 | 0/0/0/0 | 3610 | — | — | — | pipeline_reject, usable_gate_very_low |
| 17 Church Ave | needs_review→needs_review | 4 | 5→4 1/1 | 0/0/0/1 | 4372 | 0.68 | 0.83 | — | usable_gate_low, dense_roof_anomaly, v3_lidar_plane_disagreement, v3_ridge_conflict |
| Puffer | needs_review→needs_review | 3 | 3→2 1/1 | 1/0/0/0 | 9349 | 0.79 | 0.90 | — | dense_roof_anomaly, majority_planes_need_review, build_tilt_quality_low, v3_lidar_plane_disagreement, v3_ridge_conflict, v3_polygon_split_applied |
| 573 Westford St | needs_review→needs_review | 3 | 4→3 1/0 | 0/0/0/0 | 4687 | 0.76 | 0.79 | — | v2_ground_suppression_material, v2p0_ground_surface_detected, v2p0_ground_surface_suppressed, v3_lidar_ground_veto |
| 74 Gates | needs_review→needs_review | 3 | 5→3 2/1 | 1/1/0/0 | 3866 | 0.61 | 0.79 | — | dense_roof_anomaly, majority_planes_need_review, v3_lidar_plane_disagreement, v3_ridge_conflict, v3_polygon_split_applied, v3_polygon_merge_applied |

## Recommended cases for visual review

| Priority | Case | Reasons |
|---:|---|---|
| 13 | 20 Meadow Dr | weak_whole_roof_story, fragmented_main_body, ground_suppression_triggered, likely_ground_issue |
| 13 | Lawrence | contradiction_present, weak_whole_roof_story, high_uncertainty |
| 10 | 254 Foster St | contradiction_present, weak_whole_roof_story |
| 10 | 42 Tanager St | reject |
| 10 | 52 Spaulding | reject |
| 10 | 94 C St | reject |
| 10 | 44 D St | reject |
| 10 | 12 Brown St | reject |
| 10 | Salem | reject |
| 8 | 573 Westford St | heavy_suppression, ground_suppression_triggered, likely_ground_issue |
| 7 | 726 School St | weak_whole_roof_story, likely_ground_issue |
| 5 | 225 Gibson St | contradiction_present |
| 5 | 13 Richardson St | contradiction_present |
| 1 | 175 Warwick | needs_review_only |
| 1 | 583 Westford St | needs_review_only |
| 1 | 11 Ash Road | needs_review_only |
| 1 | 21 Stoddard | needs_review_only |
| 1 | 17 Church Ave | needs_review_only |
| 1 | Puffer | needs_review_only |
| 1 | 74 Gates | needs_review_only |

Also include a random sample of `clean_auto_accept` cases for sanity checking.
