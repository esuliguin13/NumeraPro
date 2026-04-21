/**
 * Answer Synthesizer — Orchestration Layer Adapter
 *
 * This module is the thin adapter between the query orchestrator and
 * the lib/ai/synthesis module. It translates orchestrator types into
 * AI layer types and back.
 *
 * All Claude-specific logic lives in lib/ai/synthesis.ts.
 */

import {
  synthesizeAnswer as claudeSynthesize,
  classifyQuestion as claudeClassify,
} from "@/lib/ai/synthesis";
import type { SynthesisRequest, SynthesisResponse } from "@/lib/ai/types";
import type { RetrievalResult } from "@/lib/retrieval/vector-search";
import type { ExtractedMetricRow } from "@/types";

export type ExtractionMethod = "structured" | "retrieval" | "hybrid";

export interface SynthesisInput {
  question: string;
  retrievedChunks: RetrievalResult[];
  structuredMetrics: ExtractedMetricRow[];
  extractionMethod: ExtractionMethod;
  /** Pre-formatted intelligence context string from the intelligence engine. */
  intelligenceContext?: string;
  /** Answer format type — drives prompt selection and cell display. */
  questionType?: "financial" | "analytical" | "qualitative" | "comparison";
}

export interface SynthesisOutput {
  answerText: string;
  confidenceScore: number;
}

/**
 * Synthesizes an answer from retrieved chunks and structured metrics.
 * Delegates to Claude Sonnet via the lib/ai/synthesis module.
 */
export async function synthesizeAnswer(
  input: SynthesisInput
): Promise<SynthesisOutput> {
  const request: SynthesisRequest = {
    question: input.question,
    extractionMethod: input.extractionMethod,
    questionType: input.questionType,
    retrievedChunks: input.retrievedChunks.map((c) => ({
      id: c.id,
      document_id: c.document_id,
      content: c.content,
      page_number: c.page_number,
      section_title: c.section_title,
      similarity: c.similarity,
    })),
    structuredMetrics: input.structuredMetrics.map((m) => ({
      metric_name: "metric_name" in m ? (m as { metric_name: string }).metric_name : "",
      value: "value" in m ? (m as { value: number | null }).value : null,
      unit: "unit" in m ? (m as { unit: string | null }).unit : null,
      period: "period" in m ? (m as { period: string | null }).period : null,
      confidence: "confidence" in m ? Number((m as { confidence: number }).confidence) : 0,
    })),
    intelligenceContext: input.intelligenceContext,
  };

  const result: SynthesisResponse = await claudeSynthesize(request);

  return {
    answerText: result.answer,
    confidenceScore: result.confidence,
  };
}

/**
 * Re-export question classifier from AI layer.
 * Used by query orchestrator to pick retrieval strategy.
 */
export { claudeClassify as classifyQuestion };
