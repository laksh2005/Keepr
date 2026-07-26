import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  RawBodyRequest,
  Req
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { WhatsAppService } from "./whatsapp.service";
import { WebhookPayload } from "./whatsapp.types";

@Controller("webhook")
export class WhatsAppController {
  constructor(
    private readonly service: WhatsAppService,
    private readonly config: ConfigService
  ) {}

  @Get()
  verify(
    @Query("hub.mode") mode?: string,
    @Query("hub.verify_token") token?: string,
    @Query("hub.challenge") challenge?: string
  ): string {
    if (
      mode !== "subscribe" ||
      !challenge ||
      token !== this.config.getOrThrow<string>("WHATSAPP_WEBHOOK_VERIFY_TOKEN")
    ) {
      throw new ForbiddenException();
    }
    return challenge;
  }

  @Post()
  @HttpCode(200)
  async receive(
    @Req() request: RawBodyRequest<Request>,
    @Headers("x-hub-signature-256") signature?: string
  ): Promise<{ received: true }> {
    this.verifySignature(request.rawBody, signature);
    await this.service.processWebhook(request.body as WebhookPayload);
    return { received: true };
  }

  private verifySignature(rawBody: Buffer | undefined, signature?: string): void {
    const appSecret = this.config.get<string>("WHATSAPP_APP_SECRET");
    if (!appSecret && this.config.get<string>("NODE_ENV") !== "production") return;
    if (!appSecret || !rawBody || !signature?.startsWith("sha256=")) {
      throw new ForbiddenException("Invalid webhook signature");
    }
    const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      throw new ForbiddenException("Invalid webhook signature");
    }
  }
}
