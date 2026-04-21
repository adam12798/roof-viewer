#!/usr/bin/env node
/*
 * V3P4.4 — Geometry correction invariants test.
 *
 *   A. Slope direction correction
 *   B. Required split enforcement
 *   C. Missing major plane recovery
 *   D. Height consistency correction
 *   E. Dominant main-body preservation
 *
 * Usage:
 *   node tools/v3p4_4_invariants_test.js
 *
 * No external deps. Requires server.js (gated — import does NOT start the
 * HTTP server).
 */

'use strict';

const path = require('path');
const serverModule = require(path.join(__dirname, '..', 'server.js'));

const {
  v3p4_4CorrectSlopeDirection,
  v3p4_4CorrectHeightRelationships,
  v3p4_4ForceRequiredSplits,
  v3p4_4RecoverMissingPlanes,
  v3p4_4RunGeometryCorrection,
  v3p4_4DownslopeXZ,
  v3p4_1OrientationToNormal,
} = serverModule;

let PASS = 0;
let FAIL = 0;
const FAIL_LINES = [];

function assert(name, cond, detail) {
  if (cond) {
    PASS++;
    console.log('  PASS  ' + name);
  } else {
    FAIL++;
    const line = '  FAIL  ' + name + (detail ? ' — ' + detail : '');
    FAIL_LINES.push(line);
    console.log(line);
  }
}

// Minimum `v3p3BuildPolyAdjacency`-compatible structure: server.js exposes
// only public helpers, but the slope/height correctors accept an adjacency
// builder as an argument in production. For these tests we exercise those
// correctors via v3p4_4RunGeometryCorrection which uses the real builder
// internally, OR call the private helpers through the exposed public helpers
// (they all take their adjacency as an arg and the real adjacency builder is
// re-used inside the orchestrator).

// ── Fixtures ────────────────────────────────────────────────────────────────

// Two-polygon gable: polygonA faces south (180°), polygonB should face north (0°).
// Simulate an incorrectly-fitted polygonB facing south too.
function makeGablePair({ bothFaceSouth = false } = {}) {
  const polyA = {
    polygon_idx: 0,
    vertices: [{x:-5,z:-5},{x:5,z:-5},{x:5,z:0},{x:-5,z:0}],
    pitch: 25, azimuth: 180, height: 5,
    fit_rmse: 0.3,
    source_face_indices: [0], v3p1_face_indices: [0],
    dominant_plane_flag: false, dominant_lineage_source: 'none',
    validation_reasons: [],
  };
  const polyB = {
    polygon_idx: 1,
    vertices: [{x:-5,z:0},{x:5,z:0},{x:5,z:5},{x:-5,z:5}],
    pitch: 25, azimuth: bothFaceSouth ? 180 : 0, height: 5,
    fit_rmse: 0.3,
    source_face_indices: [1], v3p1_face_indices: [1],
    dominant_plane_flag: false, dominant_lineage_source: 'none',
    validation_reasons: [],
  };
  return [polyA, polyB];
}

// Ridge edge between two polygons (face_a_idx=0, face_b_idx=1).
function makeRidgeEdge(fusedScore) {
  return {
    edge_idx: 0,
    face_a_idx: 0, face_b_idx: 1,
    edge_type_v3p3: 'ridge',
    fused_edge_score: fusedScore,
  };
}

// ── T1 — Slope direction correction ─────────────────────────────────────────

