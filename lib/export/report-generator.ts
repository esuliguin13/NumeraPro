/**
 * Analyst Report Generator
 *
 * Assembles all existing workspace intelligence into a structured markdown
 * report. Two modes:
 *
 *   "executive"  — 1-page KPI summary + 3 bullets, fast.
 *   "analyst"    — full 8-section brief, Claude-synthesized narrative.
 *
 * Zero re-extraction: all data comes from stored matrix_answers.metadata,
 * extracted_financial_metrics, and workspace/document rows.
 * Claude is used only to write prose — never to re-parse documents.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { runTextCompletion, DEFAULT_MODEL } from "@/lib/ai/anthropic";
import { formatKpiValue } from "@/lib/intelligence/executive-summary";
import { isLimitedInsight } from "@/lib/intelligence/cell-display";

// ─── Shared types ─────────────────────────────────────────────────────────────

export type ReportMode = "executive" | "analyst";

export interface GeneratedReport {
  mode: ReportMode;
  workspace_name: string;
  generated_at: string;
  markdown: string;
  /** Aggregated confidence across all done answers (0-100) */
  overall_confidence: number;
  /** "High" | "Medium" | "Low" */
  confidence_label: "High" | "Medium" | "Low";
  has_conflicts: boolean;
  dominant_period: string | null;
}

// ─── Internal data shapes ─────────────────────────────────────────────────────

interface StoredBestMetric {
  canonical_type: string;
  metric_name: string;
  value: number | null;
  unit: string | null;
  period: string | null;
  confidence: number;
  source_file_type: string;
  is_derived: boolean;
}

interface StoredDerivedMetric {
  canonical_type: string;
  metric_name: string;
  value: number | null;
  unit: string | null;
  period: string | null;
  confidence: number;
}

interface StoredContradiction {
  canonical_type: string;
  classification: string;
  normalizedPeriod: string | null;
  notes: string;
}

interface AnswerSummary {
  question_text: string;
  question_type: string;
  answer_text: string | null;
  confidence_score: number | null;
  best_metrics: StoredBestMetric[];
  derived_metrics: StoredDerivedMetric[];
  contradictions: StoredContradiction[];
  conflict_count: number;
  primary_sources: string[];
}

interface WorkspaceContext {
  workspaceId: string;
  workspaceName: string;
  description: string | null;
  documents: Array<{ name: string; file_type: string }>;
  answers: AnswerSummary[];
  allBestMetrics: StoredBestMetric[];
  allDerivedMetrics: StoredDerivedMetric[];
  allContradictions: StoredContradiction[];
  overallConfidence: number;
  hasConflicts: boolean;
  dominantPeriod: string | null;
}

// ─── Data assembly ────────────────────────────────────────────────────────────

