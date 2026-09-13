import { Controller, ForbiddenException, Get, Headers, Logger, Query } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import { chunkEntries, MAX_WHATSAPP_BODY_CHARS } from "../common/message-chunking";
import { isDigestWindowNow } from "../common/digest-window";
import { MemoryService } from "../memory/memory.service";
import { WhatsAppClient } from "../whatsapp/whatsapp.client";
import { DigestService } from "./digest.service";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Polled by the same external scheduler as /cron/reminders, on the same short
 * interval — a once-a-week send has no room for "we'll catch it on the next daily
 * cron", so it needs a poller fine-grained enough to land inside the 5pm IST hour.
 * Gated on the shared cron secret for the same reason reminders is.
 */
@Controller("cron/digest")
export class DigestController {
  private readonly logger = new Logger(DigestController.name);

  constructor(
    private readonly digest: DigestService,
    private readonly memories: MemoryService,
    private readonly client: WhatsAppClient,
    private readonly config: ConfigService
  ) {}

  @Get()
  async run(
    @Headers("x-cron-secret") providedSecret?: string,
    // Still requires the same cron secret — this only exists so a real send can be
    // triggered on demand for review, without waiting for the next Sunday 5pm IST
    // window or letting a stale idempotency row from a prior manual send suppress it.
    @Query("force") force?: string
  ): Promise<{ sent: number; skipped: number; failed: number }> {
    this.verifySecret(providedSecret);

    if (force !== "true" && !isDigestWindowNow()) {
      return { sent: 0, skipped: 0, failed: 0 };
    }

    const numbers = await this.memories.listAllWhatsappNumbers();
    const since = new Date(Date.now() - WEEK_MS);
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    // Guarded per user, same reasoning as the reminder sweep and the webhook batch
    // loop: one failure must not stop the rest of the week's digests from going out.
    for (const whatsappNumber of numbers) {
      try {
        if (force !== "true" && (await this.digest.alreadySent(whatsappNumber))) {
          skipped++;
          continue;
        }

        const week = await this.memories.listForUserSince(whatsappNumber, since);
        if (!week.length) {
          skipped++;
          continue;
        }

        await this.sendDigest(whatsappNumber, week);
        await this.digest.markSent(whatsappNumber);
        sent++;
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.stack ?? error.message : String(error);
        this.logger.error(`Failed to send digest to ${whatsappNumber}: ${detail}`);
        failed++;
      }
    }

    return { sent, skipped, failed };
  }

  private async sendDigest(
    whatsappNumber: string,
    week: { essence: string; received_at: Date }[]
  ): Promise<void> {
    const entries = week.map((m) => `${m.essence}\n(Saved: ${m.received_at.toISOString()})`);
    const chunks = chunkEntries(entries, MAX_WHATSAPP_BODY_CHARS);

    await this.client.sendText(whatsappNumber, `Your week in Keepr 👋 ${week.length} memories saved:`);
    for (const chunk of chunks) {
      await this.client.sendText(whatsappNumber, chunk);
    }
  }

  private verifySecret(provided?: string): void {
    const expected = this.config.getOrThrow<string>("CRON_SECRET");
    const providedBuffer = Buffer.from(provided ?? "");
    const expectedBuffer = Buffer.from(expected);
    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      throw new ForbiddenException();
    }
  }
}
