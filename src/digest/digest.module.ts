import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { MemoryModule } from "../memory/memory.module";
import { User, UserSchema } from "../memory/schemas/user.schema";
import { MessagingModule } from "../whatsapp/messaging.module";
import { DigestController } from "./digest.controller";
import { DigestService } from "./digest.service";
import { DigestLog, DigestLogSchema } from "./schemas/digest-log.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: DigestLog.name, schema: DigestLogSchema }
    ]),
    MemoryModule,
    MessagingModule
  ],
  controllers: [DigestController],
  providers: [DigestService]
})
export class DigestModule {}
