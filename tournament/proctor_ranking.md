# Ridge Tournament — Proctor Ranking Table

## Property: 20 Meadow (mn9805q0ddm)
## Target: >= 90 / 100

| Rank | Agent | Best Score | Iteration | Key Insight | Status |
|------|-------|------------|-----------|-------------|--------|
| — | baseline | 35 | 0 | merge failure + 2 false E-W ridges | scored |
| — | agent-a-ridge | — | 0 | — | not started |
| — | agent-b-ridge | — | 0 | — | not started |
| — | agent-c-ridge | — | 0 | — | not started |
| — | agent-d-ridge | — | 0 | — | not started |

## Iteration Log

### Baseline (iteration 0)
- **Score:** 35 / 100
- **Ridge count:** 3 detected (should be 3, but wrong: 1 merged + 2 false)
- **Expected ridges found:** 0/3 independently (all merged into R0)
- **False ridges:** 2 (R1: E-W 4.0m, R2: E-W 3.0m)
- **Core failures:**
  1. Ridge merge: 3 independent ridges on separate roof planes collapsed into one 16.7m diagonal (R0)
  2. False E-W ridges: R1 and R2 don't correspond to any real ridge
  3. No fusion scoring active (boosted=0, reclass=0)
- **Notes:** This is the primary challenge — the model must learn to keep co-linear ridges on separate roof planes as independent lines

---

## Breakthroughs Shared
(none yet)

## Agents Stalled
(none yet)

## Unsafe Changes Rejected
(none yet)
