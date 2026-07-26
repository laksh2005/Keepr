import { Injectable } from "@nestjs/common";
import { GeminiService, Intent } from "../gemini/gemini.service";
import { InboundMessage } from "../whatsapp/whatsapp.types";

@Injectable()
export class IntentService {
  constructor(private readonly gemini: GeminiService) {}

  async classify(message: InboundMessage): Promise<Intent> {
    if (message.type !== "text") return "save";
    return this.gemini.classifyIntent(message.text?.body ?? "");
  }
}
