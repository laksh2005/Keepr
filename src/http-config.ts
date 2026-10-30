import { INestApplication, ValidationPipe } from "@nestjs/common";

/** HTTP-level settings, shared with the HTTP tests so they exercise the real setup. */
export function configureApp(app: INestApplication): void {
  (app.getHttpAdapter().getInstance() as { disable(setting: string): void }).disable("x-powered-by");
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
}
