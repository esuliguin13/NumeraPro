"use client";

/**
 * Comparability UI primitives.
 *
 * Compact badges for currency, period, guidance vs actual, and overall
 * comparability status. Used in comparison cells, snapshot rows, and the
 * drill-down panel.
 */

import { AlertTriangle, CheckCircle2, XCircle, Clock, TrendingUp } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type {
  CurrencyInfo,
  PeriodInfo,
  ComparabilityResult,
  ComparabilityStatus,
} from "@/lib/intelligence/comparability";
import { shortPeriodLabel, comparabilityLabel } from "@/lib/intelligence/comparability";

// ─── Currency badge ───────────────────────────────────────────────────────────

/**
 * Compact badge showing currency code and scale.
 * E.g.: [SGD M]  [USD B]  [EUR]
 */
export function CurrencyBadge({
  info,
  className,
}: {
  info: CurrencyInfo;
  className?: string;
}) {
  const label = info.multiplierLabel
    ? `${info.code} ${info.multiplierLabel}`
    : info.code;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center rounded border px-1.5 py-px",
              "text-[9px] font-bold uppercase tracking-wider select-none cursor-default",
              "bg-blue-500/10 text-blue-400 border-blue-500/20",
              className
            )}
          >
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <p className="font-semibold">{info.code}</p>
          <p className="text-muted-foreground">
            {info.multiplierLabel ? `Values in ${info.code} ${info.multiplierLabel}` : `Values in ${info.code}`}
          </p>
          <p className="text-muted-foreground/70">Source: {info.source.replace("_", " ")}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Period badge ─────────────────────────────────────────────────────────────

/**
 * Compact badge showing normalized period label.
 * E.g.: [FY25]  [Q1 26]  [TTM]  [FY25e] (guidance)
 */
export function PeriodBadge({
  info,
  className,
}: {
  info: PeriodInfo;
  className?: string;
}) {
  const short = shortPeriodLabel(info);
  if (!short) return null;

  const isGuidance = info.isGuidance;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-0.5 rounded border px-1.5 py-px",
              "text-[9px] font-bold uppercase tracking-wider select-none cursor-default",
              isGuidance
                ? "bg-violet-500/10 text-violet-400 border-violet-500/20"
                : "bg-muted text-muted-foreground/80 border-border",
              className
            )}
          >
            {isGuidance && <TrendingUp className="h-2 w-2" />}
            {short}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">
          <p className="font-semibold">{info.label || info.raw}</p>
          <p className="text-muted-foreground capitalize">{info.type.replace("_", " ")}{info.year ? ` · ${info.year}` : ""}</p>
          {isGuidance && <p className="text-violet-400">Forward-looking guidance</p>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Actual vs Guidance badge ─────────────────────────────────────────────────

export function ActualGuidanceBadge({
  isGuidance,
  className,
}: {
  isGuidance: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded border px-1.5 py-px",
        "text-[9px] font-bold uppercase tracking-wider select-none",
        isGuidance
          ? "bg-violet-500/10 text-violet-400 border-violet-500/20"
          : "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
        className
      )}
    >
      <Clock className="h-2 w-2" />
      {isGuidance ? "Est." : "Actual"}
    </span>
  );
}

// ─── Comparability status badge ───────────────────────────────────────────────

function statusConfig(status: ComparabilityStatus) {
  switch (status) {
    case "comparable":
      return {
        icon: CheckCircle2,
        label: "Comparable",
        className: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      };
    case "partially_comparable":
      return {
        icon: AlertTriangle,
        label: "Partial",
        className: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      };
    case "not_comparable":
      return {
        icon: XCircle,
        label: "Mismatch",
        className: "bg-red-500/10 text-red-400 border-red-500/20",
      };
  }
}

/**
 * Small pill badge: ✓ Comparable | ~ Partial | ✗ Mismatch
 * Tooltip shows the full reason.
 */
