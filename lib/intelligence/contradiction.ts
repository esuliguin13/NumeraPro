/**
 * Contradiction Detector
 *
 * Compares the same canonical metric across multiple document sources
 * (CSV, PDF, transcript) for the same period and classifies the agreement:
 *
 *   consistent          – all sources within tolerance
 *   minor_variance      – small numeric deviation (2–10 % relative, or ≤3pp for margins)
 *   conflict            – material disagreement (>10 % relative, or >3pp for margins)
 *   insufficient_evidence – only one source; cannot compare
 *
 * Tolerance is tighter for percentage metrics (margins) and looser for
 * large absolute figures where rounding/unit differences are common.
 */

import type {
  CanonicalMetricType,
  ContradictionClass,
  ContradictionEvidence,
  ContradictionResult,
  NormalizedMetric,
} from "./types";

// ─── Tolerance thresholds ─────────────────────────────────────────────────────

/** For absolute-value metrics (revenue, EBITDA, net income…) */
const RELATIVE_CONSISTENT_PCT = 2;    // ≤ 2 %  → consistent
const RELATIVE_MINOR_PCT = 10;        // ≤ 10 % → minor_variance  (else conflict)

/** For margin / percentage metrics */
const MARGIN_CONSISTENT_PP = 0.5;     // ≤ 0.5 pp → consistent
const MARGIN_MINOR_PP = 3;            // ≤ 3 pp   → minor_variance

const MARGIN_TYPES = new Set<CanonicalMetricType>([
  "ebitda_margin",
  "net_margin",
  "gross_margin",
  "operating_margin",
  "margin",
  "yoy_growth",
  "qoq_growth",
]);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pctDeviation(a: number, b: number): number {
  if (b === 0) return a === 0 ? 0 : 100;
  return Math.abs((a - b) / b) * 100;
}

function absDeviation(a: number, b: number): number {
  return Math.abs(a - b);
}

function classifyDeviation(
  deviation: number,
  isMarginType: boolean
): ContradictionClass {
  if (isMarginType) {
    if (deviation <= MARGIN_CONSISTENT_PP) return "consistent";
    if (deviation <= MARGIN_MINOR_PP) return "minor_variance";
    return "conflict";
  }
  if (deviation <= RELATIVE_CONSISTENT_PCT) return "consistent";
  if (deviation <= RELATIVE_MINOR_PCT) return "minor_variance";
  return "conflict";
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Analyses all normalized metrics (potentially from multiple documents
 * in the workspace) and returns one ContradictionResult per canonical
 * type × normalised period group.
 */
export function detectContradictions(
  metrics: NormalizedMetric[]
): ContradictionResult[] {
  // Group by canonicalType × normalizedPeriod
  const groups = new Map<string, NormalizedMetric[]>();

  for (const m of metrics) {
    const key = `${m.canonicalType}::${m.normalizedPeriod ?? "unknown"}`;
    const arr = groups.get(key) ?? [];
    arr.push(m);
    groups.set(key, arr);
  }

  const results: ContradictionResult[] = [];

  for (const [key, group] of groups.entries()) {
    // De-duplicate: keep one metric per source document (highest confidence)
    const byDoc = new Map<string, NormalizedMetric>();
    for (const m of group) {
      const existing = byDoc.get(m.documentId);
      if (!existing || m.confidence > existing.confidence) {
        byDoc.set(m.documentId, m);
      }
    }

    const distinct = [...byDoc.values()].sort(
      (a, b) => b.sourcePriority - a.sourcePriority
    );

    // Build evidence array
    const evidence: ContradictionEvidence[] = distinct.map((m) => ({
      sourceDocumentId: m.documentId,
      sourceFileType: m.sourceFileType,
      sourcePriority: m.sourcePriority,
      metricName: m.metricName,
      value: m.value,
      unit: m.unit,
      confidence: m.confidence,
      rawText: m.rawText,
    }));

    const [canonicalType, period] = key.split("::") as [
      CanonicalMetricType,
      string
    ];
    const normalizedPeriod = period === "unknown" ? null : period;

    // Reference = highest-priority source
    const reference = distinct[0];

    if (distinct.length < 2) {
      results.push({
        canonicalType,
        normalizedPeriod,
        classification: "insufficient_evidence",
        referenceValue: reference?.value ?? null,
        referenceUnit: reference?.unit ?? null,
        maxVariancePct: null,
        evidence,
        notes: "Only one source for this metric; cross-validation not possible.",
      });
      continue;
    }

    // Filter to metrics with non-null values for numeric comparison
    const withValues = distinct.filter((m) => m.value !== null);

    if (withValues.length < 2) {
      results.push({
        canonicalType,
        normalizedPeriod,
        classification: "insufficient_evidence",
        referenceValue: reference?.value ?? null,
        referenceUnit: reference?.unit ?? null,
        maxVariancePct: null,
        evidence,
        notes: "Insufficient numeric values across sources for comparison.",
      });
      continue;
    }

    const refValue = withValues[0].value as number;
    const isMargin = MARGIN_TYPES.has(canonicalType);

    let maxDeviation = 0;
    const deviationNotes: string[] = [];

    for (const m of withValues.slice(1)) {
      const val = m.value as number;
      const dev = isMargin
        ? absDeviation(val, refValue)
        : pctDeviation(val, refValue);

      if (dev > maxDeviation) maxDeviation = dev;

      const devLabel = isMargin
        ? `${dev.toFixed(1)}pp`
        : `${dev.toFixed(1)}%`;

      deviationNotes.push(
        `${m.sourceFileType.toUpperCase()}(${m.metricName}): ${val}${m.unit ?? ""} vs ref ${refValue}${withValues[0].unit ?? ""} (Δ${devLabel})`
      );
    }

    const classification = classifyDeviation(maxDeviation, isMargin);

    const noteSuffix =
      classification === "conflict"
        ? ` CONFLICT — values differ materially.`
        : classification === "minor_variance"
        ? ` Minor variance — likely rounding or unit differences.`
        : ` All sources agree.`;

    results.push({
      canonicalType,
      normalizedPeriod,
      classification,
      referenceValue: refValue,
      referenceUnit: withValues[0].unit,
      maxVariancePct: isMargin ? null : maxDeviation,
      evidence,
      notes: deviationNotes.join(" | ") + noteSuffix,
    });
  }

  return results;
}

// ─── Helpers used by index.ts ─────────────────────────────────────────────────

export function worstContradictionClass(
  contradictions: ContradictionResult[]
): ContradictionClass {
  const order: ContradictionClass[] = [
    "conflict",
    "minor_variance",
    "consistent",
    "insufficient_evidence",
  ];
  for (const cls of order) {
    if (contradictions.some((c) => c.classification === cls)) return cls;
  }
  return "insufficient_evidence";
}
