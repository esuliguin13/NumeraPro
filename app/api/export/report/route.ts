/**
 * POST /api/export/report
 *
 * Generates an analyst report from existing workspace intelligence.
 * No re-extraction — reads from stored matrix_answers.metadata.
 *
 * Body: { workspace_id: string, mode: "executive" | "analyst" }
 *
 * Returns: GeneratedReport JSON
 */

import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  generateExecutiveSummary,
  generateAnalystBrief,
} from "@/lib/export/report-generator";

const RequestSchema = z.object({
  workspace_id: z.string().uuid(),
  mode: z.enum(["executive", "analyst"]),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation error" },
      { status: 400 }
    );
  }

  const { workspace_id, mode } = parsed.data;

  const supabase = await createClient();

  // Auth guard
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Verify workspace ownership
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("id")
    .eq("id", workspace_id)
    .eq("owner_id", user.id)
    .single();

  if (!workspace) {
    return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  }

  try {
    const report =
      mode === "executive"
        ? await generateExecutiveSummary(supabase, workspace_id)
        : await generateAnalystBrief(supabase, workspace_id);

    return NextResponse.json(report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Report generation failed";
    console.error("[export/report]", err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
