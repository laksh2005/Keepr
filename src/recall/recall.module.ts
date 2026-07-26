import { Module } from "@nestjs/common";
import { GeminiModule } from "../gemini/gemini.module";
import { MemoryModule } from "../memory/memory.module";
import { RecallService } from "./recall.service";

@Module({
  imports: [GeminiModule, MemoryModule],
  providers: [RecallService],
  exports: [RecallService]
})
export class RecallModule {}
