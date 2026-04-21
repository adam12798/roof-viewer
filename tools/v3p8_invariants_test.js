#!/usr/bin/env node
/*
 * V3P8 — Skeleton-driven geometry correction invariants test.
 *
 *   T1. Geometric helpers (closestPointOnSegment, centroidToRidgeVector).
 *   T2. Trust gate: eligible vs skip reasons.
 *   T3. Path B slope correction: fires on main/secondary, respects dominant,
 *       respects V3P4.4 prior correction.
 *   T4. Path D off-skeleton flagging + conservative suppression.
 *   T5. Path E ridge opposition enforcement.
 *   T6. Orchestrator: applied vs skipped, debug shape, 0-skeleton no-op.
 *
 * Usage:
 *   node tools/v3p8_invariants_test.js
 */

'use strict';

const path = require('path');
const s = require(path.join(__dirname, '..', 'server.js'));

const {
  v3p8RunSkeletonCorrection,
  v3p8ScoreSkeletonTrust,
  v3p8CorrectSlopeFromRidge,
  v3p8DetectOffSkeletonPlanes,
  v3p8EnforceRidgeOpposition,
  v3p8ComputeCentroidToRidgeVector,
  v3p8ClosestPointOnSegment,
  v3p7RunSkeleton,
} = s;

let PASS = 0, FAIL = 0;
const FAIL_LINES = [];
function assert(name, cond, detail) {
  if (cond) { PASS++; console.log('  PASS  ' + name); }
  else {
    FAIL++;
    const line = '  FAIL  ' + name + (detail ? ' — ' + detail : '');
    FAIL_LINES.push(line);
    console.log(line);
  }
}

// ── Fixtures ────────────────────────────────────────────────────────────────

// A gable pair where polyA (z<0) is correctly facing north (az=0, downslope -z)
// and polyB (z>0) is correctly facing south (az=180, downslope +z). Ridge line
// runs along X at z=0.
function correctGablePair() {
  return [
    {
      polygon_idx: 0,
      vertices: [{x:-5,z:-5},{x:5,z:-5},{x:5,z:0},{x:-5,z:0}],
      pitch: 25, azimuth: 0, height: 5, fit_rmse: 0.3,
      source_face_indices: [0], v3p1_face_indices: [0],
      dominant_plane_flag: false, dominant_lineage_source: 'none',
      validation_reasons: [],
    },
    {
      polygon_idx: 1,
      vertices: [{x:-5,z:0},{x:5,z:0},{x:5,z:5},{x:-5,z:5}],
      pitch: 25, azimuth: 180, height: 5, fit_rmse: 0.3,
      source_face_indices: [1], v3p1_face_indices: [1],
      dominant_plane_flag: false, dominant_lineage_source: 'none',
      validation_reasons: [],
    },
  ];
}

function ridgeEdge(face_a_idx, face_b_idx, fused) {
  return {
    edge_idx: face_a_idx * 10 + face_b_idx,
    face_a_idx, face_b_idx,
    edge_type_v3p3: 'ridge',
    fused_edge_score: fused == null ? 0.8 : fused,
  };
}

// Run v3p7 to populate skeleton assignments on the polygons; return the debug.
function prepSkeleton(polygons, edges) {
  return v3p7RunSkeleton(polygons, edges);
}

// ── T1 — Geometric helpers ──────────────────────────────────────────────────

