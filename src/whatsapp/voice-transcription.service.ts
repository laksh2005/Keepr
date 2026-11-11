import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HuggingFaceService } from "../huggingface/huggingface.service";
import { WhatsAppClient } from "./whatsapp.client";
import { InboundMessage } from "./whatsapp.types";

// Only short voice notes are transcribed, to keep the speech model's cost down.
// Longer ones still save, just without text.
export const MAX_VOICE_SECONDS = 30;

// Refuses obviously long notes before downloading them. WhatsApp's opus voice notes
// run about 2-3KB a second, so this leaves room over 30s; the exact length is then
// read from the file itself.
const MAX_VOICE_BYTES = 256 * 1024;

// Opus in Ogg always counts granules at 48kHz.
const OPUS_GRANULE_RATE = 48_000;

/**
 * Length of an Ogg file in seconds, from the granule position of its last page,
 * or null when the bytes aren't Ogg.
 */
export function oggDurationSeconds(data: Buffer): number | null {
  const last = data.lastIndexOf("OggS");
  if (last < 0 || last + 14 > data.length) return null;
  return Number(data.readBigUInt64LE(last + 6)) / OPUS_GRANULE_RATE;
}

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
        const seconds = oggDurationSeconds(audio.data);
        if (seconds !== null && seconds > MAX_VOICE_SECONDS) {
          throw new Error(`longer than ${MAX_VOICE_SECONDS}s (${Math.round(seconds)}s)`);
        }
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
