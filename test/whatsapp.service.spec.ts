import { HuggingFaceService } from "../src/huggingface/huggingface.service";
import { IntentService } from "../src/intent/intent.service";
import { MemoryService } from "../src/memory/memory.service";
import { RecallService } from "../src/recall/recall.service";
import { ContextExtractorService } from "../src/whatsapp/context-extractor.service";
import { WhatsAppClient } from "../src/whatsapp/whatsapp.client";
import { chunkEntries, WhatsAppService } from "../src/whatsapp/whatsapp.service";
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
    const memories = {
      save: jest.fn().mockResolvedValue({}),
      consumePendingLeadIn: jest.fn().mockResolvedValue(null)
    };
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
    expect(client.sendText).toHaveBeenCalledWith(message.from, expect.stringMatching(/^(Saved ✅|Stored 👍)$/));
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
    expect(client.sendText).toHaveBeenNthCalledWith(1, message.from, "2 found, closest first 👇");
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
    expect(client.sendText).toHaveBeenNthCalledWith(1, message.from, "1 found, closest first 👇");
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

  it("deletes a single match straight away", async () => {
    const intent = { classify: jest.fn().mockResolvedValue("delete") };
    const memories = {
      findByEssenceForUser: jest.fn().mockResolvedValue([{ essence: "pizza night" }]),
      deleteByEssenceForUser: jest.fn().mockResolvedValue(1)
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

    await service.processMessage({ ...message, type: "text", text: { body: "delete pizza" } });
    expect(memories.deleteByEssenceForUser).toHaveBeenCalledWith(message.from, "pizza");
    expect(client.sendText).toHaveBeenCalledWith(message.from, "Deleted 1 memory.");
  });

  it("asks before deleting when the term matches more than one memory", async () => {
    // The term is a substring, so "delete a" can sweep up nearly everything, and there
    // is no undo.
    const intent = { classify: jest.fn().mockResolvedValue("delete") };
    const memories = {
      findByEssenceForUser: jest
        .fn()
        .mockResolvedValue([{ essence: "pizza night" }, { essence: "pizza dough recipe" }]),
      deleteByEssenceForUser: jest.fn(),
      setPendingDelete: jest.fn().mockResolvedValue(undefined)
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

    await service.processMessage({ ...message, type: "text", text: { body: "delete pizza" } });

    expect(memories.deleteByEssenceForUser).not.toHaveBeenCalled();
    expect(memories.setPendingDelete).toHaveBeenCalledWith(message.from, "pizza");
    expect(client.sendText).toHaveBeenCalledWith(
      message.from,
      expect.stringContaining("That matches 2 memories")
    );
  });

  it("carries out the delete once it is confirmed", async () => {
    const intent = { classify: jest.fn() };
    const memories = {
      consumePendingDelete: jest.fn().mockResolvedValue("pizza"),
      deleteByEssenceForUser: jest.fn().mockResolvedValue(2)
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

    await service.processMessage({ ...message, type: "text", text: { body: "yes" } });

    expect(memories.deleteByEssenceForUser).toHaveBeenCalledWith(message.from, "pizza");
    expect(client.sendText).toHaveBeenCalledWith(message.from, "Deleted 2 memories.");
    expect(intent.classify).not.toHaveBeenCalled();
  });

  it("saves a bare yes normally when no delete is waiting on it", async () => {
    const intent = { classify: jest.fn().mockResolvedValue("save") };
    const huggingFace = {
      summarize: jest.fn().mockResolvedValue("Yes"),
      embedDocument: jest.fn().mockResolvedValue([0.1, 0.2])
    };
    const memories = {
      consumePendingDelete: jest.fn().mockResolvedValue(null),
      consumePendingLeadIn: jest.fn().mockResolvedValue(null),
      deleteByEssenceForUser: jest.fn(),
      save: jest.fn().mockResolvedValue({})
    };
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const service = new WhatsAppService(
      intent as unknown as IntentService,
      new ContextExtractorService(),
      huggingFace as unknown as HuggingFaceService,
      memories as unknown as MemoryService,
      {} as RecallService,
      client as unknown as WhatsAppClient
    );

    await service.processMessage({ ...message, type: "text", text: { body: "yes" } });

    expect(memories.deleteByEssenceForUser).not.toHaveBeenCalled();
    expect(memories.save).toHaveBeenCalled();
  });

  it("asks for a search term when delete arrives bare", async () => {
    const intent = { classify: jest.fn().mockResolvedValue("delete") };
    const memories = { deleteByEssenceForUser: jest.fn(), findByEssenceForUser: jest.fn() };
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
    expect(client.sendText).toHaveBeenNthCalledWith(1, message.from, "All 1 memories 👇");
    expect(client.sendText).toHaveBeenNthCalledWith(
      2,
      message.from,
      "First design\n(Saved: 1970-01-01T00:00:00.000Z)"
    );
  });

  it("splits a long export across messages instead of being rejected whole", async () => {
    // WhatsApp rejects a body over 4096 characters. Sixty memories measured 5,656, so
    // export used to fail outright and the sender got nothing back.
    const intent = { classify: jest.fn().mockResolvedValue("export") };
    const many = Array.from({ length: 60 }, () => ({
      essence: "Meeting with the design team about the new onboarding flow",
      received_at: new Date(0)
    }));
    const memories = { listForUser: jest.fn().mockResolvedValue(many) };
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

    const bodies = client.sendText.mock.calls.map((call) => call[1] as string);
    expect(bodies.length).toBeGreaterThan(2);
    for (const body of bodies) {
      expect(body.length).toBeLessThanOrEqual(4096);
    }
    // Every memory still makes it out.
    const joined = bodies.join("\n");
    expect(joined.match(/Meeting with the design team/g)).toHaveLength(60);
  });

  it("saves non-text messages regardless of the classified intent", async () => {
    const intent = { classify: jest.fn().mockResolvedValue("list") };
    const huggingFace = {
      summarize: jest.fn().mockResolvedValue("Design reference"),
      embedDocument: jest.fn().mockResolvedValue([0.1, 0.2])
    };
    const memories = {
      save: jest.fn().mockResolvedValue({}),
      listForUser: jest.fn(),
      consumePendingLeadIn: jest.fn().mockResolvedValue(null)
    };
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
    expect(client.sendText).toHaveBeenCalledWith(message.from, expect.stringMatching(/^(Saved ✅|Stored 👍)$/));
  });

  it("actually varies the save confirmation instead of always picking the same one", async () => {
    const intent = { classify: jest.fn().mockResolvedValue("save") };
    const huggingFace = {
      summarize: jest.fn().mockResolvedValue("Design reference"),
      embedDocument: jest.fn().mockResolvedValue([0.1, 0.2])
    };
    const memories = {
      save: jest.fn().mockResolvedValue({}),
      consumePendingLeadIn: jest.fn().mockResolvedValue(null)
    };
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const service = new WhatsAppService(
      intent as unknown as IntentService,
      new ContextExtractorService(),
      huggingFace as unknown as HuggingFaceService,
      memories as unknown as MemoryService,
      {} as RecallService,
      client as unknown as WhatsAppClient
    );

    for (let i = 0; i < 40; i++) {
      await service.processMessage({ ...message, id: `wamid.${i}` });
    }
    const replies = new Set(client.sendText.mock.calls.map((call) => call[1]));
    expect(replies).toEqual(new Set(["Saved ✅", "Stored 👍"]));
  });

  it.each(["remember this", "save this:", "note this", "Remember", "keep it"])(
    "parks %s instead of saving it as its own memory",
    async (body) => {
      const intent = { classify: jest.fn() };
      const memories = {
        setPendingLeadIn: jest.fn().mockResolvedValue(undefined),
        save: jest.fn()
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

      await service.processMessage({ ...message, type: "text", text: { body } });

      expect(memories.save).not.toHaveBeenCalled();
      expect(memories.setPendingLeadIn).toHaveBeenCalledWith(message.from, body);
      expect(client.sendText).toHaveBeenCalledWith(message.from, "Go ahead 👂");
      // Deterministic shape — no reason to spend an inference call classifying it.
      expect(intent.classify).not.toHaveBeenCalled();
    }
  );

  it("folds a parked lead-in into the message that follows it", async () => {
    const intent = { classify: jest.fn().mockResolvedValue("save") };
    const huggingFace = {
      summarize: jest.fn().mockResolvedValue("Design reference"),
      embedDocument: jest.fn().mockResolvedValue([0.1, 0.2])
    };
    const memories = {
      save: jest.fn().mockResolvedValue({}),
      consumePendingLeadIn: jest.fn().mockResolvedValue("remember this")
    };
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
      expect.objectContaining({ context: "remember this design reference" })
    );
  });

  it("saves normally when nothing is parked", async () => {
    const intent = { classify: jest.fn().mockResolvedValue("save") };
    const huggingFace = {
      summarize: jest.fn().mockResolvedValue("Design reference"),
      embedDocument: jest.fn().mockResolvedValue([0.1, 0.2])
    };
    const memories = {
      save: jest.fn().mockResolvedValue({}),
      consumePendingLeadIn: jest.fn().mockResolvedValue(null)
    };
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
      expect.objectContaining({ context: "design reference" })
    );
  });

  it("stores the time references found in a saved message", async () => {
    const intent = { classify: jest.fn().mockResolvedValue("save") };
    const huggingFace = {
      summarize: jest.fn().mockResolvedValue("Out of office Monday"),
      embedDocument: jest.fn().mockResolvedValue([0.1, 0.2])
    };
    const memories = {
      save: jest.fn().mockResolvedValue({}),
      consumePendingLeadIn: jest.fn().mockResolvedValue(null)
    };
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const service = new WhatsAppService(
      intent as unknown as IntentService,
      new ContextExtractorService(),
      huggingFace as unknown as HuggingFaceService,
      memories as unknown as MemoryService,
      {} as RecallService,
      client as unknown as WhatsAppClient
    );

    await service.processMessage({
      ...message,
      type: "text",
      text: { body: "i am ooo on monday" }
    });

    expect(memories.save).toHaveBeenCalledWith(
      expect.objectContaining({ temporalTerms: ["monday"] })
    );
  });

  it("embeds the expanded text so shorthand and long form find each other", async () => {
    const intent = { classify: jest.fn().mockResolvedValue("save") };
    const huggingFace = {
      // Deliberately does not already contain "out of office", so the assertion below
      // proves the expansion was appended rather than just echoing the summary.
      summarize: jest.fn().mockResolvedValue("Away on Monday"),
      embedDocument: jest.fn().mockResolvedValue([0.1, 0.2])
    };
    const memories = {
      save: jest.fn().mockResolvedValue({}),
      consumePendingLeadIn: jest.fn().mockResolvedValue(null)
    };
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const service = new WhatsAppService(
      intent as unknown as IntentService,
      new ContextExtractorService(),
      huggingFace as unknown as HuggingFaceService,
      memories as unknown as MemoryService,
      {} as RecallService,
      client as unknown as WhatsAppClient
    );

    await service.processMessage({
      ...message,
      type: "text",
      text: { body: "i am ooo on monday" }
    });

    expect(huggingFace.embedDocument).toHaveBeenCalledWith(
      expect.stringContaining("out of office")
    );
    // The stored text stays as written — only the embedding input is expanded.
    expect(memories.save).toHaveBeenCalledWith(
      expect.objectContaining({ context: "i am ooo on monday" })
    );
  });

  it("keeps processing a batch after one message fails", async () => {
    // A webhook can carry several messages. One failure used to abort the loop, and
    // since the controller still answers 200, Meta never retried the dropped ones.
    const intent = {
      classify: jest
        .fn()
        .mockRejectedValueOnce(new Error("inference blew up"))
        .mockResolvedValue("list")
    };
    const memories = { listForUser: jest.fn().mockResolvedValue([{ essence: "Second" }]) };
    const client = { sendText: jest.fn().mockResolvedValue(undefined) };
    const service = new WhatsAppService(
      intent as unknown as IntentService,
      new ContextExtractorService(),
      {} as HuggingFaceService,
      memories as unknown as MemoryService,
      {} as RecallService,
      client as unknown as WhatsAppClient
    );

    await service.processWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                messages: [
                  { ...message, id: "wamid.fails", type: "text", text: { body: "boom" } },
                  { ...message, id: "wamid.survives", type: "text", text: { body: "list" } }
                ]
              }
            }
          ]
        }
      ]
    } as never);

    expect(memories.listForUser).toHaveBeenCalledWith(message.from);
  });
});

describe("chunkEntries", () => {
  it("splits between entries rather than mid-entry", () => {
    const chunks = chunkEntries(["aaaa", "bbbb", "cccc"], 10);
    expect(chunks).toEqual(["aaaa\n\nbbbb", "cccc"]);
  });

  it("keeps every chunk within the limit", () => {
    const entries = Array.from({ length: 50 }, (_, i) => `entry number ${i}`);
    for (const chunk of chunkEntries(entries, 100)) {
      expect(chunk.length).toBeLessThanOrEqual(100);
    }
  });

  it("loses no entries", () => {
    const entries = Array.from({ length: 50 }, (_, i) => `entry-${i}`);
    const joined = chunkEntries(entries, 100).join("\n\n");
    for (const entry of entries) {
      expect(joined).toContain(entry);
    }
  });

  it("truncates a single entry that exceeds the limit on its own", () => {
    // Sending it whole would have WhatsApp reject the message and the sender see
    // nothing at all.
    const chunks = chunkEntries(["x".repeat(50)], 10);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].length).toBeLessThanOrEqual(10);
    expect(chunks[0].endsWith("…")).toBe(true);
  });

  it("returns nothing for no entries", () => {
    expect(chunkEntries([], 100)).toEqual([]);
  });
});
