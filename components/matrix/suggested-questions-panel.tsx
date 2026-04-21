"use client";

/**
 * AI Suggested Questions Panel
 *
 * Displays AI-generated analyst questions grouped by category.
 * Users can review, check/uncheck, and add selected questions to the matrix.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Sparkles,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Plus,
  CheckSquare,
  Square,
  AlertTriangle,
  Info,
  Loader2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type {
  SuggestedQuestionItem,
  SuggestedCategoryGroup,
} from "@/lib/intelligence/question-types";
import {
  CATEGORY_ORDER,
  RECOMMENDED_PRIORITY_THRESHOLD,
  ANSWER_TYPE_TO_QUESTION_TYPE,
} from "@/lib/intelligence/question-types";
import type { MatrixQuestionRow } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface SuggestedQuestionsPanelProps {
  workspaceId: string;
  /** Called with the newly created MatrixQuestionRows after "Add Selected" */
  onQuestionsAdded: (questions: MatrixQuestionRow[]) => void;
  /** Existing question texts in the matrix — used to mark already-added items */
  existingQuestionTexts: Set<string>;
}

/** idle   = never fetched yet (panel just mounted)
 *  checking = reading the cache (GET only — no AI call)
 *  ready  = cache loaded and displayed
 *  generating = user triggered generation / regeneration (AI call in flight)
 *  error  = last operation failed
 */
type LoadState = "idle" | "checking" | "ready" | "generating" | "error";

// ─── Category colour map ──────────────────────────────────────────────────────

const CATEGORY_STYLE: Record<
  string,
  { bg: string; text: string; border: string }
> = {
  Financial: {
    bg: "bg-blue-500/10",
    text: "text-blue-400",
    border: "border-blue-500/20",
  },
  "Performance Drivers": {
    bg: "bg-emerald-500/10",
    text: "text-emerald-400",
    border: "border-emerald-500/20",
  },
  Risks: {
    bg: "bg-red-500/10",
    text: "text-red-400",
    border: "border-red-500/20",
  },
  "Strategy / Outlook": {
    bg: "bg-violet-500/10",
    text: "text-violet-400",
    border: "border-violet-500/20",
  },
  "Advanced Insights": {
    bg: "bg-amber-500/10",
    text: "text-amber-400",
    border: "border-amber-500/20",
  },
};

function getCategoryStyle(name: string) {
  return (
    CATEGORY_STYLE[name] ?? {
      bg: "bg-muted/40",
      text: "text-muted-foreground",
      border: "border-border",
    }
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function CategoryBadge({ name }: { name: string }) {
  const s = getCategoryStyle(name);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        s.bg,
        s.text,
        s.border
      )}
    >
      {name}
    </span>
  );
}

interface QuestionRowProps {
  question: SuggestedQuestionItem;
  checked: boolean;
  alreadyAdded: boolean;
  onToggle: (id: string) => void;
}

function QuestionRow({
  question,
  checked,
  alreadyAdded,
  onToggle,
}: QuestionRowProps) {
  const isRecommended = question.priority >= RECOMMENDED_PRIORITY_THRESHOLD;

  return (
    <div
      className={cn(
        "group flex items-start gap-2.5 rounded-lg px-3 py-2.5 transition-colors",
        alreadyAdded
          ? "opacity-40 cursor-not-allowed"
          : "hover:bg-muted/40 cursor-pointer"
      )}
      onClick={() => !alreadyAdded && onToggle(question.id)}
    >
      {/* Checkbox */}
      <div className="mt-0.5 shrink-0 text-muted-foreground">
        {alreadyAdded ? (
          <CheckSquare className="h-4 w-4 text-emerald-400" />
        ) : checked ? (
          <CheckSquare className="h-4 w-4 text-primary" />
        ) : (
          <Square className="h-4 w-4" />
        )}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p
            className={cn(
              "text-[13px] leading-snug text-foreground",
              (alreadyAdded || !checked) && "text-muted-foreground"
            )}
          >
            {question.question_text}
          </p>
          {isRecommended && !alreadyAdded && (
            <span className="inline-flex items-center rounded-full bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-primary">
              Recommended
            </span>
          )}
          {alreadyAdded && (
            <span className="inline-flex items-center rounded-full bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-emerald-400">
              In Matrix
            </span>
          )}
        </div>

        {/* Rationale */}
        <div className="flex items-center gap-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex items-center gap-1 text-[10px] text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <Info className="h-3 w-3" />
                <span className="truncate max-w-[240px]">{question.rationale}</span>
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs">
              {question.rationale}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Priority score */}
      <Tooltip>
        <TooltipTrigger asChild>
          <div className="shrink-0 text-[10px] tabular-nums text-muted-foreground/40 mt-0.5 cursor-help">
            {question.priority}
          </div>
        </TooltipTrigger>
        <TooltipContent side="left" className="text-xs">
          Priority score ({question.priority}/100) — AI confidence that this question
          is relevant and valuable for your documents.
          {question.priority >= 80 ? " Recommended." : ""}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

// ─── Coverage badge ───────────────────────────────────────────────────────────

function CoverageBadge({ total }: { total: number }) {
  const level =
    total >= 12
      ? { label: "High coverage", color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" }
      : total >= 6
      ? { label: "Partial coverage", color: "text-amber-400 bg-amber-500/10 border-amber-500/20" }
      : { label: "Limited coverage", color: "text-muted-foreground bg-muted/40 border-border" };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold",
        level.color
      )}
    >
      {level.label}
    </span>
  );
}

