/**
 * Document Ingestion Pipeline
 *
 * Full pipeline:  parse → chunk → embed → extract → (store handled by API route)
 *
 * ┌────────────┐   ┌──────────────┐   ┌──────────────────┐   ┌───────────────────┐
 * │  Parse     │──▶│  Chunk       │──▶│  Embed           │──▶│  Extract Metrics  │
 * │ (text+     │   │ (512 tokens, │   │ (Voyage AI or    │   │ (Claude Haiku     │
 * │  tables)   │   │  64 overlap) │   │  stub fallback)  │   │  tool_use)        │
 * └────────────┘   └──────────────┘   └──────────────────┘   └───────────────────┘
 *
 * Parser notes (implement when adding real document parsing):
 *   PDF:         use `pdf-parse` or call Unstructured.io API
 *   Excel/CSV:   use `xlsx` library (sheet → row → text conversion)
 *   Transcripts: plain text with speaker-turn detection
 */

import { embedDocuments } from "@/lib/ai/embeddings";
import { extractMetricsFromPages } from "@/lib/ai/extraction";
import type { DocumentRow } from "@/types";
import type { ExtractedMetricRaw } from "@/lib/ai/types";

// pdfjs-dist (used internally by pdf-parse v2) references DOMMatrix which only
// exists in browsers. Stub it out before the require so Node.js doesn't throw.
if (typeof globalThis.DOMMatrix === "undefined") {
  // @ts-expect-error — minimal stub; pdfjs only needs the constructor for text extraction
  globalThis.DOMMatrix = class DOMMatrix {
    // Identity matrix values expected by pdfjs geometry helpers
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    constructor(_init?: number[] | string) {}
    multiply(_m: unknown) { return this; }
    translate(_x: number, _y: number) { return this; }
    scale(_s: number) { return this; }
    inverse() { return this; }
  };
}

// Use the internal lib file directly to avoid pdf-parse's self-test on import
// (the top-level require runs a test that looks for a non-existent test PDF).
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (buf: Buffer) => Promise<{ text: string; numpages: number }>;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ParsedPage {
  pageNumber: number;
  text: string;
  /** Tables extracted from the page (each table converted to markdown) */
  tables: string[];
  /** Section headings found on this page */
  sections: string[];
}

export interface ParsedDocument {
  pages: ParsedPage[];
  totalPages: number;
  metadata: Record<string, unknown>;
}

export interface DocumentChunk {
  content: string;
  chunkIndex: number;
  pageNumber: number | null;
  sectionTitle: string | null;
  tokenCount: number;
  metadata: Record<string, unknown>;
}

export interface ChunkWithEmbedding extends DocumentChunk {
  embedding: number[];
}

export interface IngestionResult {
  chunks: ChunkWithEmbedding[];
  metrics: ExtractedMetricRaw[];
  totalPages: number;
  embeddingsAreReal: boolean;
}

// ─── Parse helpers ────────────────────────────────────────────────────────────

const PAGE_CHARS = 3000;
const OVERLAP_CHARS_PAGE = 200;

/** Splits a flat text string into ParsedPage[] respecting ~PAGE_CHARS boundaries. */
function pushSplitPages(
  pages: ParsedPage[],
  rawText: string,
  nativePageCount: number
): void {
  const text = rawText.trim();
  if (!text) return;

  const chunkSize = Math.max(
    PAGE_CHARS,
    Math.ceil(text.length / Math.max(nativePageCount, 1))
  );

  let pageNum = pages.length + 1;
  let i = 0;
  while (i < text.length) {
    const slice = text.slice(i, i + chunkSize).trim();
    if (slice.length > 0) {
      pages.push({
        pageNumber: pageNum++,
        text: slice,
        tables: [],
        sections: extractSectionHeadings(slice),
      });
    }
    i += chunkSize - OVERLAP_CHARS_PAGE;
  }
}

/**
 * Extracts likely section headings from a text block.
 * Looks for short lines in ALL CAPS or Title Case that precede body text.
 */
function extractSectionHeadings(text: string): string[] {
  const headings: string[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (
      trimmed.length > 3 &&
      trimmed.length < 80 &&
      (trimmed === trimmed.toUpperCase() ||
        /^[A-Z][a-z]/.test(trimmed)) &&
      !/[.,:;]$/.test(trimmed)
    ) {
      headings.push(trimmed);
      if (headings.length >= 3) break;
    }
  }
  return headings;
}

