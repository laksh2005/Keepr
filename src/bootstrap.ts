import { NestFactory } from "@nestjs/core";
import { INestApplication, Logger } from "@nestjs/common";
import { AppModule } from "./app.module";
import { configureApp } from "./http-config";

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: ["error", "warn", "log"]
  });
  configureApp(app);
  app.enableShutdownHooks();
  return app;
}

export function logBootstrapError(error: unknown): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  new Logger("Bootstrap").error(message);
}
