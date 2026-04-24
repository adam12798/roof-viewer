#!/usr/bin/env bash
# Smoke test for /api/line-audit response shape.
# Requires: CRM on :3001, ML on :5001, jq installed.
# Usage: bash smoke_test_line_audit.sh [projectId]

set -euo pipefail

PROJECT_ID="${1:-mn9805q0ddm}"
CRM_URL="http://127.0.0.1:3001"

echo "[smoke] POST /api/line-audit (project=$PROJECT_ID)..."
RESP=$(curl -s -w "\n%{http_code}" -X POST "$CRM_URL/api/line-audit" \
  -H "Content-Type: application/json" \
  -d "{
    \"projectId\": \"$PROJECT_ID\",
    \"design_center\": {\"lat\": 42.6, \"lng\": -71.3},
    \"image\": {\"width_px\": 640, \"height_px\": 640},
    \"options\": {\"pipeline_mode\": \"ml_v2\"}
  }")

HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

echo "[smoke] HTTP $HTTP_CODE"

if [ "$HTTP_CODE" != "200" ]; then
  echo "[FAIL] Expected 200, got $HTTP_CODE"
  echo "$BODY" | jq . 2>/dev/null || echo "$BODY"
  exit 1
fi

# Validate response shape
ERRORS=""

has_field() {
  echo "$BODY" | jq -e ".$1" > /dev/null 2>&1 || ERRORS="$ERRORS\n  missing: $1"
}

has_field "audit_lines"
has_field "summary"
has_field "summary.total"
has_field "summary.ridge"
has_field "summary.eave"
has_field "summary.rake"
has_field "debug"
has_field "debug.usable_gate_score"
has_field "debug.plane_count"
has_field "debug.status"

# Check audit_lines array structure (if non-empty)
LINE_COUNT=$(echo "$BODY" | jq '.audit_lines | length')
echo "[smoke] audit_lines count: $LINE_COUNT"

if [ "$LINE_COUNT" -gt 0 ]; then
  FIRST=$(echo "$BODY" | jq '.audit_lines[0]')
  for f in line_id type p1 p2 confidence length_m source target_building_supported; do
    echo "$FIRST" | jq -e ".$f" > /dev/null 2>&1 || ERRORS="$ERRORS\n  audit_lines[0] missing: $f"
  done
  echo "$FIRST" | jq -e ".p1.x" > /dev/null 2>&1 || ERRORS="$ERRORS\n  audit_lines[0].p1 missing .x"
  echo "$FIRST" | jq -e ".p1.z" > /dev/null 2>&1 || ERRORS="$ERRORS\n  audit_lines[0].p1 missing .z"
fi

SUMMARY=$(echo "$BODY" | jq '.summary')
echo "[smoke] summary: $SUMMARY"

if [ -n "$ERRORS" ]; then
  echo -e "[FAIL] Shape validation errors:$ERRORS"
  exit 1
fi

echo "[PASS] Response shape valid. $LINE_COUNT audit lines returned."
echo "[smoke] debug.status: $(echo "$BODY" | jq -r '.debug.status')"
echo "[smoke] debug.pipeline_time_s: $(echo "$BODY" | jq -r '.debug.pipeline_time_s')"