// ─── Step 1: Parse ────────────────────────────────────────────────────────────

/**
 * Parses a document buffer into structured pages.
 *
 * TODO — integrate real parsers:
 *
 * PDF (recommended: pdf-parse + Unstructured.io for tables):
 * ```ts
 * import pdfParse from 'pdf-parse';
 * const data = await pdfParse(buffer);
 * // data.text contains full text; data.numpages for page count
 * // For tables: use Unstructured.io API or camelot-py via subprocess
 * ```
 *
 * Excel/CSV (recommended: xlsx):
 * ```ts
 * import * as XLSX from 'xlsx';
 * const wb = XLSX.read(buffer, { type: 'buffer' });
 * // Iterate sheets → convert to CSV text → treat as pages
 * ```
 *
 * Earnings Transcript (plain text with speaker turns):
 * ```ts
 * const text = buffer.toString('utf-8');
 * const turns = text.split(/\n(?=[A-Z][A-Z\s]+:)/); // speaker pattern
 * ```
 */
export async function parseDocument(
  buffer: Buffer,
  fileType: DocumentRow["file_type"],
  fileName: string
): Promise<ParsedDocument> {
  console.log(`[Ingestion/Parse] ${fileName} (${fileType}, ${buffer.length} bytes)`);

  const pages: ParsedPage[] = [];

  if (fileType === "pdf") {
    try {
      // Capture per-page text via the pagerender callback so Claude gets
      // accurate page boundaries instead of arbitrary character splits.
      const perPageTexts: string[] = [];

      await pdfParse(buffer, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pagerender: async (pageData: any) => {
          try {
            const content = await pageData.getTextContent({
              normalizeWhitespace: true,
            });
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pageText = content.items
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              .map((item: any) => item.str + (item.hasEOL ? "\n" : " "))
              .join("")
              .trim();
            perPageTexts.push(pageText || "");
          } catch {
            perPageTexts.push("");
          }
          return ""; // pdf-parse concatenates this; we don't use its result
        },
      });

      if (perPageTexts.length > 0 && perPageTexts.some((t) => t.length > 20)) {
        // Use real per-page boundaries
        perPageTexts.forEach((text, idx) => {
          if (text.trim().length > 0) {
            pages.push({
              pageNumber: idx + 1,
              text: text.trim(),
              tables: [],
              sections: extractSectionHeadings(text),
            });
          }
        });
        console.log(
          `[Ingestion/Parse] PDF parsed into ${pages.length} real pages via pagerender`
        );
      } else {
        // pagerender didn't capture content — fall back to full-text split
        const result = await pdfParse(buffer);
        pushSplitPages(pages, result.text, result.numpages);
        console.log(
          `[Ingestion/Parse] PDF parsed via full-text fallback (${result.numpages} pages)`
        );
      }
    } catch (err) {
      console.error("[Ingestion/Parse] pdf-parse failed, falling back to text:", err);
      pushSplitPages(pages, buffer.toString("utf-8"), 1);
    }
  } else {
    // csv, txt, transcript — plain UTF-8; split into logical pages
    const rawText = buffer.toString("utf-8").trim();
    pushSplitPages(pages, rawText, 1);
  }

  if (pages.length === 0) {
    pages.push({ pageNumber: 1, text: "(empty document)", tables: [], sections: [] });
  }

  return {
    pages,
    totalPages: pages.length,
    metadata: {
      fileName,
      fileType,
      parsedAt: new Date().toISOString(),
      charCount: pages.reduce((n, p) => n + p.text.length, 0),
    },
  };
}

// ─── Step 2: Chunk ────────────────────────────────────────────────────────────

const TARGET_CHUNK_CHARS = 512 * 4; // ~512 tokens at ~4 chars/token
const CHUNK_OVERLAP_CHARS = 64 * 4; // ~64 token overlap for context continuity
const MIN_CHUNK_CHARS = 80;         // skip very short fragments

/**
 * Splits parsed document pages into overlapping text chunks.
 *
 * TODO — improve chunking:
 *   - Use tiktoken for accurate token counting
 *   - Respect sentence boundaries (spacy / compromise.js)
 *   - Keep tables as single chunks with a [TABLE] prefix
 *   - Prepend section title to each chunk for context ("Section: Financials\n…")
 */
