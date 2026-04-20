// V2P7 offline validation harness.
// Builds synthetic envelopes matching the banked V2P0-V2P4 validation numbers
// (PROJECT_HANDOFF.md V2P0-V2P4 sections and ML_AUTO_BUILD_TRIAGE_STATUS.md §12-§16)
// then runs v2p7DecisionIntegration() and checks prior/final status + reasons.
// Run: node tools/v2p7_validate.js

const fs = require('fs');
const path = require('path');
const serverPath = path.join(__dirname, '..', 'server.js');
const source = fs.readFileSync(serverPath, 'utf8');

function extractBlock(needleStart, needleEnd) {
  const i = source.indexOf(needleStart);
  if (i < 0) throw new Error('not found: ' + needleStart);
  const j = source.indexOf(needleEnd, i);
  if (j < 0) throw new Error('end not found: ' + needleEnd);
  return source.slice(i, j);
}

const v2p7Block = extractBlock(
  '// ── V2P7: Decision-layer integration',
  'const ML_ENGINE_URL_DEFAULT'
);

const runtime = `
  function _r2(x) { return Math.round(x * 100) / 100; }
  ${v2p7Block}
  module.exports = { v2p7DecisionIntegration, v2p7ApplyDecision };
`;
const m = new (require('module'))();
m._compile(runtime, 'v2p7-runtime.js');
const { v2p7DecisionIntegration, v2p7ApplyDecision } = m.exports;

function makeEnvelope({ status, reasons, faces, v2p0, v2p1, v2p2, v2p3, v2p4 }) {
  return {
    auto_build_status: status,
    review_policy_reasons: reasons.slice(),
    crm_result: {
      roof_faces: Array.from({ length: faces }, (_, i) => ({ idx: i })),
      metadata: {
        v2p0_ground_structure: v2p0,
        v2p1_structural_coherence: v2p1,
        v2p2_main_roof_coherence: v2p2,
        v2p3_roof_relationships: v2p3,
        v2p4_whole_roof_consistency: v2p4,
      },
    },
  };
}

const v2p4 = (wr, st, mb, sp, rel, uncertainty=0, contra=[], warnings=[]) => ({
  whole_roof_consistency_score: wr,
  dominant_story_strength: st,
  main_body_score: mb,
  structural_pairing_score: sp,
  relationship_score: rel,
  realism_factor: 1.0,
  uncertainty_ratio: uncertainty,
  contradiction_flags: contra,
  whole_roof_warnings: warnings,
});

