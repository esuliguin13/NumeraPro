/**
 * Comparison Intelligence Module
 *
 * Pure data-transformation layer that takes existing stored intelligence
 * (best_metrics, derived_metrics, contradictions, answer_text) and produces
 * structured comparison results across multiple entities.
 *
 * No model calls — all logic is deterministic aggregation and ranking.
 * AI synthesis is handled separately in the report generator.
 */

import type { ComparisonEntityRow, MatrixAnswerWithCitations, MatrixQuestionRow, DocumentRow } from "@/types";
import { formatKpiValue } from "./executive-summary";
import { isLimitedInsight } from "./cell-display";
import {
  assessMetricComparability,
  detectCurrency,
  parsePeriod,
} from "./comparability";
import type { ComparabilityResult, CurrencyInfo, PeriodInfo } from "./comparability";

// ─── Internal metric shapes (from answer metadata) ───────────────────────────

interface StoredBestMetric {
  canonical_type: string;
  metric_name: string;
  value: number | null;
  unit: string | null;
  period: string | null;
  confidence: number;
  source_file_type: string;
  is_derived: boolean;
}

interface StoredDerivedMetric {
  canonical_type: string;
  metric_name: string;
  value: number | null;
  unit: string | null;
  period: string | null;
  confidence: number;
}

// ─── Public output types ──────────────────────────────────────────────────────

export interface EntityMetric {
  entityId: string;
  entityLabel: string;
  value: number;
  formatted: string;
  unit: string | null;
  period: string | null;
  sourceType: string;
  confidence: number;
  isDerived: boolean;
  /** Parsed currency info (null for % / ratio metrics) */
  currencyInfo: CurrencyInfo | null;
  /** Normalized period info */
  periodInfo: PeriodInfo | null;
}

export interface MetricComparison {
  canonicalType: string;
  metricName: string;
  /** All entities with a value, ranked from highest to lowest */
  ranked: EntityMetric[];
  /** Entity with highest value */
  leader: EntityMetric | null;
  /**
   * Absolute spread between top and bottom.
   * NULL when comparabilityResult.status === "not_comparable" (numeric
   * comparison is unsafe, e.g. different currencies).
   */
  spread: number | null;
  /** % spread. NULL for same reason as spread. */
  spreadPct: number | null;
  /** Entities that are missing this metric */
  missing: string[];
  /** True when all present entities share the same period */
  periodsAligned: boolean;
  /** Simple legacy status kept for snapshot backward compat */
  comparabilityStatus: "comparable" | "partially_comparable" | "not_comparable";
  /** Rich comparability result from the comparability module */
  comparabilityResult: ComparabilityResult;
}

export interface NarrativeComparison {
  questionId: string;
  questionText: string;
  /** One-sentence contrast synthesized from the answers */
  contrast: string;
  /** Per-entity short summary (first meaningful sentence) */
  perEntity: Array<{
    entityId: string;
    entityLabel: string;
    summary: string;
    confidence: number | null;
  }>;
}

export interface ComparabilityWarning {
  type: "period_mismatch" | "missing_metric" | "currency_mismatch" | "low_confidence";
  message: string;
  affectedEntities: string[];
}

export interface ComparisonSnapshot {
  /** The entity with the highest revenue (or first ranked financial metric) */
  topPerformerRevenue: string | null;
  /** Margin gap between best and worst EBITDA margin across entities */
  maxMarginGap: number | null;
  /** Formatted margin gap (e.g. "+8.4pp") */
  maxMarginGapFormatted: string | null;
  /** The metric comparison that has the widest spread (most divergent) */
  mostDivergentMetric: MetricComparison | null;
  /** Confidence range: "High/High", "High/Low", etc. */
  confidenceRange: string;
  warnings: ComparabilityWarning[];
  metricComparisons: MetricComparison[];
}

// ─── Core helpers ─────────────────────────────────────────────────────────────

/**
 * Given an entity's set of documents and the full answer map,
 * returns the best answer (highest confidence) for (entity, question).
 *
 * Preference order:
 *   1. Done answers with real data (not limited insight)
 *   2. Done answers that are limited insights (shown as "Limited" in cell, NOT hidden)
 *   3. null  — no answer exists yet (cell shows "Run" button)
 *
 * We intentionally do NOT discard limited-insight answers so the comparison
 * cell can show the correct "Limited Insights" state rather than pretending
 * the cell was never run.
 */
