import { Module } from "@nestjs/common";
import { HuggingFaceModule } from "../huggingface/huggingface.module";
import { IntentService } from "./intent.service";

@Module({
  imports: [HuggingFaceModule],
  providers: [IntentService],
  exports: [IntentService]
})
export class IntentModule {}
