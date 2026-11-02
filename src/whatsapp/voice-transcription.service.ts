import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HuggingFaceService } from "../huggingface/huggingface.service";
import { WhatsAppClient } from "./whatsapp.client";
import { InboundMessage } from "./whatsapp.types";

// About four minutes of WhatsApp's opus voice notes. Longer ones are skipped rather
// than risking the function's time limit; the save still goes through without text.
const MAX_VOICE_BYTES = 5 * 1024 * 1024;

// Whole download-and-transcribe budget, well inside Vercel's 60s function limit so
// the rest of the save (summary, embedding, write, reply) still has room.
const TRANSCRIBE_BUDGET_MS = 30_000;

/**
 * Turns a voice note into text for the memory. The audio is fetched into memory,
 * handed to the speech model and dropped: it is never written to disk, the
 * database or a log. Off unless VOICE_TRANSCRIPTION=true, since Keepr's privacy copy
 * promises no transcription until that is deliberately switched on.
 */
@Injectable()
export class VoiceTranscriptionService {
  private readonly logger = new Logger(VoiceTranscriptionService.name);
  private readonly enabled: boolean;

  constructor(
    private readonly client: WhatsAppClient,
    private readonly huggingFace: HuggingFaceService,
    config: ConfigService
  ) {
    this.enabled = String(config.get("VOICE_TRANSCRIPTION", false)) === "true";
  }

  /** The words in a voice note, or null when off, not audio, or anything fails. */
  async transcribe(message: InboundMessage): Promise<string | null> {
    const mediaId = message.audio?.id;
    if (!this.enabled || message.type !== "audio" || !mediaId) return null;

    let timer: NodeJS.Timeout | undefined;
    try {
      const work = (async () => {
        const audio = await this.client.downloadMedia(mediaId, MAX_VOICE_BYTES);
        return this.huggingFace.transcribe(audio.data, audio.mimeType);
      })();
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timed out")), TRANSCRIBE_BUDGET_MS);
      });
      const text = (await Promise.race([work, timeout])).trim();
      return text || null;
    } catch (error: unknown) {
      // The message id only: never the audio, the transcript or the sender.
      this.logger.warn(
        `Voice transcription skipped for ${message.id}: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