function testT1_Helpers() {
  console.log('T1. Geometric helpers');

  // Closest point on segment
  const p1 = { x: 0, z: 0 }, p2 = { x: 10, z: 0 };
  const r1 = v3p8ClosestPointOnSegment({ x: 5, z: 3 }, p1, p2);
  assert('T1.a closest point perpendicular projection',
    Math.abs(r1.point.x - 5) < 1e-9 && Math.abs(r1.point.z) < 1e-9);
  const r2 = v3p8ClosestPointOnSegment({ x: -5, z: 0 }, p1, p2);
  assert('T1.b closest point clamps to p1 when beyond',
    Math.abs(r2.point.x - 0) < 1e-9 && r2.t === 0);

  // Centroid-to-ridge vector (single segment)
  const ridge = {
    member_segments: [{ p1: { x: -5, z: 0 }, p2: { x: 5, z: 0 } }],
  };
  const vec = v3p8ComputeCentroidToRidgeVector({ x: 0, z: -2.5 }, ridge);
  assert('T1.c centroid-to-ridge: vector points from centroid to ridge',
    Math.abs(vec.vz - 2.5) < 1e-9 && Math.abs(vec.vx) < 1e-9,
    'got vx=' + vec.vx + ' vz=' + vec.vz);
  assert('T1.d centroid-to-ridge: mag = 2.5', Math.abs(vec.mag - 2.5) < 1e-9);

  // Null inputs → null
  assert('T1.e null ridge → null', v3p8ComputeCentroidToRidgeVector({x:0,z:0}, null) === null);
  assert('T1.f empty member_segments → null',
    v3p8ComputeCentroidToRidgeVector({x:0,z:0}, { member_segments: [] }) === null);

  // Centroid-to-ridge for multi-segment: picks CLOSEST segment
  const multi = {
    member_segments: [
      { p1: { x: -5, z: 0 }, p2: { x: 5, z: 0 } },      // at z=0
      { p1: { x: -5, z: 10 }, p2: { x: 5, z: 10 } },    // at z=10
    ],
  };
  const vec2 = v3p8ComputeCentroidToRidgeVector({ x: 0, z: -2 }, multi);
  assert('T1.g multi-segment: closest segment picked (z=0, not z=10)',
    vec2.closest_point.z === 0);
}

// ── T2 — Trust gate ────────────────────────────────────────────────────────

function testT2_TrustGate() {
  console.log('T2. Trust gate');

  // Null v3p7 debug → not eligible
  const r1 = v3p8ScoreSkeletonTrust(null, correctGablePair());
  assert('T2.a null v3p7 → not eligible', r1.eligible === false);
  assert('T2.b reason is v3p7_not_applied', r1.reason === 'v3p7_not_applied');

  // v3p7_applied=false → not eligible
  const r2 = v3p8ScoreSkeletonTrust({ v3p7_applied: false }, correctGablePair());
  assert('T2.c v3p7_applied=false → not eligible', r2.eligible === false);

  // Empty ridges → not eligible, reason=no_skeleton_elements
  const empty7 = {
    v3p7_applied: true,
    ridges: [],
    hierarchy_levels: { main: 0, secondary: 0, tertiary: 0 },
    planes_with_ridge_assignment: 0,
    skeleton_conflicts: [],
    edge_type_breakdown: { ridge: 0, valley: 0, hip: 0 },
  };
  const r3 = v3p8ScoreSkeletonTrust(empty7, correctGablePair());
  assert('T2.d no ridges → skip', r3.eligible === false && r3.reason === 'no_skeleton_elements');

  // 1 tertiary ridge only → not eligible, reason=no_main_ridge
  const noMain = {
    v3p7_applied: true,
    ridges: [{ hierarchy_level: 'tertiary', edge_type: 'ridge' }],
    hierarchy_levels: { main: 0, secondary: 0, tertiary: 1 },
    planes_with_ridge_assignment: 2,
    skeleton_conflicts: [],
    edge_type_breakdown: { ridge: 1, valley: 0, hip: 0 },
  };
  const polys = correctGablePair();
  polys[0].v3p7_assigned_ridge_ids = [0]; polys[1].v3p7_assigned_ridge_ids = [0];
  const r4 = v3p8ScoreSkeletonTrust(noMain, polys);
  assert('T2.e no main ridge → skip', r4.eligible === false && r4.reason === 'no_main_ridge');

  // Main ridge with sufficient coverage → eligible
  const good = {
    v3p7_applied: true,
    ridges: [{ hierarchy_level: 'main', edge_type: 'ridge' }],
    hierarchy_levels: { main: 1, secondary: 0, tertiary: 0 },
    planes_with_ridge_assignment: 2,
    skeleton_conflicts: [],
    edge_type_breakdown: { ridge: 1, valley: 0, hip: 0 },
  };
  const r5 = v3p8ScoreSkeletonTrust(good, polys);
  assert('T2.f main + 100% coverage → eligible', r5.eligible === true, 'reason=' + r5.reason);
  assert('T2.g trust score in (0, 1]', r5.score > 0 && r5.score <= 1);

  // Too many conflicts → not eligible
  const manyConflicts = {
    ...good,
    skeleton_conflicts: [{}, {}, {}, {}, {}],
  };
  const r6 = v3p8ScoreSkeletonTrust(manyConflicts, polys);
  assert('T2.h too many conflicts → skip', r6.eligible === false && r6.reason.startsWith('too_many_conflicts'));

  // Low coverage → not eligible
  const bigRoof = [...polys, ...polys.map((p, i) => ({ ...p, polygon_idx: 2 + i, v3p7_assigned_ridge_ids: [] })), ...polys.map((p, i) => ({ ...p, polygon_idx: 4 + i, v3p7_assigned_ridge_ids: [] }))];
  const lowCov = { ...good, planes_with_ridge_assignment: 1 };
  const r7 = v3p8ScoreSkeletonTrust(lowCov, bigRoof);
  assert('T2.i low coverage → skip', r7.eligible === false && r7.reason.startsWith('coverage_too_low'));
}

