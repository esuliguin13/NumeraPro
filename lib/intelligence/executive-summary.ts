/**
 * Executive summary extraction.
 *
 * Derives KPI cards and qualitative insights from already-computed data:
 *  - ExtractedMetricRow[] from the database (ingestion-time structured metrics)
 *  - Matrix answer metadata (best_metrics / derived_metrics stored by the execute route)
 *  - Question text + answer text for qualitative signals
 *
 * Zero model calls. Pure data transformation.
 */

import type { ExtractedMetricRow, MatrixAnswerWithCitations, MatrixQuestionRow } from "@/types";

// ─── Public types ─────────────────────────────────────────────────────────────

export interface KpiCard {
  label: string;
  value: number;
  /** Formatted display string (e.g. "$128.4M") */
  formatted: string;
  period: string | null;
  /** e.g. +18 → "+18% YoY", -5 → "-5% YoY" */
  growth: number | null;
  /** Secondary metric, e.g. margin % for EBITDA */
  subValue: number | null;
  subLabel: string | null;       // "margin" | "YoY"
  sourceType: string;            // "csv" | "pdf" | etc.
  confidence: number;
}

export interface InsightCard {
  text: string;
  question: string;
}

export interface ExecutiveSummaryData {
  revenue: KpiCard | null;
  ebitda: KpiCard | null;
  netIncome: KpiCard | null;
  grossProfit: KpiCard | null;
  operatingIncome: KpiCard | null;
  growthDriver: InsightCard | null;
  keyRisk: InsightCard | null;
  /** Most common period across the summary KPIs */
  dominantPeriod: string | null;
  /** True when at least one KPI has real data */
  hasData: boolean;
}

// ─── Internal shapes matching execute route output ────────────────────────────

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

// ─── Value formatting ─────────────────────────────────────────────────────────

/**
 * Grouped plain number (thousands separators), no currency assumption.
 * Used for counts, ratios, and non-scaled metrics.
 */
export function formatGroupedNumber(value: number): string {
  const abs = Math.abs(value);
  const maxFrac =
    abs % 1 === 0 ? 0 : abs >= 100 ? 1 : abs >= 1 ? 2 : 4;
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: maxFrac,
    minimumFractionDigits: 0,
  }).format(value);
}

/**
 * When unit is missing, ingestion often stores whole-dollar amounts (e.g. 108_700_000).
 * Compress to $108.7M-style labels; smaller values get comma grouping only.
 */
function formatLargeValueMissingUnit(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000_000) {
    return `${sign}$${(abs / 1_000_000_000).toFixed(1)}B`;
  }
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 100_000) {
    return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  }
  return formatGroupedNumber(value);
}

/**
 * Format a raw numeric value + unit string into a human-readable display.
 *
 * Handles the two common conventions produced by ingestion:
 *  • Large raw number (128_400_000) + unit "$" → "$128.4M"
 *  • Scaled number (128.4) + unit "USD millions" / "M" → "$128.4M"
 *  • Large raw number with **no unit** → treated as whole USD → "$128.4M" (not "108700000.0")
 *  • Any other plain number → thousands separators (e.g. "12,450.5")
 */
export function formatKpiValue(value: number, unit: string | null): string {
  if (unit === null || unit.trim() === "") {
    return formatLargeValueMissingUnit(value);
  }

  const u = unit.toLowerCase();
  const isCurrency = u.includes("usd") || u.includes("$") || u.includes("dollar");
  const isPercent = u.includes("%") || u.includes("percent");

  if (isPercent) return `${value.toFixed(1)}%`;

  // Determine scale multiplier from unit text
  let multiplier = 1;
  if (u.includes("billion") || u === "b") multiplier = 1_000_000_000;
  else if (u.includes("million") || u === "m" || u === "usd m") multiplier = 1_000_000;
  else if (u.includes("thousand") || u === "k") multiplier = 1_000;

  const absolute = Math.abs(value * multiplier);

  if (isCurrency || multiplier > 1) {
    const sign = value < 0 ? "-" : "";
    if (absolute >= 1_000_000_000) {
      return `${sign}$${(Math.abs(value * multiplier) / 1_000_000_000).toFixed(1)}B`;
    }
    if (absolute >= 1_000_000) {
      return `${sign}$${(Math.abs(value * multiplier) / 1_000_000).toFixed(1)}M`;
    }
    if (absolute >= 1_000) {
      return `${sign}$${(Math.abs(value * multiplier) / 1_000).toFixed(1)}K`;
    }
    return `${sign}$${formatGroupedNumber(Math.abs(value * multiplier))}`;
  }

  // Plain number with a non-currency unit string
  return formatGroupedNumber(value);
}