export function getBestEntityAnswer(
  entityDocs: DocumentRow[],
  questionId: string,
  answersMap: Record<string, MatrixAnswerWithCitations>
): MatrixAnswerWithCitations | null {
  const allDone = entityDocs
    .map((doc) => answersMap[`${doc.id}:${questionId}`])
    .filter((a): a is MatrixAnswerWithCitations => !!a && a.status === "done");

  if (allDone.length === 0) return null;

  // Prefer substantive answers; fall back to limited-insight ones
  const withData = allDone.filter(
    (a) => !isLimitedInsight(a.answer_text, a.confidence_score)
  );

  const pool = withData.length > 0 ? withData : allDone;
  return pool.sort(
    (a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0)
  )[0];
}

/** Extract the best metric of a given canonical type from an answer's metadata */
function extractBestMetric(
  answer: MatrixAnswerWithCitations,
  canonicalType: string
): StoredBestMetric | null {
  const meta = (answer.metadata ?? {}) as Record<string, unknown>;
  const bm = (meta.best_metrics as StoredBestMetric[] | undefined) ?? [];
  const candidates = bm.filter(
    (m) => m.canonical_type === canonicalType && m.value != null
  );
  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => {
    const srcScore = (s: string) =>
      s === "csv" || s === "xlsx" ? 2 : s === "pdf" ? 1 : 0;
    return (
      srcScore(b.source_file_type) - srcScore(a.source_file_type) ||
      b.confidence - a.confidence
    );
  })[0];
}

function extractDerivedMetric(
  answer: MatrixAnswerWithCitations,
  canonicalType: string
): StoredDerivedMetric | null {
  const meta = (answer.metadata ?? {}) as Record<string, unknown>;
  const dm = (meta.derived_metrics as StoredDerivedMetric[] | undefined) ?? [];
  return (
    dm
      .filter((m) => m.canonical_type === canonicalType && m.value != null)
      .sort((a, b) => b.confidence - a.confidence)[0] ?? null
  );
}

/** Normalise a period string for comparison (e.g. "FY2025", "Q3 FY2025") */
function normalisePeriod(period: string | null): string | null {
  if (!period) return null;
  return period.toUpperCase().replace(/\s+/g, " ").trim();
}

// ─── Metric comparison ────────────────────────────────────────────────────────

const KEY_METRICS: Array<{ canonical: string; name: string }> = [
  { canonical: "revenue", name: "Revenue" },
  { canonical: "ebitda", name: "EBITDA" },
  { canonical: "net_income", name: "Net Income" },
  { canonical: "gross_profit", name: "Gross Profit" },
  { canonical: "operating_income", name: "Operating Income" },
  { canonical: "ebitda_margin", name: "EBITDA Margin" },
  { canonical: "net_margin", name: "Net Margin" },
  { canonical: "gross_margin", name: "Gross Margin" },
  { canonical: "yoy_growth", name: "Revenue YoY Growth" },
];

