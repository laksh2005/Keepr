import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { User, UserDocument } from "../memory/schemas/user.schema";

// WhatsApp lets a business send free-form text only for 24 hours after the user's last
// message. An hour of margin keeps a send from racing the edge of the window.
export const SERVICE_WINDOW_MS = 23 * 60 * 60 * 1000;

export interface UserPreferences {
  optedOut: boolean;
  lastInboundAt: Date | null;
}

/**
 * Per-number settings that gate what Keepr may send unprompted: whether the person
 * asked it to stop, and when they last wrote (which decides if free text is allowed).
 * Rows are only ever upserted, never removed.
 */
@Injectable()
export class PreferencesService {
  constructor(@InjectModel(User.name) private readonly users: Model<UserDocument>) {}

  async recordInbound(whatsappNumber: string, now: Date = new Date()): Promise<void> {
    await this.users.updateOne(
      { whatsapp_number: whatsappNumber },
      { $set: { last_inbound_at: now }, $setOnInsert: { whatsapp_number: whatsappNumber, created_at: now } },
      { upsert: true }
    );
  }

  async setOptedOut(whatsappNumber: string, optedOut: boolean, now: Date = new Date()): Promise<void> {
    await this.users.updateOne(
      { whatsapp_number: whatsappNumber },
      { $set: { notifications_opted_out: optedOut }, $setOnInsert: { whatsapp_number: whatsappNumber, created_at: now } },
      { upsert: true }
    );
  }

  async get(whatsappNumber: string): Promise<UserPreferences> {
    const user = await this.users
      .findOne({ whatsapp_number: whatsappNumber })
      .select({ notifications_opted_out: 1, last_inbound_at: 1 })
      .lean()
      .exec();
    return {
      optedOut: user?.notifications_opted_out === true,
      lastInboundAt: user?.last_inbound_at ?? null
    };
  }

  async isOptedOut(whatsappNumber: string): Promise<boolean> {
    return (await this.get(whatsappNumber)).optedOut;
  }
}

/** True while free-form text is allowed: the user wrote within the service window. */
export function inServiceWindow(lastInboundAt: Date | null, now: Date = new Date()): boolean {
  return lastInboundAt != null && now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_MS;
}