export function chunkDocument(parsed: ParsedDocument): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];
  let globalChunkIndex = 0;

  for (const page of parsed.pages) {
    // Combine page text and any extracted table markdown
    const pageContent = [page.text, ...page.tables].join("\n\n").trim();
    if (!pageContent) continue;

    let start = 0;
    while (start < pageContent.length) {
      const end = Math.min(start + TARGET_CHUNK_CHARS, pageContent.length);

      // Try to break at a sentence boundary within ±200 chars of end
      let splitAt = end;
      if (end < pageContent.length) {
        const searchWindow = pageContent.slice(
          Math.max(start, end - 200),
          Math.min(pageContent.length, end + 200)
        );
        const sentenceEnd = searchWindow.search(/[.!?]\s+[A-Z]/);
        if (sentenceEnd !== -1) {
          splitAt = Math.max(start, end - 200) + sentenceEnd + 1;
        }
      }

      const chunkText = pageContent.slice(start, splitAt).trim();
      if (chunkText.length >= MIN_CHUNK_CHARS) {
        chunks.push({
          content: chunkText,
          chunkIndex: globalChunkIndex++,
          pageNumber: page.pageNumber,
          sectionTitle: page.sections[0] ?? null,
          tokenCount: Math.ceil(chunkText.length / 4),
          metadata: { page: page.pageNumber },
        });
      }

      if (splitAt >= pageContent.length) break;
      start = splitAt - CHUNK_OVERLAP_CHARS;
    }
  }

  return chunks;
}

// ─── Step 3: Embed ────────────────────────────────────────────────────────────

/**
 * Generates vector embeddings for all chunks using Voyage AI.
 * Falls back to stub vectors if VOYAGE_API_KEY is not configured.
 */
export async function embedChunks(
  chunks: DocumentChunk[]
): Promise<{ chunks: ChunkWithEmbedding[]; isReal: boolean }> {
  console.log(`[Ingestion/Embed] Embedding ${chunks.length} chunks via Voyage AI…`);

  const response = await embedDocuments({
    texts: chunks.map((c) => c.content),
  });

  const chunksWithEmbeddings: ChunkWithEmbedding[] = chunks.map((chunk, i) => ({
    ...chunk,
    embedding: response.embeddings[i] ?? [],
  }));

  console.log(
    `[Ingestion/Embed] Done — model: ${response.model}, real: ${response.isReal}`
  );

  return { chunks: chunksWithEmbeddings, isReal: response.isReal };
}

// ─── Step 4a: CSV Deterministic Metric Extraction ────────────────────────────

/** Maps metric name patterns to canonical metric_type values. */
const METRIC_TYPE_PATTERNS: Array<{
  patterns: RegExp[];
  type: ExtractedMetricRaw["metric_type"];
}> = [
  { patterns: [/\brevenue\b/i, /\bsales\b/i, /\bturnover\b/i], type: "revenue" },
  { patterns: [/\bebitda\b/i], type: "ebitda" },
  { patterns: [/net\s+income/i, /net\s+profit/i, /net\s+earn/i], type: "net_income" },
  { patterns: [/gross\s+profit/i, /gross\s+margin/i], type: "gross_profit" },
  { patterns: [/operating\s+income/i, /\bebit\b/i, /operating\s+profit/i], type: "operating_income" },
  { patterns: [/margin/i], type: "margin" },
  { patterns: [/guidance/i, /outlook/i, /forecast/i], type: "guidance" },
  { patterns: [/headcount/i, /employees/i, /\bfte\b/i], type: "headcount" },
];

function inferMetricType(name: string): ExtractedMetricRaw["metric_type"] {
  for (const { patterns, type } of METRIC_TYPE_PATTERNS) {
    if (patterns.some((p) => p.test(name))) return type;
  }
  return "custom";
}

/**
 * Parses a raw value string like "$128.4M", "25%", "32,000" into a numeric
 * value and a unit string.  Returns null value if unparseable.
 */
