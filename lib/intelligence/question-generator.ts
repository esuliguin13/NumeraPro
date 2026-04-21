/**
 * AI Suggested Questions Generator
 *
 * Uses the Anthropic client (tool_use) to generate analyst-grade questions
 * tailored to the documents, metrics, and intelligence signals present in a workspace.
 *
 * The result is persisted to the `suggested_questions` table (one row per
 * workspace, upserted on each generation run).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { runToolCall, DEFAULT_MODEL } from "@/lib/ai/anthropic";
import type {
  SuggestedQuestionsPayload,
  SuggestedCategoryGroup,
  SuggestedQuestionItem,
  SuggestedAnswerType,
  SuggestedCategory,
} from "./question-types";

// ─── Document-set hash ────────────────────────────────────────────────────────

/**
 * Produces a short deterministic hash of the set of done documents.
 * Used to detect whether suggestions are stale (new docs added / removed).
 */
export function buildDocumentHash(
  documents: Array<{ id: string; ingestion_status: string }>
): string {
  const sorted = [...documents]
    .filter((d) => d.ingestion_status === "done")
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((d) => d.id)
    .join("|");

  // djb2 hash
  let hash = 5381;
  for (let i = 0; i < sorted.length; i++) {
    hash = ((hash << 5) + hash) ^ sorted.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

// ─── Claude tool schema ───────────────────────────────────────────────────────

const SUGGEST_QUESTIONS_TOOL = {
  name: "suggest_questions",
  description:
    "Return a structured list of analyst-grade questions for a financial workspace.",
  input_schema: {
    type: "object" as const,
    properties: {
      categories: {
        type: "array",
        description: "Question groups, one per category.",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              enum: [
                "Financial",
                "Performance Drivers",
                "Risks",
                "Strategy / Outlook",
                "Advanced Insights",
              ],
            },
            questions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: {
                    type: "string",
                    description: "Short slug, e.g. q1, q2",
                  },
                  text: {
                    type: "string",
                    description: "The analyst question (specific, actionable).",
                  },
                  category: { type: "string" },
                  priority: {
                    type: "number",
                    description: "0–100. >=80 means pre-checked.",
                  },
                  rationale: {
                    type: "string",
                    description:
                      "One sentence explaining why this question is valuable.",
                  },
                  defaultChecked: { type: "boolean" },
                  answerType: {
                    type: "string",
                    enum: [
                      "financial",
                      "analytical",
                      "risk",
                      "comparison",
                      "strategy",
                    ],
                  },
                },
                required: [
                  "id",
                  "text",
                  "category",
                  "priority",
                  "rationale",
                  "defaultChecked",
                  "answerType",
                ],
              },
            },
          },
          required: ["name", "questions"],
        },
      },
    },
    required: ["categories"],
  },
};

// ─── Raw output shape from Claude ─────────────────────────────────────────────

interface ClaudeQuestion {
  id: string;
  text: string;
  category: string;
  priority: number;
  rationale: string;
  defaultChecked: boolean;
  answerType: string;
}
interface ClaudeCategory {
  name: string;
  questions: ClaudeQuestion[];
}
interface ClaudeOutput {
  categories: ClaudeCategory[];
}

// ─── Core generator ───────────────────────────────────────────────────────────

/**
 * Calls Claude to generate suggested questions for the workspace.
 * Does NOT persist — caller is responsible for storage.
 */
