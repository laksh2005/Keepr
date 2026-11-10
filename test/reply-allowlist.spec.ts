import { ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac } from "node:crypto";
import { ReplyAllowlist } from "../src/common/reply-allowlist";
import { envValidationSchema } from "../src/config/env.validation";
import { DigestController } from "../src/digest/digest.controller";
import { DigestService } from "../src/digest/digest.service";
import { MemoryService } from "../src/memory/memory.service";
import { ReminderController } from "../src/reminder/reminder.controller";
import { ReminderService } from "../src/reminder/reminder.service";
import { WhatsAppClient } from "../src/whatsapp/whatsapp.client";
import { WhatsAppController } from "../src/whatsapp/whatsapp.controller";
import { WhatsAppService } from "../src/whatsapp/whatsapp.service";

const ME = "917042306233";
const SOMEONE_ELSE = "15550000001";

const configWith = (env: Record<string, string | undefined>) =>
  ({
    get: (key: string) => env[key],
    getOrThrow: (key: string) => {
      if (env[key] === undefined) throw new Error(`missing ${key}`);
      return env[key];
    }
  }) as unknown as ConfigService;

describe("ReplyAllowlist", () => {
  it("allows everyone when unset or empty", () => {
    for (const raw of [undefined, "", " , "]) {
      const list = new ReplyAllowlist(raw);
      expect(list.restricted).toBe(false);
      expect(list.allows(SOMEONE_ELSE)).toBe(true);
    }
  });

  it("allows only the listed numbers, ignoring spaces", () => {
    const list = new ReplyAllowlist(` ${ME} , 15550000009 `);
    expect(list.restricted).toBe(true);
    expect(list.allows(ME)).toBe(true);
    expect(list.allows("15550000009")).toBe(true);
    expect(list.allows(SOMEONE_ELSE)).toBe(false);
    expect(list.allows(undefined)).toBe(false);
  });
});

describe("REPLY_ALLOWLIST env validation", () => {
  const base = {
    WHATSAPP_CLOUD_API_TOKEN: "t",
    WHATSAPP_PHONE_NUMBER_ID: "p",
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: "v",
    WHATSAPP_BUSINESS_ACCOUNT_ID: "b",
    WHATSAPP_APP_SECRET: "a",
    WHATSAPP_GRAPH_API_VERSION: "v21.0",
    HF_TOKEN: "h",
    MONGODB_ATLAS_URI: "mongodb://localhost:27017",
    CRON_SECRET: "cron-secret-0123456789",
    ADMIN_SECRET: "admin-secret-0123456789"
  };
  const check = (extra: Record<string, string>) => envValidationSchema.validate({ ...base, ...extra });

  it("defaults to no limit", () => expect(check({}).value.REPLY_ALLOWLIST).toBe(""));
  it("accepts one or several numbers", () => {
    expect(check({ REPLY_ALLOWLIST: ME }).error).toBeUndefined();
    expect(check({ REPLY_ALLOWLIST: `${ME},15550000001` }).error).toBeUndefined();
  });
  it("refuses a malformed list instead of quietly letting everyone through", () => {
    expect(check({ REPLY_ALLOWLIST: "+917042306233" }).error).toBeDefined();
    expect(check({ REPLY_ALLOWLIST: "everyone" }).error).toBeDefined();
  });
});

