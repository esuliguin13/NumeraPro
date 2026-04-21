"use client";

/**
 * Export Analysis Modal
 *
 * Two modes: Executive Summary (short) and Analyst Brief (detailed).
 * Preview renders markdown inline. Download saves as .md file.
 * Copy-to-clipboard button included.
 */

import { useState, useCallback } from "react";
import {
  FileText,
  BarChart3,
  Download,
  Copy,
  Check,
  Loader2,
  X,
  ChevronDown,
  AlertTriangle,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { ReportMode } from "@/lib/export/report-generator";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GeneratedReport {
  mode: ReportMode;
  workspace_name: string;
  generated_at: string;
  markdown: string;
  overall_confidence: number;
  confidence_label: "High" | "Medium" | "Low";
  has_conflicts: boolean;
  dominant_period: string | null;
}

interface ExportModalProps {
  workspaceId: string;
  workspaceName: string;
  onClose: () => void;
}

type GenerateState = "idle" | "generating" | "done" | "error";

// ─── Markdown renderer ────────────────────────────────────────────────────────

function MarkdownPreview({ markdown }: { markdown: string }) {
  const lines = markdown.split("\n");

  return (
    <div className="space-y-1 font-mono text-[13px] leading-relaxed">
      {lines.map((line, i) => {
        // H1
        if (line.startsWith("# ")) {
          return (
            <p key={i} className="text-lg font-bold text-foreground mt-4 mb-2 font-sans">
              {line.slice(2)}
            </p>
          );
        }
        // H2
        if (line.startsWith("## ")) {
          return (
            <p key={i} className="text-sm font-bold text-foreground mt-5 mb-1 font-sans border-b border-border pb-0.5">
              {line.slice(3)}
            </p>
          );
        }
        // H3
        if (line.startsWith("### ")) {
          return (
            <p key={i} className="text-xs font-semibold text-foreground mt-3 mb-0.5 font-sans uppercase tracking-wider">
              {line.slice(4)}
            </p>
          );
        }
        // HR
        if (line.trim() === "---") {
          return <hr key={i} className="border-border my-3" />;
        }
        // Bullet
        if (line.startsWith("- ") || line.startsWith("• ")) {
          const content = line.slice(2);
          return (
            <div key={i} className="flex gap-2">
              <span className="text-muted-foreground/50 shrink-0 mt-0.5">•</span>
              <span className="text-foreground/80">{renderInline(content)}</span>
            </div>
          );
        }
        // Blockquote
        if (line.startsWith("> ")) {
          return (
            <div key={i} className="border-l-2 border-primary/30 pl-3 text-muted-foreground italic">
              {line.slice(2)}
            </div>
          );
        }
        // Empty line
        if (line.trim() === "") {
          return <div key={i} className="h-1" />;
        }
        // Italic line (wrapped in *)
        if (line.startsWith("*") && line.endsWith("*") && !line.startsWith("**")) {
          return (
            <p key={i} className="text-xs text-muted-foreground/60 italic">
              {line.slice(1, -1)}
            </p>
          );
        }
        // Normal paragraph
        return (
          <p key={i} className="text-foreground/80">
            {renderInline(line)}
          </p>
        );
      })}
    </div>
  );
}

/** Render inline bold/italic within a line */
function renderInline(text: string): React.ReactNode {
  // Split on **bold** markers
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

// ─── Confidence badge ─────────────────────────────────────────────────────────

function ConfidenceBadge({ label, score }: { label: string; score: number }) {
  const color =
    label === "High"
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
      : label === "Medium"
      ? "bg-amber-500/10 text-amber-400 border-amber-500/20"
      : "bg-red-500/10 text-red-400 border-red-500/20";
  const dot =
    label === "High" ? "bg-emerald-400" : label === "Medium" ? "bg-amber-400" : "bg-red-400";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold",
        color
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {label} Confidence · {score}/100
    </span>
  );
}

// ─── Mode selector card ───────────────────────────────────────────────────────

interface ModeCardProps {
  selected: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  badge?: string;
  onClick: () => void;
}

function ModeCard({ selected, icon, title, description, badge, onClick }: ModeCardProps) {
  return (
    <button
      className={cn(
        "flex flex-col gap-1.5 rounded-xl border p-4 text-left transition-all",
        selected
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-border bg-card hover:border-primary/40 hover:bg-muted/30"
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <span className={cn("shrink-0", selected ? "text-primary" : "text-muted-foreground")}>
          {icon}
        </span>
        <span className={cn("text-sm font-semibold", selected ? "text-primary" : "text-foreground")}>
          {title}
        </span>
        {badge && (
          <span className="ml-auto rounded-full bg-primary/10 border border-primary/20 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-widest text-primary">
            {badge}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
    </button>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────

export function ExportModal({ workspaceId, workspaceName, onClose }: ExportModalProps) {
  const [mode, setMode] = useState<ReportMode>("executive");
  const [state, setState] = useState<GenerateState>("idle");
  const [report, setReport] = useState<GeneratedReport | null>(null);
  const [copied, setCopied] = useState(false);

  const generate = useCallback(async () => {
    setState("generating");
    try {
      const res = await fetch("/api/export/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: workspaceId, mode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Generation failed");
      setReport(data as GeneratedReport);
      setState("done");
    } catch (err) {
      console.error("[ExportModal]", err);
      setState("error");
    }
  }, [workspaceId, mode]);

  const download = useCallback(() => {
    if (!report) return;
    const slug = report.workspace_name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const modeSlug = report.mode === "executive" ? "executive-summary" : "analyst-brief";
    const filename = `${slug}-${modeSlug}.md`;
    const blob = new Blob([report.markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Report downloaded");
  }, [report]);

  const copyToClipboard = useCallback(async () => {
    if (!report) return;
    await navigator.clipboard.writeText(report.markdown);
    setCopied(true);
    toast.success("Copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  }, [report]);

  // Reset when mode changes while idle/error
  const handleModeChange = (m: ReportMode) => {
    if (state === "done") {
      setReport(null);
      setState("idle");
    }
    setMode(m);
  };

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="relative flex w-full max-w-3xl flex-col rounded-2xl border border-border bg-background shadow-2xl overflow-hidden max-h-[90vh]">

        {/* ── Header ── */}
        <div className="flex items-center gap-3 px-6 py-4 border-b border-border shrink-0">
          <Sparkles className="h-4 w-4 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Export Analysis</h2>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{workspaceName}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-auto flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* ── Body (scrollable) ── */}
        <div className="flex-1 overflow-y-auto">

          {/* Mode selection — always shown */}
          <div className="px-6 pt-5 pb-4">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Select Format
            </p>
            <div className="grid grid-cols-2 gap-3">
              <ModeCard
                selected={mode === "executive"}
                icon={<BarChart3 className="h-4 w-4" />}
                title="Executive Summary"
                description="1-page KPI snapshot + top insights + risks. Ideal for leadership briefings."
                badge="Fast"
                onClick={() => handleModeChange("executive")}
              />
              <ModeCard
                selected={mode === "analyst"}
                icon={<FileText className="h-4 w-4" />}
                title="Analyst Brief"
                description="8-section structured report with financial performance, drivers, risks, contradictions, and confidence assessment."
                onClick={() => handleModeChange("analyst")}
              />
            </div>
          </div>

          {/* ── Idle / Error ── */}
          {(state === "idle" || state === "error") && (
            <div className="px-6 pb-5">
              {state === "error" && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3">
                  <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />
                  <p className="text-sm text-red-400">
                    Generation failed. Ensure the matrix has completed answers and try again.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Generating ── */}
          {state === "generating" && (
            <div className="px-6 pb-6 flex flex-col items-center gap-3 py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">
                {mode === "executive"
                  ? "Generating executive summary…"
                  : "Generating analyst brief… this may take a few seconds"}
              </p>
            </div>
          )}

          {/* ── Preview ── */}
          {state === "done" && report && (
            <div className="px-6 pb-5">
              {/* Meta row */}
              <div className="flex items-center gap-3 flex-wrap mb-4">
                <ConfidenceBadge label={report.confidence_label} score={report.overall_confidence} />
                {report.has_conflicts && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-400">
                    <AlertTriangle className="h-3 w-3" />
                    Conflicting signals detected
                  </span>
                )}
                {report.dominant_period && (
                  <span className="text-xs text-muted-foreground">
                    Period: {report.dominant_period}
                  </span>
                )}
              </div>

              {/* Markdown preview */}
              <div className="rounded-xl border border-border bg-card/60 px-5 py-4 overflow-auto max-h-[380px]">
                <MarkdownPreview markdown={report.markdown} />
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center gap-2 px-6 py-3.5 border-t border-border shrink-0 bg-muted/10">
          {state === "done" && report ? (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5"
                onClick={copyToClipboard}
              >
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copied ? "Copied!" : "Copy Markdown"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs gap-1.5"
                onClick={download}
              >
                <Download className="h-3.5 w-3.5" />
                Download .md
              </Button>
              <div className="flex-1" />
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-xs text-muted-foreground gap-1"
                onClick={() => { setReport(null); setState("idle"); }}
              >
                <ChevronDown className="h-3.5 w-3.5 rotate-180" />
                Regenerate
              </Button>
            </>
          ) : (
            <>
              <div className="flex-1" />
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={onClose}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="h-8 text-xs gap-1.5"
                onClick={generate}
                disabled={state === "generating"}
              >
                {state === "generating" ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                {state === "generating" ? "Generating…" : "Generate Preview"}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