function testT1_SlopeCorrection() {
  console.log('T1. Slope direction correction (A)');

  // Convention (verified from v3p4_4DownslopeXZ):
  //   azimuth=0   → downslope (0, -1) → points -z
  //   azimuth=180 → downslope (0, +1) → points +z
  //
  // For a ridge at z=0 between polyA (z<0) and polyB (z>0), the polygons'
  // downslope should point AWAY from the ridge:
  //   polyA (z<0 centroid): correct azimuth = 0   (downslope -z)
  //   polyB (z>0 centroid): correct azimuth = 180 (downslope +z)
  const edgesCorrect = [makeRidgeEdge(0.8)];

  // Case A: truly correct pair — no change.
  const truePair = [
    { ...makeGablePair({ bothFaceSouth: false })[0], azimuth: 0 },
    { ...makeGablePair({ bothFaceSouth: false })[1], azimuth: 180 },
  ];
  const run2 = v3p4_4RunGeometryCorrection(truePair, edgesCorrect, null, null);
  assert('T1.d truly-correct pair: 0 slope corrections',
    run2.slope_direction_corrections === 0,
    'got ' + run2.slope_direction_corrections);

  // Case B: two-wrong-slopes pair — `makeGablePair({ bothFaceSouth: false })`
  // produces polyA=180, polyB=0, which are BOTH flipped by the convention
  // above. Orchestrator should fix both.
  const wrongPair = makeGablePair({ bothFaceSouth: false });
  const edgesWrong = [makeRidgeEdge(0.8)];
  const run3 = v3p4_4RunGeometryCorrection(wrongPair, edgesWrong, null, null);
  assert('T1.e two-wrong-slopes pair: corrections applied',
    run3.slope_direction_corrections >= 1,
    'got ' + run3.slope_direction_corrections);
  assert('T1.f polyA azimuth corrected to 0', wrongPair[0].azimuth === 0,
    'got ' + wrongPair[0].azimuth);
  assert('T1.g polyB azimuth corrected to 180', wrongPair[1].azimuth === 180,
    'got ' + wrongPair[1].azimuth);
  assert('T1.h slope_correction_applied flag set', wrongPair[0].slope_correction_applied === true);

  // Case D: fused score too low → no correction.
  const weakPair = makeGablePair({ bothFaceSouth: false });
  const weakEdges = [makeRidgeEdge(0.30)]; // below V3P4_4_SLOPE_FLIP_MIN_FUSED=0.60
  const run4 = v3p4_4RunGeometryCorrection(weakPair, weakEdges, null, null);
  assert('T1.i low-fused ridge: no corrections', run4.slope_direction_corrections === 0);

  // Case E: dominant polygon never flipped.
  const domPair = makeGablePair({ bothFaceSouth: false });
  domPair[0].dominant_plane_flag = true;
  domPair[0].dominant_lineage_source = 'v3p1_inherited';
  const run5 = v3p4_4RunGeometryCorrection(domPair, edgesWrong, null, null);
  // polyA was wrong but dominant — should NOT be flipped.
  assert('T1.j dominant polygon never flipped', domPair[0].azimuth === 180);
  // polyB was also wrong — should still be flipped.
  assert('T1.k non-dominant partner still flipped', domPair[1].azimuth === 180);

  // Cross-check helper.
  const n = v3p4_4DownslopeXZ(180);
  assert('T1.l downslopeXZ(180) ≈ (0, 1)',
    Math.abs(n.x) < 1e-9 && Math.abs(n.z - 1) < 1e-9);
}

// ── T2 — Height consistency correction ──────────────────────────────────────

