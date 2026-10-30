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

  // Set when someone opens with "remember this" and nothing else — the content is
  // still coming in the next message. Held here rather than saved as its own memory,
  // which is what used to happen and left a useless "remember this" row behind.
  @Prop({ type: String, default: null })
  pending_lead_in!: string | null;

  @Prop({ type: Date, default: null })
  pending_lead_in_at!: Date | null;

  // A delete that would remove more than one memory waits here for a yes. Deletion is
  // irreversible and the search term is a substring, so "delete a" can match nearly
  // everything.
  @Prop({ type: String, default: null })
  pending_delete_query!: string | null;

  @Prop({ type: Date, default: null })
  pending_delete_at!: Date | null;

  // The most recent delete, so "undo" can restore it for a short while afterwards.
  @Prop({ type: String, default: null })
  last_delete_batch!: string | null;

  @Prop({ type: Date, default: null })
  last_delete_at!: Date | null;

  // A function, not `new Date()`: that is evaluated once at boot, stamping every
  // row with the process start time.
  @Prop({ type: Date, default: Date.now })
  created_at!: Date;

  @Prop({ type: Date, default: Date.now })
  updated_at!: Date;
}

export const ConversationStateSchema = SchemaFactory.createForClass(ConversationState);
