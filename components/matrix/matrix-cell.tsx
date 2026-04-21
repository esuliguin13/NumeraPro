"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  RefreshCw,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  ArrowUp,
  ArrowDown,
  ShieldAlert,
} from "lucide-react";
import { cn, getConfidenceLevel } from "@/lib/utils";
import { parseCellDisplayData, isLimitedInsight, SOURCE_LABEL, SOURCE_COLOR_CLASS } from "@/lib/intelligence/cell-display";
import { useMatrixMode } from "@/lib/matrix-mode-context";
import type { MatrixAnswerWithCitations, DocumentRow, MatrixQuestionRow, CellDisplayData } from "@/types";
import type { MatrixMode } from "@/lib/matrix-mode-context";

// ─── Bullet text parser ───────────────────────────────────────────────────────

function isBulletText(text: string): boolean {
  return /^[\s]*(•|-|\*|\d+\.)\s+/m.test(text);
}

function parseBullets(text: string, maxBullets = 3): string[] {
  return text
    .split(/\n/)
    .map((line) => line.replace(/^[\s]*(•|-|\*|\d+\.)\s*/, "").trim())
    .filter((line) => line.length > 8)
    .slice(0, maxBullets);
}

// ─── Effective question type ──────────────────────────────────────────────────

/**
 * Merges the user's DB column type with the AI-classified metadata type.
 *
 * Rules:
 *   - DB "risk" always enforces bullet-only (no numeric output)
 *   - Otherwise trust the AI classification from metadata
 *   - Fall back to DB type mapping if metadata type is missing
 */
function getEffectiveType(
  dbType: MatrixQuestionRow["question_type"],
  metaType: CellDisplayData["questionType"],
): "financial" | "analytical" | "qualitative" | "comparison" {
  if (dbType === "risk") return "qualitative";
  if (metaType) return metaType;
  if (dbType === "financial") return "financial";
  if (dbType === "operational") return "analytical";
  return "qualitative";
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConfidencePill({ score }: { score: number }) {
  const level = getConfidenceLevel(score);
  return (
    <span className={cn(
      "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
      level === "high"   ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
      : level === "medium" ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
      : "bg-red-500/15 text-red-500"
    )}>
      {score}%
    </span>
  );
}

function SourceBadge({ sourceType }: { sourceType: string }) {
  return (
    <span className={cn(
      "rounded border px-1 py-px text-[9px] font-bold uppercase tracking-widest",
      SOURCE_COLOR_CLASS[sourceType] ?? "bg-muted text-muted-foreground border-border"
    )}>
      {SOURCE_LABEL[sourceType] ?? sourceType.toUpperCase()}
    </span>
  );
}

function QueueDots() {
  return (
    <div className="flex items-center gap-1">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30 animate-pulse"
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </div>
  );
}

function RunningIndicator({ elapsed }: { elapsed: number }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-7 w-7">
        <div className="absolute inset-0 rounded-full border-2 border-primary/15" />
        <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-primary animate-spin" />
      </div>
      <div className="text-center">
        <span className="text-[11px] text-muted-foreground block leading-none">Analyzing…</span>
        {elapsed >= 2 && (
          <span className="text-[10px] text-muted-foreground/40 tabular-nums">{elapsed}s</span>
        )}
      </div>
    </div>
  );
}

// ─── Limited insights fallback ────────────────────────────────────────────────

