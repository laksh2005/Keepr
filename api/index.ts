import "reflect-metadata";
import type { Request, Response } from "express";
import { createApp } from "../src/bootstrap";

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
