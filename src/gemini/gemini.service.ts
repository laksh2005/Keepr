import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { GoogleGenAI, Type } from "@google/genai";

export type Intent = "save" | "recall";

@Injectable()
export class GeminiService {
  private readonly client: GoogleGenAI;
  private readonly generativeModel: string;
  private readonly embeddingModel: string;
  private readonly dimensions: number;

  constructor(config: ConfigService) {
    this.client = new GoogleGenAI({ apiKey: config.getOrThrow<string>("GEMINI_API_KEY") });
    this.generativeModel = config.getOrThrow<string>("GEMINI_GENERATIVE_MODEL");
    this.embeddingModel = config.get<string>("GEMINI_EMBEDDING_MODEL", "gemini-embedding-001");
    this.dimensions = config.get<number>("GEMINI_EMBEDDING_DIMENSIONS", 768);
  }

  async classifyIntent(text: string): Promise<Intent> {
    const prompt =
      `Classify this WhatsApp message for a personal-memory bot. ` +
      `RECALL means the user asks to find, show, remember, retrieve, or locate something saved earlier. ` +
      `SAVE means any information, note, link, or thought to keep. Ambiguous statements are SAVE.\nMessage: ${text}`;

    const response = await this.client.models.generateContent({
      model: this.generativeModel,
      contents: prompt,
      config: {
        temperature: 0,
        maxOutputTokens: 20,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: { intent: { type: Type.STRING, enum: ["save", "recall"] } },
          required: ["intent"]
        }
      }
    });

    try {
      const parsed = JSON.parse(response.text ?? "") as { intent?: string };
      return parsed.intent === "recall" ? "recall" : "save";
    } catch {
      throw new ServiceUnavailableException("Gemini returned an invalid intent response");
    }
  }

  async summarize(context: string): Promise<string> {
    const response = await this.client.models.generateContent({
      model: this.generativeModel,
      contents:
        `Write a compact searchable essence (maximum 25 words) for this saved WhatsApp context. ` +
        `Preserve names, dates, topics, URLs, and distinguishing details. Return only the essence.\n${context}`,
      config: { temperature: 0.1, maxOutputTokens: 60 }
    });
    const essence = response.text?.trim();
    if (!essence) {
      throw new ServiceUnavailableException("Gemini returned an empty summary");
    }
    return essence;
  }

  async embedDocument(text: string): Promise<number[]> {
    return this.embed(text, "RETRIEVAL_DOCUMENT");
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text, "RETRIEVAL_QUERY");
  }

  private async embed(
    text: string,
    taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY"
  ): Promise<number[]> {
    const response = await this.client.models.embedContent({
      model: this.embeddingModel,
      contents: text,
      config: { taskType, outputDimensionality: this.dimensions }
    });
    const values = response.embeddings?.[0]?.values;
    if (!values?.length) {
      throw new ServiceUnavailableException("Gemini returned an empty embedding");
    }
    return values;
  }
}
