import { INestApplication } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { getConnectionToken } from "@nestjs/mongoose";
import { Test } from "@nestjs/testing";
import { createHmac } from "node:crypto";
import { AdminController } from "../src/admin/admin.controller";
import { configureApp } from "../src/http-config";
import { DigestController } from "../src/digest/digest.controller";
import { DigestService } from "../src/digest/digest.service";
import { HealthController } from "../src/health/health.controller";
import { MemoryService } from "../src/memory/memory.service";
import { WhatsAppClient } from "../src/whatsapp/whatsapp.client";
import { WhatsAppController } from "../src/whatsapp/whatsapp.controller";
import { WhatsAppService } from "../src/whatsapp/whatsapp.service";

/**
 * Real HTTP requests against the real controllers, validation pipe and Express
 * settings. Everything behind them is mocked: no database, no WhatsApp sends.
 */
describe("HTTP surface", () => {
  const env: Record<string, string> = {
    CRON_SECRET: "cron-secret-0123456789",
    ADMIN_SECRET: "admin-secret-0123456789",
    WHATSAPP_APP_SECRET: "app-secret",
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-me"
  };
  const client = { sendText: jest.fn().mockResolvedValue(undefined) };
  const whatsapp = { processWebhook: jest.fn().mockResolvedValue(undefined) };
  const memories = { listAllWhatsappNumbers: jest.fn().mockResolvedValue([]) };
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AdminController, WhatsAppController, DigestController, HealthController],
      providers: [
        { provide: ConfigService, useValue: { get: (k: string) => env[k], getOrThrow: (k: string) => env[k] } },
        { provide: WhatsAppClient, useValue: client },
        { provide: WhatsAppService, useValue: whatsapp },
        { provide: DigestService, useValue: {} },
        { provide: MemoryService, useValue: memories },
        { provide: getConnectionToken(), useValue: { readyState: 1 } }
      ]
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true, logger: false });
    configureApp(app);
    await app.listen(0, "127.0.0.1");
    base = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  const post = (path: string, body: string, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, { method: "POST", body, headers: { "content-type": "application/json", ...headers } });

  it("hides X-Powered-By and reports only up/down on health", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.headers.get("x-powered-by")).toBeNull();
    expect(await res.json()).toEqual({ status: "ok", database: "connected" });
  });

  it("rejects admin/send with the cron secret", async () => {
    const res = await post("/admin/send", JSON.stringify({ to: "917042306233", message: "hi" }), {
      "x-admin-secret": env.CRON_SECRET
    });
    expect(res.status).toBe(403);
    expect(client.sendText).not.toHaveBeenCalled();
  });

  it("answers a malformed admin body with 400, not a send", async () => {
    const res = await post("/admin/send", JSON.stringify({ to: "+91 70423", message: "hi" }), {
      "x-admin-secret": env.ADMIN_SECRET
    });
    expect(res.status).toBe(400);
    expect(client.sendText).not.toHaveBeenCalled();
  });

  it("sends through admin/send with the admin secret and a valid body", async () => {
    const res = await post("/admin/send", JSON.stringify({ to: "917042306233", message: "hi", extra: "dropped" }), {
      "x-admin-secret": env.ADMIN_SECRET
    });
    expect(res.status).toBe(201);
    expect(client.sendText).toHaveBeenCalledWith("917042306233", "hi");
  });

  it("refuses an unsigned webhook", async () => {
    const res = await post("/webhook", '{"object":"whatsapp_business_account"}');
    expect(res.status).toBe(403);
    expect(whatsapp.processWebhook).not.toHaveBeenCalled();
  });

  it("accepts a webhook signed over the raw body", async () => {
    const body = '{"object":"whatsapp_business_account","entry":[]}';
    const signature = `sha256=${createHmac("sha256", env.WHATSAPP_APP_SECRET).update(body).digest("hex")}`;
    const res = await post("/webhook", body, { "x-hub-signature-256": signature });
    expect(res.status).toBe(200);
    expect(whatsapp.processWebhook).toHaveBeenCalled();
  });

  it("refuses a forced digest with no target number", async () => {
    const res = await fetch(`${base}/cron/digest?force=true`, { headers: { "x-cron-secret": env.CRON_SECRET } });
    expect(res.status).toBe(400);
    expect(memories.listAllWhatsappNumbers).not.toHaveBeenCalled();
    expect(client.sendText).not.toHaveBeenCalled();
  });
});
