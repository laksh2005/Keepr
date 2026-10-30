import { Injectable, Logger } from "@nestjs/common";
import { chunkEntries, MAX_WHATSAPP_BODY_CHARS } from "../common/message-chunking";
import { expandAbbreviations } from "../common/text-expansion";
import {
  looksLikeReminderAttempt,
  parseReminder,
  REMINDER_UTC_OFFSET_MINUTES
} from "../common/reminder-parsing";
import { extractTemporalTerms } from "../common/temporal";
import { HuggingFaceService } from "../huggingface/huggingface.service";
import { IntentService } from "../intent/intent.service";
import { MemoryService } from "../memory/memory.service";
import { RecallService } from "../recall/recall.service";
import { ReminderService } from "../reminder/reminder.service";
import { ContextExtractorService } from "./context-extractor.service";
import { InboundLogService } from "./inbound-log.service";
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

// Longest message kept. Far beyond any real note; it bounds storage and what is
// sent to inference (the models truncate well before this anyway).
export const MAX_CONTEXT_CHARS = 4000;

const LIST_PAGE_SIZE = 10;
const EXPORT_PAGE_SIZE = 50;

/** The page number in "list 3" / "export 2"; 1 when absent or nonsense. */
function requestedPage(body: string): number {
  const page = Number(/\s(\d+)\s*[.!?]*$/.exec(body)?.[1] ?? 1);
  return Number.isSafeInteger(page) && page >= 1 ? page : 1;
}