// ── T3 — Path B: slope correction ──────────────────────────────────────────

function testT3_SlopeCorrection() {
  console.log('T3. Path B: skeleton-backed slope correction');

  // Wrong-gable-pair fixture: polyA az=180 (flipped), polyB az=0 (flipped)
  // by the downslope-away-from-ridge rule. Both should be flipped by Path B.
  const polys = correctGablePair();
  polys[0].azimuth = 180; polys[1].azimuth = 0;
  const sk = prepSkeleton(polys, [ridgeEdge(0, 1, 0.8)]);
  // Synthetic main-level ridge (V3P7 picks the only ridge and classifies main)
  assert('T3.a skeleton has exactly 1 main ridge',
    sk.ridges.length === 1 && sk.ridges[0].hierarchy_level === 'main');

  const { corrections } = v3p8CorrectSlopeFromRidge(polys, sk);
  assert('T3.b 2 non-dominant wrong-slope polygons → 2 flips', corrections.length === 2);
  assert('T3.c polyA azimuth = 0 after flip', polys[0].azimuth === 0);
  assert('T3.d polyB azimuth = 180 after flip', polys[1].azimuth === 180);
  assert('T3.e v3p8_slope_corrected_by_skeleton flag set', polys[0].v3p8_slope_corrected_by_skeleton === true);

  // Dominant polygon: never flipped.
  const polysDom = correctGablePair();
  polysDom[0].azimuth = 180; polysDom[1].azimuth = 0;
  polysDom[0].dominant_plane_flag = true;
  polysDom[0].dominant_lineage_source = 'v3p1_inherited';
  const sk2 = prepSkeleton(polysDom, [ridgeEdge(0, 1, 0.8)]);
  const r2 = v3p8CorrectSlopeFromRidge(polysDom, sk2);
  assert('T3.f dominant polygon not flipped', polysDom[0].azimuth === 180);
  assert('T3.g non-dominant partner still flipped', polysDom[1].azimuth === 180);

  // V3P4.4-already-corrected polygon: skipped by V3P8.
  const polysPrior = correctGablePair();
  polysPrior[0].azimuth = 180; polysPrior[1].azimuth = 0;
  polysPrior[0].validation_reasons.push('v3p4_4_slope_direction_corrected');
  const sk3 = prepSkeleton(polysPrior, [ridgeEdge(0, 1, 0.8)]);
  v3p8CorrectSlopeFromRidge(polysPrior, sk3);
  assert('T3.h V3P4.4-corrected polygon skipped by V3P8 (azimuth unchanged)',
    polysPrior[0].azimuth === 180);
  assert('T3.i non-marked partner still flipped', polysPrior[1].azimuth === 180);

  // Tertiary ridge: Path B should NOT fire.
  const polysTert = correctGablePair();
  polysTert[0].azimuth = 180; polysTert[1].azimuth = 0;
  // Build a skeleton and force its ridge to tertiary by supplying a skeleton
  // object directly (skip v3p7 which would pick main).
  const fakeSk = {
    v3p7_applied: true,
    ridges: [{
      ridge_id: 0, hierarchy_level: 'tertiary', edge_type: 'ridge',
      member_segments: [{ p1: { x: -5, z: 0 }, p2: { x: 5, z: 0 } }],
      connected_plane_indices: [0, 1],
    }],
  };
  polysTert[0].v3p7_primary_ridge_id = 0; polysTert[0].v3p7_hierarchy_level = 'tertiary';
  polysTert[0].v3p7_assigned_ridge_ids = [0];
  polysTert[1].v3p7_primary_ridge_id = 0; polysTert[1].v3p7_hierarchy_level = 'tertiary';
  polysTert[1].v3p7_assigned_ridge_ids = [0];
  const r4 = v3p8CorrectSlopeFromRidge(polysTert, fakeSk);
  assert('T3.j tertiary ridge: no corrections', r4.corrections.length === 0);

  // Valley skeleton: Path B must NOT fire (valleys have inverted downslope
  // convention — slope points INTO valley, not away from it). A 0.85→0.36
  // regression on 225 Gibson proved this in live testing.
  const polysValley = correctGablePair();
  polysValley[0].azimuth = 180; polysValley[1].azimuth = 0;
  const fakeValleySk = {
    v3p7_applied: true,
    ridges: [{
      ridge_id: 0, hierarchy_level: 'main', edge_type: 'valley',
      member_segments: [{ p1: { x: -5, z: 0 }, p2: { x: 5, z: 0 } }],
      connected_plane_indices: [0, 1],
    }],
  };
  polysValley[0].v3p7_primary_ridge_id = 0; polysValley[0].v3p7_hierarchy_level = 'main';
  polysValley[0].v3p7_assigned_ridge_ids = [0];
  polysValley[1].v3p7_primary_ridge_id = 0; polysValley[1].v3p7_hierarchy_level = 'main';
  polysValley[1].v3p7_assigned_ridge_ids = [0];
  const r5 = v3p8CorrectSlopeFromRidge(polysValley, fakeValleySk);
  assert('T3.k valley skeleton: NO corrections (inverted downslope convention)',
    r5.corrections.length === 0,
    'got ' + r5.corrections.length + ' flips');

  // Hip skeleton: Path B must NOT fire either.
  const polysHip = correctGablePair();
  polysHip[0].azimuth = 180; polysHip[1].azimuth = 0;
  const fakeHipSk = {
    v3p7_applied: true,
    ridges: [{
      ridge_id: 0, hierarchy_level: 'main', edge_type: 'hip',
      member_segments: [{ p1: { x: -5, z: 0 }, p2: { x: 5, z: 0 } }],
      connected_plane_indices: [0, 1],
    }],
  };
  polysHip[0].v3p7_primary_ridge_id = 0; polysHip[0].v3p7_hierarchy_level = 'main';
  polysHip[0].v3p7_assigned_ridge_ids = [0];
  polysHip[1].v3p7_primary_ridge_id = 0; polysHip[1].v3p7_hierarchy_level = 'main';
  polysHip[1].v3p7_assigned_ridge_ids = [0];
  const r6 = v3p8CorrectSlopeFromRidge(polysHip, fakeHipSk);
  assert('T3.l hip skeleton: NO corrections (out of scope)',
    r6.corrections.length === 0,
    'got ' + r6.corrections.length + ' flips');
}

