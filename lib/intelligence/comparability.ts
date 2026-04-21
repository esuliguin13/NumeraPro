/**
 * Comparability Module
 *
 * Detects, normalizes, and labels currency and period differences before
 * comparison. Evaluates whether two or more metrics are safe to compare
 * numerically and returns a structured result with status + reason.
 *
 * No external FX conversion in v1 — values stay in their original currency.
 * When currencies differ, numeric ranking is blocked and a warning is returned.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

export type ComparabilityStatus =
  | "comparable"           // same currency, same or adjacent period type
  | "partially_comparable" // same type but different year (YoY valid), or minor mismatch
  | "not_comparable";      // different currencies, or fundamentally mismatched period types

export type PeriodType =
  | "annual"
  | "quarterly"
  | "half_year"
  | "trailing"    // TTM / LTM
  | "guidance"    // forward-looking
  | "ytd"         // year-to-date
  | "unknown";

export interface CurrencyInfo {
  /** ISO 4217 code: "USD", "SGD", "EUR", etc. */
  code: string;
  /** Display symbol: "$", "S$", "€", etc. */
  symbol: string;
  /** Scale multiplier implied by unit string (1, 1e3, 1e6, 1e9) */
  multiplier: number;
  /** Human label for multiplier: "", "K", "M", "B" */
  multiplierLabel: string;
  /** How the currency was detected */
  source: "unit_explicit" | "unit_symbol" | "metadata" | "inferred" | "unknown";
  /** The raw unit string this was parsed from */
  raw: string;
}

export interface PeriodInfo {
  type: PeriodType;
  /** Fiscal or calendar year (e.g. 2025) */
  year: number | null;
  /** Quarter number 1–4 (only for quarterly) */
  quarter: number | null;
  /** Half number 1–2 (only for half_year) */
  half: number | null;
  /** Whether this is a realized/actual metric (not guidance) */
  isActual: boolean;
  /** Whether this is forward-looking guidance */
  isGuidance: boolean;
  /** Normalized display string, e.g. "FY2025", "Q1 FY2026", "H1 2025", "TTM" */
  label: string;
  /** The original string that was parsed */
  raw: string;
}

export interface MetricComparabilityInput {
  /** entity / source label */
  entityLabel: string;
  currency: CurrencyInfo | null;
  period: PeriodInfo | null;
  /** Optional: raw value used for cross-scale detection */
  rawValue?: number | null;
}

export interface ComparabilityResult {
  status: ComparabilityStatus;
  /** One-sentence human-readable explanation */
  reason: string;
  /** Per-input currency info (index matches input array) */
  currencies: Array<CurrencyInfo | null>;
  /** Per-input period info (index matches input array) */
  periods: Array<PeriodInfo | null>;
  /** True when at least 2 distinct currency codes are present */
  currencyMismatch: boolean;
  /** True when period types differ across inputs */
  periodTypeMismatch: boolean;
  /** True when years differ (YoY may still be valid) */
  periodYearMismatch: boolean;
  /** True when one input is guidance and another is actual */
  actualVsGuidanceMix: boolean;
  /** If currencies all match, the shared currency info */
  sharedCurrency: CurrencyInfo | null;
  /** If periods all match type+year, the shared period info */
  sharedPeriod: PeriodInfo | null;
}

// ─── Currency patterns ────────────────────────────────────────────────────────

interface CurrencyPattern {
  pattern: RegExp;
  code: string;
  symbol: string;
}