function parseNumericValue(raw: string): { value: number | null; unit: string | null } {
  const s = raw.trim();
  if (!s || s === "-" || /^n\/?a$/i.test(s)) return { value: null, unit: null };

  // e.g.  "$128.4M"  "32,000"  "25%"  "19.8 M"
  const match = s.match(/^([£$€]?)\s*([\d,]+(?:\.\d+)?)\s*([KkMmBbTt]?)\s*(%)?/);
  if (!match) return { value: null, unit: s };

  const [, currency, numStr, mult, pct] = match;
  let num = parseFloat(numStr.replace(/,/g, ""));
  if (isNaN(num)) return { value: null, unit: s };

  const m = mult.toUpperCase();
  if (m === "K") num *= 1_000;
  else if (m === "M") num *= 1_000_000;
  else if (m === "B") num *= 1_000_000_000;
  else if (m === "T") num *= 1_000_000_000_000;

  let unit: string | null = null;
  if (pct) unit = "%";
  else if (currency) unit = `${currency}${m || ""}`.trim() || null;
  else if (m) unit = m;

  return { value: num, unit };
}

/** Splits a single CSV line respecting double-quoted fields. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      fields.push(cur.trim().replace(/^"|"$/g, ""));
      cur = "";
    } else {
      cur += c;
    }
  }
  fields.push(cur.trim().replace(/^"|"$/g, ""));
  return fields;
}

/**
 * Infers the reporting period from a dedicated column value or the file name.
 * Returns a human-readable period string (e.g. "Q1 2026") and its type.
 */
function inferPeriod(
  headers: string[],
  firstRow: Record<string, string>,
  fileName: string
): { period: string | null; periodType: ExtractedMetricRaw["period_type"] } {
  // 1. Explicit Period/Quarter/Year column
  const periodCol = headers.find((h) => /^(period|quarter|year|date)$/i.test(h));
  if (periodCol) {
    const val = firstRow[periodCol]?.trim();
    if (val) {
      const isQ = /Q[1-4]/i.test(val);
      const isA = /annual|FY|full.?year/i.test(val);
      return { period: val, periodType: isQ ? "quarterly" : isA ? "annual" : "other" };
    }
  }

  // 2. File name  e.g. Q1_2026, Q1-2026, Q1 2026
  const qm = fileName.match(/Q([1-4])[\s_\-]?(\d{4})/i);
  if (qm) return { period: `Q${qm[1]} ${qm[2]}`, periodType: "quarterly" };

  const fy = fileName.match(/FY[\s_\-]?(\d{4})/i);
  if (fy) return { period: `FY${fy[1]}`, periodType: "annual" };

  const yr = fileName.match(/\b(20\d{2})\b/);
  if (yr) return { period: yr[1], periodType: "annual" };

  return { period: null, periodType: "quarterly" };
}

/**
 * Deterministically parses a CSV buffer into ExtractedMetricRaw[] with
 * confidence = 100.  Supports three common layouts:
 *
 *   Narrow:   Metric, Value [, Unit] [, Period]
 *   Wide:     Metric, Q1 2026, Q1 2025, …   (each period is a value column)
 *   Any mix of the above
 */
