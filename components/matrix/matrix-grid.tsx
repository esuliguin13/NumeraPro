"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Play, Loader2, FileText, CheckCircle2, Briefcase, ScanSearch, Clock, AlertCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { MatrixCell } from "./matrix-cell";
import { AddQuestionDialog } from "./add-question-dialog";
import { CitationPanel } from "./citation-panel";
import { cn } from "@/lib/utils";
import { MatrixModeContext, type MatrixMode } from "@/lib/matrix-mode-context";
import type {
  DocumentRow,
  MatrixQuestionRow,
  MatrixAnswerWithCitations,
  SelectedCell,
  ExtractedMetricRow,
} from "@/types";

// Maximum concurrent cell executions when running the full matrix
const CONCURRENCY = 3;

interface MatrixGridProps {
  workspaceId: string;
  /** Live list — updated by the parent whenever documents are added or removed. */
  documents: DocumentRow[];
  initialQuestions: MatrixQuestionRow[];
  initialAnswers: Record<string, MatrixAnswerWithCitations>;
  metrics: ExtractedMetricRow[];
  /** Called whenever a cell answer is saved so the parent can recompute summaries. */
  onAnswerUpdated?: (key: string, answer: MatrixAnswerWithCitations) => void;
  /**
   * Questions added externally (e.g. from the AI Suggested Questions panel).
   * New items are merged into the internal questions state on change.
   */
  extraQuestions?: MatrixQuestionRow[];
  /**
   * Called whenever questions are added or deleted so the parent can keep
   * allKnownQuestions in sync — enabling comparison mode to share the same
   * question list without requiring a full page reload.
   */
  onQuestionsChanged?: (questions: MatrixQuestionRow[]) => void;
}

interface RunProgress {
  done: number;
  total: number;
}

