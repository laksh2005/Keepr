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
    expect(client.sendText).toHaveBeenCalledWith(message.from, "Consider it remembered.");
  });

  it("quotes the top match on recall and offers the rest behind next", async () => {
    const intent = { classify: jest.fn().mockResolvedValue("recall") };
    const recall = {
      find: jest.fn().mockResolvedValue([
        { message_id: "wamid.user-a-1", essence: "First design" },
        { message_id: "wamid.user-a-2", essence: "Second design" }
      ])
    };
    const memories = { saveRecallResults: jest.fn().mockResolvedValue({}) };
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const service = new WhatsAppService(
      intent as unknown as IntentService,
      new ContextExtractorService(),
      {} as HuggingFaceService,
      memories as unknown as MemoryService,
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
    expect(memories.saveRecallResults).toHaveBeenCalledWith(message.from, [
      { message_id: "wamid.user-a-1", essence: "First design" },
      { message_id: "wamid.user-a-2", essence: "Second design" }
    ]);
    expect(client.sendText).toHaveBeenNthCalledWith(2, message.from, "First design", "wamid.user-a-1");
    expect(client.sendText).toHaveBeenNthCalledWith(3, message.from, 'Type "next" to see more.');
    expect(client.sendText).toHaveBeenCalledTimes(3);
  });

  it("does not offer next when recall returns a single match", async () => {
    const intent = { classify: jest.fn().mockResolvedValue("recall") };
    const recall = {
      find: jest.fn().mockResolvedValue([{ message_id: "wamid.only", essence: "Only design" }])
    };
    const memories = { saveRecallResults: jest.fn().mockResolvedValue({}) };
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const service = new WhatsAppService(
      intent as unknown as IntentService,
      new ContextExtractorService(),
      {} as HuggingFaceService,
      memories as unknown as MemoryService,
      recall as unknown as RecallService,
      client as unknown as WhatsAppClient
    );

    await service.processMessage({ ...message, type: "text", text: { body: "designs" } });
    expect(client.sendText).toHaveBeenCalledTimes(2);
    expect(client.sendText).toHaveBeenNthCalledWith(2, message.from, "Only design", "wamid.only");
  });

  it("walks the stored recall results on next", async () => {
    const intent = { classify: jest.fn().mockResolvedValue("next") };
    const memories = {
      getNextRecallResult: jest
        .fn()
        .mockResolvedValue({ message_id: "wamid.user-a-2", essence: "Second design" })
    };
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const service = new WhatsAppService(
      intent as unknown as IntentService,
      new ContextExtractorService(),
      {} as HuggingFaceService,
      memories as unknown as MemoryService,
      {} as RecallService,
      client as unknown as WhatsAppClient
    );

    await service.processMessage({ ...message, type: "text", text: { body: "next" } });
    expect(memories.getNextRecallResult).toHaveBeenCalledWith(message.from);
    expect(client.sendText).toHaveBeenCalledWith(message.from, "Second design", "wamid.user-a-2");
  });

  it("reports exhaustion when next runs past the last match", async () => {
    const intent = { classify: jest.fn().mockResolvedValue("next") };
    const memories = { getNextRecallResult: jest.fn().mockResolvedValue(null) };
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const service = new WhatsAppService(
      intent as unknown as IntentService,
      new ContextExtractorService(),
      {} as HuggingFaceService,
      memories as unknown as MemoryService,
      {} as RecallService,
      client as unknown as WhatsAppClient
    );

    await service.processMessage({ ...message, type: "text", text: { body: "next" } });
    expect(client.sendText).toHaveBeenCalledWith(message.from, "No more results.");
  });

  it("lists saved memories", async () => {
    const intent = { classify: jest.fn().mockResolvedValue("list") };
    const memories = {
      listForUser: jest
        .fn()
        .mockResolvedValue([{ essence: "First design" }, { essence: "Second design" }])
    };
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const service = new WhatsAppService(
      intent as unknown as IntentService,
      new ContextExtractorService(),
      {} as HuggingFaceService,
      memories as unknown as MemoryService,
      {} as RecallService,
      client as unknown as WhatsAppClient
    );

    await service.processMessage({ ...message, type: "text", text: { body: "list" } });
    expect(memories.listForUser).toHaveBeenCalledWith(message.from);
    expect(client.sendText).toHaveBeenNthCalledWith(1, message.from, "You have 2 saved memories:");
    expect(client.sendText).toHaveBeenNthCalledWith(2, message.from, "• First design\n• Second design");
  });

  it("deletes memories matching the term after the delete keyword", async () => {
    const intent = { classify: jest.fn().mockResolvedValue("delete") };
    const memories = { deleteByEssenceForUser: jest.fn().mockResolvedValue(2) };
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const service = new WhatsAppService(
      intent as unknown as IntentService,
      new ContextExtractorService(),
      {} as HuggingFaceService,
      memories as unknown as MemoryService,
      {} as RecallService,
      client as unknown as WhatsAppClient
    );

    await service.processMessage({ ...message, type: "text", text: { body: "delete pizza" } });
    expect(memories.deleteByEssenceForUser).toHaveBeenCalledWith(message.from, "pizza");
    expect(client.sendText).toHaveBeenCalledWith(message.from, "Deleted 2 memories.");
  });

  it("asks for a search term when delete arrives bare", async () => {
    const intent = { classify: jest.fn().mockResolvedValue("delete") };
    const memories = { deleteByEssenceForUser: jest.fn() };
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const service = new WhatsAppService(
      intent as unknown as IntentService,
      new ContextExtractorService(),
      {} as HuggingFaceService,
      memories as unknown as MemoryService,
      {} as RecallService,
      client as unknown as WhatsAppClient
    );

    await service.processMessage({ ...message, type: "text", text: { body: "delete" } });
    expect(memories.deleteByEssenceForUser).not.toHaveBeenCalled();
    expect(client.sendText).toHaveBeenCalledWith(message.from, "Use: delete <search term>");
  });

  it("exports every memory with its timestamp", async () => {
    const intent = { classify: jest.fn().mockResolvedValue("export") };
    const memories = {
      listForUser: jest
        .fn()
        .mockResolvedValue([{ essence: "First design", received_at: new Date(0) }])
    };
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const service = new WhatsAppService(
      intent as unknown as IntentService,
      new ContextExtractorService(),
      {} as HuggingFaceService,
      memories as unknown as MemoryService,
      {} as RecallService,
      client as unknown as WhatsAppClient
    );

    await service.processMessage({ ...message, type: "text", text: { body: "export" } });
    expect(client.sendText).toHaveBeenCalledWith(
      message.from,
      "All 1 memories:\n\nFirst design\n(Saved: 1970-01-01T00:00:00.000Z)"
    );
  });

  it("saves non-text messages regardless of the classified intent", async () => {
    const intent = { classify: jest.fn().mockResolvedValue("list") };
    const huggingFace = {
      summarize: jest.fn().mockResolvedValue("Design reference"),
      embedDocument: jest.fn().mockResolvedValue([0.1, 0.2])
    };
    const memories = { save: jest.fn().mockResolvedValue({}), listForUser: jest.fn() };
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
    expect(memories.listForUser).not.toHaveBeenCalled();
    expect(memories.save).toHaveBeenCalled();
    expect(client.sendText).toHaveBeenCalledWith(message.from, "Consider it remembered.");
  });
});
