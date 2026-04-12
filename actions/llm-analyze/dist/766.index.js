export const id = 766;
export const ids = [766];
export const modules = {

/***/ 3766:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   OpenAIProvider: () => (/* binding */ OpenAIProvider)
/* harmony export */ });
/**
 * OpenAI (GPT) LLM provider.
 *
 * Uses the chat completions API. Prompt caching is automatic on OpenAI's side
 * for matching prefixes (50% discount on cached input tokens).
 */
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const PRICING = {
    "gpt-4o": { input: 2.5, output: 10 },
    "gpt-4o-mini": { input: 0.15, output: 0.6 },
    "gpt-4.1": { input: 2, output: 8 },
    "gpt-4.1-mini": { input: 0.4, output: 1.6 },
    "gpt-4.1-nano": { input: 0.1, output: 0.4 },
    "o3": { input: 2, output: 8 },
    "o4-mini": { input: 1.1, output: 4.4 },
    default: { input: 2.5, output: 10 },
};
class OpenAIProvider {
    name = "openai";
    supportsCaching = true; // automatic prefix caching
    model;
    apiKey;
    baseUrl;
    maxRetries;
    retryDelayMs;
    constructor(config) {
        this.model = config.model;
        this.apiKey = config.apiKey;
        this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
        this.maxRetries = config.maxRetries ?? 5;
        this.retryDelayMs = config.retryDelayMs ?? 10_000;
    }
    async analyze(request) {
        const body = {
            model: this.model,
            max_completion_tokens: request.maxOutputTokens,
            temperature: request.temperature ?? 0,
            messages: [
                { role: "system", content: request.systemPrompt },
                { role: "user", content: request.userMessage },
            ],
        };
        const response = await this.callWithRetry(body);
        const content = response.choices[0]?.message?.content ?? "";
        return {
            content: stripCodeFences(content),
            usage: {
                inputTokens: response.usage.prompt_tokens,
                outputTokens: response.usage.completion_tokens,
                cacheReadTokens: response.usage.prompt_tokens_details?.cached_tokens,
            },
            model: response.model,
            provider: this.name,
        };
    }
    estimateCost(usage) {
        const prices = PRICING[this.model] ?? PRICING.default;
        const cachedTokens = usage.cacheReadTokens ?? 0;
        const uncachedInputTokens = usage.inputTokens - cachedTokens;
        const inputCost = (uncachedInputTokens / 1_000_000) * prices.input;
        const cachedCost = (cachedTokens / 1_000_000) * (prices.input * 0.5);
        const outputCost = (usage.outputTokens / 1_000_000) * prices.output;
        return inputCost + cachedCost + outputCost;
    }
    async callWithRetry(body) {
        let lastError;
        let delay = this.retryDelayMs;
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await fetch(`${this.baseUrl}/chat/completions`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        Authorization: `Bearer ${this.apiKey}`,
                    },
                    body: JSON.stringify(body),
                });
                if (response.ok) {
                    return (await response.json());
                }
                if (response.status === 429) {
                    console.error(`[openai] Rate limited, retry ${attempt}/${this.maxRetries} in ${delay}ms`);
                    await sleep(delay);
                    delay *= 2;
                    continue;
                }
                throw new Error(`OpenAI API HTTP ${response.status}: ${await response.text()}`);
            }
            catch (err) {
                lastError = err instanceof Error ? err : new Error(String(err));
                if (attempt < this.maxRetries && isNetworkError(lastError)) {
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
function stripCodeFences(text) {
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
function isNetworkError(err) {
    const msg = err.message.toLowerCase();
    return msg.includes("fetch") || msg.includes("network") || msg.includes("econnreset") || msg.includes("timeout");
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}


/***/ })

};
