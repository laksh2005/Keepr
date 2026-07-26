import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { HydratedDocument, Types } from "mongoose";

export type MemoryDocument = HydratedDocument<Memory>;
export const memoryTypes = ["text", "link", "voice", "image", "doc", "video", "forwarded"] as const;
export type MemoryType = (typeof memoryTypes)[number];

@Schema({ collection: "memories", versionKey: false })
export class Memory {
  @Prop({ type: Types.ObjectId, ref: "User", required: true, index: true })
  user_id!: Types.ObjectId;

  @Prop({ required: true })
  message_id!: string;

  @Prop({ required: true, enum: memoryTypes })
  type!: MemoryType;

  @Prop({ required: true })
  context!: string;

  @Prop({ required: true })
  essence!: string;

  @Prop({ required: true, type: [Number] })
  embedding!: number[];

  @Prop({ required: true })
  received_at!: Date;
}

export const MemorySchema = SchemaFactory.createForClass(Memory);
MemorySchema.index({ user_id: 1, message_id: 1 }, { unique: true });
