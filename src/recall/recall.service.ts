import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { HuggingFaceService } from "../huggingface/huggingface.service";
import { MemoryService } from "../memory/memory.service";
import { MemoryMatch } from "../memory/memory.types";

@Injectable()
export class RecallService {
  private readonly topK: number;

  constructor(
    private readonly huggingFace: HuggingFaceService,
    private readonly memories: MemoryService,
    config: ConfigService
  ) {
    this.topK = config.get<number>("RECALL_TOP_K", 5);
  }

  async find(whatsappNumber: string, query: string): Promise<MemoryMatch[]> {
    const embedding = await this.huggingFace.embedQuery(query);
    return this.memories.searchForUser(whatsappNumber, embedding, this.topK);
  }
}
