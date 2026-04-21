/**
 * Anthropic Client Singleton
 *
 * Creates and exports a single Anthropic SDK instance used across
 * the ingestion pipeline and orchestration layer.
 *
 * The SDK is imported lazily so Next.js can tree-shake it out of
 * client bundles (this module must only be imported in server code).
 */

import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

/**
 * Returns the shared Anthropic client.
 * Throws if ANTHROPIC_API_KEY is not configured.
 */
export function getAnthropicClient(): Anthropic {
  if (_client) return _client;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to your .env.local file."
    );
  }

  _client = new Anthropic({ apiKey });
  return _client;
}

/** Default model — configurable via ANTHROPIC_MODEL env var */
export const DEFAULT_MODEL =
  process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";

/** Haiku for fast, low-cost tasks (classification, short extraction) */
export const FAST_MODEL = "claude-haiku-4-5";

/**
 * Runs a tool-use call and returns the parsed tool input.
 * Throws if the model doesn't call the expected tool.
 *
 * @param systemPrompt - The system prompt
 * @param userMessage  - The user message
 * @param tool         - The Anthropic tool definition
 * @param model        - Model to use (defaults to DEFAULT_MODEL)
 * @param maxTokens    - Max output tokens
 */
export async function runToolCall<T>(
  systemPrompt: string,
  userMessage: string,
  tool: Anthropic.Tool,
  model = DEFAULT_MODEL,
  maxTokens = 2048
): Promise<T> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    tools: [tool],
    tool_choice: { type: "tool", name: tool.name },
    messages: [{ role: "user", content: userMessage }],
  });

  const toolUseBlock = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );

  if (!toolUseBlock) {
    throw new Error(
      `Anthropic did not call tool "${tool.name}". Stop reason: ${response.stop_reason}`
    );
  }

  return toolUseBlock.input as T;
}

/**
 * Runs a simple text completion (no tools).
 *
 * @param systemPrompt - The system prompt
 * @param userMessage  - The user message
 * @param model        - Model to use
 * @param maxTokens    - Max output tokens
 */
export async function runTextCompletion(
  systemPrompt: string,
  userMessage: string,
  model = DEFAULT_MODEL,
  maxTokens = 1024
): Promise<string> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );

  return textBlock?.text ?? "";
}
