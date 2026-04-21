"use client";

/**
 * Answer Details Tab — structured breakdown of intelligence metadata
 * from matrix_answers.metadata.
 *
 * Sections:
 *  1. Best Metrics          — highest-ranked metric per canonical type
 *  2. Derived Metrics       — calculated values with formulas
 *  3. Source Ranking        — file types used, priority-ordered
 *  4. Contradictions        — conflicts/variances between sources
 *  5. Confidence Factors    — per-factor contribution to the final score
 */

import { CheckCircle2, XCircle, AlertTriangle, FlaskConical, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatKpiValue } from "@/lib/intelligence/executive-summary";
import { SOURCE_COLOR_CLASS, SOURCE_LABEL } from "@/lib/intelligence/cell-display";

// ─── Metadata shapes from execute route ──────────────────────────────────────

interface BestMetric {
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

interface DerivedMetric {
  canonical_type: string;
  metric_name: string;
  value: number | null;
  unit: string | null;
  period: string | null;
  formula: string | null;
  confidence: number;
}

interface ContradictionEvidence {
  source_file_type: string;
  metric_name: string;
  value: number | null;
  unit: string | null;
  confidence: number;
}

interface Contradiction {
  canonical_type: string;
  period: string | null;
  classification: "conflict" | "minor_variance" | "consistent" | "insufficient_evidence";
  reference_value: number | null;
  reference_unit: string | null;
  max_variance_pct: number | null;
  notes: string;
  evidence: ContradictionEvidence[];
}

interface ConfidenceFactors {
  hasGroundTruthMetrics: boolean;
  hasHighConfidenceStructured: boolean;
  contradictionClass: string;
  distinctSourceCount: number;
  hasDerivedMetrics: boolean;
  periodMismatch: boolean;
  mixesActualAndGuidance: boolean;
  retrievalHitCount: number;
  modelRawConfidence: number;
}

export interface AnswerDetailsData {
  bestMetrics: BestMetric[];
  derivedMetrics: DerivedMetric[];
  contradictions: Contradiction[];
  confidenceFactors: ConfidenceFactors | null;
  primarySources: string[];
  groundTruthCount: number;
  finalScore: number | null;
}

// ─── Parse metadata ───────────────────────────────────────────────────────────

export function parseAnswerDetails(
  metadata: Record<string, unknown> | null | undefined,
  confidenceScore: number | null,
): AnswerDetailsData {
  if (!metadata) {
    return {
      bestMetrics: [], derivedMetrics: [], contradictions: [],
      confidenceFactors: null, primarySources: [],
      groundTruthCount: 0, finalScore: confidenceScore,
    };
  }

  return {
    bestMetrics: (metadata.best_metrics as BestMetric[] | undefined) ?? [],
    derivedMetrics: (metadata.derived_metrics as DerivedMetric[] | undefined) ?? [],
    contradictions: (metadata.contradictions as Contradiction[] | undefined) ?? [],
    confidenceFactors: (metadata.confidence_factors as ConfidenceFactors | undefined) ?? null,
    primarySources: (metadata.primary_sources as string[] | undefined) ?? [],
    groundTruthCount: (metadata.ground_truth_count as number | undefined) ?? 0,
    finalScore: confidenceScore,
  };
}

// ─── Shared small components ──────────────────────────────────────────────────

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground mb-2">
      {children}
    </p>
  );
}

function SourceChip({ sourceType }: { sourceType: string }) {
  return (
    <span className={cn(
      "rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest",
      SOURCE_COLOR_CLASS[sourceType] ?? "bg-muted text-muted-foreground border-border"
    )}>
      {SOURCE_LABEL[sourceType] ?? sourceType.toUpperCase()}
    </span>
  );
}

function ConfBadge({ value }: { value: number }) {
  return (
    <span className={cn(
      "rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
      value >= 80
        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
        : value >= 50
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "bg-red-500/10 text-red-500"
    )}>
      {value}%
    </span>
  );
}

// ─── Section 1: Best Metrics ──────────────────────────────────────────────────