// ── T4 — Path D: off-skeleton detection + suppression ──────────────────────

function testT4_OffSkeleton() {
  console.log('T4. Path D: off-skeleton detection + conservative suppression');

  // Two skeleton-attached polygons + one off-skeleton small polygon whose
  // centroid falls inside a skeleton polygon → suppressed.
  const polys = correctGablePair();
  const redundant = {
    polygon_idx: 2,
    // Small polygon whose centroid (at 0, -2.5) is inside polyA's footprint.
    vertices: [{x:-0.5,z:-3},{x:0.5,z:-3},{x:0.5,z:-2},{x:-0.5,z:-2}], // area 1 m²
    pitch: 25, azimuth: 180, height: 5, fit_rmse: 0.3,
    source_face_indices: [2], v3p1_face_indices: [2],
    dominant_plane_flag: false, dominant_lineage_source: 'none',
    validation_reasons: [],
    // No skeleton assignment
    v3p7_assigned_ridge_ids: [],
    v3p7_primary_ridge_id: null,
    v3p7_hierarchy_level: null,
  };
  polys.push(redundant);
  // Ensure polys 0/1 have skeleton assignment (would normally be set by v3p7)
  polys[0].v3p7_assigned_ridge_ids = [0]; polys[1].v3p7_assigned_ridge_ids = [0];

  const r = v3p8DetectOffSkeletonPlanes(polys);
  assert('T4.a 1 flagged off-skeleton', r.flagged_count === 1);
  assert('T4.b 1 suppressed (small + centroid inside)', r.suppressed.length === 1);
  assert('T4.c suppressed polygon validation_decision=suppress',
    redundant.validation_decision === 'suppress');
  assert('T4.d redundant.v3p8_off_skeleton_flag=true',
    redundant.v3p8_off_skeleton_flag === true);
  assert('T4.e action=suppressed_redundant',
    redundant.v3p8_off_skeleton_action === 'suppressed_redundant');
  assert('T4.f skeleton-attached polygons have skeleton_supported_flag=true',
    polys[0].v3p8_skeleton_supported_flag === true);

  // Off-skeleton but LARGE polygon (>5 m²) → flagged only, not suppressed.
  const polys2 = correctGablePair();
  const big = {
    polygon_idx: 2,
    vertices: [{x:-5,z:10},{x:5,z:10},{x:5,z:15},{x:-5,z:15}], // 50 m²
    pitch: 25, azimuth: 180, height: 5, fit_rmse: 0.3,
    source_face_indices: [2], v3p1_face_indices: [2],
    dominant_plane_flag: false, dominant_lineage_source: 'none',
    validation_reasons: [],
    v3p7_assigned_ridge_ids: [],
    v3p7_primary_ridge_id: null,
    v3p7_hierarchy_level: null,
  };
  polys2.push(big);
  polys2[0].v3p7_assigned_ridge_ids = [0]; polys2[1].v3p7_assigned_ridge_ids = [0];
  const r2 = v3p8DetectOffSkeletonPlanes(polys2);
  assert('T4.g large off-skeleton: flagged but NOT suppressed', r2.suppressed.length === 0);
  assert('T4.h action starts with flagged_only',
    (big.v3p8_off_skeleton_action || '').startsWith('flagged_only'));

  // Off-skeleton dominant polygon: never suppressed.
  const polys3 = correctGablePair();
  const domOff = {
    polygon_idx: 2,
    vertices: [{x:-0.5,z:-3},{x:0.5,z:-3},{x:0.5,z:-2},{x:-0.5,z:-2}],
    pitch: 25, azimuth: 180, height: 5, fit_rmse: 0.3,
    source_face_indices: [2], v3p1_face_indices: [2],
    dominant_plane_flag: true, dominant_lineage_source: 'v3p1_inherited',
    validation_reasons: [],
    v3p7_assigned_ridge_ids: [],
    v3p7_primary_ridge_id: null,
    v3p7_hierarchy_level: null,
  };
  polys3.push(domOff);
  polys3[0].v3p7_assigned_ridge_ids = [0]; polys3[1].v3p7_assigned_ridge_ids = [0];
  const r3 = v3p8DetectOffSkeletonPlanes(polys3);
  assert('T4.i dominant off-skeleton: never suppressed', r3.suppressed.length === 0);
  assert('T4.j action=flagged_protected_dominant',
    domOff.v3p8_off_skeleton_action === 'flagged_protected_dominant');
}

