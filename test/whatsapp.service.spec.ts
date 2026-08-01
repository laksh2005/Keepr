import { HuggingFaceService } from "../src/huggingface/huggingface.service";
import { IntentService } from "../src/intent/intent.service";
import { MemoryService } from "../src/memory/memory.service";
import { RecallService } from "../src/recall/recall.service";
import { ContextExtractorService } from "../src/whatsapp/context-extractor.service";
import { WhatsAppClient } from "../src/whatsapp/whatsapp.client";
import { WhatsAppService } from "../src/whatsapp/whatsapp.service";
import { InboundMessage } from "../src/whatsapp/whatsapp.types";

describe("WhatsAppService", () => {
  const message: InboundMessage = {
    id: "wamid.original",
    from: "15550000001",
    timestamp: "1700000000",
    type: "image",
    image: { id: "must-not-be-stored", caption: "design reference" }
  };

  it("persists only context and acknowledges a saved message", async () => {
    const intent = { classify: jest.fn().mockResolvedValue("save") };
    const huggingFace = {
      summarize: jest.fn().mockResolvedValue("Design reference"),
      embedDocument: jest.fn().mockResolvedValue([0.1, 0.2])
    };
    const memories = { save: jest.fn().mockResolvedValue({}) };
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const service = new WhatsAppService(
      intent as unknown as IntentService,
      new ContextExtractorService(),
      huggingFace as unknown as HuggingFaceService,
      memories as unknown as MemoryService,
      {} as RecallService,
      client as unknown as WhatsAppClient
    );

    await service.processMessage(message);
    expect(memories.save).toHaveBeenCalledWith(
      expect.objectContaining({
        whatsappNumber: message.from,
        messageId: message.id,
        type: "image",
        context: "design reference"
      })
    );
    expect(JSON.stringify(memories.save.mock.calls)).not.toContain("must-not-be-stored");
    expect(client.sendText).toHaveBeenCalledWith(message.from, "Saved ✓");
  });

  it("quotes each matching original message on recall", async () => {
    const intent = { classify: jest.fn().mockResolvedValue("recall") };
    const recall = {
      find: jest.fn().mockResolvedValue([
        { message_id: "wamid.user-a-1", essence: "First design" },
        { message_id: "wamid.user-a-2", essence: "Second design" }
      ])
    };
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const service = new WhatsAppService(
      intent as unknown as IntentService,
      new ContextExtractorService(),
      {} as HuggingFaceService,
      {} as MemoryService,
      recall as unknown as RecallService,
      client as unknown as WhatsAppClient
    );
    const query: InboundMessage = {
      ...message,
      type: "text",
      text: { body: "find my designs" }
    };

    await service.processMessage(query);
    expect(recall.find).toHaveBeenCalledWith(message.from, "find my designs");
    expect(client.sendText).toHaveBeenNthCalledWith(2, message.from, "First design", "wamid.user-a-1");
    expect(client.sendText).toHaveBeenNthCalledWith(3, message.from, "Second design", "wamid.user-a-2");
  });
});
