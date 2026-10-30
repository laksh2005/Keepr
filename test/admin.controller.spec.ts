import { ConfigService } from "@nestjs/config";
import { BadRequestException, ExecutionContext, ForbiddenException, ValidationPipe } from "@nestjs/common";
import { AdminController, AdminSendDto } from "../src/admin/admin.controller";
import { AdminSecretGuard } from "../src/admin/admin-secret.guard";
import { WhatsAppClient } from "../src/whatsapp/whatsapp.client";

const config = { getOrThrow: () => "the-real-admin-secret" } as unknown as ConfigService;
const pipe = new ValidationPipe({ transform: true, whitelist: true });
const validate = (body: unknown) => pipe.transform(body, { type: "body", metatype: AdminSendDto });
const contextWith = (headers: Record<string, string>) =>
  ({ switchToHttp: () => ({ getRequest: () => ({ headers }) }) }) as unknown as ExecutionContext;

describe("AdminSecretGuard", () => {
  const guard = new AdminSecretGuard(config);

  it("rejects a missing secret", () => {
    expect(() => guard.canActivate(contextWith({}))).toThrow(ForbiddenException);
  });

  it("rejects a wrong secret", () => {
    expect(() => guard.canActivate(contextWith({ "x-admin-secret": "not-it" }))).toThrow(ForbiddenException);
  });

  it("admits the right secret", () => {
    expect(guard.canActivate(contextWith({ "x-admin-secret": "the-real-admin-secret" }))).toBe(true);
  });
});

describe("AdminController", () => {
  it("sends the given text to the given number", async () => {
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const controller = new AdminController(client as unknown as WhatsAppClient);

    await expect(controller.send({ to: "917042306233", message: "hi" })).resolves.toEqual({ ok: true });
    expect(client.sendText).toHaveBeenCalledWith("917042306233", "hi");
  });
});

describe("AdminSendDto", () => {
  it("rejects a missing to or message with 400", async () => {
    await expect(validate({ message: "hi" })).rejects.toThrow(BadRequestException);
    await expect(validate({ to: "917042306233" })).rejects.toThrow(BadRequestException);
  });

  it("rejects a malformed number", async () => {
    await expect(validate({ to: "+91 70423", message: "hi" })).rejects.toThrow(BadRequestException);
  });

  it("rejects an over-long message", async () => {
    await expect(validate({ to: "917042306233", message: "x".repeat(4097) })).rejects.toThrow(BadRequestException);
  });

  it("accepts a valid body", async () => {
    await expect(validate({ to: "917042306233", message: "hi" })).resolves.toMatchObject({ to: "917042306233" });
  });
});
