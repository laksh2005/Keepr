import { Module } from "@nestjs/common";
import { HuggingFaceModule } from "../huggingface/huggingface.module";
import { IntentModule } from "../intent/intent.module";
import { MemoryModule } from "../memory/memory.module";
import { RecallModule } from "../recall/recall.module";
import { ContextExtractorService } from "./context-extractor.service";
import { WhatsAppClient } from "./whatsapp.client";
import { WhatsAppController } from "./whatsapp.controller";
import { WhatsAppService } from "./whatsapp.service";

@Module({
  imports: [HuggingFaceModule, IntentModule, MemoryModule, RecallModule],
  controllers: [WhatsAppController],
  providers: [ContextExtractorService, WhatsAppClient, WhatsAppService]
})
export class WhatsAppModule {}
