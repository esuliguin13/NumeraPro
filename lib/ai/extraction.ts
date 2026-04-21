/**
 * Financial Metric Extraction
 *
 * Uses Claude with tool use to extract structured financial metrics from
 * document pages. This runs during the ingestion pipeline and populates
 * the `extracted_financial_metrics` table.
 *
 * Uses structured output via Anthropic's tool_use feature to guarantee
 * a typed JSON response matching our database schema.
 */

import type Anthropic from "@anthropic-ai/sdk";
import { runToolCall, FAST_MODEL } from "./anthropic";
import {
  EXTRACTION_SYSTEM_PROMPT,
  buildExtractionUserPrompt,
} from "./prompts";
import type { ExtractionRequest, ExtractionResponse, ExtractedMetricRaw } from "./types";

// ─── Tool Definition ─────────────────────────────────────────────────────────

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "extract_financial_metrics",
  description:
    "Extract all financial metrics from the document page and return them as structured data.",
  input_schema: {
    type: "object" as const,
    properties: {
      metrics: {
        type: "array",
        description: "Array of extracted financial metrics. Empty array if none found.",
        items: {
          type: "object",
          properties: {
            metric_type: {
              type: "string",
              enum: [
                "revenue",
                "ebitda",
                "net_income",
                "gross_profit",
                "operating_income",
                "margin",
                "guidance",
                "headcount",
                "custom",
              ],
              description:
                "Category of the metric. Use 'custom' for metrics that don't fit the other categories.",
            },
            metric_name: {
              type: "string",
              description:
                "Human-readable metric name (e.g., 'Q3 2024 Revenue', 'FY2024 EBITDA Margin', 'Adjusted EBITDA')",
            },
            value: {
              type: ["number", "null"],
              description: "Numeric value. Null if the value is qualitative (e.g., a range or description).",
            },
            unit: {
              type: ["string", "null"],
              description:
                "Unit of measurement. Examples: '$', '%', 'USD millions', 'employees', 'basis points'. Null if not applicable.",
            },
            period: {
              type: ["string", "null"],
              description: "Time period as stated in the document (e.g., 'Q3 2024', 'FY2024', 'full year 2023'). Null if not specified.",
            },
            period_type: {
              type: ["string", "null"],
              enum: ["annual", "quarterly", "ttm", "other", null],
              description: "Classification of the period. 'ttm' = trailing twelve months.",
            },
            raw_text: {
              type: "string",
              description: "The exact sentence or phrase from the document that contains this metric.",
            },
            confidence: {
              type: "number",
              description: "Confidence score from 0–100 indicating how clearly this metric is stated.",
              minimum: 0,
              maximum: 100,
            },
          },
          required: [
            "metric_type",
            "metric_name",
            "raw_text",
            "confidence",
          ],
        },
      },
    },
    required: ["metrics"],
  },
};

interface ExtractionToolInput {
  metrics: ExtractedMetricRaw[];
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extracts financial metrics from a single document page using Claude.
 * Uses claude-haiku-4-5 (fast model) since extraction is done per-page
 * and latency/cost accumulate quickly.
 */
export async function extractMetricsFromPage(
  request: ExtractionRequest & { totalPages?: number }
): Promise<ExtractionResponse> {
  const userPrompt = buildExtractionUserPrompt({
    pageText: request.pageText,
    pageNumber: request.pageNumber,
    documentName: request.documentName,
    totalPages: request.totalPages,
  });

  try {
    const result = await runToolCall<ExtractionToolInput>(
      EXTRACTION_SYSTEM_PROMPT,
      userPrompt,
      EXTRACTION_TOOL,
      FAST_MODEL, // Use haiku for cost efficiency on per-page extraction
      1024
    );

    const metrics: ExtractedMetricRaw[] = (result.metrics ?? []).map((m) => ({
      metric_type: m.metric_type ?? "custom",
      metric_name: m.metric_name,
      value: m.value ?? null,
      unit: m.unit ?? null,
      period: m.period ?? null,
      period_type: m.period_type ?? null,
      raw_text: m.raw_text,
      page_number: request.pageNumber,
      confidence: Math.min(100, Math.max(0, m.confidence ?? 70)),
    }));

    return { metrics };
  } catch (err) {
    console.error(
      `[Extraction] Failed for page ${request.pageNumber}:`,
      err instanceof Error ? err.message : err
    );
    // Return empty metrics rather than failing the whole pipeline
    return { metrics: [] };
  }
}

/**
 * Extracts metrics from multiple pages, batching calls to stay within
 * API rate limits. Skips pages with fewer than 100 characters.
 */
export async function extractMetricsFromPages(
  pages: Array<{ pageNumber: number; text: string }>,
  documentName: string,
  options: { concurrency?: number; totalPages?: number } = {}
): Promise<ExtractedMetricRaw[]> {
  const { concurrency = 3, totalPages } = options;
  const allMetrics: ExtractedMetricRaw[] = [];

  // Filter out near-empty pages
  const substantialPages = pages.filter((p) => p.text.trim().length > 100);

  // Process in batches to respect rate limits
  for (let i = 0; i < substantialPages.length; i += concurrency) {
    const batch = substantialPages.slice(i, i + concurrency);
    const results = await Promise.allSettled(
      batch.map((page) =>
        extractMetricsFromPage({
          pageText: page.text,
          pageNumber: page.pageNumber,
          documentName,
          totalPages,
        })
      )
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        allMetrics.push(...result.value.metrics);
      }
    }
  }

  return allMetrics;
}
