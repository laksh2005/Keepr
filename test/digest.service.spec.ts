import { Types } from "mongoose";
import { DigestService } from "../src/digest/digest.service";

describe("DigestService", () => {
  it("reports not-yet-sent when no log row exists for this week", async () => {
    const digestLog = { findOne: jest.fn().mockResolvedValue(null) };
    const service = new DigestService({} as never, digestLog as never);

    await expect(service.alreadySent("15550000001", new Date("2026-09-13T12:00:00Z"))).resolves.toBe(
      false
    );
    expect(digestLog.findOne).toHaveBeenCalledWith({
      whatsapp_number: "15550000001",
      week_key: "2026-09-13"
    });
  });

  it("reports already-sent when a log row exists for this week", async () => {
    const digestLog = { findOne: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }) };
    const service = new DigestService({} as never, digestLog as never);

    await expect(service.alreadySent("15550000001", new Date("2026-09-13T12:00:00Z"))).resolves.toBe(
      true
    );
  });

  it("records the send under the resolved user and this week's key", async () => {
    const userId = new Types.ObjectId();
    const users = { findOneAndUpdate: jest.fn().mockResolvedValue({ _id: userId }) };
    const digestLog = { findOneAndUpdate: jest.fn().mockResolvedValue({}) };
    const service = new DigestService(users as never, digestLog as never);

    await service.markSent("15550000001", new Date("2026-09-13T12:00:00Z"));

    expect(digestLog.findOneAndUpdate).toHaveBeenCalledWith(
      { user_id: userId, week_key: "2026-09-13" },
      {
        $setOnInsert: expect.objectContaining({
          user_id: userId,
          whatsapp_number: "15550000001",
          week_key: "2026-09-13"
        })
      },
      { upsert: true, new: true }
    );
  });
});
