"use client";

/**
 * Comparison Grid
 *
 * The main matrix view for Comparison Mode.
 *   rows    = comparison entities (companies / periods)
 *   columns = matrix questions
 *   cells   = best answer for that entity × question pair
 *
 * Execution reuses the existing /api/matrix/execute endpoint —
 * "Run All" simply iterates over all (entity's docs × questions) pairs.
 */

import { useState, useCallback, useRef, useMemo } from "react";
import {
  Play,
  Loader2,
  AlertCircle,
  Clock,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AddQuestionDialog } from "@/components/matrix/add-question-dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  getBestEntityAnswer,
  buildEntityDocMap,
  getRankLabel,
} from "@/lib/intelligence/comparison";
import {
  parseCellDisplayData,
  isLimitedInsight,
  SOURCE_LABEL,
  SOURCE_COLOR_CLASS,
} from "@/lib/intelligence/cell-display";
import {
  detectCurrency,
  parsePeriod,
  assessComparability,
  shortPeriodLabel,
} from "@/lib/intelligence/comparability";
import {
  CurrencyBadge,
  PeriodBadge,
  ComparabilityBadge,
  ComparabilityWarningRow,
  ComparabilityPanel,
} from "./comparability-badge";
import { EntityBadge } from "./entity-manager";
import type {
  ComparisonEntityRow,
  DocumentRow,
  MatrixQuestionRow,
  MatrixAnswerWithCitations,
  ExtractedMetricRow,
} from "@/types";

const CONCURRENCY = 3;

interface ComparisonGridProps {
  workspaceId: string;
  entities: ComparisonEntityRow[];
  documents: DocumentRow[];
  questions: MatrixQuestionRow[];
  answersMap: Record<string, MatrixAnswerWithCitations>;
  metrics: ExtractedMetricRow[];
  onAnswerUpdated: (key: string, answer: MatrixAnswerWithCitations) => void;
  onQuestionsChanged: (questions: MatrixQuestionRow[]) => void;
}

interface RunProgress { done: number; total: number }

// ─── Cell states ──────────────────────────────────────────────────────────────

type CellKey = string; // `${docId}:${questionId}`

// ─── Comparison cell ──────────────────────────────────────────────────────────

interface ComparisonCellProps {
  entity: ComparisonEntityRow;
  question: MatrixQuestionRow;
  entityDocs: DocumentRow[];
  answersMap: Record<string, MatrixAnswerWithCitations>;
  allEntitiesCount: number;
  /** Rank of this entity's value for this question (1 = best), null if ranking blocked */
  rank: number | null;
  /** True when numeric ranking is blocked for this column due to currency mismatch */
  rankingBlocked: boolean;
  isRunning: boolean;
  isQueued: boolean;
  /** Non-null when any doc in this entity's cell failed to execute */
  errorMessage: string | null;
  onRun: () => void;
}

