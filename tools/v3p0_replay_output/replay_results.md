# V3P0 Replay Results

Generated: 2026-04-21T02:53:08.173Z
Batch size: 21 — succeeded: 21, failed: 0

## Status distribution

| Status | Count |
|---|---:|
| auto_accept | 1 |
| needs_review | 17 |
| reject | 3 |

## Runtime summary

| Metric | ms |
|---|---:|
| min | 3164 |
| median | 5550 |
| mean | 7097 |
| max | 15084 |

## Bucket counts

| Bucket | Count |
|---|---:|
| needs_review | 17 |
| fast_under_10s | 17 |
| weak_pair_coverage | 5 |
| medium_10_to_15s | 3 |
| weak_whole_roof_story | 3 |
| likely_ground_issue | 3 |
| reject | 3 |
| ground_suppression_triggered | 2 |
| p9_unmatched | 2 |
| v3p5_rescued | 2 |
| clean_auto_accept | 1 |
| p8_corrected | 1 |
| slow_over_15s | 1 |
| high_uncertainty | 1 |
| contradiction_present | 1 |
| fragmented_main_body | 1 |
| v3p6_rescued | 1 |
| heavy_suppression | 1 |

## Per-case summary

| Case | Prior→Final | Faces | V3P1 in→out veto/ridge | V3P2 sp/mg/fb/sn | Runtime | WholeRoof | FinalScore | V2P7 triggers | Reasons / errors |
|---|---|---:|---|---|---:|---:|---:|---|---|
| 15 Veteran Rd | auto_accept→auto_accept | 3 | 3→3 0/0 | 0/0/0/1 (H0/M1/L1) | 12083 | 0.94 | 0.97 | — | — |
| 726 School St | needs_review→needs_review | 2 | 3→2 1/0 | 0/0/0/2 (H0/M1/L0) | 5550 | 0.48 | 0.48 | aggregate_risk_elevated | v2_low_consistency, v2_weak_pair_coverage, dense_roof_anomaly, majority_planes_need_review, google_solar_pitch_mismatch, v2p0_ground_surface_detected, v3_lidar_ground_veto |
| 20 Meadow Dr | needs_review→needs_review | 3 | 3→3 0/1 | 0/0/0/0 (H0/M1/L0) | 4413 | 0.76 | 0.80 | — | v2_ground_suppression_material, v2p0_ground_surface_detected, v2p0_ground_surface_suppressed, v3_ridge_conflict |
| 225 Gibson St | needs_review→needs_review | 7 | 6→5 1/1 | 2/0/0/0 (H2/M3/L0) | 7783 | 0.69 | 0.85 | — | dense_roof_anomaly, google_solar_pitch_mismatch, google_solar_pitch_corrected, v3_lidar_plane_disagreement, v3_ridge_conflict, v3_polygon_split_applied, v3p4_enforcement_applied |
| 175 Warwick | needs_review→needs_review | 4 | 4→4 0/0 | 0/0/0/1 (H0/M6/L0) | 8897 | 0.54 | 0.71 | — | v2_weak_pair_coverage, dense_roof_anomaly, majority_planes_need_review, google_solar_pitch_mismatch |
| Lawrence | needs_review→needs_review | 3 | 6→3 3/2 | 0/0/0/0 (H0/M1/L0) | 15084 | 0.37 | 0.27 | low_consistency_with_uncertainty, contradictions_with_weak_pairing, aggregate_risk_elevated | v2_low_consistency, v2_high_uncertainty, v2_weak_pair_coverage, v2_structural_contradiction, dense_roof_anomaly, v3_lidar_plane_disagreement, v3_ridge_conflict |
| 583 Westford St | needs_review→needs_review | 4 | 5→4 1/0 | 0/0/0/2 (H1/M4/L0) | 12303 | 0.76 | 0.88 | — | dense_roof_anomaly, v3_lidar_plane_disagreement |
| 13 Richardson St | needs_review→needs_review | 4 | 5→4 1/1 | 0/0/0/0 (H0/M3/L0) | 6069 | 0.53 | 0.70 | — | v2_weak_pair_coverage, dense_roof_anomaly, build_tilt_quality_low, v3_lidar_plane_disagreement, v3_ridge_conflict |
| 11 Ash Road | needs_review→needs_review | 4 | 4→4 0/0 | 0/0/0/0 (H0/M3/L2) | 5767 | 0.94 | 0.97 | — | build_tilt_quality_low |
| 254 Foster St | needs_review→needs_review | 4 | 3→3 0/1 | 1/0/0/0 (H1/M1/L0) | 5213 | 0.79 | 0.90 | — | crm_soft_gate_applied, dense_roof_anomaly, majority_planes_need_review, v3_ridge_conflict, v3_polygon_split_applied |
| 42 Tanager St | needs_review→needs_review | 1 | 3→2 1/1 | 0/0/0/0 (H0/M0/L0) | 4123 | 0.82 | 0.77 | — | pipeline_reject, usable_gate_very_low, v3_partial_build_rescue, v3_tree_obstruction_rescue, p9_build_unmatched, v3_lidar_plane_disagreement, v3_ridge_conflict, v3p3_polygon_suppressed |
| 21 Stoddard | needs_review→needs_review | 6 | 8→5 3/2 | 2/0/0/0 (H3/M2/L1) | 9138 | 0.51 | 0.69 | — | v2_weak_pair_coverage, dense_roof_anomaly, v3_lidar_plane_disagreement, v3_ridge_conflict, v3_polygon_split_applied, v3p3_polygon_suppressed, v3p4_enforcement_applied |
| 52 Spaulding | needs_review→needs_review | 2 | 2→2 0/1 | 0/0/0/0 (H0/M0/L0) | 4385 | 0.28 | 0.35 | main_body_weak, aggregate_risk_elevated | v2_low_consistency, v2_fragmented_main_body, pipeline_reject, usable_gate_very_low, v3_partial_build_rescue, p9_build_unmatched, v3_ridge_conflict |
| 94 C St | —→reject | 0 | 0→0 0/0 | 0/0/0/0 (H0/M0/L0) | 3164 | — | — | — | pipeline_reject, usable_gate_very_low |
| 44 D St | —→reject | 0 | 0→0 0/0 | 0/0/0/0 (H0/M0/L0) | 3592 | — | — | — | pipeline_reject, usable_gate_very_low |
| 12 Brown St | —→reject | 0 | 0→0 0/0 | 0/0/0/0 (H0/M0/L0) | 4880 | — | — | — | pipeline_reject, usable_gate_very_low |
| Salem | needs_review→needs_review | 1 | 2→1 1/0 | 0/0/0/0 (H0/M0/L0) | 5119 | 0.63 | 0.72 | — | pipeline_reject, usable_gate_very_low, v3_hard_case_partial_rescue, v3_occlusion_rescue, google_solar_pitch_mismatch, v3_lidar_plane_disagreement |
| 17 Church Ave | needs_review→needs_review | 5 | 5→4 1/1 | 1/0/0/1 (H0/M5/L0) | 13424 | 0.79 | 0.89 | — | usable_gate_low, dense_roof_anomaly, v3_lidar_plane_disagreement, v3_ridge_conflict, v3_polygon_split_applied, v3p4_enforcement_applied |
| Puffer | needs_review→needs_review | 3 | 3→3 0/1 | 0/0/1/0 (H1/M1/L0) | 5487 | 0.68 | 0.84 | — | dense_roof_anomaly, majority_planes_need_review, build_tilt_quality_low, v3_ridge_conflict, v3_polygon_fallback_applied |
| 573 Westford St | needs_review→needs_review | 3 | 4→3 1/0 | 0/0/0/0 (H0/M0/L2) | 7311 | 0.76 | 0.79 | — | v2_ground_suppression_material, v2p0_ground_surface_detected, v2p0_ground_surface_suppressed, v3_lidar_ground_veto |
| 74 Gates | needs_review→needs_review | 4 | 5→3 2/1 | 1/0/0/0 (H0/M1/L0) | 5261 | 0.73 | 0.86 | — | dense_roof_anomaly, majority_planes_need_review, v3_lidar_plane_disagreement, v3_ridge_conflict, v3_polygon_split_applied |

