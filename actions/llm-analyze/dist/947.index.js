export const id = 947;
export const ids = [947];
export const modules = {

/***/ 8947:
/***/ ((__unused_webpack_module, __webpack_exports__, __webpack_require__) => {

/* harmony export */ __webpack_require__.d(__webpack_exports__, {
/* harmony export */   GoogleProvider: () => (/* binding */ GoogleProvider)
/* harmony export */ });
/**
 * Google (Gemini) LLM provider.
 *
 * Uses the Gemini generateContent API.
 */
const DEFAULT_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const PRICING = {
    "gemini-2.5-pro": { input: 1.25, output: 10 },
    "gemini-2.5-flash": { input: 0.15, output: 0.6 },
    "gemini-2.0-flash": { input: 0.1, output: 0.4 },
    default: { input: 1.25, output: 10 },
};
class GoogleProvider {
    name = "google";
    supportsCaching = true;
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
            systemInstruction: {
                parts: [{ text: request.systemPrompt }],
            },
            contents: [
                {
                    role: "user",
                    parts: [{ text: request.userMessage }],
                },
            ],
            generationConfig: {
                maxOutputTokens: request.maxOutputTokens,
                temperature: request.temperature ?? 0,
            },
        };
        const url = `${this.baseUrl}/models/${this.model}:generateContent?key=${this.apiKey}`;
        const response = await this.callWithRetry(url, body);
        const content = response.candidates[0]?.content?.parts
            ?.map((p) => p.text)
            .join("") ?? "";
        return {
            content: stripCodeFences(content),
            usage: {
                inputTokens: response.usageMetadata.promptTokenCount,
                outputTokens: response.usageMetadata.candidatesTokenCount,
                cacheReadTokens: response.usageMetadata.cachedContentTokenCount,
            },
            model: response.modelVersion ?? this.model,
            provider: this.name,
        };
    }
    estimateCost(usage) {
        const prices = PRICING[this.model] ?? PRICING.default;
        const inputCost = (usage.inputTokens / 1_000_000) * prices.input;
        const outputCost = (usage.outputTokens / 1_000_000) * prices.output;
        return inputCost + outputCost;
    }
    async callWithRetry(url, body) {
        let lastError;
        let delay = this.retryDelayMs;
        for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
            try {
                const response = await fetch(url, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(body),
                });
                if (response.ok) {
                    return (await response.json());
                }
                if (response.status === 429 || response.status === 503) {
                    console.error(`[google] Rate limited (${response.status}), retry ${attempt}/${this.maxRetries}`);
                    await sleep(delay);
                    delay *= 2;
                    continue;
                }
                throw new Error(`Gemini API HTTP ${response.status}: ${await response.text()}`);
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
