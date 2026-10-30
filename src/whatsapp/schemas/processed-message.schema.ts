import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument } from "mongoose";

export type ProcessedMessageDocument = HydratedDocument<ProcessedMessage>;

export const processedMessageStatuses = ["processing", "done", "failed"] as const;
export type ProcessedMessageStatus = (typeof processedMessageStatuses)[number];

/**
 * One row per inbound WhatsApp message id. Meta retries a webhook it thinks failed;
 * saves were already idempotent, but every retry still re-ran inference and re-sent
 * the reply. Claiming the id first makes the whole message handle-once.
 */
@Schema({ collection: "processed_messages", versionKey: false, timestamps: { createdAt: "created_at", updatedAt: "updated_at" } })
export class ProcessedMessage {
  @Prop({ required: true, unique: true })
  message_id!: string;

  @Prop({ required: true, enum: processedMessageStatuses })
  status!: ProcessedMessageStatus;
}

export const ProcessedMessageSchema = SchemaFactory.createForClass(ProcessedMessage);
