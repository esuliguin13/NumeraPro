"use client";

import { useState, useEffect } from "react";
import { ChevronDown, ChevronUp, TrendingUp, TrendingDown, Minus, Lightbulb, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMatrixMode } from "@/lib/matrix-mode-context";
import type { ExecutiveSummaryData, KpiCard, InsightCard } from "@/lib/intelligence/executive-summary";

interface ExecutiveSummaryProps {
  data: ExecutiveSummaryData;
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiMetricCard({ card }: { card: KpiCard }) {
  const hasGrowth = card.growth !== null;
  const positive = (card.growth ?? 0) >= 0;
  const hasSubValue = card.subValue !== null && card.subLabel !== null;

  return (
    <div className="flex flex-col justify-between rounded-xl border border-border bg-card px-4 py-3 min-w-0">
      {/* Label + source chip */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {card.label}
        </span>
        <span className={cn(
          "text-[9px] font-semibold uppercase tracking-widest px-1.5 py-0.5 rounded-full",
          card.sourceType === "csv" || card.sourceType === "xlsx"
            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            : card.sourceType === "pdf"
            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
            : "bg-muted text-muted-foreground"
        )}>
          {card.sourceType.toUpperCase()}
        </span>
      </div>

      {/* Main value */}
      <p className="text-2xl font-bold tracking-tight text-foreground leading-none mb-1.5">
        {card.formatted}
      </p>

      {/* Growth / sub-metric row */}
      <div className="flex items-center gap-2 flex-wrap">
        {hasGrowth && (
          <span className={cn(
            "flex items-center gap-0.5 text-[11px] font-semibold",
            positive ? "text-emerald-500" : "text-red-400"
          )}>
            {positive
              ? <TrendingUp className="h-3 w-3" />
              : <TrendingDown className="h-3 w-3" />}
            {positive ? "+" : ""}{card.growth!.toFixed(1)}% {card.subLabel}
          </span>
        )}
        {!hasGrowth && hasSubValue && (
          <span className="text-[11px] text-muted-foreground">
            {card.subValue!.toFixed(1)}% {card.subLabel}
          </span>
        )}
        {!hasGrowth && !hasSubValue && (
          <span className="flex items-center gap-0.5 text-[11px] text-muted-foreground/50">
            <Minus className="h-3 w-3" /> growth n/a
          </span>
        )}
        {card.period && (
          <span className="text-[10px] text-muted-foreground/50 ml-auto">
            {card.period}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Insight card ─────────────────────────────────────────────────────────────

function InsightTextCard({
  card,
  icon,
  label,
  accentClass,
}: {
  card: InsightCard;
  icon: React.ReactNode;
  label: string;
  accentClass: string;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card px-4 py-3 min-w-0">
      <div className={cn("flex items-center gap-1.5 mb-1.5", accentClass)}>
        {icon}
        <span className="text-[11px] font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xs text-foreground/80 leading-relaxed line-clamp-3">
        {card.text}
      </p>
    </div>
  );
}

// ─── Placeholder card ─────────────────────────────────────────────────────────

function EmptyKpiCard({ label }: { label: string }) {
  return (
    <div className="flex flex-col justify-center rounded-xl border border-dashed border-border/50 bg-muted/10 px-4 py-3 min-w-0">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50 mb-1.5">
        {label}
      </span>
      <p className="text-2xl font-bold text-muted-foreground/20 leading-none">—</p>
      <span className="text-[10px] text-muted-foreground/30 mt-1.5">not extracted</span>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ExecutiveSummary({ data }: ExecutiveSummaryProps) {
  const mode = useMatrixMode();
  // In Executive mode: always expanded. In Analyst mode: user-controlled.
  const [userCollapsed, setUserCollapsed] = useState(false);
  const collapsed = mode === "executive" ? false : userCollapsed;

  return (
    <div className="border-b border-border bg-background shrink-0">
      {/* Section header */}
      <button
        onClick={() => mode === "analyst" && setUserCollapsed((v) => !v)}
        className={cn(
          "flex w-full items-center justify-between px-5 py-2 text-left transition-colors",
          mode === "analyst" ? "hover:bg-muted/30 cursor-pointer" : "cursor-default"
        )}
      >
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            Executive Summary
          </span>
          {data.dominantPeriod && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
              {data.dominantPeriod}
            </span>
          )}
        </div>
        {collapsed
          ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          : <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
        }
      </button>

      {/* Cards grid */}
      {!collapsed && (() => {
        // Build ordered list of KPIs: always show the 3 main + any optional ones that have data
        const optionalKpis = [
          data.grossProfit ? { card: data.grossProfit, label: "Gross Profit" } : null,
          data.operatingIncome ? { card: data.operatingIncome, label: "Operating Income" } : null,
        ].filter(Boolean) as Array<{ card: NonNullable<typeof data.grossProfit>; label: string }>;

        const totalCols = 3 + optionalKpis.length + 2; // 3 core + optional + 2 insights
        const colTemplate = [
          ...Array(3 + optionalKpis.length).fill("1fr"),
          "1.4fr",
          "1.4fr",
        ].join(" ");

        return (
        <div className="grid gap-3 px-5 pb-4" style={{ gridTemplateColumns: colTemplate }}>
          {/* Core KPIs — always shown */}
          {data.revenue
            ? <KpiMetricCard card={data.revenue} />
            : <EmptyKpiCard label="Revenue" />}
          {data.ebitda
            ? <KpiMetricCard card={data.ebitda} />
            : <EmptyKpiCard label="EBITDA" />}
          {data.netIncome
            ? <KpiMetricCard card={data.netIncome} />
            : <EmptyKpiCard label="Net Income" />}

          {/* Optional KPIs — only rendered when data available */}
          {optionalKpis.map(({ card, label }) => (
            <KpiMetricCard key={label} card={card} />
          ))}

          {/* Qualitative insights */}
          {data.growthDriver ? (
            <InsightTextCard
              card={data.growthDriver}
              icon={<Lightbulb className="h-3 w-3" />}
              label="Growth Driver"
              accentClass="text-emerald-600 dark:text-emerald-400"
            />
          ) : (
            <div className="flex flex-col justify-center rounded-xl border border-dashed border-border/50 bg-muted/10 px-4 py-3">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50 mb-1">
                Growth Driver
              </span>
              <p className="text-xs text-muted-foreground/30">Add a growth driver question</p>
            </div>
          )}
          {data.keyRisk ? (
            <InsightTextCard
              card={data.keyRisk}
              icon={<ShieldAlert className="h-3 w-3" />}
              label="Key Risk"
              accentClass="text-amber-500"
            />
          ) : (
            <div className="flex flex-col justify-center rounded-xl border border-dashed border-border/50 bg-muted/10 px-4 py-3">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/50 mb-1">
                Key Risk
              </span>
              <p className="text-xs text-muted-foreground/30">Add a risk question</p>
            </div>
          )}
        </div>
        );
      })()}
    </div>
  );
}
