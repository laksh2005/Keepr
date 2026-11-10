import { Module } from "@nestjs/common";
import { HuggingFaceService } from "./huggingface.service";
import { LocalEmbeddingService } from "./local-embedding.service";

@Module({
  providers: [HuggingFaceService, LocalEmbeddingService],
  exports: [HuggingFaceService]
})
export class HuggingFaceModule {}
