import { Module } from "@nestjs/common";
import { MessagingModule } from "../whatsapp/messaging.module";
import { AdminController } from "./admin.controller";

@Module({
  imports: [MessagingModule],
  controllers: [AdminController]
})
export class AdminModule {}
