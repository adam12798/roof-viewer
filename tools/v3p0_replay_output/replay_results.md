# V3P0 Replay Results

Generated: 2026-04-21T19:27:42.296Z
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
| min | 2357 |
| median | 3856 |
| mean | 3925 |
| max | 8028 |

## Bucket counts

| Bucket | Count |
|---|---:|
| fast_under_10s | 21 |
| needs_review | 17 |
| likely_ground_issue | 3 |
| reject | 3 |
| ground_suppression_triggered | 2 |
| contradiction_present | 2 |
| p9_unmatched | 2 |
| v3p5_rescued | 2 |
| weak_pair_coverage | 2 |
| clean_auto_accept | 1 |
| p8_corrected | 1 |
| weak_whole_roof_story | 1 |
| fragmented_main_body | 1 |
| v3p6_rescued | 1 |
| heavy_suppression | 1 |

## Per-case summary

| Case | Prior→Final | Faces | V3P1 in→out veto/ridge | V3P2 sp/mg/fb/sn | Runtime | WholeRoof | FinalScore | V2P7 triggers | Reasons / errors |
|---|---|---:|---|---|---:|---:|---:|---|---|
| 15 Veteran Rd | auto_accept→auto_accept | 4 | 3→3 0/0 | 0/0/0/1 (H0/M1/L1) | 4210 | 0.86 | 0.93 | — | — |
| 726 School St | needs_review→needs_review | 3 | 3→2 1/1 | 1/0/0/2 (H0/M1/L0) | 4167 | 0.77 | 0.84 | — | dense_roof_anomaly, majority_planes_need_review, google_solar_pitch_mismatch, v2p0_ground_surface_detected, v3_lidar_ground_veto, v3_ridge_conflict, v3_polygon_split_applied |
| 20 Meadow Dr | needs_review→needs_review | 5 | 3→3 0/1 | 0/0/0/0 (H0/M1/L0) | 3665 | 0.77 | 0.79 | — | v2_ground_suppression_material, v2p0_ground_surface_detected, v2p0_ground_surface_suppressed, v3_ridge_conflict |
| 225 Gibson St | needs_review→needs_review | 7 | 6→5 1/2 | 2/0/0/0 (H2/M3/L0) | 3993 | 0.69 | 0.85 | — | dense_roof_anomaly, google_solar_pitch_mismatch, google_solar_pitch_corrected, v3_lidar_plane_disagreement, v3_ridge_conflict, v3_polygon_split_applied, v3p4_enforcement_applied |
| 175 Warwick | needs_review→needs_review | 6 | 4→4 0/3 | 3/1/0/4 (H0/M6/L0) | 4017 | 0.85 | 0.93 | — | dense_roof_anomaly, majority_planes_need_review, google_solar_pitch_mismatch, v3_ridge_conflict, v3_polygon_split_applied, v3_polygon_merge_applied |
| Lawrence | needs_review→needs_review | 4 | 6→3 3/2 | 0/0/0/0 (H0/M1/L0) | 8028 | 0.73 | 0.88 | — | dense_roof_anomaly, v3_lidar_plane_disagreement, v3_ridge_conflict |
| 583 Westford St | needs_review→needs_review | 4 | 5→4 1/0 | 0/0/0/2 (H1/M4/L0) | 4200 | 0.76 | 0.88 | — | dense_roof_anomaly, v3_lidar_plane_disagreement |
| 13 Richardson St | needs_review→needs_review | 7 | 5→4 1/3 | 1/0/0/0 (H0/M3/L0) | 3856 | 0.71 | 0.81 | — | dense_roof_anomaly, build_tilt_quality_low, v3_lidar_plane_disagreement, v3_ridge_conflict, v3_polygon_split_applied |
| 11 Ash Road | needs_review→needs_review | 4 | 4→4 0/0 | 0/0/0/0 (H0/M3/L2) | 4578 | 0.94 | 0.97 | — | build_tilt_quality_low |
| 254 Foster St | needs_review→needs_review | 4 | 3→3 0/1 | 1/0/0/0 (H1/M1/L0) | 5384 | 0.79 | 0.90 | — | crm_soft_gate_applied, dense_roof_anomaly, majority_planes_need_review, v3_ridge_conflict, v3_polygon_split_applied |
| 42 Tanager St | needs_review→needs_review | 2 | 3→2 1/2 | 0/0/0/0 (H0/M0/L0) | 3052 | 0.71 | 0.87 | — | pipeline_reject, usable_gate_very_low, v3_partial_build_rescue, v3_tree_obstruction_rescue, p9_build_unmatched, v3_lidar_plane_disagreement, v3_ridge_conflict, v3p3_polygon_suppressed |
| 21 Stoddard | needs_review→needs_review | 5 | 8→5 3/3 | 1/0/0/0 (H3/M2/L1) | 4733 | 0.70 | 0.79 | — | dense_roof_anomaly, v3_lidar_plane_disagreement, v3_ridge_conflict, v3_polygon_split_applied, v3p3_polygon_suppressed |
| 52 Spaulding | needs_review→needs_review | 2 | 2→2 0/1 | 0/0/0/0 (H0/M0/L0) | 2822 | 0.28 | 0.35 | main_body_weak, aggregate_risk_elevated | v2_low_consistency, v2_fragmented_main_body, pipeline_reject, usable_gate_very_low, v3_partial_build_rescue, p9_build_unmatched, v3_ridge_conflict |
| 94 C St | —→reject | 0 | 0→0 0/0 | 0/0/0/0 (H0/M0/L0) | 2831 | — | — | — | pipeline_reject, usable_gate_very_low |
| 44 D St | —→reject | 0 | 0→0 0/0 | 0/0/0/0 (H0/M0/L0) | 2357 | — | — | — | pipeline_reject, usable_gate_very_low |
| 12 Brown St | —→reject | 0 | 0→0 0/0 | 0/0/0/0 (H0/M0/L0) | 2637 | — | — | — | pipeline_reject, usable_gate_very_low |
| Salem | needs_review→needs_review | 2 | 2→1 1/0 | 0/0/0/0 (H0/M0/L0) | 2698 | 0.90 | 0.97 | — | pipeline_reject, usable_gate_very_low, v3_hard_case_partial_rescue, v3_occlusion_rescue, google_solar_pitch_mismatch, v3_lidar_plane_disagreement |
| 17 Church Ave | needs_review→needs_review | 8 | 5→4 1/3 | 2/0/0/1 (H0/M5/L0) | 4439 | 0.54 | 0.69 | — | v2_weak_pair_coverage, usable_gate_low, dense_roof_anomaly, v3_lidar_plane_disagreement, v3_ridge_conflict, v3_polygon_split_applied |
| Puffer | needs_review→needs_review | 4 | 3→3 0/2 | 1/0/1/0 (H1/M1/L0) | 3626 | 0.72 | 0.86 | — | dense_roof_anomaly, majority_planes_need_review, build_tilt_quality_low, v3_ridge_conflict, v3_polygon_split_applied, v3_polygon_fallback_applied |
| 573 Westford St | needs_review→needs_review | 3 | 4→3 1/1 | 0/0/0/0 (H0/M0/L2) | 3364 | 0.76 | 0.79 | — | v2_ground_suppression_material, v2p0_ground_surface_detected, v2p0_ground_surface_suppressed, v3_lidar_ground_veto, v3_ridge_conflict |
| 74 Gates | needs_review→needs_review | 6 | 5→3 2/2 | 2/0/0/0 (H0/M1/L0) | 3776 | 0.67 | 0.82 | — | dense_roof_anomaly, majority_planes_need_review, v3_lidar_plane_disagreement, v3_ridge_conflict, v3_polygon_split_applied |