export function ComparabilityBadge({
  status,
  reason,
  className,
}: {
  status: ComparabilityStatus;
  reason: string;
  className?: string;
}) {
  const cfg = statusConfig(status);
  const Icon = cfg.icon;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded border px-1.5 py-px",
              "text-[9px] font-bold uppercase tracking-wider select-none cursor-default",
              cfg.className,
              className
            )}
          >
            <Icon className="h-2.5 w-2.5" />
            {cfg.label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs text-xs">
          <p className="font-semibold mb-0.5">{comparabilityLabel(status)}</p>
          <p className="text-muted-foreground leading-snug">{reason}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// ─── Comparability warning inline ────────────────────────────────────────────

/**
 * Inline warning row shown inside a comparison cell when comparison is
 * blocked or limited.
 */
export function ComparabilityWarningRow({
  result,
  className,
}: {
  result: ComparabilityResult;
  className?: string;
}) {
  if (result.status === "comparable") return null;

  const isBlocked = result.status === "not_comparable";
  return (
    <div
      className={cn(
        "flex items-start gap-1.5 rounded px-2 py-1.5 text-[10px] leading-snug",
        isBlocked
          ? "bg-red-500/8 text-red-400/90"
          : "bg-amber-500/8 text-amber-400/90",
        className
      )}
    >
      <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
      <span>{result.reason}</span>
    </div>
  );
}

// ─── Drill-down panel ─────────────────────────────────────────────────────────

/**
 * Detailed comparability panel for the drill-down view.
 * Shows per-entity original currency, normalized period, and overall status.
 */
export function ComparabilityPanel({
  result,
  entityLabels,
  rawValues,
  className,
}: {
  result: ComparabilityResult;
  entityLabels: string[];
  rawValues: Array<number | null>;
  className?: string;
}) {
  const cfg = statusConfig(result.status);
  const Icon = cfg.icon;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Overall status */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs font-semibold",
            cfg.className
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {comparabilityLabel(result.status)}
        </span>
        {result.sharedCurrency && (
          <CurrencyBadge info={result.sharedCurrency} />
        )}
        {result.sharedPeriod && (
          <PeriodBadge info={result.sharedPeriod} />
        )}
      </div>

      {/* Reason */}
      {result.status !== "comparable" && (
        <p className="text-xs text-muted-foreground leading-relaxed">
          {result.reason}
        </p>
      )}

      {/* Per-entity breakdown */}
      {entityLabels.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            Source Details
          </p>
          {entityLabels.map((label, i) => {
            const currency = result.currencies[i];
            const period = result.periods[i];
            const value = rawValues[i];

            return (
              <div
                key={i}
                className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/10 px-3 py-2"
              >
                <span className="flex-1 text-xs font-medium text-foreground truncate">
                  {label}
                </span>

                {/* Original value */}
                {value != null && (
                  <span className="text-[10px] tabular-nums text-muted-foreground">
                    {value.toLocaleString()}
                    {currency?.multiplierLabel ? ` ${currency.multiplierLabel}` : ""}
                  </span>
                )}

                {/* Currency badge */}
                {currency ? (
                  <CurrencyBadge info={currency} />
                ) : (
                  <span className="text-[9px] text-muted-foreground/40">no currency</span>
                )}

                {/* Period badge */}
                {period && period.type !== "unknown" ? (
                  <PeriodBadge info={period} />
                ) : (
                  <span className="text-[9px] text-muted-foreground/40">no period</span>
                )}

                {/* Actual/Guidance */}
                {period && (
                  <ActualGuidanceBadge isGuidance={period.isGuidance} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Specific mismatch callouts */}
      {result.currencyMismatch && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-400">
          <p className="font-semibold mb-0.5">Currency conversion not available</p>
          <p className="text-red-400/80">
            Numeric ranking is blocked. Values are shown in their original currencies.
            Apply FX conversion manually before drawing conclusions.
          </p>
        </div>
      )}

      {result.actualVsGuidanceMix && (
        <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 px-3 py-2 text-xs text-violet-400">
          <p className="font-semibold mb-0.5">Actual vs guidance mix</p>
          <p className="text-violet-400/80">
            Some values are forward-looking estimates. Treat directional comparison
            carefully — realized figures may differ.
          </p>
        </div>
      )}
    </div>
  );
}
