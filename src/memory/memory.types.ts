import { Types } from "mongoose";
import { MemoryType } from "./schemas/memory.schema";

export interface SaveMemoryInput {
  whatsappNumber: string;
  messageId: string;
  type: MemoryType;
  context: string;
  essence: string;
  embedding: number[];
  receivedAt: Date;
}

export interface MemoryMatch {
  _id: Types.ObjectId;
  user_id: Types.ObjectId;
  message_id: string;
  type: MemoryType;
  context: string;
  essence: string;
  received_at: Date;
  score?: number;
}
