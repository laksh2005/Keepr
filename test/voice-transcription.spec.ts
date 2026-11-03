import { ConfigService } from "@nestjs/config";
import { HuggingFaceService } from "../src/huggingface/huggingface.service";
import { IntentService } from "../src/intent/intent.service";
import { MemoryService } from "../src/memory/memory.service";
import { RecallService } from "../src/recall/recall.service";
import { ReminderService } from "../src/reminder/reminder.service";
import { ContextExtractorService } from "../src/whatsapp/context-extractor.service";
import { InboundLogService } from "../src/whatsapp/inbound-log.service";
import { oggDurationSeconds, VoiceTranscriptionService } from "../src/whatsapp/voice-transcription.service";
import { WhatsAppClient } from "../src/whatsapp/whatsapp.client";
import { WhatsAppService } from "../src/whatsapp/whatsapp.service";
import { InboundMessage } from "../src/whatsapp/whatsapp.types";

const voiceNote: InboundMessage = {
  id: "wamid.voice",
  from: "15550000001",
  timestamp: "1700000000",
  type: "audio",
  audio: { id: "media-123", voice: true, mime_type: "audio/ogg; codecs=opus" }
};

// Two Ogg pages; only the last page's granule position sets the length.
const oggOf = (seconds: number) => {
  const page = (granule: number) => {
    const header = Buffer.alloc(27);
    header.write("OggS", 0);
    header.writeBigUInt64LE(BigInt(granule), 6);
    return Buffer.concat([header, Buffer.from("opus-bytes")]);
  };
  return Buffer.concat([page(960), page(seconds * 48_000)]);
};

describe("oggDurationSeconds", () => {
  it("reads the length from the last page", () => expect(oggDurationSeconds(oggOf(12))).toBe(12));
  it("returns null for bytes that aren't Ogg", () => expect(oggDurationSeconds(Buffer.from("mp4 data"))).toBeNull());
});

const configWith = (env: Record<string, unknown>) =>
  ({ get: (key: string, fallback: unknown) => (key in env ? env[key] : fallback) }) as unknown as ConfigService;