// ── T5 — Path E: ridge opposition enforcement ─────────────────────────────

function testT5_RidgeOpposition() {
  console.log('T5. Path E: skeleton ridge opposition enforcement');

  // Two polygons attached to a main ridge, same azimuth → 1 flip.
  const polys = correctGablePair();
  polys[0].azimuth = 180; polys[1].azimuth = 180; // both face south
  const sk = prepSkeleton(polys, [ridgeEdge(0, 1, 0.8)]);
  const r = v3p8EnforceRidgeOpposition(polys, sk);
  assert('T5.a same-direction pair: 1 flip', r.flips.length === 1);
  // The flipped polygon's azimuth should now be 0 (opposite of 180).
  // Either polyA or polyB was flipped — find which.
  const aFlipped = polys[0].v3p8_slope_corrected_by_skeleton === true;
  const bFlipped = polys[1].v3p8_slope_corrected_by_skeleton === true;
  assert('T5.b exactly one polygon flipped', aFlipped !== bFlipped);
  assert('T5.c resulting pair opposes (az_diff 180)',
    Math.abs(polys[0].azimuth - polys[1].azimuth) === 180);

  // Opposite direction already: no flip.
  const polysOk = correctGablePair(); // polyA=0, polyB=180
  const sk2 = prepSkeleton(polysOk, [ridgeEdge(0, 1, 0.8)]);
  const r2 = v3p8EnforceRidgeOpposition(polysOk, sk2);
  assert('T5.d already-opposed pair: no flip', r2.flips.length === 0);

  // Valley edge (not ridge): no flip.
  const polysValley = correctGablePair();
  polysValley[0].azimuth = 180; polysValley[1].azimuth = 180;
  const sk3 = prepSkeleton(polysValley, [
    { edge_idx: 0, face_a_idx: 0, face_b_idx: 1, edge_type_v3p3: 'valley', fused_edge_score: 0.8 }
  ]);
  const r3 = v3p8EnforceRidgeOpposition(polysValley, sk3);
  assert('T5.e valley (not ridge): no flip', r3.flips.length === 0);

  // Dominant on both sides: no flip (can't flip a dominant).
  const polysDom = correctGablePair();
  polysDom[0].azimuth = 180; polysDom[1].azimuth = 180;
  polysDom[0].dominant_plane_flag = true;
  polysDom[1].dominant_plane_flag = true;
  const sk4 = prepSkeleton(polysDom, [ridgeEdge(0, 1, 0.8)]);
  const r4 = v3p8EnforceRidgeOpposition(polysDom, sk4);
  assert('T5.f both dominant: no flip', r4.flips.length === 0);
}