export function buildMetricComparisons(
  entities: ComparisonEntityRow[],
  entityDocMap: Map<string, DocumentRow[]>,
  questionsMap: Map<string, MatrixQuestionRow>,
  answersMap: Record<string, MatrixAnswerWithCitations>
): MetricComparison[] {
  return KEY_METRICS.map(({ canonical, name }): MetricComparison => {
    const isMarginOrGrowth =
      canonical.endsWith("_margin") || canonical === "yoy_growth";

    const entityMetrics: EntityMetric[] = [];
    const missing: string[] = [];

    for (const entity of entities) {
      const docs = entityDocMap.get(entity.id) ?? [];

      let found: StoredBestMetric | null = null;
      let foundDerived: StoredDerivedMetric | null = null;

      for (const doc of docs) {
        for (const [key, answer] of Object.entries(answersMap)) {
          if (!key.startsWith(`${doc.id}:`)) continue;
          if (answer.status !== "done") continue;

          const m = extractBestMetric(answer, canonical);
          if (m && (!found || m.confidence > found.confidence)) found = m;

          if (isMarginOrGrowth) {
            const d = extractDerivedMetric(answer, canonical);
            if (d && (!foundDerived || d.confidence > foundDerived.confidence))
              foundDerived = d;
          }
        }
      }

      const useValue = isMarginOrGrowth
        ? (foundDerived?.value ?? found?.value ?? null)
        : found?.value ?? null;
      const useUnit = isMarginOrGrowth ? "%" : found?.unit ?? null;
      const usePeriod = found?.period ?? foundDerived?.period ?? null;
      const useSource = found?.source_file_type ?? "unknown";
      const useConf = found?.confidence ?? foundDerived?.confidence ?? 0;

      if (useValue == null) {
        missing.push(entity.label);
      } else {
        entityMetrics.push({
          entityId: entity.id,
          entityLabel: entity.label,
          value: useValue,
          formatted: isMarginOrGrowth
            ? `${useValue.toFixed(1)}%`
            : formatKpiValue(useValue, useUnit),
          unit: useUnit,
          period: usePeriod,
          sourceType: useSource,
          confidence: useConf,
          isDerived: isMarginOrGrowth && foundDerived != null,
          // ── New: enriched currency + period info ─────────────────────────
          currencyInfo: isMarginOrGrowth ? null : detectCurrency(useUnit),
          periodInfo: parsePeriod(usePeriod),
        });
      }
    }

    // ── Comparability assessment ────────────────────────────────────────────
    const comparabilityResult = assessMetricComparability(
      entityMetrics.map((m) => ({
        entityLabel: m.entityLabel,
        unit: m.unit,
        period: m.period,
        value: m.value,
      }))
    );

    // ── Ranking — blocked when currencies differ ────────────────────────────
    const rankingBlocked =
      comparabilityResult.status === "not_comparable" &&
      comparabilityResult.currencyMismatch;

    if (!rankingBlocked) {
      entityMetrics.sort((a, b) => b.value - a.value);
    }

    const leader = rankingBlocked ? null : (entityMetrics[0] ?? null);
    const laggard = rankingBlocked ? null : (entityMetrics[entityMetrics.length - 1] ?? null);

    const spread =
      !rankingBlocked && leader && laggard && entityMetrics.length >= 2
        ? Math.abs(leader.value - laggard.value)
        : null;
    const spreadPct =
      spread != null && leader && leader.value !== 0
        ? (spread / Math.abs(leader.value)) * 100
        : null;

    // ── Period alignment (legacy field) ──────────────────────────────────────
    const periods = entityMetrics
      .map((m) => normalisePeriod(m.period))
      .filter(Boolean) as string[];
    const uniquePeriods = new Set(periods);
    const periodsAligned = periods.length === 0 || uniquePeriods.size === 1;

    // ── Legacy comparabilityStatus ────────────────────────────────────────────
    const comparabilityStatus: MetricComparison["comparabilityStatus"] =
      comparabilityResult.status === "not_comparable"
        ? "not_comparable"
        : comparabilityResult.status === "partially_comparable" || missing.length > 0
        ? "partially_comparable"
        : "comparable";

    return {
      canonicalType: canonical,
      metricName: name,
      ranked: entityMetrics,
      leader,
      spread,
      spreadPct,
      missing,
      periodsAligned,
      comparabilityStatus,
      comparabilityResult,
    };
  }).filter((mc) => mc.ranked.length > 0 || mc.missing.length < entities.length);
}

// ─── Narrative comparison ─────────────────────────────────────────────────────

/** Extracts the first meaningful sentence from answer text */
function firstSentence(text: string | null, maxChars = 120): string {
  if (!text) return "";
  const clean = text
    .replace(/^[\s]*(•|-|\*|\d+\.)\s*/gm, "")
    .trim();
  const sentence = clean.split(/(?<=[.!?])\s+/)[0] ?? clean;
  return sentence.length > maxChars
    ? sentence.slice(0, maxChars - 1) + "…"
    : sentence;
}

export function buildNarrativeComparisons(
  entities: ComparisonEntityRow[],
  entityDocMap: Map<string, DocumentRow[]>,
  questions: MatrixQuestionRow[],
  answersMap: Record<string, MatrixAnswerWithCitations>
): NarrativeComparison[] {
  const narrativeTypes = new Set(["risk", "general", "operational"]);
  const narrativeQuestions = questions.filter((q) =>
    narrativeTypes.has(q.question_type)
  );

  return narrativeQuestions.slice(0, 8).map((q): NarrativeComparison => {
    const perEntity = entities.map((entity) => {
      const docs = entityDocMap.get(entity.id) ?? [];
      const answer = getBestEntityAnswer(docs, q.id, answersMap);
      return {
        entityId: entity.id,
        entityLabel: entity.label,
        summary: firstSentence(answer?.answer_text ?? null),
        confidence: answer?.confidence_score ?? null,
      };
    }).filter((e) => e.summary.length > 0);

    // Build a simple contrast sentence
    const contrast =
      perEntity.length >= 2
        ? `${perEntity[0].entityLabel} focuses on: ${perEntity[0].summary.slice(0, 80)}… ` +
          `${perEntity[1].entityLabel} emphasizes: ${perEntity[1].summary.slice(0, 80)}…`
        : perEntity[0]?.summary ?? "";

    return {
      questionId: q.id,
      questionText: q.question_text,
      contrast,
      perEntity,
    };
  });
}

// ─── Comparability warnings ───────────────────────────────────────────────────

