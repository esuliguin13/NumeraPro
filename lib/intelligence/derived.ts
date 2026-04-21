/**
 * Derived Metric Calculator
 *
 * Computes financial metrics that are not directly stated but can be
 * calculated from two or more raw extracted values:
 *
 *   EBITDA Margin     = EBITDA / Revenue × 100
 *   Net Margin        = Net Income / Revenue × 100
 *   Gross Margin      = Gross Profit / Revenue × 100
 *   Operating Margin  = Operating Income / Revenue × 100
 *   YoY Growth        = (Current − Prior) / |Prior| × 100
 *
 * Derived metrics are tagged `isDerived: true` and carry a slightly
 * reduced confidence (min of inputs − 5) so they are distinguishable
 * from directly reported figures.
 */

import type { CanonicalMetricType, NormalizedMetric } from "./types";
import { SOURCE_PRIORITY } from "./normalizer";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function groupByPeriod(
  metrics: NormalizedMetric[]
): Map<string, NormalizedMetric[]> {
  const map = new Map<string, NormalizedMetric[]>();
  for (const m of metrics) {
    const key = m.normalizedPeriod ?? "unknown";
    const arr = map.get(key) ?? [];
    arr.push(m);
    map.set(key, arr);
  }
  return map;
}

function findBest(
  metrics: NormalizedMetric[],
  type: CanonicalMetricType
): NormalizedMetric | null {
  const candidates = metrics.filter((m) => m.canonicalType === type && m.value !== null);
  if (candidates.length === 0) return null;
  return candidates.sort(
    (a, b) => b.sourcePriority - a.sourcePriority || b.confidence - a.confidence
  )[0];
}

function alreadyExists(
  metrics: NormalizedMetric[],
  type: CanonicalMetricType
): boolean {
  return metrics.some((m) => m.canonicalType === type && !m.isDerived);
}

function makeMargin(
  numerator: NormalizedMetric,
  denominator: NormalizedMetric,
  canonicalType: CanonicalMetricType,
  metricName: string,
  formula: string
): NormalizedMetric {
  const value = ((numerator.value as number) / (denominator.value as number)) * 100;
  const confidence = Math.max(0, Math.min(numerator.confidence, denominator.confidence) - 5);

  return {
    id: undefined,
    documentId: numerator.documentId,
    workspaceId: numerator.workspaceId,
    metricType: "margin",
    metricName,
    value: parseFloat(value.toFixed(2)),
    unit: "%",
    period: numerator.period,
    periodType: numerator.periodType,
    rawText: `Derived: ${formula}`,
    pageNumber: null,
    confidence,

    canonicalType,
    normalizedPeriod: numerator.normalizedPeriod,
    fiscalYear: numerator.fiscalYear,
    fiscalQuarter: numerator.fiscalQuarter,
    isGuidance: numerator.isGuidance,
    isAdjusted: numerator.isAdjusted || denominator.isAdjusted,
    isDerived: true,
    derivedFrom: [numerator.canonicalType, denominator.canonicalType],
    derivedFormula: formula,

    sourceFileType: numerator.sourcePriority >= denominator.sourcePriority
      ? numerator.sourceFileType
      : denominator.sourceFileType,
    sourcePriority: Math.min(
      SOURCE_PRIORITY[numerator.sourceFileType],
      SOURCE_PRIORITY[denominator.sourceFileType]
    ) - 5,  // slight discount for derived
  };
}

