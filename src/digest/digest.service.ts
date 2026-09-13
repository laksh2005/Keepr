import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { digestWeekKey } from "../common/digest-window";
import { User, UserDocument } from "../memory/schemas/user.schema";
import { DigestLog, DigestLogDocument } from "./schemas/digest-log.schema";

@Injectable()
export class DigestService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(DigestLog.name) private readonly digestLog: Model<DigestLogDocument>
  ) {}

  /** True when this user's digest for the current IST week has already gone out. */
  async alreadySent(whatsappNumber: string, now: Date = new Date()): Promise<boolean> {
    const existing = await this.digestLog.findOne({
      whatsapp_number: whatsappNumber,
      week_key: digestWeekKey(now)
    });
    return existing != null;
  }

  /**
   * Idempotent the same way reminders are: a poll that lands twice in the same 5pm
   * hour must not record — and therefore send — the same user's digest twice.
   */
  async markSent(whatsappNumber: string, now: Date = new Date()): Promise<void> {
    const user = await this.users.findOneAndUpdate(
      { whatsapp_number: whatsappNumber },
      { $setOnInsert: { whatsapp_number: whatsappNumber, created_at: new Date() } },
      { upsert: true, new: true }
    );

    await this.digestLog.findOneAndUpdate(
      { user_id: user._id, week_key: digestWeekKey(now) },
      {
        $setOnInsert: {
          user_id: user._id,
          whatsapp_number: whatsappNumber,
          week_key: digestWeekKey(now),
          sent_at: now
        }
      },
      { upsert: true, new: true }
    );
  }
}