// ─── Core extraction ──────────────────────────────────────────────────────────

/** Collect all best_metrics + derived_metrics from every answer's metadata. */
function collectFromAnswerMetadata(
  answers: Record<string, MatrixAnswerWithCitations>
): { best: StoredBestMetric[]; derived: StoredDerivedMetric[] } {
  const best: StoredBestMetric[] = [];
  const derived: StoredDerivedMetric[] = [];

  for (const answer of Object.values(answers)) {
    if (answer.status !== "done" || !answer.metadata) continue;
    const meta = answer.metadata as Record<string, unknown>;

    const bm = meta.best_metrics as StoredBestMetric[] | undefined;
    if (Array.isArray(bm)) best.push(...bm);

    const dm = meta.derived_metrics as StoredDerivedMetric[] | undefined;
    if (Array.isArray(dm)) derived.push(...dm);
  }

  return { best, derived };
}

/** Pick the single best metric for a canonical type from collected data. */
function pickBestMetric(
  best: StoredBestMetric[],
  rawMetrics: ExtractedMetricRow[],
  canonicalType: string,
  rawTypes: string[],
): StoredBestMetric | null {
  // First preference: intelligence best_metrics (already ranked)
  const candidates = best.filter((m) => m.canonical_type === canonicalType && m.value !== null);
  if (candidates.length > 0) {
    // Prefer CSV (highest source priority), then highest confidence
    return candidates.sort((a, b) => {
      const srcScore = (s: string) => (s === "csv" || s === "xlsx" ? 2 : s === "pdf" ? 1 : 0);
      return srcScore(b.source_file_type) - srcScore(a.source_file_type) || b.confidence - a.confidence;
    })[0];
  }

  // Fallback: raw extracted metrics table
  const raw = rawMetrics
    .filter((m) => rawTypes.includes(m.metric_type) && m.value !== null)
    .sort((a, b) => b.confidence - a.confidence)[0];

  if (!raw) return null;

  return {
    canonical_type: canonicalType,
    metric_name: raw.metric_name,
    value: raw.value,
    unit: raw.unit,
    period: raw.period,
    confidence: raw.confidence,
    source_file_type: "pdf",
    is_derived: false,
  };
}

/** Pick the best derived metric for a canonical type (highest confidence, not just first). */
function pickDerivedMetric(
  derived: StoredDerivedMetric[],
  canonicalType: string,
): number | null {
  const candidates = derived.filter((d) => d.canonical_type === canonicalType && d.value !== null);
  if (candidates.length === 0) return null;
  // Sort by confidence desc; for tied confidence, prefer non-null period (more specific)
  const best = candidates.sort((a, b) => {
    if (b.confidence !== a.confidence) return b.confidence - a.confidence;
    return (a.period ? 0 : 1) - (b.period ? 0 : 1);
  })[0];
  return best?.value ?? null;
}

