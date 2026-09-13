import { ConfigService } from "@nestjs/config";
import { ForbiddenException } from "@nestjs/common";
import { AdminController } from "../src/admin/admin.controller";
import { WhatsAppClient } from "../src/whatsapp/whatsapp.client";

const config = { getOrThrow: () => "the-real-secret" } as unknown as ConfigService;

describe("AdminController", () => {
  it("rejects a missing secret", async () => {
    const client = { sendText: jest.fn() };
    const controller = new AdminController(client as unknown as WhatsAppClient, config);
    await expect(controller.send(undefined, { to: "1", message: "hi" })).rejects.toThrow(ForbiddenException);
    expect(client.sendText).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret", async () => {
    const client = { sendText: jest.fn() };
    const controller = new AdminController(client as unknown as WhatsAppClient, config);
    await expect(controller.send("not-it", { to: "1", message: "hi" })).rejects.toThrow(ForbiddenException);
  });

  it("rejects a missing to or message", async () => {
    const client = { sendText: jest.fn() };
    const controller = new AdminController(client as unknown as WhatsAppClient, config);
    await expect(controller.send("the-real-secret", { message: "hi" })).rejects.toThrow(ForbiddenException);
    await expect(controller.send("the-real-secret", { to: "1" })).rejects.toThrow(ForbiddenException);
    expect(client.sendText).not.toHaveBeenCalled();
  });

  it("sends the given text to the given number", async () => {
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const controller = new AdminController(client as unknown as WhatsAppClient, config);

    await expect(controller.send("the-real-secret", { to: "917042306233", message: "hi" })).resolves.toEqual({
      ok: true
    });
    expect(client.sendText).toHaveBeenCalledWith("917042306233", "hi");
  });
});
