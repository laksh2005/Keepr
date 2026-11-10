import { BadGatewayException, ForbiddenException, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ReplyAllowlist } from "../common/reply-allowlist";

@Injectable()
export class WhatsAppClient {
  private readonly token: string;
  private readonly phoneNumberId: string;
  private readonly apiVersion: string;
  private readonly replyAllowlist: ReplyAllowlist;

  constructor(config: ConfigService) {
    this.token = config.getOrThrow<string>("WHATSAPP_CLOUD_API_TOKEN");
    this.phoneNumberId = config.getOrThrow<string>("WHATSAPP_PHONE_NUMBER_ID");
    this.apiVersion = config.getOrThrow<string>("WHATSAPP_GRAPH_API_VERSION");
    this.replyAllowlist = ReplyAllowlist.from(config);
  }

  /**
   * Fetches an inbound media file into memory: Meta first hands out a short-lived
   * URL for the media id, then the bytes behind it, both behind the same token.
   * Refuses anything over `maxBytes` before downloading it. The caller owns the
   * bytes and must not persist them.
   */
  async downloadMedia(mediaId: string, maxBytes: number): Promise<{ data: Buffer; mimeType: string }> {
    const headers = { Authorization: `Bearer ${this.token}` };
    const metaResponse = await fetch(`https://graph.facebook.com/${this.apiVersion}/${encodeURIComponent(mediaId)}`, {
      headers,
      signal: AbortSignal.timeout(10_000)
    });
    if (!metaResponse.ok) {
      throw new BadGatewayException(`WhatsApp media lookup failed (${metaResponse.status})`);
    }
    const meta = (await metaResponse.json()) as { url?: string; mime_type?: string; file_size?: number };
    if (!meta.url) throw new BadGatewayException("WhatsApp media lookup returned no URL");
    if ((meta.file_size ?? 0) > maxBytes) throw new BadGatewayException("Media too large");

    const fileResponse = await fetch(meta.url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!fileResponse.ok) {
      throw new BadGatewayException(`WhatsApp media download failed (${fileResponse.status})`);
    }
    const data = Buffer.from(await fileResponse.arrayBuffer());
    if (data.length > maxBytes) throw new BadGatewayException("Media too large");
    return {
      data,
      mimeType: meta.mime_type ?? fileResponse.headers.get("content-type") ?? "application/octet-stream"
    };
  }

  async sendText(to: string, body: string, replyToMessageId?: string): Promise<void> {
    await this.post(to, {
      ...(replyToMessageId ? { context: { message_id: replyToMessageId } } : {}),
      type: "text",
      text: { preview_url: false, body }
    });
  }

  /**
   * An approved message template, the only thing WhatsApp lets a business send once
   * 24 hours have passed since the user last wrote. Each param fills one {{n}} slot
   * of the template body, in order; newlines and long runs of spaces are not allowed
   * in a slot, so they are flattened.
   */
  async sendTemplate(to: string, name: string, languageCode: string, params: string[]): Promise<void> {
    await this.post(to, {
      type: "template",
      template: {
        name,
        language: { code: languageCode },
        components: params.length
          ? [
              {
                type: "body",
                parameters: params.map((text) => ({ type: "text", text: text.replace(/\s+/g, " ").trim().slice(0, 1000) }))
              }
            ]
          : []
      }
    });
  }

  private async post(to: string, content: Record<string, unknown>): Promise<void> {
    if (!this.replyAllowlist.allows(to)) {
      throw new ForbiddenException("Recipient is not in REPLY_ALLOWLIST");
    }
    const payload = { messaging_product: "whatsapp", recipient_type: "individual", to, ...content };

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

  }
}
