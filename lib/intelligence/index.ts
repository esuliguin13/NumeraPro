/**
 * Intelligence Engine — Main Entry Point
 *
 * Orchestrates all intelligence sub-modules for a single matrix cell execution:
 *
 *   normalizeMetric   → canonical type, period, adjusted/guidance flags, source priority
 *   detectContradictions → cross-source agreement classification
 *   computeDerivedMetrics → EBITDA margin, net margin, YoY growth…
 *   selectBestMetrics → one authoritative metric per canonical type
 *   calibrateConfidence → rule-based score (factored in after model inference)
 *
 * Input:
 *   thisDocMetrics   – metrics extracted from the specific document being analysed
 *   allWorkspaceMetrics – ALL metrics from every document in the workspace
 *                         (with associated file_type), used for cross-doc contradiction
 *   question         – the analyst question (used to infer expected period)
 *   retrievalHitCount – how many chunks vector search returned (0 if not run)
 *   modelRawConfidence – what the synthesis model returned (applied with 25% weight)
 */

import type { ExtractedMetricRow } from "@/types";
import type {
  IntelligenceResult,
  NormalizedMetric,
  SourceFileType,
} from "./types";
import { normalizeMetric, selectBestMetrics } from "./normalizer";
import { detectContradictions, worstContradictionClass } from "./contradiction";
import { computeDerivedMetrics } from "./derived";
import { calibrateConfidence } from "./confidence";

// ─── Period extraction from question text ─────────────────────────────────────

function inferQuestionPeriod(question: string): {
  fiscalYear: number | null;
  fiscalQuarter: number | null;
} {
  const q = question;
  const qm = q.match(/Q([1-4])[\s\-]?(20\d{2})/i);
  if (qm) return { fiscalQuarter: parseInt(qm[1]), fiscalYear: parseInt(qm[2]) };

  const fy = q.match(/(?:FY|full\s*year)[\s\-]?(20\d{2})/i);
  if (fy) return { fiscalQuarter: null, fiscalYear: parseInt(fy[1]) };

  const yr = q.match(/\b(20\d{2})\b/);
  if (yr) return { fiscalQuarter: null, fiscalYear: parseInt(yr[1]) };

  return { fiscalYear: null, fiscalQuarter: null };
}

// ─── Main function ────────────────────────────────────────────────────────────

export interface IntelligenceInput {
  /** Metrics for the specific document this cell is about. */
  thisDocMetrics: Array<ExtractedMetricRow & { fileType: SourceFileType }>;
  /** All workspace metrics across every document (for contradiction detection). */
  allWorkspaceMetrics: Array<ExtractedMetricRow & { fileType: SourceFileType }>;
  question: string;
  retrievalHitCount: number;
  modelRawConfidence: number;
}

