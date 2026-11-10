import { ConfigService } from "@nestjs/config";
import { DigestController } from "../src/digest/digest.controller";
import { DigestService } from "../src/digest/digest.service";
import { MemoryService } from "../src/memory/memory.service";
import { PreferencesService } from "../src/preferences/preferences.service";
import { ReminderController } from "../src/reminder/reminder.controller";
import { ReminderService } from "../src/reminder/reminder.service";
import { extractAnswer } from "../src/recall/answer-extractor";
import { WhatsAppClient } from "../src/whatsapp/whatsapp.client";

const stale = new Date(Date.now() - 30 * 60 * 60 * 1000);
const recent = new Date(Date.now() - 60 * 60 * 1000);

const cfg = (env: Record<string, string> = {}) =>
  ({ getOrThrow: () => "the-real-secret", get: (k: string) => env[k] }) as unknown as ConfigService;
const prefsFor = (state: { optedOut: boolean; lastInboundAt: Date | null }) =>
  ({ get: jest.fn().mockResolvedValue(state) }) as unknown as PreferencesService;
const newClient = () => ({ sendText: jest.fn().mockResolvedValue(undefined), sendTemplate: jest.fn().mockResolvedValue(undefined) });

describe("reminder sweep outside the 24-hour window", () => {
  const due = [{ id: "r1", whatsapp_number: "15550000001", content: "call mom" }];

  it("sends the template and marks the reminder sent", async () => {
    const reminders = { findDueUnsent: jest.fn().mockResolvedValue(due), markSent: jest.fn().mockResolvedValue(undefined) };
    const client = newClient();
    const controller = new ReminderController(
      reminders as unknown as ReminderService,
      client as unknown as WhatsAppClient,
      cfg({ REMINDER_TEMPLATE_NAME: "keepr_reminder" }),
      prefsFor({ optedOut: false, lastInboundAt: stale })
    );
    await expect(controller.run("the-real-secret")).resolves.toEqual({ sent: 1, failed: 0, gaveUp: 0, held: 0 });
    expect(client.sendTemplate).toHaveBeenCalledWith("15550000001", "keepr_reminder", "en", ["call mom"]);
    expect(client.sendText).not.toHaveBeenCalled();
    expect(reminders.markSent).toHaveBeenCalledWith("r1");
  });

  it("holds it, unsent and not failed, when no template is configured", async () => {
    const reminders = { findDueUnsent: jest.fn().mockResolvedValue(due), markSent: jest.fn(), recordFailure: jest.fn() };
    const client = newClient();
    const controller = new ReminderController(
      reminders as unknown as ReminderService,
      client as unknown as WhatsAppClient,
      cfg(),
      prefsFor({ optedOut: false, lastInboundAt: stale })
    );
    await expect(controller.run("the-real-secret")).resolves.toEqual({ sent: 0, failed: 0, gaveUp: 0, held: 1 });
    expect(client.sendText).not.toHaveBeenCalled();
    expect(client.sendTemplate).not.toHaveBeenCalled();
    expect(reminders.markSent).not.toHaveBeenCalled();
    expect(reminders.recordFailure).not.toHaveBeenCalled();
  });

  it("never sends to someone who opted out", async () => {
    const reminders = { findDueUnsent: jest.fn().mockResolvedValue(due), markSent: jest.fn() };
    const client = newClient();
    const controller = new ReminderController(
      reminders as unknown as ReminderService,
      client as unknown as WhatsAppClient,
      cfg({ REMINDER_TEMPLATE_NAME: "keepr_reminder" }),
      prefsFor({ optedOut: true, lastInboundAt: recent })
    );
    await expect(controller.run("the-real-secret")).resolves.toMatchObject({ sent: 0, held: 1 });
    expect(client.sendText).not.toHaveBeenCalled();
    expect(client.sendTemplate).not.toHaveBeenCalled();
  });
});

