import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Memory, MemorySchema } from "./schemas/memory.schema";
import { User, UserSchema } from "./schemas/user.schema";
import { ConversationState, ConversationStateSchema } from "./schemas/conversation-state.schema";
import { MemoryService } from "./memory.service";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Memory.name, schema: MemorySchema },
      { name: ConversationState.name, schema: ConversationStateSchema }
    ])
  ],
  providers: [MemoryService],
  exports: [MemoryService]
})
export class MemoryModule {}
