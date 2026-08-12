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
    expect(pipeline[1].$match).toEqual({ user_id: userA });
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

  it("scopes listing to the calling user", async () => {
    const userA = new Types.ObjectId();
    const users = {
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: userA }) })
    };
    const find = jest.fn().mockReturnValue({
      select: jest.fn().mockReturnValue({ lean: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }) })
    });
    const service = new MemoryService(users as never, { find } as never, {} as never, config);

    await service.listForUser("15550000001");
    expect(find).toHaveBeenCalledWith({ user_id: userA });
  });

  it("scopes deletion to the calling user", async () => {
    const userA = new Types.ObjectId();
    const users = {
      findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: userA }) })
    };
    const deleteMany = jest.fn().mockResolvedValue({ deletedCount: 1 });
    const service = new MemoryService(users as never, { deleteMany } as never, {} as never, config);

    await expect(service.deleteByEssenceForUser("15550000001", "pizza")).resolves.toBe(1);
    expect(deleteMany).toHaveBeenCalledWith({ user_id: userA, essence: /pizza/i });
  });

  it("deletes nothing for an unknown sender", async () => {
    const users = { findOne: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(null) }) };
    const deleteMany = jest.fn();
    const service = new MemoryService(users as never, { deleteMany } as never, {} as never, config);

    await expect(service.deleteByEssenceForUser("15550009999", "pizza")).resolves.toBe(0);
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