function BestMetricsSection({ metrics }: { metrics: BestMetric[] }) {
  const withValues = metrics.filter((m) => m.value !== null);

  if (withValues.length === 0) {
    return (
      <div>
        <SectionHeading>Best Metrics</SectionHeading>
        <p className="text-xs text-muted-foreground/50 italic">No structured metrics found</p>
      </div>
    );
  }

  return (
    <div>
      <SectionHeading>Best Metrics</SectionHeading>
      <div className="space-y-2">
        {withValues.map((m, i) => (
          <div key={i} className="rounded-lg border border-border bg-card px-3 py-2.5">
            <div className="flex items-start justify-between gap-2 mb-1">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate">
                  {m.metric_name}
                  {m.is_adjusted && <span className="ml-1 font-normal normal-case text-muted-foreground/50">adj.</span>}
                  {m.is_guidance && <span className="ml-1 font-normal normal-case text-muted-foreground/50">guidance</span>}
                </p>
                {m.period && (
                  <p className="text-[9px] text-muted-foreground/40">{m.period}</p>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <SourceChip sourceType={m.source_file_type} />
                <ConfBadge value={m.confidence} />
              </div>
            </div>
            <p className="text-lg font-bold tabular-nums text-foreground leading-none">
              {formatKpiValue(m.value!, m.unit)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Section 2: Derived Metrics ───────────────────────────────────────────────

function DerivedMetricsSection({ metrics }: { metrics: DerivedMetric[] }) {
  const withValues = metrics.filter((m) => m.value !== null);

  if (withValues.length === 0) return null;

  return (
    <div>
      <SectionHeading>Derived Metrics</SectionHeading>
      <div className="space-y-2">
        {withValues.map((m, i) => (
          <div key={i} className="rounded-lg border border-violet-200/50 dark:border-violet-900/50 bg-violet-500/5 px-3 py-2.5">
            <div className="flex items-start justify-between gap-2 mb-1">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400 truncate">
                {m.metric_name}
              </p>
              {m.period && (
                <p className="text-[9px] text-muted-foreground/40 shrink-0">{m.period}</p>
              )}
            </div>
            <p className="text-lg font-bold tabular-nums text-foreground leading-none mb-1">
              {formatKpiValue(m.value!, m.unit)}
            </p>
            {m.formula && (
              <div className="flex items-center gap-1.5 mt-1">
                <FlaskConical className="h-2.5 w-2.5 text-violet-400 shrink-0" />
                <code className="text-[10px] text-violet-600 dark:text-violet-400 font-mono">
                  = {m.formula}
                </code>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Section 3: Source Ranking ────────────────────────────────────────────────

const SOURCE_TIERS = [
  { types: ["csv", "xlsx"], label: "Structured Data", tier: "Ground Truth", priority: 100, barWidth: "100%" },
  { types: ["pdf"],         label: "Document",        tier: "Secondary",    priority: 70,  barWidth: "70%" },
  { types: ["txt", "transcript"], label: "Narrative", tier: "Tertiary",     priority: 45,  barWidth: "45%" },
];

function SourceRankingSection({ presentSources }: { presentSources: string[] }) {
  return (
    <div>
      <SectionHeading>Source Ranking</SectionHeading>
      <div className="space-y-2">
        {SOURCE_TIERS.map((tier, i) => {
          const isPresent = tier.types.some((t) => presentSources.includes(t));
          const matchingSource = tier.types.find((t) => presentSources.includes(t));
          return (
            <div key={i} className={cn(
              "flex items-center gap-3 rounded-lg border px-3 py-2 transition-colors",
              isPresent
                ? "border-border bg-card"
                : "border-dashed border-border/40 bg-muted/10 opacity-40"
            )}>
              <span className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                isPresent ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
              )}>
                {i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  {matchingSource && <SourceChip sourceType={matchingSource} />}
                  <span className="text-xs font-medium text-foreground">{tier.label}</span>
                  {isPresent && (
                    <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-semibold">used</span>
                  )}
                </div>
                {/* Priority bar */}
                <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      isPresent
                        ? i === 0 ? "bg-emerald-500" : i === 1 ? "bg-blue-500" : "bg-slate-400"
                        : "bg-muted-foreground/20"
                    )}
                    style={{ width: tier.barWidth }}
                  />
                </div>
              </div>
              <span className={cn(
                "text-[10px] font-mono shrink-0",
                isPresent ? "text-muted-foreground" : "text-muted-foreground/30"
              )}>
                P{tier.priority}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Section 4: Contradictions ────────────────────────────────────────────────

const CONFLICT_CLASS_LABEL: Record<string, { label: string; className: string }> = {
  conflict:      { label: "Conflict",       className: "text-red-500 border-red-300 dark:border-red-800 bg-red-500/5" },
  minor_variance:{ label: "Minor Variance", className: "text-amber-500 border-amber-200 dark:border-amber-800 bg-amber-500/5" },
  consistent:    { label: "Consistent",     className: "text-emerald-600 border-emerald-200 dark:border-emerald-800 bg-emerald-500/5" },
};

function ContradictionsSection({ contradictions }: { contradictions: Contradiction[] }) {
  const active = contradictions.filter(
    (c) => c.classification === "conflict" || c.classification === "minor_variance"
  );

  return (
    <div>
      <SectionHeading>Contradictions</SectionHeading>
      {active.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-200/60 dark:border-emerald-900/60 bg-emerald-500/5 px-3 py-2.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
            No conflicts detected across sources
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {active.map((c, i) => {
            const style = CONFLICT_CLASS_LABEL[c.classification] ?? CONFLICT_CLASS_LABEL.conflict;
            return (
              <div key={i} className={cn("rounded-lg border px-3 py-2.5 space-y-2", style.className)}>
                {/* Header */}
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <span className="text-xs font-semibold capitalize">
                      {c.canonical_type.replace(/_/g, " ")}
                    </span>
                    {c.period && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground">· {c.period}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <AlertTriangle className="h-3 w-3" />
                    <span className="text-[10px] font-bold uppercase tracking-wide">{style.label}</span>
                    {c.max_variance_pct != null && (
                      <span className="text-[10px] font-mono">{Math.round(c.max_variance_pct)}% var.</span>
                    )}
                  </div>
                </div>

                {/* Evidence comparison */}
                {c.evidence.length >= 2 && (
                  <div className="grid grid-cols-2 gap-2">
                    {c.evidence.slice(0, 2).map((ev, j) => (
                      <div key={j} className="rounded-md border border-border/50 bg-background/50 px-2.5 py-1.5">
                        <div className="flex items-center gap-1 mb-0.5">
                          <SourceChip sourceType={ev.source_file_type} />
                          <span className="text-[9px] text-muted-foreground">{ev.metric_name}</span>
                        </div>
                        <p className="text-sm font-bold tabular-nums text-foreground">
                          {ev.value != null
                            ? formatKpiValue(ev.value, ev.unit)
                            : "N/A"}
                        </p>
                        <p className="text-[9px] text-muted-foreground">{ev.confidence}% conf.</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Section 5: Confidence Factor Breakdown ───────────────────────────────────

interface FactorRow {
  label: string;
  status: string;
  delta: number | null;   // point contribution (positive = boost, negative = penalty, null = n/a
  isPositive: boolean | null;
}

function buildFactorRows(f: ConfidenceFactors): FactorRow[] {
  const retrieval =
    f.retrievalHitCount >= 6 ? { label: `${f.retrievalHitCount} chunks`, pts: 20 }
    : f.retrievalHitCount >= 3 ? { label: `${f.retrievalHitCount} chunks`, pts: 15 }
    : f.retrievalHitCount >= 1 ? { label: `${f.retrievalHitCount} chunks`, pts: 10 }
    : { label: "none", pts: 0 };

  const contradictionBonus: Record<string, { status: string; pts: number }> = {
    consistent: { status: "Consistent", pts: 25 },
    minor_variance: { status: "Minor variance", pts: 5 },
    conflict: { status: "Conflict", pts: -25 },
    insufficient_evidence: { status: "Single source", pts: 10 },
  };
  const agr = contradictionBonus[f.contradictionClass] ?? { status: f.contradictionClass, pts: 0 };

  const extraSources = Math.min(f.distinctSourceCount - 1, 3);

  return [
    {
      label: "Ground-truth metrics (CSV)",
      status: f.hasGroundTruthMetrics ? "Yes" : f.hasHighConfidenceStructured ? "Structured ≥80%" : "None",
      delta: f.hasGroundTruthMetrics ? 55 : f.hasHighConfidenceStructured ? 30 : 0,
      isPositive: f.hasGroundTruthMetrics || f.hasHighConfidenceStructured,
    },
    {
      label: "Source agreement",
      status: agr.status,
      delta: agr.pts,
      isPositive: agr.pts >= 0,
    },
    {
      label: "Additional source types",
      status: extraSources > 0 ? `${f.distinctSourceCount} types` : "1 source",
      delta: extraSources * 5,
      isPositive: extraSources > 0,
    },
    {
      label: "Derived metrics",
      status: f.hasDerivedMetrics ? "Present" : "None",
      delta: f.hasDerivedMetrics ? 3 : 0,
      isPositive: f.hasDerivedMetrics || null,
    },
    {
      label: "Retrieval coverage",
      status: retrieval.label,
      delta: retrieval.pts,
      isPositive: retrieval.pts > 0,
    },
    {
      label: "Period mismatch",
      status: f.periodMismatch ? "Yes" : "No",
      delta: f.periodMismatch ? -15 : null,
      isPositive: f.periodMismatch ? false : null,
    },
    {
      label: "Guidance vs. actuals mix",
      status: f.mixesActualAndGuidance ? "Yes" : "No",
      delta: f.mixesActualAndGuidance ? -10 : null,
      isPositive: f.mixesActualAndGuidance ? false : null,
    },
  ];
}

function ConfidenceFactorsSection({
  factors,
  finalScore,
}: {
  factors: ConfidenceFactors;
  finalScore: number | null;
}) {
  const rows = buildFactorRows(factors);

  return (
    <div>
      <SectionHeading>Confidence Factors</SectionHeading>
      <div className="rounded-lg border border-border overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-3 py-1.5 bg-muted/40 border-b border-border">
          <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground">Factor</span>
          <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground text-right">Status</span>
          <span className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground text-right w-10">Pts</span>
        </div>

        {/* Rows */}
        {rows.map((row, i) => (
          <div
            key={i}
            className={cn(
              "grid grid-cols-[1fr_auto_auto] gap-2 items-center px-3 py-2 text-xs",
              i % 2 === 0 ? "bg-background" : "bg-muted/20",
              i < rows.length - 1 && "border-b border-border/50"
            )}
          >
            <span className="text-muted-foreground">{row.label}</span>
            <div className="flex items-center gap-1">
              {row.isPositive === true && <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />}
              {row.isPositive === false && <XCircle className="h-2.5 w-2.5 text-red-400" />}
              <span className={cn(
                "text-[10px] font-medium",
                row.isPositive === true ? "text-foreground"
                : row.isPositive === false ? "text-muted-foreground"
                : "text-muted-foreground"
              )}>
                {row.status}
              </span>
            </div>
            <span className={cn(
              "text-right text-[10px] font-mono font-semibold w-10",
              row.delta == null || row.delta === 0 ? "text-muted-foreground/40"
              : row.delta > 0 ? "text-emerald-600 dark:text-emerald-400"
              : "text-red-400"
            )}>
              {row.delta == null || row.delta === 0 ? "—"
              : row.delta > 0 ? `+${row.delta}` : `${row.delta}`}
            </span>
          </div>
        ))}

        {/* Model confidence row */}
        <div className={cn(
          "grid grid-cols-[1fr_auto_auto] gap-2 items-center px-3 py-2 text-xs border-t border-border/50",
          rows.length % 2 === 0 ? "bg-background" : "bg-muted/20"
        )}>
          <span className="text-muted-foreground">Model confidence (35% weight)</span>
          <span className="text-[10px] font-medium text-foreground">{factors.modelRawConfidence}%</span>
          <span className="text-right text-[10px] font-mono text-muted-foreground/40 w-10">blended</span>
        </div>

        {/* Final score */}
        {finalScore !== null && (
          <div className="grid grid-cols-[1fr_auto] gap-2 items-center px-3 py-2.5 bg-primary/5 border-t-2 border-primary/20">
            <span className="text-xs font-bold text-foreground">Calibrated Score</span>
            <span className={cn(
              "text-sm font-bold tabular-nums",
              finalScore >= 80 ? "text-emerald-600 dark:text-emerald-400"
              : finalScore >= 50 ? "text-amber-500"
              : "text-red-500"
            )}>
              {finalScore}%
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function AnswerDetailsTab({
  data,
}: {
  data: AnswerDetailsData;
}) {
  const hasAnyData = data.bestMetrics.length > 0 || data.derivedMetrics.length > 0 || data.confidenceFactors;

  if (!hasAnyData) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
        <ArrowUpDown className="h-8 w-8 text-muted-foreground/25" />
        <p className="text-sm text-muted-foreground">No intelligence data yet</p>
        <p className="text-xs text-muted-foreground/50">Run this cell to see a detailed breakdown</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 px-5 py-4">
      <BestMetricsSection metrics={data.bestMetrics} />
      <DerivedMetricsSection metrics={data.derivedMetrics} />
      <SourceRankingSection presentSources={data.primarySources} />
      <ContradictionsSection contradictions={data.contradictions} />
      {data.confidenceFactors && (
        <ConfidenceFactorsSection
          factors={data.confidenceFactors}
          finalScore={data.finalScore}
        />
      )}
    </div>
  );
}
