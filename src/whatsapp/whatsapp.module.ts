import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { HuggingFaceModule } from "../huggingface/huggingface.module";
import { IntentModule } from "../intent/intent.module";
import { MemoryModule } from "../memory/memory.module";
import { RecallModule } from "../recall/recall.module";
import { ReminderModule } from "../reminder/reminder.module";
import { InboundLogService } from "./inbound-log.service";
import { ProcessedMessage, ProcessedMessageSchema } from "./schemas/processed-message.schema";
import { ContextExtractorService } from "./context-extractor.service";
import { MessagingModule } from "./messaging.module";
import { WhatsAppController } from "./whatsapp.controller";
import { WhatsAppService } from "./whatsapp.service";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: ProcessedMessage.name, schema: ProcessedMessageSchema }]),
    HuggingFaceModule, IntentModule, MemoryModule, RecallModule, ReminderModule, MessagingModule],
  controllers: [WhatsAppController],
  providers: [ContextExtractorService, InboundLogService, WhatsAppService]
})
export class WhatsAppModule {}