describe("WhatsAppClient.sendText with REPLY_ALLOWLIST", () => {
  const clientWith = (allowlist: string | undefined) =>
    new WhatsAppClient(
      configWith({
        WHATSAPP_CLOUD_API_TOKEN: "wa-token",
        WHATSAPP_PHONE_NUMBER_ID: "pn",
        WHATSAPP_GRAPH_API_VERSION: "v21.0",
        REPLY_ALLOWLIST: allowlist
      })
    );

  afterEach(() => jest.restoreAllMocks());

  it("refuses to send to anyone else, without making a request", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch");
    await expect(clientWith(ME).sendText(SOMEONE_ELSE, "hi")).rejects.toThrow(ForbiddenException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends to a listed number", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await clientWith(ME).sendText(ME, "hi");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sends to anyone when no list is set", async () => {
    const fetchMock = jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await clientWith(undefined).sendText(SOMEONE_ELSE, "hi");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("WhatsAppController with REPLY_ALLOWLIST", () => {
  const message = (from: string, id: string) => ({ id, from, timestamp: "1", type: "text", text: { body: "hi" } });
  const send = async (allowlist: string | undefined, payload: object) => {
    const env = { WHATSAPP_APP_SECRET: "secret", REPLY_ALLOWLIST: allowlist };
    const service = { processWebhook: jest.fn().mockResolvedValue(undefined) };
    const controller = new WhatsAppController(service as unknown as WhatsAppService, configWith(env));
    const raw = Buffer.from(JSON.stringify(payload));
    const signature = `sha256=${createHmac("sha256", "secret").update(raw).digest("hex")}`;
    await controller.receive({ rawBody: raw, body: payload } as never, signature);
    return service.processWebhook.mock.calls[0][0];
  };
  const payload = (messages: object[], statuses: object[] = []) => ({
    object: "whatsapp_business_account",
    entry: [{ changes: [{ field: "messages", value: { messaging_product: "whatsapp", messages, statuses } }] }]
  });

  it("hands only the listed number's messages to the service", async () => {
    const handed = await send(ME, payload([message(SOMEONE_ELSE, "wamid.other"), message(ME, "wamid.me")]));
    const ids = handed.entry[0].changes[0].value.messages.map((m: { id: string }) => m.id);
    expect(ids).toEqual(["wamid.me"]);
  });

  it("leaves delivery statuses alone", async () => {
    const status = { id: "wamid.s", status: "failed", recipient_id: SOMEONE_ELSE };
    const handed = await send(ME, payload([message(SOMEONE_ELSE, "wamid.other")], [status]));
    expect(handed.entry[0].changes[0].value.statuses).toEqual([status]);
    expect(handed.entry[0].changes[0].value.messages).toEqual([]);
  });

  it("passes everything through when no list is set", async () => {
    const original = payload([message(SOMEONE_ELSE, "wamid.other")]);
    expect(await send(undefined, original)).toBe(original);
  });
});

describe("sweeps with REPLY_ALLOWLIST", () => {
  it("holds reminders for other numbers: not sent, not marked sent, not a failure", async () => {
    const reminders = {
      findDueUnsent: jest.fn().mockResolvedValue([
        { id: "r-other", whatsapp_number: SOMEONE_ELSE, content: "not for you" },
        { id: "r-me", whatsapp_number: ME, content: "call mom" }
      ]),
      markSent: jest.fn().mockResolvedValue(undefined),
      recordFailure: jest.fn()
    };
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const controller = new ReminderController(
      reminders as unknown as ReminderService,
      client as unknown as WhatsAppClient,
      configWith({ CRON_SECRET: "the-real-secret", REPLY_ALLOWLIST: ME })
    );

    await expect(controller.run("the-real-secret")).resolves.toEqual({ sent: 1, failed: 0, gaveUp: 0, held: 0 });
    expect(client.sendText).toHaveBeenCalledTimes(1);
    expect(client.sendText).toHaveBeenCalledWith(ME, expect.stringContaining("call mom"));
    expect(reminders.markSent).toHaveBeenCalledWith("r-me");
    expect(reminders.recordFailure).not.toHaveBeenCalled();
  });

  describe("digest", () => {
    afterEach(() => jest.useRealTimers());

    const build = () => {
      // Sunday 2026-09-13 17:00 IST, inside the digest window.
      jest.useFakeTimers().setSystemTime(new Date("2026-09-13T11:30:00Z"));
      const digest = {
        alreadySent: jest.fn().mockResolvedValue(false),
        markSent: jest.fn().mockResolvedValue(undefined)
      };
      const memories = {
        listAllWhatsappNumbers: jest.fn().mockResolvedValue([SOMEONE_ELSE, ME]),
        listForUserSince: jest.fn().mockResolvedValue([{ essence: "x", received_at: new Date(0) }])
      };
      const client = { sendText: jest.fn().mockResolvedValue(undefined) };
      const controller = new DigestController(
        digest as unknown as DigestService,
        memories as unknown as MemoryService,
        client as unknown as WhatsAppClient,
        configWith({ CRON_SECRET: "the-real-secret", REPLY_ALLOWLIST: ME })
      );
      return { controller, digest, client };
    };

    it("sends the weekly digest only to the listed number", async () => {
      const { controller, digest, client } = build();
      await expect(controller.run("the-real-secret")).resolves.toEqual({ sent: 1, skipped: 0, failed: 0 });
      expect(digest.markSent).toHaveBeenCalledTimes(1);
      expect(digest.markSent).toHaveBeenCalledWith(ME);
      for (const call of client.sendText.mock.calls) expect(call[0]).toBe(ME);
    });

    it("sends nothing to a forced number outside the list", async () => {
      const { controller, client } = build();
      await expect(controller.run("the-real-secret", "true", SOMEONE_ELSE)).resolves.toEqual({
        sent: 0,
        skipped: 0,
        failed: 0
      });
      expect(client.sendText).not.toHaveBeenCalled();
    });
  });
});
