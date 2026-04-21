/**
 * /api/questions/suggest
 *
 * GET  ?workspace_id=xxx   — return stored suggestions (with stale flag)
 * POST { workspace_id, force_regenerate? } — generate & store suggestions
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import {
  generateSuggestedQuestions,
  buildDocumentHash,
} from "@/lib/intelligence/question-generator";
import type { SuggestedQuestionsPayload } from "@/lib/intelligence/question-types";

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspace_id");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 400 });
  }

  const supabase = await createClient();

  // Auth guard
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch stored suggestions
  const { data: row, error } = await supabase
    .from("suggested_questions")
    .select("*")
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error) {
    // "42P01" = undefined_table (migration not yet applied).
    // Treat as "no suggestions yet" so the client falls through to generation.
    const isMissingTable =
      error.code === "42P01" || error.message?.includes("does not exist");
    if (isMissingTable) {
      return NextResponse.json({ suggestions: null, is_stale: false });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!row) {
    return NextResponse.json({ suggestions: null, is_stale: false });
  }

  // Check if suggestions are stale (new docs added since generation)
  const { data: documents } = await supabase
    .from("documents")
    .select("id, ingestion_status")
    .eq("workspace_id", workspaceId);

  const currentHash = buildDocumentHash(documents ?? []);
  const isStale = row.generated_from_hash !== currentHash;

  return NextResponse.json({
    suggestions: row.categories as unknown as SuggestedQuestionsPayload["categories"],
    is_stale: isStale,
    generated_at: row.updated_at,
  });
}

// ─── POST ─────────────────────────────────────────────────────────────────────

const PostSchema = z.object({
  workspace_id: z.string().uuid(),
  force_regenerate: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation error" },
      { status: 400 }
    );
  }

  const { workspace_id, force_regenerate } = parsed.data;

  // Use the admin client for generation so we can bypass RLS when called
  // server-to-server (e.g., triggered from the ingestion route via after()).
  const adminSupabase = await createAdminClient();

  // Check existing suggestions + stale state unless forced
  if (!force_regenerate) {
    try {
      const { data: existing } = await adminSupabase
        .from("suggested_questions")
        .select("generated_from_hash")
        .eq("workspace_id", workspace_id)
        .maybeSingle();

      if (existing) {
        const { data: docs } = await adminSupabase
          .from("documents")
          .select("id, ingestion_status")
          .eq("workspace_id", workspace_id);

        const currentHash = buildDocumentHash(docs ?? []);
        if (existing.generated_from_hash === currentHash) {
          const { data: row } = await adminSupabase
            .from("suggested_questions")
            .select("*")
            .eq("workspace_id", workspace_id)
            .maybeSingle();

          return NextResponse.json({
            suggestions: row?.categories ?? [],
            is_stale: false,
            cached: true,
          });
        }
      }
    } catch {
      // Table may not exist yet — skip cache check and fall through to generation.
    }
  }

  // Generate fresh suggestions
  try {
    const payload: SuggestedQuestionsPayload = await generateSuggestedQuestions(
      adminSupabase,
      workspace_id
    );

    if (payload.categories.length === 0) {
      return NextResponse.json({
        suggestions: [],
        is_stale: false,
        message: "No documents ready for analysis yet.",
      });
    }

    // Compute hash for stale detection
    const { data: docs } = await adminSupabase
      .from("documents")
      .select("id, ingestion_status")
      .eq("workspace_id", workspace_id);

    const hash = buildDocumentHash(docs ?? []);

    // Upsert into suggested_questions — non-fatal if the table doesn't exist yet.
    try {
      await adminSupabase
        .from("suggested_questions")
        .upsert(
          {
            workspace_id,
            categories: payload.categories as unknown as Record<string, unknown>[],
            generated_from_hash: hash,
            source_metadata: {
              document_count: docs?.length ?? 0,
              generated_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "workspace_id" }
        );
    } catch (upsertErr) {
      // Log but don't fail the request — the client still gets the suggestions.
      console.error("[suggest] Upsert failed (run the migration?):", upsertErr);
    }

    return NextResponse.json({
      suggestions: payload.categories,
      is_stale: false,
      cached: false,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Generation failed";
    console.error("[suggest] Generation error:", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