const FIXTURES = [
  {
    name: '15 Veteran Rd',
    bucket: 'clean_gable',
    expectFinal: 'auto_accept',
    expectClean: true,
    env: {
      status: 'auto_accept', reasons: [], faces: 3,
      v2p0: { structure_like_count: 3, ground_like_count: 0, uncertain_count: 0, hard_ground_suppressed_count: 0 },
      v2p1: { structural_coherence_score: 0.92, mirrored_pair_count: 2, structural_warnings: [], main_plane_count: 3, unpaired_main_planes: 0 },
      v2p2: { main_roof_coherence_score: 0.94, main_roof_candidate_count: 3, main_roof_warnings: [], fragmented_main_roof: false },
      v2p3: { roof_relationship_coherence_score: 0.99, ridge_like_count: 2, hip_like_count: 0, valley_like_count: 0, seam_like_count: 1, step_like_count: 0, uncertain_relationship_count: 0, main_relationship_count: 3, relationship_warnings: [] },
      v2p4: v2p4(0.96, 0.98, 0.94, 0.92, 0.99, 0.0, [], []),
    },
  },
  {
    name: '20 Meadow Dr',
    bucket: 'improved_simple',
    expectFinal: 'needs_review',
    expectChange: false,
    env: {
      status: 'needs_review',
      reasons: ['v2p0_ground_surface_detected', 'v2p0_ground_surface_suppressed'],
      faces: 3,
      v2p0: { structure_like_count: 2, ground_like_count: 0, uncertain_count: 1, hard_ground_suppressed_count: 1 },
      v2p1: { structural_coherence_score: 0.63, mirrored_pair_count: 1, structural_warnings: ['major_plane_unpaired', 'high_pair_pitch_mismatch'], main_plane_count: 3, unpaired_main_planes: 2 },
      v2p2: { main_roof_coherence_score: 0.88, main_roof_candidate_count: 2, main_roof_warnings: [], fragmented_main_roof: false },
      v2p3: { roof_relationship_coherence_score: 0.65, ridge_like_count: 2, hip_like_count: 0, valley_like_count: 1, seam_like_count: 0, step_like_count: 0, uncertain_relationship_count: 0, main_relationship_count: 3, relationship_warnings: ['weak_ridge_hip_valley_evidence'] },
      v2p4: v2p4(0.73, 0.88, 0.88, 0.63, 0.65, 0.0, [], []),
    },
  },
  {
    name: '225 Gibson St',
    bucket: 'complex_corrected',
    expectFinal: 'needs_review',
    expectChange: false,
    env: {
      status: 'needs_review',
      reasons: ['google_solar_pitch_corrected'],
      faces: 6,
      v2p0: { structure_like_count: 4, ground_like_count: 0, uncertain_count: 2, hard_ground_suppressed_count: 0 },
      v2p1: { structural_coherence_score: 0.44, mirrored_pair_count: 1, structural_warnings: ['major_plane_unpaired', 'poor_structural_pair_coverage'], main_plane_count: 3, unpaired_main_planes: 3 },
      v2p2: { main_roof_coherence_score: 0.77, main_roof_candidate_count: 4, main_roof_warnings: [], fragmented_main_roof: false },
      v2p3: { roof_relationship_coherence_score: 0.59, ridge_like_count: 2, hip_like_count: 1, valley_like_count: 0, seam_like_count: 0, step_like_count: 2, uncertain_relationship_count: 4, main_relationship_count: 5, relationship_warnings: [] },
      v2p4: v2p4(0.66, 0.8, 0.77, 0.44, 0.59, 0.4, [], ['weak_pair_coverage_on_main_body']),
    },
  },
  {
    name: '175 Warwick',
    bucket: 'steep_real',
    expectFinal: 'needs_review',
    expectChange: false,
    env: {
      status: 'needs_review',
      reasons: ['build_tilt_quality_low'],
      faces: 3,
      v2p0: { structure_like_count: 3, ground_like_count: 0, uncertain_count: 0, hard_ground_suppressed_count: 0 },
      v2p1: { structural_coherence_score: 0.50, mirrored_pair_count: 1, structural_warnings: [], main_plane_count: 1, unpaired_main_planes: 0 },
      v2p2: { main_roof_coherence_score: 0.84, main_roof_candidate_count: 3, main_roof_warnings: [], fragmented_main_roof: false },
      v2p3: { roof_relationship_coherence_score: 0.88, ridge_like_count: 1, hip_like_count: 1, valley_like_count: 1, seam_like_count: 0, step_like_count: 0, uncertain_relationship_count: 0, main_relationship_count: 3, relationship_warnings: [] },
      v2p4: v2p4(0.80, 0.88, 0.84, 0.50, 0.88, 0.0, [], []),
    },
  },
  {
    name: 'Lawrence',
    bucket: 'improved_complex',
    expectFinal: 'needs_review',
    expectChange: false,
    env: {
      status: 'needs_review',
      reasons: ['build_tilt_quality_low'],
      faces: 6,
      v2p0: { structure_like_count: 2, ground_like_count: 0, uncertain_count: 4, hard_ground_suppressed_count: 0 },
      v2p1: { structural_coherence_score: 0.81, mirrored_pair_count: 2, structural_warnings: ['major_plane_unpaired'], main_plane_count: 6, unpaired_main_planes: 1 },
      v2p2: { main_roof_coherence_score: 0.80, main_roof_candidate_count: 4, main_roof_warnings: [], fragmented_main_roof: false },
      v2p3: { roof_relationship_coherence_score: 0.55, ridge_like_count: 2, hip_like_count: 2, valley_like_count: 0, seam_like_count: 1, step_like_count: 1, uncertain_relationship_count: 6, main_relationship_count: 11, relationship_warnings: [] },
      v2p4: v2p4(0.69, 0.80, 0.80, 0.81, 0.55, 0.55, ['high_uncertainty_on_main_faces'], []),
    },
  },
  {
    name: '13 Richardson St',
    bucket: 'single_ground',
    expectFinal: 'needs_review',
    expectChange: false,
    env: {
      status: 'needs_review',
      reasons: ['crm_soft_gate_applied', 'build_tilt_quality_low', 'p9_build_unmatched', 'v2p0_ground_surface_detected'],
      faces: 1,
      v2p0: { structure_like_count: 0, ground_like_count: 1, uncertain_count: 0, hard_ground_suppressed_count: 0 },
      v2p1: null,
      v2p2: { main_roof_coherence_score: 0.0, main_roof_candidate_count: 0, main_roof_warnings: ['no_clear_dominant_roof_body'], fragmented_main_roof: false },
      v2p3: null,
      v2p4: v2p4(0.20, 0.04, 0.0, 0.0, 0.0, 0.0, [], ['weak_overall_consistency']),
    },
  },
  {
    name: '11 Ash Road',
    bucket: 'target_strip',
    expectFinal: 'needs_review',
    expectChange: false,
    env: {
      status: 'needs_review',
      reasons: ['crm_soft_gate_applied', 'build_tilt_quality_low', 'p9_build_unmatched'],
      faces: 1,
      v2p0: { structure_like_count: 0, ground_like_count: 0, uncertain_count: 1, hard_ground_suppressed_count: 0 },
      v2p1: null,
      v2p2: { main_roof_coherence_score: 0.55, main_roof_candidate_count: 1, main_roof_warnings: [], fragmented_main_roof: false },
      v2p3: null,
      v2p4: v2p4(0.48, 0.47, 0.55, 0.0, 0.0, 0.0, [], []),
    },
  },
  // Additional clean/simple roof — 726 School St (clean reference, 2 faces).
  {
    name: '726 School St',
    bucket: 'clean_simple',
    expectFinal: 'auto_accept',
    expectChange: false,
    env: {
      status: 'auto_accept', reasons: [], faces: 2,
      v2p0: { structure_like_count: 2, ground_like_count: 0, uncertain_count: 0, hard_ground_suppressed_count: 0 },
      v2p1: { structural_coherence_score: 0.85, mirrored_pair_count: 1, structural_warnings: [], main_plane_count: 2, unpaired_main_planes: 0 },
      v2p2: { main_roof_coherence_score: 0.88, main_roof_candidate_count: 2, main_roof_warnings: [], fragmented_main_roof: false },
      v2p3: { roof_relationship_coherence_score: 0.92, ridge_like_count: 1, hip_like_count: 0, valley_like_count: 0, seam_like_count: 0, step_like_count: 0, uncertain_relationship_count: 0, main_relationship_count: 1, relationship_warnings: [] },
      v2p4: v2p4(0.91, 0.93, 0.88, 0.85, 0.92, 0.0, [], []),
    },
  },
  // Additional problematic/fragmented roof — 583 Westford (ugly, 5 faces, multi-section).
  // Tests complex-but-coherent: if main body stays healthy and no contradictions,
  // the dampener should keep this from being unnecessarily escalated.
  {
    name: '583 Westford St',
    bucket: 'ugly_multisection_coherent',
    expectFinal: 'auto_accept',
    expectChange: false,
    env: {
      status: 'auto_accept', reasons: [], faces: 5,
      v2p0: { structure_like_count: 4, ground_like_count: 0, uncertain_count: 1, hard_ground_suppressed_count: 0 },
      v2p1: { structural_coherence_score: 0.55, mirrored_pair_count: 1, structural_warnings: ['major_plane_unpaired'], main_plane_count: 4, unpaired_main_planes: 2 },
      v2p2: { main_roof_coherence_score: 0.75, main_roof_candidate_count: 3, main_roof_warnings: [], fragmented_main_roof: false },
      v2p3: { roof_relationship_coherence_score: 0.60, ridge_like_count: 1, hip_like_count: 1, valley_like_count: 0, seam_like_count: 1, step_like_count: 0, uncertain_relationship_count: 3, main_relationship_count: 4, relationship_warnings: [] },
      v2p4: v2p4(0.70, 0.75, 0.75, 0.55, 0.60, 0.45, [], []),
    },
  },
  // Hypothetical fragmented — must still escalate even with the polish.
  {
    name: 'Hypothetical fragmented multi-face',
    bucket: 'synthetic_fragmented',
    expectFinal: 'needs_review',
    expectChange: true,
    expectReasonSubset: ['v2_low_consistency', 'v2_fragmented_main_body'],
    env: {
      status: 'auto_accept',
      reasons: [],
      faces: 5,
      v2p0: { structure_like_count: 4, ground_like_count: 0, uncertain_count: 1, hard_ground_suppressed_count: 0 },
      v2p1: { structural_coherence_score: 0.30, mirrored_pair_count: 0, structural_warnings: ['no_strong_mirrored_pairs', 'major_plane_unpaired'], main_plane_count: 4, unpaired_main_planes: 4 },
      v2p2: { main_roof_coherence_score: 0.35, main_roof_candidate_count: 4, main_roof_warnings: ['main_roof_area_too_diffuse', 'fragmented_main_roof_body'], fragmented_main_roof: true },
      v2p3: { roof_relationship_coherence_score: 0.30, ridge_like_count: 0, hip_like_count: 0, valley_like_count: 0, seam_like_count: 0, step_like_count: 1, uncertain_relationship_count: 6, main_relationship_count: 5, relationship_warnings: ['main_faces_mostly_uncertain'] },
      v2p4: v2p4(0.40, 0.45, 0.35, 0.30, 0.30, 0.70, ['high_uncertainty_on_main_faces', 'many_main_faces_but_low_pair_coverage'], ['weak_overall_consistency', 'fragmented_main_body_relationships']),
    },
  },
  // Hypothetical pathological — still NOT rejected by design (contradictions=0).
  {
    name: 'Hypothetical extreme pathological',
    bucket: 'synthetic_extreme',
    expectFinal: 'needs_review',
    expectChange: false,
    env: {
      status: 'needs_review',
      reasons: ['crm_soft_gate_applied', 'p9_build_unmatched', 'v2p0_ground_surface_detected'],
      faces: 1,
      v2p0: { structure_like_count: 0, ground_like_count: 1, uncertain_count: 0, hard_ground_suppressed_count: 0 },
      v2p1: null,
      v2p2: { main_roof_coherence_score: 0.0, main_roof_candidate_count: 0, main_roof_warnings: ['no_clear_dominant_roof_body'], fragmented_main_roof: true },
      v2p3: null,
      v2p4: v2p4(0.15, 0.08, 0.0, 0.0, 0.0, 0.9, [], ['weak_overall_consistency']),
    },
  },
];

