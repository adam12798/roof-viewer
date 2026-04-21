#!/usr/bin/env node
/*
 * V3P4.3 — Geometry stabilization invariants test.
 *
 * Exercises the five patches in the V3P4.3 packet:
 *
 *   A. Ridge sanity wiring + action (GEOM-002 + GEOM-003)
 *   B. Safe merge policy (GEOM-001 + GEOM-008)
 *   C. X-median enforcement split block (GEOM-005)
 *   D. V3P1 multi-axis ridge detection (GEOM-004)
 *   E. Hip-signature anchor exemption (GEOM-006)
 *
 * Usage:
 *   node tools/v3p4_3_invariants_test.js
 *
 * No external deps. Exits 0 on all pass, 1 on any failure.
 */

'use strict';

const path = require('path');
const serverModule = require(path.join(__dirname, '..', 'server.js'));

const {
  v3p1DetectRidgeConflict,
  v3p2SafeMergePair,
  v3p4_3IsFallbackSplit,
  v3p4_3HasHipSignature,
  v3p4_1ValidateRidgeSanity,
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

// ── Fixtures ────────────────────────────────────────────────────────────────

// Synthetic LiDAR samples for an E-W-oriented gable. Ridge runs along X,
// halves are north (z<0) and south (z>0); each half slopes away.
function makeEwGableSamples() {
  const samples = [];
  // south half (z > 0): slopes down to the south (+z direction = downslope)
  for (let x = -5; x <= 5; x += 0.25) {
    for (let z = 0.1; z <= 5; z += 0.25) {
      // h decreases with z → ∂h/∂z = -0.6 → downslope direction +z
      samples.push({ x, z, elev: 10 - 0.6 * z });
    }
  }
  // north half (z < 0): slopes down to the north (-z direction)
  for (let x = -5; x <= 5; x += 0.25) {
    for (let z = -5; z <= -0.1; z += 0.25) {
      // h increases as z goes toward 0 → ∂h/∂z = 0.6 → downslope -z
      samples.push({ x, z, elev: 10 + 0.6 * z });
    }
  }
  return samples;
}

// Legacy X-ridge samples (N-S ridge) — the case the original X-median
// detector WOULD catch. This is the control for D.
function makeNsGableSamples() {
  const samples = [];
  for (let z = -5; z <= 5; z += 0.25) {
    for (let x = 0.1; x <= 5; x += 0.25) {
      samples.push({ x, z, elev: 10 - 0.6 * x });
    }
    for (let x = -5; x <= -0.1; x += 0.25) {
      samples.push({ x, z, elev: 10 + 0.6 * x });
    }
  }
  return samples;
}

// Flat / noisy samples — should NOT produce ridge conflict on any axis.
function makeFlatSamples() {
  const samples = [];
  for (let x = -5; x <= 5; x += 0.25) {
    for (let z = -5; z <= 5; z += 0.25) {
      samples.push({ x, z, elev: 10 + 0.05 * Math.sin(x + z) });
    }
  }
  return samples;
}

// Hip roof: four quadrants sloping outward from center. ~30° pitch each way.
function makeHipSamples() {
  const samples = [];
  const p = 0.6; // slope magnitude
  for (let x = -5; x <= 5; x += 0.2) {
    for (let z = -5; z <= 5; z += 0.2) {
      // Pyramid/hip: elev = top - (|x| + |z|) * slope
      samples.push({ x, z, elev: 10 - (Math.abs(x) + Math.abs(z)) * p });
    }
  }
  return samples;
}

// Make a fake DSM grid for the hip signature / anchor tests.
// Grid is indexed by `Math.round((x + half) / res)` (row = z, col = x).
function buildHipGrid() {
  // V2P0 grid parameters as used in server.js.
  const SIZE = 281, RES = 0.25, HALF = 35;
  const grid = new Float32Array(SIZE * SIZE);
  grid.fill(NaN);
  const p = 0.6;
  for (let row = 0; row < SIZE; row++) {
    const z = row * RES - HALF;
    for (let col = 0; col < SIZE; col++) {
      const x = col * RES - HALF;
      // Only populate a central hip footprint.
      if (Math.abs(x) > 5 || Math.abs(z) > 5) continue;
      grid[row * SIZE + col] = 10 - (Math.abs(x) + Math.abs(z)) * p;
    }
  }
  return grid;
}

// Square polygon vertices
function square(halfSide) {
  return [
    { x: -halfSide, z: -halfSide },
    { x:  halfSide, z: -halfSide },
    { x:  halfSide, z:  halfSide },
    { x: -halfSide, z:  halfSide },
  ];
}

// ── T1 — D. Multi-axis V3P1 ridge detection ─────────────────────────────────

function testT1_MultiAxisRidge() {
  console.log('T1. GEOM-004: V3P1 ridge detection is multi-axis');

  // Case A: legacy N-S ridge (X-median works). bestAxis should be 'x' and conflict=true.
  const nsResult = v3p1DetectRidgeConflict(makeNsGableSamples());
  assert('T1.a N-S gable: conflict detected', nsResult.conflict === true);
  assert('T1.b N-S gable: best axis is x (legacy parity)', nsResult.axis === 'x',
    'got axis=' + nsResult.axis);
  assert('T1.c N-S gable: axes_tested has 4 entries', Array.isArray(nsResult.axes_tested) && nsResult.axes_tested.length === 4);

  // Case B: E-W ridge — previously missed by X-only. New detector must catch it via axis 'z'.
  const ewResult = v3p1DetectRidgeConflict(makeEwGableSamples());
  assert('T1.d E-W gable: conflict detected (previously missed)', ewResult.conflict === true,
    'got conflict=' + ewResult.conflict + ' axis=' + ewResult.axis + ' dot=' + ewResult.dot);
  assert('T1.e E-W gable: best axis is z (multi-axis rescue)', ewResult.axis === 'z',
    'got axis=' + ewResult.axis);

  // Case C: flat roof — no ridge on any axis.
  const flatResult = v3p1DetectRidgeConflict(makeFlatSamples());
  assert('T1.f flat roof: no conflict', flatResult.conflict === false);
}

// ── T2 — B. Safe merge policy ───────────────────────────────────────────────

function testT2_SafeMerge() {
  console.log('T2. GEOM-001 + GEOM-008: safe merge policy');

  // Case A: two adjacent squares sharing an edge — safe merge allowed.
  const left  = { vertices: [{x:-4,z:-2},{x:0,z:-2},{x:0,z:2},{x:-4,z:2}] };
  const right = { vertices: [{x:0,z:-2},{x:4,z:-2},{x:4,z:2},{x:0,z:2}] };
  const okMerge = v3p2SafeMergePair(left, right);
  assert('T2.a adjacent squares: safe merge OK', okMerge.safe === true, 'reason=' + okMerge.reason);
  assert('T2.b adjacent squares: hull has >=4 vertices', okMerge.hull && okMerge.hull.length >= 4);

  // Case B: two disjoint squares (gap of 10m) — no shared vertex, safe=false.
  const far1 = { vertices: square(2) };
  const far2 = { vertices: [{x:20,z:20},{x:24,z:20},{x:24,z:24},{x:20,z:24}] };
  const farMerge = v3p2SafeMergePair(far1, far2);
  assert('T2.c far-apart: merge rejected', farMerge.safe === false);
  assert('T2.d far-apart: reason=no_shared_vertex', farMerge.reason === 'no_shared_vertex',
    'got reason=' + farMerge.reason);

  // Case C: L-shaped concavity would over-extend — hull fills the bay.
  // Two polygons sharing a corner but whose hull includes a large empty wedge.
  const L1 = { vertices: [{x:-5,z:-5},{x:0,z:-5},{x:0,z:0},{x:-5,z:0}] };   // 5x5 quadrant
  const L2 = { vertices: [{x:0,z:0},{x:5,z:0},{x:5,z:5},{x:0,z:5}] };      // opposite quadrant
  // Shared vertex at (0,0). Hull covers full 10x10 square = 100 m².
  // Source area sum = 25 + 25 = 50 m². Inflation = (100-50)/50 = 1.0, way > 0.15.
  const overMerge = v3p2SafeMergePair(L1, L2);
  assert('T2.e corner-sharing but diagonal: merge rejected on inflation', overMerge.safe === false);
  assert('T2.f corner-sharing: reason=hull_overextends', overMerge.reason === 'hull_overextends',
    'got reason=' + overMerge.reason + ' inflation=' + overMerge.inflation);

  // Case D: two aligned squares touching along an edge — hull exactly equals union, low inflation.
  const a1 = { vertices: square(2) };                                            // area 16
  const a2 = { vertices: [{x:2,z:-2},{x:6,z:-2},{x:6,z:2},{x:2,z:2}] };          // area 16
  const aligned = v3p2SafeMergePair(a1, a2);
  assert('T2.g aligned edge-touch: safe merge OK', aligned.safe === true,
    'reason=' + aligned.reason + ' inflation=' + aligned.inflation);
}

// ── T3 — C. X-median fallback detection ─────────────────────────────────────

function testT3_FallbackDetection() {
  console.log('T3. GEOM-005: v3p4_3IsFallbackSplit recognizes X-median fallback');

  // Case A: null/undefined inputs.
  assert('T3.a null splitResult is not fallback', v3p4_3IsFallbackSplit(null) === false);
  assert('T3.b undefined splitResult is not fallback', v3p4_3IsFallbackSplit(undefined) === false);

  // Case B: ridge-aligned split → not fallback.
  const ridgeSplit = {
    success: true,
    fallbackUsed: false,
    splitLine: { type: 'ridge_aligned', fallback: false, confidence: 0.85 },
  };
  assert('T3.c ridge-aligned: not fallback', v3p4_3IsFallbackSplit(ridgeSplit) === false);

  // Case C: edge-neighbor-aligned → not fallback.
  const neighborSplit = {
    success: true,
    fallbackUsed: false,
    splitLine: { type: 'edge_neighbor_aligned', fallback: false, confidence: 0.50 },
  };
  assert('T3.d edge-neighbor-aligned: not fallback', v3p4_3IsFallbackSplit(neighborSplit) === false);

  // Case D: x_median_fallback → IS fallback.
  const xmedSplit = {
    success: true,
    fallbackUsed: true,
    splitLine: { type: 'x_median_fallback', fallback: true, confidence: 0.15 },
  };
  assert('T3.e x_median_fallback: IS fallback', v3p4_3IsFallbackSplit(xmedSplit) === true);

  // Case E: fallbackUsed=true alone (type missing) → still fallback.
  const bareFallback = { success: true, fallbackUsed: true, splitLine: null };
  assert('T3.f fallbackUsed=true alone: IS fallback', v3p4_3IsFallbackSplit(bareFallback) === true);

  // Case F: splitLine.fallback=true alone → IS fallback.
  const inlineFallback = {
    success: true,
    fallbackUsed: false,
    splitLine: { type: 'ridge_aligned', fallback: true, confidence: 0.15 },
  };
  assert('T3.g splitLine.fallback=true alone: IS fallback', v3p4_3IsFallbackSplit(inlineFallback) === true);
}

// ── T4 — A. Ridge sanity validator (pure function) ──────────────────────────

function testT4_RidgeSanity() {
  console.log('T4. GEOM-002 + GEOM-003: ridge sanity validator returns invalid for same-direction pairs');

  // Polygons facing opposite directions (proper ridge) → valid.
  const pA = { azimuth: 0, pitch: 25 };
  const pB = { azimuth: 180, pitch: 25 };
  const opp = v3p4_1ValidateRidgeSanity(pA, pB, 'ridge');
  assert('T4.a opposite-facing pair is valid', opp.valid === true);

  // Polygons facing same direction across a "ridge" → invalid.
  const sA = { azimuth: 180, pitch: 25 };
  const sB = { azimuth: 175, pitch: 25 };
  const same = v3p4_1ValidateRidgeSanity(sA, sB, 'ridge');
  assert('T4.b same-direction pair is invalid', same.valid === false);
  assert('T4.c same-direction returns reason ridge_same_direction',
    same.reason === 'ridge_same_direction', 'got reason=' + same.reason);

  // Non-ridge edge type → always valid (gated upstream, not our job).
  const notRidge = v3p4_1ValidateRidgeSanity(sA, sB, 'seam');
  assert('T4.d non-ridge edge type: always valid', notRidge.valid === true);

  // Oblique ridge (50° apart, not opposing, not same-direction) → valid "acceptable".
  const oA = { azimuth: 0, pitch: 25 };
  const oB = { azimuth: 90, pitch: 25 };
  const oblique = v3p4_1ValidateRidgeSanity(oA, oB, 'ridge_candidate');
  assert('T4.e oblique ridge: valid with ridge_oblique_acceptable or ridge_opposition_ok',
    oblique.valid === true);
}

// ── T5 — E. Hip-signature detection ─────────────────────────────────────────

function testT5_HipSignature() {
  console.log('T5. GEOM-006: hip-signature detection exempts valid hip refits');

  const grid = buildHipGrid();
  // Polygon covers the full hip footprint (±5 m square).
  const hipPoly = [
    { x: -5, z: -5 },
    { x:  5, z: -5 },
    { x:  5, z:  5 },
    { x: -5, z:  5 },
  ];
  const result = v3p4_3HasHipSignature(hipPoly, grid);
  assert('T5.a hip polygon: isHip=true', result.isHip === true,
    'reason=' + result.reason + ' gaps=' + JSON.stringify(result.az_gaps));
  assert('T5.b hip polygon: reason=hip_signature_detected',
    result.reason === 'hip_signature_detected');
  assert('T5.c hip polygon: 4 azimuths present', Array.isArray(result.azimuths) && result.azimuths.length === 4);
  assert('T5.d hip polygon: all 4 az gaps close to 90°',
    Array.isArray(result.az_gaps) && result.az_gaps.every(g => Math.abs(g - 90) < 35));

  // Negative case: no grid → falsy.
  const noGrid = v3p4_3HasHipSignature(hipPoly, null);
  assert('T5.e no-grid: isHip=false', noGrid.isHip === false);

  // Negative case: tiny polygon with too few samples.
  const tiny = [
    { x: 0, z: 0 }, { x: 0.1, z: 0 }, { x: 0.1, z: 0.1 }, { x: 0, z: 0.1 }
  ];
  const tinyRes = v3p4_3HasHipSignature(tiny, grid);
  assert('T5.f tiny polygon: isHip=false', tinyRes.isHip === false);
}

// ── Runner ─────────────────────────────────────────────────────────────────

(function main() {
  console.log('');
  console.log('V3P4.3 geometry-stabilization invariants');
  console.log('=========================================');
  try { testT1_MultiAxisRidge(); } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T1 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }
  try { testT2_SafeMerge(); } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T2 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }
  try { testT3_FallbackDetection(); } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T3 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }
  try { testT4_RidgeSanity(); } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T4 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }
  try { testT5_HipSignature(); } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T5 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }

  console.log('');
  console.log('Summary: ' + PASS + ' passed, ' + FAIL + ' failed');
  if (FAIL > 0) {
    console.log('');
    for (const line of FAIL_LINES) console.log(line);
    process.exit(1);
  }
  process.exit(0);
})();