function ComparisonCell({
  entity,
  question,
  entityDocs,
  answersMap,
  allEntitiesCount,
  rank,
  rankingBlocked,
  isRunning,
  isQueued,
  errorMessage,
  onRun,
}: ComparisonCellProps) {
  const [showDrillDown, setShowDrillDown] = useState(false);
  const answer = getBestEntityAnswer(entityDocs, question.id, answersMap);

  if (isRunning) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-3">
        <Loader2 className="h-4 w-4 animate-spin text-primary/60" />
        <span className="text-[10px] text-muted-foreground">Analysing…</span>
      </div>
    );
  }

  if (isQueued) {
    return (
      <div className="flex h-full items-center justify-center p-3">
        <Clock className="h-4 w-4 text-muted-foreground/40" />
      </div>
    );
  }

  if (errorMessage) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1.5 p-3">
        <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
        <span className="text-[10px] text-red-400 text-center leading-snug">{errorMessage}</span>
        <button
          onClick={onRun}
          className="mt-1 text-[10px] text-muted-foreground/60 underline hover:text-primary"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!answer) {
    if (entityDocs.length === 0) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-1 p-3">
          <span className="text-[10px] text-muted-foreground/40 text-center">
            No documents
          </span>
        </div>
      );
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-3">
        <button
          onClick={onRun}
          className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-colors"
        >
          <Play className="h-3 w-3" />
          Run
        </button>
      </div>
    );
  }

  if (answer.status === "error") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-3">
        <AlertCircle className="h-4 w-4 text-red-400" />
        <span className="text-[10px] text-red-400">Error</span>
        <button onClick={onRun} className="text-[10px] text-muted-foreground/60 underline">
          Retry
        </button>
      </div>
    );
  }

  if (isLimitedInsight(answer.answer_text, answer.confidence_score)) {
    return (
      <div className="flex h-full flex-col gap-1.5 p-3">
        <span className="text-[10px] font-semibold text-amber-400">Limited Insights</span>
        <span className="text-[10px] text-muted-foreground/60 leading-relaxed">
          Insufficient data for this question.
        </span>
      </div>
    );
  }

  const display = parseCellDisplayData(
    answer.metadata as Record<string, unknown> | null,
    question.question_text,
    answer.answer_text
  );

  const isFinancial = display.mode === "structured" && display.metric != null;

  // ── Derive currency / period from answer metadata ────────────────────────
  const meta = (answer.metadata ?? {}) as Record<string, unknown>;
  const bestMetrics = (meta.best_metrics as Array<Record<string, unknown>> | undefined) ?? [];
  const topMetric = bestMetrics[0];
  const cellUnit = topMetric ? (topMetric.unit as string | null) : null;
  const cellPeriod = topMetric ? (topMetric.period as string | null) : null;
  const currencyInfo = isFinancial ? detectCurrency(cellUnit) : null;
  const periodInfo = parsePeriod(cellPeriod);

  // Build single-item comparability (currency + period labeling for this cell)
  const cellComparability = assessComparability([{
    entityLabel: entity.label,
    currency: currencyInfo,
    period: periodInfo,
  }]);

  const shortPeriod = shortPeriodLabel(periodInfo);

  return (
    <div
      className="group/cell flex h-full flex-col gap-1.5 p-3 cursor-pointer hover:bg-muted/10 transition-colors relative"
      onClick={() => setShowDrillDown((v) => !v)}
    >
      {showDrillDown ? (
        /* ── Drill-down panel ─────────────────────────────────────────────── */
        <div className="flex-1 overflow-y-auto space-y-2">
          <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-widest">
            Source Details
          </p>
          <ComparabilityPanel
            result={cellComparability}
            entityLabels={[entity.label]}
            rawValues={[
              typeof topMetric?.value === "number" ? topMetric.value : null,
            ]}
          />
          {rankingBlocked && (
            <div className="rounded border border-red-500/20 bg-red-500/5 px-2 py-1.5 text-[10px] text-red-400">
              Ranking blocked — currencies differ across entities.
            </div>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); setShowDrillDown(false); }}
            className="text-[10px] text-muted-foreground/50 underline"
          >
            Close
          </button>
        </div>
      ) : isFinancial && display.metric ? (
        <>
          {/* Primary value */}
          <p className={cn(
            "font-bold tabular-nums leading-none tracking-tight text-foreground",
            display.metric.primaryValue.length > 8 ? "text-xl" : "text-2xl"
          )}>
            {display.metric.primaryValue}
          </p>

          {/* Supporting metric + rank */}
          <div className="flex items-center gap-2 flex-wrap">
            {display.metric.supportingLabel && (
              <span className={cn(
                "text-[11px] font-medium",
                display.metric.supportingPositive === false ? "text-red-400"
                  : display.metric.supportingPositive ? "text-emerald-500"
                  : "text-muted-foreground"
              )}>
                {display.metric.supportingLabel}
              </span>
            )}
            {!rankingBlocked && rank != null && allEntitiesCount > 1 && (
              <span className={cn(
                "rounded-full px-1.5 py-0.5 text-[9px] font-bold",
                rank === 1
                  ? "bg-emerald-500/15 text-emerald-400"
                  : rank === allEntitiesCount
                  ? "bg-red-500/10 text-red-400"
                  : "bg-muted text-muted-foreground"
              )}>
                {getRankLabel(rank, allEntitiesCount)}
              </span>
            )}
            {rankingBlocked && currencyInfo && (
              <span className="text-[9px] text-red-400/70">ranking blocked</span>
            )}
          </div>

          {/* Currency + period badges + source + confidence */}
          <div className="mt-auto flex items-center gap-1 flex-wrap">
            {currencyInfo && <CurrencyBadge info={currencyInfo} />}
            {shortPeriod && periodInfo && <PeriodBadge info={periodInfo} />}
            <span className={cn(
              "rounded border px-1 py-px text-[9px] font-bold uppercase tracking-widest",
              SOURCE_COLOR_CLASS[display.metric.sourceType] ?? "bg-muted text-muted-foreground border-border"
            )}>
              {SOURCE_LABEL[display.metric.sourceType] ?? display.metric.sourceType.toUpperCase()}
            </span>
            {answer.confidence_score != null && (
              <span className="text-[10px] text-muted-foreground/60">
                {answer.confidence_score}%
              </span>
            )}
          </div>
        </>
      ) : (
        /* Qualitative */
        <>
          <QualitativeCellContent text={answer.answer_text} />
          <div className="mt-auto flex items-center gap-1 flex-wrap">
            {shortPeriod && periodInfo && <PeriodBadge info={periodInfo} />}
            {answer.confidence_score != null && (
              <span className="text-[10px] text-muted-foreground/50">
                {answer.confidence_score}%
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function QualitativeCellContent({ text }: { text: string | null }) {
  if (!text) return <span className="text-[11px] text-muted-foreground/40">—</span>;

  const lines = text
    .split(/\n/)
    .map((l) => l.replace(/^[\s]*(•|-|\*|\d+\.)\s*/, "").trim())
    .filter((l) => l.length > 5)
    .slice(0, 3);

  if (lines.length === 0) {
    return (
      <p className="text-[11px] text-foreground/80 leading-relaxed line-clamp-4">
        {text.slice(0, 160)}
      </p>
    );
  }

  return (
    <ul className="space-y-1">
      {lines.map((l, i) => (
        <li key={i} className="flex gap-1.5 text-[11px] text-foreground/80 leading-snug">
          <span className="text-muted-foreground/40 shrink-0">•</span>
          <span className="line-clamp-2">{l}</span>
        </li>
      ))}
    </ul>
  );
}

// ─── Main grid ────────────────────────────────────────────────────────────────

export function ComparisonGrid({
  workspaceId,
  entities,
  documents,
  questions,
  answersMap: externalAnswersMap,
  metrics,
  onAnswerUpdated,
  onQuestionsChanged,
}: ComparisonGridProps) {
  const [localAnswers, setLocalAnswers] = useState<Record<string, MatrixAnswerWithCitations>>({});
  const [runningCells, setRunningCells] = useState<Set<CellKey>>(new Set());
  const [queuedCells, setQueuedCells] = useState<Set<CellKey>>(new Set());
  const [errorCells, setErrorCells] = useState<Map<CellKey, string>>(new Map());
  const [runProgress, setRunProgress] = useState<RunProgress | null>(null);
  const progressRef = useRef(0);

  // Merge external + local answers (local wins — more recent)
  const answersMap = useMemo(
    () => ({ ...externalAnswersMap, ...localAnswers }),
    [externalAnswersMap, localAnswers]
  );

  const entityDocMap = useMemo(
    () => buildEntityDocMap(entities, documents),
    [entities, documents]
  );

  const saveAnswer = useCallback(
    (answer: MatrixAnswerWithCitations) => {
      const key = `${answer.document_id}:${answer.question_id}`;
      setLocalAnswers((prev) => ({ ...prev, [key]: answer }));
      onAnswerUpdated(key, answer);
    },
    [onAnswerUpdated]
  );

  // ── Run a single (doc, question) pair ─────────────────────────────────────
  const runCell = useCallback(
    async (documentId: string, questionId: string) => {
      const key = `${documentId}:${questionId}`;
      // Clear any previous error for this cell
      setErrorCells((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      setRunningCells((prev) => new Set(prev).add(key));
      try {
        const res = await fetch("/api/matrix/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspace_id: workspaceId,
            document_id: documentId,
            question_id: questionId,
          }),
        });
        if (!res.ok) {
          const errMsg = res.status === 404
            ? "Question or document not found — it may have been deleted."
            : `Server error ${res.status}`;
          throw new Error(errMsg);
        }
        const data = await res.json();
        const updatedAnswer: MatrixAnswerWithCitations = {
          id: data.answer_id,
          workspace_id: workspaceId,
          document_id: documentId,
          question_id: questionId,
          status: "done",
          answer_text: data.answer_text,
          confidence_score: data.confidence_score,
          extraction_method: data.extraction_method,
          processing_time_ms: data.processing_time_ms,
          error_message: null,
          metadata: data.metadata ?? {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          citations: data.citations ?? [],
        };
        saveAnswer(updatedAnswer);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Execution failed";
        setErrorCells((prev) => new Map(prev).set(key, msg));
      } finally {
        setRunningCells((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
        setQueuedCells((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [workspaceId, saveAnswer]
  );

  // ── Run all (entity's docs × questions) ──────────────────────────────────
  const runAll = useCallback(async () => {
    const pairs: [string, string][] = [];
    for (const entity of entities) {
      const docs = (entityDocMap.get(entity.id) ?? []).filter(
        (d) => d.ingestion_status === "done"
      );
      for (const doc of docs) {
        for (const q of questions) {
          pairs.push([doc.id, q.id]);
        }
      }
    }
    if (pairs.length === 0) {
      toast.info("No ready documents to run. Assign documents to groups first.");
      return;
    }
    setQueuedCells(new Set(pairs.map(([d, q]) => `${d}:${q}`)));
    progressRef.current = 0;
    setRunProgress({ done: 0, total: pairs.length });

    // Clear previous errors before a fresh run
    setErrorCells(new Map());

    for (let i = 0; i < pairs.length; i += CONCURRENCY) {
      const batch = pairs.slice(i, i + CONCURRENCY);
      await Promise.allSettled(batch.map(([d, q]) => runCell(d, q)));
      progressRef.current += batch.length;
      setRunProgress({ done: progressRef.current, total: pairs.length });
    }
    setRunProgress(null);
    // Report final state after run (errorCells state updates are async — check in next tick)
    setTimeout(() => {
      setErrorCells((prev) => {
        if (prev.size > 0) {
          toast.warning(`${pairs.length - prev.size}/${pairs.length} cells completed. ${prev.size} failed — questions may have been deleted mid-run.`);
        } else {
          toast.success("Comparison complete");
        }
        return prev;
      });
    }, 0);
  }, [entities, entityDocMap, questions, runCell]);

  // ── Run a single entity × question ───────────────────────────────────────
  const runEntityCell = useCallback(
    async (entityId: string, questionId: string) => {
      const docs = (entityDocMap.get(entityId) ?? []).filter(
        (d) => d.ingestion_status === "done"
      );
      if (docs.length === 0) {
        toast.error("No ingested documents for this group.");
        return;
      }
      await Promise.allSettled(docs.map((d) => runCell(d.id, questionId)));
    },
    [entityDocMap, runCell]
  );

  const deleteQuestion = useCallback(
    async (qId: string) => {
      const res = await fetch(`/api/matrix/questions?id=${qId}`, { method: "DELETE" });
      if (!res.ok) { toast.error("Failed to remove question"); return; }
      onQuestionsChanged(questions.filter((q) => q.id !== qId));
      toast.success("Question removed");
    },
    [questions, onQuestionsChanged]
  );

  // ── Rank computation per question (with currency-aware blocking) ──────────
  const { ranksByQuestion, rankingBlockedByQuestion } = useMemo(() => {
    const ranksMap = new Map<string, Map<string, number>>();
    const blockedMap = new Map<string, boolean>();

    for (const q of questions) {
      const isNumeric = q.question_type === "financial" || q.question_type === "operational";
      if (!isNumeric) continue;

      const candidates: Array<{ entityId: string; value: number; unit: string | null; period: string | null }> = [];

      for (const entity of entities) {
        const docs = entityDocMap.get(entity.id) ?? [];
        const answer = getBestEntityAnswer(docs, q.id, answersMap);
        if (!answer) continue;
        const parsed = parseCellDisplayData(
          answer.metadata as Record<string, unknown> | null,
          q.question_text,
          answer.answer_text
        );
        if (parsed.metric?.primaryValue) {
          const num = parseFloat(
            parsed.metric.primaryValue.replace(/[^0-9.-]/g, "")
          );
          // Extract unit from best_metrics in metadata
          const meta = (answer.metadata ?? {}) as Record<string, unknown>;
          const bm = (meta.best_metrics as Array<Record<string, unknown>> | undefined) ?? [];
          const topUnit = bm[0]?.unit as string | null ?? null;
          const topPeriod = bm[0]?.period as string | null ?? null;
          if (!isNaN(num)) candidates.push({ entityId: entity.id, value: num, unit: topUnit, period: topPeriod });
        }
      }

      // Assess comparability across all candidates
      const comparResult = assessComparability(
        candidates.map((c) => ({
          entityLabel: c.entityId,
          currency: detectCurrency(c.unit),
          period: parsePeriod(c.period),
        }))
      );

      const blocked = comparResult.currencyMismatch;
      blockedMap.set(q.id, blocked);

      if (!blocked) {
        candidates.sort((a, b) => b.value - a.value);
        const qRanks = new Map<string, number>();
        candidates.forEach((v, i) => qRanks.set(v.entityId, i + 1));
        ranksMap.set(q.id, qRanks);
      }
    }

    return { ranksByQuestion: ranksMap, rankingBlockedByQuestion: blockedMap };
  }, [questions, entities, entityDocMap, answersMap]);

  if (entities.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="max-w-sm text-center space-y-2">
          <p className="text-sm font-semibold text-foreground">No company groups yet</p>
          <p className="text-xs text-muted-foreground">
            Create at least 2 groups in the Company Groups panel above, then assign your documents.
          </p>
        </div>
      </div>
    );
  }

  const isAnyRunning = runningCells.size > 0;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border shrink-0">
          <span className="text-xs text-muted-foreground">
            {entities.length} groups · {questions.length} questions
          </span>
          <div className="flex-1" />
          {runProgress && (
            <span className="text-xs text-muted-foreground">
              Running {runProgress.done}/{runProgress.total}…
            </span>
          )}
          <AddQuestionDialog
            workspaceId={workspaceId}
            onQuestionAdded={(q) => onQuestionsChanged([...questions, q])}
          />
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={runAll}
            disabled={isAnyRunning}
          >
            {isAnyRunning ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Run Comparison
          </Button>
        </div>

        {/* Grid */}
        <div className="matrix-scroll flex-1 overflow-auto">
          <table className="border-collapse" style={{ minWidth: "100%" }}>
            <thead>
              <tr>
                {/* Entity column header */}
                <th
                  className="sticky left-0 z-20 border-b border-r border-border bg-background px-4 py-3 text-left"
                  style={{ minWidth: "180px", width: "180px" }}
                >
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                    Company / Group
                  </span>
                </th>

                {/* Question columns */}
                {questions.map((q) => {
                  const colBlocked = rankingBlockedByQuestion.get(q.id) ?? false;
                  return (
                  <th
                    key={q.id}
                    className="group/qh border-b border-r border-border px-4 py-3 text-left align-top"
                    style={{ width: "220px", minWidth: "220px" }}
                  >
                    <div className="relative pr-5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="space-y-1">
                            <p className="text-xs font-semibold text-foreground line-clamp-2">
                              {q.question_text}
                            </p>
                            <div className="flex items-center gap-1 flex-wrap">
                              <span className="text-[10px] capitalize text-muted-foreground/60 border border-border rounded-full px-1.5 py-0.5">
                                {q.question_type}
                              </span>
                              {colBlocked && (
                                <span className="inline-flex items-center rounded border border-red-500/20 bg-red-500/8 px-1.5 py-0.5 text-[9px] font-bold text-red-400">
                                  ✗ currency mismatch
                                </span>
                              )}
                            </div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs">
                          <p>{q.question_text}</p>
                          {colBlocked && (
                            <p className="text-red-400 mt-1 text-[11px]">
                              Ranking blocked — entities report in different currencies.
                            </p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                      <button
                        onClick={() => deleteQuestion(q.id)}
                        className={cn(
                          "absolute right-0 top-0 flex h-5 w-5 items-center justify-center rounded",
                          "text-muted-foreground/40 hover:text-red-400 hover:bg-red-500/10",
                          "opacity-0 group-hover/qh:opacity-100 transition-opacity"
                        )}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </th>
                  );
                })}

                {/* Add question column */}
                <th className="border-b border-border px-3 py-3" style={{ width: "80px" }}>
                  <AddQuestionDialog
                    workspaceId={workspaceId}
                    onQuestionAdded={(q) => onQuestionsChanged([...questions, q])}
                  >
                    <button className="flex items-center gap-1 text-[11px] text-muted-foreground/50 hover:text-primary transition-colors">
                      <Plus className="h-3.5 w-3.5" />
                      Add
                    </button>
                  </AddQuestionDialog>
                </th>
              </tr>
            </thead>

            <tbody>
              {entities.map((entity) => {
                const entityDocs = entityDocMap.get(entity.id) ?? [];
                return (
                  <tr key={entity.id} className="group/row hover:bg-muted/10">
                    {/* Entity label cell */}
                    <td
                      className="sticky left-0 z-10 border-b border-r border-border bg-background px-4 py-3 align-top group-hover/row:bg-muted/10"
                      style={{ minWidth: "180px" }}
                    >
                      <div className="space-y-1">
                        <EntityBadge entity={entity} />
                        {entity.ticker && (
                          <p className="text-[10px] text-muted-foreground/50 font-mono">
                            {entity.ticker}
                          </p>
                        )}
                        {entity.period_label && (
                          <span className="inline-flex items-center rounded border border-border px-1.5 py-0.5 text-[9px] font-semibold text-muted-foreground/60">
                            {entity.period_label}
                          </span>
                        )}
                        <p className="text-[10px] text-muted-foreground/40">
                          {entityDocs.filter((d) => d.ingestion_status === "done").length} doc{entityDocs.length !== 1 ? "s" : ""}
                        </p>
                      </div>
                    </td>

                    {/* Answer cells */}
                    {questions.map((q) => {
                      const entityRunning = (entityDocMap.get(entity.id) ?? [])
                        .some((d) => runningCells.has(`${d.id}:${q.id}`));
                      const entityQueued = !entityRunning &&
                        (entityDocMap.get(entity.id) ?? [])
                          .some((d) => queuedCells.has(`${d.id}:${q.id}`));
                      // Show error if any doc in this entity+question pair failed
                      const firstError = (entityDocMap.get(entity.id) ?? [])
                        .map((d) => errorCells.get(`${d.id}:${q.id}`))
                        .find(Boolean) ?? null;
                      const rank = ranksByQuestion.get(q.id)?.get(entity.id) ?? null;
                      const rankingBlocked = rankingBlockedByQuestion.get(q.id) ?? false;

                      return (
                        <td
                          key={q.id}
                          className="border-b border-r border-border align-top"
                          style={{ height: "140px", maxHeight: "140px" }}
                        >
                          <ComparisonCell
                            entity={entity}
                            question={q}
                            entityDocs={entityDocs}
                            answersMap={answersMap}
                            allEntitiesCount={entities.length}
                            rank={rank}
                            rankingBlocked={rankingBlocked}
                            isRunning={entityRunning}
                            isQueued={entityQueued}
                            errorMessage={firstError}
                            onRun={() => runEntityCell(entity.id, q.id)}
                          />
                        </td>
                      );
                    })}
                    <td className="border-b border-border" />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </TooltipProvider>
  );
}
