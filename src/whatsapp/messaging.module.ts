import { Module } from "@nestjs/common";
import { WhatsAppClient } from "./whatsapp.client";

/**
 * WhatsAppClient on its own, so WhatsAppModule and ReminderModule can both depend on
 * it without depending on each other. WhatsAppService needs ReminderService (to file
 * a reminder from a message), and ReminderController needs WhatsAppClient (to send
 * one when it comes due) — putting the client on WhatsAppModule itself would make
 * that a cycle.
 */
@Module({
  providers: [WhatsAppClient],
  exports: [WhatsAppClient]
})
export class MessagingModule {}