const CURRENCY_PATTERNS: CurrencyPattern[] = [
  // Must come before bare $  — explicit country-prefixed symbols
  { pattern: /\bUS[-\s]?\$|USD\b/i,                    code: "USD", symbol: "$"    },
  { pattern: /\bS\$|SGD\b/i,                            code: "SGD", symbol: "S$"  },
  { pattern: /\bA\$|AUD\b/i,                            code: "AUD", symbol: "A$"  },
  { pattern: /\bC\$|CAD\b/i,                            code: "CAD", symbol: "C$"  },
  { pattern: /\bNZ\$|NZD\b/i,                           code: "NZD", symbol: "NZ$" },
  { pattern: /\bHK\$|HKD\b/i,                           code: "HKD", symbol: "HK$" },
  { pattern: /\bRM\b|\bMYR\b|\bRinggit\b/i,             code: "MYR", symbol: "RM"  },
  { pattern: /€|\bEUR\b|\bEuro\b/i,                     code: "EUR", symbol: "€"   },
  { pattern: /£|\bGBP\b|\bSterling\b|\bPound\b/i,       code: "GBP", symbol: "£"   },
  { pattern: /¥|\bJPY\b|\bYen\b/i,                      code: "JPY", symbol: "¥"   },
  { pattern: /\bRMB\b|\bCNY\b|\bYuan\b/i,               code: "CNY", symbol: "¥"   },
  { pattern: /₹|\bINR\b|\bRupee\b/i,                    code: "INR", symbol: "₹"   },
  { pattern: /₩|\bKRW\b|\bWon\b/i,                      code: "KRW", symbol: "₩"   },
  { pattern: /\bCHF\b|\bSwiss\s+franc\b/i,              code: "CHF", symbol: "Fr"  },
  { pattern: /\bSEK\b|\bSwedish\s+krona\b/i,            code: "SEK", symbol: "kr"  },
  { pattern: /\bNOK\b|\bNorwegian\s+krone\b/i,          code: "NOK", symbol: "kr"  },
  { pattern: /\bDKK\b|\bDanish\s+krone\b/i,             code: "DKK", symbol: "kr"  },
  { pattern: /\bTHB\b|\bBaht\b/i,                       code: "THB", symbol: "฿"   },
  { pattern: /\bIDR\b|\bRupiah\b/i,                     code: "IDR", symbol: "Rp"  },
  { pattern: /\bPHP\b|\bPeso\b/i,                       code: "PHP", symbol: "₱"   },
  { pattern: /\bVND\b|\bDong\b/i,                       code: "VND", symbol: "₫"   },
  { pattern: /\bBRL\b|\bReal\b/i,                       code: "BRL", symbol: "R$"  },
  { pattern: /\bMXN\b|\bPeso\s+mexicano\b/i,            code: "MXN", symbol: "$"   },
  { pattern: /\bZAR\b|\bRand\b/i,                       code: "ZAR", symbol: "R"   },
  // Bare $ as last resort → assume USD
  { pattern: /\$/,                                       code: "USD", symbol: "$"   },
];

interface MultiplierPattern {
  pattern: RegExp;
  multiplier: number;
  label: string;
}

