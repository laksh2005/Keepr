import { Body, Controller, Headers, Post } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IsString, Length, Matches } from "class-validator";
import { assertSecret } from "../common/secret";
import { WhatsAppClient } from "../whatsapp/whatsapp.client";

export class AdminSendDto {
  // E.164 digits without the plus, the shape the Cloud API takes.
  @Matches(/^\d{8,15}$/, { message: "to must be 8-15 digits, no plus or spaces" })
  to!: string;

  @IsString()
  @Length(1, 4096)
  message!: string;
}

/**
 * A one-off way to send arbitrary text to a number outside the normal
 * message-triggered flow (an announcement, a manual digest re-send). It can message
 * any number, so it has its own secret: a leaked CRON_SECRET (which lives in the
 * scheduler) should only let someone trigger the sweeps, never send free text.
 */
@Controller("admin/send")
export class AdminController {
  constructor(
    private readonly client: WhatsAppClient,
    private readonly config: ConfigService
  ) {}

  @Post()
  async send(
    @Headers("x-admin-secret") providedSecret: string | undefined,
    @Body() body: AdminSendDto
  ): Promise<{ ok: true }> {
    assertSecret(providedSecret, this.config.getOrThrow<string>("ADMIN_SECRET"));
    await this.client.sendText(body.to, body.message);
    return { ok: true };
  }
}
