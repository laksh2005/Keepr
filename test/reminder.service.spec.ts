import { ConfigService } from "@nestjs/config";
import { Types } from "mongoose";
import { ReminderService } from "../src/reminder/reminder.service";

describe("ReminderService", () => {
  it("scopes creation and idempotency to the resolved user and message id", async () => {
    const userId = new Types.ObjectId();
    const users = { findOneAndUpdate: jest.fn().mockResolvedValue({ _id: userId }) };
    const created = { _id: new Types.ObjectId() };
    const reminders = { findOneAndUpdate: jest.fn().mockResolvedValue(created) };
    const service = new ReminderService(users as never, reminders as never);

    const dueAt = new Date("2026-09-15T11:30:00Z");
    await expect(
      service.create({
        whatsappNumber: "15550000001",
        messageId: "wamid.1",
        content: "call mom",
        dueAt
      })
    ).resolves.toBe(created);

    expect(reminders.findOneAndUpdate).toHaveBeenCalledWith(
      { user_id: userId, message_id: "wamid.1" },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          user_id: userId,
          whatsapp_number: "15550000001",
          content: "call mom",
          due_at: dueAt,
          sent: false
        })
      }),
      { upsert: true, new: true }
    );
  });

  it("a webhook retry does not create a second reminder for the same message", async () => {
    // $setOnInsert plus the upsert means the second call touches nothing — proven by
    // asserting the filter alone determines the match, same idempotency pattern
    // memories rely on for safe webhook retries.
    const users = { findOneAndUpdate: jest.fn().mockResolvedValue({ _id: "u1" }) };
    const reminders = { findOneAndUpdate: jest.fn().mockResolvedValue({ _id: "r1" }) };
    const service = new ReminderService(users as never, reminders as never);

    const input = { whatsappNumber: "15550000001", messageId: "wamid.1", content: "x", dueAt: new Date() };
    await service.create(input);
    await service.create(input);

    expect(reminders.findOneAndUpdate).toHaveBeenNthCalledWith(
      1,
      { user_id: "u1", message_id: "wamid.1" },
      expect.anything(),
      { upsert: true, new: true }
    );
    expect(reminders.findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      { user_id: "u1", message_id: "wamid.1" },
      expect.anything(),
      { upsert: true, new: true }
    );
  });

  it("finds only reminders that are due and unsent, due-soonest first", async () => {
    const users = {};
    const sort = jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(["r1"]) });
    const find = jest.fn().mockReturnValue({ sort });
    const reminders = { find };
    const service = new ReminderService(users as never, reminders as never);

    const now = new Date("2026-09-15T00:00:00Z");
    await expect(service.findDueUnsent(now)).resolves.toEqual(["r1"]);
    expect(find).toHaveBeenCalledWith({ sent: false, due_at: { $lte: now } });
    expect(sort).toHaveBeenCalledWith({ due_at: 1 });
  });

  it("marks a reminder sent with a timestamp", async () => {
    const updateOne = jest.fn().mockResolvedValue({});
    const reminders = { updateOne };
    const service = new ReminderService({} as never, reminders as never);

    const sentAt = new Date("2026-09-15T12:00:00Z");
    await service.markSent("r1", sentAt);
    expect(updateOne).toHaveBeenCalledWith({ _id: "r1" }, { sent: true, sent_at: sentAt });
  });
});
