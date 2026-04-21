#!/usr/bin/env node
/*
 * V3P7 — Skeleton + hierarchy invariants test.
 *
 *   T1. Geometric helpers (angle distance, segment distance, point-to-segment).
 *   T2. Ridge segment construction between polygons.
 *   T3. Orchestrator output shape + zero behavioral change.
 *   T4. Ridge grouping: collinear-close segments merge; separate do not.
 *   T5. Hierarchy classification by structural weight.
 *   T6. Polygon annotation + primary ridge selection.
 *
 * Usage:
 *   node tools/v3p7_invariants_test.js
 */

'use strict';

const path = require('path');
const s = require(path.join(__dirname, '..', 'server.js'));

const {
  v3p7RunSkeleton,
  v3p7ExtractRidges,
  v3p7AngleDist180,
  v3p7AnglesCloseDeg,
  v3p7SegmentDist,
  v3p7PointToSegmentDist,
  v3p7RidgeSegmentBetween,
} = s;

let PASS = 0, FAIL = 0;
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

// Two polygons sharing a near-horizontal ridge at z=0 with matching vertex
// pairs at (-5, 0) and (5, 0). polyA below (z<0), polyB above (z>0).
function gablePair(opts) {
  const o = opts || {};
  const hA = o.heightA == null ? 5 : o.heightA;
  const hB = o.heightB == null ? 5 : o.heightB;
  const azA = o.azA == null ? 0   : o.azA;
  const azB = o.azB == null ? 180 : o.azB;
  const pitchA = o.pitchA == null ? 25 : o.pitchA;
  const pitchB = o.pitchB == null ? 25 : o.pitchB;
  return [
    {
      polygon_idx: 0,
      vertices: [
        { x: -5, z: -5 }, { x: 5, z: -5 },
        { x: 5, z: 0 },   { x: -5, z: 0 },
      ],
      pitch: pitchA, azimuth: azA, height: hA, fit_rmse: 0.3,
      source_face_indices: [0], v3p1_face_indices: [0],
      dominant_plane_flag: false, dominant_lineage_source: 'none',
      validation_reasons: [],
    },
    {
      polygon_idx: 1,
      vertices: [
        { x: -5, z: 0 }, { x: 5, z: 0 },
        { x: 5, z: 5 }, { x: -5, z: 5 },
      ],
      pitch: pitchB, azimuth: azB, height: hB, fit_rmse: 0.3,
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

// ── T1 — Geometric helpers ──────────────────────────────────────────────────

function testT1_Helpers() {
  console.log('T1. Geometric helpers');

  // Angle distance is undirected: 175° and 5° should be 10° apart.
  assert('T1.a 175° vs 5° → 10° undirected dist',
    Math.abs(v3p7AngleDist180(175, 5) - 10) < 1e-9,
    'got ' + v3p7AngleDist180(175, 5));
  assert('T1.b 0° vs 180° → 0° undirected dist (same line)',
    v3p7AngleDist180(0, 180) === 0 || Math.abs(v3p7AngleDist180(0, 180)) < 1e-9);
  assert('T1.c 45° vs 135° → 90°',
    Math.abs(v3p7AngleDist180(45, 135) - 90) < 1e-9);
  assert('T1.d anglesCloseDeg threshold respected (12° → close, 20° → not)',
    v3p7AnglesCloseDeg(0, 12) === true && v3p7AnglesCloseDeg(0, 20) === false);

  // Point-to-segment
  const p1 = { x: 0, z: 0 }, p2 = { x: 10, z: 0 };
  assert('T1.e point on segment → 0', v3p7PointToSegmentDist({ x: 5, z: 0 }, p1, p2) < 1e-9);
  assert('T1.f point 3m perpendicular → 3', Math.abs(v3p7PointToSegmentDist({ x: 5, z: 3 }, p1, p2) - 3) < 1e-9);
  assert('T1.g point off endpoint → Euclidean',
    Math.abs(v3p7PointToSegmentDist({ x: 13, z: 4 }, p1, p2) - 5) < 1e-9);

  // Segment distance
  const segA = { p1: { x: 0, z: 0 }, p2: { x: 10, z: 0 } };
  const segB = { p1: { x: 0, z: 2 }, p2: { x: 10, z: 2 } }; // parallel 2 m away
  assert('T1.h parallel segments 2m apart → 2',
    Math.abs(v3p7SegmentDist(segA, segB) - 2) < 1e-9);
  const segC = { p1: { x: 100, z: 100 }, p2: { x: 110, z: 100 } };
  assert('T1.i far segments → large distance',
    v3p7SegmentDist(segA, segC) > 50);
}

// ── T2 — Ridge segment construction ─────────────────────────────────────────

function testT2_Segment() {
  console.log('T2. Ridge segment construction');
  const [a, b] = gablePair();
  const seg = v3p7RidgeSegmentBetween(a, b);
  assert('T2.a non-null for shared-edge pair', !!seg);
  if (seg) {
    assert('T2.b segment length ≈ 10 m (ridge from -5 to 5 in X)',
      Math.abs(seg.length_m - 10) < 0.5,
      'got length=' + seg.length_m);
    assert('T2.c segment angle ≈ 0° (runs along X axis)',
      Math.abs(seg.angle_deg) < 10 || Math.abs(seg.angle_deg - 180) < 10,
      'got angle=' + seg.angle_deg);
    assert('T2.d mean_elevation_m derived from polygon heights', seg.mean_elevation_m === 5);
  }

  // Near-shared vertex pair fixture records strategy = near_shared_vertices.
  assert('T2.e segment strategy = near_shared_vertices', seg && seg.strategy === 'near_shared_vertices');
  // Non-adjacent polygons: V3P3 wouldn't classify this as a skeleton edge in
  // practice, but if the helper is called we fall back to a centroid-
  // orthogonal segment rather than dropping it silently. Strategy must be
  // marked so V3P8 / audit can tell it apart from a snapped segment.
  const far = { vertices: [{ x: 100, z: 100 }, { x: 110, z: 100 }, { x: 110, z: 110 }, { x: 100, z: 110 }] };
  const seg2 = v3p7RidgeSegmentBetween(a, far, 'ridge');
  assert('T2.f non-adjacent polygons → fallback segment (non-null)', seg2 !== null);
  assert('T2.g fallback segment strategy = centroid_orthogonal_fallback',
    seg2 && seg2.strategy === 'centroid_orthogonal_fallback');

  // Too few vertices → null.
  const tooFew = { vertices: [{ x: 0, z: 0 }] };
  assert('T2.h <2 vertices → null', v3p7RidgeSegmentBetween(a, tooFew, 'ridge') === null);
}

// ── T3 — Orchestrator shape + zero behavior change ─────────────────────────

function testT3_OrchestratorShape() {
  console.log('T3. Orchestrator output shape + zero behavior change');

  const polys = gablePair();
  // Record EXACT state of the polygons before running, including a deep copy
  // of vertices, pitch, azimuth, height, fit_rmse, dominant_plane_flag,
  // source_face_indices, validation_decision.
  const snapshot = polys.map(p => JSON.stringify({
    vertices: p.vertices, pitch: p.pitch, azimuth: p.azimuth,
    height: p.height, fit_rmse: p.fit_rmse,
    dominant_plane_flag: p.dominant_plane_flag,
    source_face_indices: p.source_face_indices,
    validation_decision: p.validation_decision,
  }));

  const edges = [ridgeEdge(0, 1, 0.8)];
  const debug = v3p7RunSkeleton(polys, edges);

  // Shape
  assert('T3.a debug.v3p7_applied true', debug.v3p7_applied === true);
  assert('T3.b debug.ridges is an array', Array.isArray(debug.ridges));
  assert('T3.c debug.per_polygon length = 2', debug.per_polygon.length === 2);
  assert('T3.d each per_polygon row has rebuilt_flag=false',
    debug.per_polygon.every(r => r.rebuilt_flag === false));
  assert('T3.e each per_polygon row has removed_reason=null',
    debug.per_polygon.every(r => r.removed_reason === null));
  assert('T3.f thresholds block present',
    debug.thresholds && typeof debug.thresholds.ridge_merge_angle_deg === 'number');

  // Zero behavior change: original fields unchanged.
  const after = polys.map(p => JSON.stringify({
    vertices: p.vertices, pitch: p.pitch, azimuth: p.azimuth,
    height: p.height, fit_rmse: p.fit_rmse,
    dominant_plane_flag: p.dominant_plane_flag,
    source_face_indices: p.source_face_indices,
    validation_decision: p.validation_decision,
  }));
  assert('T3.g polygon[0] geometry untouched', after[0] === snapshot[0]);
  assert('T3.h polygon[1] geometry untouched', after[1] === snapshot[1]);

  // Additive fields only
  assert('T3.i polygons gained v3p7_assigned_ridge_ids',
    Array.isArray(polys[0].v3p7_assigned_ridge_ids) && Array.isArray(polys[1].v3p7_assigned_ridge_ids));
  assert('T3.j polygons gained v3p7_primary_ridge_id',
    'v3p7_primary_ridge_id' in polys[0] && 'v3p7_primary_ridge_id' in polys[1]);
  assert('T3.k polygons gained v3p7_hierarchy_level',
    'v3p7_hierarchy_level' in polys[0] && 'v3p7_hierarchy_level' in polys[1]);

  // Empty input → empty output, not applied
  const emptyDebug = v3p7RunSkeleton([], []);
  assert('T3.l empty polygons → v3p7_applied=false', emptyDebug.v3p7_applied === false);
  assert('T3.m empty polygons → 0 ridges', emptyDebug.ridges_detected === 0);
}

// ── T4 — Ridge grouping ────────────────────────────────────────────────────

function testT4_Grouping() {
  console.log('T4. Ridge grouping');

  // Single ridge edge → 1 ridge.
  const polys1 = gablePair();
  const r1 = v3p7ExtractRidges(polys1, [ridgeEdge(0, 1, 0.8)]);
  assert('T4.a 1 ridge edge → 1 ridge', r1.ridges.length === 1);
  assert('T4.b 1 ridge has 1 segment', r1.ridges[0].segment_count === 1);
  assert('T4.c connected_plane_indices = [0, 1]',
    JSON.stringify(r1.ridges[0].connected_plane_indices) === '[0,1]');

  // Two far-apart ridges → 2 separate ridges.
  const polys2 = [
    ...gablePair().map(p => ({ ...p })),
    ...gablePair().map((p, i) => {
      const np = JSON.parse(JSON.stringify(p));
      // Offset in +Z by 40 m so their ridge line is elsewhere.
      np.vertices = np.vertices.map(v => ({ x: v.x, z: v.z + 40 }));
      np.polygon_idx = 2 + i;
      return np;
    }),
  ];
  // Need proper source_face_indices to map back via adjacency builder.
  polys2[2].source_face_indices = [2];
  polys2[3].source_face_indices = [3];
  const edges2 = [
    { ...ridgeEdge(0, 1, 0.8), edge_idx: 1 },
    { edge_idx: 2, face_a_idx: 2, face_b_idx: 3, edge_type_v3p3: 'ridge', fused_edge_score: 0.8 },
  ];
  const r2 = v3p7ExtractRidges(polys2, edges2);
  assert('T4.d 2 far-apart ridges → 2 groups', r2.ridges.length === 2,
    'got ' + r2.ridges.length);

  // Two close-parallel ridges (0.5 m apart) → should merge into 1.
  // Build a second polygon pair with its ridge line slightly offset in z.
  const polysNear = gablePair();
  // Second pair: shift by +0.5 m in z (closer than V3P7_RIDGE_MERGE_DIST_M=2).
  const near2 = gablePair().map((p, i) => {
    const np = JSON.parse(JSON.stringify(p));
    np.vertices = np.vertices.map(v => ({ x: v.x, z: v.z + 0.5 }));
    np.polygon_idx = 2 + i;
    np.source_face_indices = [2 + i];
    return np;
  });
  const polysMerge = [...polysNear, ...near2];
  const edgesMerge = [
    ridgeEdge(0, 1, 0.8),
    { edge_idx: 99, face_a_idx: 2, face_b_idx: 3, edge_type_v3p3: 'ridge', fused_edge_score: 0.8 },
  ];
  const rMerge = v3p7ExtractRidges(polysMerge, edgesMerge);
  assert('T4.e two close parallel ridges → merged into 1',
    rMerge.ridges.length === 1,
    'got ' + rMerge.ridges.length);
  if (rMerge.ridges.length === 1) {
    assert('T4.f merged ridge has 2 segments', rMerge.ridges[0].segment_count === 2);
    assert('T4.g merged ridge connects all 4 planes',
      rMerge.ridges[0].connected_plane_indices.length === 4);
  }
}

// ── T4b — Skeleton edge types (ridge + valley + hip) ───────────────────────

function testT4b_SkeletonEdgeTypes() {
  console.log('T4b. Skeleton edge types: ridge + valley + hip');

  // Reject: uncertain / seam / eave / step / outer_boundary are NOT in the
  // V3P7 skeleton.
  const polys = gablePair();
  const notSkeleton = [
    { edge_idx: 1, face_a_idx: 0, face_b_idx: 1, edge_type_v3p3: 'seam', fused_edge_score: 0.8 },
    { edge_idx: 2, face_a_idx: 0, face_b_idx: 1, edge_type_v3p3: 'eave', fused_edge_score: 0.8 },
    { edge_idx: 3, face_a_idx: 0, face_b_idx: 1, edge_type_v3p3: 'uncertain', fused_edge_score: 0.8 },
    { edge_idx: 4, face_a_idx: 0, face_b_idx: 1, edge_type_v3p3: 'step', fused_edge_score: 0.8 },
  ];
  const dbg = v3p7RunSkeleton(polys, notSkeleton);
  assert('T4b.a non-skeleton edges produce 0 ridges', dbg.ridges_detected === 0);

  // Valley edge → counted as a skeleton ridge with edge_type=valley.
  const valleyPolys = gablePair();
  const valleyEdges = [{ edge_idx: 5, face_a_idx: 0, face_b_idx: 1, edge_type_v3p3: 'valley', fused_edge_score: 0.8 }];
  const dbg2 = v3p7RunSkeleton(valleyPolys, valleyEdges);
  assert('T4b.b 1 valley edge → 1 ridge', dbg2.ridges_detected === 1);
  assert('T4b.c ridge.edge_type = valley', dbg2.ridges[0].edge_type === 'valley');
  assert('T4b.d edge_type_breakdown.valley = 1', dbg2.edge_type_breakdown.valley === 1);
  assert('T4b.e edge_type_breakdown.ridge = 0', dbg2.edge_type_breakdown.ridge === 0);

  // Hip edge.
  const hipPolys = gablePair();
  const hipEdges = [{ edge_idx: 6, face_a_idx: 0, face_b_idx: 1, edge_type_v3p3: 'hip', fused_edge_score: 0.8 }];
  const dbg3 = v3p7RunSkeleton(hipPolys, hipEdges);
  assert('T4b.f 1 hip edge → 1 ridge', dbg3.ridges_detected === 1);
  assert('T4b.g ridge.edge_type = hip', dbg3.ridges[0].edge_type === 'hip');

  // Mix of ridge + valley on same polygon pair: should NOT merge, even
  // though segments are near-parallel — different structural types.
  const mixPolys = gablePair();
  const mixEdges = [
    { edge_idx: 7, face_a_idx: 0, face_b_idx: 1, edge_type_v3p3: 'ridge', fused_edge_score: 0.8 },
    { edge_idx: 8, face_a_idx: 0, face_b_idx: 1, edge_type_v3p3: 'valley', fused_edge_score: 0.8 },
  ];
  const dbg4 = v3p7RunSkeleton(mixPolys, mixEdges);
  assert('T4b.h ridge+valley on same pair → 2 separate skeleton groups (not merged)',
    dbg4.ridges_detected === 2,
    'got ' + dbg4.ridges_detected);
}

// ── T5 — Hierarchy classification ──────────────────────────────────────────

function testT5_Hierarchy() {
  console.log('T5. Hierarchy classification');

  // Build one big ridge (large connected planes) and one small ridge (small planes).
  // Big pair: 10×10 footprint per polygon → 50 m² each.
  const big = gablePair();
  // Small pair: 2×2 footprint per polygon → 4 m² each (placed far away to avoid merging).
  const small = [
    { polygon_idx: 2, vertices: [{x:100,z:100},{x:102,z:100},{x:102,z:101},{x:100,z:101}],
      pitch: 25, azimuth: 0, height: 5, source_face_indices: [2], v3p1_face_indices: [2],
      dominant_plane_flag: false, dominant_lineage_source: 'none', validation_reasons: [] },
    { polygon_idx: 3, vertices: [{x:100,z:101},{x:102,z:101},{x:102,z:102},{x:100,z:102}],
      pitch: 25, azimuth: 180, height: 5, source_face_indices: [3], v3p1_face_indices: [3],
      dominant_plane_flag: false, dominant_lineage_source: 'none', validation_reasons: [] },
  ];
  const polys = [...big, ...small];
  const edges = [
    ridgeEdge(0, 1, 0.8),
    { edge_idx: 7, face_a_idx: 2, face_b_idx: 3, edge_type_v3p3: 'ridge', fused_edge_score: 0.8 },
  ];
  const debug = v3p7RunSkeleton(polys, edges);

  assert('T5.a detected 2 ridges', debug.ridges_detected === 2);

  // Sort ridges by structural weight descending and pick main vs rest.
  const sorted = debug.ridges.slice().sort((a, b) => b.structural_weight - a.structural_weight);
  assert('T5.b big ridge has higher structural_weight',
    sorted[0].structural_weight > sorted[1].structural_weight);
  assert('T5.c biggest ridge is classified as main',
    sorted[0].hierarchy_level === 'main',
    'got ' + sorted[0].hierarchy_level);
  assert('T5.d smallest ridge below ratio is tertiary (or secondary if ratio > 0.30)',
    sorted[1].hierarchy_level === 'tertiary' || sorted[1].hierarchy_level === 'secondary');

  // Hierarchy counts are populated.
  assert('T5.e hierarchy_levels.main >= 1', debug.hierarchy_levels.main >= 1);
}

// ── T6 — Polygon annotation ─────────────────────────────────────────────────

function testT6_Annotation() {
  console.log('T6. Polygon annotation');

  const polys = gablePair();
  v3p7RunSkeleton(polys, [ridgeEdge(0, 1, 0.8)]);

  assert('T6.a polyA assigned_ridge_ids = [0]',
    Array.isArray(polys[0].v3p7_assigned_ridge_ids) &&
    polys[0].v3p7_assigned_ridge_ids.length === 1 &&
    polys[0].v3p7_assigned_ridge_ids[0] === 0);
  assert('T6.b polyB assigned_ridge_ids = [0]',
    polys[1].v3p7_assigned_ridge_ids.length === 1 &&
    polys[1].v3p7_assigned_ridge_ids[0] === 0);
  assert('T6.c polyA primary_ridge_id = 0', polys[0].v3p7_primary_ridge_id === 0);
  assert('T6.d polyB primary_ridge_id = 0', polys[1].v3p7_primary_ridge_id === 0);
  assert('T6.e both polygons get a hierarchy_level',
    polys[0].v3p7_hierarchy_level && polys[1].v3p7_hierarchy_level);

  // Polygons with no ridge edges stay unassigned.
  const isolated = [
    { polygon_idx: 0, vertices: [{x:0,z:0},{x:1,z:0},{x:1,z:1},{x:0,z:1}],
      pitch: 25, azimuth: 0, height: 5, source_face_indices: [0], v3p1_face_indices: [0],
      dominant_plane_flag: false, dominant_lineage_source: 'none', validation_reasons: [] },
  ];
  v3p7RunSkeleton(isolated, []);
  assert('T6.f isolated polygon: primary_ridge_id=null', isolated[0].v3p7_primary_ridge_id === null);
  assert('T6.g isolated polygon: hierarchy_level=null', isolated[0].v3p7_hierarchy_level === null);
  assert('T6.h isolated polygon: assigned_ridge_ids=[]', isolated[0].v3p7_assigned_ridge_ids.length === 0);
}

// ── Runner ─────────────────────────────────────────────────────────────────

(function main() {
  console.log('');
  console.log('V3P7 skeleton + hierarchy invariants');
  console.log('=====================================');
  try { testT1_Helpers();       } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T1 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }
  try { testT2_Segment();       } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T2 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }
  try { testT3_OrchestratorShape(); } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T3 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }
  try { testT4_Grouping();      } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T4 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }
  try { testT4b_SkeletonEdgeTypes(); } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T4b threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }
  try { testT5_Hierarchy();     } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T5 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }
  try { testT6_Annotation();    } catch (e) { FAIL++; FAIL_LINES.push('  FAIL  T6 threw: ' + e.stack); console.log(FAIL_LINES[FAIL_LINES.length - 1]); }

  console.log('');
  console.log('Summary: ' + PASS + ' passed, ' + FAIL + ' failed');
  if (FAIL > 0) {
    console.log('');
    for (const line of FAIL_LINES) console.log(line);
    process.exit(1);
  }
  process.exit(0);
})();
