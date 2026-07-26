import { Injectable } from "@nestjs/common";
import { MemoryType } from "../memory/schemas/memory.schema";
import { InboundMessage } from "./whatsapp.types";

export interface ExtractedMemory {
  type: MemoryType;
  context: string;
}

@Injectable()
export class ContextExtractorService {
  extract(message: InboundMessage): ExtractedMemory {
    const forwarded = message.context?.forwarded || message.context?.frequently_forwarded;
    const prefix = forwarded ? "Forwarded message. " : "";

    if (message.type === "text") {
      const text = message.text?.body?.trim() || "Text message with no content";
      return {
        type: forwarded ? "forwarded" : this.hasUrl(text) ? "link" : "text",
        context: `${prefix}${text}`
      };
    }

    if (message.type === "image") {
      return {
        type: forwarded ? "forwarded" : "image",
        context: `${prefix}${message.image?.caption?.trim() || "Image, no additional context given"}`
      };
    }

    if (message.type === "video") {
      return {
        type: forwarded ? "forwarded" : "video",
        context: `${prefix}${message.video?.caption?.trim() || "Video, no additional context given"}`
      };
    }

    if (message.type === "document") {
      const caption = message.document?.caption?.trim();
      const filename = message.document?.filename?.trim();
      const description = [caption, filename && `file: ${filename}`].filter(Boolean).join("; ");
      return {
        type: forwarded ? "forwarded" : "doc",
        context: `${prefix}${description || "Document, no additional context given"}`
      };
    }

    if (message.type === "audio") {
      return {
        type: forwarded ? "forwarded" : "voice",
        context: `${prefix}${message.audio?.voice ? "Voice note" : "Audio message"}, no additional context given`
      };
    }

    return {
      type: forwarded ? "forwarded" : "text",
      context: `${prefix}${message.type || "Unknown"} message, no additional context given`
    };
  }

  private hasUrl(value: string): boolean {
    return /\bhttps?:\/\/\S+/i.test(value) || /\bwww\.\S+/i.test(value);
  }
}
