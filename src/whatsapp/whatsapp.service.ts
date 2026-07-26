import { Injectable } from "@nestjs/common";
import { GeminiService } from "../gemini/gemini.service";
import { IntentService } from "../intent/intent.service";
import { MemoryService } from "../memory/memory.service";
import { RecallService } from "../recall/recall.service";
import { ContextExtractorService } from "./context-extractor.service";
import { WhatsAppClient } from "./whatsapp.client";
import { InboundMessage, WebhookPayload } from "./whatsapp.types";

@Injectable()
export class WhatsAppService {
  constructor(
    private readonly intent: IntentService,
    private readonly extractor: ContextExtractorService,
    private readonly gemini: GeminiService,
    private readonly memories: MemoryService,
    private readonly recall: RecallService,
    private readonly client: WhatsAppClient
  ) {}

  async processWebhook(payload: WebhookPayload): Promise<void> {
    if (payload.object !== "whatsapp_business_account") return;
    const messages =
      payload.entry?.flatMap((entry) =>
        entry.changes?.flatMap((change) =>
          change.field === "messages" ? change.value?.messages ?? [] : []
        ) ?? []
      ) ?? [];
    for (const message of messages) {
      await this.processMessage(message);
    }
  }

  async processMessage(message: InboundMessage): Promise<void> {
    const intent = await this.intent.classify(message);
    if (intent === "recall" && message.type === "text") {
      await this.handleRecall(message);
      return;
    }
    await this.handleSave(message);
  }

  private async handleSave(message: InboundMessage): Promise<void> {
    const extracted = this.extractor.extract(message);
    const essence = await this.gemini.summarize(extracted.context);
    const embedding = await this.gemini.embedDocument(`${essence}\n${extracted.context}`);
    await this.memories.save({
      whatsappNumber: message.from,
      messageId: message.id,
      type: extracted.type,
      context: extracted.context,
      essence,
      embedding,
      receivedAt: new Date(Number(message.timestamp) * 1000)
    });
    await this.client.sendText(message.from, "Saved ✓");
  }

  private async handleRecall(message: InboundMessage): Promise<void> {
    const query = message.text?.body?.trim() ?? "";
    const matches = await this.recall.find(message.from, query);
    if (!matches.length) {
      await this.client.sendText(message.from, "I couldn't find a matching memory.");
      return;
    }

    await this.client.sendText(message.from, `Found ${matches.length} ${matches.length === 1 ? "match" : "matches"} 👇`);
    for (const match of matches) {
      await this.client.sendText(message.from, match.essence, match.message_id);
    }
  }
}