const MULTIPLIER_PATTERNS: MultiplierPattern[] = [
  { pattern: /\b(?:billion|bn|BB?)\b/i,               multiplier: 1e9, label: "B" },
  { pattern: /\b(?:million|mn|mm?|mil)\b/i,           multiplier: 1e6, label: "M" },
  { pattern: /\b(?:thousand|k|'000|000s)\b/i,         multiplier: 1e3, label: "K" },
];

// ─── Period patterns ──────────────────────────────────────────────────────────

function normalizeYear(raw: string): number {
  const y = parseInt(raw, 10);
  return y < 100 ? 2000 + y : y;
}

interface PeriodPattern {
  pattern: RegExp;
  type: PeriodType;
  isGuidance?: boolean;
  extract: (m: RegExpMatchArray) => Partial<PeriodInfo>;
}

const PERIOD_PATTERNS: PeriodPattern[] = [
  // Quarterly: Q1 2025, Q1 FY2025, Q1FY25, 1Q25, Q1'25
  {
    pattern: /(?:Q([1-4])(?:\s*(?:FY)?(?:')?(\d{2,4}))?|([1-4])Q(?:\s*(?:FY)?(?:')?(\d{2,4}))?)/i,
    type: "quarterly",
    extract: (m) => ({
      quarter: parseInt(m[1] ?? m[3]),
      year: m[2] ? normalizeYear(m[2]) : m[4] ? normalizeYear(m[4]) : null,
    }),
  },
  // Half-year: H1 2025, H2 FY2025, 1H25, 2H FY2025
  {
    pattern: /(?:H([12])(?:\s*(?:FY)?(?:')?(\d{2,4}))?|([12])H(?:\s*(?:FY)?(?:')?(\d{2,4}))?)/i,
    type: "half_year",
    extract: (m) => ({
      half: parseInt(m[1] ?? m[3]),
      year: m[2] ? normalizeYear(m[2]) : m[4] ? normalizeYear(m[4]) : null,
    }),
  },
  // Trailing: TTM, LTM, Trailing 12M
  {
    pattern: /\b(?:TTM|LTM|trailing[\s-](?:12|twelve)[\s-](?:months?|M))\b/i,
    type: "trailing",
    extract: () => ({}),
  },
  // YTD: YTD 2025, 2025 YTD
  {
    pattern: /\b(?:YTD|year[\s-]to[\s-]date)\b/i,
    type: "ytd",
    extract: () => ({}),
  },
  // FY2025, FY25, FY 2025, FY'25
  {
    pattern: /FY\s*'?(\d{2,4})/i,
    type: "annual",
    extract: (m) => ({ year: normalizeYear(m[1]) }),
  },
  // Full Year 2025, Calendar Year 2025, CY2025
  {
    pattern: /(?:(?:Full\s+)?Year|Calendar\s+Year|CY)\s*(?:')?(\d{4})/i,
    type: "annual",
    extract: (m) => ({ year: parseInt(m[1]) }),
  },
  // Nine months: 9M 2025, 6M FY25
  {
    pattern: /(\d+)M\s*(?:FY)?(?:')?(\d{2,4})/i,
    type: "unknown",
    extract: (m) => ({ year: normalizeYear(m[2]) }),
  },
  // Guidance / outlook / forecast
  {
    pattern: /\b(?:guidance|outlook|forecast|estimated|projected|expected)\b/i,
    type: "guidance",
    isGuidance: true,
    extract: () => ({}),
  },
  // Standalone year: 2025, 2024  (must be last to avoid false positives)
  {
    pattern: /\b(20\d{2})\b/,
    type: "annual",
    extract: (m) => ({ year: parseInt(m[1]) }),
  },
];

// ─── Core parsers ─────────────────────────────────────────────────────────────

/**
 * Extract currency info from a unit string (e.g. "SGD M", "US$ million", "%").
 * Returns null for pure percentage/ratio units.
 */
export function detectCurrency(
  unit: string | null | undefined,
  metadataHint?: Record<string, unknown> | null
): CurrencyInfo | null {
  if (!unit) {
    // Try metadata hint (e.g. workspace base currency)
    const hint = metadataHint?.currency as string | undefined;
    if (hint) {
      const canonical = CURRENCY_PATTERNS.find((p) => p.code === hint.toUpperCase());
      if (canonical) {
        return {
          code: canonical.code,
          symbol: canonical.symbol,
          multiplier: 1,
          multiplierLabel: "",
          source: "metadata",
          raw: hint,
        };
      }
    }
    return null;
  }

  const text = unit.trim();

  // Skip pure percentage / ratio units
  if (/^%$|^(percent|ratio|times|x|bps|basis points?)$/i.test(text)) return null;

  // Detect currency code/symbol
  let code = "";
  let symbol = "";
  let source: CurrencyInfo["source"] = "unknown";

  for (const cp of CURRENCY_PATTERNS) {
    if (cp.pattern.test(text)) {
      code = cp.code;
      symbol = cp.symbol;
      source = /[A-Z]{3}/.test(cp.pattern.source) ? "unit_explicit" : "unit_symbol";
      break;
    }
  }

  if (!code) {
    // No recognised currency — if unit starts with a letter, it might be a
    // 3-letter ISO code we don't know yet.
    const isoMatch = text.match(/^([A-Z]{3})\b/i);
    if (isoMatch) {
      code = isoMatch[1].toUpperCase();
      symbol = code;
      source = "unit_explicit";
    } else {
      return null;
    }
  }

  // Detect multiplier
  let multiplier = 1;
  let multiplierLabel = "";
  for (const mp of MULTIPLIER_PATTERNS) {
    if (mp.pattern.test(text)) {
      multiplier = mp.multiplier;
      multiplierLabel = mp.label;
      break;
    }
  }

  return { code, symbol, multiplier, multiplierLabel, source, raw: text };
}

/**
 * Parse a period string into a normalized PeriodInfo.
 * Returns an "unknown" PeriodInfo if parsing fails.
 */
export function parsePeriod(raw: string | null | undefined): PeriodInfo {
  const empty: PeriodInfo = {
    type: "unknown",
    year: null,
    quarter: null,
    half: null,
    isActual: false,
    isGuidance: false,
    label: raw ?? "",
    raw: raw ?? "",
  };

  if (!raw || raw.trim() === "") return empty;

  const text = raw.trim();
  let result: Partial<PeriodInfo> = {};
  let matchedType: PeriodType = "unknown";
  let isGuidance = false;

  // Check guidance keywords first (can co-occur with period)
  if (/\b(?:guidance|outlook|forecast|projected|estimated|expected)\b/i.test(text)) {
    isGuidance = true;
  }

  for (const pp of PERIOD_PATTERNS) {
    if (pp.isGuidance) continue; // handled above
    const match = text.match(pp.pattern);
    if (match) {
      const extracted = pp.extract(match);
      result = { ...result, ...extracted };
      matchedType = pp.type;
      break;
    }
  }

  const year = (result.year as number | undefined) ?? null;
  const quarter = (result.quarter as number | undefined) ?? null;
  const half = (result.half as number | undefined) ?? null;

  // Build normalized label
  let label = text;
  if (matchedType === "annual" && year) {
    label = `FY${year}`;
  } else if (matchedType === "quarterly" && quarter) {
    label = year ? `Q${quarter} FY${year}` : `Q${quarter}`;
  } else if (matchedType === "half_year" && half) {
    label = year ? `H${half} ${year}` : `H${half}`;
  } else if (matchedType === "trailing") {
    label = "TTM";
  } else if (matchedType === "ytd") {
    label = year ? `${year} YTD` : "YTD";
  }

  if (isGuidance && !label.toLowerCase().includes("guidance")) {
    label += " (guidance)";
  }

  return {
    type: isGuidance ? "guidance" : matchedType,
    year,
    quarter,
    half,
    isActual: !isGuidance,
    isGuidance,
    label,
    raw: text,
  };
}

// ─── Comparability assessment ─────────────────────────────────────────────────

/**
 * Assess whether a set of per-entity metrics can be safely compared.
 * Blocks numeric ranking when currencies differ (no FX conversion).
 * Allows YoY comparison (same type, different year) but labels as partial.
 */
export function assessComparability(
  inputs: MetricComparabilityInput[]
): ComparabilityResult {
  const currencies = inputs.map((i) => i.currency);
  const periods = inputs.map((i) => i.period);

  const validCurrencies = currencies.filter((c): c is CurrencyInfo => c !== null);
  const validPeriods = periods.filter((p): p is PeriodInfo => p !== null);

  // ── Currency check ─────────────────────────────────────────────────────────
  const currencyCodes = new Set(validCurrencies.map((c) => c.code));
  const currencyMismatch = currencyCodes.size > 1;

  // ── Period checks ──────────────────────────────────────────────────────────
  const nonUnknownPeriods = validPeriods.filter((p) => p.type !== "unknown");
  const periodTypes = new Set(nonUnknownPeriods.map((p) => p.type));
  const periodYears = new Set(
    nonUnknownPeriods.filter((p) => p.year !== null).map((p) => p.year)
  );

  // Type mismatch = comparing annual vs quarterly etc.
  const fundamentalTypeMismatch =
    periodTypes.size > 1 &&
    !(periodTypes.has("annual") && periodTypes.size === 1); // all annual is fine

  // Guidance vs actual mix
  const hasGuidance = validPeriods.some((p) => p.isGuidance);
  const hasActual = validPeriods.some((p) => p.isActual && !p.isGuidance);
  const actualVsGuidanceMix = hasGuidance && hasActual;

  const periodTypeMismatch = fundamentalTypeMismatch;
  const periodYearMismatch = periodYears.size > 1;

  // ── Determine status + reason ──────────────────────────────────────────────
  let status: ComparabilityStatus = "comparable";
  let reason = "";

  if (currencyMismatch) {
    status = "not_comparable";
    const codes = [...currencyCodes].join(" vs ");
    reason = `Currencies differ (${codes}). Numeric comparison blocked — values are not on a common scale. Label each metric with its original currency.`;
  } else if (fundamentalTypeMismatch) {
    status = "not_comparable";
    const types = [...periodTypes].join(" vs ");
    reason = `Period types differ (${types}). Comparing annual with quarterly or half-year figures is misleading.`;
  } else if (actualVsGuidanceMix) {
    status = "partially_comparable";
    reason = "Some metrics are forward-looking guidance while others are realized actuals. Compare directionally, not numerically.";
  } else if (periodYearMismatch) {
    status = "partially_comparable";
    const years = [...periodYears].sort().join(" vs ");
    reason = `Metrics span different years (${years}). This may be intentional (YoY comparison), but values reflect different time periods.`;
  } else if (validCurrencies.length < inputs.length || validPeriods.length < inputs.length) {
    status = "partially_comparable";
    reason = "Currency or period could not be determined for all metrics.";
  }

  if (!reason) reason = "All metrics share the same currency and period — direct comparison is valid.";

  // Shared currency (if no mismatch)
  const sharedCurrency =
    !currencyMismatch && validCurrencies.length > 0 ? validCurrencies[0] : null;

  // Shared period (if no type mismatch and no year mismatch)
  const sharedPeriod =
    !periodTypeMismatch && !periodYearMismatch && nonUnknownPeriods.length > 0
      ? nonUnknownPeriods[0]
      : null;

  return {
    status,
    reason,
    currencies,
    periods,
    currencyMismatch,
    periodTypeMismatch,
    periodYearMismatch,
    actualVsGuidanceMix,
    sharedCurrency,
    sharedPeriod,
  };
}

// ─── Convenience: assess from raw metric data ─────────────────────────────────

export interface RawMetricForComparability {
  entityLabel: string;
  unit: string | null;
  period: string | null;
  value: number | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Assess comparability from raw metric rows (as stored in best_metrics /
 * derived_metrics in answer metadata). This is the main entry point
 * called from lib/intelligence/comparison.ts.
 */
export function assessMetricComparability(
  metrics: RawMetricForComparability[]
): ComparabilityResult {
  const inputs: MetricComparabilityInput[] = metrics.map((m) => ({
    entityLabel: m.entityLabel,
    currency: detectCurrency(m.unit, m.metadata),
    period: parsePeriod(m.period),
    rawValue: m.value,
  }));
  return assessComparability(inputs);
}

// ─── Comparability status helpers ─────────────────────────────────────────────

export function comparabilityColor(status: ComparabilityStatus) {
  return status === "comparable"
    ? "emerald"
    : status === "partially_comparable"
    ? "amber"
    : "red";
}

export function comparabilityIcon(status: ComparabilityStatus) {
  return status === "comparable" ? "✓" : status === "partially_comparable" ? "~" : "✗";
}

export function comparabilityLabel(status: ComparabilityStatus) {
  return status === "comparable"
    ? "Comparable"
    : status === "partially_comparable"
    ? "Partially Comparable"
    : "Not Comparable";
}

// ─── Period display helper ────────────────────────────────────────────────────

/**
 * Short period label for badges (e.g. "FY25", "Q1", "TTM").
 */
export function shortPeriodLabel(p: PeriodInfo | null | undefined): string {
  if (!p || p.type === "unknown") return "";
  if (p.type === "trailing") return "TTM";
  if (p.type === "ytd") return "YTD";
  if (p.type === "guidance") {
    return p.year ? `FY${String(p.year).slice(-2)}e` : "Est.";
  }
  if (p.type === "annual" && p.year) {
    return `FY${String(p.year).slice(-2)}`;
  }
  if (p.type === "quarterly" && p.quarter) {
    const suffix = p.year ? ` ${String(p.year).slice(-2)}` : "";
    return `Q${p.quarter}${suffix}`;
  }
  if (p.type === "half_year" && p.half) {
    const suffix = p.year ? ` ${p.year}` : "";
    return `H${p.half}${suffix}`;
  }
  return p.label.slice(0, 8);
}
