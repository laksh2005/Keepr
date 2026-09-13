import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument } from "../memory/schemas/user.schema";
import { Reminder, ReminderDocument } from "./schemas/reminder.schema";

@Injectable()
export class ReminderService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Reminder.name) private readonly reminders: Model<ReminderDocument>
  ) {}

  async create(input: {
    whatsappNumber: string;
    messageId: string;
    content: string;
    dueAt: Date;
  }): Promise<ReminderDocument> {
    const user = await this.users.findOneAndUpdate(
      { whatsapp_number: input.whatsappNumber },
      { $setOnInsert: { whatsapp_number: input.whatsappNumber, created_at: new Date() } },
      { upsert: true, new: true }
    );

    // Idempotent the same way memories are: a webhook retry must not create a second
    // reminder for the same inbound message.
    return this.reminders.findOneAndUpdate(
      { user_id: user._id, message_id: input.messageId },
      {
        $setOnInsert: {
          user_id: user._id,
          whatsapp_number: input.whatsappNumber,
          message_id: input.messageId,
          content: input.content,
          due_at: input.dueAt,
          sent: false,
          sent_at: null
        }
      },
      { upsert: true, new: true }
    );
  }

  /** Reminders due now or earlier that have not gone out yet, oldest due first. */
  async findDueUnsent(now: Date = new Date()): Promise<ReminderDocument[]> {
    return this.reminders
      .find({ sent: false, due_at: { $lte: now } })
      .sort({ due_at: 1 })
      .exec();
  }

  async markSent(id: string, sentAt: Date = new Date()): Promise<void> {
    await this.reminders.updateOne({ _id: id }, { sent: true, sent_at: sentAt });
  }
}
