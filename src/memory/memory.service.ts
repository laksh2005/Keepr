import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectModel } from "@nestjs/mongoose";
import { Model, PipelineStage, Types } from "mongoose";
import { Memory, MemoryDocument } from "./schemas/memory.schema";
import { User, UserDocument } from "./schemas/user.schema";
import { ConversationState, ConversationStateDocument } from "./schemas/conversation-state.schema";
import { MemoryMatch, SaveMemoryInput } from "./memory.types";

@Injectable()
export class MemoryService {
  private readonly vectorIndex: string;
  private readonly minScore: number;

  constructor(
    @InjectModel(User.name) private readonly users: Model<UserDocument>,
    @InjectModel(Memory.name) private readonly memories: Model<MemoryDocument>,
    @InjectModel(ConversationState.name) private readonly convState: Model<ConversationStateDocument>,
    config: ConfigService
  ) {
    this.vectorIndex = config.get<string>("MONGODB_VECTOR_INDEX", "memory_vector_index");
    // Atlas cosine vectorSearchScore is (1 + cosine similarity) / 2, so 0.5 is
    // orthogonal. Below ~0.7 a match is usually just the least-unrelated memory in a
    // small collection, not something actually about the query.
    this.minScore = config.get<number>("RECALL_MIN_SCORE", 0.7);
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
      },
      { $match: { score: { $gte: this.minScore } } }
    ];
    return this.memories.aggregate<MemoryMatch>(pipeline).exec();
  }

  async listForUser(whatsappNumber: string): Promise<MemoryMatch[]> {
    const user = await this.users.findOne({ whatsapp_number: whatsappNumber }).lean();
    if (!user) return [];
    return this.memories.find({ user_id: user._id }).select({ embedding: 0 }).lean().exec();
  }

  async deleteByIdForUser(whatsappNumber: string, memoryId: string): Promise<boolean> {
    const user = await this.users.findOne({ whatsapp_number: whatsappNumber }).lean();
    if (!user) return false;
    const result = await this.memories.deleteOne({ _id: memoryId, user_id: user._id });
    return result.deletedCount > 0;
  }

  async deleteByEssenceForUser(whatsappNumber: string, essenceQuery: string): Promise<number> {
    const user = await this.users.findOne({ whatsapp_number: whatsappNumber }).lean();
    if (!user) return 0;
    const regex = new RegExp(essenceQuery, "i");
    const result = await this.memories.deleteMany({ user_id: user._id, essence: regex });
    return result.deletedCount;
  }

  async saveRecallResults(
    whatsappNumber: string,
    results: MemoryMatch[]
  ): Promise<ConversationStateDocument> {
    const user = await this.users.findOne({ whatsapp_number: whatsappNumber }).lean();
    if (!user) throw new Error("User not found");

    const resultIds = results.map((r) => r._id);
    return this.convState.findOneAndUpdate(
      { user_id: user._id },
      {
        user_id: user._id,
        whatsapp_number: whatsappNumber,
        last_recall_results: resultIds,
        current_recall_index: 0,
        updated_at: new Date()
      },
      { upsert: true, new: true }
    );
  }

  async getNextRecallResult(whatsappNumber: string): Promise<MemoryMatch | null> {
    const state = await this.convState.findOne({ whatsapp_number: whatsappNumber }).lean();
    if (!state || !state.last_recall_results.length) return null;

    if (state.current_recall_index >= state.last_recall_results.length) return null;

    const resultId = state.last_recall_results[state.current_recall_index];
    await this.convState.updateOne({ whatsapp_number: whatsappNumber }, { current_recall_index: state.current_recall_index + 1 });

    return this.memories.findById(resultId).select({ embedding: 0 }).lean().exec();
  }
}
