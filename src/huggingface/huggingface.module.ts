import { Module } from "@nestjs/common";
import { HuggingFaceService } from "./huggingface.service";

@Module({
  providers: [HuggingFaceService],
  exports: [HuggingFaceService]
})
export class HuggingFaceModule {}
