import { ConfigService } from "@nestjs/config";
import { ForbiddenException } from "@nestjs/common";
import { DigestController } from "../src/digest/digest.controller";
import { DigestService } from "../src/digest/digest.service";
import { MemoryService } from "../src/memory/memory.service";
import { WhatsAppClient } from "../src/whatsapp/whatsapp.client";

const config = { getOrThrow: () => "the-real-secret" } as unknown as ConfigService;

// Sunday 2026-09-13 17:00 IST == 2026-09-13T11:30:00Z — inside the digest window.
const IN_WINDOW = new Date("2026-09-13T11:30:00Z");
// Monday — outside it.
const OUT_OF_WINDOW = new Date("2026-09-14T11:30:00Z");

describe("DigestController", () => {
  afterEach(() => jest.useRealTimers());

  it("rejects a missing secret", async () => {
    const memories = { listAllWhatsappNumbers: jest.fn() };
    const controller = new DigestController(
      {} as unknown as DigestService,
      memories as unknown as MemoryService,
      {} as WhatsAppClient,
      config
    );
    await expect(controller.run(undefined)).rejects.toThrow(ForbiddenException);
    expect(memories.listAllWhatsappNumbers).not.toHaveBeenCalled();
  });

  it("rejects a wrong secret", async () => {
    const controller = new DigestController(
      {} as unknown as DigestService,
      {} as unknown as MemoryService,
      {} as WhatsAppClient,
      config
    );
    await expect(controller.run("not-it")).rejects.toThrow(ForbiddenException);
  });

  it("does nothing outside the Sunday 5pm IST window", async () => {
    jest.useFakeTimers().setSystemTime(OUT_OF_WINDOW);
    const memories = { listAllWhatsappNumbers: jest.fn() };
    const controller = new DigestController(
      {} as unknown as DigestService,
      memories as unknown as MemoryService,
      {} as WhatsAppClient,
      config
    );

    await expect(controller.run("the-real-secret")).resolves.toEqual({ sent: 0, skipped: 0, failed: 0 });
    expect(memories.listAllWhatsappNumbers).not.toHaveBeenCalled();
  });

  it("sends a digest to every user with memories this week and records it", async () => {
    jest.useFakeTimers().setSystemTime(IN_WINDOW);
    const digest = {
      alreadySent: jest.fn().mockResolvedValue(false),
      markSent: jest.fn().mockResolvedValue(undefined)
    };
    const memories = {
      listAllWhatsappNumbers: jest.fn().mockResolvedValue(["15550000001"]),
      listForUserSince: jest
        .fn()
        .mockResolvedValue([{ essence: "Called the dentist", received_at: new Date(0) }])
    };
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const controller = new DigestController(
      digest as unknown as DigestService,
      memories as unknown as MemoryService,
      client as unknown as WhatsAppClient,
      config
    );

    const result = await controller.run("the-real-secret");

    expect(result).toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(client.sendText).toHaveBeenCalledWith(
      "15550000001",
      expect.stringContaining("1 memories saved")
    );
    expect(client.sendText).toHaveBeenCalledWith(
      "15550000001",
      expect.stringContaining("Called the dentist")
    );
    expect(digest.markSent).toHaveBeenCalledWith("15550000001");
  });

  it("skips a user whose digest already went out this week, without re-sending", async () => {
    jest.useFakeTimers().setSystemTime(IN_WINDOW);
    const digest = { alreadySent: jest.fn().mockResolvedValue(true), markSent: jest.fn() };
    const memories = {
      listAllWhatsappNumbers: jest.fn().mockResolvedValue(["15550000001"]),
      listForUserSince: jest.fn()
    };
    const client = { sendText: jest.fn() };
    const controller = new DigestController(
      digest as unknown as DigestService,
      memories as unknown as MemoryService,
      client as unknown as WhatsAppClient,
      config
    );

    await expect(controller.run("the-real-secret")).resolves.toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(memories.listForUserSince).not.toHaveBeenCalled();
    expect(client.sendText).not.toHaveBeenCalled();
    expect(digest.markSent).not.toHaveBeenCalled();
  });

  it("skips a user with nothing saved this week, without marking or sending", async () => {
    jest.useFakeTimers().setSystemTime(IN_WINDOW);
    const digest = { alreadySent: jest.fn().mockResolvedValue(false), markSent: jest.fn() };
    const memories = {
      listAllWhatsappNumbers: jest.fn().mockResolvedValue(["15550000001"]),
      listForUserSince: jest.fn().mockResolvedValue([])
    };
    const client = { sendText: jest.fn() };
    const controller = new DigestController(
      digest as unknown as DigestService,
      memories as unknown as MemoryService,
      client as unknown as WhatsAppClient,
      config
    );

    await expect(controller.run("the-real-secret")).resolves.toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(client.sendText).not.toHaveBeenCalled();
    expect(digest.markSent).not.toHaveBeenCalled();
  });

  it("keeps sending the rest of the batch after one user's send fails, and does not mark them sent", async () => {
    jest.useFakeTimers().setSystemTime(IN_WINDOW);
    const digest = {
      alreadySent: jest.fn().mockResolvedValue(false),
      markSent: jest.fn().mockResolvedValue(undefined)
    };
    const memories = {
      listAllWhatsappNumbers: jest.fn().mockResolvedValue(["bad-number", "15550000002"]),
      listForUserSince: jest.fn().mockResolvedValue([{ essence: "x", received_at: new Date(0) }])
    };
    const client = {
      sendText: jest
        .fn()
        .mockRejectedValueOnce(new Error("WhatsApp send failed"))
        .mockResolvedValue(undefined)
    };
    const controller = new DigestController(
      digest as unknown as DigestService,
      memories as unknown as MemoryService,
      client as unknown as WhatsAppClient,
      config
    );

    const result = await controller.run("the-real-secret");

    expect(result).toEqual({ sent: 1, skipped: 0, failed: 1 });
    expect(digest.markSent).toHaveBeenCalledTimes(1);
    expect(digest.markSent).toHaveBeenCalledWith("15550000002");
  });
});