export async function generateSuggestedQuestions(
  supabase: SupabaseClient<Database>,
  workspaceId: string
): Promise<SuggestedQuestionsPayload> {
  // ── 1. Fetch done documents ──────────────────────────────────────────────
  const { data: documents } = await supabase
    .from("documents")
    .select("id, name, file_type, ingestion_status")
    .eq("workspace_id", workspaceId)
    .eq("ingestion_status", "done");

  if (!documents || documents.length === 0) {
    return { categories: [] };
  }

  // ── 2. Fetch top extracted metrics ───────────────────────────────────────
  const { data: metrics } = await supabase
    .from("extracted_financial_metrics")
    .select("metric_type, metric_name, value, unit, period, raw_text, confidence")
    .eq("workspace_id", workspaceId)
    .order("confidence", { ascending: false })
    .limit(25);

  // ── 3. Fetch existing matrix questions to avoid duplication ──────────────
  const { data: existingQuestions } = await supabase
    .from("matrix_questions")
    .select("question_text")
    .eq("workspace_id", workspaceId);

  // Build a normalised set for fast duplicate detection (lowercase, trimmed)
  const existingNormalised = new Set(
    (existingQuestions ?? []).map((q) => q.question_text.trim().toLowerCase())
  );

  // ── 4. Detect conflict signals from answer metadata ──────────────────────
  const { count: conflictCount } = await supabase
    .from("matrix_answers")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .eq("status", "done")
    .filter("metadata->>conflict_count", "gt", "0");

  const hasConflicts = (conflictCount ?? 0) > 0;

  // ── 5. Build prompt context ───────────────────────────────────────────────
  const docTypes = [...new Set(documents.map((d) => d.file_type))];
  const hasTranscript = docTypes.includes("transcript");
  const hasSpreadsheet = docTypes.includes("xlsx") || docTypes.includes("csv");

  const docLines = documents
    .map((d) => `- ${d.name} (${d.file_type.toUpperCase()})`)
    .join("\n");

  const metricsLines =
    metrics && metrics.length > 0
      ? metrics
          .slice(0, 20)
          .map(
            (m) =>
              `- ${m.metric_name}: ${m.value ?? "N/A"} ${m.unit ?? ""}` +
              (m.period ? ` (${m.period})` : "") +
              ` [conf: ${m.confidence}%]`
          )
          .join("\n")
      : "No structured metrics extracted yet.";

  const existingLines =
    existingQuestions && existingQuestions.length > 0
      ? existingQuestions.map((q) => `- ${q.question_text}`).join("\n")
      : "None";

  const guidanceLines: string[] = [];
  if (!hasTranscript && !hasSpreadsheet) {
    guidanceLines.push(
      "Documents are mainly financial reports — prioritize revenue, EBITDA, margins, outlook, and risk."
    );
  }
  if (hasTranscript) {
    guidanceLines.push(
      "Include management commentary, driver attribution, consistency checks, and forward-looking questions."
    );
  }
  if (hasSpreadsheet) {
    guidanceLines.push(
      "Include derived metric, cross-period comparison, and scenario analysis questions."
    );
  }
  if (hasConflicts) {
    guidanceLines.push(
      "At least one question must ask about cross-source inconsistencies or validation."
    );
  }

  const systemPrompt = `You are a senior financial analyst assistant embedded in a multi-document intelligence platform.

Your task is to generate specific, high-value analyst questions that will be used to interrogate uploaded financial documents in a structured matrix. Each question becomes a column that is answered for every uploaded document.

Rules:
- Be concrete and specific — reference the document types and metrics available.
- Avoid generic questions like "What is the company's financial performance?".
- Prefer questions that reveal comparative insights, trends, risk factors, or strategic intent.
- Do NOT duplicate any question already in the matrix.
- Produce 8–15 questions total across all categories.
- Questions with priority >= 80 must have defaultChecked: true.
- Output only the tool call — no prose, no explanations outside the tool.`;

  const userMessage = `Generate analyst questions for this workspace.

UPLOADED DOCUMENTS:
${docLines}

EXTRACTED METRICS (sample):
${metricsLines}

ALREADY IN MATRIX (skip these):
${existingLines}

GUIDANCE:
${guidanceLines.length > 0 ? guidanceLines.join("\n") : "No specific guidance — use your judgment."}`;

  // ── 6. Call Claude ────────────────────────────────────────────────────────
  const raw = await runToolCall<ClaudeOutput>(
    systemPrompt,
    userMessage,
    SUGGEST_QUESTIONS_TOOL,
    DEFAULT_MODEL,
    4096
  );

  // ── 7. Normalize output + hard-filter existing questions ─────────────────
  const categories: SuggestedCategoryGroup[] = (raw.categories ?? [])
    .map((cat) => ({
      name: cat.name as SuggestedCategory,
      questions: cat.questions
        .map(
          (q): SuggestedQuestionItem => ({
            id: q.id,
            question_text: q.text,
            category: q.category as SuggestedCategory,
            priority: Math.min(100, Math.max(0, q.priority)),
            rationale: q.rationale,
            default_checked: q.defaultChecked ?? q.priority >= 80,
            answer_type: q.answerType as SuggestedAnswerType,
          })
        )
        // Remove any suggestions that duplicate existing matrix questions
        .filter(
          (q) => !existingNormalised.has(q.question_text.trim().toLowerCase())
        ),
    }))
    // Drop categories that became empty after dedup
    .filter((cat) => cat.questions.length > 0);

  return { categories };
}

// ─── Persist helper ───────────────────────────────────────────────────────────

/**
 * Generates suggestions and upserts them into the `suggested_questions` table.
 *
 * Generation is skipped when fresh suggestions already exist for the current
 * document set (one-time per document upload cycle). Pass `force = true` to
 * always regenerate (e.g. user clicks "Regenerate" in the UI).
 *
 * Safe to call from background tasks — all errors are caught and logged.
 */
export async function generateAndStoreSuggestedQuestions(
  supabase: SupabaseClient<Database>,
  workspaceId: string,
  force = false
): Promise<void> {
  try {
    const { data: documents } = await supabase
      .from("documents")
      .select("id, ingestion_status")
      .eq("workspace_id", workspaceId);

    const hash = buildDocumentHash(documents ?? []);

    // Skip generation if fresh suggestions already exist for this exact document set.
    if (!force) {
      try {
        const { data: existing } = await (supabase as SupabaseClient)
          .from("suggested_questions")
          .select("generated_from_hash")
          .eq("workspace_id", workspaceId)
          .maybeSingle();

        if (existing && existing.generated_from_hash === hash) {
          console.log(
            `[QuestionGen] Fresh suggestions already exist for workspace ${workspaceId} — skipping.`
          );
          return;
        }
      } catch {
        // Table may not exist yet — proceed with generation.
      }
    }

    const payload = await generateSuggestedQuestions(supabase, workspaceId);

    if (payload.categories.length === 0) {
      console.log(`[QuestionGen] No suggestions generated for workspace ${workspaceId}`);
      return;
    }

    const { error } = await (supabase as SupabaseClient)
      .from("suggested_questions")
      .upsert(
        {
          workspace_id: workspaceId,
          categories: payload.categories as unknown as Record<string, unknown>[],
          generated_from_hash: hash,
          source_metadata: {
            document_count: documents?.length ?? 0,
            generated_at: new Date().toISOString(),
          },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id" }
      );

    if (error) {
      console.error("[QuestionGen] Upsert failed:", error.message);
    } else {
      const total = payload.categories.reduce(
        (s, c) => s + c.questions.length,
        0
      );
      console.log(
        `[QuestionGen] Stored ${total} suggestions for workspace ${workspaceId}`
      );
    }
  } catch (err) {
    console.error("[QuestionGen] Generation failed:", err);
  }
}
