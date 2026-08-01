import { Module } from "@nestjs/common";
import { HuggingFaceModule } from "../huggingface/huggingface.module";
import { MemoryModule } from "../memory/memory.module";
import { RecallService } from "./recall.service";

@Module({
  imports: [HuggingFaceModule, MemoryModule],
  providers: [RecallService],
  exports: [RecallService]
})
export class RecallModule {}
