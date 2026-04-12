/**
 * LLM Provider abstraction.
 *
 * Each provider implements this interface. The single-shot analyze() method
 * is the only LLM interaction -- no tool use, no multi-turn conversation.
 * Provider-specific features (prompt caching, retry logic) are handled
 * internally by each implementation.
 */

import type { AnalysisRequest, AnalysisResponse, TokenUsage } from "../types.js";

export interface LLMProvider {
  readonly name: string;
  readonly supportsCaching: boolean;

  /**
   * Send a single-shot analysis request.
   * The system prompt should be identical across calls in a run
   * to benefit from prompt caching where supported.
   */
  analyze(request: AnalysisRequest): Promise<AnalysisResponse>;

  /**
   * Estimate cost in USD for a given token usage.
   */
  estimateCost(usage: TokenUsage): number;
}

export interface LLMProviderConfig {
  provider: "anthropic" | "openai" | "google" | "ollama";
  model: string;
  apiKey: string;
  baseUrl?: string;
  maxRetries?: number;
  retryDelayMs?: number;
}

/**
 * Create an LLM provider from config.
 */
export async function createProvider(config: LLMProviderConfig): Promise<LLMProvider> {
  switch (config.provider) {
    case "anthropic": {
      const { AnthropicProvider } = await import("./anthropic.js");
      return new AnthropicProvider(config);
    }
    case "openai": {
      const { OpenAIProvider } = await import("./openai.js");
      return new OpenAIProvider(config);
    }
    case "google": {
      const { GoogleProvider } = await import("./google.js");
      return new GoogleProvider(config);
    }
    case "ollama": {
      const { OllamaProvider } = await import("./ollama.js");
      return new OllamaProvider(config);
    }
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}
