# V3P0 Replay Results

Generated: 2026-04-21T01:04:30.812Z
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
| min | 2659 |
| median | 5645 |
| mean | 5981 |
| max | 12323 |

## Bucket counts

| Bucket | Count |
|---|---:|
| fast_under_10s | 20 |
| needs_review | 14 |
| weak_pair_coverage | 7 |
| reject | 6 |
| weak_whole_roof_story | 3 |
| likely_ground_issue | 3 |
| ground_suppression_triggered | 2 |
| clean_auto_accept | 1 |
| fragmented_main_body | 1 |
| p8_corrected | 1 |
| medium_10_to_15s | 1 |
| high_uncertainty | 1 |
| contradiction_present | 1 |
| heavy_suppression | 1 |

## Per-case summary

| Case | Prior→Final | Faces | V3P1 in→out veto/ridge | V3P2 sp/mg/fb/sn | Runtime | WholeRoof | FinalScore | V2P7 triggers | Reasons / errors |
|---|---|---:|---|---|---:|---:|---:|---|---|
| 15 Veteran Rd | auto_accept→auto_accept | 3 | 3→3 0/0 | 0/0/0/1 (H0/M1/L1) | 6453 | 0.87 | 0.94 | — | — |
| 726 School St | needs_review→needs_review | 2 | 3→2 1/0 | 0/0/0/2 (H0/M1/L0) | 7628 | 0.48 | 0.48 | aggregate_risk_elevated | v2_low_consistency, v2_weak_pair_coverage, dense_roof_anomaly, majority_planes_need_review, google_solar_pitch_mismatch, v2p0_ground_surface_detected, v3_lidar_ground_veto |
| 20 Meadow Dr | needs_review→needs_review | 2 | 3→2 1/1 | 0/0/0/0 (H0/M0/L0) | 4555 | 0.24 | 0.20 | main_body_weak, aggregate_risk_elevated | v2_low_consistency, v2_fragmented_main_body, v2_weak_pair_coverage, v2_ground_suppression_material, v2p0_ground_surface_detected, v2p0_ground_surface_suppressed, v3_lidar_plane_disagreement, v3_ridge_conflict |
| 225 Gibson St | needs_review→needs_review | 6 | 6→5 1/1 | 1/0/0/0 (H2/M3/L0) | 5387 | 0.78 | 0.90 | — | dense_roof_anomaly, google_solar_pitch_mismatch, google_solar_pitch_corrected, v3_lidar_plane_disagreement, v3_ridge_conflict, v3_polygon_split_applied |
| 175 Warwick | needs_review→needs_review | 3 | 4→4 0/0 | 0/1/0/1 (H0/M6/L0) | 5645 | 0.54 | 0.71 | — | v2_weak_pair_coverage, dense_roof_anomaly, majority_planes_need_review, google_solar_pitch_mismatch, v3_polygon_merge_applied |
| Lawrence | needs_review→needs_review | 3 | 6→3 3/2 | 0/0/0/0 (H0/M1/L0) | 12323 | 0.38 | 0.27 | low_consistency_with_uncertainty, contradictions_with_weak_pairing, aggregate_risk_elevated | v2_low_consistency, v2_high_uncertainty, v2_weak_pair_coverage, v2_structural_contradiction, dense_roof_anomaly, v3_lidar_plane_disagreement, v3_ridge_conflict |
| 583 Westford St | needs_review→needs_review | 3 | 5→3 2/0 | 0/0/0/1 (H0/M2/L0) | 8618 | 0.68 | 0.84 | — | dense_roof_anomaly, v3_lidar_plane_disagreement |
| 13 Richardson St | needs_review→needs_review | 4 | 5→4 1/1 | 0/0/0/0 (H0/M3/L0) | 8314 | 0.62 | 0.82 | — | dense_roof_anomaly, build_tilt_quality_low, v3_lidar_plane_disagreement, v3_ridge_conflict |
| 11 Ash Road | needs_review→needs_review | 4 | 4→4 0/0 | 0/0/0/0 (H0/M3/L2) | 5304 | 0.87 | 0.94 | — | build_tilt_quality_low |
| 254 Foster St | needs_review→needs_review | 4 | 3→3 0/1 | 1/0/0/0 (H1/M1/L0) | 7560 | 0.79 | 0.90 | — | crm_soft_gate_applied, dense_roof_anomaly, majority_planes_need_review, v3_ridge_conflict, v3_polygon_split_applied |
| 42 Tanager St | —→reject | 0 | 0→0 0/0 | 0/0/0/0 (H0/M0/L0) | 3123 | — | — | — | pipeline_reject, usable_gate_very_low |
| 21 Stoddard | needs_review→needs_review | 4 | 8→5 3/2 | 0/0/0/0 (H3/M2/L1) | 6518 | 0.57 | 0.73 | — | v2_weak_pair_coverage, dense_roof_anomaly, v3_lidar_plane_disagreement, v3_ridge_conflict, v3p3_polygon_suppressed |
| 52 Spaulding | —→reject | 0 | 0→0 0/0 | 0/0/0/0 (H0/M0/L0) | 2664 | — | — | — | pipeline_reject, usable_gate_very_low |
| 94 C St | —→reject | 0 | 0→0 0/0 | 0/0/0/0 (H0/M0/L0) | 2659 | — | — | — | pipeline_reject, usable_gate_very_low |
| 44 D St | —→reject | 0 | 0→0 0/0 | 0/0/0/0 (H0/M0/L0) | 2851 | — | — | — | pipeline_reject, usable_gate_very_low |
| 12 Brown St | —→reject | 0 | 0→0 0/0 | 0/0/0/0 (H0/M0/L0) | 2820 | — | — | — | pipeline_reject, usable_gate_very_low |
| Salem | —→reject | 0 | 0→0 0/0 | 0/0/0/0 (H0/M0/L0) | 3596 | — | — | — | pipeline_reject, usable_gate_very_low |
| 17 Church Ave | needs_review→needs_review | 4 | 5→4 1/1 | 0/0/0/1 (H0/M5/L0) | 6002 | 0.68 | 0.83 | — | usable_gate_low, dense_roof_anomaly, v3_lidar_plane_disagreement, v3_ridge_conflict |
| Puffer | needs_review→needs_review | 3 | 3→2 1/1 | 1/0/0/0 (H0/M1/L0) | 5237 | 0.74 | 0.88 | — | dense_roof_anomaly, majority_planes_need_review, build_tilt_quality_low, v3_lidar_plane_disagreement, v3_ridge_conflict, v3_polygon_split_applied |
| 573 Westford St | needs_review→needs_review | 3 | 4→3 1/0 | 0/0/0/0 (H0/M0/L2) | 8822 | 0.76 | 0.79 | — | v2_ground_suppression_material, v2p0_ground_surface_detected, v2p0_ground_surface_suppressed, v3_lidar_ground_veto |
| 74 Gates | needs_review→needs_review | 4 | 5→3 2/1 | 1/0/0/0 (H0/M1/L0) | 9530 | 0.61 | 0.75 | — | v2_weak_pair_coverage, dense_roof_anomaly, majority_planes_need_review, v3_lidar_plane_disagreement, v3_ridge_conflict, v3_polygon_split_applied |

## Recommended cases for visual review

| Priority | Case | Reasons |
|---:|---|---|
| 13 | 20 Meadow Dr | weak_whole_roof_story, fragmented_main_body, ground_suppression_triggered, likely_ground_issue |
| 13 | Lawrence | contradiction_present, weak_whole_roof_story, high_uncertainty |
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
| 1 | 254 Foster St | needs_review_only |
| 1 | 21 Stoddard | needs_review_only |
| 1 | 17 Church Ave | needs_review_only |
| 1 | Puffer | needs_review_only |
| 1 | 74 Gates | needs_review_only |

Also include a random sample of `clean_auto_accept` cases for sanity checking.
