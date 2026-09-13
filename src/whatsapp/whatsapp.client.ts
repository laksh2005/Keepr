import { BadGatewayException, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

@Injectable()
export class WhatsAppClient {
  private readonly logger = new Logger(WhatsAppClient.name);
  private readonly token: string;
  private readonly phoneNumberId: string;
  private readonly apiVersion: string;

  constructor(config: ConfigService) {
    this.token = config.getOrThrow<string>("WHATSAPP_CLOUD_API_TOKEN");
    this.phoneNumberId = config.getOrThrow<string>("WHATSAPP_PHONE_NUMBER_ID");
    this.apiVersion = config.getOrThrow<string>("WHATSAPP_GRAPH_API_VERSION");
  }

  async sendText(to: string, body: string, replyToMessageId?: string): Promise<void> {
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      ...(replyToMessageId ? { context: { message_id: replyToMessageId } } : {}),
      type: "text",
      text: { preview_url: false, body }
    };

    const response = await fetch(
      `https://graph.facebook.com/${this.apiVersion}/${this.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000)
      }
    );

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new BadGatewayException(`WhatsApp send failed (${response.status}): ${detail}`);
    }

    // Temporary: Meta accepting the request (2xx) isn't proof of delivery — logging
    // the response body (it echoes the recipient's wa_id and the message id Meta
    // assigned) to check whether the accepted number actually matches the sender.
    const accepted = await response.text();
    this.logger.log(`WhatsApp accepted send to ${to}: ${accepted}`);
  }
}
