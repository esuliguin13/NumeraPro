-- ============================================================
-- Numera Database Schema
-- Run this in your Supabase SQL Editor to set up the database.
-- ============================================================

-- Enable required extensions
create extension if not exists "pgcrypto";
create extension if not exists "vector";       -- pgvector for embeddings
create extension if not exists "pg_trgm";      -- trigram for full-text search

-- ──────────────────────────────────────────────────────────────
-- USERS
-- ──────────────────────────────────────────────────────────────
create table if not exists public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "Users can read own profile"
  on public.users for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on public.users for update
  using (auth.uid() = id);

-- Auto-create user profile on sign-up
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.users (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    new.raw_user_meta_data ->> 'full_name',
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ──────────────────────────────────────────────────────────────
-- WORKSPACES
-- ──────────────────────────────────────────────────────────────
create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  owner_id    uuid not null references public.users(id) on delete cascade,
  settings    jsonb not null default '{}',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists workspaces_owner_id_idx on public.workspaces(owner_id);

alter table public.workspaces enable row level security;

create policy "Workspace owners can CRUD"
  on public.workspaces for all
  using (auth.uid() = owner_id);

-- ──────────────────────────────────────────────────────────────
-- DOCUMENTS
-- ──────────────────────────────────────────────────────────────
do $$ begin
  create type document_file_type as enum ('pdf', 'xlsx', 'csv', 'txt', 'transcript');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type ingestion_status as enum ('pending', 'processing', 'done', 'error');
exception when duplicate_object then null;
end $$;

create table if not exists public.documents (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  name              text not null,
  file_type         document_file_type not null,
  file_size         bigint not null,
  storage_path      text not null,
  page_count        integer,
  ingestion_status  ingestion_status not null default 'pending',
  ingestion_error   text,
  metadata          jsonb not null default '{}',
  uploaded_by       uuid not null references public.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists documents_workspace_id_idx on public.documents(workspace_id);
create index if not exists documents_ingestion_status_idx on public.documents(ingestion_status);

alter table public.documents enable row level security;

create policy "Workspace owners can access documents"
  on public.documents for all
  using (
    workspace_id in (
      select id from public.workspaces where owner_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────────
-- DOCUMENT CHUNKS
-- ──────────────────────────────────────────────────────────────
create table if not exists public.document_chunks (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.documents(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  content       text not null,
  chunk_index   integer not null,
  page_number   integer,
  section_title text,
  token_count   integer not null,
  embedding     vector(1024),   -- Voyage AI voyage-finance-2 / voyage-3 dimension
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists chunks_document_id_idx on public.document_chunks(document_id);
create index if not exists chunks_workspace_id_idx on public.document_chunks(workspace_id);

-- HNSW index for fast approximate nearest-neighbor search
create index if not exists chunks_embedding_hnsw_idx
  on public.document_chunks
  using hnsw (embedding vector_cosine_ops)
  with (m = 16, ef_construction = 64);

alter table public.document_chunks enable row level security;

create policy "Workspace owners can access chunks"
  on public.document_chunks for all
  using (
    workspace_id in (
      select id from public.workspaces where owner_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────────
-- EXTRACTED FINANCIAL METRICS
-- ──────────────────────────────────────────────────────────────
do $$ begin
  create type metric_type as enum (
    'revenue', 'ebitda', 'net_income', 'gross_profit',
    'operating_income', 'margin', 'guidance', 'headcount', 'custom'
  );
exception when duplicate_object then null;
end $$;

do $$ begin
  create type period_type as enum ('annual', 'quarterly', 'ttm', 'other');
exception when duplicate_object then null;
end $$;

create table if not exists public.extracted_financial_metrics (
  id            uuid primary key default gen_random_uuid(),
  document_id   uuid not null references public.documents(id) on delete cascade,
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  metric_type   metric_type not null,
  metric_name   text not null,
  value         numeric,
  unit          text,
  period        text,
  period_type   period_type,
  raw_text      text not null,
  page_number   integer,
  confidence    numeric not null check (confidence between 0 and 100),
  metadata      jsonb not null default '{}',
  created_at    timestamptz not null default now()
);

create index if not exists metrics_document_id_idx on public.extracted_financial_metrics(document_id);
create index if not exists metrics_workspace_id_idx on public.extracted_financial_metrics(workspace_id);
create index if not exists metrics_type_idx on public.extracted_financial_metrics(metric_type);

alter table public.extracted_financial_metrics enable row level security;

create policy "Workspace owners can access metrics"
  on public.extracted_financial_metrics for all
  using (
    workspace_id in (
      select id from public.workspaces where owner_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────────
-- MATRIX QUESTIONS
-- ──────────────────────────────────────────────────────────────
do $$ begin
  create type question_type as enum ('financial', 'operational', 'risk', 'general');
exception when duplicate_object then null;
end $$;

create table if not exists public.matrix_questions (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  question_text     text not null,
  column_index      integer not null default 0,
  question_type     question_type not null default 'financial',
  extraction_hints  jsonb not null default '{}',
  created_by        uuid not null references public.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (workspace_id, column_index)
);

create index if not exists questions_workspace_id_idx on public.matrix_questions(workspace_id);

alter table public.matrix_questions enable row level security;

create policy "Workspace owners can access questions"
  on public.matrix_questions for all
  using (
    workspace_id in (
      select id from public.workspaces where owner_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────────
-- MATRIX ANSWERS
-- ──────────────────────────────────────────────────────────────
do $$ begin
  create type answer_status as enum ('pending', 'running', 'done', 'error');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type extraction_method as enum ('structured', 'retrieval', 'hybrid');
exception when duplicate_object then null;
end $$;

create table if not exists public.matrix_answers (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces(id) on delete cascade,
  document_id          uuid not null references public.documents(id) on delete cascade,
  question_id          uuid not null references public.matrix_questions(id) on delete cascade,
  status               answer_status not null default 'pending',
  answer_text          text,
  confidence_score     numeric check (confidence_score between 0 and 100),
  extraction_method    extraction_method,
  processing_time_ms   integer,
  error_message        text,
  metadata             jsonb not null default '{}',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (workspace_id, document_id, question_id)
);

create index if not exists answers_workspace_id_idx on public.matrix_answers(workspace_id);
create index if not exists answers_document_id_idx on public.matrix_answers(document_id);
create index if not exists answers_question_id_idx on public.matrix_answers(question_id);
create index if not exists answers_status_idx on public.matrix_answers(status);

alter table public.matrix_answers enable row level security;

create policy "Workspace owners can access answers"
  on public.matrix_answers for all
  using (
    workspace_id in (
      select id from public.workspaces where owner_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────────
-- CITATIONS
-- ──────────────────────────────────────────────────────────────
create table if not exists public.citations (
  id               uuid primary key default gen_random_uuid(),
  answer_id        uuid not null references public.matrix_answers(id) on delete cascade,
  document_id      uuid not null references public.documents(id) on delete cascade,
  chunk_id         uuid references public.document_chunks(id) on delete set null,
  citation_text    text not null,
  page_number      integer,
  section_title    text,
  relevance_score  numeric not null check (relevance_score between 0 and 1),
  highlight_start  integer,
  highlight_end    integer,
  created_at       timestamptz not null default now()
);

create index if not exists citations_answer_id_idx on public.citations(answer_id);
create index if not exists citations_document_id_idx on public.citations(document_id);

alter table public.citations enable row level security;

create policy "Workspace owners can access citations"
  on public.citations for all
  using (
    answer_id in (
      select ma.id from public.matrix_answers ma
      join public.workspaces w on w.id = ma.workspace_id
      where w.owner_id = auth.uid()
    )
  );

-- ──────────────────────────────────────────────────────────────
-- STORAGE BUCKET
-- Run these statements to create the private documents bucket.
-- ──────────────────────────────────────────────────────────────

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,                  -- private bucket
  52428800,              -- 50 MB per file
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    'text/plain'
  ]
)
on conflict (id) do nothing;

-- Storage RLS policies
-- Files are stored at: {userId}/{workspaceId}/{timestamp}_{filename}
-- The first folder segment is always the user's UUID.

create policy "Authenticated users can upload to own folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can read own documents"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "Users can delete own documents"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'documents'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- ──────────────────────────────────────────────────────────────
-- REALTIME
-- Enable Realtime on documents so the UI updates ingestion status live.
-- Run in Supabase Dashboard → Database → Replication → Tables
-- or execute:
-- ──────────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.documents;
alter publication supabase_realtime add table public.matrix_answers;

-- ──────────────────────────────────────────────────────────────
-- VECTOR SEARCH FUNCTION
-- ──────────────────────────────────────────────────────────────
create or replace function public.match_document_chunks(
  query_embedding vector(1024),
  workspace_id    uuid,
  document_ids    uuid[],
  match_threshold float,
  match_count     int
)
returns table (
  id            uuid,
  document_id   uuid,
  content       text,
  page_number   integer,
  section_title text,
  similarity    float
)
language sql stable
as $$
  select
    dc.id,
    dc.document_id,
    dc.content,
    dc.page_number,
    dc.section_title,
    1 - (dc.embedding <=> query_embedding) as similarity
  from public.document_chunks dc
  where
    dc.workspace_id = match_document_chunks.workspace_id
    and dc.document_id = any(match_document_chunks.document_ids)
    and dc.embedding is not null
    and 1 - (dc.embedding <=> query_embedding) > match_threshold
  order by dc.embedding <=> query_embedding
  limit match_count;
$$;

-- ──────────────────────────────────────────────────────────────
-- UPDATED_AT TRIGGER
-- ──────────────────────────────────────────────────────────────
create or replace function public.update_updated_at_column()
returns trigger language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger update_workspaces_updated_at
  before update on public.workspaces
  for each row execute function public.update_updated_at_column();

create trigger update_documents_updated_at
  before update on public.documents
  for each row execute function public.update_updated_at_column();

create trigger update_matrix_questions_updated_at
  before update on public.matrix_questions
  for each row execute function public.update_updated_at_column();

create trigger update_matrix_answers_updated_at
  before update on public.matrix_answers
  for each row execute function public.update_updated_at_column();

create trigger update_users_updated_at
  before update on public.users
  for each row execute function public.update_updated_at_column();
