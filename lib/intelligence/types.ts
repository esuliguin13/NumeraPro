/**
 * Intelligence layer types.
 *
 * These types flow from ingestion → intelligence → orchestration → synthesis
 * and are stored in matrix_answers.metadata for UI drill-down panels.
 */

// ─── Canonical types ──────────────────────────────────────────────────────────

export type CanonicalMetricType =
  | "revenue"
  | "ebitda"
  | "ebitda_margin"
  | "net_income"
  | "net_margin"
  | "gross_profit"
  | "gross_margin"
  | "operating_income"
  | "operating_margin"
  | "margin"          // generic / unresolved margin
  | "guidance"
  | "headcount"
  | "yoy_growth"
  | "qoq_growth"
  | "custom";

export type SourceFileType = "csv" | "xlsx" | "pdf" | "txt" | "transcript";

// ─── Normalized metric ────────────────────────────────────────────────────────

/** An extracted metric enriched with canonical type, period info, and source. */
export interface NormalizedMetric {
  // Original DB fields
  id?: string;
  documentId: string;
  workspaceId: string;
  metricType: string;           // raw DB metric_type
  metricName: string;           // reported name as found in document
  value: number | null;
  unit: string | null;
  period: string | null;        // as reported
  periodType: "annual" | "quarterly" | "ttm" | "other" | null;
  rawText: string;
  pageNumber: number | null;
  confidence: number;           // original extraction confidence (0–100)

  // Intelligence layer additions
  canonicalType: CanonicalMetricType;
  normalizedPeriod: string | null;  // e.g. "Q1 2026", "FY2026"
  fiscalYear: number | null;
  fiscalQuarter: number | null;     // 1–4 or null
  isGuidance: boolean;
  isAdjusted: boolean;              // "Adjusted EBITDA", "Non-GAAP", etc.
  isDerived: boolean;
  derivedFrom?: CanonicalMetricType[];
  derivedFormula?: string;

  // Source metadata
  sourceFileType: SourceFileType;
  sourcePriority: number;           // higher = more authoritative (CSV=100, PDF=70, transcript=45)
}

// ─── Contradiction detection ──────────────────────────────────────────────────

export type ContradictionClass =
  | "consistent"           // all sources agree within tolerance
  | "minor_variance"       // small numeric deviation (2–10%)
  | "conflict"             // material disagreement (>10%)
  | "insufficient_evidence"; // only one source, cannot compare

export interface ContradictionEvidence {
  sourceDocumentId: string;
  sourceFileType: SourceFileType;
  sourcePriority: number;
  metricName: string;
  value: number | null;
  unit: string | null;
  confidence: number;
  rawText: string;
}

export interface ContradictionResult {
  canonicalType: CanonicalMetricType;
  normalizedPeriod: string | null;
  classification: ContradictionClass;
  referenceValue: number | null;   // from highest-priority source
  referenceUnit: string | null;
  maxVariancePct: number | null;   // maximum % deviation from reference value
  evidence: ContradictionEvidence[];
  notes: string;
}

// ─── Calibrated confidence ────────────────────────────────────────────────────

export interface ConfidenceFactors {
  hasGroundTruthMetrics: boolean;       // any CSV metric with confidence = 100
  hasHighConfidenceStructured: boolean; // any metric with confidence >= 80
  contradictionClass: ContradictionClass;
  distinctSourceCount: number;          // number of distinct file types contributing
  hasDerivedMetrics: boolean;
  periodMismatch: boolean;              // metrics are from a different period than question implies
  mixesActualAndGuidance: boolean;
  retrievalHitCount: number;            // how many chunks were retrieved
  modelRawConfidence: number;           // what Claude returned (0–100)
}

/** Calibrated confidence output. */
export interface CalibratedConfidence {
  score: number;            // final 0–100 score
  factors: ConfidenceFactors;
  adjustments: Array<{ reason: string; delta: number }>;
}

// ─── Intelligence result ──────────────────────────────────────────────────────

export interface IntelligenceResult {
  /** Normalized version of all metrics for this document. */
  normalizedMetrics: NormalizedMetric[];

  /** Metrics computed from raw values (margins, growth rates). */
  derivedMetrics: NormalizedMetric[];

  /**
   * Cross-source contradiction analysis.
   * Each entry covers one canonical type × period combination found
   * across multiple documents in the workspace.
   */
  contradictions: ContradictionResult[];

  /**
   * Best metric per canonical type (highest source priority, then highest confidence).
   * Used as the primary reference for synthesis.
   */
  bestMetrics: NormalizedMetric[];

  /** Pre-computed calibrated confidence factors (before model inference). */
  confidenceFactors: ConfidenceFactors;

  /** Summary stats for logging and UI display. */
  summary: {
    totalMetrics: number;
    groundTruthCount: number;  // confidence = 100
    derivedCount: number;
    conflictCount: number;
    consistentCount: number;
    primarySources: SourceFileType[];
  };
}
