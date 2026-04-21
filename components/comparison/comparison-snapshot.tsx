"use client";

/**
 * Comparison Snapshot
 *
 * Top-of-page summary bar for Comparison Mode.
 * Shows top performer, margin gap, most divergent metric,
 * confidence range, and comparability warnings.
 * Pure derived data — no model calls.
 */

import { useMemo, useState } from "react";
import {
  TrendingUp,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Trophy,
  Gauge,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildComparisonSnapshot,
  buildEntityDocMap,
} from "@/lib/intelligence/comparison";
import { ComparabilityBadge } from "./comparability-badge";
import { EntityBadge } from "./entity-manager";
import type { ComparisonEntityRow, DocumentRow, MatrixQuestionRow, MatrixAnswerWithCitations } from "@/types";
import type { MetricComparison } from "@/lib/intelligence/comparison";

interface ComparisonSnapshotProps {
  entities: ComparisonEntityRow[];
  documents: DocumentRow[];
  questions: MatrixQuestionRow[];
  answersMap: Record<string, MatrixAnswerWithCitations>;
}

export function ComparisonSnapshot({
  entities,
  documents,
  questions,
  answersMap,
}: ComparisonSnapshotProps) {
  const [collapsed, setCollapsed] = useState(false);

  const snapshot = useMemo(() => {
    if (entities.length < 2) return null;
    const entityDocMap = buildEntityDocMap(entities, documents);
    return buildComparisonSnapshot(entities, entityDocMap, questions, answersMap);
  }, [entities, documents, questions, answersMap]);

  if (!snapshot) return null;

  const leaderEntity = snapshot.topPerformerRevenue
    ? entities.find((e) => e.label === snapshot.topPerformerRevenue)
    : null;

  const hasData =
    snapshot.metricComparisons.some((mc) => mc.ranked.length > 0);

  return (
    <div className="mx-4 mb-2 rounded-xl border border-border bg-card/60 overflow-hidden">
      {/* Header */}
      <button
        className="flex w-full items-center gap-3 px-4 py-3 hover:bg-muted/20 transition-colors"
        onClick={() => setCollapsed((v) => !v)}
      >
        <Zap className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-semibold text-foreground flex-1 text-left">
          Comparison Snapshot
        </span>
        <span className="text-[11px] text-muted-foreground">
          {entities.length} entities compared
        </span>
        {collapsed ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground/50" />
        )}
      </button>

      {!collapsed && (
        <div className="border-t border-border/60 px-4 py-3 space-y-3">
          {/* No data state */}
          {!hasData && (
            <p className="text-xs text-muted-foreground/60">
              Run the comparison matrix to populate insights.
            </p>
          )}

          {hasData && (
            <>
              {/* KPI tiles */}
              <div className="grid grid-cols-3 gap-3">
                {/* Top performer */}
                <SnapshotTile
                  icon={<Trophy className="h-3.5 w-3.5 text-amber-400" />}
                  label="Top Performer (Revenue)"
                  value={
                    leaderEntity ? (
                      <EntityBadge entity={leaderEntity} />
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )
                  }
                />

                {/* Margin gap */}
                <SnapshotTile
                  icon={<Gauge className="h-3.5 w-3.5 text-violet-400" />}
                  label="EBITDA Margin Gap"
                  value={
                    snapshot.maxMarginGapFormatted ? (
                      <span className="text-sm font-bold text-foreground">
                        {snapshot.maxMarginGapFormatted}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )
                  }
                />

                {/* Most divergent */}
                <SnapshotTile
                  icon={<TrendingUp className="h-3.5 w-3.5 text-blue-400" />}
                  label="Most Divergent"
                  value={
                    snapshot.mostDivergentMetric ? (
                      <div className="space-y-0.5">
                        <p className="text-xs font-semibold text-foreground">
                          {snapshot.mostDivergentMetric.metricName}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {snapshot.mostDivergentMetric.spreadPct?.toFixed(0)}% spread
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )
                  }
                />
              </div>

              {/* Ranked metric table (top 3 metrics with data) */}
              {snapshot.metricComparisons.filter((m) => m.ranked.length >= 2).length > 0 && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 mb-2">
                    Metric Rankings
                  </p>
                  <div className="space-y-1.5">
                    {snapshot.metricComparisons
                      .filter((m) => m.ranked.length >= 2)
                      .slice(0, 4)
                      .map((mc) => (
                        <MetricRankRow key={mc.canonicalType} mc={mc} entities={entities} />
                      ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Warnings */}
          {snapshot.warnings.length > 0 && (
            <div className="space-y-1">
              {snapshot.warnings.map((w, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2"
                >
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-amber-400/90">{w.message}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SnapshotTile({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-background/50 px-3 py-2.5 space-y-1.5">
      <div className="flex items-center gap-1.5">
        {icon}
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      </div>
      {value}
    </div>
  );
}

interface MetricRankRowProps {
  mc: MetricComparison;
  entities: ComparisonEntityRow[];
}

function MetricRankRow({ mc, entities }: MetricRankRowProps) {
  const rankingBlocked =
    mc.comparabilityResult?.currencyMismatch ?? false;

  return (
    <div className="flex items-start gap-2 rounded-lg px-3 py-2 bg-muted/20">
      {/* Metric name */}
      <span className="w-32 shrink-0 text-[11px] font-semibold text-foreground truncate pt-0.5">
        {mc.metricName}
      </span>

      {/* Ranked values */}
      <div className="flex flex-1 flex-wrap gap-2">
        {mc.ranked.map((r, i) => {
          const entity = entities.find((e) => e.id === r.entityId);
          // Show currency + period badges inline per value
          const currencyLabel = r.currencyInfo?.code;
          const periodLabel = r.periodInfo
            ? (r.periodInfo.year ? `FY${String(r.periodInfo.year).slice(-2)}` : "")
            : "";

          return (
            <div key={r.entityId} className="flex items-center gap-1">
              {entity && <EntityDot color={entity.color} />}
              <span
                className={cn(
                  "text-[11px] tabular-nums font-medium",
                  rankingBlocked
                    ? "text-muted-foreground"
                    : i === 0 ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {r.formatted}
              </span>
              {!rankingBlocked && i === 0 && mc.ranked.length > 1 && (
                <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 rounded px-1 py-px">
                  #1
                </span>
              )}
              {/* Inline currency label when currencies differ */}
              {rankingBlocked && currencyLabel && (
                <span className="text-[9px] text-blue-400/80 font-semibold">
                  {currencyLabel}
                </span>
              )}
              {periodLabel && (
                <span className="text-[9px] text-muted-foreground/50">
                  {periodLabel}
                </span>
              )}
            </div>
          );
        })}

        {mc.missing.length > 0 && (
          <span className="text-[10px] text-muted-foreground/50 pt-0.5">
            {mc.missing.join(", ")}: —
          </span>
        )}
      </div>

      {/* Rich comparability badge from comparabilityResult */}
      {mc.comparabilityResult && mc.comparabilityResult.status !== "comparable" && (
        <ComparabilityBadge
          status={mc.comparabilityResult.status}
          reason={mc.comparabilityResult.reason}
          className="shrink-0"
        />
      )}
    </div>
  );
}

function EntityDot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2 w-2 rounded-full shrink-0"
      style={{ backgroundColor: color }}
    />
  );
}
