/**
 * Metric Normalizer
 *
 * Maps raw extracted metrics to canonical types, normalizes periods,
 * detects adjusted/guidance flags, and assigns source priority.
 *
 * Source priority (higher = more authoritative for numeric questions):
 *   CSV / XLSX → 100 / 95   structured files, ground truth
 *   PDF        → 70         official document
 *   TXT        → 55         plain text
 *   Transcript → 45         spoken word, may be approximate
 */

import type { ExtractedMetricRow } from "@/types";
import type {
  CanonicalMetricType,
  NormalizedMetric,
  SourceFileType,
} from "./types";

// ─── Source priority map ──────────────────────────────────────────────────────

export const SOURCE_PRIORITY: Record<SourceFileType, number> = {
  csv: 100,
  xlsx: 95,
  pdf: 70,
  txt: 55,
  transcript: 45,
};

// ─── Alias → canonical type ───────────────────────────────────────────────────

/**
 * Ordered from most-specific to least-specific so that e.g.
 * "ebitda margin" matches "ebitda_margin" before "ebitda".
 */
const CANONICAL_ALIAS_MAP: Array<{
  patterns: RegExp[];
  type: CanonicalMetricType;
}> = [
  // Margins (must come before their base types)
  {
    patterns: [/ebitda\s*margin/i, /ebitda\s*%/i],
    type: "ebitda_margin",
  },
  {
    patterns: [/net\s*(profit\s*)?margin/i, /net\s*income\s*margin/i],
    type: "net_margin",
  },
  {
    patterns: [/gross\s*(profit\s*)?margin/i],
    type: "gross_margin",
  },
  {
    patterns: [/operating\s*(profit\s*)?margin/i, /ebit\s*margin/i],
    type: "operating_margin",
  },
  // Revenue
  {
    patterns: [
      /^revenue$/i,
      /net\s+revenue/i,
      /total\s+revenue/i,
      /net\s+sales/i,
      /total\s+sales/i,
      /gross\s+revenue/i,
      /\bsales\b/i,
      /\bturnover\b/i,
      /\barr\b/i,
      /\bmrr\b/i,
    ],
    type: "revenue",
  },
  // EBITDA
  {
    patterns: [/\bebitda\b/i, /adj(?:usted)?\.?\s*ebitda/i],
    type: "ebitda",
  },
  // Net income
  {
    patterns: [
      /net\s+income/i,
      /net\s+profit/i,
      /net\s+earnings/i,
      /net\s+loss/i,
      /bottom.?line/i,
    ],
    type: "net_income",
  },
  // Gross profit
  {
    patterns: [/gross\s+profit/i, /gross\s+income/i],
    type: "gross_profit",
  },
  // Operating income
  {
    patterns: [
      /operating\s+income/i,
      /operating\s+profit/i,
      /income\s+from\s+operations/i,
      /\bebit\b(?!\s*da)/i,
    ],
    type: "operating_income",
  },
  // Generic margin
  {
    patterns: [/\bmargin\b/i],
    type: "margin",
  },
  // Growth
  {
    patterns: [/yoy\s+growth/i, /year.?over.?year\s+growth/i, /annual\s+growth/i],
    type: "yoy_growth",
  },
  {
    patterns: [/qoq\s+growth/i, /quarter.?over.?quarter/i, /sequential\s+growth/i],
    type: "qoq_growth",
  },
  // Guidance
  {
    patterns: [/\bguidance\b/i, /\boutlook\b/i, /\bforecast\b/i, /full.?year\s+guidance/i],
    type: "guidance",
  },
  // Headcount
  {
    patterns: [/\bheadcount\b/i, /\bemployees\b/i, /\bfte\b/i, /\bstaff\b/i],
    type: "headcount",
  },
];

export function inferCanonicalType(metricName: string): CanonicalMetricType {
  for (const { patterns, type } of CANONICAL_ALIAS_MAP) {
    if (patterns.some((p) => p.test(metricName))) return type;
  }
  return "custom";
}

// ─── Period normalization ─────────────────────────────────────────────────────

export interface NormalizedPeriod {
  normalizedPeriod: string | null;
  periodType: "annual" | "quarterly" | "ttm" | "other" | null;
  fiscalYear: number | null;
  fiscalQuarter: number | null;
  isGuidance: boolean;
}

