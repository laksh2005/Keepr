import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectModel } from "@nestjs/mongoose";
import { Model, PipelineStage, Types } from "mongoose";
import { Memory, MemoryDocument } from "./schemas/memory.schema";
import { User, UserDocument } from "./schemas/user.schema";
import { MemoryMatch, SaveMemoryInput } from "./memory.types";

@Injectable()
export class MemoryService {
  private readonly vectorIndex: string;

  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Memory.name) private readonly memories: Model<MemoryDocument>,
    config: ConfigService
  ) {
    this.vectorIndex = config.get<string>("MONGODB_VECTOR_INDEX", "memory_vector_index");
  }

  async save(input: SaveMemoryInput): Promise<MemoryDocument> {
    const user = await this.users.findOneAndUpdate(
      { whatsapp_number: input.whatsappNumber },
      { $setOnInsert: { whatsapp_number: input.whatsappNumber, created_at: new Date() } },
      { upsert: true, new: true }
    );

    return this.memories.findOneAndUpdate(
      { user_id: user._id, message_id: input.messageId },
      {
        $setOnInsert: {
          user_id: user._id,
          message_id: input.messageId,
          type: input.type,
          context: input.context,
          essence: input.essence,
          embedding: input.embedding,
          received_at: input.receivedAt
        }
      },
      { upsert: true, new: true }
    );
  }

  async searchForUser(
    whatsappNumber: string,
    queryEmbedding: number[],
    limit: number
  ): Promise<MemoryMatch[]> {
    const user = await this.users.findOne({ whatsapp_number: whatsappNumber }).lean();
    if (!user) return [];

    const pipeline: PipelineStage[] = [
      {
        $vectorSearch: {
          index: this.vectorIndex,
          path: "embedding",
          queryVector: queryEmbedding,
          numCandidates: Math.max(limit * 20, 100),
          limit,
          filter: { user_id: { $eq: user._id } }
        }
      } as PipelineStage,
      { $match: { user_id: new Types.ObjectId(user._id) } },
      {
        $project: {
          embedding: 0,
          score: { $meta: "vectorSearchScore" }
        }
      }
    ];
    return this.memories.aggregate<MemoryMatch>(pipeline).exec();
  }
}
