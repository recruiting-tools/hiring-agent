/**
 * OpenRouter LLM adapter.
 * Uses the OpenAI-compatible API at https://openrouter.ai/api/v1/
 * Satisfies the { generate(prompt): Promise<string> } interface.
 */
export class OpenRouterAdapter {
  constructor({ apiKey, model = "google/gemini-2.5-flash" }) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async generate(prompt) {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`OpenRouter error ${response.status}: ${text}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
  }
}