function fmt(n) { return n === null || n === undefined ? '—' : String(n); }

console.log('V2P7 offline validation (polish pass)');
console.log('='.repeat(80));

let pass = 0;
let fail = 0;
const rows = [];

for (const fx of FIXTURES) {
  const env = makeEnvelope(fx.env);
  const priorStatus = env.auto_build_status;
  const priorReasons = env.review_policy_reasons.slice();
  const decision = v2p7DecisionIntegration(env);
  v2p7ApplyDecision(env, decision);
  const finalStatus = env.auto_build_status;
  const finalReasons = env.review_policy_reasons.slice();

  const ok = (() => {
    if (fx.expectFinal && finalStatus !== fx.expectFinal) return false;
    if ('expectChange' in fx && decision.decision_change_applied !== fx.expectChange) return false;
    if (fx.expectClean && !decision.v2_supporting_signals.clean_structural_story) return false;
    if (fx.expectReasonSubset) {
      for (const r of fx.expectReasonSubset) {
        if (!decision.v2_decision_reasons.includes(r)) return false;
      }
    }
    return true;
  })();

  rows.push({
    name: fx.name,
    bucket: fx.bucket,
    prior: priorStatus,
    final: finalStatus,
    changed: decision.decision_change_applied,
    score: decision.final_v2_decision_score,
    support: decision.support_score,
    risk: decision.risk_score,
    effRisk: decision.effective_risk_score,
    contraPen: decision.contradiction_penalty,
    uncPen: decision.uncertainty_penalty,
    damp: decision.complexity_dampener,
    dampApplied: decision.complexity_dampener_applied,
    triggers: (decision.explicit_escalation_triggers || []).map(t => t.id),
    reasonsAdded: finalReasons.filter(r => !priorReasons.includes(r)),
    decisionReasons: decision.v2_decision_reasons,
    notes: decision.v2_decision_notes,
    clean: decision.v2_supporting_signals.clean_structural_story,
    ok,
  });

  if (ok) pass++; else fail++;
}