// ── T6 — Orchestrator: applied vs skipped ──────────────────────────────────

function testT6_Orchestrator() {
  console.log('T6. Orchestrator: applied vs skipped + debug shape');

  // Correct gable pair: trust passes, no corrections needed.
  const polys = correctGablePair();
  const sk = prepSkeleton(polys, [ridgeEdge(0, 1, 0.8)]);
  const dbg = v3p8RunSkeletonCorrection(polys, sk);
  assert('T6.a v3p8_applied=true', dbg.v3p8_applied === true);
  assert('T6.b correction applied (trust passed)', dbg.v3p8_skeleton_correction_applied === true);
  assert('T6.c 0 slope corrections on already-correct pair',
    dbg.ridge_driven_slope_corrections === 0);
  assert('T6.d per_polygon has 2 rows', dbg.per_polygon.length === 2);

  // 0-skeleton: skipped with explicit reason.
  const isolated = [{
    polygon_idx: 0,
    vertices: [{x:0,z:0},{x:1,z:0},{x:1,z:1},{x:0,z:1}],
    pitch: 25, azimuth: 0, height: 5, fit_rmse: 0.3,
    source_face_indices: [0], v3p1_face_indices: [0],
    dominant_plane_flag: false, dominant_lineage_source: 'none',
    validation_reasons: [],
  }];
  const skEmpty = prepSkeleton(isolated, []);
  const dbg2 = v3p8RunSkeletonCorrection(isolated, skEmpty);
  assert('T6.e 0-skeleton: v3p8_applied=true', dbg2.v3p8_applied === true);
  assert('T6.f 0-skeleton: correction SKIPPED',
    dbg2.v3p8_skeleton_correction_applied === false);
  assert('T6.g skip reason is populated',
    typeof dbg2.v3p8_skeleton_correction_skipped_reason === 'string' &&
    dbg2.v3p8_skeleton_correction_skipped_reason.length > 0);
  assert('T6.h 0 slope corrections when skipped',
    dbg2.ridge_driven_slope_corrections === 0);
  assert('T6.i 0 off-skeleton removals when skipped',
    dbg2.off_skeleton_planes_removed === 0);

  // Empty polygons: no-op, applied=false.
  const dbg3 = v3p8RunSkeletonCorrection([], { v3p7_applied: true, ridges: [] });
  assert('T6.j empty polygons: v3p8_applied=false', dbg3.v3p8_applied === false);

  // Thresholds block present.
  assert('T6.k thresholds block present',
    dbg.thresholds && typeof dbg.thresholds.slope_flip_dot_threshold === 'number');

  // Local rebuild deferred: count always 0 in V3P8.
  assert('T6.l skeleton_guided_local_rebuilds = 0 (deferred)',
    dbg.skeleton_guided_local_rebuilds === 0);

  // Trust breakdown present when eligible.
  assert('T6.m trust_breakdown populated', dbg.trust_breakdown !== null);
}

// ── Runner ─────────────────────────────────────────────────────────────────

(function main() {
  console.log('');
  console.log('V3P8 skeleton-driven correction invariants');
  console.log('===========================================');
  try { testT1_Helpers(); } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T1 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }
  try { testT2_TrustGate(); } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T2 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }
  try { testT3_SlopeCorrection(); } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T3 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }
  try { testT4_OffSkeleton(); } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T4 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }
  try { testT5_RidgeOpposition(); } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T5 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }
  try { testT6_Orchestrator(); } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T6 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }

  console.log('');
  console.log('Summary: ' + PASS + ' passed, ' + FAIL + ' failed');
  if (FAIL > 0) {
    console.log('');
    for (const line of FAIL_LINES) console.log(line);
    process.exit(1);
  }
  process.exit(0);
})();
