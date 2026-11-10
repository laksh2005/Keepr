import { ConfigService } from "@nestjs/config";
import { inServiceWindow, PreferencesService, SERVICE_WINDOW_MS } from "../src/preferences/preferences.service";
import { sendProactive } from "../src/whatsapp/proactive";
import { WhatsAppClient } from "../src/whatsapp/whatsapp.client";

const NOW = Date.now();
const recent = new Date(NOW - 60 * 60 * 1000);
const stale = new Date(NOW - 30 * 60 * 60 * 1000);

function setup(state: { optedOut: boolean; lastInboundAt: Date | null } | undefined, env: Record<string, string> = {}) {
  const client = { sendText: jest.fn().mockResolvedValue(undefined), sendTemplate: jest.fn().mockResolvedValue(undefined) };
  const prefs = state ? ({ get: jest.fn().mockResolvedValue(state) } as unknown as PreferencesService) : undefined;
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  const send = () =>
    sendProactive(client as unknown as WhatsAppClient, prefs, config, "15550000001", {
      text: "⏰ Reminder: call mom",
      templateConfigKey: "REMINDER_TEMPLATE_NAME",
      templateParams: ["call mom"]
    });
  return { client, send };
}

describe("inServiceWindow", () => {
  it("is open for a day after the last message and closed after", () => {
    expect(inServiceWindow(recent)).toBe(true);
    expect(inServiceWindow(stale)).toBe(false);
    expect(inServiceWindow(null)).toBe(false);
    expect(SERVICE_WINDOW_MS).toBeLessThan(24 * 60 * 60 * 1000);
  });
});

describe("sendProactive", () => {
  it("sends nothing to someone who opted out", async () => {
    const { client, send } = setup({ optedOut: true, lastInboundAt: recent }, { REMINDER_TEMPLATE_NAME: "keepr_reminder" });
    await expect(send()).resolves.toBe("opted-out");
    expect(client.sendText).not.toHaveBeenCalled();
    expect(client.sendTemplate).not.toHaveBeenCalled();
  });

  it("sends plain text inside the 24-hour window", async () => {
    const { client, send } = setup({ optedOut: false, lastInboundAt: recent });
    await expect(send()).resolves.toBe("sent");
    expect(client.sendText).toHaveBeenCalledWith("15550000001", "⏰ Reminder: call mom");
    expect(client.sendTemplate).not.toHaveBeenCalled();
  });

  it("uses the approved template once the window has closed", async () => {
    const { client, send } = setup(
      { optedOut: false, lastInboundAt: stale },
      { REMINDER_TEMPLATE_NAME: "keepr_reminder", TEMPLATE_LANGUAGE: "en" }
    );
    await expect(send()).resolves.toBe("sent");
    expect(client.sendTemplate).toHaveBeenCalledWith("15550000001", "keepr_reminder", "en", ["call mom"]);
    expect(client.sendText).not.toHaveBeenCalled();
  });

  it("holds the send, rather than breaking the rule, when no template is configured", async () => {
    const { client, send } = setup({ optedOut: false, lastInboundAt: stale });
    await expect(send()).resolves.toBe("no-template");
    expect(client.sendText).not.toHaveBeenCalled();
    expect(client.sendTemplate).not.toHaveBeenCalled();
  });

  it("treats someone Keepr has never heard from as outside the window", async () => {
    const { client, send } = setup({ optedOut: false, lastInboundAt: null });
    await expect(send()).resolves.toBe("no-template");
    expect(client.sendText).not.toHaveBeenCalled();
  });

  it("falls back to plain text when built without preferences", async () => {
    const { client, send } = setup(undefined);
    await expect(send()).resolves.toBe("sent");
    expect(client.sendText).toHaveBeenCalled();
  });
});
