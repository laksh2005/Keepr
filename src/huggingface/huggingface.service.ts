import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InferenceClient } from "@huggingface/inference";

export type Intent = "save" | "recall" | "list" | "delete" | "export" | "next";

const PROVIDER = "hf-inference";
const MIN_WORDS_TO_SUMMARIZE = 8;

@Injectable()
export class HuggingFaceService {
  private readonly client: InferenceClient;
  private readonly summarizationModel: string;
  private readonly embeddingModel: string;
  private readonly zeroShotModel: string;
  private readonly recallConfidenceThreshold: number;

  constructor(config: ConfigService) {
    this.client = new InferenceClient(config.getOrThrow<string>("HF_TOKEN"));
    this.summarizationModel = config.get<string>("HF_SUMMARIZATION_MODEL", "sshleifer/distilbart-cnn-6-6");
    this.embeddingModel = config.get<string>("HF_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2");
    this.zeroShotModel = config.get<string>("HF_ZERO_SHOT_MODEL", "facebook/bart-large-mnli");
    this.recallConfidenceThreshold = config.get<number>("HF_RECALL_CONFIDENCE_THRESHOLD", 0.6);
  }

  async classifyIntent(text: string): Promise<Intent> {
    const lower = text.toLowerCase().trim();
    if (/^list\b/.test(lower)) return "list";
    if (/^delete\b/.test(lower)) return "delete";
    if (/^export\b/.test(lower)) return "export";
    if (/^(next|more|show more)\b/.test(lower)) return "next";

    const result = await this.client.zeroShotClassification({
      model: this.zeroShotModel,
      inputs: text,
      parameters: { candidate_labels: ["save", "recall"] },
      provider: PROVIDER
    });
    if (!result?.length) {
      throw new ServiceUnavailableException("Hugging Face returned an empty classification response");
    }
    const top = result.reduce((best, current) => (current.score > best.score ? current : best));
    return top.label === "recall" && top.score >= this.recallConfidenceThreshold ? "recall" : "save";
  }

  async summarize(context: string): Promise<string> {
    if (this.wordCount(context) <= MIN_WORDS_TO_SUMMARIZE) {
      return context.length > 200 ? `${context.slice(0, 197)}...` : context;
    }

    const response = await this.client.summarization({
      model: this.summarizationModel,
      inputs: context,
      parameters: { max_length: 60, min_length: 8 },
      provider: PROVIDER
    });
    const essence = response.summary_text?.trim();
    if (!essence) {
      throw new ServiceUnavailableException("Hugging Face returned an empty summary");
    }
    return essence;
  }

  async embedDocument(text: string): Promise<number[]> {
    return this.embed(text);
  }

  async embedQuery(text: string): Promise<number[]> {
    return this.embed(text);
  }

  private async embed(text: string): Promise<number[]> {
    const values = await this.client.featureExtraction({
      model: this.embeddingModel,
      inputs: text,
      provider: PROVIDER
    });
    // A single string input can come back either batch-wrapped (number[][], one row)
    // or already flat (number[]) depending on model/provider — handle both.
    const vector = Array.isArray(values[0]) ? (values[0] as number[]) : (values as unknown as number[]);
    if (!Array.isArray(vector) || !vector.length || typeof vector[0] !== "number") {
      throw new ServiceUnavailableException("Hugging Face returned an unexpected embedding shape");
    }
    return vector;
  }

  private wordCount(text: string): number {
    return text.split(/\s+/).filter(Boolean).length;
  }
}