async function assembleContext(
  supabase: SupabaseClient<Database>,
  workspaceId: string
): Promise<WorkspaceContext> {
  const [wsRes, docsRes, qRes, aRes] = await Promise.all([
    supabase.from("workspaces").select("name, description").eq("id", workspaceId).single(),
    supabase.from("documents").select("name, file_type").eq("workspace_id", workspaceId).eq("ingestion_status", "done"),
    supabase.from("matrix_questions").select("id, question_text, question_type").eq("workspace_id", workspaceId).order("column_index"),
    supabase.from("matrix_answers").select("question_id, answer_text, confidence_score, metadata, status").eq("workspace_id", workspaceId).eq("status", "done"),
  ]);

  const workspace = wsRes.data;
  const documents = docsRes.data ?? [];
  const questions = qRes.data ?? [];
  const rawAnswers = aRes.data ?? [];

  // Map answers by question_id (best answer per question — highest confidence)
  const answerByQ = new Map<string, typeof rawAnswers[0]>();
  for (const a of rawAnswers) {
    const existing = answerByQ.get(a.question_id);
    if (!existing || (a.confidence_score ?? 0) > (existing.confidence_score ?? 0)) {
      answerByQ.set(a.question_id, a);
    }
  }

  const answers: AnswerSummary[] = [];
  const allBest: StoredBestMetric[] = [];
  const allDerived: StoredDerivedMetric[] = [];
  const allContra: StoredContradiction[] = [];
  const confidenceScores: number[] = [];

  for (const q of questions) {
    const a = answerByQ.get(q.id);
    if (!a) continue;
    if (isLimitedInsight(a.answer_text, a.confidence_score)) continue;

    const meta = (a.metadata ?? {}) as Record<string, unknown>;
    const bm = (meta.best_metrics as StoredBestMetric[] | undefined) ?? [];
    const dm = (meta.derived_metrics as StoredDerivedMetric[] | undefined) ?? [];
    const contra = (meta.contradictions as StoredContradiction[] | undefined) ?? [];
    const conflictCount = (meta.conflict_count as number | undefined) ?? 0;
    const sources = (meta.primary_sources as string[] | undefined) ?? [];

    allBest.push(...bm);
    allDerived.push(...dm);
    allContra.push(...contra.filter((c) => c.classification === "conflict" || c.classification === "minor_variance"));

    if (a.confidence_score != null) confidenceScores.push(a.confidence_score);

    answers.push({
      question_text: q.question_text,
      question_type: q.question_type,
      answer_text: a.answer_text,
      confidence_score: a.confidence_score,
      best_metrics: bm,
      derived_metrics: dm,
      contradictions: contra,
      conflict_count: conflictCount,
      primary_sources: sources,
    });
  }

  const overallConfidence =
    confidenceScores.length > 0
      ? Math.round(confidenceScores.reduce((s, c) => s + c, 0) / confidenceScores.length)
      : 0;

  const hasConflicts = allContra.some((c) => c.classification === "conflict");

  // Dominant period: most common non-null period across best metrics
  const periodCounts: Record<string, number> = {};
  for (const m of allBest) {
    if (m.period) periodCounts[m.period] = (periodCounts[m.period] ?? 0) + 1;
  }
  const dominantPeriod = Object.entries(periodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return {
    workspaceId,
    workspaceName: workspace?.name ?? "Workspace",
    description: workspace?.description ?? null,
    documents,
    answers,
    allBestMetrics: allBest,
    allDerivedMetrics: allDerived,
    allContradictions: allContra,
    overallConfidence,
    hasConflicts,
    dominantPeriod,
  };
}

// ─── Formatting helpers ───────────────────────────────────────────────────────

function confidenceLabel(score: number): "High" | "Medium" | "Low" {
  if (score >= 75) return "High";
  if (score >= 45) return "Medium";
  return "Low";
}

function confidenceBadge(score: number): string {
  const label = confidenceLabel(score);
  const symbol = label === "High" ? "🟢" : label === "Medium" ? "🟡" : "🔴";
  return `${symbol} ${label} Confidence (${score}/100)`;
}

/** Pick the single best metric for a given canonical type */
function pickMetric(
  allBest: StoredBestMetric[],
  canonicalType: string
): StoredBestMetric | null {
  const candidates = allBest
    .filter((m) => m.canonical_type === canonicalType && m.value != null)
    .sort((a, b) => {
      const src = (s: string) => (s === "csv" || s === "xlsx" ? 2 : s === "pdf" ? 1 : 0);
      return src(b.source_file_type) - src(a.source_file_type) || b.confidence - a.confidence;
    });
  return candidates[0] ?? null;
}

function pickDerived(allDerived: StoredDerivedMetric[], canonicalType: string): number | null {
  const found = allDerived.filter((d) => d.canonical_type === canonicalType && d.value != null)
    .sort((a, b) => b.confidence - a.confidence)[0];
  return found?.value ?? null;
}

function formatMetricLine(m: StoredBestMetric, derivedLabel?: string | null): string {
  const val = formatKpiValue(m.value!, m.unit);
  const period = m.period ? ` (${m.period})` : "";
  const src = m.source_file_type.toUpperCase();
  const extra = derivedLabel ? ` — ${derivedLabel}` : "";
  const derived = m.is_derived ? " *(derived)*" : "";
  return `${val}${period} [${src}]${extra}${derived}`;
}

/** Filter answers by question type keywords */
function answersByType(answers: AnswerSummary[], ...types: string[]): AnswerSummary[] {
  return answers.filter((a) => types.includes(a.question_type) && a.answer_text);
}

/** Trim answer text to a clean paragraph (first N chars) */
function trimAnswer(text: string | null, maxChars = 400): string {
  if (!text) return "";
  const clean = text.replace(/^(Insufficient data:|•\s*)/gm, "").trim();
  return clean.length > maxChars ? clean.slice(0, maxChars).trimEnd() + "…" : clean;
}

// ─── Structured markdown builders (no AI, deterministic) ─────────────────────

function buildMetricsSection(ctx: WorkspaceContext): string {
  const lines: string[] = [];

  const revenue = pickMetric(ctx.allBestMetrics, "revenue");
  const ebitda = pickMetric(ctx.allBestMetrics, "ebitda");
  const netIncome = pickMetric(ctx.allBestMetrics, "net_income");
  const grossProfit = pickMetric(ctx.allBestMetrics, "gross_profit");
  const opIncome = pickMetric(ctx.allBestMetrics, "operating_income");

  const revYoy = pickDerived(ctx.allDerivedMetrics, "yoy_growth");
  const ebitdaMargin = pickDerived(ctx.allDerivedMetrics, "ebitda_margin");
  const netMargin = pickDerived(ctx.allDerivedMetrics, "net_margin");
  const grossMargin = pickDerived(ctx.allDerivedMetrics, "gross_margin");

  if (revenue) lines.push(`- **Revenue:** ${formatMetricLine(revenue, revYoy != null ? `${revYoy > 0 ? "+" : ""}${revYoy.toFixed(1)}% YoY` : null)}`);
  if (ebitda) lines.push(`- **EBITDA:** ${formatMetricLine(ebitda, ebitdaMargin != null ? `${ebitdaMargin.toFixed(1)}% margin` : null)}`);
  if (netIncome) lines.push(`- **Net Income:** ${formatMetricLine(netIncome, netMargin != null ? `${netMargin.toFixed(1)}% margin` : null)}`);
  if (grossProfit) lines.push(`- **Gross Profit:** ${formatMetricLine(grossProfit, grossMargin != null ? `${grossMargin.toFixed(1)}% margin` : null)}`);
  if (opIncome) lines.push(`- **Operating Income:** ${formatMetricLine(opIncome)}`);

  return lines.length > 0 ? lines.join("\n") : "_No financial metrics extracted._";
}

function buildConflictSection(ctx: WorkspaceContext): string {
  if (ctx.allContradictions.length === 0) return "_No material discrepancies detected across sources._";

  return ctx.allContradictions.slice(0, 6).map((c) => {
    const severity = c.classification === "conflict" ? "⚠ Conflict" : "~ Minor Variance";
    const period = c.normalizedPeriod ? ` (${c.normalizedPeriod})` : "";
    return `- **${severity} — ${c.canonical_type}${period}:** ${c.notes}`;
  }).join("\n");
}

function buildSourceList(ctx: WorkspaceContext): string {
  return ctx.documents.map((d) => `- ${d.name} *(${d.file_type.toUpperCase()})*`).join("\n");
}

// ─── Claude prompt builders ───────────────────────────────────────────────────

function buildExecutivePrompt(ctx: WorkspaceContext): string {
  const metricsBlock = buildMetricsSection(ctx);
  const insights = answersByType(ctx.answers, "general", "operational")
    .slice(0, 4)
    .map((a) => `Q: ${a.question_text}\nA: ${trimAnswer(a.answer_text, 200)}`)
    .join("\n\n");
  const risks = answersByType(ctx.answers, "risk")
    .slice(0, 3)
    .map((a) => trimAnswer(a.answer_text, 200))
    .join("\n");

  return `You are a senior financial analyst writing a concise executive summary memo.

WORKSPACE: ${ctx.workspaceName}
PERIOD: ${ctx.dominantPeriod ?? "Period not specified"}
DOCUMENTS: ${ctx.documents.map((d) => d.name).join(", ")}

EXTRACTED METRICS (authoritative — do not alter values):
${metricsBlock}

KEY ANALYST Q&A:
${insights || "_No narrative insights available._"}

RISKS:
${risks || "_No risk answers available._"}

CONFIDENCE: ${ctx.overallConfidence}/100 — ${confidenceLabel(ctx.overallConfidence)}
CONFLICTS DETECTED: ${ctx.hasConflicts ? "Yes" : "No"}

TASK: Write an executive summary memo in clean markdown.

REQUIRED STRUCTURE (use these exact headings):
## Key Takeaways
3 bullet points. Each starts with a bold label. Be specific — use exact metric values from above.

## Financial Highlights
Use the extracted metrics above. Do not invent numbers. Format as a short bullet list.

## Key Insights
2–3 bullets summarising performance drivers and qualitative observations.

## Key Risks
2–3 bullets from the risk Q&A. Be direct.

## Confidence Assessment
One sentence stating overall data quality and reliability.

RULES:
- Use exact numbers from the metrics block — do not round, estimate, or fabricate.
- Write in analyst memo tone, not chatbot tone.
- No preamble. Start with ## Key Takeaways.
- Total length: ~300 words.`;
}

function buildAnalystBriefPrompt(ctx: WorkspaceContext): string {
  const metricsBlock = buildMetricsSection(ctx);
  const conflictsBlock = buildConflictSection(ctx);
  const sources = buildSourceList(ctx);

  const answerBlock = ctx.answers
    .map((a) => `**Q (${a.question_type}): ${a.question_text}**\n${trimAnswer(a.answer_text, 350)}`)
    .join("\n\n");

  const derivedBlock = ctx.allDerivedMetrics
    .filter((d) => d.value != null)
    .slice(0, 8)
    .map((d) => {
      const val = formatKpiValue(d.value!, d.unit);
      return `- ${d.metric_name}: ${val}${d.period ? ` (${d.period})` : ""}`;
    })
    .join("\n");

  return `You are a senior financial analyst writing a structured analyst brief for an investment or due-diligence audience.

WORKSPACE: ${ctx.workspaceName}
PERIOD: ${ctx.dominantPeriod ?? "Not specified"}
DOCUMENTS ANALYSED:
${sources}

EXTRACTED FINANCIAL METRICS (do not alter these values):
${metricsBlock}

ALL MATRIX Q&A (ranked by confidence — use as primary source of narrative):
${answerBlock || "_No answers available._"}

DERIVED METRICS (calculated from raw values):
${derivedBlock || "_None computed._"}

CROSS-SOURCE DISCREPANCIES:
${conflictsBlock}

OVERALL CONFIDENCE: ${ctx.overallConfidence}/100 (${confidenceLabel(ctx.overallConfidence)})

TASK: Write a structured analyst brief in clean, professional markdown.

REQUIRED SECTIONS (use these EXACT headings):
## 1. Overview
2–3 sentence company/period summary. Name the company/workspace and the period.

## 2. Financial Performance
Use the extracted metrics verbatim. Include margins and growth rates where derived metrics are provided. Do not invent numbers.

## 3. Performance Drivers
What drove results? Source from the analytical Q&A answers. 3–5 bullets.

## 4. Risks and Challenges
Structured bullets from risk Q&A. Be direct and specific.

## 5. Strategic Outlook
Forward-looking themes from strategy/general Q&A. 3–4 bullets.

## 6. Contradictions and Variances
Summarise the discrepancies block above. If none, note "No material discrepancies detected."

## 7. Derived Insights
Briefly explain any calculated metrics (margins, ratios, growth rates). Reference the derived metrics block.

## 8. Confidence Assessment
State the overall confidence score, what drives it up or down, and how much the reader should weight the analysis.

RULES:
- Use exact metric values — no rounding or approximation unless the value itself is approximate.
- Source-aware language is required: "Per the earnings transcript…", "CSV data confirms…"
- No preamble. Start directly with ## 1. Overview.
- Analyst memo tone — institutional, direct, no hedging stacks.
- Target length: 500–700 words.`;
}

// ─── Main export functions ────────────────────────────────────────────────────

export async function generateExecutiveSummary(
  supabase: SupabaseClient<Database>,
  workspaceId: string
): Promise<GeneratedReport> {
  const ctx = await assembleContext(supabase, workspaceId);

  if (ctx.answers.length === 0) {
    const markdown = `# ${ctx.workspaceName} — Executive Summary\n\n> No completed analysis found. Run the matrix to generate insights before exporting.\n`;
    return {
      mode: "executive",
      workspace_name: ctx.workspaceName,
      generated_at: new Date().toISOString(),
      markdown,
      overall_confidence: 0,
      confidence_label: "Low",
      has_conflicts: false,
      dominant_period: null,
    };
  }

  const systemPrompt = "You are a concise, professional financial analyst writing an executive summary memo. Use exact data provided. No preamble.";
  const userPrompt = buildExecutivePrompt(ctx);

  const narrative = await runTextCompletion(systemPrompt, userPrompt, DEFAULT_MODEL, 1500);

  const header = [
    `# ${ctx.workspaceName} — Executive Summary`,
    ctx.dominantPeriod ? `**Period:** ${ctx.dominantPeriod}` : "",
    `**Generated:** ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`,
    `**Confidence:** ${confidenceBadge(ctx.overallConfidence)}`,
    ctx.hasConflicts ? `**⚠ Conflicting signals detected across sources**` : "",
    "",
    "---",
    "",
  ].filter((l) => l !== undefined && !(l === "" && false)).join("\n").replace(/\n{3,}/g, "\n\n");

  const footer = [
    "",
    "---",
    "",
    "### Data Sources",
    buildSourceList(ctx),
    "",
    `*Report generated by Numera · ${new Date().toISOString()}*`,
  ].join("\n");

  return {
    mode: "executive",
    workspace_name: ctx.workspaceName,
    generated_at: new Date().toISOString(),
    markdown: header + narrative + footer,
    overall_confidence: ctx.overallConfidence,
    confidence_label: confidenceLabel(ctx.overallConfidence),
    has_conflicts: ctx.hasConflicts,
    dominant_period: ctx.dominantPeriod,
  };
}

export async function generateAnalystBrief(
  supabase: SupabaseClient<Database>,
  workspaceId: string
): Promise<GeneratedReport> {
  const ctx = await assembleContext(supabase, workspaceId);

  if (ctx.answers.length === 0) {
    const markdown = `# ${ctx.workspaceName} — Analyst Brief\n\n> No completed analysis found. Run the matrix to generate insights before exporting.\n`;
    return {
      mode: "analyst",
      workspace_name: ctx.workspaceName,
      generated_at: new Date().toISOString(),
      markdown,
      overall_confidence: 0,
      confidence_label: "Low",
      has_conflicts: false,
      dominant_period: null,
    };
  }

  const systemPrompt = "You are a senior financial analyst writing a structured investment research brief. Use exact data provided. No preamble.";
  const userPrompt = buildAnalystBriefPrompt(ctx);

  const narrative = await runTextCompletion(systemPrompt, userPrompt, DEFAULT_MODEL, 2500);

  const header = [
    `# ${ctx.workspaceName} — Analyst Brief`,
    `**Period:** ${ctx.dominantPeriod ?? "Multiple periods"}  `,
    `**Generated:** ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}  `,
    `**Overall Confidence:** ${confidenceBadge(ctx.overallConfidence)}  `,
    ctx.hasConflicts ? `**Data Quality Note:** ⚠ Conflicting signals detected — see Section 6.  ` : "",
    "",
    "---",
    "",
  ].filter(Boolean).join("\n");

  const footer = [
    "",
    "---",
    "",
    "### Documents Analysed",
    buildSourceList(ctx),
    "",
    `*This report was generated by Numera's intelligence engine using structured extraction, cross-source validation, and AI synthesis. Figures are sourced from ingested documents — do not independently verify metrics before relying on this analysis. Report generated: ${new Date().toISOString()}*`,
  ].join("\n");

  return {
    mode: "analyst",
    workspace_name: ctx.workspaceName,
    generated_at: new Date().toISOString(),
    markdown: header + narrative + footer,
    overall_confidence: ctx.overallConfidence,
    confidence_label: confidenceLabel(ctx.overallConfidence),
    has_conflicts: ctx.hasConflicts,
    dominant_period: ctx.dominantPeriod,
  };
}
