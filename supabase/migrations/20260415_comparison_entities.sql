-- ============================================================
-- Migration: Multi-Company Comparison Mode
--
-- 1. comparison_entities — named groups (company / period / source-set)
-- 2. entity_id on documents — nullable FK for backward compat
-- ============================================================

-- ── comparison_entities ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.comparison_entities (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  uuid        NOT NULL
                            REFERENCES public.workspaces(id) ON DELETE CASCADE,
  label         text        NOT NULL,
  company_name  text,
  ticker        text,
  period_label  text,
  description   text,
  -- hex color for the entity badge in the UI
  color         text        NOT NULL DEFAULT '#6366f1',
  sort_order    integer     NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_comparison_entities_workspace
  ON public.comparison_entities (workspace_id);

-- ── entity_id on documents ────────────────────────────────────────────────────
-- NULL means the document is unassigned (standard / single-company workspace).
-- Existing rows remain NULL and all existing behavior is preserved.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS entity_id uuid
    REFERENCES public.comparison_entities(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_entity_id
  ON public.documents (entity_id)
  WHERE entity_id IS NOT NULL;

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.comparison_entities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace members can read comparison entities"
  ON public.comparison_entities
  FOR SELECT
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
    )
  );

CREATE POLICY "Workspace owners can manage comparison entities"
  ON public.comparison_entities
  FOR ALL
  USING (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
    )
  )
  WITH CHECK (
    workspace_id IN (
      SELECT id FROM public.workspaces WHERE owner_id = auth.uid()
    )
  );

-- ── Comments ──────────────────────────────────────────────────────────────────

COMMENT ON TABLE public.comparison_entities IS
  'Named comparison groups within a workspace. '
  'A workspace gains "Comparison Mode" when it has 2+ entities. '
  'Each entity owns a set of documents (via documents.entity_id). '
  'v1 focus: Company vs Company. Future: Period vs Period, Source Set vs Source Set.';

COMMENT ON COLUMN public.documents.entity_id IS
  'Which comparison entity this document belongs to. NULL = unassigned (standard workspace).';
