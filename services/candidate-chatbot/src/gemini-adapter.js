import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildPrompt } from "./prompt-builder.js";

export class GeminiAdapter {
  constructor({ apiKey, model = "gemini-2.5-flash" }) {
    this.genAI = new GoogleGenerativeAI(apiKey);
    this.modelName = model;
  }

  async generate(prompt) {
    const model = this.genAI.getGenerativeModel({
      model: this.modelName
    });
    const result = await model.generateContent(prompt);
    return result.response.text();
  }

  async evaluate({ job, candidate, pendingSteps, pendingTemplateSteps, history, inboundMessage }) {
    const prompt = buildPrompt({ job, candidate, pendingSteps, pendingTemplateSteps, history, inboundMessage });
    const model = this.genAI.getGenerativeModel({
      model: this.modelName,
      generationConfig: { responseMimeType: "application/json" }
    });
    const result = await model.generateContent(prompt);
    return JSON.parse(result.response.text());
  }
}