/** Find a qualitative insight from answered cells matching keyword patterns. */
function findInsight(
  questions: MatrixQuestionRow[],
  answers: Record<string, MatrixAnswerWithCitations>,
  keywords: string[],
): InsightCard | null {
  for (const q of questions) {
    const qText = q.question_text.toLowerCase();
    if (!keywords.some((kw) => qText.includes(kw))) continue;

    // Find the first answered cell for this question
    for (const [key, answer] of Object.entries(answers)) {
      if (!key.endsWith(`:${q.id}`)) continue;
      if (answer.status !== "done" || !answer.answer_text) continue;

      const text = answer.answer_text.trim();
      if (text.length < 20) continue;

      // Extract first meaningful sentence (max 160 chars)
      const firstSentence = text.split(/(?<=[.!?])\s+/)[0] ?? text;
      return {
        text: firstSentence.length > 160 ? firstSentence.slice(0, 157) + "…" : firstSentence,
        question: q.question_text,
      };
    }
  }
  return null;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/** Build a KpiCard from a best metric + optional derived metrics. */
function makeKpiCard(
  label: string,
  raw: StoredBestMetric,
  subValue: number | null,
  subLabel: string | null,
  growth: number | null,
): KpiCard {
  return {
    label,
    value: raw.value!,
    formatted: formatKpiValue(raw.value!, raw.unit),
    period: raw.period,
    growth,
    subValue,
    subLabel,
    sourceType: raw.source_file_type,
    confidence: raw.confidence,
  };
}

export function computeExecutiveSummary(
  metrics: ExtractedMetricRow[],
  questions: MatrixQuestionRow[],
  answers: Record<string, MatrixAnswerWithCitations>,
): ExecutiveSummaryData {
  const { best, derived } = collectFromAnswerMetadata(answers);

  // ── Revenue ──────────────────────────────────────────────────────────────
  const revRaw = pickBestMetric(best, metrics, "revenue", ["revenue"]);
  // YoY growth: check derived first, then look for a matching best_metric with is_derived
  const revYoy = pickDerivedMetric(derived, "yoy_growth")
    ?? best.find((m) => m.canonical_type === "yoy_growth" && m.value !== null)?.value
    ?? null;
  const revenue = revRaw?.value != null
    ? makeKpiCard("Revenue", revRaw, null, revYoy != null ? "YoY" : null, revYoy)
    : null;

  // ── EBITDA ───────────────────────────────────────────────────────────────
  const ebitdaRaw = pickBestMetric(best, metrics, "ebitda", ["ebitda"]);
  const ebitdaMargin = pickDerivedMetric(derived, "ebitda_margin")
    ?? best.find((m) => m.canonical_type === "ebitda_margin" && m.value !== null)?.value
    ?? null;
  const ebitda = ebitdaRaw?.value != null
    ? makeKpiCard("EBITDA", ebitdaRaw, ebitdaMargin, ebitdaMargin != null ? "margin" : null, null)
    : null;

  // ── Net Income ───────────────────────────────────────────────────────────
  const niRaw = pickBestMetric(best, metrics, "net_income", ["net_income"]);
  const niMargin = pickDerivedMetric(derived, "net_margin")
    ?? best.find((m) => m.canonical_type === "net_margin" && m.value !== null)?.value
    ?? null;
  const netIncome = niRaw?.value != null
    ? makeKpiCard("Net Income", niRaw, niMargin, niMargin != null ? "margin" : null, null)
    : null;

  // ── Gross Profit ─────────────────────────────────────────────────────────
  const gpRaw = pickBestMetric(best, metrics, "gross_profit", ["gross_profit"]);
  const gpMargin = pickDerivedMetric(derived, "gross_margin")
    ?? best.find((m) => m.canonical_type === "gross_margin" && m.value !== null)?.value
    ?? null;
  const grossProfit = gpRaw?.value != null
    ? makeKpiCard("Gross Profit", gpRaw, gpMargin, gpMargin != null ? "margin" : null, null)
    : null;

  // ── Operating Income ─────────────────────────────────────────────────────
  const oiRaw = pickBestMetric(best, metrics, "operating_income", ["operating_income"]);
  const oiMargin = pickDerivedMetric(derived, "operating_margin")
    ?? best.find((m) => m.canonical_type === "operating_margin" && m.value !== null)?.value
    ?? null;
  const operatingIncome = oiRaw?.value != null
    ? makeKpiCard("Operating Income", oiRaw, oiMargin, oiMargin != null ? "margin" : null, null)
    : null;

  // ── Qualitative insights ─────────────────────────────────────────────────
  const growthDriver = findInsight(questions, answers, [
    "growth", "driver", "drove", "revenue growth", "top driver",
  ]);
  const keyRisk = findInsight(questions, answers, [
    "risk", "challenge", "headwind", "concern", "threat",
  ]);

  // ── Dominant period ──────────────────────────────────────────────────────
  const periods = [revenue?.period, ebitda?.period, netIncome?.period, grossProfit?.period]
    .filter(Boolean);
  const periodFreq = periods.reduce<Record<string, number>>((acc, p) => {
    if (p) acc[p] = (acc[p] ?? 0) + 1;
    return acc;
  }, {});
  const dominantPeriod = Object.entries(periodFreq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const hasData = !!(revenue || ebitda || netIncome || grossProfit || operatingIncome);

  return {
    revenue,
    ebitda,
    netIncome,
    grossProfit,
    operatingIncome,
    growthDriver,
    keyRisk,
    dominantPeriod,
    hasData,
  };
}
