/**
 * Calibrated Confidence Scorer
 *
 * Computes a deterministic, rule-based confidence score that blends:
 *   1. Structured data availability and quality
 *   2. Cross-source agreement (contradiction classification)
 *   3. Source diversity (how many file types contributed)
 *   4. Period alignment (do metrics match the implied question period?)
 *   5. Retrieval coverage (how many document chunks were found)
 *   6. Model-generated confidence (weighted minority input)
 *
 * The model's raw confidence is intentionally downweighted so that
 * well-structured data drives the score rather than LLM calibration.
 */

import type {
  CalibratedConfidence,
  ConfidenceFactors,
} from "./types";

// ─── Scoring weights ──────────────────────────────────────────────────────────
//
// Design goals:
//  • Ground-truth CSV + multi-source agreement → 90–98
//  • Ground-truth CSV + single source          → 74–82
//  • High-conf structured + consistent         → 83–90
//  • High-conf structured + single source      → 65–74
//  • Pure retrieval (no structure)             → 45–68 (model-driven)
//  • Any conflict present                      → hard cap ~35–52
//
// Key design principle: model confidence is downweighted more aggressively
// when structured/ground-truth data is present — the data speaks for itself.
// This prevents conservative model scores from pulling strong data below 90.

const WEIGHTS = {
  groundTruth: 60,        // CSV-derived metrics: 60 base
  highConfStructured: 33, // AI-extracted metrics with confidence >= 80
  contradictionBonus: {
    consistent: 30,            // CSV(60) + consistent(30) = 90 baseline ✓
    minor_variance: 5,
    conflict: -28,             // hard penalty; conflicts destroy trust
    insufficient_evidence: 12, // single source — slightly positive (we trust CSV)
  },
  perDistinctSource: 6,   // +6 per additional corroborating file type (max 3 × 6 = +18)
  derivedBonus: 3,
  periodMismatchPenalty: -15,
  guidanceVsActualPenalty: -10,
  retrievalCoverage: {
    none: 0,
    some: 8,    // 1–2 chunks
    good: 13,   // 3–5 chunks
    strong: 18, // 6+ chunks
  },
};

// ─── Calibration function ─────────────────────────────────────────────────────

export function calibrateConfidence(
  factors: ConfidenceFactors
): CalibratedConfidence {
  const adjustments: Array<{ reason: string; delta: number }> = [];
  let base = 0;

  // ── Structured data availability ─────────────────────────────────────────
  if (factors.hasGroundTruthMetrics) {
    base += WEIGHTS.groundTruth;
    adjustments.push({ reason: "Ground-truth (CSV) metrics present", delta: WEIGHTS.groundTruth });
  } else if (factors.hasHighConfidenceStructured) {
    base += WEIGHTS.highConfStructured;
    adjustments.push({ reason: "High-confidence structured metrics present", delta: WEIGHTS.highConfStructured });
  }

  // ── Cross-source agreement ────────────────────────────────────────────────
  const contradictionDelta =
    WEIGHTS.contradictionBonus[factors.contradictionClass];
  if (contradictionDelta !== 0) {
    base += contradictionDelta;
    adjustments.push({
      reason: `Source agreement: ${factors.contradictionClass}`,
      delta: contradictionDelta,
    });
  }

  // ── Source diversity ──────────────────────────────────────────────────────
  // First source already counted above; bonus for each additional
  const extraSources = Math.min(factors.distinctSourceCount - 1, 3);
  if (extraSources > 0) {
    const delta = extraSources * WEIGHTS.perDistinctSource;
    base += delta;
    adjustments.push({
      reason: `${extraSources} additional corroborating source(s)`,
      delta,
    });
  }

  // ── Derived metrics uplift ────────────────────────────────────────────────
  if (factors.hasDerivedMetrics) {
    base += WEIGHTS.derivedBonus;
    adjustments.push({ reason: "Derived metrics computed from raw values", delta: WEIGHTS.derivedBonus });
  }

  // ── Period penalties ──────────────────────────────────────────────────────
  if (factors.periodMismatch) {
    base += WEIGHTS.periodMismatchPenalty;
    adjustments.push({ reason: "Period mismatch between question and available data", delta: WEIGHTS.periodMismatchPenalty });
  }
  if (factors.mixesActualAndGuidance) {
    base += WEIGHTS.guidanceVsActualPenalty;
    adjustments.push({ reason: "Mixes actual and guidance figures", delta: WEIGHTS.guidanceVsActualPenalty });
  }

  // ── Retrieval coverage ────────────────────────────────────────────────────
  const n = factors.retrievalHitCount;
  const retrievalDelta =
    n === 0
      ? WEIGHTS.retrievalCoverage.none
      : n <= 2
      ? WEIGHTS.retrievalCoverage.some
      : n <= 5
      ? WEIGHTS.retrievalCoverage.good
      : WEIGHTS.retrievalCoverage.strong;

  if (retrievalDelta > 0) {
    base += retrievalDelta;
    adjustments.push({
      reason: `${n} retrieved document chunk(s)`,
      delta: retrievalDelta,
    });
  }

  // ── Blend with model confidence (dynamic weight by data quality) ──────────
  // When structured/CSV data exists, the model's calibration matters less —
  // the data evidence is the primary signal. For pure retrieval answers,
  // the model's confidence carries more weight since we have no ground truth.
  const modelWeight = factors.hasGroundTruthMetrics
    ? 0.06  // CSV: model barely affects the score
    : factors.hasHighConfidenceStructured
    ? 0.22  // Structured AI-extracted: moderate influence
    : 0.48; // Pure retrieval: model is the primary signal

  const modelContribution = factors.modelRawConfidence * modelWeight;
  const ruleContribution = base * (1 - modelWeight);
  const blended = ruleContribution + modelContribution;

  adjustments.push({
    reason: `Model confidence blend (${Math.round(modelWeight * 100)}% weight)`,
    delta: Math.round(modelContribution - base * modelWeight),
  });

  const score = Math.min(100, Math.max(0, Math.round(blended)));

  return { score, factors, adjustments };
}
