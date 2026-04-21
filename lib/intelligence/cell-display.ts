/**
 * Helpers for rendering matrix cell and citation panel content
 * from intelligence metadata stored in matrix_answers.metadata.
 *
 * No model calls — pure data transformation from stored JSON.
 */

import { formatKpiValue } from "./executive-summary";

// ─── Internal metadata shapes (stored by execute route) ───────────────────────

interface StoredBestMetric {
  canonical_type: string;
  metric_name: string;
  value: number | null;
  unit: string | null;
  period: string | null;
  confidence: number;
  source_file_type: string;
  is_derived: boolean;
  is_adjusted: boolean;
  is_guidance: boolean;
  derived_formula?: string | null;
}

interface StoredDerivedMetric {
  canonical_type: string;
  metric_name: string;
  value: number | null;
  unit: string | null;
  period: string | null;
  formula: string | null;
  confidence: number;
}

// ─── Public display types ──────────────────────────────────────────────────────

export interface CellMetricDisplay {
  /** Primary metric that best answers the question */
  primaryLabel: string;       // e.g. "EBITDA"
  primaryValue: string;       // formatted, e.g. "$32.6M"
  period: string | null;
  isAdjusted: boolean;
  isGuidance: boolean;
  sourceType: string;         // "csv" | "pdf" | "transcript"
  confidence: number;

  /** Best secondary metric (YoY, margin, etc.) */
  supportingLabel: string | null;  // e.g. "25.4% margin" | "+18% YoY"
  supportingPositive: boolean | null;  // for green/red coloring

  /** Conflict info */
  conflictValue: string | null;    // other source's value, if conflict
  conflictSourceType: string | null;
}

export interface CellIntelligenceSignals {
  primarySources: string[];
  isMultiSourceConfirmed: boolean;
  hasDerived: boolean;
  hasConflict: boolean;
  hasVariance: boolean;
  isGroundTruth: boolean;
}

export interface CellDisplayData {
  mode: "structured" | "qualitative";
  metric: CellMetricDisplay | null;
  signals: CellIntelligenceSignals;
  /** Used only in qualitative mode */
  qualitativeText: string | null;
  /**
   * First sentence of the answer text — used by the comparison layout to show
   * a short summary sentence before the metric delta row.
   */
  summaryText: string | null;
  /**
   * The question type stored in the answer metadata.
   * Used by the cell to pick the right rendering sub-layout
   * (bullet list for risk, delta display for comparison, etc.)
   */
  questionType: "financial" | "analytical" | "qualitative" | "comparison" | null;
}

// ─── Keyword → canonical type mapping ────────────────────────────────────────

const QUESTION_KEYWORD_MAP: Array<{ keywords: string[]; types: string[] }> = [
  { keywords: ["revenue", "sales", "topline", "top line", "arr", "mrr"], types: ["revenue"] },
  { keywords: ["ebitda"], types: ["ebitda", "ebitda_margin"] },
  { keywords: ["net income", "net profit", "bottom line", "earnings"], types: ["net_income", "net_margin"] },
  { keywords: ["gross profit", "gross margin"], types: ["gross_profit", "gross_margin"] },
  { keywords: ["operating income", "ebit", "operating margin"], types: ["operating_income", "operating_margin"] },
  { keywords: ["margin"], types: ["ebitda_margin", "net_margin", "gross_margin", "operating_margin"] },
  { keywords: ["guidance", "outlook", "forecast"], types: ["guidance"] },
  { keywords: ["headcount", "employee", "staff", "fte"], types: ["headcount"] },
  { keywords: ["growth", "yoy", "year over year"], types: ["yoy_growth", "revenue"] },
  { keywords: ["cash flow", "fcf", "capex"], types: ["custom"] },
];

function scoreMetricForQuestion(questionText: string, canonicalType: string): number {
  const q = questionText.toLowerCase();
  for (const { keywords, types } of QUESTION_KEYWORD_MAP) {
    if (keywords.some((kw) => q.includes(kw)) && types.includes(canonicalType)) {
      return 10;
    }
  }
  return 0;
}

// ─── Supporting metric label ──────────────────────────────────────────────────

