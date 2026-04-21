/**
 * Answer Synthesis
 *
 * Uses Claude Sonnet with tool use to synthesize a final, cited answer
 * from retrieved document chunks and structured financial metrics.
 *
 * Tool use (vs. plain text) guarantees a typed JSON response with both
 * the answer text and a calibrated confidence score.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { runToolCall, runTextCompletion, FAST_MODEL, DEFAULT_MODEL } from "./anthropic";
import {
  SYNTHESIS_SYSTEM_PROMPT,
  QUALITATIVE_SYNTHESIS_SYSTEM_PROMPT,
  ANALYTICAL_SYNTHESIS_SYSTEM_PROMPT,
  CLASSIFICATION_SYSTEM_PROMPT,
  buildSynthesisUserPrompt,
  buildClassificationUserPrompt,
} from "./prompts";
import type {
  SynthesisRequest,
  SynthesisResponse,
  RetrievedChunk,
  StructuredMetric,
} from "./types";

// ─── Tool Definition ─────────────────────────────────────────────────────────

const SYNTHESIS_TOOL: Anthropic.Tool = {
  name: "provide_answer",
  description:
    "Provide a structured answer to the analyst's question with a confidence score and source agreement assessment.",
  input_schema: {
    type: "object" as const,
    properties: {
      answer: {
        type: "string",
        description:
          "The complete answer to the analyst's question. Cite structured metrics as [Metric N] " +
          "and document passages as [Source N]. Use exact figures. State clearly if information is insufficient.",
      },
      confidence: {
        type: "number",
        description:
          "Confidence score 0–100. " +
          "90–100: multiple sources corroborate the same value; " +
          "85–89: single high-confidence structured metric answers directly; " +
          "65–84: synthesis required or lower-confidence data; " +
          "40–64: partial information; " +
          "10–39: speculative; " +
          "0–9: no relevant info. " +
          "Reduce by 10–20 when sources conflict.",
        minimum: 0,
        maximum: 100,
      },
      source_agreement: {
        type: "string",
        enum: ["corroborated", "conflicting", "single_source", "no_data"],
        description:
          "corroborated: structured metrics and document passages agree on values. " +
          "conflicting: sources state different values for the same metric. " +
          "single_source: only one type of source (structured or retrieval) has relevant data. " +
          "no_data: neither source contains relevant information.",
      },
      key_figures: {
        type: "array",
        description: "Optional: up to 3 key numeric figures from the answer for quick display.",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            value: { type: "string" },
          },
          required: ["label", "value"],
        },
      },
    },
    required: ["answer", "confidence", "source_agreement"],
  },
};

interface SynthesisToolInput {
  answer: string;
  confidence: number;
  source_agreement: "corroborated" | "conflicting" | "single_source" | "no_data";
  key_figures?: Array<{ label: string; value: string }>;
}

// ─── Context builders ─────────────────────────────────────────────────────────

function buildStructuredMetricsContext(metrics: StructuredMetric[]): string {
  if (metrics.length === 0) return "";
  return metrics
    .map(
      (m, i) => {
        const valueStr = m.value !== null
          ? `${m.value}${m.unit ? " " + m.unit : ""}`
          : "N/A";
        const periodStr = m.period ? ` (${m.period})` : "";
        const confidenceLabel = m.confidence === 100
          ? "ground truth — CSV-derived"
          : m.confidence >= 80
          ? "high confidence"
          : "moderate confidence";
        return `[Metric ${i + 1}] ${m.metric_name}: ${valueStr}${periodStr} [${m.confidence}% — ${confidenceLabel}]`;
      }
    )
    .join("\n");
}

function buildRetrievedChunksContext(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return "";
  return chunks
    .map(
      (c, i) =>
        `[Source ${i + 1}]` +
        (c.page_number ? ` | Page ${c.page_number}` : "") +
        (c.section_title ? ` | ${c.section_title}` : "") +
        `\n${c.content.trim()}`
    )
    .join("\n\n---\n\n");
}

// ─── Question classification ──────────────────────────────────────────────────

type ExtractionMethod = "structured" | "retrieval" | "hybrid";

/**
 * Uses claude-haiku (fast, cheap) to classify the question intent
 * and determine which retrieval strategy to use.
 */