for (const r of rows) {
  console.log('');
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name} [${r.bucket}]`);
  console.log(`  prior=${r.prior}  final=${r.final}  changed=${r.changed}`);
  console.log(`  support=${fmt(r.support)}  risk=${fmt(r.risk)}  effRisk=${fmt(r.effRisk)}  dampener=${fmt(r.damp)}${r.dampApplied ? ' (applied)' : ''}`);
  console.log(`  contra_pen=${fmt(r.contraPen)}  unc_pen=${fmt(r.uncPen)}  final_score=${fmt(r.score)}`);
  console.log(`  triggers=[${r.triggers.join(',')}]`);
  console.log(`  decision_reasons=[${r.decisionReasons.join(',')}]`);
  console.log(`  reasons_added_to_envelope=[${r.reasonsAdded.join(',')}]`);
  console.log(`  notes=[${r.notes.join(' | ')}]`);
  console.log(`  clean_structural_story=${r.clean}`);
}

console.log('');
console.log('='.repeat(80));

// ── V2P8: Stability / coupling check ───────────────────────────────────────
// Confirm V2P7 degrades gracefully when upstream V2 metadata is partial or
// missing. No phase should throw; status should never change unexpectedly.
console.log('');
console.log('V2P8 stability / coupling check');
console.log('='.repeat(80));

const baselineFx = FIXTURES[0];  // 15 Veteran Rd (clean gable, should support).

function runDegraded(label, env) {
  let ok = true;
  let note = '';
  try {
    const decision = v2p7DecisionIntegration(env);
    v2p7ApplyDecision(env, decision);
    const priorStatus = env.auto_build_status;  // already applied
    note = `final=${decision.final_status} applied=${decision.v2_decision_integration_applied} support=${decision.support_score} risk=${decision.risk_score} change=${decision.decision_change_applied}`;
  } catch (e) {
    ok = false;
    note = 'THREW: ' + e.message;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
  console.log(`  ${note}`);
  return ok;
}

let stabPass = 0;
let stabFail = 0;

// Case A: V2P4 missing (everything else present).
{
  const env = makeEnvelope(baselineFx.env);
  delete env.crm_result.metadata.v2p4_whole_roof_consistency;
  env.auto_build_status = baselineFx.env.status;  // reset, applyDecision mutates
  const ok = runDegraded('A: V2P4 missing (clean gable baseline)', env);
  if (env.auto_build_status === 'auto_accept') {
    console.log('  status preserved as auto_accept (safe degradation)');
  } else {
    console.log('  FAIL: status changed when V2P4 missing');
  }
  if (ok && env.auto_build_status === 'auto_accept') stabPass++; else stabFail++;
}

// Case B: V2P3 missing.
{
  const env = makeEnvelope(baselineFx.env);
  delete env.crm_result.metadata.v2p3_roof_relationships;
  env.auto_build_status = baselineFx.env.status;
  const ok = runDegraded('B: V2P3 missing', env);
  if (ok) stabPass++; else stabFail++;
}

// Case C: V2P2 missing.
{
  const env = makeEnvelope(baselineFx.env);
  delete env.crm_result.metadata.v2p2_main_roof_coherence;
  env.auto_build_status = baselineFx.env.status;
  const ok = runDegraded('C: V2P2 missing', env);
  if (ok) stabPass++; else stabFail++;
}

// Case D: V2P1 missing.
{
  const env = makeEnvelope(baselineFx.env);
  delete env.crm_result.metadata.v2p1_structural_coherence;
  env.auto_build_status = baselineFx.env.status;
  const ok = runDegraded('D: V2P1 missing', env);
  if (ok) stabPass++; else stabFail++;
}

// Case E: V2P0 missing.
{
  const env = makeEnvelope(baselineFx.env);
  delete env.crm_result.metadata.v2p0_ground_structure;
  env.auto_build_status = baselineFx.env.status;
  const ok = runDegraded('E: V2P0 missing', env);
  if (ok) stabPass++; else stabFail++;
}

// Case F: Only V2P4 present (all other V2 phases missing).
{
  const env = makeEnvelope(baselineFx.env);
  delete env.crm_result.metadata.v2p0_ground_structure;
  delete env.crm_result.metadata.v2p1_structural_coherence;
  delete env.crm_result.metadata.v2p2_main_roof_coherence;
  delete env.crm_result.metadata.v2p3_roof_relationships;
  env.auto_build_status = baselineFx.env.status;
  const ok = runDegraded('F: V2P4 only (all other V2 phases missing)', env);
  if (ok) stabPass++; else stabFail++;
}

// Case G: All metadata missing.
{
  const env = makeEnvelope(baselineFx.env);
  env.crm_result.metadata = {};
  env.auto_build_status = baselineFx.env.status;
  const priorStatus = env.auto_build_status;
  const ok = runDegraded('G: All V2 metadata missing', env);
  if (env.auto_build_status === priorStatus) {
    console.log('  status preserved (safe degradation)');
  }
  if (ok) stabPass++; else stabFail++;
}

// Case H: Zero faces (common on reject-by-usable-gate builds).
{
  const env = makeEnvelope(Object.assign({}, baselineFx.env, { faces: 0 }));
  env.auto_build_status = baselineFx.env.status;
  const ok = runDegraded('H: Zero faces', env);
  if (ok) stabPass++; else stabFail++;
}

console.log('');
console.log(`Stability: ${stabPass}/${stabPass + stabFail} passed, ${stabFail} failed`);
console.log('='.repeat(80));
console.log(`TOTAL: ${pass}/${pass + fail} regression, ${stabPass}/${stabPass + stabFail} stability`);
process.exit((fail + stabFail) > 0 ? 1 : 0);