function buildSupportingLabel(
  primaryType: string,
  derived: StoredDerivedMetric[],
): { label: string | null; positive: boolean | null } {
  // Prefer: margin for EBITDA/net income; YoY for revenue; margin for gross_profit
  const marginTypes: Record<string, string> = {
    ebitda: "ebitda_margin",
    net_income: "net_margin",
    gross_profit: "gross_margin",
    operating_income: "operating_margin",
  };
  const marginCanonical = marginTypes[primaryType];
  if (marginCanonical) {
    const m = derived.find((d) => d.canonical_type === marginCanonical && d.value !== null);
    if (m) return { label: `${m.value!.toFixed(1)}% margin`, positive: m.value! > 0 };
  }

  // YoY growth as fallback for revenue
  if (primaryType === "revenue") {
    const yoy = derived.find((d) => d.canonical_type === "yoy_growth" && d.value !== null);
    if (yoy) {
      const sign = yoy.value! >= 0 ? "+" : "";
      return { label: `${sign}${yoy.value!.toFixed(1)}% YoY`, positive: yoy.value! >= 0 };
    }
  }

  return { label: null, positive: null };
}

// ─── Conflict value extraction ────────────────────────────────────────────────

function findConflictEvidence(
  metadata: Record<string, unknown>,
  primaryType: string,
): { value: string | null; sourceType: string | null } {
  const contradictions = metadata.contradictions as Array<Record<string, unknown>> | undefined;
  if (!contradictions) return { value: null, sourceType: null };

  const conflict = contradictions.find(
    (c) => c.canonical_type === primaryType &&
      (c.classification === "conflict" || c.classification === "minor_variance")
  );
  if (!conflict) return { value: null, sourceType: null };

  const evidence = conflict.evidence as Array<Record<string, unknown>> | undefined;
  if (!evidence || evidence.length < 2) return { value: null, sourceType: null };

  // Return the second source's value (different from the reference)
  const alt = evidence[1];
  if (alt.value == null) return { value: null, sourceType: null };

  const raw = alt.value;
  const u = (alt.unit as string | null | undefined) ?? null;
  const formatted =
    typeof raw === "number"
      ? formatKpiValue(raw, u)
      : Number.isFinite(Number(raw))
        ? formatKpiValue(Number(raw), u)
        : String(raw);

  return {
    value: formatted,
    sourceType: (alt.source_file_type as string | undefined) ?? null,
  };
}

// ─── Summary text extraction ──────────────────────────────────────────────────

/**
 * Extracts the first meaningful sentence from answer text.
 * Used by the comparison layout to show a brief summary sentence.
 */
function extractSummaryText(answerText: string | null): string | null {
  if (!answerText) return null;
  // Strip leading bullet markers and whitespace
  const cleaned = answerText.replace(/^[\s]*(•|-|\*|\d+\.)\s*/m, "").trim();
  // Take up to the first sentence-ending punctuation or newline
  const match = cleaned.match(/^(.{20,}?)[.\n]/);
  const sentence = match ? match[1].trim() : cleaned.split("\n")[0]?.trim() ?? null;
  if (!sentence || sentence.length < 15) return null;
  return sentence.length > 110 ? sentence.slice(0, 107) + "…" : sentence;
}

// ─── Question type → display mode validation ──────────────────────────────────

/**
 * Returns whether the full structured (numeric card) mode should be used.
 * Analytical questions get qualitative mode but still receive a metric object
 * for the inline supporting-metric row below bullets.
 */
function structuredModeAllowed(questionType: string | undefined): boolean {
  if (!questionType) return true; // backward compat
  return questionType === "financial" || questionType === "comparison";
}

/**
 * Returns whether a metric should be computed at all (even in qualitative mode).
 * Analytical questions get a metric for the supporting-metric row.
 * Pure qualitative / risk questions never show numeric data.
 */
function metricComputationAllowed(questionType: string | undefined): boolean {
  if (!questionType) return true; // backward compat
  return questionType !== "qualitative";
}

// ─── Main parser ──────────────────────────────────────────────────────────────

