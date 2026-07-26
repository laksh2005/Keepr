import { NestFactory } from "@nestjs/core";
import { INestApplication, Logger, ValidationPipe } from "@nestjs/common";
import { AppModule } from "./app.module";

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, {
    rawBody: true,
    logger: ["error", "warn", "log"]
  });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.enableShutdownHooks();
  return app;
}

export function logBootstrapError(error: unknown): void {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  new Logger("Bootstrap").error(message);
}
