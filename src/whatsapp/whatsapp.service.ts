import { Injectable } from "@nestjs/common";
import { HuggingFaceService } from "../huggingface/huggingface.service";
import { IntentService } from "../intent/intent.service";
import { MemoryService } from "../memory/memory.service";
import { RecallService } from "../recall/recall.service";
import { ContextExtractorService } from "./context-extractor.service";
import { WhatsAppClient } from "./whatsapp.client";
import { InboundMessage, WebhookPayload } from "./whatsapp.types";

const SAVE_CONFIRMATIONS = ["Saved ✅", "Stored 👍"];

@Injectable()
export class WhatsAppService {
  constructor(
    private readonly intent: IntentService,
    private readonly extractor: ContextExtractorService,
    private readonly huggingFace: HuggingFaceService,
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
    if (message.type !== "text") {
      await this.handleSave(message);
      return;
    }

    switch (intent) {
      case "recall":
        await this.handleRecall(message);
        break;
      case "list":
        await this.handleList(message);
        break;
      case "delete":
        await this.handleDelete(message);
        break;
      case "export":
        await this.handleExport(message);
        break;
      case "next":
        await this.handleNext(message);
        break;
      default:
        await this.handleSave(message);
    }
  }

  private async handleSave(message: InboundMessage): Promise<void> {
    const extracted = this.extractor.extract(message);
    const essence = await this.huggingFace.summarize(extracted.context);
    const embedding = await this.huggingFace.embedDocument(`${essence}\n${extracted.context}`);
    await this.memories.save({
      whatsappNumber: message.from,
      messageId: message.id,
      type: extracted.type,
      context: extracted.context,
      essence,
      embedding,
      receivedAt: new Date(Number(message.timestamp) * 1000)
    });
    const confirmation = SAVE_CONFIRMATIONS[Math.floor(Math.random() * SAVE_CONFIRMATIONS.length)];
    await this.client.sendText(message.from, confirmation);
  }

  private async handleRecall(message: InboundMessage): Promise<void> {
    const query = message.text?.body?.trim() ?? "";
    const matches = await this.recall.find(message.from, query);
    if (!matches.length) {
      await this.client.sendText(message.from, "I couldn't find a matching memory.");
      return;
    }

    await this.memories.saveRecallResults(message.from, matches);
    await this.client.sendText(message.from, `${matches.length} found, closest first 👇`);
    if (matches.length > 0) {
      await this.client.sendText(message.from, matches[0].essence, matches[0].message_id);
      if (matches.length > 1) {
        await this.client.sendText(message.from, 'Type "next" to see more.');
      }
    }
  }

  private async handleNext(message: InboundMessage): Promise<void> {
    const next = await this.memories.getNextRecallResult(message.from);
    if (!next) {
      await this.client.sendText(message.from, "No more results.");
      return;
    }
    await this.client.sendText(message.from, next.essence, next.message_id);
  }

  private async handleList(message: InboundMessage): Promise<void> {
    const all = await this.memories.listForUser(message.from);
    if (!all.length) {
      await this.client.sendText(message.from, "You haven't saved any memories yet.");
      return;
    }
    await this.client.sendText(message.from, `You have ${all.length} saved memories:`);
    const summaries = all.map((m) => `• ${m.essence}`).slice(0, 10).join("\n");
    await this.client.sendText(message.from, summaries);
    if (all.length > 10) {
      await this.client.sendText(message.from, `...and ${all.length - 10} more. Use "export" to see all.`);
    }
  }

  private async handleDelete(message: InboundMessage): Promise<void> {
    const query = message.text?.body?.trim().replace(/^delete\b\s*/i, "").trim() ?? "";
    if (!query) {
      await this.client.sendText(message.from, 'Use: delete <search term>');
      return;
    }
    const deleted = await this.memories.deleteByEssenceForUser(message.from, query);
    if (deleted === 0) {
      await this.client.sendText(message.from, `No memories matching "${query}" found.`);
    } else {
      await this.client.sendText(message.from, `Deleted ${deleted} ${deleted === 1 ? "memory" : "memories"}.`);
    }
  }

  private async handleExport(message: InboundMessage): Promise<void> {
    const all = await this.memories.listForUser(message.from);
    if (!all.length) {
      await this.client.sendText(message.from, "You haven't saved any memories yet.");
      return;
    }
    const text = all.map((m) => `${m.essence}\n(Saved: ${m.received_at?.toISOString() ?? 'unknown'})`).join("\n\n");
    await this.client.sendText(message.from, `All ${all.length} memories:\n\n${text}`);
  }
}