function makeGrowth(
  current: NormalizedMetric,
  prior: NormalizedMetric,
  label: string
): NormalizedMetric {
  const priorVal = prior.value as number;
  const curVal = current.value as number;
  const value = priorVal === 0 ? null : parseFloat((((curVal - priorVal) / Math.abs(priorVal)) * 100).toFixed(2));
  const confidence = Math.max(0, Math.min(current.confidence, prior.confidence) - 5);

  const formula = `(${current.normalizedPeriod} − ${prior.normalizedPeriod}) / |${prior.normalizedPeriod}| × 100`;

  return {
    id: undefined,
    documentId: current.documentId,
    workspaceId: current.workspaceId,
    metricType: "custom",
    metricName: label,
    value,
    unit: "%",
    period: current.period,
    periodType: current.periodType,
    rawText: `Derived: ${formula}`,
    pageNumber: null,
    confidence,

    canonicalType: "yoy_growth",
    normalizedPeriod: current.normalizedPeriod,
    fiscalYear: current.fiscalYear,
    fiscalQuarter: current.fiscalQuarter,
    isGuidance: false,
    isAdjusted: false,
    isDerived: true,
    derivedFrom: [current.canonicalType],
    derivedFormula: formula,

    sourceFileType: current.sourceFileType,
    sourcePriority: current.sourcePriority - 5,
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Given all normalized metrics for a single document, computes derived metrics.
 * Only derives a metric if it doesn't already exist as a directly reported value.
 */
export function computeDerivedMetrics(
  metrics: NormalizedMetric[]
): NormalizedMetric[] {
  const derived: NormalizedMetric[] = [];
  const byPeriod = groupByPeriod(metrics);

  for (const [, periodMetrics] of byPeriod.entries()) {
    const revenue = findBest(periodMetrics, "revenue");

    // ── Margin derivations (all need revenue as denominator) ────────────────
    if (revenue?.value) {
      const ebitda = findBest(periodMetrics, "ebitda");
      if (ebitda?.value && !alreadyExists(periodMetrics, "ebitda_margin")) {
        derived.push(
          makeMargin(
            ebitda,
            revenue,
            "ebitda_margin",
            `EBITDA Margin${ebitda.isAdjusted ? " (Adjusted)" : ""}`,
            `EBITDA / Revenue × 100`
          )
        );
      }

      const netIncome = findBest(periodMetrics, "net_income");
      if (netIncome?.value !== null && netIncome !== null && !alreadyExists(periodMetrics, "net_margin")) {
        derived.push(
          makeMargin(
            netIncome,
            revenue,
            "net_margin",
            "Net Margin",
            `Net Income / Revenue × 100`
          )
        );
      }

      const grossProfit = findBest(periodMetrics, "gross_profit");
      if (grossProfit?.value && !alreadyExists(periodMetrics, "gross_margin")) {
        derived.push(
          makeMargin(
            grossProfit,
            revenue,
            "gross_margin",
            "Gross Margin",
            `Gross Profit / Revenue × 100`
          )
        );
      }

      const opIncome = findBest(periodMetrics, "operating_income");
      if (opIncome?.value !== null && opIncome !== null && !alreadyExists(periodMetrics, "operating_margin")) {
        derived.push(
          makeMargin(
            opIncome,
            revenue,
            "operating_margin",
            "Operating Margin",
            `Operating Income / Revenue × 100`
          )
        );
      }
    }
  }

  // ── YoY growth: compare quarterly periods a year apart ──────────────────
  const quarters = [...byPeriod.entries()]
    .filter(([, mets]) => mets.some((m) => m.fiscalQuarter !== null))
    .map(([period, mets]) => ({ period, mets }));

  for (const { mets: currentMets } of quarters) {
    for (const m of currentMets) {
      if (!m.fiscalYear || !m.fiscalQuarter || m.value === null) continue;
      if (alreadyExists(currentMets, "yoy_growth")) continue;

      const priorPeriod = `Q${m.fiscalQuarter} ${m.fiscalYear - 1}`;
      const priorEntry = byPeriod.get(priorPeriod);
      if (!priorEntry) continue;

      const prior = findBest(priorEntry, m.canonicalType);
      if (!prior?.value) continue;

      derived.push(
        makeGrowth(m, prior, `${m.metricName} YoY Growth`)
      );
      break; // one growth metric per period is enough
    }
  }

  return derived;
}
