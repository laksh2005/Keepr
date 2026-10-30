import { ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createHmac } from "node:crypto";
import { WhatsAppController } from "../src/whatsapp/whatsapp.controller";
import { WhatsAppService } from "../src/whatsapp/whatsapp.service";

function makeController(env: Record<string, string | undefined>) {
  const config = {
    get: (key: string) => env[key],
    getOrThrow: (key: string) => {
      if (env[key] === undefined) throw new Error(`missing ${key}`);
      return env[key];
    }
  } as unknown as ConfigService;
  const service = { processWebhook: jest.fn().mockResolvedValue(undefined) };
  return { controller: new WhatsAppController(service as unknown as WhatsAppService, config), service };
}

const body = Buffer.from('{"object":"whatsapp_business_account"}');
const sign = (secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
const request = { rawBody: body, body: JSON.parse(body.toString()) } as never;

describe("WhatsAppController", () => {
  it("accepts a correctly signed webhook", async () => {
    const { controller, service } = makeController({ WHATSAPP_APP_SECRET: "app-secret" });
    await expect(controller.receive(request, sign("app-secret"))).resolves.toEqual({ received: true });
    expect(service.processWebhook).toHaveBeenCalled();
  });

  it("rejects a wrongly signed webhook", async () => {
    const { controller, service } = makeController({ WHATSAPP_APP_SECRET: "app-secret" });
    await expect(controller.receive(request, sign("other"))).rejects.toThrow(ForbiddenException);
    expect(service.processWebhook).not.toHaveBeenCalled();
  });

  it("rejects even outside production when no app secret is configured", async () => {
    const { controller, service } = makeController({ NODE_ENV: "development" });
    await expect(controller.receive(request, undefined)).rejects.toThrow(ForbiddenException);
    expect(service.processWebhook).not.toHaveBeenCalled();
  });

  it("echoes the challenge only for the right verify token", () => {
    const { controller } = makeController({ WHATSAPP_WEBHOOK_VERIFY_TOKEN: "verify-me" });
    expect(controller.verify("subscribe", "verify-me", "42")).toBe("42");
    expect(() => controller.verify("subscribe", "verify-mf", "42")).toThrow(ForbiddenException);
    expect(() => controller.verify("subscribe", undefined, "42")).toThrow(ForbiddenException);
  });
});
