import { ConfigService } from "@nestjs/config";
import { ForbiddenException } from "@nestjs/common";
import { ReminderController } from "../src/reminder/reminder.controller";
import { ReminderService } from "../src/reminder/reminder.service";
import { WhatsAppClient } from "../src/whatsapp/whatsapp.client";

const config = { getOrThrow: () => "the-real-secret" } as unknown as ConfigService;

describe("ReminderController", () => {
  it("rejects a missing secret", async () => {
    const reminders = { findDueUnsent: jest.fn() };
    const controller = new ReminderController(
      reminders as unknown as ReminderService,
      {} as WhatsAppClient,
      config
    );
    await expect(controller.run(undefined)).rejects.toThrow(ForbiddenException);
    expect(reminders.findDueUnsent).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret", async () => {
    const reminders = { findDueUnsent: jest.fn() };
    const controller = new ReminderController(
      reminders as unknown as ReminderService,
      {} as WhatsAppClient,
      config
    );
    await expect(controller.run("not-it")).rejects.toThrow(ForbiddenException);
  });

  it("rejects a secret of the wrong length before it ever reaches timingSafeEqual", async () => {
    // timingSafeEqual throws on mismatched buffer lengths rather than returning
    // false — this exercises that the length check runs first.
    const reminders = { findDueUnsent: jest.fn() };
    const controller = new ReminderController(
      reminders as unknown as ReminderService,
      {} as WhatsAppClient,
      config
    );
    await expect(controller.run("short")).rejects.toThrow(ForbiddenException);
  });

  it("sends every due reminder and marks it sent", async () => {
    const due = [
      { id: "r1", whatsapp_number: "15550000001", content: "call mom" },
      { id: "r2", whatsapp_number: "15550000002", content: "pay rent" }
    ];
    const reminders = {
      findDueUnsent: jest.fn().mockResolvedValue(due),
      markSent: jest.fn().mockResolvedValue(undefined)
    };
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const controller = new ReminderController(
      reminders as unknown as ReminderService,
      client as unknown as WhatsAppClient,
      config
    );

    const result = await controller.run("the-real-secret");

    expect(result).toEqual({ sent: 2, failed: 0 });
    expect(client.sendText).toHaveBeenCalledWith("15550000001", expect.stringContaining("call mom"));
    expect(client.sendText).toHaveBeenCalledWith("15550000002", expect.stringContaining("pay rent"));
    expect(reminders.markSent).toHaveBeenCalledWith("r1");
    expect(reminders.markSent).toHaveBeenCalledWith("r2");
  });

  it("keeps sending the rest of the batch after one send fails", async () => {
    // Same reasoning as the webhook loop: one bad number must not silently swallow
    // everyone else's reminder for that sweep.
    const due = [
      { id: "r1", whatsapp_number: "bad-number", content: "fails" },
      { id: "r2", whatsapp_number: "15550000002", content: "succeeds" }
    ];
    const reminders = {
      findDueUnsent: jest.fn().mockResolvedValue(due),
      markSent: jest.fn().mockResolvedValue(undefined)
    };
    const client = {
      sendText: jest
        .fn()
        .mockRejectedValueOnce(new Error("WhatsApp send failed"))
        .mockResolvedValueOnce(undefined)
    };
    const controller = new ReminderController(
      reminders as unknown as ReminderService,
      client as unknown as WhatsAppClient,
      config
    );

    const result = await controller.run("the-real-secret");

    expect(result).toEqual({ sent: 1, failed: 1 });
    expect(reminders.markSent).toHaveBeenCalledTimes(1);
    expect(reminders.markSent).toHaveBeenCalledWith("r2");
  });

  it("does not mark a reminder sent when the send failed", async () => {
    const due = [{ id: "r1", whatsapp_number: "bad-number", content: "fails" }];
    const reminders = {
      findDueUnsent: jest.fn().mockResolvedValue(due),
      markSent: jest.fn()
    };
    const client = { sendText: jest.fn().mockRejectedValue(new Error("boom")) };
    const controller = new ReminderController(
      reminders as unknown as ReminderService,
      client as unknown as WhatsAppClient,
      config
    );

    await controller.run("the-real-secret");
    expect(reminders.markSent).not.toHaveBeenCalled();
  });

  it("does nothing when no reminders are due", async () => {
    const reminders = { findDueUnsent: jest.fn().mockResolvedValue([]), markSent: jest.fn() };
    const client = { sendText: jest.fn() };
    const controller = new ReminderController(
      reminders as unknown as ReminderService,
      client as unknown as WhatsAppClient,
      config
    );

    await expect(controller.run("the-real-secret")).resolves.toEqual({ sent: 0, failed: 0 });
    expect(client.sendText).not.toHaveBeenCalled();
  });
});
