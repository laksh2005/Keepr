import { ConfigService } from "@nestjs/config";
import { Types } from "mongoose";
import { MemoryService } from "../src/memory/memory.service";

describe("MemoryService", () => {
  const config = { get: jest.fn((_key: string, fallback: unknown) => fallback) } as unknown as ConfigService;

  it("stores a memory under the resolved user and is idempotent per message", async () => {
    const userId = new Types.ObjectId();
    const users = {
      findOneAndUpdate: jest.fn().mockResolvedValue({ _id: userId })
    };
    const stored = { _id: new Types.ObjectId(), message_id: "wamid.1" };
    const memories = { findOneAndUpdate: jest.fn().mockResolvedValue(stored) };
    const service = new MemoryService(users as never, memories as never, {} as never, config);
    const input = {
      whatsappNumber: "15550000001",
      messageId: "wamid.1",
      type: "image" as const,
      context: "blue logo",
      essence: "Blue logo design",
      embedding: [0.1, 0.2],
      receivedAt: new Date("2026-01-01T00:00:00Z")
    };

    await expect(service.save(input)).resolves.toBe(stored);
    expect(memories.findOneAndUpdate).toHaveBeenCalledWith(
      { user_id: userId, message_id: "wamid.1" },
      { $setOnInsert: expect.objectContaining({ user_id: userId, context: "blue logo" }) },
      { upsert: true, new: true }
    );
  });

  it("cannot retrieve user B while searching as user A", async () => {
    const userA = new Types.ObjectId();
    const userB = new Types.ObjectId();
    const users = {
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: userA }) })
    };
    const aggregate = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
    const service = new MemoryService(users as never, { aggregate } as never, {} as never, config);

    await service.searchForUser("15550000001", [0.3, 0.4], 5);
    const pipeline = aggregate.mock.calls[0][0];
    expect(pipeline[0].$vectorSearch.filter).toEqual({ user_id: { $eq: userA } });
    expect(pipeline[1].$match).toEqual({ user_id: userA, deleted_at: null });
    expect(pipeline).not.toEqual(expect.arrayContaining([expect.objectContaining({ $match: { user_id: userB } })]));
  });

  it("drops matches below the relevance threshold instead of always returning topK", async () => {
    const users = {
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) })
    };
    const aggregate = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
    const service = new MemoryService(users as never, { aggregate } as never, {} as never, config);

    await service.searchForUser("15550000001", [0.3, 0.4], 5);
    const pipeline = aggregate.mock.calls[0][0];
    const scoreFilter = pipeline.find(
      (stage: Record<string, unknown>) =>
        stage.$match && typeof (stage.$match as { score?: unknown }).score === "object"
    );
    expect(scoreFilter.$match.score.$gte).toBeGreaterThan(0.5);
  });

  it("lists every registered user's WhatsApp number for the digest sweep", async () => {
    const users = {
      find: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({
            exec: jest.fn().mockResolvedValue([{ whatsapp_number: "15550000001" }, { whatsapp_number: "15550000002" }])
          })
        })
      })
    };
    const service = new MemoryService(users as never, {} as never, {} as never, config);

    await expect(service.listAllWhatsappNumbers()).resolves.toEqual(["15550000001", "15550000002"]);
    expect(users.find).toHaveBeenCalledWith({});
  });

  it("pages listing within the calling user's live memories", async () => {
    const userA = new Types.ObjectId();
    const users = {
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: userA }) })
    };
    const chain = {
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([{ essence: "x" }])
    };
    const find = jest.fn().mockReturnValue(chain);
    const countDocuments = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(23) });
    const service = new MemoryService(users as never, { find, countDocuments } as never, {} as never, config);

    await expect(service.pageForUser("15550000001", 3, 10)).resolves.toEqual({ items: [{ essence: "x" }], total: 23 });
    expect(find).toHaveBeenCalledWith({ user_id: userA, deleted_at: null });
    expect(countDocuments).toHaveBeenCalledWith({ user_id: userA, deleted_at: null });
    expect(chain.skip).toHaveBeenCalledWith(20);
    expect(chain.limit).toHaveBeenCalledWith(10);
  });

  it("scopes the recap window to the calling user and the given cutoff", async () => {
    const userA = new Types.ObjectId();
    const users = {
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: userA }) })
    };
    const find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({
          lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) })
        })
      })
    });
    const service = new MemoryService(users as never, { find } as never, {} as never, config);

    const since = new Date("2026-09-12T00:00:00Z");
    await service.listForUserSince("15550000001", since);
    expect(find).toHaveBeenCalledWith({ user_id: userA, received_at: { $gte: since }, deleted_at: null });
  });

  it("returns no recap results for a user that doesn't exist", async () => {
    const users = {
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) })
    };
    const service = new MemoryService(users as never, {} as never, {} as never, config);

    await expect(service.listForUserSince("15550000001", new Date())).resolves.toEqual([]);
  });

  it("soft-deletes only the calling user's live matches, never removing rows", async () => {
    const userA = new Types.ObjectId();
    const users = {
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: userA }) })
    };
    const deleteMany = jest.fn();
    const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const convState = { findOneAndUpdate: jest.fn().mockResolvedValue({}) };
    const service = new MemoryService(users as never, { deleteMany, updateMany } as never, convState as never, config);

    await expect(service.deleteByEssenceForUser("15550000001", "pizza")).resolves.toBe(1);
    expect(deleteMany).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledWith(
      { user_id: userA, essence: /pizza/i, deleted_at: null },
      { $set: { deleted_at: expect.any(Date), delete_batch: expect.any(String) } }
    );
    const batch = updateMany.mock.calls[0][1].$set.delete_batch;
    expect(convState.findOneAndUpdate).toHaveBeenCalledWith(
      { user_id: userA },
      expect.objectContaining({ last_delete_batch: batch }),
      expect.anything()
    );
  });

  describe("undo", () => {
    const build = (state: unknown) => {
      const convState = {
        findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(state) }),
        updateOne: jest.fn().mockResolvedValue({})
      };
      const updateMany = jest.fn().mockResolvedValue({ modifiedCount: 3 });
      const service = new MemoryService({} as never, { updateMany } as never, convState as never, config);
      return { service, convState, updateMany };
    };
    const userA = new Types.ObjectId();

    it("restores exactly the last delete batch for that user", async () => {
      const { service, updateMany, convState } = build({ user_id: userA, last_delete_batch: "b1", last_delete_at: new Date() });
      await expect(service.undoLastDelete("15550000001", 60_000)).resolves.toBe(3);
      expect(updateMany).toHaveBeenCalledWith(
        { user_id: userA, delete_batch: "b1" },
        { $set: { deleted_at: null, delete_batch: null } }
      );
      expect(convState.updateOne).toHaveBeenCalledWith(
        { whatsapp_number: "15550000001" },
        { last_delete_batch: null, last_delete_at: null }
      );
    });

    it("refuses an undo older than the window", async () => {
      const { service, updateMany } = build({ user_id: userA, last_delete_batch: "b1", last_delete_at: new Date(Date.now() - 120_000) });
      await expect(service.undoLastDelete("15550000001", 60_000)).resolves.toBe(0);
      expect(updateMany).not.toHaveBeenCalled();
    });

    it("has nothing to undo when no delete happened", async () => {
      const { service, updateMany } = build(null);
      await expect(service.undoLastDelete("15550000001", 60_000)).resolves.toBe(0);
      expect(updateMany).not.toHaveBeenCalled();
    });
  });

  it("deletes nothing for an unknown sender", async () => {
    const users = { findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) };
    const deleteMany = jest.fn();
    const service = new MemoryService(users as never, { deleteMany } as never, {} as never, config);

    await expect(service.deleteByEssenceForUser("15550009999", "pizza")).resolves.toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });

  describe("recall pagination", () => {
    // Exercises the real conversation-state round-trip: mocking getNextRecallResult
    // is what let "next" quietly repeat the first match for a whole release.
    const buildService = () => {
      let doc: Record<string, unknown> = {};
      const convState = {
        findOne: () => ({ lean: async () => doc }),
        findOneAndUpdate: async (_q: unknown, update: Record<string, unknown>) => {
          doc = { ...doc, ...update };
          return doc;
        },
        updateOne: async (_q: unknown, update: Record<string, unknown>) => {
          doc = { ...doc, ...update };
          return doc;
        }
      };
      const users = { findOne: () => ({ lean: async () => ({ _id: "u1" }) }) };
      const byId: Record<string, unknown> = {
        m0: { _id: "m0", essence: "first" },
        m1: { _id: "m1", essence: "second" }
      };
      const memories = {
        findOne: (q: { _id: string; deleted_at: null }) => ({
          select: () => ({ lean: () => ({ exec: async () => byId[q._id] ?? null }) })
        })
      };
      return new MemoryService(users as never, memories as never, convState as never, config);
    };

    it("resumes after the match recall already displayed", async () => {
      const service = buildService();
      await service.saveRecallResults("15550000001", [{ _id: "m0" }, { _id: "m1" }] as never, 1);

      const next = await service.getNextRecallResult("15550000001");
      expect((next as { essence: string }).essence).toBe("second");
    });

    it("reports exhaustion instead of looping back to the top", async () => {
      const service = buildService();
      await service.saveRecallResults("15550000001", [{ _id: "m0" }, { _id: "m1" }] as never, 1);

      await service.getNextRecallResult("15550000001");
      await expect(service.getNextRecallResult("15550000001")).resolves.toBeNull();
    });

    it("has nothing left to show when recall found only one match", async () => {
      const service = buildService();
      await service.saveRecallResults("15550000001", [{ _id: "m0" }] as never, 1);

      await expect(service.getNextRecallResult("15550000001")).resolves.toBeNull();
    });
  });

  describe("pending lead-in", () => {
    const buildConvState = (state: unknown) => ({
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(state) }),
      updateOne: jest.fn().mockResolvedValue({}),
      findOneAndUpdate: jest.fn().mockResolvedValue({})
    });

    it("returns a recently parked lead-in and clears it", async () => {
      const users = {
        findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) })
      };
      const convState = buildConvState({
        pending_lead_in: "remember this",
        pending_lead_in_at: new Date()
      });
      const service = new MemoryService(users as never, {} as never, convState as never, config);

      await expect(service.consumePendingLeadIn("15550000001", 60_000)).resolves.toBe(
        "remember this"
      );
      expect(convState.updateOne).toHaveBeenCalledWith(
        { whatsapp_number: "15550000001" },
        { pending_lead_in: null, pending_lead_in_at: null }
      );
    });

    it("ignores a lead-in older than the window", async () => {
      // Otherwise a "remember this" from yesterday would silently prefix an unrelated
      // message today.
      const users = {
        findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) })
      };
      const convState = buildConvState({
        pending_lead_in: "remember this",
        pending_lead_in_at: new Date(Date.now() - 10 * 60_000)
      });
      const service = new MemoryService(users as never, {} as never, convState as never, config);

      await expect(service.consumePendingLeadIn("15550000001", 60_000)).resolves.toBeNull();
    });

    it("clears a stale lead-in even though it does not use it", async () => {
      const users = {
        findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) })
      };
      const convState = buildConvState({
        pending_lead_in: "remember this",
        pending_lead_in_at: new Date(Date.now() - 10 * 60_000)
      });
      const service = new MemoryService(users as never, {} as never, convState as never, config);

      await service.consumePendingLeadIn("15550000001", 60_000);
      expect(convState.updateOne).toHaveBeenCalled();
    });

    it("returns null when nothing is parked", async () => {
      const users = {
        findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) })
      };
      const convState = buildConvState({ pending_lead_in: null });
      const service = new MemoryService(users as never, {} as never, convState as never, config);

      await expect(service.consumePendingLeadIn("15550000001", 60_000)).resolves.toBeNull();
      expect(convState.updateOne).not.toHaveBeenCalled();
    });
  });
});
