/**
 * /api/comparison/entities
 *
 * GET  ?workspace_id=xxx         — list all entities for workspace
 * POST { workspace_id, label, company_name?, ticker?, period_label?, color? }
 *                                — create entity
 * PATCH { id, label?, company_name?, ticker?, period_label?, color?, sort_order? }
 *                                — update entity
 * DELETE ?id=xxx                 — delete entity (documents set entity_id → NULL)
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspace_id");

  if (!workspaceId) {
    return NextResponse.json({ error: "workspace_id required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("comparison_entities")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data ?? []);
}

// ─── POST ─────────────────────────────────────────────────────────────────────

const CreateSchema = z.object({
  workspace_id: z.string().uuid(),
  label: z.string().min(1).max(80),
  company_name: z.string().max(120).optional(),
  ticker: z.string().max(10).optional(),
  period_label: z.string().max(40).optional(),
  description: z.string().max(500).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = CreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Verify workspace ownership
  const { data: ws } = await supabase
    .from("workspaces").select("id").eq("id", parsed.data.workspace_id).eq("owner_id", user.id).single();
  if (!ws) return NextResponse.json({ error: "Workspace not found" }, { status: 404 });

  // Get current count for sort_order
  const { count } = await supabase
    .from("comparison_entities")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", parsed.data.workspace_id);

  const { data, error } = await supabase
    .from("comparison_entities")
    .insert({
      workspace_id: parsed.data.workspace_id,
      label: parsed.data.label,
      company_name: parsed.data.company_name ?? null,
      ticker: parsed.data.ticker ?? null,
      period_label: parsed.data.period_label ?? null,
      description: parsed.data.description ?? null,
      color: parsed.data.color ?? "#6366f1",
      sort_order: count ?? 0,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data, { status: 201 });
}

// ─── PATCH ────────────────────────────────────────────────────────────────────

const UpdateSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(80).optional(),
  company_name: z.string().max(120).nullable().optional(),
  ticker: z.string().max(10).nullable().optional(),
  period_label: z.string().max(40).nullable().optional(),
  description: z.string().max(500).nullable().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  sort_order: z.number().int().optional(),
});

export async function PATCH(request: Request) {
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
  }

  const { id, ...updates } = parsed.data;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("comparison_entities")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(data);
}

// ─── DELETE ───────────────────────────────────────────────────────────────────

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase
    .from("comparison_entities")
    .delete()
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return new NextResponse(null, { status: 204 });
}