function LimitedInsightsCell() {
  return (
    <div className="flex h-full flex-col gap-2 px-3 py-3">
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" />
        <span className="text-[11px] font-semibold text-amber-500 leading-tight">
          Limited Insights Available
        </span>
      </div>
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Insufficient structured or contextual data for this question.
      </p>
      <div className="mt-auto space-y-0.5">
        <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/50 mb-1">
          Try adding
        </p>
        {["Financial statements", "Earnings reports", "Supporting documents"].map((item) => (
          <div key={item} className="flex items-center gap-1.5">
            <span className="h-1 w-1 rounded-full bg-muted-foreground/30 shrink-0" />
            <span className="text-[9px] text-muted-foreground/50">{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Conflict callout ─────────────────────────────────────────────────────────

/**
 * Replaces the bare "Conflicting Signals" badge with a labelled block that
 * includes a one-line contextual hint. For financial questions the actual
 * differing values are passed in; for qualitative/analytical a question-type
 * hint is shown instead.
 */
function ConflictCallout({
  questionType,
  primaryLabel,
  primaryValue,
  primarySource,
  conflictValue,
  conflictSource,
}: {
  questionType: CellDisplayData["questionType"];
  primaryLabel?: string;
  primaryValue?: string;
  primarySource?: string;
  conflictValue?: string;
  conflictSource?: string;
}) {
  const HINT: Record<string, string> = {
    financial:   "Sources report different values for this metric.",
    comparison:  "Sources disagree on the magnitude or direction of change.",
    analytical:  "Sources attribute this outcome to different drivers.",
    qualitative: "Sources highlight varying risk factors or priorities.",
  };

  const hasValues = primaryValue && conflictValue;

  return (
    <div className="rounded border border-amber-200/40 dark:border-amber-800/40 bg-amber-500/5 px-2 py-1.5 space-y-0.5">
      {/* Header */}
      <div className="flex items-center gap-1">
        <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-amber-400" />
        <span className="text-[9px] font-semibold uppercase tracking-wider text-amber-500">
          Conflicting Signals
        </span>
      </div>

      {/* Example values (financial) or contextual hint (qualitative/analytical) */}
      {hasValues ? (
        <p className="text-[9px] text-amber-400/80 leading-relaxed tabular-nums">
          {SOURCE_LABEL[primarySource ?? ""] ?? "A"}: {primaryValue}
          {" · "}
          {SOURCE_LABEL[conflictSource ?? ""] ?? "B"}: {conflictValue}
          {primaryLabel ? ` (${primaryLabel})` : ""}
        </p>
      ) : (
        <p className="text-[9px] text-muted-foreground/60 leading-relaxed line-clamp-1">
          {HINT[questionType ?? "qualitative"] ?? HINT.qualitative}
        </p>
      )}
    </div>
  );
}

// ─── Done-state layouts ───────────────────────────────────────────────────────

interface LayoutProps {
  display: CellDisplayData;
  answer: MatrixAnswerWithCitations;
  mode: MatrixMode;
}

/**
 * Financial layout — large numeric value + YoY/margin row + source footer.
 * Used when questionType === "financial".
 */
function FinancialLayout({ display, answer, mode }: LayoutProps) {
  const { metric, signals } = display;
  if (!metric) return <QualitativeLayout display={display} answer={answer} mode={mode} />;

  return (
    <div className="flex h-full flex-col justify-between p-3">
      {/* Row 1: metric label + period */}
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground truncate block">
            {metric.primaryLabel}
            {metric.isAdjusted && (
              <span className="ml-1 font-normal normal-case text-muted-foreground/40">adj.</span>
            )}
            {metric.isGuidance && (
              <span className="ml-1 font-normal normal-case text-muted-foreground/40">guide</span>
            )}
          </span>
          {metric.period && (
            <span className="text-[9px] text-muted-foreground/35">{metric.period}</span>
          )}
        </div>
        {mode === "analyst" && answer.confidence_score != null && (
          <ConfidencePill score={answer.confidence_score} />
        )}
      </div>

      {/* Row 2: Primary value */}
      <p className={cn(
        "font-bold tabular-nums leading-none tracking-tight text-foreground",
        metric.primaryValue.length > 8 ? "text-xl" : "text-2xl",
      )}>
        {metric.primaryValue}
      </p>

      {/* Row 3: YoY / margin — or conflict callout when a conflict exists */}
      {signals.hasConflict ? (
        <ConflictCallout
          questionType="financial"
          primaryLabel={metric.primaryLabel}
          primaryValue={metric.primaryValue}
          primarySource={metric.sourceType}
          conflictValue={metric.conflictValue ?? undefined}
          conflictSource={metric.conflictSourceType ?? undefined}
        />
      ) : metric.supportingLabel ? (
        <div className={cn(
          "flex items-center gap-0.5 text-[11px] font-medium",
          metric.supportingPositive === false ? "text-red-400"
          : metric.supportingPositive === true ? "text-emerald-500"
          : "text-muted-foreground"
        )}>
          {metric.supportingPositive === true && <TrendingUp className="h-2.5 w-2.5" />}
          {metric.supportingPositive === false && <TrendingDown className="h-2.5 w-2.5" />}
          {metric.supportingLabel}
        </div>
      ) : null}

      {/* Row 4: Source + analyst signals */}
      <div className="flex items-center gap-1 flex-wrap">
        <SourceBadge sourceType={metric.sourceType} />
        {mode === "analyst" && !signals.hasConflict && (
          <>
            {signals.isMultiSourceConfirmed && (
              <span className="rounded border border-emerald-200 dark:border-emerald-800 bg-emerald-500/10 px-1 py-px text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
                ✓ confirmed
              </span>
            )}
            {signals.hasDerived && !signals.isMultiSourceConfirmed && (
              <span className="rounded border border-violet-200 dark:border-violet-800 bg-violet-500/10 px-1 py-px text-[9px] font-semibold text-violet-600 dark:text-violet-400">
                derived
              </span>
            )}
            {signals.hasVariance && (
              <span className="rounded border border-amber-100 dark:border-amber-900 bg-amber-500/5 px-1 py-px text-[9px] text-amber-500">
                variance
              </span>
            )}
          </>
        )}
        {mode === "analyst" && answer.confidence_score != null && (
          <ConfidencePill score={answer.confidence_score} />
        )}
      </div>
    </div>
  );
}

/**
 * Comparison layout — summary sentence + metric value + delta arrow.
 * Used when questionType === "comparison".
 */
function ComparisonLayout({ display, answer, mode }: LayoutProps) {
  const { metric, signals, summaryText, qualitativeText } = display;

  // Fall back to qualitative if no metric could be computed
  if (!metric) return <QualitativeLayout display={display} answer={answer} mode={mode} />;

  return (
    <div className="flex h-full flex-col justify-between p-3">
      {/* Row 1: Summary sentence */}
      <p className="text-[11px] text-foreground/80 leading-snug line-clamp-2">
        {summaryText ?? qualitativeText?.split("\n")[0] ?? metric.primaryLabel}
      </p>

      {/* Row 2: Primary metric value (compact) */}
      <div className="flex items-baseline gap-2">
        <span className={cn(
          "font-bold tabular-nums leading-none tracking-tight text-foreground",
          metric.primaryValue.length > 8 ? "text-lg" : "text-xl",
        )}>
          {metric.primaryValue}
        </span>
        {metric.period && (
          <span className="text-[9px] text-muted-foreground/50">{metric.period}</span>
        )}
      </div>

      {/* Row 3: Delta / YoY change */}
      {metric.supportingLabel ? (
        <div className={cn(
          "flex items-center gap-0.5 text-[11px] font-medium",
          metric.supportingPositive === false ? "text-red-400"
          : metric.supportingPositive === true ? "text-emerald-500"
          : "text-muted-foreground"
        )}>
          {metric.supportingPositive === true && <ArrowUp className="h-2.5 w-2.5" />}
          {metric.supportingPositive === false && <ArrowDown className="h-2.5 w-2.5" />}
          {metric.supportingLabel}
        </div>
      ) : (
        <div /> /* spacer */
      )}

      {/* Row 4: Conflict callout or source footer */}
      {signals.hasConflict ? (
        <ConflictCallout
          questionType="comparison"
          primaryValue={metric.primaryValue}
          primarySource={metric.sourceType}
          conflictValue={metric.conflictValue ?? undefined}
          conflictSource={metric.conflictSourceType ?? undefined}
        />
      ) : (
        <div className="flex items-center gap-1.5 flex-wrap">
          <SourceBadge sourceType={metric.sourceType} />
          {mode === "analyst" && answer.confidence_score != null && (
            <ConfidencePill score={answer.confidence_score} />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Analytical layout — 2–3 bullet points from answer text + optional
 * supporting metric row below the bullets.
 * Used when questionType === "analytical".
 */
function AnalyticalLayout({ display, answer, mode }: LayoutProps) {
  const { metric, signals, qualitativeText, questionType } = display;
  const hasBullets = qualitativeText ? isBulletText(qualitativeText) : false;
  const maxBullets = signals.hasConflict ? 2 : 3;

  return (
    <div className="flex h-full flex-col justify-between p-3">
      {/* Bullets or prose (primary content) */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {qualitativeText && hasBullets ? (
          <ul className="space-y-0.5">
            {parseBullets(qualitativeText, maxBullets).map((bullet, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary/40" />
                <span className="text-[11px] text-foreground/80 leading-snug line-clamp-2">
                  {bullet}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={cn(
            "text-[11px] text-foreground/75 leading-relaxed",
            signals.hasConflict ? "line-clamp-2" : "line-clamp-4"
          )}>
            {qualitativeText ?? ""}
          </p>
        )}
      </div>

      {/* Conflict callout — replaces supporting metric row when conflict detected */}
      {signals.hasConflict ? (
        <ConflictCallout questionType={questionType} />
      ) : metric ? (
        <div className="mt-1.5 flex items-center gap-1.5 rounded border border-border bg-muted/30 px-1.5 py-1">
          <span className="text-[10px] font-semibold tabular-nums text-foreground">
            {metric.primaryValue}
          </span>
          {metric.supportingLabel && (
            <span className={cn(
              "flex items-center gap-0.5 text-[10px] font-medium",
              metric.supportingPositive === false ? "text-red-400"
              : metric.supportingPositive === true ? "text-emerald-500"
              : "text-muted-foreground"
            )}>
              {metric.supportingPositive === true && <TrendingUp className="h-2.5 w-2.5" />}
              {metric.supportingPositive === false && <TrendingDown className="h-2.5 w-2.5" />}
              {metric.supportingLabel}
            </span>
          )}
          <span className="ml-auto text-[9px] text-muted-foreground/50 truncate">
            {metric.primaryLabel}
          </span>
        </div>
      ) : null}

      {/* Footer */}
      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
        {signals.primarySources.slice(0, mode === "analyst" ? 3 : 1).map((src) => (
          <SourceBadge key={src} sourceType={src} />
        ))}
        {mode === "analyst" && answer.confidence_score != null && (
          <ConfidencePill score={answer.confidence_score} />
        )}
      </div>
    </div>
  );
}

/**
 * Risk / Qualitative layout — bullet list only, NO numeric financial values.
 * Used when questionType === "qualitative" (or DB type === "risk").
 */
function QualitativeLayout({ display, answer, mode }: LayoutProps) {
  const { signals, qualitativeText, questionType } = display;
  const hasBullets = qualitativeText ? isBulletText(qualitativeText) : false;
  // Reduce bullets when a conflict callout will take up space below
  const maxBullets = signals.hasConflict ? 2 : 3;

  return (
    <div className="flex h-full flex-col justify-between p-3">
      {/* Content — bullet list preferred, plain prose as fallback */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {qualitativeText && hasBullets ? (
          <ul className="space-y-0.5">
            {parseBullets(qualitativeText, maxBullets).map((bullet, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-muted-foreground/40" />
                <span className="text-[11px] text-foreground/75 leading-snug line-clamp-2">
                  {bullet}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className={cn(
            "text-xs text-foreground/75 leading-relaxed",
            signals.hasConflict ? "line-clamp-2" : "line-clamp-4"
          )}>
            {qualitativeText ?? ""}
          </p>
        )}
      </div>

      {/* Conflict callout — replaces bare badge, adds context */}
      {signals.hasConflict && (
        <ConflictCallout questionType={questionType} />
      )}

      {/* Footer: source + confidence — conflict badge removed (shown above) */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {signals.primarySources.slice(0, mode === "analyst" ? 3 : 1).map((src) => (
          <SourceBadge key={src} sourceType={src} />
        ))}
        {mode === "analyst" && answer.confidence_score != null && (
          <ConfidencePill score={answer.confidence_score} />
        )}
      </div>
    </div>
  );
}

// ─── Cell type indicator chip ─────────────────────────────────────────────────

const TYPE_CHIP: Record<string, { label: string; className: string; icon?: React.ReactNode }> = {
  financial:   { label: "FIN",  className: "text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 bg-emerald-500/10" },
  analytical:  { label: "ANA",  className: "text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800 bg-blue-500/10" },
  qualitative: { label: "RISK", className: "text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800 bg-amber-500/10" },
  comparison:  { label: "CMP",  className: "text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800 bg-violet-500/10" },
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface MatrixCellProps {
  document: DocumentRow;
  question: MatrixQuestionRow;
  answer: MatrixAnswerWithCitations | null;
  isSelected: boolean;
  isQueued: boolean;
  isRunning: boolean;
  onClick: () => void;
  onRerun: (documentId: string, questionId: string) => void;
}

// ─── Main cell ────────────────────────────────────────────────────────────────

export function MatrixCell({
  document,
  question,
  answer,
  isSelected,
  isQueued,
  isRunning,
  onClick,
  onRerun,
}: MatrixCellProps) {
  const mode = useMatrixMode();

  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number | null>(null);

  useEffect(() => {
    if (isRunning) {
      startRef.current = Date.now();
      setElapsed(0);
      const id = setInterval(() => {
        if (startRef.current) {
          setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
        }
      }, 1000);
      return () => clearInterval(id);
    } else {
      startRef.current = null;
      setElapsed(0);
    }
  }, [isRunning]);

  const dbStatus = answer?.status ?? "pending";
  const status: "pending" | "queued" | "running" | "done" | "error" =
    isRunning ? "running"
    : isQueued ? "queued"
    : dbStatus === "done" ? "done"
    : dbStatus === "error" ? "error"
    : "pending";

  const display = status === "done" && answer
    ? parseCellDisplayData(
        answer.metadata as Record<string, unknown> | null | undefined,
        question.question_text,
        answer.answer_text,
      )
    : null;

  const effectiveType = display
    ? getEffectiveType(question.question_type, display.questionType)
    : null;

  const chip = effectiveType ? TYPE_CHIP[effectiveType] : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => e.key === "Enter" && onClick()}
      className={cn(
        "group relative h-36 w-full cursor-pointer select-none overflow-hidden",
        "border-b border-r border-border transition-colors duration-150",
        "hover:bg-muted/20",
        isSelected && "bg-primary/5 ring-1 ring-inset ring-primary/30",
        status === "error" && "bg-red-500/5",
        (isRunning || isQueued) && "border-l-2 border-l-primary/30",
      )}
    >
      {/* Shimmer bar while running */}
      {isRunning && (
        <div
          className="absolute inset-x-0 top-0 h-0.5 animate-shimmer"
          style={{
            background: "linear-gradient(90deg, transparent 0%, hsl(var(--primary)/0.6) 50%, transparent 100%)",
            backgroundSize: "200% 100%",
          }}
        />
      )}

      {/* Cell-type chip — analyst mode only, top-left corner */}
      {mode === "analyst" && chip && status === "done" && (
        <span className={cn(
          "absolute left-2 top-2 z-10 rounded border px-1 py-px text-[8px] font-bold uppercase tracking-widest opacity-60",
          chip.className,
        )}>
          {chip.label}
        </span>
      )}

      {/* ── Pending ── */}
      {status === "pending" && (
        <div className="flex h-full items-center justify-center">
          <span className="text-xs text-muted-foreground/25">—</span>
        </div>
      )}

      {/* ── Queued ── */}
      {status === "queued" && (
        <div className="flex h-full flex-col items-center justify-center gap-2">
          <QueueDots />
          <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground/40">
            Queued
          </span>
        </div>
      )}

      {/* ── Running ── */}
      {status === "running" && (
        <div className="flex h-full flex-col items-center justify-center">
          <RunningIndicator elapsed={elapsed} />
        </div>
      )}

      {/* ── Error ── */}
      {status === "error" && (
        <div className="flex h-full flex-col items-start gap-1.5 p-3">
          <div className="flex items-center gap-1.5 text-red-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="text-xs font-medium">Failed</span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-3">
            {answer?.error_message ?? "Query failed"}
          </p>
        </div>
      )}

      {/* ── Done ── dispatch to the correct layout by question type ── */}
      {status === "done" && display && answer && (() => {
        const key = (answer.updated_at ?? "") + (answer.id ?? "");
        const props: LayoutProps = { display, answer, mode };

        // Show structured fallback when the AI found no meaningful data
        if (isLimitedInsight(answer.answer_text, answer.confidence_score)) {
          return (
            <div key={key} className="h-full animate-[fade-in_0.25s_ease-out]">
              <LimitedInsightsCell />
            </div>
          );
        }

        switch (effectiveType) {
          case "financial":
            return (
              <div key={key} className="h-full animate-[fade-in_0.25s_ease-out]">
                <FinancialLayout {...props} />
              </div>
            );
          case "comparison":
            return (
              <div key={key} className="h-full animate-[fade-in_0.25s_ease-out]">
                <ComparisonLayout {...props} />
              </div>
            );
          case "analytical":
            return (
              <div key={key} className="h-full animate-[fade-in_0.25s_ease-out]">
                <AnalyticalLayout {...props} />
              </div>
            );
          default:
            return (
              <div key={key} className="h-full animate-[fade-in_0.25s_ease-out]">
                <QualitativeLayout {...props} />
              </div>
            );
        }
      })()}

      {/* Re-run button */}
      {(status === "done" || status === "error") && (
        <button
          className={cn(
            "absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center",
            "rounded-md bg-muted/80 text-muted-foreground",
            "hover:bg-muted hover:text-foreground group-hover:flex transition-all",
          )}
          onClick={(e) => {
            e.stopPropagation();
            onRerun(document.id, question.id);
          }}
          title="Re-run this cell"
        >
          <RefreshCw className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