describe("VoiceTranscriptionService", () => {
  const build = (enabled: boolean, overrides: { download?: jest.Mock; transcribe?: jest.Mock } = {}) => {
    const client = {
      downloadMedia: overrides.download ?? jest.fn().mockResolvedValue({ data: Buffer.from("ogg"), mimeType: "audio/ogg" })
    };
    const huggingFace = { transcribe: overrides.transcribe ?? jest.fn().mockResolvedValue("  call the plumber on monday  ") };
    const service = new VoiceTranscriptionService(
      client as unknown as WhatsAppClient,
      huggingFace as unknown as HuggingFaceService,
      configWith({ VOICE_TRANSCRIPTION: enabled })
    );
    return { service, client, huggingFace };
  };

  it("does nothing while switched off, not even a download", async () => {
    const { service, client, huggingFace } = build(false);
    await expect(service.transcribe(voiceNote)).resolves.toBeNull();
    expect(client.downloadMedia).not.toHaveBeenCalled();
    expect(huggingFace.transcribe).not.toHaveBeenCalled();
  });

  it("downloads the note with a size cap and returns the trimmed words", async () => {
    const { service, client, huggingFace } = build(true);
    await expect(service.transcribe(voiceNote)).resolves.toBe("call the plumber on monday");
    expect(client.downloadMedia).toHaveBeenCalledWith("media-123", 256 * 1024);
    expect(huggingFace.transcribe).toHaveBeenCalledWith(Buffer.from("ogg"), "audio/ogg");
  });

  it("skips notes over 30 seconds without calling the model", async () => {
    const download = jest.fn().mockResolvedValue({ data: oggOf(31), mimeType: "audio/ogg" });
    const { service, huggingFace } = build(true, { download });
    jest.spyOn((service as unknown as { logger: { warn: () => void } }).logger, "warn").mockImplementation(() => undefined);
    await expect(service.transcribe(voiceNote)).resolves.toBeNull();
    expect(huggingFace.transcribe).not.toHaveBeenCalled();
  });

  it("transcribes a note of exactly 30 seconds", async () => {
    const download = jest.fn().mockResolvedValue({ data: oggOf(30), mimeType: "audio/ogg" });
    const { service, huggingFace } = build(true, { download });
    await expect(service.transcribe(voiceNote)).resolves.toBe("call the plumber on monday");
    expect(huggingFace.transcribe).toHaveBeenCalled();
  });

  it("ignores anything that isn't audio", async () => {
    const { service, client } = build(true);
    await expect(service.transcribe({ ...voiceNote, type: "image", audio: undefined })).resolves.toBeNull();
    expect(client.downloadMedia).not.toHaveBeenCalled();
  });

  it("falls back to null when the download fails, without logging the audio or sender", async () => {
    const { service } = build(true, { download: jest.fn().mockRejectedValue(new Error("Media too large")) });
    const warn = jest.spyOn((service as unknown as { logger: { warn: () => void } }).logger, "warn").mockImplementation(() => undefined);
    await expect(service.transcribe(voiceNote)).resolves.toBeNull();
    const line = String((warn.mock.calls[0] as unknown[])[0]);
    expect(line).toContain("wamid.voice");
    expect(line).not.toContain("15550000001");
  });

  it("falls back to null when the model returns no words", async () => {
    const { service } = build(true, { transcribe: jest.fn().mockResolvedValue("   ") });
    await expect(service.transcribe(voiceNote)).resolves.toBeNull();
  });

  it("gives up after its time budget instead of eating the whole function limit", async () => {
    jest.useFakeTimers();
    try {
      const { service } = build(true, { transcribe: jest.fn(() => new Promise<string>(() => undefined)) });
      jest.spyOn((service as unknown as { logger: { warn: () => void } }).logger, "warn").mockImplementation(() => undefined);
      const pending = service.transcribe(voiceNote);
      await jest.advanceTimersByTimeAsync(30_000);
      await expect(pending).resolves.toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("HuggingFaceService.transcribe", () => {
  it("sends the audio as a typed blob to the configured speech model", async () => {
    const service = new HuggingFaceService({
      getOrThrow: () => "hf_test_token",
      get: (key: string, fallback: unknown) => (key === "HF_ASR_MODEL" ? "openai/whisper-large-v3-turbo" : fallback)
    } as unknown as ConfigService);
    const asr = jest.fn().mockResolvedValue({ text: " namaste, kal doctor ke paas jaana hai " });
    (service as unknown as { client: { automaticSpeechRecognition: jest.Mock } }).client = { automaticSpeechRecognition: asr };

    await expect(service.transcribe(Buffer.from([1, 2, 3]), "audio/ogg")).resolves.toBe("namaste, kal doctor ke paas jaana hai");
    const args = asr.mock.calls[0][0];
    expect(args.model).toBe("openai/whisper-large-v3-turbo");
    expect(args.provider).toBe("hf-inference");
    expect(args.inputs).toBeInstanceOf(Blob);
    expect(args.inputs.type).toBe("audio/ogg");
    expect(args.inputs.size).toBe(3);
  });
});

describe("WhatsAppClient.downloadMedia", () => {
  const client = new WhatsAppClient({
    getOrThrow: (key: string) => ({ WHATSAPP_CLOUD_API_TOKEN: "wa-token", WHATSAPP_PHONE_NUMBER_ID: "pn", WHATSAPP_GRAPH_API_VERSION: "v21.0" })[key]
  } as unknown as ConfigService);

  afterEach(() => jest.restoreAllMocks());

  it("looks up the media URL, then fetches the bytes, both with the token", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://lookaside.example/abc", mime_type: "audio/ogg", file_size: 3 })))
      .mockResolvedValueOnce(new Response(new Uint8Array([7, 8, 9])));

    const media = await client.downloadMedia("media-123", 1024);
    expect(media.mimeType).toBe("audio/ogg");
    expect([...media.data]).toEqual([7, 8, 9]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://graph.facebook.com/v21.0/media-123");
    expect(fetchMock.mock.calls[1][0]).toBe("https://lookaside.example/abc");
    for (const call of fetchMock.mock.calls) {
      expect((call[1] as RequestInit).headers).toEqual({ Authorization: "Bearer wa-token" });
    }
  });

  it("refuses a file over the cap before downloading it", async () => {
    const fetchMock = jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://lookaside.example/abc", file_size: 9_999 })));
    await expect(client.downloadMedia("media-123", 1024)).rejects.toThrow(/too large/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses bytes over the cap even when the size wasn't declared", async () => {
    jest
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: "https://lookaside.example/abc" })))
      .mockResolvedValueOnce(new Response(new Uint8Array(2048)));
    await expect(client.downloadMedia("media-123", 1024)).rejects.toThrow(/too large/);
  });
});

describe("WhatsAppService saving a voice note", () => {
  const build = (transcript: string | null) => {
    const memories = {
      save: jest.fn().mockResolvedValue({}),
      consumePendingLeadIn: jest.fn().mockResolvedValue(null),
      setPendingReminderOffer: jest.fn().mockResolvedValue(undefined)
    };
    const huggingFace = {
      summarize: jest.fn().mockImplementation(async (text: string) => text),
      embedDocument: jest.fn().mockResolvedValue([0.1])
    };
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const service = new WhatsAppService(
      { classify: jest.fn() } as unknown as IntentService,
      new ContextExtractorService(),
      huggingFace as unknown as HuggingFaceService,
      memories as unknown as MemoryService,
      {} as RecallService,
      {} as ReminderService,
      client as unknown as WhatsAppClient,
      {} as InboundLogService,
      { transcribe: jest.fn().mockResolvedValue(transcript) } as unknown as VoiceTranscriptionService
    );
    return { service, memories, client };
  };

  it("stores the transcript as the memory and echoes it back", async () => {
    const { service, memories, client } = build("buy milk and eggs");
    await service.processMessage(voiceNote);

    const saved = memories.save.mock.calls[0][0];
    expect(saved.context).toBe('Voice note: "buy milk and eggs"');
    expect(saved.type).toBe("voice");
    expect(JSON.stringify(memories.save.mock.calls)).not.toContain("media-123");
    expect(client.sendText.mock.calls[0][1]).toMatch(/^(Saved ✅|Stored 👍) 🎙️ "buy milk and eggs"$/);
  });

  it("offers a reminder when the voice note names a future day", async () => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] }).setSystemTime(new Date("2026-10-30T06:30:00Z"));
    try {
      const { service, memories, client } = build("dentist moved to 4pm thursday");
      await service.processMessage(voiceNote);
      expect(memories.setPendingReminderOffer).toHaveBeenCalled();
      expect(client.sendText.mock.calls[0][1]).toContain('🎙️ "dentist moved to 4pm thursday" Want a reminder Thu, Nov 5, 4:00 PM?');
    } finally {
      jest.useRealTimers();
    }
  });

  it("keeps today's placeholder when there is no transcript", async () => {
    const { service, memories, client } = build(null);
    await service.processMessage(voiceNote);
    expect(memories.save.mock.calls[0][0].context).toBe("Voice note, no additional context given");
    expect(client.sendText.mock.calls[0][1]).toMatch(/^(Saved ✅|Stored 👍)$/);
  });
});