function testT2_HeightConsistency() {
  console.log('T2. Height consistency (D)');

  // Two polygons sharing a ridge with heights 5 and 7 — should align to 6.
  const pair = makeGablePair({ bothFaceSouth: false });
  pair[0].height = 5;
  pair[1].height = 7;
  const edges = [makeRidgeEdge(0.8)];
  const run = v3p4_4RunGeometryCorrection(pair, edges, null, null);
  assert('T2.a height aligned on ridge', run.height_consistency_corrections === 1);
  assert('T2.b both heights now = 6', pair[0].height === 6 && pair[1].height === 6);
  assert('T2.c polyA records height_before_v3p4_4', pair[0].height_before_v3p4_4 === 5);
  assert('T2.d polyB records height_before_v3p4_4', pair[1].height_before_v3p4_4 === 7);

  // Diff below threshold → no correction.
  const close = makeGablePair({ bothFaceSouth: false });
  close[0].height = 5.0;
  close[1].height = 5.2;
  const run2 = v3p4_4RunGeometryCorrection(close, edges, null, null);
  assert('T2.e small height diff: no correction', run2.height_consistency_corrections === 0);

  // Diff too large → no correction (probably legitimate).
  const far = makeGablePair({ bothFaceSouth: false });
  far[0].height = 5;
  far[1].height = 15;
  const run3 = v3p4_4RunGeometryCorrection(far, edges, null, null);
  assert('T2.f huge height diff: no correction', run3.height_consistency_corrections === 0);

  // Dominant polygon's height anchors the non-dominant one.
  const domAnchor = makeGablePair({ bothFaceSouth: false });
  domAnchor[0].height = 5;
  domAnchor[1].height = 8;
  domAnchor[0].dominant_plane_flag = true;
  domAnchor[0].dominant_lineage_source = 'v3p1_inherited';
  const run4 = v3p4_4RunGeometryCorrection(domAnchor, edges, null, null);
  assert('T2.g dominant anchors height', domAnchor[0].height === 5 && domAnchor[1].height === 5);

  // Non-ridge edge → not corrected.
  const seamEdges = [{ ...edges[0], edge_type_v3p3: 'seam' }];
  const seamPair = makeGablePair({ bothFaceSouth: false });
  seamPair[0].height = 5; seamPair[1].height = 7;
  const run5 = v3p4_4RunGeometryCorrection(seamPair, seamEdges, null, null);
  assert('T2.h seam edge: no height correction', run5.height_consistency_corrections === 0);
}

// ── T3 — Missing plane recovery (feature-check; no real DSM) ────────────────

function testT3_MissingPlaneRecovery() {
  console.log('T3. Missing plane recovery (C)');

  // Without a grid, recovery must safely no-op.
  const pair = makeGablePair({ bothFaceSouth: false });
  const edges = [makeRidgeEdge(0.8)];
  const run = v3p4_4RunGeometryCorrection(pair, edges, null, null);
  assert('T3.a no grid: 0 recoveries', run.missing_plane_recoveries === 0);
  assert('T3.b no grid: missing_plane_candidates is empty', Array.isArray(run.missing_plane_candidates) && run.missing_plane_candidates.length === 0);

  // With an empty grid (all NaN) — still 0.
  const emptyGrid = new Float32Array(281 * 281);
  emptyGrid.fill(NaN);
  const pair2 = makeGablePair({ bothFaceSouth: false });
  const run2 = v3p4_4RunGeometryCorrection(pair2, edges, emptyGrid, null);
  assert('T3.c all-NaN grid: 0 recoveries', run2.missing_plane_recoveries === 0);
}

// ── T4 — Required split enforcement (feature-check) ─────────────────────────

function testT4_RequiredSplit() {
  console.log('T4. Required split enforcement (B)');

  // Without grid / v3p3Internal, no split.
  const pair = makeGablePair({ bothFaceSouth: false });
  const run = v3p4_4RunGeometryCorrection(pair, [], null, null);
  assert('T4.a no grid / no internal: 0 forced splits', run.forced_required_splits === 0);

  // Dominant polygon is never force-split. Build synthetic minimal state
  // where v3p3Internal flags polygon 0 with high variance but polygon 0 is
  // dominant. Verify the split is blocked with reason.
  const fakeGrid = new Float32Array(281 * 281);
  fakeGrid.fill(NaN);
  const internal = {
    per_polygon: [
      { polygon_idx: 0, flagged: true, max_azimuth_variance: 120, max_pitch_variance: 5 }
    ],
  };
  const polys = [{
    polygon_idx: 0,
    vertices: [{x:-5,z:-5},{x:5,z:-5},{x:5,z:5},{x:-5,z:5}],
    pitch: 25, azimuth: 180, height: 5, fit_rmse: 0.4,
    source_face_indices: [0], v3p1_face_indices: [0],
    dominant_plane_flag: true, dominant_lineage_source: 'v3p1_inherited',
    validation_reasons: [],
  }];
  const runForce = v3p4_4RunGeometryCorrection(polys, [], fakeGrid, internal);
  assert('T4.b dominant polygon blocks forced split', runForce.forced_required_splits === 0);
  const blockReasons = (runForce.required_split_blocks || []).map(b => b.reason);
  assert('T4.c block reason includes dominant_main_body_preserved',
    blockReasons.includes('dominant_main_body_preserved'));
}

