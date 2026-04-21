# Supabase Setup Guide for Numera

## 1. Run the schema

Open your **Supabase SQL Editor** and run `schema.sql` in full.

> The schema enables `pgvector` (for embeddings), `pg_trgm` (for full-text fallback),
> creates all tables with RLS policies, sets up the vector search function, and
> creates the private storage bucket with its policies.

## 2. Enable Realtime

The UI uses Supabase Realtime to update document ingestion status live.

The `ALTER PUBLICATION` commands are at the bottom of `schema.sql`:
```sql
alter publication supabase_realtime add table public.documents;
alter publication supabase_realtime add table public.matrix_answers;
```

If those fail (e.g., the publication already exists with restricted tables),
go to **Supabase Dashboard → Database → Replication** and enable both tables manually.

## 3. Configure environment variables

Copy `.env.local.example` → `.env.local` and fill in:

| Variable | Where to get it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (keep secret!) |
| `ANTHROPIC_API_KEY` | https://console.anthropic.com/ |
| `VOYAGE_API_KEY` | https://dash.voyageai.com/ |

## 4. Storage bucket

The `schema.sql` creates the `documents` bucket automatically.

If you prefer to create it manually:
- Go to **Supabase → Storage → New bucket**
- Name: `documents`
- Public: **No** (private)
- Max file size: 50 MB

Then add the RLS policies from the `-- Storage RLS policies` section of `schema.sql`.

## 5. Verify pgvector

In the SQL Editor, run:
```sql
select * from pg_extension where extname = 'vector';
```
If it returns a row, pgvector is enabled. If not, enable it via
**Supabase → Database → Extensions → vector**.

## 6. Voyage AI note (embeddings)

Numera uses **Voyage AI** for document and query embeddings because
Anthropic does not provide embedding models. Voyage AI is Anthropic's
recommended embedding partner and offers `voyage-finance-2` which is
optimized for financial text.

Without `VOYAGE_API_KEY`:
- Documents will still be uploaded and parsed ✓
- Claude will still extract financial metrics ✓
- Vector similarity search will **not** work (falls back to Postgres FTS)
- Matrix answers will still be generated (using FTS-retrieved passages) ✓

Get a Voyage AI key (free tier available): https://dash.voyageai.com/

## 7. Model configuration

| Env Var | Default | Used For |
|---|---|---|
| `ANTHROPIC_MODEL` | `claude-sonnet-4-5` | Answer synthesis |
| `VOYAGE_MODEL` | `voyage-finance-2` | Document + query embeddings |

To reduce cost during development, set `ANTHROPIC_MODEL=claude-haiku-4-5`.
