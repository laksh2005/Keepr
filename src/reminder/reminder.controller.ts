import { Controller, Get, Headers, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ReplyAllowlist } from "../common/reply-allowlist";
import { assertSecret } from "../common/secret";
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
  async run(
    @Headers("x-cron-secret") providedSecret?: string
  ): Promise<{ sent: number; failed: number; gaveUp: number }> {
    assertSecret(providedSecret, this.config.getOrThrow<string>("CRON_SECRET"));

    // Reminders for numbers outside REPLY_ALLOWLIST are left pending, not sent and not
    // counted as failures, so they go out if the limit is ever lifted.
    const allowlist = ReplyAllowlist.from(this.config);
    const everyDue = await this.reminders.findDueUnsent();
    const due = everyDue.filter((reminder) => allowlist.allows(reminder.whatsapp_number));
    if (due.length < everyDue.length) {
      this.logger.warn(`Holding ${everyDue.length - due.length} reminder(s) for numbers outside REPLY_ALLOWLIST`);
    }
    let sent = 0;
    let failed = 0;
    let gaveUp = 0;

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
        try {
          if (await this.reminders.recordFailure(reminder.id, error instanceof Error ? error.message : String(error))) {
            this.logger.warn(`Gave up on reminder ${reminder.id} after repeated failures`);
            gaveUp++;
          }
        } catch (recordError: unknown) {
          this.logger.error(`Could not record failure for reminder ${reminder.id}: ${String(recordError)}`);
        }
      }
    }

    return { sent, failed, gaveUp };
  }
}
