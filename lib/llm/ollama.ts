/**
 * Ollama (local) LLM provider.
 *
 * Runs against a local Ollama server. No cost, no caching needed.
 * Useful for development/testing or air-gapped environments.
 */

import type { AnalysisRequest, AnalysisResponse, TokenUsage } from "../types.js";
import type { LLMProvider, LLMProviderConfig } from "./provider.js";

const DEFAULT_BASE_URL = "http://localhost:11434";

interface OllamaChatResponse {
  message: { role: string; content: string };
  model: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaProvider implements LLMProvider {
  readonly name = "ollama";
  readonly supportsCaching = false;

  private model: string;
  private baseUrl: string;
  private maxRetries: number;
  private retryDelayMs: number;

  constructor(config: LLMProviderConfig) {
    this.model = config.model;
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.maxRetries = config.maxRetries ?? 3;
    this.retryDelayMs = config.retryDelayMs ?? 5_000;
  }

  async analyze(request: AnalysisRequest): Promise<AnalysisResponse> {
    const body = {
      model: this.model,
      stream: false,
      options: {
        temperature: request.temperature ?? 0,
        num_predict: request.maxOutputTokens,
      },
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userMessage },
      ],
    };

    const response = await this.callWithRetry(body);
    const content = response.message?.content ?? "";

    return {
      content: stripCodeFences(content),
      usage: {
        inputTokens: response.prompt_eval_count ?? 0,
        outputTokens: response.eval_count ?? 0,
      },
      model: response.model,
      provider: this.name,
    };
  }

  estimateCost(_usage: TokenUsage): number {
    return 0; // local, no cost
  }

  private async callWithRetry(body: Record<string, unknown>): Promise<OllamaChatResponse> {
    let lastError: Error | undefined;
    let delay = this.retryDelayMs;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        if (response.ok) {
          return (await response.json()) as OllamaChatResponse;
        }

        throw new Error(`Ollama API HTTP ${response.status}: ${await response.text()}`);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.maxRetries) {
          console.error(`[ollama] Error, retry ${attempt}/${this.maxRetries}: ${lastError.message}`);
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
