import { Module } from "@nestjs/common";
import { HuggingFaceModule } from "../huggingface/huggingface.module";
import { IntentModule } from "../intent/intent.module";
import { MemoryModule } from "../memory/memory.module";
import { RecallModule } from "../recall/recall.module";
import { ReminderModule } from "../reminder/reminder.module";
import { ContextExtractorService } from "./context-extractor.service";
import { MessagingModule } from "./messaging.module";
import { WhatsAppController } from "./whatsapp.controller";
import { WhatsAppService } from "./whatsapp.service";

@Module({
  imports: [HuggingFaceModule, IntentModule, MemoryModule, RecallModule, ReminderModule, MessagingModule],
  controllers: [WhatsAppController],
  providers: [ContextExtractorService, WhatsAppService]
})
export class WhatsAppModule {}
