import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";

export type ConversationStateDocument = ConversationState & Document;

@Schema({ collection: "conversation_states", timestamps: true })
export class ConversationState {
  @Prop({ required: true, index: true })
  user_id!: Types.ObjectId;

  @Prop({ required: true })
  whatsapp_number!: string;

  @Prop({ type: [{ type: Types.ObjectId, ref: "Memory" }], default: [] })
  last_recall_results!: Types.ObjectId[];

  @Prop({ default: 0 })
  current_recall_index!: number;

  @Prop({ default: new Date() })
  created_at!: Date;

  @Prop({ default: new Date() })
  updated_at!: Date;
}

export const ConversationStateSchema = SchemaFactory.createForClass(ConversationState);
