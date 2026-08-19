import { Injectable, Logger } from "@nestjs/common";
import { expandAbbreviations } from "../common/text-expansion";
import { extractTemporalTerms } from "../common/temporal";
import { HuggingFaceService } from "../huggingface/huggingface.service";
import { IntentService } from "../intent/intent.service";
import { MemoryService } from "../memory/memory.service";
import { RecallService } from "../recall/recall.service";
import { ContextExtractorService } from "./context-extractor.service";
import { WhatsAppClient } from "./whatsapp.client";
import { InboundMessage, WebhookPayload } from "./whatsapp.types";

const SAVE_CONFIRMATIONS = ["Saved ✅", "Stored 👍"];

// "remember this" with nothing after it is someone about to send the actual thing —
// usually a photo or a link in the very next message. Saving the opener on its own
// created a memory that said nothing.
const LEAD_IN_ONLY = /^(remember|save|note|keep|store)(\s+(this|that|it))?\s*[:!.]*$/i;

// How long a parked opener stays attached to the next message.
const LEAD_IN_WINDOW_MS = 3 * 60 * 1000;

const CONFIRMATION = /^(yes|yep|yeah|yup|confirm|confirmed|do it|go ahead)\s*[!.]*$/i;

// A pending delete expires quickly: a "yes" minutes later is probably answering
// something else.
const DELETE_CONFIRM_WINDOW_MS = 2 * 60 * 1000;

// WhatsApp rejects a text body over 4096 characters. Leaving headroom keeps a long
// export from failing outright, which used to drop the whole reply silently.
const MAX_BODY_CHARS = 3500;

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

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
    // Guarded per message: a webhook can carry several, and one failure used to abort
    // the loop, so the messages behind it were dropped without Meta ever retrying.
    for (const message of messages) {
      try {
        await this.processMessage(message);
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.stack ?? error.message : String(error);
        this.logger.error(`Failed to process message ${message.id}: ${detail}`);
      }
    }
  }

  async processMessage(message: InboundMessage): Promise<void> {
    // Checked before classification: this is a deterministic shape, and the classifier
    // would just read it as a statement and save it.
    const body = message.text?.body?.trim() ?? "";
    if (message.type === "text" && LEAD_IN_ONLY.test(body)) {
      await this.handleLeadIn(message, body);
      return;
    }

    // Only intercepts "yes" when a delete is actually waiting on one — otherwise it
    // falls through and gets saved like any other message.
    if (message.type === "text" && CONFIRMATION.test(body)) {
      if (await this.handleDeleteConfirmation(message)) return;
    }

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

  private async handleLeadIn(message: InboundMessage, body: string): Promise<void> {
    await this.memories.setPendingLeadIn(message.from, body);
    await this.client.sendText(message.from, "Go ahead 👂");
  }

  private async handleSave(message: InboundMessage): Promise<void> {
    const extracted = this.extractor.extract(message);

    // If the previous message was a bare "remember this", fold it in so the pair is
    // stored as the one memory the sender meant.
    const leadIn = await this.memories.consumePendingLeadIn(message.from, LEAD_IN_WINDOW_MS);
    const context = leadIn ? `${leadIn} ${extracted.context}`.trim() : extracted.context;

    const essence = await this.huggingFace.summarize(context);
    const embedding = await this.huggingFace.embedDocument(
      expandAbbreviations(`${essence}\n${context}`)
    );
    await this.memories.save({
      whatsappNumber: message.from,
      messageId: message.id,
      type: extracted.type,
      context,
      essence,
      embedding,
      temporalTerms: extractTemporalTerms(context),
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
      await this.client.sendText(message.from, "Use: delete <search term>");
      return;
    }

    // Look before deleting: the term is matched as a substring, so a short one can
    // sweep up far more than the sender pictured, and there is no undo.
    const matches = await this.memories.findByEssenceForUser(message.from, query);
    if (!matches.length) {
      await this.client.sendText(message.from, `No memories matching "${query}" found.`);
      return;
    }

    if (matches.length === 1) {
      await this.memories.deleteByEssenceForUser(message.from, query);
      await this.client.sendText(message.from, "Deleted 1 memory.");
      return;
    }

    await this.memories.setPendingDelete(message.from, query);
    const preview = matches
      .slice(0, 5)
      .map((m) => `• ${m.essence}`)
      .join("\n");
    const more = matches.length > 5 ? `\n...and ${matches.length - 5} more` : "";
    await this.client.sendText(
      message.from,
      `That matches ${matches.length} memories:\n${preview}${more}\n\nReply "yes" to delete all ${matches.length}, or send a more specific term.`
    );
  }

  /** Returns true when a pending delete was found and acted on. */
  private async handleDeleteConfirmation(message: InboundMessage): Promise<boolean> {
    const query = await this.memories.consumePendingDelete(
      message.from,
      DELETE_CONFIRM_WINDOW_MS
    );
    if (!query) return false;

    const deleted = await this.memories.deleteByEssenceForUser(message.from, query);
    await this.client.sendText(
      message.from,
      `Deleted ${deleted} ${deleted === 1 ? "memory" : "memories"}.`
    );
    return true;
  }

  private async handleExport(message: InboundMessage): Promise<void> {
    const all = await this.memories.listForUser(message.from);
    if (!all.length) {
      await this.client.sendText(message.from, "You haven't saved any memories yet.");
      return;
    }

    const entries = all.map(
      (m) => `${m.essence}\n(Saved: ${m.received_at?.toISOString() ?? "unknown"})`
    );
    const chunks = chunkEntries(entries, MAX_BODY_CHARS);

    await this.client.sendText(message.from, `All ${all.length} memories 👇`);
    for (const chunk of chunks) {
      await this.client.sendText(message.from, chunk);
    }
  }
}

/**
 * Packs entries into message-sized blocks, splitting between entries rather than
 * mid-entry. An entry longer than `maxChars` on its own is truncated, since sending it
 * whole would have WhatsApp reject the entire message.
 */
export function chunkEntries(entries: string[], maxChars: number): string[] {
  const chunks: string[] = [];
  let current = "";

  for (const entry of entries) {
    const piece = entry.length > maxChars ? `${entry.slice(0, maxChars - 1)}…` : entry;

    if (!current) {
      current = piece;
    } else if (current.length + 2 + piece.length <= maxChars) {
      current += `\n\n${piece}`;
    } else {
      chunks.push(current);
      current = piece;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}
