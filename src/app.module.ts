import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { MongooseModule } from "@nestjs/mongoose";
import { envValidationSchema } from "./config/env.validation";
import { GeminiModule } from "./gemini/gemini.module";
import { IntentModule } from "./intent/intent.module";
import { MemoryModule } from "./memory/memory.module";
import { RecallModule } from "./recall/recall.module";
import { WhatsAppModule } from "./whatsapp/whatsapp.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema
    }),
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        uri: config.getOrThrow<string>("MONGODB_ATLAS_URI"),
        dbName: config.get<string>("MONGODB_DATABASE", "keepr"),
        autoIndex: config.get<string>("NODE_ENV") !== "production",
        serverSelectionTimeoutMS: 5000
      })
    }),
    GeminiModule,
    IntentModule,
    MemoryModule,
    RecallModule,
    WhatsAppModule
  ]
})
export class AppModule {}
