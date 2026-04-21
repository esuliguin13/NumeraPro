/**
 * lib/ai — Numera AI Provider Abstraction
 *
 * Primary provider: Anthropic Claude (claude-sonnet-4-5)
 * Embedding provider: Voyage AI (voyage-finance-2)
 *
 * Public exports for use in ingestion pipeline and orchestration layer.
 */

// Anthropic client + helpers
export { getAnthropicClient, runToolCall, runTextCompletion, DEFAULT_MODEL, FAST_MODEL } from "./anthropic";

// Embedding provider (Voyage AI)
export { embedDocuments, embedQuery, EMBEDDING_DIMENSION } from "./embeddings";

// Answer synthesis (Claude Sonnet)
export { synthesizeAnswer, classifyQuestion } from "./synthesis";

// Financial extraction (Claude Haiku)
export { extractMetricsFromPage, extractMetricsFromPages } from "./extraction";

// Types
export type {
  SynthesisRequest,
  SynthesisResponse,
  ExtractionRequest,
  ExtractionResponse,
  ExtractedMetricRaw,
  EmbeddingRequest,
  EmbeddingResponse,
  RetrievedChunk,
  StructuredMetric,
  AIProviderConfig,
} from "./types";
