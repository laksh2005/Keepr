import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { expandAbbreviations } from "../common/text-expansion";
import { isWhenQuestion } from "../common/temporal";
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
    // Expanded the same way the stored text was, so "out of office" reaches a memory
    // written as "ooo" and vice versa.
    const embedding = await this.huggingFace.embedQuery(expandAbbreviations(query));
    const matches = await this.memories.searchForUser(whatsappNumber, embedding, this.topK);

    // A "when is X" question can only be answered by a memory that mentions a time, so
    // float those up. Only reorders — nothing is dropped, since the time reference may
    // well be in a memory the extractor did not recognise.
    if (isWhenQuestion(query)) {
      return [...matches].sort((a, b) => {
        const aDated = a.temporal_terms?.length ? 1 : 0;
        const bDated = b.temporal_terms?.length ? 1 : 0;
        if (aDated !== bDated) return bDated - aDated;
        return (b.score ?? 0) - (a.score ?? 0);
      });
    }

    return matches;
  }
}
