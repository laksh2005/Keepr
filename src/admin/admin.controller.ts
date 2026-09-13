import { Body, Controller, ForbiddenException, Headers, Post } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { timingSafeEqual } from "node:crypto";
import { WhatsAppClient } from "../whatsapp/whatsapp.client";

/**
 * A one-off way to send arbitrary text to a number outside the normal
 * message-triggered flow (an announcement, a manual digest re-send). Gated on the
 * same shared secret as the cron endpoints, since it exercises the same real
 * WhatsApp-send capability and must not be left open.
 */
@Controller("admin/send")
export class AdminController {
  constructor(
    private readonly client: WhatsAppClient,
    private readonly config: ConfigService
  ) {}

  @Post()
  async send(
    @Headers("x-cron-secret") providedSecret: string | undefined,
    @Body() body: { to?: string; message?: string }
  ): Promise<{ ok: true }> {
    this.verifySecret(providedSecret);
    if (!body.to || !body.message) {
      throw new ForbiddenException("to and message are required");
    }

    await this.client.sendText(body.to, body.message);
    return { ok: true };
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