export function extractMetricsFromCsv(
  buffer: Buffer,
  fileName: string
): ExtractedMetricRaw[] {
  const text = buffer.toString("utf-8").trim();
  if (!text) return [];

  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);
  const dataRows = lines.slice(1).map((l) => {
    const vals = parseCsvLine(l);
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
  });

  // ── Identify columns by role ──────────────────────────────────────────────
  const metricCol = headers.find((h) =>
    /^(metric|name|description|label|item|account|measure)$/i.test(h)
  ) ?? headers[0]; // fall back to first column

  const knownNonValue = new Set(
    [
      metricCol,
      headers.find((h) => /^(unit|units)$/i.test(h)),
      headers.find((h) => /^(period|quarter|year|date)$/i.test(h)),
      headers.find((h) => /^(notes?|comments?)$/i.test(h)),
    ].filter(Boolean) as string[]
  );

  // Explicit value column, OR any column that isn't a known non-value col
  const explicitValueCol = headers.find((h) =>
    /^(value|amount|total|figure)$/i.test(h)
  );
  const valueCols = explicitValueCol
    ? [explicitValueCol]
    : headers.filter((h) => !knownNonValue.has(h));

  const unitCol = headers.find((h) => /^(unit|units)$/i.test(h));
  const periodCol = headers.find((h) => /^(period|quarter|year|date)$/i.test(h));

  const { period: defaultPeriod, periodType } = inferPeriod(
    headers,
    dataRows[0] ?? {},
    fileName
  );

  // ── Parse each row × each value column ───────────────────────────────────
  const metrics: ExtractedMetricRaw[] = [];

  for (const row of dataRows) {
    const metricName = row[metricCol]?.trim();
    if (!metricName) continue;

    const rowUnit = unitCol ? row[unitCol]?.trim() || null : null;
    const rowPeriod = periodCol ? row[periodCol]?.trim() || defaultPeriod : defaultPeriod;

    for (const col of valueCols) {
      const rawVal = row[col]?.trim();
      if (!rawVal || rawVal === "-") continue;

      const { value, unit: parsedUnit } = parseNumericValue(rawVal);

      // If the column header itself looks like a period (e.g. "Q1 2026") use it
      const colIsPeriod = /Q[1-4]|FY|20\d{2}/.test(col);
      const period = colIsPeriod ? col : rowPeriod;
      const pType: ExtractedMetricRaw["period_type"] = colIsPeriod
        ? (/Q[1-4]/i.test(col) ? "quarterly" : "annual")
        : periodType;

      metrics.push({
        metric_type: inferMetricType(metricName),
        metric_name: metricName,
        value,
        unit: rowUnit ?? parsedUnit,
        period,
        period_type: pType,
        raw_text: `${metricName}: ${rawVal}${rowUnit ? ` ${rowUnit}` : ""}`,
        page_number: 1,
        confidence: 100,
      });
    }
  }

  console.log(`[Ingestion/CSV] Extracted ${metrics.length} metrics deterministically`);
  return metrics;
}

// ─── Step 4b: Claude AI Metric Extraction ────────────────────────────────────

/**
 * Extracts structured financial metrics from all pages using Claude Haiku.
 * Runs pages in parallel batches (3 concurrent) to balance speed and rate limits.
 */
export async function extractMetrics(
  parsed: ParsedDocument,
  documentName: string
): Promise<ExtractedMetricRaw[]> {
  console.log(
    `[Ingestion/Extract] Running Claude metric extraction on ${parsed.totalPages} pages…`
  );

  const metrics = await extractMetricsFromPages(
    parsed.pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text })),
    documentName,
    { concurrency: 3, totalPages: parsed.totalPages }
  );

  console.log(`[Ingestion/Extract] Extracted ${metrics.length} financial metrics`);
  return metrics;
}

// ─── Pipeline Orchestrator ───────────────────────────────────────────────────

/**
 * Runs the full ingestion pipeline for a single document.
 * Called from the /api/ingestion route handler.
 *
 * @returns IngestionResult containing chunks (with embeddings), metrics, and metadata
 */
export async function runIngestionPipeline(
  buffer: Buffer,
  fileType: DocumentRow["file_type"],
  documentId: string,
  fileName = "document"
): Promise<IngestionResult> {
  const startTime = Date.now();
  console.log(`[Ingestion] Starting pipeline for document ${documentId}`);

  // Step 1: Parse
  const parsed = await parseDocument(buffer, fileType, fileName);

  // Step 2: Chunk
  const rawChunks = chunkDocument(parsed);
  console.log(`[Ingestion] Created ${rawChunks.length} chunks`);

  // Step 3: Embed
  const { chunks, isReal: embeddingsAreReal } = await embedChunks(rawChunks);

  // Step 4: Extract metrics
  // CSV files: parse deterministically first (confidence = 100, no AI needed).
  // Other files: run Claude Haiku extraction.
  let metrics: ExtractedMetricRaw[] = [];

  if (fileType === "csv" || fileType === "xlsx") {
    metrics = extractMetricsFromCsv(buffer, fileName);
  } else if (process.env.ANTHROPIC_API_KEY) {
    metrics = await extractMetrics(parsed, fileName);
  } else {
    console.warn(
      "[Ingestion] ANTHROPIC_API_KEY not set — skipping financial metric extraction"
    );
  }

  const elapsed = Date.now() - startTime;
  console.log(
    `[Ingestion] Pipeline complete in ${elapsed}ms: ` +
      `${chunks.length} chunks, ${metrics.length} metrics, ` +
      `embeddings real: ${embeddingsAreReal}`
  );

  return {
    chunks,
    metrics,
    totalPages: parsed.totalPages,
    embeddingsAreReal,
  };
}
