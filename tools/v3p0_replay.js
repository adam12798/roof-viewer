#!/usr/bin/env node
/*
 * V3P0 — Replay harness / server-driven audit.
 *
 * Reruns a selected set of known projects through the live ML Auto Build
 * endpoint, captures response metadata, normalizes into audit rows, buckets,
 * and writes JSON / CSV / markdown summaries for downstream visual review.
 *
 * Usage:
 *   node tools/v3p0_replay.js                # default cases + default creds
 *   CRM_URL=http://localhost:3001 \
 *   CRM_USER=admin CRM_PASS=password \
 *   node tools/v3p0_replay.js
 *
 * Does NOT retune roof logic. Does NOT perform manual visual judgment.
 * Fails soft per-case; records replay failures explicitly in the output.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const CRM_URL = process.env.CRM_URL || 'http://127.0.0.1:3001';
const CRM_USER = process.env.CRM_USER || 'admin';
const CRM_PASS = process.env.CRM_PASS || 'password';
const CASES_PATH = process.env.V3P0_CASES || path.join(__dirname, 'v3p0_replay_cases.json');
const OUT_DIR = path.join(__dirname, 'v3p0_replay_output');
const ML_TIMEOUT_MS = 120000;
const LIDAR_TIMEOUT_MS = 30000;

// ── 1. Input ───────────────────────────────────────────────────────────────
function load_replay_cases(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.cases)) throw new Error('cases file missing "cases" array');
  return parsed.cases;
}

// ── 2. Auth ────────────────────────────────────────────────────────────────
async function login(baseUrl, username, password) {
  const body = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  const resp = await fetch(`${baseUrl}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    redirect: 'manual',
  });
  if (resp.status !== 302) {
    throw new Error(`login failed: HTTP ${resp.status}`);
  }
  const setCookie = resp.headers.get('set-cookie') || '';
  const m = setCookie.match(/session=([^;]+)/);
  if (!m) throw new Error('login: no session cookie in response');
  return `session=${m[1]}`;
}

// ── 3. LiDAR fetch (optional — degrades gracefully) ────────────────────────
async function fetch_lidar(baseUrl, cookie, lat, lng) {
  const url = `${baseUrl}/api/lidar/points?lat=${lat}&lng=${lng}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIDAR_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { headers: { Cookie: cookie }, signal: controller.signal });
    if (!resp.ok) return { points: [], error: `HTTP ${resp.status}` };
    const j = await resp.json();
    return { points: Array.isArray(j.points) ? j.points : [], error: j.error || null };
  } catch (e) {
    return { points: [], error: e.message };
  } finally {
    clearTimeout(timer);
  }
}

// ── 4. Single replay ───────────────────────────────────────────────────────
async function run_replay_case(baseUrl, cookie, c) {
  const started = Date.now();
  const result = {
    replay_timestamp: new Date().toISOString(),
    replay_success: false,
    replay_error: null,
    project_id: c.projectId,
    case_label: c.label || null,
    address_label: c.address || null,
    bucket_expected: c.bucket_expected || null,
    lidar_points: 0,
    lidar_error: null,
    total_runtime_ms: 0,
  };

  try {
    const lidar = await fetch_lidar(baseUrl, cookie, c.lat, c.lng);
    result.lidar_points = lidar.points.length;
    result.lidar_error = lidar.error;

    const body = {
      projectId: c.projectId,
      design_center: { lat: c.lat, lng: c.lng },
      lidar: { points: lidar.points },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ML_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch(`${baseUrl}/api/ml/auto-build`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    result.http_status = resp.status;
    const json = await resp.json();
    result.total_runtime_ms = Date.now() - started;

    if (!resp.ok) {
      result.replay_error = json.error || `HTTP ${resp.status}`;
      result.hint = json.hint || null;
      return result;
    }

    result.raw_response = json;
    result.replay_success = true;
    return result;
  } catch (e) {
    result.total_runtime_ms = Date.now() - started;
    result.replay_error = e.message;
    return result;
  }
}

// ── 5. Normalize ───────────────────────────────────────────────────────────
function normalize_replay_result(r) {
  const row = {
    project_id: r.project_id,
    case_label: r.case_label,
    address_label: r.address_label,
    bucket_expected: r.bucket_expected,
    replay_timestamp: r.replay_timestamp,
    replay_success: r.replay_success,
    replay_error: r.replay_error,
    total_runtime_ms: r.total_runtime_ms,
    lidar_points: r.lidar_points,
    lidar_error: r.lidar_error,
    http_status: r.http_status || null,

    final_status: null,
    disposition: null,
    review_reasons: [],
    face_count: 0,

    ml_runtime_ms: null,
    crm_post_ml_ms: null,
    top_hotspot: null,
    hotspot_ranked_summary: [],
    v2p6_ml_total_ms: null,

    p8_pitch_correction_count: 0,
    p8_mean_correction_deg: null,
    p9_fallback_verdict: null,
    p9_fallback_reason: null,
    p9_matched_fraction: null,

    v2p0_ground_like_count: 0,
    v2p0_hard_suppressed_count: 0,
    v2p0_grid_fill_fraction: null,
    v2p0_structure_like_count: null,

    v2p1_structural_coherence_score: null,
    v2p1_main_plane_count: null,
    v2p1_mirrored_pair_count: null,
    v2p1_unpaired_main_planes: null,
    v2p1_structural_warnings: [],

    v2p2_main_roof_coherence_score: null,
    v2p2_main_roof_candidate_count: null,
    v2p2_secondary_count: null,
    v2p2_uncertain_count: null,
    v2p2_fragmented_main_roof: null,
    v2p2_main_roof_warnings: [],

    v2p3_roof_relationship_coherence_score: null,
    v2p3_ridge_count: null,
    v2p3_hip_count: null,
    v2p3_valley_count: null,
    v2p3_seam_count: null,
    v2p3_step_count: null,
    v2p3_uncertain_count: null,
    v2p3_main_relationship_count: null,
    v2p3_relationship_warnings: [],

    v2p4_whole_roof_consistency_score: null,
    v2p4_dominant_story_strength: null,
    v2p4_uncertainty_ratio: null,
    v2p4_contradiction_flags: [],
    v2p4_whole_roof_warnings: [],

    v2p7_decision_integration_applied: false,
    v2p7_prior_status: null,
    v2p7_final_status: null,
    v2p7_decision_change_applied: false,
    v2p7_support_score: null,
    v2p7_risk_score: null,
    v2p7_effective_risk_score: null,
    v2p7_contradiction_penalty: null,
    v2p7_uncertainty_penalty: null,
    v2p7_complexity_dampener: null,
    v2p7_complexity_dampener_applied: null,
    v2p7_final_decision_score: null,
    v2p7_explicit_escalation_triggers: [],
    v2p7_decision_reasons: [],
    v2p7_decision_notes: [],
    v2p7_clean_structural_story: null,

    v2p8_closeout_applied: null,
    v2_phase_status: null,

    v3p1_applied: false,
    v3p1_plane_count_in: 0,
    v3p1_plane_count_out: 0,
    v3p1_lidar_veto_count: 0,
    v3p1_ridge_flag_count: 0,
    v3p1_partial_rescue: false,

    v3p2_applied: false,
    v3p2_candidate_polygon_count: 0,
    v3p2_final_polygon_count: 0,
    v3p2_splits: 0,
    v3p2_merges: 0,
    v3p2_fallbacks: 0,
    v3p2_snaps: 0,
    v3p2_edge_ridges: 0,
    v3p2_edge_hips: 0,
    v3p2_edge_valleys: 0,
    v3p2_edge_seams: 0,
    v3p2_edge_step_breaks: 0,
    v3p2_edge_uncertain: 0,
    v3p2_warnings: [],
  };

  if (!r.replay_success || !r.raw_response) return row;

  const resp = r.raw_response;
  const cr = resp.crmResult || {};
  const md = cr.metadata || {};

  row.final_status = resp.status || null;
  row.disposition = resp.disposition || null;
  row.review_reasons = resp.reviewPolicyReasons || [];
  row.face_count = Array.isArray(cr.roof_faces) ? cr.roof_faces.length : 0;

  const perf = md.performance_timing || {};
  row.ml_runtime_ms = perf.ml_request_ms ?? null;
  row.crm_post_ml_ms = perf.crm_post_ml_total_ms ?? null;
  row.hotspot_ranked_summary = Array.isArray(perf.hotspot_ranked_summary) ? perf.hotspot_ranked_summary : [];
  row.top_hotspot = row.hotspot_ranked_summary[0] || null;

  const v2p6 = md.v2p6_timing || {};
  row.v2p6_ml_total_ms = v2p6.total_ml_ms ?? v2p6.total_handler_ms ?? null;

  const crossval = md.p3_solar_crossval || {};
  const sum = crossval.build_summary || {};
  row.p8_pitch_correction_count = sum.faces_corrected ?? 0;
  row.p8_mean_correction_deg = sum.mean_correction_deg ?? null;
  const p9 = crossval.p9_build_assessment || {};
  row.p9_fallback_verdict = p9.fallback_verdict || null;
  row.p9_fallback_reason = p9.p9_fallback_reason || null;
  row.p9_matched_fraction = p9.matched_face_fraction ?? null;

  const v2p0 = md.v2p0_ground_structure || {};
  row.v2p0_ground_like_count = v2p0.ground_like_count ?? 0;
  row.v2p0_hard_suppressed_count = v2p0.hard_ground_suppressed_count ?? 0;
  row.v2p0_grid_fill_fraction = v2p0.grid_fill_fraction ?? null;
  row.v2p0_structure_like_count = v2p0.structure_like_count ?? null;

  const v2p1 = md.v2p1_structural_coherence || {};
  row.v2p1_structural_coherence_score = v2p1.structural_coherence_score ?? null;
  row.v2p1_main_plane_count = v2p1.main_plane_count ?? null;
  row.v2p1_mirrored_pair_count = v2p1.mirrored_pair_count ?? null;
  row.v2p1_unpaired_main_planes = v2p1.unpaired_main_planes ?? null;
  row.v2p1_structural_warnings = v2p1.structural_warnings || [];

  const v2p2 = md.v2p2_main_roof_coherence || {};
  row.v2p2_main_roof_coherence_score = v2p2.main_roof_coherence_score ?? null;
  row.v2p2_main_roof_candidate_count = v2p2.main_roof_candidate_count ?? null;
  row.v2p2_secondary_count = v2p2.secondary_roof_candidate_count ?? null;
  row.v2p2_uncertain_count = v2p2.uncertain_face_count ?? null;
  row.v2p2_fragmented_main_roof = v2p2.fragmented_main_roof ?? null;
  row.v2p2_main_roof_warnings = v2p2.main_roof_warnings || [];

  const v2p3 = md.v2p3_roof_relationships || {};
  row.v2p3_roof_relationship_coherence_score = v2p3.roof_relationship_coherence_score ?? null;
  row.v2p3_ridge_count = v2p3.ridge_like_count ?? null;
  row.v2p3_hip_count = v2p3.hip_like_count ?? null;
  row.v2p3_valley_count = v2p3.valley_like_count ?? null;
  row.v2p3_seam_count = v2p3.seam_like_count ?? null;
  row.v2p3_step_count = v2p3.step_like_count ?? null;
  row.v2p3_uncertain_count = v2p3.uncertain_relationship_count ?? null;
  row.v2p3_main_relationship_count = v2p3.main_relationship_count ?? null;
  row.v2p3_relationship_warnings = v2p3.relationship_warnings || [];

  const v2p4 = md.v2p4_whole_roof_consistency || {};
  row.v2p4_whole_roof_consistency_score = v2p4.whole_roof_consistency_score ?? null;
  row.v2p4_dominant_story_strength = v2p4.dominant_story_strength ?? null;
  row.v2p4_uncertainty_ratio = v2p4.uncertainty_ratio ?? null;
  row.v2p4_contradiction_flags = v2p4.contradiction_flags || [];
  row.v2p4_whole_roof_warnings = v2p4.whole_roof_warnings || [];

  const v2p7 = md.v2p7_decision_integration || {};
  row.v2p7_decision_integration_applied = !!v2p7.v2_decision_integration_applied;
  row.v2p7_prior_status = v2p7.prior_status ?? null;
  row.v2p7_final_status = v2p7.final_status ?? null;
  row.v2p7_decision_change_applied = !!v2p7.decision_change_applied;
  row.v2p7_support_score = v2p7.support_score ?? null;
  row.v2p7_risk_score = v2p7.risk_score ?? null;
  row.v2p7_effective_risk_score = v2p7.effective_risk_score ?? null;
  row.v2p7_contradiction_penalty = v2p7.contradiction_penalty ?? null;
  row.v2p7_uncertainty_penalty = v2p7.uncertainty_penalty ?? null;
  row.v2p7_complexity_dampener = v2p7.complexity_dampener ?? null;
  row.v2p7_complexity_dampener_applied = v2p7.complexity_dampener_applied ?? null;
  row.v2p7_final_decision_score = v2p7.final_v2_decision_score ?? null;
  row.v2p7_explicit_escalation_triggers = (v2p7.explicit_escalation_triggers || []).map(t => t.id);
  row.v2p7_decision_reasons = v2p7.v2_decision_reasons || [];
  row.v2p7_decision_notes = v2p7.v2_decision_notes || [];
  const sig = v2p7.v2_supporting_signals || {};
  row.v2p7_clean_structural_story = sig.clean_structural_story ?? null;

  const v2p8 = md.v2p8_closeout || {};
  row.v2p8_closeout_applied = v2p8.v2_closeout_applied ?? null;
  row.v2_phase_status = v2p8.v2_phase_status ?? null;

  const v3p1 = md.v3p1_lidar_fusion || {};
  row.v3p1_applied = !!v3p1.v3_lidar_authority_applied;
  row.v3p1_plane_count_in = v3p1.plane_count_in ?? 0;
  row.v3p1_plane_count_out = v3p1.plane_count_out ?? 0;
  row.v3p1_lidar_veto_count = v3p1.lidar_veto_count ?? 0;
  row.v3p1_ridge_flag_count = v3p1.ridge_conflict_flag_count ?? 0;
  row.v3p1_partial_rescue = !!v3p1.partial_build_rescue_applied;

  const v3p2 = md.v3p2_polygon_construction || {};
  row.v3p2_applied = !!v3p2.v3_polygon_construction_applied;
  row.v3p2_candidate_polygon_count = v3p2.candidate_polygon_count ?? 0;
  row.v3p2_final_polygon_count = v3p2.final_polygon_face_count ?? 0;
  row.v3p2_splits = v3p2.split_polygon_count ?? 0;
  row.v3p2_merges = v3p2.merged_polygon_count ?? 0;
  row.v3p2_fallbacks = v3p2.fallback_polygon_count ?? 0;
  row.v3p2_snaps = v3p2.shared_boundary_snaps ?? 0;
  const eg = v3p2.edge_graph_summary || {};
  row.v3p2_edge_ridges = eg.ridges ?? 0;
  row.v3p2_edge_hips = eg.hips ?? 0;
  row.v3p2_edge_valleys = eg.valleys ?? 0;
  row.v3p2_edge_seams = eg.seams ?? 0;
  row.v3p2_edge_step_breaks = eg.step_breaks ?? 0;
  row.v3p2_edge_uncertain = eg.uncertain ?? 0;
  row.v3p2_warnings = v3p2.polygon_construction_warnings || [];

  return row;
}

// ── 6. Auto-bucketing ──────────────────────────────────────────────────────
function bucket_replay_result(row) {
  const buckets = [];

  // Replay health
  if (!row.replay_success) { buckets.push('replay_failed'); return buckets; }

  // Status buckets
  switch (row.final_status) {
    case 'auto_accept': buckets.push('clean_auto_accept'); break;
    case 'needs_review': buckets.push('needs_review'); break;
    case 'reject': buckets.push('reject'); break;
    default: buckets.push('status_' + (row.final_status || 'unknown'));
  }

  // Runtime buckets
  const t = row.total_runtime_ms;
  if (t != null) {
    if (t < 10000) buckets.push('fast_under_10s');
    else if (t < 15000) buckets.push('medium_10_to_15s');
    else buckets.push('slow_over_15s');
  }

  // Structural / story buckets (driven by V2P4 synthesis)
  if (row.v2p4_whole_roof_consistency_score != null
      && row.v2p4_whole_roof_consistency_score < 0.50) {
    buckets.push('weak_whole_roof_story');
  }
  if (row.v2p4_uncertainty_ratio != null && row.v2p4_uncertainty_ratio > 0.60) {
    buckets.push('high_uncertainty');
  }
  if ((row.v2p4_contradiction_flags || []).length > 0) {
    buckets.push('contradiction_present');
  }
  if (row.v2p1_structural_coherence_score != null
      && row.v2p1_structural_coherence_score < 0.45
      && (row.v2p1_main_plane_count || 0) >= 2) {
    buckets.push('weak_pair_coverage');
  }
  if (row.v2p2_fragmented_main_roof
      || (row.v2p2_main_roof_coherence_score != null
          && row.v2p2_main_roof_coherence_score < 0.40
          && row.face_count >= 2)) {
    buckets.push('fragmented_main_body');
  }

  // Ground / realism buckets
  if (row.v2p0_hard_suppressed_count > 0) {
    buckets.push('ground_suppression_triggered');
    if (row.v2p0_hard_suppressed_count >= 2) buckets.push('heavy_suppression');
  }
  if (row.v2p0_ground_like_count > 0) buckets.push('likely_ground_issue');

  // Fallback / correction buckets
  if (row.p8_pitch_correction_count > 0) buckets.push('p8_corrected');
  if (row.p9_fallback_reason === 'p9_build_unmatched') buckets.push('p9_unmatched');
  if (row.p9_fallback_reason === 'p9_low_match_fraction') buckets.push('p9_low_match_fraction');
  if (row.p9_fallback_reason === 'p9_low_match_confidence') buckets.push('p9_low_match_confidence');

  // Decision-layer change
  if (row.v2p7_decision_change_applied) buckets.push('v2p7_escalation_applied');

  return buckets;
}

// Visual-review priority (higher = more urgent).
function visual_review_priority(row, buckets) {
  let priority = 0;
  const reasons = [];
  if (!row.replay_success) { return { priority: 99, reasons: ['replay_failed'] }; }
  if (buckets.includes('reject')) { priority += 10; reasons.push('reject'); }
  if (buckets.includes('contradiction_present')) { priority += 5; reasons.push('contradiction_present'); }
  if (buckets.includes('weak_whole_roof_story')) { priority += 5; reasons.push('weak_whole_roof_story'); }
  if (buckets.includes('fragmented_main_body')) { priority += 4; reasons.push('fragmented_main_body'); }
  if (buckets.includes('high_uncertainty')) { priority += 3; reasons.push('high_uncertainty'); }
  if (buckets.includes('heavy_suppression')) { priority += 4; reasons.push('heavy_suppression'); }
  if (buckets.includes('ground_suppression_triggered')) { priority += 2; reasons.push('ground_suppression_triggered'); }
  if (buckets.includes('likely_ground_issue')) { priority += 2; reasons.push('likely_ground_issue'); }
  if (buckets.includes('slow_over_15s')) { priority += 2; reasons.push('slow_over_15s'); }
  if (buckets.includes('p9_unmatched')) { priority += 3; reasons.push('p9_unmatched'); }
  if (buckets.includes('p9_low_match_fraction')) { priority += 2; reasons.push('p9_low_match_fraction'); }
  if (buckets.includes('p9_low_match_confidence')) { priority += 2; reasons.push('p9_low_match_confidence'); }
  if (buckets.includes('needs_review') && priority === 0) { priority += 1; reasons.push('needs_review_only'); }
  return { priority, reasons };
}

// ── 7. Output writers ──────────────────────────────────────────────────────
function ensure_out_dir() {
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
}

function write_json(rows) {
  const p = path.join(OUT_DIR, 'replay_results.json');
  fs.writeFileSync(p, JSON.stringify({
    generated_at: new Date().toISOString(),
    batch_size: rows.length,
    rows,
  }, null, 2));
  return p;
}

function write_csv(rows) {
  const cols = [
    'project_id', 'case_label', 'address_label', 'bucket_expected',
    'replay_success', 'replay_error',
    'final_status', 'face_count',
    'total_runtime_ms', 'ml_runtime_ms', 'crm_post_ml_ms', 'top_hotspot',
    'v2p0_ground_like_count', 'v2p0_hard_suppressed_count',
    'v2p1_structural_coherence_score', 'v2p1_main_plane_count', 'v2p1_mirrored_pair_count',
    'v2p2_main_roof_coherence_score', 'v2p2_fragmented_main_roof',
    'v2p3_roof_relationship_coherence_score', 'v2p3_main_relationship_count', 'v2p3_uncertain_count',
    'v2p4_whole_roof_consistency_score', 'v2p4_dominant_story_strength', 'v2p4_uncertainty_ratio',
    'v2p7_support_score', 'v2p7_risk_score', 'v2p7_effective_risk_score',
    'v2p7_complexity_dampener', 'v2p7_final_decision_score',
    'v2p7_decision_change_applied', 'v2p7_clean_structural_story',
    'p8_pitch_correction_count', 'p9_fallback_verdict', 'p9_matched_fraction',
    'review_reasons', 'v2p4_contradiction_flags', 'v2p7_explicit_escalation_triggers',
    'v2p7_decision_reasons', 'buckets', 'visual_review_priority',
  ];
  const esc = v => {
    if (v == null) return '';
    if (Array.isArray(v)) v = v.join('|');
    const s = String(v).replace(/"/g, '""');
    return /[",\n]/.test(s) ? `"${s}"` : s;
  };
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map(c => esc(r[c])).join(','));
  const p = path.join(OUT_DIR, 'replay_results.csv');
  fs.writeFileSync(p, lines.join('\n'));
  return p;
}

function fmt_n(n, digits = 2) {
  if (n == null) return '—';
  if (typeof n === 'number') return n.toFixed(digits);
  return String(n);
}

function write_markdown(rows) {
  const successful = rows.filter(r => r.replay_success);
  const failed = rows.filter(r => !r.replay_success);

  const statusCounts = {};
  const bucketCounts = {};
  for (const r of rows) {
    if (r.final_status) statusCounts[r.final_status] = (statusCounts[r.final_status] || 0) + 1;
    for (const b of r.buckets || []) bucketCounts[b] = (bucketCounts[b] || 0) + 1;
  }

  const runtimes = successful.map(r => r.total_runtime_ms).filter(n => n != null).sort((a, b) => a - b);
  const rtSummary = runtimes.length ? {
    min: runtimes[0],
    median: runtimes[Math.floor(runtimes.length / 2)],
    max: runtimes[runtimes.length - 1],
    mean: Math.round(runtimes.reduce((a, b) => a + b, 0) / runtimes.length),
  } : null;

  const forReview = rows
    .map(r => ({ r, p: visual_review_priority(r, r.buckets || []) }))
    .filter(x => x.p.priority > 0)
    .sort((a, b) => b.p.priority - a.p.priority);

  const lines = [];
  lines.push('# V3P0 Replay Results');
  lines.push('');
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`Batch size: ${rows.length} — succeeded: ${successful.length}, failed: ${failed.length}`);
  lines.push('');

  lines.push('## Status distribution');
  lines.push('');
  lines.push('| Status | Count |');
  lines.push('|---|---:|');
  for (const [k, v] of Object.entries(statusCounts).sort()) lines.push(`| ${k} | ${v} |`);
  lines.push('');

  if (rtSummary) {
    lines.push('## Runtime summary');
    lines.push('');
    lines.push('| Metric | ms |');
    lines.push('|---|---:|');
    lines.push(`| min | ${rtSummary.min} |`);
    lines.push(`| median | ${rtSummary.median} |`);
    lines.push(`| mean | ${rtSummary.mean} |`);
    lines.push(`| max | ${rtSummary.max} |`);
    lines.push('');
  }

  lines.push('## Bucket counts');
  lines.push('');
  lines.push('| Bucket | Count |');
  lines.push('|---|---:|');
  for (const [k, v] of Object.entries(bucketCounts).sort((a, b) => b[1] - a[1])) lines.push(`| ${k} | ${v} |`);
  lines.push('');

  lines.push('## Per-case summary');
  lines.push('');
  lines.push('| Case | Prior→Final | Faces | V3P1 in→out veto/ridge | V3P2 sp/mg/fb/sn | Runtime | WholeRoof | FinalScore | V2P7 triggers | Reasons / errors |');
  lines.push('|---|---|---:|---|---|---:|---:|---:|---|---|');
  for (const r of rows) {
    const label = r.case_label || r.project_id;
    const priorFinal = r.replay_success
      ? `${r.v2p7_prior_status || '—'}→${r.v2p7_final_status || r.final_status || '—'}`
      : 'FAIL';
    const v3p1Col = r.replay_success
      ? `${r.v3p1_plane_count_in}→${r.v3p1_plane_count_out} ${r.v3p1_lidar_veto_count}/${r.v3p1_ridge_flag_count}${r.v3p1_partial_rescue ? '+rescue' : ''}`
      : '—';
    const v3p2Col = r.replay_success
      ? `${r.v3p2_splits}/${r.v3p2_merges}/${r.v3p2_fallbacks}/${r.v3p2_snaps}`
      : '—';
    const triggers = (r.v2p7_explicit_escalation_triggers || []).join(', ') || '—';
    const reasonsOrErr = r.replay_success
      ? (r.v2p7_decision_reasons.concat(r.review_reasons.filter(x => !r.v2p7_decision_reasons.includes(x))).join(', ') || '—')
      : (r.replay_error || '—');
    lines.push(`| ${label} | ${priorFinal} | ${r.face_count} | ${v3p1Col} | ${v3p2Col} | ${r.total_runtime_ms ?? '—'} | ${fmt_n(r.v2p4_whole_roof_consistency_score)} | ${fmt_n(r.v2p7_final_decision_score)} | ${triggers} | ${reasonsOrErr} |`);
  }
  lines.push('');

  lines.push('## Recommended cases for visual review');
  lines.push('');
  if (forReview.length === 0) {
    lines.push('_No cases flagged by automatic triggers._ Consider reviewing a random sample of `clean_auto_accept` for sanity.');
  } else {
    lines.push('| Priority | Case | Reasons |');
    lines.push('|---:|---|---|');
    for (const x of forReview) {
      const label = x.r.case_label || x.r.project_id;
      lines.push(`| ${x.p.priority} | ${label} | ${x.p.reasons.join(', ')} |`);
    }
    lines.push('');
    lines.push('Also include a random sample of `clean_auto_accept` cases for sanity checking.');
  }
  lines.push('');

  if (failed.length > 0) {
    lines.push('## Replay failures');
    lines.push('');
    lines.push('| Case | Error |');
    lines.push('|---|---|');
    for (const r of failed) {
      lines.push(`| ${r.case_label || r.project_id} | ${r.replay_error} |`);
    }
    lines.push('');
  }

  const p = path.join(OUT_DIR, 'replay_results.md');
  fs.writeFileSync(p, lines.join('\n'));
  return p;
}

function write_replay_outputs(rows) {
  ensure_out_dir();
  const jsonPath = write_json(rows);
  const csvPath = write_csv(rows);
  const mdPath = write_markdown(rows);
  return { jsonPath, csvPath, mdPath };
}

// ── 8. Batch summary ───────────────────────────────────────────────────────
function summarize_replay_batch(rows) {
  const n = rows.length;
  const succ = rows.filter(r => r.replay_success).length;
  const statusCounts = {};
  for (const r of rows) {
    if (r.final_status) statusCounts[r.final_status] = (statusCounts[r.final_status] || 0) + 1;
  }
  return { total: n, succeeded: succ, failed: n - succ, statusCounts };
}

// ── main ───────────────────────────────────────────────────────────────────
(async () => {
  const cases = load_replay_cases(CASES_PATH);
  console.log(`[v3p0] loaded ${cases.length} replay cases from ${path.basename(CASES_PATH)}`);
  console.log(`[v3p0] target: ${CRM_URL} (user=${CRM_USER})`);

  let cookie;
  try {
    cookie = await login(CRM_URL, CRM_USER, CRM_PASS);
    console.log('[v3p0] logged in');
  } catch (e) {
    console.error('[v3p0] login failed:', e.message);
    process.exit(2);
  }

  const rows = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    const label = c.label || c.projectId;
    process.stdout.write(`[v3p0] (${i + 1}/${cases.length}) ${label}... `);
    const raw = await run_replay_case(CRM_URL, cookie, c);
    const row = normalize_replay_result(raw);
    row.buckets = bucket_replay_result(row);
    rows.push(row);
    if (row.replay_success) {
      console.log(`OK  status=${row.final_status} faces=${row.face_count} score=${fmt_n(row.v2p7_final_decision_score)} runtime=${row.total_runtime_ms}ms buckets=[${row.buckets.join(',')}]`);
    } else {
      console.log(`FAIL  ${row.replay_error}`);
    }
  }

  const { jsonPath, csvPath, mdPath } = write_replay_outputs(rows);
  const summary = summarize_replay_batch(rows);

  console.log('');
  console.log('[v3p0] batch complete');
  console.log(`[v3p0] total=${summary.total} succeeded=${summary.succeeded} failed=${summary.failed}`);
  console.log('[v3p0] status counts:', summary.statusCounts);
  console.log(`[v3p0] outputs: ${path.relative(process.cwd(), jsonPath)}, ${path.relative(process.cwd(), csvPath)}, ${path.relative(process.cwd(), mdPath)}`);
})().catch(e => {
  console.error('[v3p0] harness crashed:', e.stack || e.message);
  process.exit(1);
});