## Recommended cases for visual review

| Priority | Case | Reasons |
|---:|---|---|
| 12 | 52 Spaulding | weak_whole_roof_story, fragmented_main_body, p9_unmatched |
| 10 | 94 C St | reject |
| 10 | 44 D St | reject |
| 10 | 12 Brown St | reject |
| 8 | 573 Westford St | heavy_suppression, ground_suppression_triggered, likely_ground_issue |
| 5 | 13 Richardson St | contradiction_present |
| 5 | 21 Stoddard | contradiction_present |
| 4 | 20 Meadow Dr | ground_suppression_triggered, likely_ground_issue |
| 3 | 42 Tanager St | p9_unmatched |
| 2 | 726 School St | likely_ground_issue |
| 1 | 225 Gibson St | needs_review_only |
| 1 | 175 Warwick | needs_review_only |
| 1 | Lawrence | needs_review_only |
| 1 | 583 Westford St | needs_review_only |
| 1 | 11 Ash Road | needs_review_only |
| 1 | 254 Foster St | needs_review_only |
| 1 | Salem | needs_review_only |
| 1 | 17 Church Ave | needs_review_only |
| 1 | Puffer | needs_review_only |
| 1 | 74 Gates | needs_review_only |

Also include a random sample of `clean_auto_accept` cases for sanity checking.
