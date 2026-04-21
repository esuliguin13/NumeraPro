import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { z } from "zod";
import { runIngestionPipeline } from "@/lib/ingestion/pipeline";

const IngestionSchema = z.object({
  document_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  storage_path: z.string().min(1),
  file_type: z.enum(["pdf", "xlsx", "csv", "txt", "transcript"]),
  file_name: z.string().optional(),
});

/**
 * POST /api/ingestion
 *
 * Triggered by the document upload route (fire-and-forget).
 * Downloads the file from Supabase Storage, runs the full ingestion
 * pipeline (parse → chunk → embed → extract), and persists results.
 *
 * Security: In production, protect this endpoint with a shared secret
 * (e.g., check an X-Ingestion-Secret header) to prevent unauthorized calls.
 * Alternatively, move this to a Supabase Edge Function or a background queue.
 */
export async function POST(request: Request) {
  const adminSupabase = await createAdminClient();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = IngestionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation error" },
      { status: 400 }
    );
  }

  const { document_id, workspace_id, storage_path, file_type, file_name } =
    parsed.data;

  // Mark as processing
  await adminSupabase
    .from("documents")
    .update({
      ingestion_status: "processing",
      updated_at: new Date().toISOString(),
    })
    .eq("id", document_id);

  try {
    // ── Download from Supabase Storage ──────────────────────────────────────
    const { data: fileData, error: downloadError } = await adminSupabase.storage
      .from("documents")
      .download(storage_path);

    if (downloadError || !fileData) {
      throw new Error(
        `Storage download failed: ${downloadError?.message ?? "file not found"}`
      );
    }

    const buffer = Buffer.from(await fileData.arrayBuffer());
    console.log(
      `[Ingestion] Downloaded ${storage_path} (${buffer.length} bytes)`
    );

    // ── Run pipeline ─────────────────────────────────────────────────────────
    const result = await runIngestionPipeline(
      buffer,
      file_type,
      document_id,
      file_name ?? storage_path.split("/").pop() ?? "document"
    );

    // ── Persist chunks ────────────────────────────────────────────────────────
    if (result.chunks.length > 0) {
      // Idempotent: delete existing chunks before re-inserting
      await adminSupabase
        .from("document_chunks")
        .delete()
        .eq("document_id", document_id);

      const chunkInserts = result.chunks.map((chunk) => ({
        document_id,
        workspace_id,
        content: chunk.content,
        chunk_index: chunk.chunkIndex,
        page_number: chunk.pageNumber,
        section_title: chunk.sectionTitle,
        token_count: chunk.tokenCount,
        // Store embedding as JSON array string for pgvector
        // pgvector expects the format: '[0.1, 0.2, ...]'
        embedding: result.embeddingsAreReal
          ? `[${chunk.embedding.join(",")}]`
          : null, // Don't store stub embeddings — they'll pollute similarity search
        metadata: chunk.metadata,
      }));

      // Insert in batches of 100 (Supabase row limit per request)
      for (let i = 0; i < chunkInserts.length; i += 100) {
        const batch = chunkInserts.slice(i, i + 100);
        const { error: chunkError } = await adminSupabase
          .from("document_chunks")
          .insert(batch);

        if (chunkError) {
          throw new Error(`Chunk insert failed: ${chunkError.message}`);
        }
      }

      console.log(`[Ingestion] Stored ${result.chunks.length} chunks`);
    }

    // ── Persist extracted metrics ─────────────────────────────────────────────
    if (result.metrics.length > 0) {
      await adminSupabase
        .from("extracted_financial_metrics")
        .delete()
        .eq("document_id", document_id);

      const metricInserts = result.metrics.map((metric) => ({
        document_id,
        workspace_id,
        metric_type: metric.metric_type,
        metric_name: metric.metric_name,
        value: metric.value,
        unit: metric.unit,
        period: metric.period,
        period_type: metric.period_type,
        raw_text: metric.raw_text,
        page_number: metric.page_number,
        confidence: metric.confidence,
        metadata: {},
      }));

      const { error: metricsError } = await adminSupabase
        .from("extracted_financial_metrics")
        .insert(metricInserts);

      if (metricsError) {
        // Non-fatal: log and continue
        console.error("[Ingestion] Metrics insert error:", metricsError.message);
      } else {
        console.log(`[Ingestion] Stored ${result.metrics.length} metrics`);
      }
    }

    // ── Mark document as done ─────────────────────────────────────────────────
    await adminSupabase
      .from("documents")
      .update({
        ingestion_status: "done",
        page_count: result.totalPages,
        ingestion_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", document_id);

    return NextResponse.json({
      success: true,
      document_id,
      chunks_stored: result.chunks.length,
      metrics_stored: result.metrics.length,
      total_pages: result.totalPages,
      embeddings_real: result.embeddingsAreReal,
    });
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "Ingestion failed";

    console.error(`[Ingestion] Pipeline failed for ${document_id}:`, err);

    await adminSupabase
      .from("documents")
      .update({
        ingestion_status: "error",
        ingestion_error: errorMessage.slice(0, 500), // cap at 500 chars
        updated_at: new Date().toISOString(),
      })
      .eq("id", document_id);

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
