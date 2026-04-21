# Numera — AI-Powered Financial Analysis Platform

A production-grade, Hebbia-style Matrix workspace for financial analysts. Built with Next.js 15, Supabase, and pgvector.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, TypeScript) |
| Styling | Tailwind CSS v3 + shadcn/ui |
| Database | Supabase (Postgres + pgvector) |
| Auth | Supabase Auth |
| Storage | Supabase Storage (private `documents` bucket) |
| Charts | Recharts |
| AI — LLM | Anthropic Claude (Sonnet for synthesis, Haiku for extraction) |
| AI — Embeddings | Voyage AI (`voyage-finance-2`, falls back to FTS stub) |

---

## Quick Start

### Prerequisites
- Node.js 18+
- A [Supabase](https://supabase.com) project

### 1. Install dependencies

```bash
npm install
```

### 2. Set up environment variables

```bash
cp .env.local.example .env.local
```

Fill in:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Primary AI — get at console.anthropic.com
ANTHROPIC_API_KEY=sk-ant-...

# Embeddings — get at dash.voyageai.com (optional: falls back to FTS without it)
VOYAGE_API_KEY=pa-...
```

### 3. Set up the database

1. Open your [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql)
2. Run the contents of `supabase/schema.sql` — this creates all tables, RLS policies,
   the private `documents` storage bucket, storage policies, and enables Realtime
3. See `supabase/setup.md` for a detailed walkthrough

### 4. Run the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Project Structure

```
numera/
├── app/
│   ├── page.tsx                    # Landing page
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── signup/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx              # Authenticated layout (sidebar)
│   │   ├── dashboard/page.tsx      # Workspace list
│   │   └── workspace/[id]/page.tsx # Matrix workspace
│   └── api/
│       ├── workspaces/             # Workspace CRUD
│       ├── documents/              # Document upload + delete
│       ├── matrix/
│       │   ├── questions/          # Question management
│       │   └── execute/            # Cell query execution
│       └── ingestion/              # Document ingestion pipeline
├── components/
│   ├── ui/                         # shadcn/ui components
│   ├── landing/                    # Landing page sections
│   ├── auth/                       # Login / Signup forms
│   ├── dashboard/                  # Workspace cards, sidebar
│   ├── matrix/                     # Matrix grid, cells, citation panel
│   └── upload/                     # File upload zone, document list
├── lib/
│   ├── supabase/                   # Client, server, middleware
│   ├── ingestion/pipeline.ts       # Parse → Chunk → Embed → Extract
│   ├── retrieval/vector-search.ts  # pgvector similarity search
│   └── orchestration/              # Query orchestrator + answer synthesizer
├── types/
│   ├── database.types.ts           # Generated DB types
│   └── index.ts                    # App-level types
├── supabase/schema.sql             # Full database schema
└── middleware.ts                   # Auth routing middleware
```

---

## Architecture

### Matrix Data Flow

```
User adds question (column) → matrix_questions table
User uploads document (row)  → Supabase Storage + documents table
                                       ↓
                             Ingestion pipeline triggers:
                               1. Parse (PDF/Excel/txt)
                               2. Chunk (512 token overlapping chunks)
                               3. Embed (OpenAI text-embedding-3-small)
                               4. Extract (GPT-4o structured financial metrics)
                               5. Store (document_chunks + extracted_financial_metrics)
                                       ↓
User clicks "Run Matrix"     → POST /api/matrix/execute for each cell
                               Query Orchestrator decides:
                               - structured: use extracted metrics
                               - retrieval: pgvector similarity search
                               - hybrid: both
                                       ↓
                             Answer synthesized via GPT-4o
                             Citations linked to exact source chunks
                             matrix_answers + citations stored
```

### Retrieval Strategy

The `QueryOrchestrator` classifies each question:

| Strategy | When Used | Data Source |
|---|---|---|
| `structured` | Numeric metric questions (revenue, EBITDA) | `extracted_financial_metrics` |
| `retrieval` | Qualitative questions (risks, strategy) | `document_chunks` via pgvector |
| `hybrid` | Mixed questions (guidance with commentary) | Both sources |

---

## AI Provider Setup

### Anthropic Claude (answer synthesis + financial extraction)

Already wired up via `lib/ai/anthropic.ts`. Just set `ANTHROPIC_API_KEY`.

- **Synthesis**: `claude-sonnet-4-5` via `lib/ai/synthesis.ts`
- **Extraction**: `claude-haiku-4-5` via `lib/ai/extraction.ts` (per-page, cost-efficient)
- Both use Claude **tool use** for guaranteed structured JSON output

### Voyage AI (embeddings)

Set `VOYAGE_API_KEY` to enable semantic vector search. Without it, the app
gracefully falls back to Postgres full-text search — matrix answers still work,
just with lower retrieval quality.

Recommended models:
- `voyage-finance-2` — optimized for financial documents (default)
- `voyage-3` — general-purpose alternative

### Document Parsing (TODO)

Currently parses documents as raw UTF-8 text. For production:

```bash
npm install pdf-parse xlsx
```

Then implement the `parseDocument` function in `lib/ingestion/pipeline.ts`
following the TODO comments for each file type.

---

## Production Considerations

- **Background Jobs**: Replace the fire-and-forget ingestion with a proper queue (BullMQ, Supabase Edge Functions, or Inngest)
- **Streaming**: Implement SSE/streaming for real-time cell execution feedback
- **Caching**: Cache embeddings and frequent queries in Redis
- **Rate Limits**: Add per-user rate limiting on `/api/matrix/execute`
- **Web Search**: v2 feature — add a Tavily/Bing web search tool to the orchestrator for live data augmentation

---

## License

MIT
