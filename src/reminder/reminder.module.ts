import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { User, UserSchema } from "../memory/schemas/user.schema";
import { MessagingModule } from "../whatsapp/messaging.module";
import { ReminderController } from "./reminder.controller";
import { ReminderService } from "./reminder.service";
import { Reminder, ReminderSchema } from "./schemas/reminder.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Reminder.name, schema: ReminderSchema }
    ]),
    MessagingModule
  ],
  controllers: [ReminderController],
  providers: [ReminderService],
  exports: [ReminderService]
})
export class ReminderModule {}
