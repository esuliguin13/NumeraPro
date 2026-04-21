/**
 * Shared AI type definitions used across the provider abstraction,
 * ingestion pipeline, and orchestration layer.
 */

// ─── Provider config ─────────────────────────────────────────────────────────

export interface AIProviderConfig {
  /** Anthropic model ID, e.g. "claude-sonnet-4-5" */
  model: string;
  /** Max tokens for the response */
  maxTokens: number;
  /** Temperature (0 = deterministic, 1 = creative) */
  temperature: number;
}

export const DEFAULT_CONFIG: AIProviderConfig = {
  model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
  maxTokens: 2048,
  temperature: 0.1,
};

export const FAST_CONFIG: AIProviderConfig = {
  model: "claude-haiku-4-5",
  maxTokens: 1024,
  temperature: 0.1,
};

// ─── Synthesis types ─────────────────────────────────────────────────────────

export interface SynthesisRequest {
  question: string;
  retrievedChunks: RetrievedChunk[];
  structuredMetrics: StructuredMetric[];
  extractionMethod: "structured" | "retrieval" | "hybrid";
  /** Pre-formatted context block from the intelligence engine (canonical metrics, contradictions, derived). */
  intelligenceContext?: string;
  /**
   * Answer format type derived from question classification.
   * Drives which system prompt is used and how the cell displays the result.
   */
  questionType?: "financial" | "analytical" | "qualitative" | "comparison";
}

export interface SynthesisResponse {
  answer: string;
  confidence: number; // 0–100
  reasoning?: string; // Claude's internal reasoning, useful for debug
}

// ─── Extraction types ────────────────────────────────────────────────────────

export interface ExtractionRequest {
  pageText: string;
  pageNumber: number;
  documentName: string;
}

export interface ExtractedMetricRaw {
  metric_type:
    | "revenue"
    | "ebitda"
    | "net_income"
    | "gross_profit"
    | "operating_income"
    | "margin"
    | "guidance"
    | "headcount"
    | "custom";
  metric_name: string;
  value: number | null;
  unit: string | null;
  period: string | null;
  period_type: "annual" | "quarterly" | "ttm" | "other" | null;
  raw_text: string;
  page_number: number | null;
  confidence: number;
}

export interface ExtractionResponse {
  metrics: ExtractedMetricRaw[];
}

// ─── Embedding types ─────────────────────────────────────────────────────────

export interface EmbeddingRequest {
  texts: string[];
}

export interface EmbeddingResponse {
  embeddings: number[][];
  /** true when using real embeddings, false when stub */
  isReal: boolean;
  model: string;
}

// ─── Shared chunk / metric types for orchestration ───────────────────────────

export interface RetrievedChunk {
  id: string;
  document_id: string;
  content: string;
  page_number: number | null;
  section_title: string | null;
  similarity: number;
}

export interface StructuredMetric {
  metric_name: string;
  value: number | null;
  unit: string | null;
  period: string | null;
  confidence: number;
}
