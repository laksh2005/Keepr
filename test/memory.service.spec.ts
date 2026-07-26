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
    const service = new MemoryService(users as never, memories as never, config);
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
    const service = new MemoryService(users as never, { aggregate } as never, config);

    await service.searchForUser("15550000001", [0.3, 0.4], 5);
    const pipeline = aggregate.mock.calls[0][0];
    expect(pipeline[0].$vectorSearch.filter).toEqual({ user_id: { $eq: userA } });
    expect(pipeline[1].$match).toEqual({ user_id: userA });
    expect(pipeline).not.toEqual(expect.arrayContaining([expect.objectContaining({ $match: { user_id: userB } })]));
  });
});