// How long "undo" can bring back the last delete.
const UNDO_WINDOW_MS = 10 * 60 * 1000;

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly intent: IntentService,
    private readonly extractor: ContextExtractorService,
    private readonly huggingFace: HuggingFaceService,
    private readonly memories: MemoryService,
    private readonly recall: RecallService,
    private readonly reminders: ReminderService,
    private readonly client: WhatsAppClient,
    private readonly inbound: InboundLogService
  ) {}

  async processWebhook(payload: WebhookPayload): Promise<void> {
    if (payload.object !== "whatsapp_business_account") return;

    // Temporary: delivery-status callbacks (sent/delivered/read/failed) also arrive
    // here on a non-"messages" field and are otherwise dropped silently — logging the
    // raw change to see why a message Meta accepted isn't reaching the device.
    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") {
          this.logger.log(`Non-message webhook change (${change.field}): ${JSON.stringify(change.value)}`);
        } else if (change.value && "statuses" in change.value) {
          this.logger.log(`Delivery status update: ${JSON.stringify((change.value as { statuses?: unknown }).statuses)}`);
        }
      }
    }

    const messages =
      payload.entry?.flatMap((entry) =>
        entry.changes?.flatMap((change) =>
          change.field === "messages" ? change.value?.messages ?? [] : []
        ) ?? []
      ) ?? [];
    // Guarded per message: a webhook can carry several, and one failure used to abort
    // the loop, so the messages behind it were dropped without Meta ever retrying.
    for (const message of messages) {
      // A Meta retry of a message already handled (or still in flight) is dropped
      // here, before it costs inference calls or sends a second reply.
      if (!(await this.inbound.claim(message.id))) continue;
      try {
        await this.processMessage(message);
        await this.inbound.markDone(message.id);
      } catch (error: unknown) {
        await this.inbound.markFailed(message.id);
        const detail = error instanceof Error ? error.stack ?? error.message : String(error);
        this.logger.error(`Failed to process message ${message.id}: ${detail}`);
      }
    }
  }

  async processMessage(message: InboundMessage): Promise<void> {
    // Checked before classification: these are deterministic shapes, and the
    // classifier would just read either as an ordinary statement and save it.
    const body = message.text?.body?.trim() ?? "";
    if (message.type === "text" && LEAD_IN_ONLY.test(body)) {
      await this.handleLeadIn(message, body);
      return;
    }

    if (message.type === "text" && looksLikeReminderAttempt(body)) {
      const parsed = parseReminder(body);
      if (parsed) {
        await this.handleReminder(message, parsed);
      } else {
        await this.client.sendText(
          message.from,
          "I couldn't find a time in that — try something like \"remind me to call mom on monday\" or \"remind me at 5pm to leave for the airport\"."
        );
      }
      return;
    }

    // Only intercepts "yes" when a delete is actually waiting on one — otherwise it
    // falls through and gets saved like any other message.
    if (message.type === "text" && CONFIRMATION.test(body)) {
      if (await this.handleDeleteConfirmation(message)) return;
    }

    // Media is always saved; classifying it first was a wasted inference call.
    if (message.type !== "text") {
      await this.handleSave(message);
      return;
    }

    const intent = await this.intent.classify(message);

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
      case "recapDay":
        await this.handleRecap(message, 1);
        break;
      case "recapWeek":
        await this.handleRecap(message, 7);
        break;
      case "next":
        await this.handleNext(message);
        break;
      case "help":
        await this.handleHelp(message);
        break;
      case "undo":
        await this.handleUndo(message);
        break;
      default:
        await this.handleSave(message);
    }
  }

  private async handleHelp(message: InboundMessage): Promise<void> {
    await this.client.sendText(
      message.from,
      [
        "*Keepr* — send it, forget it, find it.",
        "",
        "Send me anything: a link, a note, a photo, a half-formed thought. I'll keep it.",
        "Ask me about it later in plain English and I'll find it.",
        "",
        "Commands:",
        "• *list* — what you've saved (*list 2* for more)",
        "• *export* — everything, with dates (50 at a time)",
        "• *recap* / *today* — what you saved in the past day",
        "• *week recap* / *this week* — what you saved in the past week",
        "• *next* — more results after a search",
        "• *delete <word>* — remove memories matching that word",
        "• *undo* — bring back what you just deleted (within 10 minutes)",
        "• *remind me ... on/at ...* — I'll message you when it's due",
        "• *help* — this message",
        "",
        "Your photos, videos and voice notes are never stored."
      ].join("\n")
    );
  }

  private async handleReminder(
    message: InboundMessage,
    parsed: { content: string; dueAt: Date }
  ): Promise<void> {
    await this.reminders.create({
      whatsappNumber: message.from,
      messageId: message.id,
      content: parsed.content,
      dueAt: parsed.dueAt
    });

    // Shift by the offset first, then format as UTC — "UTC" is always supported,
    // avoiding the named-zone resolution that silently gave the wrong hour when
    // deployed (see the comment on REMINDER_UTC_OFFSET_MINUTES).
    const istWallClock = new Date(parsed.dueAt.getTime() + REMINDER_UTC_OFFSET_MINUTES * 60_000);
    const formatted = istWallClock.toLocaleString("en-US", {
      timeZone: "UTC",
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
    await this.client.sendText(message.from, `Got it! I'll remind you ${formatted}: ${parsed.content}`);
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
    const joined = leadIn ? `${leadIn} ${extracted.context}`.trim() : extracted.context;
    const context = joined.length > MAX_CONTEXT_CHARS ? `${joined.slice(0, MAX_CONTEXT_CHARS - 3)}...` : joined;

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

    // The top match is sent below, so "next" must resume from the one after it.
    await this.memories.saveRecallResults(message.from, matches, 1);
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
    const page = requestedPage(message.text?.body ?? "");
    const { items, total } = await this.memories.pageForUser(message.from, page, LIST_PAGE_SIZE);
    if (!total) {
      await this.client.sendText(message.from, "You haven't saved any memories yet.");
      return;
    }
    if (!items.length) {
      await this.client.sendText(message.from, `There's no page ${page}. You have ${total} saved memories.`);
      return;
    }
    await this.client.sendText(message.from, `You have ${total} saved memories:`);
    await this.client.sendText(message.from, items.map((m) => `• ${m.essence}`).join("\n"));
    const shown = (page - 1) * LIST_PAGE_SIZE + items.length;
    if (total > shown) {
      await this.client.sendText(
        message.from,
        `...and ${total - shown} more. Send "list ${page + 1}" for the next ${LIST_PAGE_SIZE}.`
      );
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
      await this.client.sendText(message.from, "Deleted 1 memory. Send *undo* to bring it back.");
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
      `Deleted ${deleted} ${deleted === 1 ? "memory" : "memories"}. Send *undo* to bring ${deleted === 1 ? "it" : "them"} back.`
    );
    return true;
  }

  private async handleUndo(message: InboundMessage): Promise<void> {
    const restored = await this.memories.undoLastDelete(message.from, UNDO_WINDOW_MS);
    await this.client.sendText(
      message.from,
      restored
        ? `Restored ${restored} ${restored === 1 ? "memory" : "memories"} ↩️`
        : "Nothing to undo."
    );
  }

  private async handleExport(message: InboundMessage): Promise<void> {
    const page = requestedPage(message.text?.body ?? "");
    const { items: all, total } = await this.memories.pageForUser(message.from, page, EXPORT_PAGE_SIZE);
    if (!total) {
      await this.client.sendText(message.from, "You haven't saved any memories yet.");
      return;
    }
    if (!all.length) {
      await this.client.sendText(message.from, `There's no page ${page}. You have ${total} saved memories.`);
      return;
    }

    const entries = all.map(
      (m) => `${m.essence}\n(Saved: ${m.received_at?.toISOString() ?? "unknown"})`
    );
    const chunks = chunkEntries(entries, MAX_WHATSAPP_BODY_CHARS);

    const first = (page - 1) * EXPORT_PAGE_SIZE + 1;
    const last = first + all.length - 1;
    await this.client.sendText(
      message.from,
      total <= EXPORT_PAGE_SIZE ? `All ${total} memories 👇` : `Memories ${first}-${last} of ${total} 👇`
    );
    for (const chunk of chunks) {
      await this.client.sendText(message.from, chunk);
    }
    if (total > last) {
      await this.client.sendText(message.from, `Send "export ${page + 1}" for the next ${EXPORT_PAGE_SIZE}.`);
    }
  }

  private async handleRecap(message: InboundMessage, days: 1 | 7): Promise<void> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const matches = await this.memories.listForUserSince(message.from, since);
    const label = days === 1 ? "day" : "week";

    if (!matches.length) {
      await this.client.sendText(message.from, `Nothing saved in the past ${label}.`);
      return;
    }

    const entries = matches.map(
      (m) => `${m.essence}\n(Saved: ${m.received_at?.toISOString() ?? "unknown"})`
    );
    const chunks = chunkEntries(entries, MAX_WHATSAPP_BODY_CHARS);

    await this.client.sendText(message.from, `${matches.length} saved in the past ${label} 👇`);
    for (const chunk of chunks) {
      await this.client.sendText(message.from, chunk);
    }
  }
}

export { chunkEntries };
