import "reflect-metadata";
import { ConfigService } from "@nestjs/config";
import { createApp, logBootstrapError } from "./bootstrap";

async function bootstrap(): Promise<void> {
  const app = await createApp();
  const config = app.get(ConfigService);
  await app.listen(config.get<number>("PORT", 3000));
}

void bootstrap().catch(logBootstrapError);
