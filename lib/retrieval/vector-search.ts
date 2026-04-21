/**
 * Vector Retrieval Engine
 *
 * Embeds the analyst's query with Voyage AI, then performs pgvector
 * cosine similarity search over stored document chunk embeddings.
 *
 * Falls back to Postgres full-text search (ts_vector) if:
 *   - VOYAGE_API_KEY is not set (stub embeddings)
 *   - pgvector RPC returns an error
 *   - No chunks have stored embeddings yet
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { embedQuery } from "@/lib/ai/embeddings";

export interface RetrievalResult {
  id: string;
  document_id: string;
  content: string;
  page_number: number | null;
  section_title: string | null;
  similarity: number;
}

export interface RetrievalOptions {
  workspaceId: string;
  documentIds: string[];
  /** Cosine similarity threshold (0–1). Default 0.4 for good recall. */
  matchThreshold?: number;
  matchCount?: number;
}

/**
 * Main retrieval function.
 * Generates a query embedding via Voyage AI, then calls the
 * `match_document_chunks` Postgres RPC function (defined in schema.sql).
 */
export async function retrieveRelevantChunks(
  supabase: SupabaseClient<Database>,
  query: string,
  options: RetrievalOptions
): Promise<RetrievalResult[]> {
  const {
    workspaceId,
    documentIds,
    matchThreshold = 0.4,
    matchCount = 8,
  } = options;

  if (documentIds.length === 0) return [];

  // Generate query embedding (Voyage AI or stub)
  const queryEmbedding = await embedQuery(query);
  const isStubEmbedding = queryEmbedding.every((v) => Math.abs(v) < 0.01);

  if (isStubEmbedding) {
    console.warn(
      "[Retrieval] Using stub query embedding — falling back to full-text search"
    );
    return fullTextSearch(supabase, query, workspaceId, documentIds, matchCount);
  }

  // pgvector similarity search via RPC
  const { data, error } = await supabase.rpc("match_document_chunks", {
    query_embedding: JSON.stringify(queryEmbedding),
    workspace_id: workspaceId,
    document_ids: documentIds,
    match_threshold: matchThreshold,
    match_count: matchCount,
  });

  if (error) {
    console.error("[Retrieval] pgvector RPC error:", error.message);
    return fullTextSearch(supabase, query, workspaceId, documentIds, matchCount);
  }

  const results = (data ?? []) as RetrievalResult[];

  // If vector search returns nothing, try full-text as fallback
  if (results.length === 0) {
    console.info("[Retrieval] Vector search returned 0 results — trying full-text fallback");
    return fullTextSearch(supabase, query, workspaceId, documentIds, matchCount);
  }

  return results;
}

/**
 * Postgres full-text search fallback.
 * Used when embeddings are not available or vector search fails.
 */
async function fullTextSearch(
  supabase: SupabaseClient<Database>,
  query: string,
  workspaceId: string,
  documentIds: string[],
  limit: number
): Promise<RetrievalResult[]> {
  // Build a websearch_to_tsquery-compatible string.
  // Use AND-first: require all meaningful terms. This gives far better
  // precision for financial queries like "net profit" or "total revenue".
  // Strip stopwords manually so short but meaningful tokens like "net" aren't dropped.
  const STOPWORDS = new Set(["what", "the", "is", "are", "for", "and", "how", "its", "that"]);
  const allTerms = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .slice(0, 8);

  if (allTerms.length === 0) return [];

  // Try AND query first (all terms present) — fall back to OR if none found
  const andTerms = allTerms.join(" ");   // websearch_to_tsquery treats space as AND
  const orTerms  = allTerms.join(" OR "); // fallback

  // Try AND query first; fall back to OR if the narrow query returns nothing
  let { data, error } = await supabase
    .from("document_chunks")
    .select("id, document_id, content, page_number, section_title")
    .eq("workspace_id", workspaceId)
    .in("document_id", documentIds)
    .textSearch("content", andTerms, { type: "websearch" })
    .limit(limit);

  if (error) {
    console.error("[Retrieval] Full-text search error (AND):", error.message);
    return [];
  }

  if (!data || data.length === 0) {
    // Fall back to OR query for broader recall
    const fb = await supabase
      .from("document_chunks")
      .select("id, document_id, content, page_number, section_title")
      .eq("workspace_id", workspaceId)
      .in("document_id", documentIds)
      .textSearch("content", orTerms, { type: "websearch" })
      .limit(limit);
    if (!fb.error) data = fb.data;
  }

  return (data ?? []).map((row) => ({
    ...row,
    page_number: row.page_number ?? null,
    section_title: row.section_title ?? null,
    similarity: 0.5, // Placeholder relevance for FTS results
  }));
}

/**
 * Reranks retrieval results by similarity score (descending).
 * In production, replace with a Voyage AI or Cohere reranker call
 * for better cross-encoder quality.
 *
 * TODO (v2): Integrate voyage-reranker-lite or Cohere Rerank API
 */
export function rerankResults(
  results: RetrievalResult[],
  _query: string
): RetrievalResult[] {
  return [...results].sort((a, b) => b.similarity - a.similarity);
}
