import { Controller, ForbiddenException, Get, Headers, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import { WhatsAppClient } from "../whatsapp/whatsapp.client";
import { ReminderService } from "./reminder.service";

/**
 * Polled by an external scheduler (GitHub Actions, not Vercel Cron — Vercel's Hobby
 * tier caps cron at once a day, useless for a "remind me at 5pm" feature). Anyone who
 * finds this URL could otherwise fire arbitrary WhatsApp sends on your number's
 * quota, so it is gated on a shared secret rather than left open like /webhook's GET.
 */
@Controller("cron/reminders")
export class ReminderController {
  private readonly logger = new Logger(ReminderController.name);

  constructor(
    private readonly reminders: ReminderService,
    private readonly client: WhatsAppClient,
    private readonly config: ConfigService
  ) {}

  @Get()
  async run(@Headers("x-cron-secret") providedSecret?: string): Promise<{ sent: number; failed: number }> {
    this.verifySecret(providedSecret);

    const due = await this.reminders.findDueUnsent();
    let sent = 0;
    let failed = 0;

    // Guarded per reminder, same reasoning as the webhook batch loop: one failed send
    // must not stop the rest of a sweep from going out.
    for (const reminder of due) {
      try {
        await this.client.sendText(reminder.whatsapp_number, `⏰ Reminder: ${reminder.content}`);
        await this.reminders.markSent(reminder.id);
        sent++;
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.stack ?? error.message : String(error);
        this.logger.error(`Failed to send reminder ${reminder.id}: ${detail}`);
        failed++;
      }
    }

    return { sent, failed };
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