// ── T5 — Orchestrator + dominant preservation ───────────────────────────────

function testT5_OrchestratorAndPreservation() {
  console.log('T5. Orchestrator + dominant main body preservation');

  // v3p4_1_rollback path: orchestrator not called by polygonConstructionAssessment
  // in that case — but the helpers should never mutate polygons that carry
  // dominant_plane_flag=true. Drive three polygons through orchestrator with
  // one dominant; assert dominant is untouched.
  const polys = [
    { polygon_idx: 0, vertices: [{x:-5,z:-5},{x:5,z:-5},{x:5,z:0},{x:-5,z:0}],
      pitch: 25, azimuth: 180, height: 5, fit_rmse: 0.3,
      source_face_indices: [0], v3p1_face_indices: [0],
      dominant_plane_flag: true, dominant_lineage_source: 'v3p1_inherited',
      validation_reasons: [] },
    { polygon_idx: 1, vertices: [{x:-5,z:0},{x:5,z:0},{x:5,z:5},{x:-5,z:5}],
      pitch: 25, azimuth: 0, height: 8, fit_rmse: 0.3,
      source_face_indices: [1], v3p1_face_indices: [1],
      dominant_plane_flag: false, dominant_lineage_source: 'none',
      validation_reasons: [] },
  ];
  const edges = [makeRidgeEdge(0.8)];
  const r = v3p4_4RunGeometryCorrection(polys, edges, null, null);

  // polyA is dominant. Its azimuth=180 is wrong by the downslope rule, but
  // dominant polygons must NOT be flipped.
  assert('T5.a dominant polyA azimuth preserved (180)', polys[0].azimuth === 180);
  // polyB is at az=0, which is also wrong. Non-dominant → flipped to 180.
  assert('T5.b non-dominant polyB azimuth flipped to 180', polys[1].azimuth === 180);

  // Height: polyA=5 (dominant), polyB=8. Should anchor to polyA's height.
  assert('T5.c dominant anchors height', polys[0].height === 5 && polys[1].height === 5);

  // Orchestrator's v3p4_4_applied is true when anything fired.
  assert('T5.d v3p4_4_applied true when corrections fired', r.v3p4_4_applied === true);

  // Initial/final dominant count preserved.
  assert('T5.e dominant count preserved', r.dominant_main_body_preserved_count === 1);

  // No corrections when inputs are empty.
  const empty = v3p4_4RunGeometryCorrection([], [], null, null);
  assert('T5.f empty polygons: v3p4_4_applied=false', empty.v3p4_4_applied === false);

  // Orchestrator returns all 4 correction counters as numbers.
  assert('T5.g slope_direction_corrections is number', typeof r.slope_direction_corrections === 'number');
  assert('T5.h forced_required_splits is number', typeof r.forced_required_splits === 'number');
  assert('T5.i missing_plane_recoveries is number', typeof r.missing_plane_recoveries === 'number');
  assert('T5.j height_consistency_corrections is number', typeof r.height_consistency_corrections === 'number');
}

// ── Runner ─────────────────────────────────────────────────────────────────

(function main() {
  console.log('');
  console.log('V3P4.4 geometry-correction invariants');
  console.log('======================================');
  try { testT1_SlopeCorrection(); } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T1 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }
  try { testT2_HeightConsistency(); } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T2 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }
  try { testT3_MissingPlaneRecovery(); } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T3 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }
  try { testT4_RequiredSplit(); } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T4 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }
  try { testT5_OrchestratorAndPreservation(); } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T5 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }

  console.log('');
  console.log('Summary: ' + PASS + ' passed, ' + FAIL + ' failed');
  if (FAIL > 0) {
    console.log('');
    for (const line of FAIL_LINES) console.log(line);
    process.exit(1);
  }
  process.exit(0);
})();