export function parseCellDisplayData(
  metadata: Record<string, unknown> | null | undefined,
  questionText: string,
  answerText: string | null,
): CellDisplayData {
  // ── Signals (always computed) ───────────────────────────────────────────────
  const factors = metadata?.confidence_factors as Record<string, unknown> | undefined;
  const contradictionClass = (factors?.contradictionClass as string | undefined) ?? "";
  const distinctSources = (factors?.distinctSourceCount as number | undefined) ?? 0;
  const conflictCount = (metadata?.conflict_count as number | undefined) ?? 0;

  const signals: CellIntelligenceSignals = {
    primarySources: (metadata?.primary_sources as string[] | undefined) ?? [],
    isMultiSourceConfirmed: distinctSources >= 2 && contradictionClass === "consistent",
    hasDerived: ((metadata?.derived_metrics_count as number | undefined) ?? 0) > 0,
    hasConflict: conflictCount > 0 || contradictionClass === "conflict",
    hasVariance: contradictionClass === "minor_variance",
    isGroundTruth: (factors?.hasGroundTruthMetrics as boolean | undefined) ?? false,
  };

  // ── Question type classification ────────────────────────────────────────────
  const rawQuestionType = metadata?.question_type as string | undefined;
  const questionType = (
    rawQuestionType === "financial" || rawQuestionType === "analytical" ||
    rawQuestionType === "qualitative" || rawQuestionType === "comparison"
      ? rawQuestionType : null
  ) as CellDisplayData["questionType"];

  // Summary sentence — used by the comparison cell layout
  const summaryText = extractSummaryText(answerText);

  // Pure qualitative / risk — never compute a metric
  if (!metricComputationAllowed(rawQuestionType)) {
    return { mode: "qualitative", metric: null, signals, qualitativeText: answerText, summaryText, questionType };
  }

  // ── Metric computation (financial, analytical, comparison) ──────────────────
  const noMetadata = !metadata || !metadata.best_metrics;
  if (noMetadata) {
    return { mode: "qualitative", metric: null, signals, qualitativeText: answerText, summaryText, questionType };
  }

  const bestMetrics = (metadata.best_metrics as StoredBestMetric[] | undefined) ?? [];
  const derivedMetrics = (metadata.derived_metrics as StoredDerivedMetric[] | undefined) ?? [];

  const withValues = bestMetrics.filter((m) => m.value !== null);
  if (withValues.length === 0) {
    return { mode: "qualitative", metric: null, signals, qualitativeText: answerText, summaryText, questionType };
  }

  const ranked = [...withValues].sort((a, b) => {
    const qa = scoreMetricForQuestion(questionText, a.canonical_type);
    const qb = scoreMetricForQuestion(questionText, b.canonical_type);
    if (qa !== qb) return qb - qa;
    const srcA = a.source_file_type === "csv" || a.source_file_type === "xlsx" ? 1 : 0;
    const srcB = b.source_file_type === "csv" || b.source_file_type === "xlsx" ? 1 : 0;
    if (srcA !== srcB) return srcB - srcA;
    return b.confidence - a.confidence;
  });

  const primary = ranked[0];

  const { label: supportingLabel, positive: supportingPositive } =
    buildSupportingLabel(primary.canonical_type, derivedMetrics);

  const { value: conflictValue, sourceType: conflictSourceType } = signals.hasConflict
    ? findConflictEvidence(metadata, primary.canonical_type)
    : { value: null, sourceType: null };

  const metric: CellMetricDisplay = {
    primaryLabel: primary.metric_name,
    primaryValue: formatKpiValue(primary.value!, primary.unit),
    period: primary.period,
    isAdjusted: primary.is_adjusted,
    isGuidance: primary.is_guidance,
    sourceType: primary.source_file_type,
    confidence: primary.confidence,
    supportingLabel,
    supportingPositive,
    conflictValue,
    conflictSourceType,
  };

  // Analytical: qualitative text is primary, metric is supplementary (not a card)
  if (!structuredModeAllowed(rawQuestionType)) {
    return { mode: "qualitative", metric, signals, qualitativeText: answerText, summaryText, questionType };
  }

  return { mode: "structured", metric, signals, qualitativeText: answerText, summaryText, questionType };
}

// ─── Source badge helpers ─────────────────────────────────────────────────────

export const SOURCE_LABEL: Record<string, string> = {
  csv: "CSV",
  xlsx: "XLSX",
  pdf: "PDF",
  txt: "TXT",
  transcript: "TRS",
};

export const SOURCE_COLOR_CLASS: Record<string, string> = {
  csv: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
  xlsx: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
  pdf: "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  txt: "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-700",
  transcript: "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800",
};

// ─── Limited insight detection ────────────────────────────────────────────────

/**
 * Returns true when an answer text signals that no meaningful data was found.
 *
 * Matches:
 *  • The "Insufficient data:" sentinel the AI is instructed to use (new answers)
 *  • Historical phrases Claude naturally produced before the sentinel was added
 *  • Extremely low confidence + very short text (< 200 chars) — catch-all
 */
export function isLimitedInsight(
  text: string | null | undefined,
  confidence?: number | null,
): boolean {
  if (!text) return false;
  const t = text.trim().toLowerCase();

  // Confidence-based catch-all: score 0–9 with almost no content
  if (confidence != null && confidence <= 9 && text.trim().length < 200) return true;

  // Sentinel phrase introduced in updated prompts
  if (t.startsWith("insufficient data:")) return true;

  // Historical / natural phrases Claude produces for missing data
  if (t.includes("not available in the extracted metrics")) return true;
  if (t.includes("no relevant data")) return true;
  if (t.includes("no relevant information")) return true;
  if (t.includes("not present in the") && t.includes("document")) return true;

  return false;
}
