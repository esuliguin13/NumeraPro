/**
 * Query Orchestrator
 *
 * Execution flow per matrix cell:
 *
 *   1. Classify question → retrieval strategy
 *   2. Fetch structured metrics for this document
 *   3. Fetch all workspace metrics (for cross-document contradiction analysis)
 *   4. Run intelligence engine:
 *        normalize → derive → detect contradictions → select best → confidence factors
 *   5. Run vector retrieval if needed (skipped only when structured data is sufficient)
 *   6. Synthesize answer via Claude using intelligence context
 *   7. Apply calibrated confidence (overrides raw model confidence)
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import type { MatrixQuestionRow, ExtractedMetricRow } from "@/types";
import type { SourceFileType } from "@/lib/intelligence/types";
import type { IntelligenceResult } from "@/lib/intelligence/types";
import {
  retrieveRelevantChunks,
  rerankResults,
  type RetrievalResult,
} from "@/lib/retrieval/vector-search";
import {
  synthesizeAnswer,
  classifyQuestion,
  type ExtractionMethod,
} from "./answer-synthesizer";
import { runIntelligence, buildIntelligenceContext } from "@/lib/intelligence";
import { calibrateConfidence } from "@/lib/intelligence/confidence";
import { classifyQuestionType, type QuestionType } from "@/lib/intelligence/question-classifier";

export type { ExtractionMethod };

export interface OrchestratorInput {
  workspaceId: string;
  documentId: string;
  question: MatrixQuestionRow;
}

export interface OrchestratorResult {
  answerText: string;
  confidenceScore: number;
  extractionMethod: ExtractionMethod;
  questionType: QuestionType;
  sources: RetrievalResult[];
  structuredMetrics: ExtractedMetricRow[];
  processingTimeMs: number;
  intelligence: IntelligenceResult;
}

// ─── Workspace metric fetch ───────────────────────────────────────────────────

type MetricWithFileType = ExtractedMetricRow & { fileType: SourceFileType };

async function fetchMetricsWithFileType(
  supabase: SupabaseClient<Database>,
  filter: { workspaceId: string; documentId?: string }
): Promise<MetricWithFileType[]> {
  let query = supabase
    .from("extracted_financial_metrics")
    .select("*, documents!inner(file_type)")
    .eq("workspace_id", filter.workspaceId)
    .order("confidence", { ascending: false });

  if (filter.documentId) {
    query = query.eq("document_id", filter.documentId);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[Orchestrator] Metrics fetch error:", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docJoin = (row as any).documents;
    const fileType: SourceFileType =
      (docJoin?.file_type as SourceFileType) ?? "txt";
    // Strip the joined field before returning
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { documents: _d, ...metric } = row as typeof row & { documents: unknown };
    return { ...(metric as ExtractedMetricRow), fileType };
  });
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function executeMatrixCell(
  supabase: SupabaseClient<Database>,
  input: OrchestratorInput
): Promise<OrchestratorResult> {
  const startTime = Date.now();
  const { workspaceId, documentId, question } = input;

  // ── 1. Classify question ────────────────────────────────────────────────
  // Two complementary classifiers:
  //   strategy  → which data sources to fetch (structured / retrieval / hybrid)
  //   questionType → which answer format to use (financial / analytical / qualitative)
  const [strategy, questionType] = await Promise.all([
    classifyQuestion(question.question_text),
    Promise.resolve(classifyQuestionType(question.question_text)), // sync, wrapped for parallel
  ]);
  console.log(
    `[Orchestrator] "${question.question_text.slice(0, 60)}…" → strategy: ${strategy}, type: ${questionType}`
  );

  // ── 2. Fetch this document's structured metrics (with file type) ─────────
  const thisDocMetrics = await fetchMetricsWithFileType(supabase, {
    workspaceId,
    documentId,
  });
  console.log(
    `[Orchestrator] Loaded ${thisDocMetrics.length} structured metrics for document`
  );

  // ── 3. Fetch all workspace metrics for cross-document contradiction ───────
  const allWorkspaceMetrics = await fetchMetricsWithFileType(supabase, {
    workspaceId,
  });

  // ── 4. Run intelligence engine ───────────────────────────────────────────
  // We'll pass modelRawConfidence=50 as a placeholder; it will be updated
  // after synthesis returns the real confidence.
  const intelligence = runIntelligence({
    thisDocMetrics,
    allWorkspaceMetrics,
    question: question.question_text,
    retrievalHitCount: 0,      // updated after retrieval
    modelRawConfidence: 50,    // placeholder; updated after synthesis
  });

  console.log(
    `[Intelligence] ${intelligence.summary.totalMetrics} metrics, ` +
    `${intelligence.summary.derivedCount} derived, ` +
    `${intelligence.summary.conflictCount} conflicts, ` +
    `sources: [${intelligence.summary.primarySources.join(", ")}]`
  );

  // ── 5. Decide whether to run retrieval ──────────────────────────────────
  const hasHighConfidenceMetrics =
    intelligence.bestMetrics.length > 0 &&
    intelligence.bestMetrics.some((m) => m.confidence >= 80);

  // Qualitative questions always need document passages regardless of structured data.
  // Financial questions can skip retrieval when high-confidence structured metrics exist.
  const needsRetrieval =
    questionType === "qualitative" ||
    strategy === "retrieval" ||
    strategy === "hybrid" ||
    !hasHighConfidenceMetrics;

  let retrievedChunks: RetrievalResult[] = [];
  if (needsRetrieval) {
    const raw = await retrieveRelevantChunks(supabase, question.question_text, {
      workspaceId,
      documentIds: [documentId],
      matchThreshold: 0.2,   // Lowered from 0.35 — voyage-finance-2 cosine scores cluster lower
      matchCount: 10,
    });
    retrievedChunks = rerankResults(raw, question.question_text);
    console.log(`[Orchestrator] Retrieved ${retrievedChunks.length} chunks`);
  } else {
    console.log(`[Orchestrator] Skipping retrieval — structured data is sufficient`);
  }

  // ── 6. Build intelligence context string for synthesis ───────────────────
  const intelligenceContext = buildIntelligenceContext(intelligence);

  // ── 7. Synthesize answer ─────────────────────────────────────────────────
  //
  // If the intelligence engine produced no bestMetrics (can happen when the
  // question asks for a metric the normaliser didn't map, e.g. "YoY growth
  // rate"), fall back to the raw extracted metrics from the document so Claude
  // always has something to work with and doesn't produce a blanket
  // "Insufficient data:" when revenue / other figures ARE present.
  const bestMetricsMapped = intelligence.bestMetrics.map((m) => ({
    metric_name: m.metricName,
    value: m.value,
    unit: m.unit,
    period: m.normalizedPeriod,
    confidence: m.confidence,
  }));

  const rawMetricsFallback =
    bestMetricsMapped.length === 0
      ? thisDocMetrics.slice(0, 20).map((m) => ({
          metric_name: m.metric_name,
          value: m.value ?? null,
          unit: m.unit ?? null,
          period: m.period ?? null,
          confidence: m.confidence,
        }))
      : [];

  const metricsForSynthesis = bestMetricsMapped.length > 0
    ? bestMetricsMapped
    : rawMetricsFallback;

  if (rawMetricsFallback.length > 0) {
    console.log(
      `[Orchestrator] bestMetrics empty — using ${rawMetricsFallback.length} raw metrics as fallback`
    );
  }

  const { answerText, confidenceScore: modelConfidence } = await synthesizeAnswer({
    question: question.question_text,
    questionType,
    retrievedChunks,
    structuredMetrics: metricsForSynthesis,
    extractionMethod: strategy,
    intelligenceContext,
  });

  // ── 8. Calibrated confidence (re-run with real values) ───────────────────
  const finalIntelligence = runIntelligence({
    thisDocMetrics,
    allWorkspaceMetrics,
    question: question.question_text,
    retrievalHitCount: retrievedChunks.length,
    modelRawConfidence: modelConfidence,
  });

  const calibrated = calibrateConfidence(finalIntelligence.confidenceFactors);
  const finalConfidence = calibrated.score;

  console.log(
    `[Orchestrator] confidence: model=${modelConfidence} → calibrated=${finalConfidence} ` +
    `(agreement=${finalIntelligence.confidenceFactors.contradictionClass})`
  );

  return {
    answerText,
    confidenceScore: finalConfidence,
    extractionMethod: strategy,
    questionType,
    sources: retrievedChunks,
    structuredMetrics: thisDocMetrics,
    processingTimeMs: Date.now() - startTime,
    intelligence: finalIntelligence,
  };
}
