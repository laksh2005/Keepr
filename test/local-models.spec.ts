import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { extractiveSummary } from "../src/common/summary";
import { envValidationSchema } from "../src/config/env.validation";
import { HuggingFaceService } from "../src/huggingface/huggingface.service";
import { LocalEmbeddingService } from "../src/huggingface/local-embedding.service";
import { VoiceTranscriptionService } from "../src/whatsapp/voice-transcription.service";
import { WhatsAppClient } from "../src/whatsapp/whatsapp.client";

const unit = (length: number) => Float32Array.from({ length }, (_, i) => (i === 0 ? 1 : 0));

// The real package is never loaded: the loader is the seam, replaced with a fake.
class FakeLocalEmbedding extends LocalEmbeddingService {
  loads = 0;
  constructor(private readonly output: () => Promise<{ data: ArrayLike<number> }>, private readonly failLoad = false) {
    super();
  }
  protected async loadExtractor() {
    this.loads++;
    if (this.failLoad) throw new Error("model files missing");
    return async () => this.output();
  }
}

describe("LocalEmbeddingService", () => {
  it("returns a 384-number vector and loads the model once for concurrent calls", async () => {
    const service = new FakeLocalEmbedding(async () => ({ data: unit(384) }));
    const [a, b] = await Promise.all([service.embed("wifi"), service.embed("password")]);
    expect(a).toHaveLength(384);
    expect(b[0]).toBe(1);
    expect(service.loads).toBe(1);
  });

  it("rejects a vector of the wrong size", async () => {
    const service = new FakeLocalEmbedding(async () => ({ data: unit(10) }));
    await expect(service.embed("x")).rejects.toThrow(/unexpected shape/);
  });

  it("reports a failed load as unavailable and tries again on the next message", async () => {
    const service = new FakeLocalEmbedding(async () => ({ data: unit(384) }), true);
    await expect(service.embed("x")).rejects.toThrow(ServiceUnavailableException);
    await expect(service.embed("x")).rejects.toThrow(/model files missing/);
    expect(service.loads).toBe(2);
  });
});

describe("extractiveSummary", () => {
  it("leaves short text as it is", () => expect(extractiveSummary("buy milk")).toBe("buy milk"));

  it("keeps whole opening sentences while they fit", () => {
    const text = `${"First sentence here. ".repeat(3)}${"Another long sentence that goes on and on. ".repeat(10)}`;
    const summary = extractiveSummary(text);
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary.startsWith("First sentence here.")).toBe(true);
    expect(summary.endsWith(".")).toBe(true);
  });

  it("cuts a single very long sentence", () => {
    const summary = extractiveSummary("word ".repeat(100));
    expect(summary).toHaveLength(200);
    expect(summary.endsWith("...")).toBe(true);
  });
});

describe("HuggingFaceService in local mode", () => {
  const config = (env: Record<string, unknown>) =>
    ({
      get: (key: string, fallback: unknown) => (key in env ? env[key] : fallback),
      getOrThrow: (key: string) => {
        if (!(key in env)) throw new Error(`missing ${key}`);
        return env[key];
      }
    }) as unknown as ConfigService;

  it("needs no token and never builds a Hugging Face client", async () => {
    const local = { embed: jest.fn().mockResolvedValue([0.5]) };
    const service = new HuggingFaceService(config({ LOCAL_MODELS: true }), local as unknown as LocalEmbeddingService);
    expect((service as unknown as { client?: unknown }).client).toBeUndefined();

    await expect(service.embedDocument("a")).resolves.toEqual([0.5]);
    await expect(service.embedQuery("b")).resolves.toEqual([0.5]);
    expect(local.embed).toHaveBeenCalledTimes(2);
  });

  it("summarises long text without a model and leaves short text alone", async () => {
    const service = new HuggingFaceService(config({ LOCAL_MODELS: true }), {} as LocalEmbeddingService);
    await expect(service.summarize("buy milk")).resolves.toBe("buy milk");
    const long = `${"The plan is to meet at noon. ".repeat(20)}`;
    const summary = await service.summarize(long);
    expect(summary.length).toBeLessThanOrEqual(200);
    expect(summary.startsWith("The plan is to meet at noon.")).toBe(true);
  });

  it("refuses speech to text", async () => {
    const service = new HuggingFaceService(config({ LOCAL_MODELS: true }), {} as LocalEmbeddingService);
    await expect(service.transcribe(Buffer.from([1]), "audio/ogg")).rejects.toThrow(ServiceUnavailableException);
  });

  it("still uses the hosted client when local mode is off", () => {
    const service = new HuggingFaceService(config({ HF_TOKEN: "hf_test" }));
    expect((service as unknown as { client?: unknown }).client).toBeDefined();
  });
});

describe("LOCAL_MODELS env validation", () => {
  const base = {
    WHATSAPP_CLOUD_API_TOKEN: "t",
    WHATSAPP_PHONE_NUMBER_ID: "p",
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: "v",
    WHATSAPP_BUSINESS_ACCOUNT_ID: "b",
    WHATSAPP_APP_SECRET: "a",
    WHATSAPP_GRAPH_API_VERSION: "v21.0",
    MONGODB_ATLAS_URI: "mongodb://localhost:27017",
    CRON_SECRET: "cron-secret-0123456789",
    ADMIN_SECRET: "admin-secret-0123456789"
  };
  const check = (extra: Record<string, string>) => envValidationSchema.validate({ ...base, ...extra });

  it("defaults to off and then requires a token", () => {
    expect(check({ HF_TOKEN: "h" }).value.LOCAL_MODELS).toBe(false);
    expect(check({}).error?.message).toMatch(/HF_TOKEN/);
  });

  it("drops the token requirement when on, whether given as true or \"true\"", () => {
    expect(check({ LOCAL_MODELS: "true" }).error).toBeUndefined();
    expect(check({ LOCAL_MODELS: "true" }).value.LOCAL_MODELS).toBe(true);
  });
});

describe("VoiceTranscriptionService in local mode", () => {
  const build = (env: Record<string, unknown>) => {
    const client = { downloadMedia: jest.fn() };
    const huggingFace = { transcribe: jest.fn() };
    const service = new VoiceTranscriptionService(
      client as unknown as WhatsAppClient,
      huggingFace as unknown as HuggingFaceService,
      { get: (key: string, fallback: unknown) => (key in env ? env[key] : fallback) } as unknown as ConfigService
    );
    return { service, client };
  };
  const note = { id: "wamid.v", from: "1", timestamp: "1", type: "audio", audio: { id: "m1" } };

  it("stays off even when VOICE_TRANSCRIPTION is on, and says so", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
    const { service, client } = build({ VOICE_TRANSCRIPTION: true, LOCAL_MODELS: true });
    await expect(service.transcribe(note)).resolves.toBeNull();
    expect(client.downloadMedia).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