export function runIntelligence(input: IntelligenceInput): IntelligenceResult {
  const {
    thisDocMetrics,
    allWorkspaceMetrics,
    question,
    retrievalHitCount,
    modelRawConfidence,
  } = input;

  // ── 1. Normalize this document's metrics ────────────────────────────────
  const normalizedThis: NormalizedMetric[] = thisDocMetrics.map((m) =>
    normalizeMetric(m, m.fileType)
  );

  // ── 2. Normalize ALL workspace metrics (for cross-doc comparison) ────────
  const normalizedAll: NormalizedMetric[] = allWorkspaceMetrics.map((m) =>
    normalizeMetric(m, m.fileType)
  );

  // ── 3. Compute derived metrics for this document ─────────────────────────
  const derivedMetrics = computeDerivedMetrics(normalizedThis);

  // ── 4. Merge this doc's metrics + derived for synthesis context ──────────
  const allThisDoc = [...normalizedThis, ...derivedMetrics];

  // ── 5. Cross-source contradiction detection (all workspace metrics) ───────
  const contradictions = detectContradictions(normalizedAll);

  // ── 6. Select best metric per canonical type from this document ───────────
  const bestMetrics = selectBestMetrics(allThisDoc);

  // ── 7. Confidence factor computation ─────────────────────────────────────
  const questionPeriod = inferQuestionPeriod(question);

  const hasGroundTruth = normalizedThis.some((m) => m.confidence === 100);
  const hasHighConf = normalizedThis.some((m) => m.confidence >= 80);
  const distinctSources = new Set(normalizedThis.map((m) => m.sourceFileType)).size;
  const worstClass = worstContradictionClass(contradictions);

  // Period mismatch: does any high-priority metric have a different period
  // from what the question implies?
  let periodMismatch = false;
  if (questionPeriod.fiscalYear !== null && normalizedThis.length > 0) {
    const topMetrics = normalizedThis.filter((m) => m.sourcePriority >= 70);
    const hasMatchingPeriod = topMetrics.some(
      (m) =>
        m.fiscalYear === questionPeriod.fiscalYear &&
        (questionPeriod.fiscalQuarter === null ||
          m.fiscalQuarter === questionPeriod.fiscalQuarter)
    );
    periodMismatch = topMetrics.length > 0 && !hasMatchingPeriod;
  }

  const mixesActualAndGuidance =
    normalizedThis.some((m) => m.isGuidance) &&
    normalizedThis.some((m) => !m.isGuidance);

  const factors = {
    hasGroundTruthMetrics: hasGroundTruth,
    hasHighConfidenceStructured: hasHighConf,
    contradictionClass: worstClass,
    distinctSourceCount: distinctSources,
    hasDerivedMetrics: derivedMetrics.length > 0,
    periodMismatch,
    mixesActualAndGuidance,
    retrievalHitCount,
    modelRawConfidence,
  };

  const calibrated = calibrateConfidence(factors);

  // ── 8. Summary ────────────────────────────────────────────────────────────
  const primarySources = [
    ...new Set(normalizedThis.map((m) => m.sourceFileType)),
  ] as SourceFileType[];

  return {
    normalizedMetrics: normalizedThis,
    derivedMetrics,
    contradictions,
    bestMetrics,
    confidenceFactors: calibrated.factors,
    summary: {
      totalMetrics: normalizedThis.length,
      groundTruthCount: normalizedThis.filter((m) => m.confidence === 100).length,
      derivedCount: derivedMetrics.length,
      conflictCount: contradictions.filter((c) => c.classification === "conflict").length,
      consistentCount: contradictions.filter((c) => c.classification === "consistent").length,
      primarySources,
    },
  };
}

// ─── Synthesis context builder ────────────────────────────────────────────────

/**
 * Formats the intelligence result into a concise text block that the
 * synthesis prompt can include as structured context.
 */
export function buildIntelligenceContext(result: IntelligenceResult): string {
  const lines: string[] = [];

  // Best metrics (authoritative values)
  if (result.bestMetrics.length > 0) {
    lines.push("### Authoritative Metrics (source-ranked)");
    result.bestMetrics.forEach((m, i) => {
      const valueStr = m.value !== null ? `${m.value}${m.unit ? " " + m.unit : ""}` : "N/A";
      const periodStr = m.normalizedPeriod ? ` (${m.normalizedPeriod})` : "";
      const tags: string[] = [];
      if (m.confidence === 100) tags.push("ground truth");
      if (m.isDerived) tags.push("derived");
      if (m.isAdjusted) tags.push("adjusted");
      if (m.isGuidance) tags.push("guidance");
      const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";
      const srcStr = ` | src: ${m.sourceFileType.toUpperCase()} | conf: ${m.confidence}%`;
      lines.push(`[M${i + 1}] ${m.metricName}: ${valueStr}${periodStr}${tagStr}${srcStr}`);
    });
  }

  // Contradictions
  const conflicts = result.contradictions.filter(
    (c) => c.classification === "conflict" || c.classification === "minor_variance"
  );
  if (conflicts.length > 0) {
    lines.push("\n### Cross-Source Discrepancies");
    for (const c of conflicts) {
      const severity = c.classification === "conflict" ? "⚠ CONFLICT" : "~ minor variance";
      lines.push(
        `${severity} — ${c.canonicalType} (${c.normalizedPeriod ?? "period unknown"}): ` +
        c.notes
      );
    }
  }

  // Derived metrics
  if (result.derivedMetrics.length > 0) {
    lines.push("\n### Derived Metrics (calculated from raw values)");
    result.derivedMetrics.forEach((m) => {
      const valueStr = m.value !== null ? `${m.value}${m.unit ? " " + m.unit : ""}` : "N/A";
      lines.push(
        `${m.metricName}: ${valueStr} (${m.derivedFormula ?? "derived"}, conf: ${m.confidence}%)`
      );
    });
  }

  return lines.join("\n");
}