export function buildComparabilityWarnings(
  entities: ComparisonEntityRow[],
  metricComparisons: MetricComparison[],
  entityDocMap: Map<string, DocumentRow[]>
): ComparabilityWarning[] {
  const warnings: ComparabilityWarning[] = [];

  // Period mismatch
  const misaligned = metricComparisons.filter(
    (mc) => !mc.periodsAligned && mc.ranked.length >= 2
  );
  if (misaligned.length > 0) {
    const names = [...new Set(misaligned.flatMap((m) => m.ranked.map((r) => r.entityLabel)))];
    warnings.push({
      type: "period_mismatch",
      message: `Period mismatch detected in ${misaligned.map((m) => m.metricName).join(", ")} — comparisons may not be directly comparable.`,
      affectedEntities: names,
    });
  }

  // Missing core metrics
  const revenueComp = metricComparisons.find((m) => m.canonicalType === "revenue");
  if (revenueComp && revenueComp.missing.length > 0) {
    warnings.push({
      type: "missing_metric",
      message: `Revenue not available for: ${revenueComp.missing.join(", ")}.`,
      affectedEntities: revenueComp.missing,
    });
  }

  // Entities with no documents
  for (const entity of entities) {
    const docs = entityDocMap.get(entity.id) ?? [];
    if (docs.length === 0) {
      warnings.push({
        type: "missing_metric",
        message: `${entity.label} has no documents assigned. Upload documents to enable comparison.`,
        affectedEntities: [entity.label],
      });
    }
  }

  return warnings;
}

// ─── Snapshot builder ─────────────────────────────────────────────────────────

export function buildComparisonSnapshot(
  entities: ComparisonEntityRow[],
  entityDocMap: Map<string, DocumentRow[]>,
  questions: MatrixQuestionRow[],
  answersMap: Record<string, MatrixAnswerWithCitations>
): ComparisonSnapshot {
  const metricComparisons = buildMetricComparisons(
    entities,
    entityDocMap,
    new Map(questions.map((q) => [q.id, q])),
    answersMap
  );

  const warnings = buildComparabilityWarnings(entities, metricComparisons, entityDocMap);

  // Top performer by revenue
  const revComp = metricComparisons.find((m) => m.canonicalType === "revenue");
  const topPerformerRevenue = revComp?.leader?.entityLabel ?? null;

  // Margin gap (EBITDA margin)
  const marginComp = metricComparisons.find(
    (m) => m.canonicalType === "ebitda_margin"
  );
  const maxMarginGap =
    marginComp?.spread != null && marginComp.ranked.length >= 2
      ? marginComp.spread
      : null;
  const maxMarginGapFormatted =
    maxMarginGap != null ? `${maxMarginGap.toFixed(1)}pp` : null;

  // Most divergent metric by spreadPct
  const mostDivergentMetric =
    metricComparisons
      .filter((m) => m.spreadPct != null && m.ranked.length >= 2)
      .sort((a, b) => (b.spreadPct ?? 0) - (a.spreadPct ?? 0))[0] ?? null;

  // Confidence range
  const allAnswers = Object.values(answersMap).filter((a) => a.status === "done");
  const scores = allAnswers
    .map((a) => a.confidence_score)
    .filter((s): s is number => s != null);
  const minScore = scores.length > 0 ? Math.min(...scores) : 0;
  const maxScore = scores.length > 0 ? Math.max(...scores) : 0;
  const labelOf = (s: number) => (s >= 75 ? "High" : s >= 45 ? "Medium" : "Low");
  const confidenceRange =
    scores.length === 0
      ? "No data"
      : `${labelOf(maxScore)} / ${labelOf(minScore)}`;

  return {
    topPerformerRevenue,
    maxMarginGap,
    maxMarginGapFormatted,
    mostDivergentMetric,
    confidenceRange,
    warnings,
    metricComparisons,
  };
}

// ─── Helper: build entity→docs map ───────────────────────────────────────────

export function buildEntityDocMap(
  entities: ComparisonEntityRow[],
  documents: DocumentRow[]
): Map<string, DocumentRow[]> {
  const map = new Map<string, DocumentRow[]>();
  for (const entity of entities) {
    map.set(
      entity.id,
      documents.filter((d) => d.entity_id === entity.id)
    );
  }
  return map;
}

// ─── Rank label helper ────────────────────────────────────────────────────────

export function getRankLabel(rank: number, total: number): string {
  if (total <= 1) return "";
  const suffix = rank === 1 ? "st" : rank === 2 ? "nd" : rank === 3 ? "rd" : "th";
  return `#${rank}${suffix} of ${total}`;
}
