import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";

export type ReminderDocument = HydratedDocument<Reminder>;

@Schema({ collection: "reminders", versionKey: false, timestamps: { createdAt: "created_at", updatedAt: false } })
export class Reminder {
  @Prop({ type: Types.ObjectId, ref: "User", required: true, index: true })
  user_id!: Types.ObjectId;

  @Prop({ required: true })
  whatsapp_number!: string;

  @Prop({ required: true })
  message_id!: string;

  @Prop({ required: true })
  content!: string;

  @Prop({ required: true, index: true })
  due_at!: Date;

  @Prop({ default: false, index: true })
  sent!: boolean;

  @Prop({ type: Date, default: null })
  sent_at!: Date | null;
}

export const ReminderSchema = SchemaFactory.createForClass(Reminder);
ReminderSchema.index({ user_id: 1, message_id: 1 }, { unique: true });
// The cron sweep is exactly this shape: "everything due, not yet sent."
ReminderSchema.index({ sent: 1, due_at: 1 });