export function normalizePeriod(raw: string | null): NormalizedPeriod {
  if (!raw?.trim()) {
    return {
      normalizedPeriod: null,
      periodType: null,
      fiscalYear: null,
      fiscalQuarter: null,
      isGuidance: false,
    };
  }

  const p = raw.trim();
  const isGuidance = /guidance|outlook|forecast|full.?year\s+(?:20\d{2})?$/i.test(p);

  // "Q1 2026", "Q1-2026", "Q1'26", "1Q26", "1Q 2026"
  const qMatch = p.match(/(?:Q([1-4])[\s\-']?(\d{2,4})|([1-4])Q[\s\-']?(\d{2,4}))/i);
  if (qMatch) {
    const q = parseInt(qMatch[1] ?? qMatch[3]);
    const yr =
      qMatch[2] ?? qMatch[4]
        ? (qMatch[2] ?? qMatch[4]).length === 2
          ? 2000 + parseInt(qMatch[2] ?? qMatch[4])
          : parseInt(qMatch[2] ?? qMatch[4])
        : null;
    if (yr) {
      return {
        normalizedPeriod: `Q${q} ${yr}`,
        periodType: "quarterly",
        fiscalYear: yr,
        fiscalQuarter: q,
        isGuidance,
      };
    }
  }

  // "FY2026", "FY 2026", "Full Year 2026", "FY'26"
  const fyMatch = p.match(/(?:FY|full\s*year)[\s\-']?(\d{2,4})/i);
  if (fyMatch) {
    const yr =
      fyMatch[1].length === 2
        ? 2000 + parseInt(fyMatch[1])
        : parseInt(fyMatch[1]);
    return {
      normalizedPeriod: `FY${yr}`,
      periodType: "annual",
      fiscalYear: yr,
      fiscalQuarter: null,
      isGuidance,
    };
  }

  // TTM / LTM
  if (/\b(ttm|ltm|trailing.?twelve)\b/i.test(p)) {
    const yrMatch = p.match(/\b(20\d{2})\b/);
    return {
      normalizedPeriod: yrMatch ? `TTM ${yrMatch[1]}` : "TTM",
      periodType: "ttm",
      fiscalYear: yrMatch ? parseInt(yrMatch[1]) : null,
      fiscalQuarter: null,
      isGuidance: false,
    };
  }

  // Standalone year "2026"
  const yrOnly = p.match(/^(20\d{2})$/);
  if (yrOnly) {
    return {
      normalizedPeriod: yrOnly[1],
      periodType: "annual",
      fiscalYear: parseInt(yrOnly[1]),
      fiscalQuarter: null,
      isGuidance,
    };
  }

  return {
    normalizedPeriod: p,
    periodType: "other",
    fiscalYear: null,
    fiscalQuarter: null,
    isGuidance,
  };
}

// ─── Adjusted/non-GAAP detection ─────────────────────────────────────────────

const ADJUSTED_PATTERNS = [
  /\badjusted\b/i,
  /\badj\.?\b/i,
  /non.?gaap/i,
  /\bnormalized\b/i,
  /\bpro.?forma\b/i,
  /\bcore\b/i,
  /\bunderlying\b/i,
];

export function isAdjustedMetric(name: string): boolean {
  return ADJUSTED_PATTERNS.some((p) => p.test(name));
}

// ─── Main normalization function ──────────────────────────────────────────────

export function normalizeMetric(
  row: ExtractedMetricRow,
  fileType: SourceFileType
): NormalizedMetric {
  const canonicalType = inferCanonicalType(row.metric_name);
  const period = normalizePeriod(row.period);

  return {
    id: row.id,
    documentId: row.document_id,
    workspaceId: row.workspace_id,
    metricType: row.metric_type,
    metricName: row.metric_name,
    value: row.value !== null ? Number(row.value) : null,
    unit: row.unit,
    period: row.period,
    periodType: row.period_type,
    rawText: row.raw_text,
    pageNumber: row.page_number,
    confidence: Number(row.confidence),

    canonicalType,
    normalizedPeriod: period.normalizedPeriod,
    fiscalYear: period.fiscalYear,
    fiscalQuarter: period.fiscalQuarter,
    isGuidance: period.isGuidance,
    isAdjusted: isAdjustedMetric(row.metric_name),
    isDerived: false,

    sourceFileType: fileType,
    sourcePriority: SOURCE_PRIORITY[fileType] ?? 50,
  };
}

// ─── Source ranking ───────────────────────────────────────────────────────────

/**
 * Given multiple metrics for the same canonical type + period,
 * returns the single most authoritative one.
 * Tie-breaks: source priority → confidence → most recent (by id desc).
 */
export function selectBestMetric(
  metrics: NormalizedMetric[]
): NormalizedMetric | null {
  if (metrics.length === 0) return null;
  return [...metrics].sort((a, b) => {
    if (b.sourcePriority !== a.sourcePriority)
      return b.sourcePriority - a.sourcePriority;
    return b.confidence - a.confidence;
  })[0];
}

/**
 * For a list of normalized metrics, returns one representative per
 * (canonicalType × normalizedPeriod) pair using source hierarchy.
 */
export function selectBestMetrics(metrics: NormalizedMetric[]): NormalizedMetric[] {
  const groups = new Map<string, NormalizedMetric[]>();

  for (const m of metrics) {
    const key = `${m.canonicalType}::${m.normalizedPeriod ?? "unknown"}`;
    const arr = groups.get(key) ?? [];
    arr.push(m);
    groups.set(key, arr);
  }

  const best: NormalizedMetric[] = [];
  for (const group of groups.values()) {
    const winner = selectBestMetric(group);
    if (winner) best.push(winner);
  }

  return best;
}