describe("digest sweep and the 24-hour window", () => {
  const week = [{ essence: "buy milk", received_at: new Date("2026-09-10T00:00:00Z") }];
  const build = (state: { optedOut: boolean; lastInboundAt: Date | null }, env: Record<string, string> = {}) => {
    const digest = { alreadySent: jest.fn().mockResolvedValue(false), markSent: jest.fn().mockResolvedValue(undefined) };
    const memories = {
      listAllWhatsappNumbers: jest.fn().mockResolvedValue(["15550000001"]),
      listForUserSince: jest.fn().mockResolvedValue(week)
    };
    const client = newClient();
    const controller = new DigestController(
      digest as unknown as DigestService,
      memories as unknown as MemoryService,
      client as unknown as WhatsAppClient,
      cfg(env),
      prefsFor(state)
    );
    return { controller, digest, client };
  };
  const run = (controller: DigestController) => controller.run("the-real-secret", "true", "15550000001");

  it("sends the full digest as text inside the window", async () => {
    const { controller, client } = build({ optedOut: false, lastInboundAt: recent });
    await expect(run(controller)).resolves.toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(client.sendText).toHaveBeenCalledTimes(2);
    expect(client.sendTemplate).not.toHaveBeenCalled();
  });

  it("sends only the template nudge, with the count, outside the window", async () => {
    const { controller, client } = build(
      { optedOut: false, lastInboundAt: stale },
      { DIGEST_TEMPLATE_NAME: "keepr_weekly_digest" }
    );
    await expect(run(controller)).resolves.toEqual({ sent: 1, skipped: 0, failed: 0 });
    expect(client.sendTemplate).toHaveBeenCalledWith("15550000001", "keepr_weekly_digest", "en", ["1"]);
    expect(client.sendText).not.toHaveBeenCalled();
  });

  it("skips, without marking the week as sent, when there is no template", async () => {
    const { controller, digest, client } = build({ optedOut: false, lastInboundAt: stale });
    await expect(run(controller)).resolves.toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(client.sendText).not.toHaveBeenCalled();
    expect(client.sendTemplate).not.toHaveBeenCalled();
    expect(digest.markSent).not.toHaveBeenCalled();
  });

  it("skips someone who opted out", async () => {
    const { controller, client } = build(
      { optedOut: true, lastInboundAt: recent },
      { DIGEST_TEMPLATE_NAME: "keepr_weekly_digest" }
    );
    await expect(run(controller)).resolves.toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(client.sendText).not.toHaveBeenCalled();
    expect(client.sendTemplate).not.toHaveBeenCalled();
  });
});

describe("secrets are not handed back as answers", () => {
  it("has no rule for passwords, PINs or codes", () => {
    expect(extractAnswer("what's the wifi password", "Office wifi password is sunflower42")).toBeNull();
    expect(extractAnswer("locker pin?", "gym locker pin: 4471")).toBeNull();
    expect(extractAnswer("what's the otp", "otp is 884213")).toBeNull();
  });
});

describe("PreferencesService", () => {
  const model = (doc: unknown) => ({
    findOne: () => ({ select: () => ({ lean: () => ({ exec: async () => doc }) }) }),
    updateOne: jest.fn().mockResolvedValue({})
  });

  it("reads opt-out and last inbound, defaulting to opted in and never heard from", async () => {
    const found = new PreferencesService(model({ notifications_opted_out: true, last_inbound_at: recent }) as never);
    await expect(found.get("1")).resolves.toEqual({ optedOut: true, lastInboundAt: recent });
    const none = new PreferencesService(model(null) as never);
    await expect(none.get("1")).resolves.toEqual({ optedOut: false, lastInboundAt: null });
  });

  it("only ever upserts", async () => {
    const m = model(null);
    const prefs = new PreferencesService(m as never);
    await prefs.setOptedOut("1", true);
    await prefs.recordInbound("1");
    for (const call of m.updateOne.mock.calls) expect(call[2]).toEqual({ upsert: true });
  });
});
