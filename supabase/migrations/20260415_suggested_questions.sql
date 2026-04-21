-- ============================================================
-- Migration: AI Suggested Questions
-- Creates the suggested_questions table (one row per workspace).
-- ============================================================

CREATE TABLE IF NOT EXISTS public.suggested_questions (
  id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid         NOT NULL UNIQUE
                                     REFERENCES public.workspaces(id)
                                     ON DELETE CASCADE,

  -- Serialised SuggestedCategoryGroup[] — the full AI-generated payload.
  -- Shape: [{ name: string, questions: SuggestedQuestionItem[] }]
  categories            jsonb        NOT NULL DEFAULT '[]'::jsonb,

  -- Hash of the set of done-document IDs at generation time.
  -- Used to detect staleness when new documents are added.
  generated_from_hash   text,

  -- Informational metadata (document_count, generated_at, etc.)
  source_metadata       jsonb        NOT NULL DEFAULT '{}'::jsonb,

  created_at            timestamptz  NOT NULL DEFAULT now(),
  updated_at            timestamptz  NOT NULL DEFAULT now()
);

-- Index for fast workspace lookup (unique constraint already creates one,
-- but an explicit index name makes it easier to reference in queries).
CREATE INDEX IF NOT EXISTS idx_suggested_questions_workspace_id
  ON public.suggested_questions (workspace_id);

-- ── Row-Level Security ────────────────────────────────────────────────────────
ALTER TABLE public.suggested_questions ENABLE ROW LEVEL SECURITY;

-- Workspace owners and members can read their own suggested questions.
CREATE POLICY "Workspace members can read suggested questions"
  ON public.suggested_questions
  FOR SELECT
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
    )
  );

-- Only the service role (server-side admin client) can insert/update/delete.
-- This keeps suggestion generation entirely server-controlled.
CREATE POLICY "Service role can manage suggested questions"
  ON public.suggested_questions
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- ── Comments ──────────────────────────────────────────────────────────────────
COMMENT ON TABLE public.suggested_questions IS
  'Stores AI-generated analyst question suggestions per workspace. '
  'One row per workspace, upserted after each ingestion cycle. '
  'The categories JSONB column holds the full SuggestedCategoryGroup[] payload.';
