import { Module } from "@nestjs/common";
import { GeminiModule } from "../gemini/gemini.module";
import { IntentService } from "./intent.service";

@Module({
  imports: [GeminiModule],
  providers: [IntentService],
  exports: [IntentService]
})
export class IntentModule {}
