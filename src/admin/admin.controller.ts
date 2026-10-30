import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { IsString, Length, Matches } from "class-validator";
import { WhatsAppClient } from "../whatsapp/whatsapp.client";
import { AdminSecretGuard } from "./admin-secret.guard";

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
@UseGuards(AdminSecretGuard)
export class AdminController {
  constructor(private readonly client: WhatsAppClient) {}

  @Post()
  async send(@Body() body: AdminSendDto): Promise<{ ok: true }> {
    await this.client.sendText(body.to, body.message);
    return { ok: true };
  }
}
