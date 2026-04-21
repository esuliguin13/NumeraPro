/**
 * Embedding Provider Abstraction
 *
 * Anthropic does not provide embedding models. This module wraps
 * Voyage AI (https://www.voyageai.com), which Anthropic recommends
 * for use with Claude. Voyage models are optimized for retrieval tasks
 * and have a best-in-class "voyage-finance-2" model for financial text.
 *
 * Configuration:
 *   VOYAGE_API_KEY  — your Voyage AI API key (from dash.voyageai.com)
 *   VOYAGE_MODEL    — embedding model to use (default: voyage-finance-2)
 *
 * If VOYAGE_API_KEY is not set, the module falls back to deterministic
 * stub vectors so the rest of the pipeline can run. In that mode,
 * semantic search will return random/poor results — add a real key
 * to enable production-quality retrieval.
 *
 * Voyage AI docs: https://docs.voyageai.com/reference/embeddings-api
 */

import type { EmbeddingRequest, EmbeddingResponse } from "./types";

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const VOYAGE_MODEL = process.env.VOYAGE_MODEL ?? "voyage-finance-2";
/** Dimension of voyage-finance-2 and voyage-3 embeddings */
const EMBEDDING_DIM = 1024;

// ─── Voyage AI caller ────────────────────────────────────────────────────────

interface VoyageEmbeddingResponse {
  data: Array<{ embedding: number[]; index: number }>;
  model: string;
  usage: { total_tokens: number };
}

async function callVoyageAI(texts: string[]): Promise<number[][]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY not set");

  // Voyage API accepts up to 128 texts per request
  const BATCH_SIZE = 64;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    const res = await fetch(VOYAGE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        input: batch,
        model: VOYAGE_MODEL,
        input_type: "document", // "document" for indexing, "query" for search queries
      }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => "unknown error");
      throw new Error(`Voyage AI API error ${res.status}: ${errorText}`);
    }

    const json: VoyageEmbeddingResponse = await res.json();
    // Sort by index to preserve order
    const sorted = [...json.data].sort((a, b) => a.index - b.index);
    allEmbeddings.push(...sorted.map((d) => d.embedding));
  }

  return allEmbeddings;
}

async function callVoyageAIQuery(text: string): Promise<number[]> {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error("VOYAGE_API_KEY not set");

  const res = await fetch(VOYAGE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      input: [text],
      model: VOYAGE_MODEL,
      input_type: "query", // "query" for search queries (different from document)
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "unknown error");
    throw new Error(`Voyage AI API error ${res.status}: ${errorText}`);
  }

  const json: VoyageEmbeddingResponse = await res.json();
  return json.data[0]?.embedding ?? [];
}

// ─── Stub fallback ────────────────────────────────────────────────────────────

/**
 * Deterministic stub that returns zero vectors.
 * pgvector will still work but cosine similarity will be undefined (NaN),
 * so fallback full-text search is used instead.
 */
function stubEmbeddings(count: number): number[][] {
  // Use near-zero random vectors so pgvector doesn't throw on zero-vectors
  return Array.from({ length: count }, () =>
    Array.from({ length: EMBEDDING_DIM }, () => (Math.random() - 0.5) * 0.001)
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generates embeddings for an array of document texts.
 * Used during ingestion to index document chunks.
 */
export async function embedDocuments(
  request: EmbeddingRequest
): Promise<EmbeddingResponse> {
  if (!process.env.VOYAGE_API_KEY) {
    console.warn(
      "[Embeddings] VOYAGE_API_KEY not set — using stub vectors. " +
        "Semantic search will not work correctly."
    );
    return {
      embeddings: stubEmbeddings(request.texts.length),
      isReal: false,
      model: "stub",
    };
  }

  try {
    const embeddings = await callVoyageAI(request.texts);
    return { embeddings, isReal: true, model: VOYAGE_MODEL };
  } catch (err) {
    console.error("[Embeddings] Voyage AI call failed, falling back to stub:", err);
    return {
      embeddings: stubEmbeddings(request.texts.length),
      isReal: false,
      model: "stub-fallback",
    };
  }
}

/**
 * Generates a query embedding for vector similarity search.
 * Used by the retrieval engine when executing matrix cell queries.
 */
export async function embedQuery(query: string): Promise<number[]> {
  if (!process.env.VOYAGE_API_KEY) {
    console.warn("[Embeddings] VOYAGE_API_KEY not set — returning stub query vector.");
    return Array.from({ length: EMBEDDING_DIM }, () => (Math.random() - 0.5) * 0.001);
  }

  try {
    return await callVoyageAIQuery(query);
  } catch (err) {
    console.error("[Embeddings] Voyage AI query embed failed:", err);
    return Array.from({ length: EMBEDDING_DIM }, () => (Math.random() - 0.5) * 0.001);
  }
}

/** Exported dimension constant for schema compatibility */
export const EMBEDDING_DIMENSION = EMBEDDING_DIM;
