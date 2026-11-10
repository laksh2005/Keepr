import { HuggingFaceService } from "../src/huggingface/huggingface.service";
import { IntentService } from "../src/intent/intent.service";
import { MemoryService } from "../src/memory/memory.service";
import { PreferencesService } from "../src/preferences/preferences.service";
import { RecallService } from "../src/recall/recall.service";
import { ReminderService } from "../src/reminder/reminder.service";
import { ContextExtractorService } from "../src/whatsapp/context-extractor.service";
import { InboundLogService } from "../src/whatsapp/inbound-log.service";
import { VoiceTranscriptionService } from "../src/whatsapp/voice-transcription.service";
import { WhatsAppClient } from "../src/whatsapp/whatsapp.client";
import { WhatsAppService } from "../src/whatsapp/whatsapp.service";
import { InboundMessage } from "../src/whatsapp/whatsapp.types";

const NO_VOICE = { transcribe: async () => null } as unknown as VoiceTranscriptionService;

const text = (body: string): InboundMessage => ({
  id: "wamid.1",
  from: "15550000001",
  timestamp: "1700000000",
  type: "text",
  text: { body }
});

function build(optedOut = false) {
  const prefs = {
    recordInbound: jest.fn().mockResolvedValue(undefined),
    setOptedOut: jest.fn().mockResolvedValue(undefined),
    isOptedOut: jest.fn().mockResolvedValue(optedOut)
  };
  const reminders = { cancelPendingFor: jest.fn().mockResolvedValue(2), create: jest.fn().mockResolvedValue({}) };
  const memories = {
    save: jest.fn().mockResolvedValue({}),
    consumePendingLeadIn: jest.fn().mockResolvedValue(null),
    setPendingReminderOffer: jest.fn().mockResolvedValue(undefined)
  };
  const huggingFace = {
    summarize: jest.fn().mockResolvedValue("essence"),
    embedDocument: jest.fn().mockResolvedValue([0.1])
  };
  const client = { sendText: jest.fn().mockResolvedValue(undefined) };
  const intent = { classify: jest.fn().mockResolvedValue("save") };
  const service = new WhatsAppService(
    intent as unknown as IntentService,
    new ContextExtractorService(),
    huggingFace as unknown as HuggingFaceService,
    memories as unknown as MemoryService,
    {} as RecallService,
    reminders as unknown as ReminderService,
    client as unknown as WhatsAppClient,
    {} as InboundLogService,
    NO_VOICE,
    prefs as unknown as PreferencesService
  );
  return { service, prefs, reminders, memories, huggingFace, client, intent };
}

describe("stop and start", () => {
  it.each(["stop", "STOP", "Stop.", "unsubscribe", "opt out", "stop reminders", "stop the digest"])(
    "%s turns reminders and the digest off and cancels queued reminders",
    async (body) => {
      const { service, prefs, reminders, client, memories } = build();
      await service.processMessage(text(body));
      expect(prefs.setOptedOut).toHaveBeenCalledWith("15550000001", true);
      expect(reminders.cancelPendingFor).toHaveBeenCalledWith("15550000001", expect.any(String));
      expect(client.sendText).toHaveBeenCalledWith("15550000001", expect.stringContaining("*start*"));
      expect(memories.save).not.toHaveBeenCalled();
    }
  );

  it.each(["start", "Start!", "resume", "opt in"])("%s turns them back on", async (body) => {
    const { service, prefs, client } = build();
    await service.processMessage(text(body));
    expect(prefs.setOptedOut).toHaveBeenCalledWith("15550000001", false);
    expect(client.sendText).toHaveBeenCalledWith("15550000001", expect.stringContaining("back on"));
  });

  it("still saves an ordinary note that merely contains the word", async () => {
    const { service, prefs, memories } = build();
    await service.processMessage(text("remember to stop by the pharmacy"));
    expect(prefs.setOptedOut).not.toHaveBeenCalled();
    expect(memories.save).toHaveBeenCalled();
  });

  it("records every inbound message so the 24-hour window is known", async () => {
    const { service, prefs } = build();
    await service.processMessage(text("buy milk"));
    expect(prefs.recordInbound).toHaveBeenCalledWith("15550000001");
  });

  it("will not set a reminder for someone who opted out, and says how to turn them on", async () => {
    const { service, reminders, client } = build(true);
    await service.processMessage(text("remind me to call mom tomorrow at 5pm"));
    expect(reminders.create).not.toHaveBeenCalled();
    expect(client.sendText).toHaveBeenCalledWith("15550000001", expect.stringContaining("*start*"));
  });

  it("does not offer a reminder after a save for someone who opted out", async () => {
    const { service, memories, client } = build(true);
    await service.processMessage(text("dentist moved to 4pm thursday"));
    expect(memories.save).toHaveBeenCalled();
    expect(memories.setPendingReminderOffer).not.toHaveBeenCalled();
    expect(client.sendText).toHaveBeenCalledWith("15550000001", expect.stringMatching(/^(Saved ✅|Stored 👍)$/));
  });
});

describe("card and ID numbers", () => {
  it("refuses to keep a card number and sends nothing to inference", async () => {
    const { service, memories, huggingFace, client } = build();
    await service.processMessage(text("my visa is 4111 1111 1111 1111"));
    expect(memories.save).not.toHaveBeenCalled();
    expect(huggingFace.summarize).not.toHaveBeenCalled();
    expect(huggingFace.embedDocument).not.toHaveBeenCalled();
    expect(client.sendText).toHaveBeenCalledWith("15550000001", expect.stringContaining("card number"));
  });

  it("does not echo the number back", async () => {
    const { service, client } = build();
    await service.processMessage(text("aadhaar 2345 6789 0124"));
    expect(JSON.stringify(client.sendText.mock.calls)).not.toContain("2345");
  });

  it("still saves a phone number and a price", async () => {
    const { service, memories } = build();
    await service.processMessage(text("plumber Sunil +91 98100 12345, charged ₹2,500"));
    expect(memories.save).toHaveBeenCalled();
  });

  it("says help mentions stop and the don't-save rule", async () => {
    const { service, client, intent } = build();
    intent.classify.mockResolvedValue("help");
    await service.processMessage(text("help"));
    const reply = String(client.sendText.mock.calls[0][1]);
    expect(reply).toContain("*stop*");
    expect(reply).toMatch(/card numbers/i);
  });
});
