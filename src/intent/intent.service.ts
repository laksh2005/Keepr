import { Injectable } from "@nestjs/common";
import { HuggingFaceService, Intent } from "../huggingface/huggingface.service";
import { InboundMessage } from "../whatsapp/whatsapp.types";

@Injectable()
export class IntentService {
  constructor(private readonly huggingFace: HuggingFaceService) {}

  async classify(message: InboundMessage): Promise<Intent> {
    if (message.type !== "text") return "save";
    return this.huggingFace.classifyIntent(message.text?.body ?? "");
  }
}
