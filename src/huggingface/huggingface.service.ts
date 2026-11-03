import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InferenceClient } from "@huggingface/inference";
import { isQuestion } from "../intent/question-detector";

export type Intent = "save" | "recall" | "list" | "delete" | "export" | "next" | "help" | "recapDay" | "recapWeek" | "undo";

const PROVIDER = "hf-inference";
// Short messages are already their own summary; only long ones cost a model call.
const MIN_WORDS_TO_SUMMARIZE = 35;

// Management commands are matched on the whole message, not as a prefix: "next
// week I fly to Berlin" and "list of groceries" are memories, not commands.
// "delete" is the exception — it always carries a search term after it.

const LIST_COMMANDS = new Set(["list", "list all", "list memories", "list my memories"]);
const EXPORT_COMMANDS = new Set(["export", "export all", "export memories", "export my memories"]);
const NEXT_COMMANDS = new Set(["next", "more", "show more", "next one"]);
const HELP_COMMANDS = new Set(["help", "commands", "what can you do", "how does this work"]);
const RECAP_DAY_COMMANDS = new Set(["recap", "today", "day recap", "recap today", "recap day", "past day", "last 24 hours", "last day"]);
const UNDO_COMMANDS = new Set(["undo", "undo delete", "restore", "bring it back"]);
const RECAP_WEEK_COMMANDS = new Set(["week recap", "recap week", "this week", "past week", "last week", "last 7 days"]);

@Injectable()
export class HuggingFaceService {
  private readonly client: InferenceClient;
  private readonly summarizationModel: string;
  private readonly embeddingModel: string;
  private readonly asrModel: string;

  constructor(config: ConfigService) {
    this.client = new InferenceClient(config.getOrThrow<string>("HF_TOKEN"));
    this.summarizationModel = config.get<string>("HF_SUMMARIZATION_MODEL", "sshleifer/distilbart-cnn-6-6");
    this.embeddingModel = config.get<string>("HF_EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2");
    this.asrModel = config.get<string>("HF_ASR_MODEL", "openai/whisper-large-v3-turbo");
  }

  async classifyIntent(text: string): Promise<Intent> {
    const command = text.toLowerCase().trim().replace(/[.!?]+$/, "");
    // "list 2" / "export 3" page through the rest.
    if (LIST_COMMANDS.has(command) || /^list \d+$/.test(command)) return "list";
    if (EXPORT_COMMANDS.has(command) || /^export \d+$/.test(command)) return "export";
    if (NEXT_COMMANDS.has(command)) return "next";
    if (HELP_COMMANDS.has(command)) return "help";
    if (UNDO_COMMANDS.has(command)) return "undo";
    if (RECAP_WEEK_COMMANDS.has(command)) return "recapWeek";
    if (RECAP_DAY_COMMANDS.has(command)) return "recapDay";
    if (/^delete\b/.test(command)) return "delete";

    // Rules, not the zero-shot model: one fewer Hugging Face call on every message.
    return isQuestion(text) ? "recall" : "save";
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

  /** Speech to text. Whisper handles Hindi and English, and mixes of the two. */
  async transcribe(audio: Buffer, mimeType: string): Promise<string> {
    const result = await this.client.automaticSpeechRecognition({
      model: this.asrModel,
      inputs: new Blob([new Uint8Array(audio)], { type: mimeType }),
      provider: PROVIDER
    });
    return result?.text?.trim() ?? "";
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
