import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { executeMatrixCell } from "@/lib/orchestration/query-orchestrator";

const ExecuteSchema = z.object({
  workspace_id: z.string().uuid(),
  document_id: z.string().uuid(),
  question_id: z.string().uuid(),
});

export async function POST(request: Request) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = ExecuteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Validation error" },
      { status: 400 }
    );
  }

  const { workspace_id, document_id, question_id } = parsed.data;

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

  // Fetch question
  const { data: question } = await supabase
    .from("matrix_questions")
    .select("*")
    .eq("id", question_id)
    .eq("workspace_id", workspace_id)
    .single();

  if (!question) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  // Upsert answer with "running" status
  const { data: runningAnswer } = await supabase
    .from("matrix_answers")
    .upsert(
      {
        workspace_id,
        document_id,
        question_id,
        status: "running",
        answer_text: null,
        confidence_score: null,
        extraction_method: null,
        processing_time_ms: null,
        error_message: null,
        metadata: {},
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,document_id,question_id" }
    )
    .select()
    .single();

  if (!runningAnswer) {
    return NextResponse.json({ error: "Failed to create answer record" }, { status: 500 });
  }

  try {
    // Execute the cell via the orchestrator
    const result = await executeMatrixCell(supabase, {
      workspaceId: workspace_id,
      documentId: document_id,
      question,
    });

    // Build UI-ready intelligence metadata for drill-down panels
    const intel = result.intelligence;
    const intelligenceMetadata = {
      // Question type — drives cell display mode and answer format validation
      question_type: result.questionType,

      // Summary
      sources_count: result.sources.length,
      structured_metrics_count: result.structuredMetrics.length,
      derived_metrics_count: intel.summary.derivedCount,
      conflict_count: intel.summary.conflictCount,
      ground_truth_count: intel.summary.groundTruthCount,
      primary_sources: intel.summary.primarySources,

      // Confidence breakdown
      confidence_factors: intel.confidenceFactors,

      // Best metrics (for drill-down)
      best_metrics: intel.bestMetrics.map((m) => ({
        canonical_type: m.canonicalType,
        metric_name: m.metricName,
        value: m.value,
        unit: m.unit,
        period: m.normalizedPeriod,
        confidence: m.confidence,
        source_file_type: m.sourceFileType,
        is_derived: m.isDerived,
        is_adjusted: m.isAdjusted,
        is_guidance: m.isGuidance,
        derived_formula: m.derivedFormula ?? null,
      })),

      // Derived metrics
      derived_metrics: intel.derivedMetrics.map((m) => ({
        metric_name: m.metricName,
        canonical_type: m.canonicalType,
        value: m.value,
        unit: m.unit,
        period: m.normalizedPeriod,
        formula: m.derivedFormula ?? null,
        confidence: m.confidence,
      })),

      // Contradictions (for flagging in UI)
      contradictions: intel.contradictions
        .filter((c) => c.classification !== "insufficient_evidence")
        .map((c) => ({
          canonical_type: c.canonicalType,
          period: c.normalizedPeriod,
          classification: c.classification,
          reference_value: c.referenceValue,
          reference_unit: c.referenceUnit,
          max_variance_pct: c.maxVariancePct,
          notes: c.notes,
          evidence: c.evidence.map((e) => ({
            source_file_type: e.sourceFileType,
            metric_name: e.metricName,
            value: e.value,
            unit: e.unit,
            confidence: e.confidence,
          })),
        })),
    };

    // Update answer with results
    const { data: completedAnswer, error: updateError } = await supabase
      .from("matrix_answers")
      .update({
        status: "done",
        answer_text: result.answerText,
        confidence_score: result.confidenceScore,
        extraction_method: result.extractionMethod,
        processing_time_ms: result.processingTimeMs,
        error_message: null,
        metadata: intelligenceMetadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", runningAnswer.id)
      .select()
      .single();

    if (updateError || !completedAnswer) {
      throw new Error(updateError?.message ?? "Failed to save answer");
    }

    // Insert citations
    const citationInserts = result.sources.map((source, i) => ({
      answer_id: completedAnswer.id,
      document_id,
      citation_text: source.content.slice(0, 1000),
      page_number: source.page_number,
      section_title: source.section_title,
      relevance_score: source.similarity,
      metadata: { source_rank: i },
    }));

    if (citationInserts.length > 0) {
      await supabase
        .from("citations")
        .insert(citationInserts)
        .select();
    }

    // Fetch final answer with citations
    const { data: finalAnswer } = await supabase
      .from("matrix_answers")
      .select("*, citations(*)")
      .eq("id", completedAnswer.id)
      .single();

    return NextResponse.json({
      answer: finalAnswer,
      citations: finalAnswer?.citations ?? [],
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Execution failed";

    await supabase
      .from("matrix_answers")
      .update({
        status: "error",
        error_message: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq("id", runningAnswer.id);

    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