// ─── Main panel ───────────────────────────────────────────────────────────────

export function SuggestedQuestionsPanel({
  workspaceId,
  onQuestionsAdded,
  existingQuestionTexts,
}: SuggestedQuestionsPanelProps) {
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [categories, setCategories] = useState<SuggestedCategoryGroup[]>([]);
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [isExpanded, setIsExpanded] = useState(true);
  const [isStale, setIsStale] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const hasFetchedRef = useRef(false);

  // ── Cache check (read-only, no AI call) ────────────────────────────────────
  const checkCache = useCallback(async () => {
    setLoadState("checking");
    try {
      const res = await fetch(
        `/api/questions/suggest?workspace_id=${workspaceId}`
      );
      if (!res.ok) {
        // Non-fatal: just show idle CTA
        setLoadState("idle");
        return;
      }
      const data = await res.json();
      if (data.suggestions && data.suggestions.length > 0) {
        applyCategories(data.suggestions);
        setIsStale(data.is_stale ?? false);
        setLoadState("ready");
      } else {
        // No cache yet — show idle CTA, never auto-generate
        setLoadState("idle");
      }
    } catch {
      setLoadState("idle");
    }
  // applyCategories is defined below; stable because it doesn't close over state
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  // ── User-triggered generation ───────────────────────────────────────────────
  const generateSuggestions = useCallback(
    async (forceRegenerate = false) => {
      setLoadState("generating");
      try {
        const res = await fetch("/api/questions/suggest", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspace_id: workspaceId,
            force_regenerate: forceRegenerate,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Generation failed");
        applyCategories(data.suggestions ?? []);
        setIsStale(false);
        setLoadState("ready");
      } catch (err) {
        console.error("[SuggestedQuestionsPanel]", err);
        setLoadState("error");
      }
    },
    // applyCategories stable ref — see note above
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [workspaceId]
  );

  function applyCategories(rawCategories: SuggestedCategoryGroup[]) {
    // Sort by canonical order
    const sorted = CATEGORY_ORDER.flatMap((name) => {
      const cat = rawCategories.find((c) => c.name === name);
      return cat ? [cat] : [];
    });
    // Append any unexpected categories at the end
    const known = new Set(CATEGORY_ORDER as string[]);
    rawCategories.forEach((c) => {
      if (!known.has(c.name)) sorted.push(c);
    });

    setCategories(sorted);

    // Pre-check recommended + not already in matrix
    const defaultChecked = new Set<string>();
    sorted.forEach((cat) =>
      cat.questions.forEach((q) => {
        if (q.default_checked && !existingQuestionTexts.has(q.question_text)) {
          defaultChecked.add(q.id);
        }
      })
    );
    setCheckedIds(defaultChecked);
  }

  useEffect(() => {
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true;
      checkCache();
    }
  }, [checkCache]);

  // ── Checkbox helpers ───────────────────────────────────────────────────────
  const allQuestions = categories.flatMap((c) => c.questions);

  const toggleQuestion = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    const ids = allQuestions
      .filter((q) => !existingQuestionTexts.has(q.question_text))
      .map((q) => q.id);
    setCheckedIds(new Set(ids));
  };

  const clearAll = () => setCheckedIds(new Set());

  // ── Add selected to matrix ─────────────────────────────────────────────────
  const addSelected = async () => {
    const toAdd = allQuestions.filter(
      (q) =>
        checkedIds.has(q.id) && !existingQuestionTexts.has(q.question_text)
    );

    if (toAdd.length === 0) {
      toast.info("No new questions selected.");
      return;
    }

    setIsAdding(true);
    const created: MatrixQuestionRow[] = [];

    try {
      for (const q of toAdd) {
        const res = await fetch("/api/matrix/questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            workspace_id: workspaceId,
            question_text: q.question_text,
            // The API schema accepts question_type; column_index is auto-assigned server-side
            question_type: ANSWER_TYPE_TO_QUESTION_TYPE[q.answer_type],
          }),
        });
        if (!res.ok) {
          console.error("[SuggestedQuestionsPanel] Failed to add:", q.question_text);
          continue;
        }
        // The API returns the created row directly (not wrapped in { question: ... })
        const row = await res.json() as MatrixQuestionRow;
        if (row?.id) {
          created.push(row);
        }
      }

      if (created.length > 0) {
        onQuestionsAdded(created);
        toast.success(
          `${created.length} question${created.length > 1 ? "s" : ""} added to matrix`
        );
        // Uncheck the newly added questions so the panel reflects their "In Matrix" state
        setCheckedIds((prev) => {
          const next = new Set(prev);
          toAdd.forEach((q) => next.delete(q.id));
          return next;
        });
      } else {
        toast.error("Could not add questions — please try again.");
      }
    } catch (err) {
      toast.error("Failed to add questions");
      console.error(err);
    } finally {
      setIsAdding(false);
    }
  };

  // ── Derived state ──────────────────────────────────────────────────────────
  const checkedCount = [...checkedIds].filter(
    (id) =>
      !existingQuestionTexts.has(
        allQuestions.find((q) => q.id === id)?.question_text ?? ""
      )
  ).length;

  const totalSuggestions = allQuestions.length;

  // Top 3 recommended for the summary bar
  const topRecommended = allQuestions
    .filter(
      (q) =>
        q.priority >= RECOMMENDED_PRIORITY_THRESHOLD &&
        !existingQuestionTexts.has(q.question_text)
    )
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3);

  if (dismissed) return null;

  // ─── Checking cache (silent, no AI call) ──────────────────────────────────
  if (loadState === "checking") {
    return (
      <div className="mx-4 mb-2 rounded-xl border border-border bg-card/60 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Sparkles className="h-4 w-4 text-muted-foreground/40 shrink-0" />
          <span className="text-xs text-muted-foreground/60">
            Checking for saved suggestions…
          </span>
          <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground/30" />
        </div>
      </div>
    );
  }

  // ─── Idle — no cache, user must click to generate ─────────────────────────
  if (loadState === "idle") {
    return (
      <div className="mx-4 mb-2 rounded-xl border border-dashed border-border bg-card/40 px-4 py-3">
        <div className="flex items-center gap-3">
          <Sparkles className="h-4 w-4 text-muted-foreground/40 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground">
              AI Suggested Questions
            </p>
            <p className="text-[11px] text-muted-foreground/50 mt-0.5">
              Generate analyst questions tailored to your uploaded documents.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5 shrink-0"
            onClick={() => generateSuggestions(false)}
          >
            <Sparkles className="h-3 w-3" />
            Generate
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground/30 hover:text-muted-foreground shrink-0"
            onClick={() => setDismissed(true)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  }

  // ─── Generating (user triggered) ──────────────────────────────────────────
  if (loadState === "generating") {
    return (
      <div className="mx-4 mb-2 rounded-xl border border-border bg-card/60 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <Sparkles className="h-4 w-4 text-primary animate-pulse shrink-0" />
          <span className="text-sm text-muted-foreground">
            Generating analyst questions…
          </span>
          <Loader2 className="ml-auto h-4 w-4 animate-spin text-muted-foreground/50" />
        </div>
      </div>
    );
  }

  // ─── Error ─────────────────────────────────────────────────────────────────
  if (loadState === "error") {
    return (
      <div className="mx-4 mb-2 rounded-xl border border-border bg-card/60 px-4 py-3">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
          <span className="text-sm text-muted-foreground">
            Could not generate suggestions.
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 text-xs"
            onClick={() => generateSuggestions(false)}
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }

  // ─── Empty (generated but no suggestions returned) ─────────────────────────
  if (loadState === "ready" && totalSuggestions === 0) {
    return null;
  }

  // ─── Ready ─────────────────────────────────────────────────────────────────
  return (
    <TooltipProvider delayDuration={300}>
    <div className="mx-4 mb-2 rounded-xl border border-border bg-card/60 overflow-hidden">
      {/* ── Header bar ── */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60">
        <Sparkles className="h-4 w-4 text-primary shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-foreground">
              AI Suggested Questions
            </span>
            <CoverageBadge total={totalSuggestions} />
            {isStale && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
                <AlertTriangle className="h-2.5 w-2.5" />
                Stale — new documents added
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {totalSuggestions} analyst questions based on your documents
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* "Add to Matrix" surfaces in the header whenever questions are checked */}
          {checkedCount > 0 && (
            <Button
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={addSelected}
              disabled={isAdding}
            >
              {isAdding ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Plus className="h-3 w-3" />
              )}
              Add {checkedCount} to Matrix
            </Button>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={() => generateSuggestions(true)}
                disabled={loadState === "generating"}
              >
                <RefreshCw
                  className={cn(
                    "h-3.5 w-3.5",
                    loadState === "generating" && "animate-spin"
                  )}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Regenerate suggestions</TooltipContent>
          </Tooltip>

          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setIsExpanded((v) => !v)}
          >
            {isExpanded ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
          </Button>

          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground/40 hover:text-muted-foreground"
            onClick={() => setDismissed(true)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Recommended summary (always visible) ── */}
      {!isExpanded && topRecommended.length > 0 && (
        <div className="px-4 py-2.5 flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
            Recommended
          </span>
          {topRecommended.map((q) => (
            <span
              key={q.id}
              className="rounded-md border border-primary/20 bg-primary/5 px-2 py-0.5 text-[11px] text-primary cursor-pointer hover:bg-primary/10 transition-colors"
              onClick={() => setIsExpanded(true)}
            >
              {q.question_text.length > 60
                ? q.question_text.slice(0, 60) + "…"
                : q.question_text}
            </span>
          ))}
          <button
            className="text-[11px] text-muted-foreground/50 hover:text-muted-foreground underline ml-1"
            onClick={() => setIsExpanded(true)}
          >
            Show all
          </button>
        </div>
      )}

      {/* ── Expanded body ── */}
      {isExpanded && (
        <>
          {/* Category groups */}
          <div className="max-h-[260px] overflow-y-auto divide-y divide-border/40">
            {categories.map((cat) => (
              <CategorySection
                key={cat.name}
                category={cat}
                checkedIds={checkedIds}
                existingQuestionTexts={existingQuestionTexts}
                onToggle={toggleQuestion}
              />
            ))}
          </div>

          {/* ── Action bar ── */}
          <div className="flex items-center gap-2 px-4 py-2.5 border-t border-border/60 bg-muted/20">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground"
              onClick={selectAll}
            >
              Select All
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs text-muted-foreground"
              onClick={clearAll}
            >
              Clear
            </Button>

            <div className="flex-1" />

            {checkedCount > 0 && (
              <span className="text-[11px] text-muted-foreground">
                {checkedCount} selected
              </span>
            )}

            <Button
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={addSelected}
              disabled={checkedCount === 0 || isAdding}
            >
              {isAdding ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Add Selected to Matrix
            </Button>
          </div>
        </>
      )}
    </div>
    </TooltipProvider>
  );
}

// ─── Category section ─────────────────────────────────────────────────────────

interface CategorySectionProps {
  category: SuggestedCategoryGroup;
  checkedIds: Set<string>;
  existingQuestionTexts: Set<string>;
  onToggle: (id: string) => void;
}

function CategorySection({
  category,
  checkedIds,
  existingQuestionTexts,
  onToggle,
}: CategorySectionProps) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      <button
        className="flex w-full items-center gap-2 px-4 py-2 hover:bg-muted/30 transition-colors"
        onClick={() => setOpen((v) => !v)}
      >
        <CategoryBadge name={category.name} />
        <span className="text-[11px] text-muted-foreground ml-1">
          {category.questions.length}
        </span>
        <div className="flex-1" />
        {open ? (
          <ChevronUp className="h-3 w-3 text-muted-foreground/40" />
        ) : (
          <ChevronDown className="h-3 w-3 text-muted-foreground/40" />
        )}
      </button>

      {open && (
        <div className="pb-1">
          {category.questions.map((q) => (
            <QuestionRow
              key={q.id}
              question={q}
              checked={checkedIds.has(q.id)}
              alreadyAdded={existingQuestionTexts.has(q.question_text)}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  );
}
