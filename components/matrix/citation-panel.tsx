"use client";

import { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  X,
  FileText,
  Quote,
  BarChart2,
  TrendingUp,
  TrendingDown,
  CheckCheck,
  AlertTriangle,
  Database,
  Layers,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { getConfidenceLevel, formatCurrency } from "@/lib/utils";
import { parseCellDisplayData, isLimitedInsight, SOURCE_LABEL, SOURCE_COLOR_CLASS } from "@/lib/intelligence/cell-display";
import { AnswerDetailsTab, parseAnswerDetails } from "./answer-details-tab";
import { useMatrixMode } from "@/lib/matrix-mode-context";
import type { SelectedCell, CellPanelTab, ExtractedMetricRow } from "@/types";

interface CitationPanelProps {
  cell: SelectedCell | null;
  metrics: ExtractedMetricRow[];
  onClose: () => void;
}

// ─── Contradiction types (mirrors execute route metadata shape) ───────────────

interface ConflictEvidence {
  source_file_type: string;
  metric_name: string;
  value: number | null;
  unit: string | null;
  confidence: number;
}

interface ConflictEntry {
  canonical_type: string;
  period: string | null;
  classification: string;
  reference_value: number | null;
  reference_unit: string | null;
  max_variance_pct: number | null;
  notes: string;
  evidence: ConflictEvidence[];
}

export function CitationPanel({ cell, metrics, onClose }: CitationPanelProps) {
  const mode = useMatrixMode();
  const [activeTab, setActiveTab] = useState<CellPanelTab>("answer");

  // Reset to "answer" tab when switching away from analyst mode (analyst-only tabs vanish)
  useEffect(() => {
    if (mode === "executive" && (activeTab === "sources" || activeTab === "details")) {
      setActiveTab("answer");
    }
  }, [mode, activeTab]);

  const isOpen = !!cell;
  const answer = cell?.answer;
  const citations = answer?.citations ?? [];

  const confidenceLevel = answer?.confidence_score
    ? getConfidenceLevel(answer.confidence_score)
    : null;

  const confidenceBadgeVariant =
    confidenceLevel === "high"
      ? "success"
      : confidenceLevel === "medium"
      ? "warning"
      : "danger";

  // Build chart data from metrics
  const chartData = metrics
    .filter((m) => m.value !== null && m.document_id === cell?.documentId)
    .slice(0, 8)
    .map((m) => ({
      name:
        m.metric_name.length > 14
          ? m.metric_name.slice(0, 14) + "…"
          : m.metric_name,
      value: m.value!,
      period: m.period ?? "",
    }));

  return (
    <Sheet open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl flex flex-col p-0"
      >
        {/* Header */}
        <SheetHeader className="px-5 pt-5 pb-4 border-b border-border">
          <div className="flex items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <SheetTitle className="text-sm font-semibold text-muted-foreground mb-1">
                {cell?.document.name ?? ""}
              </SheetTitle>
              <p className="text-base font-semibold text-foreground leading-snug">
                {cell?.question.question_text ?? ""}
              </p>
            </div>
            <button
              onClick={onClose}
              className="mt-0.5 shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Metadata row */}
          {answer && (() => {
            const sig = parseCellDisplayData(
              answer.metadata as Record<string, unknown> | null | undefined,
              cell?.question.question_text ?? "",
              null,
            ).signals;
            return (
              <div className="flex items-center gap-2 mt-3 flex-wrap">
                {answer.confidence_score !== null && (
                  <Badge variant={confidenceBadgeVariant}>
                    {answer.confidence_score}% confidence
                  </Badge>
                )}

                {/* Executive: show conflict only (data integrity) */}
                {mode === "executive" && sig.hasConflict && (
                  <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700">
                    <AlertTriangle className="h-3 w-3" />
                    Conflicting Signals
                  </Badge>
                )}

                {/* Analyst: show all signals */}
                {mode === "analyst" && (
                  <>
                    {sig.isGroundTruth && (
                      <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-300 dark:text-emerald-400 dark:border-emerald-700">
                        <Database className="h-3 w-3" />
                        Ground Truth
                      </Badge>
                    )}
                    {sig.isMultiSourceConfirmed && (
                      <Badge variant="outline" className="gap-1 text-emerald-600 border-emerald-300 dark:text-emerald-400 dark:border-emerald-700">
                        <CheckCheck className="h-3 w-3" />
                        Multi-source
                      </Badge>
                    )}
                    {sig.hasConflict && (
                      <Badge variant="outline" className="gap-1 text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700">
                        <AlertTriangle className="h-3 w-3" />
                        Conflicting Signals
                      </Badge>
                    )}
                    {sig.hasVariance && !sig.hasConflict && (
                      <Badge variant="outline" className="text-amber-500 border-amber-200 dark:border-amber-800">
                        Variance
                      </Badge>
                    )}
                    {sig.hasDerived && (
                      <Badge variant="outline" className="text-violet-600 border-violet-300 dark:text-violet-400 dark:border-violet-700">
                        Derived
                      </Badge>
                    )}
                    {sig.primarySources.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {sig.primarySources.map((s) => SOURCE_LABEL[s] ?? s.toUpperCase()).join(" · ")}
                      </span>
                    )}
                    {citations.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {citations.length} citation{citations.length !== 1 ? "s" : ""}
                      </span>
                    )}
                    {answer.processing_time_ms && (
                      <span className="text-xs text-muted-foreground">
                        {answer.processing_time_ms}ms
                      </span>
                    )}
                  </>
                )}
              </div>
            );
          })()}
        </SheetHeader>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as CellPanelTab)}
          className="flex flex-col flex-1 min-h-0"
        >
          <TabsList className="mx-5 mt-3 mb-0 w-auto self-start bg-muted/50 flex-wrap gap-0.5">
            <TabsTrigger value="answer" className="gap-1.5 text-xs">
              <FileText className="h-3.5 w-3.5" />
              Answer
            </TabsTrigger>
            {/* Sources and Details only visible in Analyst mode */}
            {mode === "analyst" && (
              <TabsTrigger value="sources" className="gap-1.5 text-xs">
                <Quote className="h-3.5 w-3.5" />
                Sources ({citations.length})
              </TabsTrigger>
            )}
            <TabsTrigger value="metrics" className="gap-1.5 text-xs">
              <BarChart2 className="h-3.5 w-3.5" />
              Metrics
            </TabsTrigger>
            <TabsTrigger value="charts" className="gap-1.5 text-xs">
              <TrendingUp className="h-3.5 w-3.5" />
              Charts
            </TabsTrigger>
            {mode === "analyst" && (
              <TabsTrigger value="details" className="gap-1.5 text-xs">
                <Layers className="h-3.5 w-3.5" />
                Details
              </TabsTrigger>
            )}
          </TabsList>

          {/* Answer tab */}
          <TabsContent value="answer" className="flex-1 min-h-0 m-0">
            <ScrollArea className="h-full px-5 py-4">
              {answer?.answer_text || answer?.metadata ? (() => {
                const meta = answer.metadata as Record<string, unknown> | null | undefined;
                const factors = meta?.confidence_factors as Record<string, unknown> | undefined;
                const contradictions = meta?.contradictions as Array<Record<string, unknown>> | undefined;
                const display = parseCellDisplayData(meta, cell?.question.question_text ?? "", answer.answer_text);

                // ── confidence breakdown values ──────────────────────────────
                const groundTruthCount = (meta?.ground_truth_count as number | undefined) ?? 0;
                const structuredCount = (meta?.structured_metrics_count as number | undefined) ?? 0;
                const distinctSources = (factors?.distinctSourceCount as number | undefined) ?? 1;
                const conflictCount = (meta?.conflict_count as number | undefined) ?? 0;
                const derivedCount = (meta?.derived_metrics_count as number | undefined) ?? 0;
                const contradictionClass = (factors?.contradictionClass as string | undefined) ?? "";
                const retrievalHits = (factors?.retrievalHitCount as number | undefined) ?? 0;

                const dataQuality = groundTruthCount > 0 ? 100 : structuredCount > 0 ? 75 : 40;
                const sourceAgreement = contradictionClass === "consistent" ? 100
                  : contradictionClass === "minor_variance" ? 70
                  : contradictionClass === "conflict" ? 20 : 50;
                const sourceCoverage = Math.min(100, distinctSources * 40 + Math.min(retrievalHits, 6) * 5);

                return (
                  <div className="space-y-4">

                    {/* ── Metric card — shown for financial, comparison, and analytical ── */}
                    {display.metric && display.questionType !== "qualitative" && (
                      <div className="rounded-xl border border-border bg-card p-4">
                        {/* Top row: label + badges */}
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div>
                            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              {display.metric.primaryLabel}
                              {display.metric.isAdjusted && <span className="ml-1.5 text-muted-foreground/50 normal-case tracking-normal font-normal">adjusted</span>}
                              {display.metric.isGuidance && <span className="ml-1.5 text-muted-foreground/50 normal-case tracking-normal font-normal">guidance</span>}
                            </p>
                            {display.metric.period && (
                              <p className="text-[10px] text-muted-foreground/50 mt-0.5">{display.metric.period}</p>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap justify-end">
                            <span className={`rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest ${SOURCE_COLOR_CLASS[display.metric.sourceType] ?? "bg-muted text-muted-foreground border-border"}`}>
                              {SOURCE_LABEL[display.metric.sourceType] ?? display.metric.sourceType.toUpperCase()}
                            </span>
                            {display.signals.isGroundTruth && (
                              <span className="flex items-center gap-0.5 rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
                                <Database className="h-2.5 w-2.5" />
                                ground truth
                              </span>
                            )}
                            {display.signals.isMultiSourceConfirmed && (
                              <span className="flex items-center gap-0.5 rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
                                <CheckCheck className="h-2.5 w-2.5" />
                                multi-source
                              </span>
                            )}
                            {display.signals.hasDerived && (
                              <span className="rounded border border-violet-200 dark:border-violet-800 bg-violet-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-violet-600 dark:text-violet-400">
                                derived
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Primary value */}
                        <p className="text-3xl font-bold tracking-tight text-foreground tabular-nums mb-1">
                          {display.metric.primaryValue}
                        </p>

                        {/* Supporting + conflict */}
                        <div className="flex items-center gap-3 flex-wrap">
                          {display.metric.supportingLabel && (
                            <span className={`flex items-center gap-0.5 text-sm font-medium ${
                              display.metric.supportingPositive === false ? "text-red-400"
                              : display.metric.supportingPositive === true ? "text-emerald-500"
                              : "text-muted-foreground"
                            }`}>
                              {display.metric.supportingPositive === true && <TrendingUp className="h-3.5 w-3.5" />}
                              {display.metric.supportingPositive === false && <TrendingDown className="h-3.5 w-3.5" />}
                              {display.metric.supportingLabel}
                            </span>
                          )}
                          {display.signals.hasConflict && display.metric.conflictValue && (
                            <span className="flex items-center gap-1 text-xs text-amber-500">
                              <AlertTriangle className="h-3 w-3" />
                              {SOURCE_LABEL[display.metric.conflictSourceType ?? ""] ?? "Other"} reports {display.metric.conflictValue}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {/* ── Conflicting signals breakdown ──────────────────── */}
                    {display.signals.hasConflict && contradictions && contradictions.length > 0 && (
                      <ConflictingSignalsPanel
                        contradictions={contradictions as unknown as ConflictEntry[]}
                      />
                    )}

                    {/* ── Analysis text ──────────────────────────────────── */}
                    {answer.answer_text && (
                      isLimitedInsight(answer.answer_text, answer.confidence_score)
                        ? <LimitedInsightsPanel />
                        : (
                          <div className="space-y-1.5">
                            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                              Analysis
                            </p>
                            <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
                              {answer.answer_text}
                            </p>
                          </div>
                        )
                    )}

                    {/* ── Confidence breakdown — analyst mode only ──────── */}
                    {mode === "analyst" && answer.confidence_score !== null && (
                      <div className="space-y-2 pt-1">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                          Confidence
                        </p>
                        <ConfidenceBar label="Data quality" value={dataQuality} />
                        <ConfidenceBar label="Source agreement" value={sourceAgreement} />
                        <ConfidenceBar label="Source coverage" value={sourceCoverage} />

                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {groundTruthCount > 0 && (
                            <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                              {groundTruthCount} ground-truth
                            </span>
                          )}
                          {distinctSources > 1 && (
                            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                              {distinctSources} source types
                            </span>
                          )}
                          {derivedCount > 0 && (
                            <span className="rounded-full bg-violet-500/10 px-2 py-0.5 text-[10px] font-medium text-violet-600 dark:text-violet-400">
                              {derivedCount} derived
                            </span>
                          )}
                          {conflictCount > 0 && (
                            <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                              {conflictCount} conflict{conflictCount !== 1 ? "s" : ""}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                  </div>
                );
              })() : (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No answer available. Run this cell to generate an answer.
                </p>
              )}
            </ScrollArea>
          </TabsContent>

          {/* Sources tab */}
          <TabsContent value="sources" className="flex-1 min-h-0 m-0">
            <ScrollArea className="h-full px-5 py-4">
              {citations.length > 0 ? (
                <div className="space-y-3">
                  {citations.map((citation, index) => (
                    <div
                      key={citation.id}
                      className="rounded-lg border border-border bg-card p-4 space-y-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                            {index + 1}
                          </span>
                          {citation.page_number && (
                            <span className="text-xs text-muted-foreground">
                              Page {citation.page_number}
                            </span>
                          )}
                          {citation.section_title && (
                            <>
                              <span className="text-muted-foreground/30">·</span>
                              <span className="text-xs text-muted-foreground truncate max-w-[180px]">
                                {citation.section_title}
                              </span>
                            </>
                          )}
                        </div>
                        <Badge variant="outline" className="text-[10px]">
                          {Math.round(citation.relevance_score * 100)}% match
                        </Badge>
                      </div>

                      <Separator />

                      <blockquote className="text-xs text-foreground/80 leading-relaxed italic border-l-2 border-primary/30 pl-3">
                        &ldquo;{citation.citation_text}&rdquo;
                      </blockquote>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                  <Quote className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    No source citations available
                  </p>
                  <p className="text-xs text-muted-foreground/60">
                    Run this cell to generate cited answers
                  </p>
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* Metrics tab */}
          <TabsContent value="metrics" className="flex-1 min-h-0 m-0">
            <ScrollArea className="h-full px-5 py-4">
              {metrics.filter((m) => m.document_id === cell?.documentId).length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground mb-3">
                    Extracted from{" "}
                    <span className="font-medium text-foreground">
                      {cell?.document.name}
                    </span>
                  </p>
                  {metrics
                    .filter((m) => m.document_id === cell?.documentId)
                    .map((metric) => (
                      <div
                        key={metric.id}
                        className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-2.5"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {metric.metric_name}
                          </p>
                          {metric.period && (
                            <p className="text-xs text-muted-foreground">
                              {metric.period}{" "}
                              {metric.period_type
                                ? `(${metric.period_type.toUpperCase()})`
                                : ""}
                            </p>
                          )}
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-bold text-foreground">
                            {metric.value !== null
                              ? metric.unit === "$"
                                ? formatCurrency(metric.value)
                                : metric.unit === "%"
                                ? `${metric.value}%`
                                : `${metric.value}${metric.unit ? " " + metric.unit : ""}`
                              : "N/A"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {metric.confidence}% conf.
                          </p>
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                  <BarChart2 className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    No structured metrics extracted
                  </p>
                  <p className="text-xs text-muted-foreground/60">
                    Metrics are extracted during document ingestion
                  </p>
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* Charts tab */}
          <TabsContent value="charts" className="flex-1 min-h-0 m-0">
            <ScrollArea className="h-full px-5 py-4">
              {chartData.length > 0 ? (
                <div className="space-y-6">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-3">
                      Financial Metrics — {cell?.document.name}
                    </p>
                    <div className="h-52 w-full rounded-lg border border-border bg-card p-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={chartData}
                          margin={{ top: 4, right: 8, bottom: 4, left: 8 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            stroke="hsl(var(--border))"
                            vertical={false}
                          />
                          <XAxis
                            dataKey="name"
                            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                            axisLine={false}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(v) => formatCurrency(v)}
                          />
                          <RechartsTooltip
                            contentStyle={{
                              backgroundColor: "hsl(var(--card))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: "8px",
                              fontSize: "12px",
                              color: "hsl(var(--foreground))",
                            }}
                            formatter={(value: number) => [
                              formatCurrency(value),
                              "Value",
                            ]}
                          />
                          <Bar
                            dataKey="value"
                            fill="hsl(var(--primary))"
                            radius={[4, 4, 0, 0]}
                            fillOpacity={0.85}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                  <TrendingUp className="h-8 w-8 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">
                    No chart data available
                  </p>
                  <p className="text-xs text-muted-foreground/60">
                    Charts are generated from extracted financial metrics
                  </p>
                </div>
              )}
            </ScrollArea>
          </TabsContent>
          {/* Details tab */}
          <TabsContent value="details" className="flex-1 min-h-0 m-0">
            <ScrollArea className="h-full">
              <AnswerDetailsTab
                data={parseAnswerDetails(
                  answer?.metadata as Record<string, unknown> | null | undefined,
                  answer?.confidence_score ?? null,
                )}
              />
            </ScrollArea>
          </TabsContent>

        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// ─── Conflicting Signals Panel ────────────────────────────────────────────────

function ConflictingSignalsPanel({ contradictions }: { contradictions: ConflictEntry[] }) {
  const relevant = contradictions
    .filter((c) => c.classification === "conflict" || c.classification === "minor_variance")
    .slice(0, 3);

  if (relevant.length === 0) return null;

  return (
    <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-500/5 p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        <p className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wide">
          Different Source Perspectives
        </p>
      </div>

      {/* Per-metric breakdown */}
      <div className="space-y-3">
        {relevant.map((c, i) => (
          <div key={i} className="space-y-1.5">
            {/* Metric label + period + variance */}
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-semibold text-foreground capitalize">
                {String(c.canonical_type).replace(/_/g, " ")}
              </span>
              {c.period && (
                <span className="text-[10px] text-muted-foreground">({c.period})</span>
              )}
              {c.max_variance_pct != null && (
                <span className="ml-auto shrink-0 text-[10px] font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                  {Math.round(c.max_variance_pct)}% apart
                </span>
              )}
            </div>

            {/* Per-source evidence rows */}
            <div className="space-y-1 pl-1">
              {c.evidence.slice(0, 3).map((e, j) => (
                <div key={j} className="flex items-center gap-2">
                  <span className={`shrink-0 rounded border px-1 py-px text-[9px] font-bold uppercase tracking-widest ${SOURCE_COLOR_CLASS[e.source_file_type] ?? "bg-muted text-muted-foreground border-border"}`}>
                    {SOURCE_LABEL[e.source_file_type] ?? e.source_file_type.toUpperCase()}
                  </span>
                  <span className="text-xs font-semibold tabular-nums text-foreground">
                    {e.value != null
                      ? `${e.value}${e.unit ? ` ${e.unit}` : ""}`
                      : "N/A"}
                  </span>
                  <span className="text-[10px] text-muted-foreground/70 truncate">
                    {e.metric_name}
                  </span>
                </div>
              ))}
            </div>

            {/* Separator between entries (not after last) */}
            {i < relevant.length - 1 && (
              <div className="border-t border-amber-200/40 dark:border-amber-800/40 pt-1" />
            )}
          </div>
        ))}
      </div>

      {/* Interpretation hint */}
      <p className="text-[10px] text-amber-700/70 dark:text-amber-300/60 italic border-t border-amber-200/50 dark:border-amber-800/50 pt-3">
        Sources may reflect different business segments, reporting periods, or accounting methods.
        Review the originating documents before relying on a single figure.
      </p>
    </div>
  );
}

function LimitedInsightsPanel() {
  return (
    <div className="rounded-xl border border-amber-200/30 dark:border-amber-800/30 bg-amber-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
        <span className="text-sm font-semibold text-amber-500">
          Limited Insights Available
        </span>
      </div>
      <p className="text-sm text-muted-foreground leading-relaxed">
        This workspace does not contain sufficient structured or contextual
        data to generate meaningful analysis for this question.
      </p>
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60">
          Try adding
        </p>
        <ul className="space-y-1.5">
          {[
            "Financial statements",
            "Earnings reports",
            "Supporting documents",
          ].map((item) => (
            <li key={item} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40 shrink-0" />
              <span className="text-sm text-muted-foreground/70">{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ConfidenceBar({ label, value }: { label: string; value: number }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium text-foreground">{Math.round(value)}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            value >= 80
              ? "bg-emerald-500"
              : value >= 50
              ? "bg-amber-500"
              : "bg-red-500"
          }`}
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
