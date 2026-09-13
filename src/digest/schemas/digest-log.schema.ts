import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";

export type DigestLogDocument = HydratedDocument<DigestLog>;

@Schema({ collection: "digest_log", versionKey: false, timestamps: { createdAt: "created_at", updatedAt: false } })
export class DigestLog {
  @Prop({ type: Types.ObjectId, ref: "User", required: true, index: true })
  user_id!: Types.ObjectId;

  @Prop({ required: true })
  whatsapp_number!: string;

  // The IST calendar date the digest was for (see digestWeekKey) — one row per user
  // per week, so a poll that lands twice in the same 5pm hour never double-sends.
  @Prop({ required: true })
  week_key!: string;

  @Prop({ required: true })
  sent_at!: Date;
}

export const DigestLogSchema = SchemaFactory.createForClass(DigestLog);
DigestLogSchema.index({ user_id: 1, week_key: 1 }, { unique: true });
