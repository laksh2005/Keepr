import "reflect-metadata";
import type { Request, Response } from "express";
import { createApp } from "../src/bootstrap";

// A cold boot plus three inference calls overruns the 10s default, which kills the
// invocation before the memory is written. Meta still gets its 200 immediately —
// this only bounds the background work the controller hands to waitUntil.
export const maxDuration = 60;

let handlerPromise: Promise<(req: Request, res: Response) => void> | undefined;

async function getHandler(): Promise<(req: Request, res: Response) => void> {
  if (!handlerPromise) {
    handlerPromise = createApp().then(async (app) => {
      await app.init();
      return app.getHttpAdapter().getInstance() as (req: Request, res: Response) => void;
    });
  }
  return handlerPromise;
}

export default async function handler(req: Request, res: Response): Promise<void> {
  const expressHandler = await getHandler();
  expressHandler(req, res);
}