## Recommended cases for visual review

| Priority | Case | Reasons |
|---:|---|---|
| 15 | Lawrence | contradiction_present, weak_whole_roof_story, high_uncertainty, slow_over_15s |
| 12 | 52 Spaulding | weak_whole_roof_story, fragmented_main_body, p9_unmatched |
| 10 | 94 C St | reject |
| 10 | 44 D St | reject |
| 10 | 12 Brown St | reject |
| 8 | 573 Westford St | heavy_suppression, ground_suppression_triggered, likely_ground_issue |
| 7 | 726 School St | weak_whole_roof_story, likely_ground_issue |
| 4 | 20 Meadow Dr | ground_suppression_triggered, likely_ground_issue |
| 3 | 42 Tanager St | p9_unmatched |
| 1 | 225 Gibson St | needs_review_only |
| 1 | 175 Warwick | needs_review_only |
| 1 | 583 Westford St | needs_review_only |
| 1 | 13 Richardson St | needs_review_only |
| 1 | 11 Ash Road | needs_review_only |
| 1 | 254 Foster St | needs_review_only |
| 1 | 21 Stoddard | needs_review_only |
| 1 | Salem | needs_review_only |
| 1 | 17 Church Ave | needs_review_only |
| 1 | Puffer | needs_review_only |
| 1 | 74 Gates | needs_review_only |

Also include a random sample of `clean_auto_accept` cases for sanity checking.
