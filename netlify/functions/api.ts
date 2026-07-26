import serverless from "serverless-http";
import { createApp } from "../../src/bootstrap";

let handlerPromise: Promise<ReturnType<typeof serverless>> | undefined;

async function getHandler(): Promise<ReturnType<typeof serverless>> {
  if (!handlerPromise) {
    handlerPromise = createApp().then(async (app) => {
      await app.init();
      return serverless(app.getHttpAdapter().getInstance());
    });
  }
  return handlerPromise;
}

export const handler = async (event: unknown, context: unknown) => {
  const wrapped = await getHandler();
  return wrapped(event, context);
};