export async function classifyQuestion(
  question: string
): Promise<ExtractionMethod> {
  try {
    const result = await runTextCompletion(
      CLASSIFICATION_SYSTEM_PROMPT,
      buildClassificationUserPrompt(question),
      FAST_MODEL,
      16 // We only need a single word back
    );

    const cleaned = result.trim().toLowerCase().replace(/['"]/g, "");
    if (cleaned === "structured" || cleaned === "retrieval" || cleaned === "hybrid") {
      return cleaned;
    }
    return "hybrid"; // safe default
  } catch {
    // Fallback to heuristic classification if LLM call fails
    return classifyQuestionHeuristic(question);
  }
}

/** Lightweight regex-based fallback when Claude isn't available */
function classifyQuestionHeuristic(question: string): ExtractionMethod {
  const q = question.toLowerCase();
  const numericKw = [
    "revenue", "ebitda", "margin", "income", "profit", "loss", "eps",
    "earnings", "sales", "growth", "cagr", "guidance", "headcount",
    "employees", "capex", "cash flow", "debt", "leverage", "arpu",
  ];
  const narrativeKw = [
    "why", "how", "describe", "explain", "what are", "strategy", "risk",
    "challenge", "opportunity", "competitive", "management", "outlook",
    "commentary", "discuss", "reason", "driver", "trend",
  ];
  const hasNumeric = numericKw.some((kw) => q.includes(kw));
  const hasNarrative = narrativeKw.some((kw) => q.includes(kw));
  if (hasNumeric && hasNarrative) return "hybrid";
  if (hasNumeric) return "structured";
  return "retrieval";
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Synthesizes a final answer using Claude Sonnet.
 * Returns a structured answer with a calibrated confidence score.
 */
/** Pick the right system prompt based on question type */
function selectSystemPrompt(questionType: SynthesisRequest["questionType"]): string {
  switch (questionType) {
    case "qualitative": return QUALITATIVE_SYNTHESIS_SYSTEM_PROMPT;
    case "analytical":  return ANALYTICAL_SYNTHESIS_SYSTEM_PROMPT;
    // Comparison uses financial prompt but the model is instructed to show delta/change
    case "comparison":
    default:            return SYNTHESIS_SYSTEM_PROMPT;
  }
}

export async function synthesizeAnswer(
  request: SynthesisRequest
): Promise<SynthesisResponse> {
  const { question, retrievedChunks, structuredMetrics, extractionMethod, questionType = "financial" } = request;

  const structuredMetricsContext = buildStructuredMetricsContext(structuredMetrics);
  const retrievedChunksContext = buildRetrievedChunksContext(retrievedChunks);

  const hasContext = structuredMetrics.length > 0 || retrievedChunks.length > 0;

  if (!hasContext) {
    return {
      answer:
        "No relevant information was found in this document for the given question. " +
        "Ensure the document has been fully ingested and that the question is relevant " +
        "to the document's content.",
      confidence: 5,
    };
  }

  const userPrompt = buildSynthesisUserPrompt({
    question,
    structuredMetricsContext,
    retrievedChunksContext,
    extractionMethod,
    intelligenceContext: request.intelligenceContext,
    questionType,
  });

  const systemPrompt = selectSystemPrompt(questionType);

  try {
    const result = await runToolCall<SynthesisToolInput>(
      systemPrompt,
      userPrompt,
      SYNTHESIS_TOOL,
      DEFAULT_MODEL,
      2048
    );

    // Apply confidence bounds based on source_agreement
    let confidence = Math.round(result.confidence);
    if (result.source_agreement === "corroborated") {
      confidence = Math.min(100, confidence + 5); // small boost for multi-source agreement
    } else if (result.source_agreement === "conflicting") {
      confidence = Math.max(0, confidence - 15); // penalise conflicting sources
    }

    console.log(
      `[Synthesis] source_agreement=${result.source_agreement}, ` +
      `confidence=${confidence} (raw: ${result.confidence})`
    );

    return {
      answer: result.answer,
      confidence: Math.min(100, Math.max(0, confidence)),
    };
  } catch (err) {
    console.error("[Synthesis] Claude call failed:", err instanceof Error ? err.message : err);

    // Graceful degradation: return context excerpt as answer
    const fallbackAnswer = retrievedChunks[0]
      ? `Based on the document: "${retrievedChunks[0].content.slice(0, 400)}…"\n\n` +
        "(Note: AI synthesis unavailable — showing raw source passage. " +
        "Check ANTHROPIC_API_KEY configuration.)"
      : "Answer synthesis unavailable. Please check ANTHROPIC_API_KEY configuration.";

    return { answer: fallbackAnswer, confidence: 20 };
  }
}
