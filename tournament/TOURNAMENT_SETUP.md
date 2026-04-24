# Ridge Tournament — Setup & Workflow

## Repository Layout
- **CRM repo:** `/Volumes/Extreme_Pro/project Interrupt/` (server.js, roof_geometry/)
- **ML repo:** `/Volumes/Extreme_Pro/ML/` (ml_ui_server.py, ml_engine/)
- **Tournament dir:** `/Volumes/Extreme_Pro/project Interrupt/tournament/`

## Ground Truth

**Property:** 20 Meadow (mn9805q0ddm)
**Coordinates:** 42.6463, -71.3545

**Exactly 3 independent ridges:**
- On separate roof planes
- At different elevations
- Roughly co-linear (all ~N-S)
- Not connected structurally
- Must NOT be merged — each must be detected independently

**Zero false ridges allowed.**

## Baseline Diagnosis (score: 35/100)

**Baseline failures:**
1. **Ridge merge** — all 3 ridges collapsed into one 16.7m diagonal line (R0)
2. **False E-W ridges** — R1 (0.50, 4.0m) and R2 (0.62, 3.0m) are horizontal false positives
3. **No fusion scoring** — LiDAR evidence not being used (boosted=0, reclass=0)

## Agent Rules

### All agents get the SAME objective:
> Find all 3 independent ridges on 20 Meadow consistently, with 0 false ridge lines.

### No fixed lanes:
- Every agent can change **anything** in its isolated branch: ML thresholds, LiDAR fusion, boundary tracing, scoring, filtering, rendering, or anything else
- No agent is locked into one strategy
- They are competing to solve the full ridge problem however they think is best

### After each iteration:
- Report score before/after
- Keep if improved, revert if worsened
- After a breakthrough, manager shares what worked with other agents

### Scoring:
- Visual overlay comparison is the **primary** judge
- JSON/debug output is supporting evidence only
- Ridges only — no eaves/rakes scoring yet

## Branch Setup

### Step 1: Commit current baseline to main + push to GitHub
```bash
cd "/Volumes/Extreme_Pro/project Interrupt"
git add server.js LIDAR_LINE_AUDIT_ANALYSIS.md smoke_test_line_audit.sh tournament/
git commit -m "V2 Line Audit baseline + ridge tournament harness"
git push origin main
```

### Step 2: Create agent branches (from main)
```bash
git branch agent-a-ridge main
git branch agent-b-ridge main
git branch agent-c-ridge main
git branch agent-d-ridge main
```

### Step 3: Create worktrees (isolated working directories)
```bash
git worktree add ../tournament-agent-a agent-a-ridge
git worktree add ../tournament-agent-b agent-b-ridge
git worktree add ../tournament-agent-c agent-c-ridge
git worktree add ../tournament-agent-d agent-d-ridge
```

Each agent works in its own directory:
- Agent A: `/Volumes/Extreme_Pro/tournament-agent-a/`
- Agent B: `/Volumes/Extreme_Pro/tournament-agent-b/`
- Agent C: `/Volumes/Extreme_Pro/tournament-agent-c/`
- Agent D: `/Volumes/Extreme_Pro/tournament-agent-d/`

## Benchmark Workflow (per agent iteration)

### 1. Make changes in agent's worktree

### 2. Restart servers
```bash
lsof -ti:3001 | xargs kill 2>/dev/null
lsof -ti:5001 | xargs kill 2>/dev/null
lsof -ti:8000 | xargs kill 2>/dev/null

cd "/Volumes/Extreme_Pro/tournament-agent-X" && node server.js &
cd /Volumes/Extreme_Pro/ML && python3 ml_ui_server.py &
cd "/Volumes/Extreme_Pro/tournament-agent-X/roof_geometry" && ~/roof_venv/bin/python3.12 -m uvicorn app:app --port 8000 &
```

### 3. Run benchmark
```bash
cd "/Volumes/Extreme_Pro/tournament-agent-X"
./tournament/scripts/run_benchmark.sh agent-X mn9805q0ddm 42.6463 -71.3545
```

### 4. Score
- Compare `results/agent-X/agent_overlay_ridges.png` vs `ground_truth/ground_truth_ridges.png`
- Fill in score_template.md
- Update proctor_ranking.md

### 5. Commit or revert
```bash
# If score improved:
git add -A && git commit -m "agent-X iter N: [description] score=XX"

# If score worsened:
git checkout -- .
```

## Safe Merge Policy
1. NO merge to main during tournament
2. Best agent's branch preserved as-is
3. After ridges complete with score >= 90:
   - Proctor reviews best branch
   - Cherry-pick or merge to main
   - All agent branches cleaned up

## Scoring Rubric (Ridge Only)
| Category | Max Points | Criteria |
|----------|-----------|----------|
| Expected ridge recall | 40 | Each of the 3 expected ridges found independently (~13.3 per ridge) |
| Placement accuracy | 20 | Each line is close to its section's actual ridge centerline |
| Length accuracy | 15 | Each ridge matches its roof section — not overextended, not truncated |
| False ridge penalty | 15 | Deduct for fake ridges (shadows, eaves, merged lines, etc.) |
| Debug usefulness | 10 | Rejected candidates listed, reason codes, meaningful confidence |
| **TOTAL** | **100** | Target: >= 90 |
