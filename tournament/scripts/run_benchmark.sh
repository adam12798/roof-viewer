#!/bin/bash
# Run Line Audit benchmark for a single agent branch.
#
# Usage:
#   ./run_benchmark.sh <agent_name> <project_id> <lat> <lng>
#
# Requires: CRM (3001), ML (5001), RoofGeom (8000) running.
# Outputs to: tournament/results/<agent_name>/
#
# Example:
#   ./run_benchmark.sh baseline mn9805q0ddm 42.6463 -71.3545

set -euo pipefail

AGENT="${1:?Usage: run_benchmark.sh <agent_name> <project_id> <lat> <lng>}"
PROJECT_ID="${2:?project_id required}"
LAT="${3:?lat required}"
LNG="${4:?lng required}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TOURNAMENT_DIR="$(dirname "$SCRIPT_DIR")"
RESULTS_DIR="$TOURNAMENT_DIR/results/$AGENT"
mkdir -p "$RESULTS_DIR"

# Get session cookie
SESSION_FILE="/tmp/crm_session.txt"
if [ ! -f "$SESSION_FILE" ]; then
  echo "ERROR: No session cookie at $SESSION_FILE. Log in first."
  exit 1
fi
SESSION=$(cat "$SESSION_FILE")

echo "[$AGENT] Running Line Audit for project=$PROJECT_ID lat=$LAT lng=$LNG"

RESPONSE=$(curl -s -X POST http://localhost:3001/api/line-audit \
  -H "Content-Type: application/json" \
  -H "Cookie: session=$SESSION" \
  -d "{
    \"projectId\": \"$PROJECT_ID\",
    \"design_center\": {\"lat\": $LAT, \"lng\": $LNG},
    \"lidar\": {\"points\": [], \"bounds\": [-35,-35,35,35], \"resolution\": 0.25, \"source\": \"google_solar_dsm\"},
    \"image\": {
      \"url\": \"/api/satellite?lat=$LAT&lng=$LNG&zoom=20&size=640\",
      \"width_px\": 640, \"height_px\": 640,
      \"geo_bounds\": [$(echo "$LAT - 0.000315" | bc -l), $(echo "$LNG - 0.000420" | bc -l), $(echo "$LAT + 0.000315" | bc -l), $(echo "$LNG + 0.000420" | bc -l)],
      \"resolution_m_per_px\": 0.109375
    },
    \"options\": {\"pipeline_mode\": \"ml_v2\"}
  }" 2>/dev/null)

# Save raw JSON
echo "$RESPONSE" | python3 -m json.tool > "$RESULTS_DIR/line_audit_output.json" 2>/dev/null || echo "$RESPONSE" > "$RESULTS_DIR/line_audit_output.json"

# Extract ridge-only stats
python3 -c "
import json, sys
data = json.loads('''$RESPONSE''')
if 'error' in data:
    print('ERROR:', data['error'])
    sys.exit(1)
lines = data.get('audit_lines', [])
ridges = [l for l in lines if l.get('type') == 'ridge']
print(f'Total lines: {len(lines)}')
print(f'Ridge lines: {len(ridges)}')
for i, r in enumerate(ridges):
    src = r.get('source', '?')
    conf = r.get('confidence', 0)
    length = r.get('length_m', 0)
    p1, p2 = r['p1'], r['p2']
    print(f'  R{i}: conf={conf:.3f} len={length:.1f}m src={src} [{p1[\"x\"]:.1f},{p1[\"z\"]:.1f}]->[{p2[\"x\"]:.1f},{p2[\"z\"]:.1f}]')
fusion = data.get('debug', {}).get('fusion', {})
if fusion:
    print(f'Fusion: boosted={fusion.get(\"lines_boosted\",0)} demoted={fusion.get(\"lines_demoted\",0)} reclass={fusion.get(\"lines_reclassified\",0)} bt={fusion.get(\"boundary_trace_emitted\",0)}')
"

# Render ridge-only overlay
python3 "$SCRIPT_DIR/render_overlay.py" \
  "$RESULTS_DIR/line_audit_output.json" \
  "$RESULTS_DIR/agent_overlay_ridges.png" \
  --ridges-only \
  --title "[$AGENT] Ridge Overlay — $PROJECT_ID"

# Render full overlay
python3 "$SCRIPT_DIR/render_overlay.py" \
  "$RESULTS_DIR/line_audit_output.json" \
  "$RESULTS_DIR/agent_overlay_full.png" \
  --title "[$AGENT] Full Overlay — $PROJECT_ID"

echo "[$AGENT] Results saved to $RESULTS_DIR/"
echo "  - line_audit_output.json"
echo "  - agent_overlay_ridges.png"
echo "  - agent_overlay_full.png"
