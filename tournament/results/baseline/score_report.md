# Ridge Score Report — BASELINE — Iteration 0

## Property: 20 Meadow (mn9805q0ddm)

### Change Summary
- **Hypothesis:** N/A — this is the unmodified V2 fusion baseline
- **Files modified:** none
- **Change description:** Current code as-is, no changes

### Ridge Results
| Metric | Value |
|--------|-------|
| Expected ridges found | 0 / 3 (R0 is a merge of all three) |
| False ridges | 2 (R1 E-W, R2 E-W) |
| Boundary-trace ridges | 0 |
| Total ridge lines | 3 |
| Mean ridge confidence | 0.60 |

### Expected Ridge Checklist
| # | Ridge Description | Found? | Confidence | Placement | Length | Notes |
|---|-------------------|--------|------------|-----------|--------|-------|
| 1 | Main upper ridge | Merged | 0.69 | off (diagonal) | overextended 16.7m | R0 spans all 3 sections |
| 2 | Middle ridge | No | — | — | — | Absorbed into R0 |
| 3 | Lower/front ridge | No | — | — | — | Absorbed into R0 |

### Score Breakdown (out of 100)
| Category | Points | Max | Notes |
|----------|--------|-----|-------|
| Expected ridge recall | 13 | 40 | One merged line partially covers Ridge 1 area; Ridges 2+3 not independent |
| Placement accuracy | 8 | 20 | R0 runs diagonal, not centered on any single section peak |
| Length accuracy | 3 | 15 | R0 is 16.7m spanning full building — should be 3 lines of 3-8m each |
| False ridge penalty | 5 | 15 | 2 false E-W ridges (R1: 0.50/4.0m, R2: 0.62/3.0m) |
| Debug usefulness | 6 | 10 | Confidence present, fusion=0 boosted/reclass (no LiDAR scoring active) |
| **TOTAL** | **35** | **100** | Core failure: ridge merging + false positives |

### Key Failures
1. **Ridge merge:** All 3 independent ridges collapsed into one 16.7m diagonal line (R0)
2. **False E-W ridges:** R1 and R2 are horizontal lines that don't correspond to any real ridge
3. **No fusion scoring:** boosted=0, reclass=0, bt=0 — LiDAR evidence not being used

### Decision
- [x] BASELINE — reference point for tournament

### Visual Comparison
- Ground truth: `ground_truth/ground_truth_ridges.png`
- Baseline overlay: `results/baseline/agent_overlay_ridges.png`
- Full overlay: `results/baseline/agent_overlay_full.png`
