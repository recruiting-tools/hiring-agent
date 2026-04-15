/**
 * OpenRouter LLM adapter.
 * Uses the OpenAI-compatible API at https://openrouter.ai/api/v1/
 * Satisfies the { generate(prompt): Promise<string> } interface.
 */
export class OpenRouterAdapter {
  constructor({
    apiKey,
    model = "google/gemini-2.5-flash",
    timeoutMs = 45000,
    fetchImpl = globalThis.fetch
  }) {
    this.apiKey = apiKey;
    this.model = model;
    this.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 45000;
    this.fetchImpl = fetchImpl;
  }

  async generate(prompt, options = {}) {
    if (typeof this.fetchImpl !== "function") {
      throw new Error("fetch is not available for OpenRouterAdapter");
    }

    const model = options?.model ?? this.model;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), this.timeoutMs);
    let response;

    try {
      response = await this.fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }]
        }),
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error(`OpenRouter timeout after ${this.timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeoutHandle);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenRouter error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }
}