export function MatrixGrid({
  workspaceId,
  documents,
  initialQuestions,
  initialAnswers,
  metrics,
  onAnswerUpdated,
  extraQuestions,
  onQuestionsChanged,
}: MatrixGridProps) {
  const [questions, setQuestions] = useState<MatrixQuestionRow[]>(initialQuestions);

  // Merge questions added externally (e.g. from AI Suggested Questions panel)
  const prevExtraRef = useRef<MatrixQuestionRow[]>([]);
  useEffect(() => {
    if (!extraQuestions || extraQuestions === prevExtraRef.current) return;
    const newOnes = extraQuestions.filter(
      (q) => !questions.some((eq) => eq.id === q.id)
    );
    if (newOnes.length > 0) {
      setQuestions((prev) => [...prev, ...newOnes]);
    }
    prevExtraRef.current = extraQuestions;
  // questions intentionally omitted — we only want to react to extraQuestions changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraQuestions]);
  const [answers, setAnswers] =
    useState<Record<string, MatrixAnswerWithCitations>>(initialAnswers);

  // View mode
  const [mode, setMode] = useState<MatrixMode>("executive");

  // Per-cell execution state
  const [queuedCells, setQueuedCells] = useState<Set<string>>(new Set());
  const [runningCells, setRunningCells] = useState<Set<string>>(new Set());

  // Batch-run progress
  const [runProgress, setRunProgress] = useState<RunProgress | null>(null);
  const progressRef = useRef(0); // avoids stale closures in async loop

  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);

  const cellKey = (docId: string, qId: string) => `${docId}:${qId}`;

  // ── Single cell execution ─────────────────────────────────────────────────

  const runCell = useCallback(
    async (documentId: string, questionId: string) => {
      const key = cellKey(documentId, questionId);
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
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? "Cell execution failed");
        }

        const result = await res.json();

        const completedAnswer: MatrixAnswerWithCitations = {
          ...result.answer,
          citations: result.citations ?? [],
        };

        setAnswers((prev) => ({ ...prev, [key]: completedAnswer }));
        onAnswerUpdated?.(key, completedAnswer);
      } catch (err) {
        setAnswers((prev) => ({
          ...prev,
          [key]: {
            ...(prev[key] ?? {
              id: key,
              workspace_id: workspaceId,
              document_id: documentId,
              question_id: questionId,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
              answer_text: null,
              confidence_score: null,
              extraction_method: null,
              processing_time_ms: null,
              metadata: {},
            }),
            status: "error",
            error_message: err instanceof Error ? err.message : "Unknown error",
            citations: [],
          } as MatrixAnswerWithCitations,
        }));
      } finally {
        setRunningCells((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [workspaceId, onAnswerUpdated]
  );

  // ── Batch run ────────────────────────────────────────────────────────────

  async function runAll() {
    const pendingCells: Array<[string, string]> = [];
    for (const doc of documents) {
      // Only run cells for documents that have finished ingestion
      if (doc.ingestion_status !== "done") continue;
      for (const q of questions) {
        const key = cellKey(doc.id, q.id);
        const ans = answers[key];
        if (!ans || ans.status === "pending" || ans.status === "error") {
          pendingCells.push([doc.id, q.id]);
        }
      }
    }

    if (pendingCells.length === 0) {
      toast.info("All cells already have answers");
      return;
    }

    // Mark all as queued immediately
    setQueuedCells(new Set(pendingCells.map(([d, q]) => cellKey(d, q))));
    progressRef.current = 0;
    setRunProgress({ done: 0, total: pendingCells.length });

    // Process in batches
    for (let i = 0; i < pendingCells.length; i += CONCURRENCY) {
      const batch = pendingCells.slice(i, i + CONCURRENCY);

      // Dequeue this batch (move to running inside runCell)
      setQueuedCells((prev) => {
        const next = new Set(prev);
        batch.forEach(([d, q]) => next.delete(cellKey(d, q)));
        return next;
      });

      await Promise.allSettled(
        batch.map(([docId, qId]) => runCell(docId, qId))
      );

      progressRef.current += batch.length;
      setRunProgress({ done: progressRef.current, total: pendingCells.length });
    }

    setQueuedCells(new Set());
    const total = pendingCells.length;
    setRunProgress(null);
    toast.success(`Matrix complete — ${total} cell${total !== 1 ? "s" : ""} analysed`);
  }

  // ── Delete question column ────────────────────────────────────────────────

  async function deleteQuestion(questionId: string) {
    try {
      const res = await fetch(`/api/matrix/questions?id=${questionId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete question");

      // Remove the question from the list and notify parent
      setQuestions((prev) => {
        const next = prev.filter((q) => q.id !== questionId);
        onQuestionsChanged?.(next);
        return next;
      });

      // Clean up all answer/running/queued state for this column
      const keyBelongsToQuestion = (k: string) => k.split(":")[1] === questionId;

      setAnswers((prev) => {
        const next = { ...prev };
        Object.keys(next).forEach((k) => { if (keyBelongsToQuestion(k)) delete next[k]; });
        return next;
      });
      setRunningCells((prev) => {
        const next = new Set(prev);
        [...next].forEach((k) => { if (keyBelongsToQuestion(k)) next.delete(k); });
        return next;
      });
      setQueuedCells((prev) => {
        const next = new Set(prev);
        [...next].forEach((k) => { if (keyBelongsToQuestion(k)) next.delete(k); });
        return next;
      });

      // Close citation panel if it was open on this column
      if (selectedCell?.questionId === questionId) setSelectedCell(null);

      toast.success("Question removed");
    } catch {
      toast.error("Failed to remove question");
    }
  }

  // ── Cell click ────────────────────────────────────────────────────────────

  function handleCellClick(doc: DocumentRow, q: MatrixQuestionRow) {
    const key = cellKey(doc.id, q.id);
    setSelectedCell({
      documentId: doc.id,
      questionId: q.id,
      answer: answers[key] ?? null,
      document: doc,
      question: q,
    });
  }

  // ── Derived counts ─────────────────────────────────────────────────────────

  const pendingCount = documents.reduce((sum, doc) => {
    return (
      sum +
      questions.filter((q) => {
        const ans = answers[cellKey(doc.id, q.id)];
        return !ans || ans.status === "pending" || ans.status === "error";
      }).length
    );
  }, 0);

  const isRunning = queuedCells.size > 0 || runningCells.size > 0;
  const progressPct = runProgress
    ? Math.round((runProgress.done / runProgress.total) * 100)
    : 0;

  if (documents.length === 0 && questions.length === 0) {
    return (
      <EmptyMatrix
        workspaceId={workspaceId}
        onQuestionAdded={(q) => {
          setQuestions((prev) => {
            const next = [...prev, q];
            onQuestionsChanged?.(next);
            return next;
          });
        }}
      />
    );
  }

  return (
    <MatrixModeContext.Provider value={mode}>
    <TooltipProvider>
      <div className="flex flex-col h-full">

        {/* ── Toolbar ── */}
        <div className="shrink-0">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-card gap-3">

            {/* Left: mode toggle */}
            <ModeToggle mode={mode} onChange={setMode} />

            {/* Center: run status */}
            <div className="flex items-center gap-3 flex-1">
              <span className="text-xs text-muted-foreground">
                {documents.length} doc{documents.length !== 1 ? "s" : ""} ·{" "}
                {questions.length} question{questions.length !== 1 ? "s" : ""}
              </span>

              {isRunning && runProgress && (
                <span className="flex items-center gap-1.5 text-xs text-primary font-medium">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {runProgress.done} / {runProgress.total} complete
                  {queuedCells.size > 0 && (
                    <span className="text-muted-foreground font-normal">
                      · {queuedCells.size} queued
                    </span>
                  )}
                </span>
              )}

              {!isRunning && pendingCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  {pendingCount} cell{pendingCount !== 1 ? "s" : ""} pending
                </span>
              )}

              {!isRunning && pendingCount === 0 && documents.length > 0 && (
                <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" />
                  All complete
                </span>
              )}
            </div>

            {/* Right: run button */}
            <Button
              onClick={runAll}
              disabled={isRunning || pendingCount === 0}
              size="sm"
              className="gap-2 shrink-0"
            >
              {isRunning ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" />Running…</>
              ) : (
                <><Play className="h-3.5 w-3.5" />Run Matrix</>
              )}
            </Button>
          </div>

          {/* Progress bar */}
          <div className={cn(
            "h-0.5 bg-muted overflow-hidden transition-opacity duration-300",
            isRunning ? "opacity-100" : "opacity-0"
          )}>
            <div
              className="h-full bg-primary transition-all duration-500 ease-out"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {/* ── Grid ── */}
        <div className="flex-1 matrix-scroll">
          <div className="min-w-max">
            <table className="border-collapse" style={{ tableLayout: "fixed" }}>
              {/* Header */}
              <thead>
                <tr>
                  <th
                    className="sticky left-0 z-20 bg-card border-b border-r border-border px-4 py-3 text-left"
                    style={{ width: "220px", minWidth: "220px" }}
                  >
                    <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      <FileText className="h-3.5 w-3.5" />
                      Document
                    </div>
                  </th>

                  {questions.map((q) => (
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
                              <span className="text-[10px] capitalize text-muted-foreground/60 border border-border rounded-full px-1.5 py-0.5">
                                {q.question_type}
                              </span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs">
                            {q.question_text}
                          </TooltipContent>
                        </Tooltip>

                        {/* Delete button — visible on column header hover */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteQuestion(q.id);
                          }}
                          title="Remove question"
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
                  ))}

                  <th
                    className="border-b border-border py-3 align-middle"
                    style={{ width: "160px", minWidth: "160px" }}
                  >
                    <AddQuestionDialog
                      workspaceId={workspaceId}
                      onQuestionAdded={(q) => {
                        setQuestions((prev) => {
                          const next = [...prev, q];
                          onQuestionsChanged?.(next);
                          return next;
                        });
                      }}
                    />
                  </th>
                </tr>
              </thead>

              {/* Rows */}
              <tbody>
                {documents.map((doc) => (
                  <tr key={doc.id}>
                    {/* Document label */}
                    <td
                      className="sticky left-0 z-10 bg-card border-b border-r border-border px-4 py-3"
                      style={{ width: "220px", minWidth: "220px" }}
                    >
                      <div className="space-y-1">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <p className="text-sm font-medium text-foreground leading-tight line-clamp-2 cursor-default">
                              {doc.name}
                            </p>
                          </TooltipTrigger>
                          <TooltipContent>{doc.name}</TooltipContent>
                        </Tooltip>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] uppercase font-mono text-muted-foreground/60 border border-border rounded px-1 py-0.5">
                            {doc.file_type}
                          </span>
                          <IngestionStatusDot status={doc.ingestion_status} />
                        </div>
                      </div>
                    </td>

                    {/* Answer cells */}
                    {questions.map((q) => {
                      const key = cellKey(doc.id, q.id);
                      const answer = answers[key] ?? null;
                      const isQueued = queuedCells.has(key);
                      const isRunning = runningCells.has(key);
                      const isSelected =
                        selectedCell?.documentId === doc.id &&
                        selectedCell?.questionId === q.id;

                      return (
                        <td
                          key={q.id}
                          className="border-b border-border p-0"
                          style={{ width: "220px", minWidth: "220px" }}
                        >
                          {doc.ingestion_status !== "done" ? (
                            <DocumentIngestionCell status={doc.ingestion_status} />
                          ) : (
                            <MatrixCell
                              document={doc}
                              question={q}
                              answer={answer}
                              isSelected={isSelected}
                              isQueued={isQueued}
                              isRunning={isRunning}
                              onClick={() => handleCellClick(doc, q)}
                              onRerun={runCell}
                            />
                          )}
                        </td>
                      );
                    })}

                    <td className="border-b border-border" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Citation panel */}
      <CitationPanel
        cell={selectedCell}
        metrics={metrics}
        onClose={() => setSelectedCell(null)}
      />
    </TooltipProvider>
    </MatrixModeContext.Provider>
  );
}

// ── Helper components ──────────────────────────────────────────────────────────

function ModeToggle({
  mode,
  onChange,
}: {
  mode: MatrixMode;
  onChange: (m: MatrixMode) => void;
}) {
  return (
    <div className="flex items-center rounded-lg border border-border bg-muted/40 p-0.5 gap-0.5">
      <button
        onClick={() => onChange("executive")}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150",
          mode === "executive"
            ? "bg-background shadow-sm text-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Briefcase className="h-3 w-3" />
        Executive
      </button>
      <button
        onClick={() => onChange("analyst")}
        className={cn(
          "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all duration-150",
          mode === "analyst"
            ? "bg-background shadow-sm text-foreground"
            : "text-muted-foreground hover:text-foreground"
        )}
      >
        <ScanSearch className="h-3 w-3" />
        Analyst
      </button>
    </div>
  );
}

// ── Ingestion placeholder cell ────────────────────────────────────────────────
// Shown instead of MatrixCell for documents that are still being ingested.

function DocumentIngestionCell({ status }: { status: DocumentRow["ingestion_status"] }) {
  const isError = status === "error";
  return (
    <div className={cn(
      "flex flex-col items-center justify-center gap-1.5 h-[120px] px-3",
      isError ? "bg-red-500/5" : "bg-muted/20"
    )}>
      {isError ? (
        <AlertCircle className="h-4 w-4 text-red-400 shrink-0" />
      ) : status === "processing" ? (
        <Loader2 className="h-4 w-4 text-amber-400 animate-spin shrink-0" />
      ) : (
        <Clock className="h-4 w-4 text-muted-foreground/40 shrink-0" />
      )}
      <span className={cn(
        "text-[11px] font-medium text-center leading-tight",
        isError ? "text-red-400" : "text-muted-foreground/60"
      )}>
        {isError
          ? "Ingestion failed"
          : status === "processing"
          ? "Processing document…"
          : "Waiting to process"}
      </span>
      {!isError && (
        <span className="text-[10px] text-muted-foreground/40 text-center">
          Analysis available when ready
        </span>
      )}
    </div>
  );
}

function IngestionStatusDot({ status }: { status: DocumentRow["ingestion_status"] }) {
  const colors: Record<string, string> = {
    pending:    "bg-muted-foreground/30",
    processing: "bg-amber-400 animate-pulse",
    done:       "bg-emerald-400",
    error:      "bg-red-400",
  };
  const labels: Record<string, string> = {
    pending:    "Pending ingestion",
    processing: "Processing…",
    done:       "Ready",
    error:      "Ingestion failed",
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={cn("h-1.5 w-1.5 rounded-full", colors[status])} />
      </TooltipTrigger>
      <TooltipContent>{labels[status]}</TooltipContent>
    </Tooltip>
  );
}

function EmptyMatrix({
  workspaceId,
  onQuestionAdded,
}: {
  workspaceId: string;
  onQuestionAdded: (q: MatrixQuestionRow) => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-center px-8">
      <div className="rounded-2xl border border-dashed border-border p-8 max-w-md w-full">
        <div className="flex justify-center mb-4">
          <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <FileText className="h-6 w-6 text-primary" />
          </div>
        </div>
        <h3 className="text-base font-semibold text-foreground mb-2">
          Your Matrix is empty
        </h3>
        <p className="text-sm text-muted-foreground mb-6">
          Upload documents and add analyst questions to start building your
          research matrix.
        </p>
        <AddQuestionDialog
          workspaceId={workspaceId}
          onQuestionAdded={onQuestionAdded}
        />
      </div>
    </div>
  );
}
