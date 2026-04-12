/**
 * Anthropic (Claude) LLM provider.
 *
 * Implements prompt caching via the anthropic-beta header.
 * The system prompt is marked with cache_control so it's reused across
 * multiple calls in the same run (e.g., multiple repos or dimension passes).
 */

import type { AnalysisRequest, AnalysisResponse, TokenUsage } from "../types.js";
import type { LLMProvider, LLMProviderConfig } from "./provider.js";

const CLAUDE_API = "https://api.anthropic.com/v1/messages";
const CLAUDE_VERSION = "2023-06-01";

// Pricing per million tokens (as of 2026)
const PRICING: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-sonnet-4-20250514": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-opus-4-20250514": { input: 15, output: 75, cacheRead: 1.5, cacheWrite: 18.75 },
  "claude-haiku-3-5-20241022": { input: 0.8, output: 4, cacheRead: 0.08, cacheWrite: 1 },
  // Fallback for unknown models
  default: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
};

interface AnthropicMessage {
  model: string;
  max_tokens: number;
  temperature?: number;
  system: Array<{
    type: "text";
    text: string;
    cache_control?: { type: "ephemeral" };
  }>;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
  }>;
}

interface AnthropicResponse {
  content: Array<{ type: string; text: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
  model: string;
  error?: { message: string };
}

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  readonly supportsCaching = true;

  private model: string;
  private apiKey: string;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(config: LLMProviderConfig) {
    this.model = config.model;
    this.apiKey = config.apiKey;
    this.maxRetries = config.maxRetries ?? 5;
    this.retryDelayMs = config.retryDelayMs ?? 10_000;
  }

  async analyze(request: AnalysisRequest): Promise<AnalysisResponse> {
    const body: AnthropicMessage = {
      model: this.model,
      max_tokens: request.maxOutputTokens,
      temperature: request.temperature ?? 0,
      system: [
        {
          type: "text",
          text: request.systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        { role: "user", content: request.userMessage },
      ],
    };

    const response = await this.callWithRetry(body);

    const textContent = response.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");

    // Strip markdown code fences if the model wraps its JSON response
    const cleaned = stripCodeFences(textContent);

    return {
      content: cleaned,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens,
        cacheWriteTokens: response.usage.cache_creation_input_tokens,
      },
      model: response.model,
      provider: this.name,
    };
  }

  estimateCost(usage: TokenUsage): number {
    const prices = PRICING[this.model] ?? PRICING.default;
    const inputCost = (usage.inputTokens / 1_000_000) * prices.input;
    const outputCost = (usage.outputTokens / 1_000_000) * prices.output;
    const cacheReadCost = ((usage.cacheReadTokens ?? 0) / 1_000_000) * prices.cacheRead;
    const cacheWriteCost = ((usage.cacheWriteTokens ?? 0) / 1_000_000) * prices.cacheWrite;
    return inputCost + outputCost + cacheReadCost + cacheWriteCost;
  }

  private async callWithRetry(body: AnthropicMessage): Promise<AnthropicResponse> {
    let lastError: Error | undefined;
    let delay = this.retryDelayMs;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(CLAUDE_API, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": this.apiKey,
            "anthropic-version": CLAUDE_VERSION,
            "anthropic-beta": "prompt-caching-2024-07-31",
          },
          body: JSON.stringify(body),
        });

        if (response.ok) {
          return (await response.json()) as AnthropicResponse;
        }

        const status = response.status;
        const errorBody = await response.text();

        // Retryable: rate limit or overloaded
        if (status === 429 || status === 529) {
          console.error(
            `[anthropic] Rate limited (HTTP ${status}), retry ${attempt}/${this.maxRetries} in ${delay}ms`,
          );
          await sleep(delay);
          delay *= 2;
          continue;
        }

        // Non-retryable error
        throw new Error(`Anthropic API HTTP ${status}: ${errorBody}`);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Network errors are retryable
        if (attempt < this.maxRetries && isNetworkError(lastError)) {
          console.error(
            `[anthropic] Network error, retry ${attempt}/${this.maxRetries} in ${delay}ms: ${lastError.message}`,
          );
          await sleep(delay);
          delay *= 2;
          continue;
        }

        throw lastError;
      }
    }

    throw lastError ?? new Error("Max retries exceeded");
  }
}

function stripCodeFences(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const firstNewline = trimmed.indexOf("\n");
    const lastFence = trimmed.lastIndexOf("```");
    if (lastFence > firstNewline) {
      return trimmed.slice(firstNewline + 1, lastFence).trim();
    }
  }
  return trimmed;
}

function isNetworkError(err: Error): boolean {
  const msg = err.message.toLowerCase();
  return msg.includes("fetch") || msg.includes("network") || msg.includes("econnreset") || msg.includes("timeout");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
