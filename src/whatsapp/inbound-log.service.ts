import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { ProcessedMessage, ProcessedMessageDocument } from "./schemas/processed-message.schema";

@Injectable()
export class InboundLogService {
  constructor(
    @InjectModel(ProcessedMessage.name) private readonly processed: Model<ProcessedMessageDocument>
  ) {}

  /**
   * True when this call now owns the message: it was never seen, or its last attempt
   * failed (so Meta's retry should get another go). False for one already handled or
   * in flight. Atomic, so two concurrent deliveries can't both win.
   */
  async claim(messageId: string): Promise<boolean> {
    const fresh = await this.processed.updateOne(
      { message_id: messageId },
      { $setOnInsert: { message_id: messageId, status: "processing" } },
      { upsert: true }
    );
    if (fresh.upsertedCount > 0) return true;

    const retried = await this.processed.updateOne(
      { message_id: messageId, status: "failed" },
      { $set: { status: "processing" } }
    );
    return retried.modifiedCount > 0;
  }

  async markDone(messageId: string): Promise<void> {
    await this.processed.updateOne({ message_id: messageId }, { $set: { status: "done" } });
  }

  async markFailed(messageId: string): Promise<void> {
    await this.processed.updateOne({ message_id: messageId }, { $set: { status: "failed" } });
  }
}
