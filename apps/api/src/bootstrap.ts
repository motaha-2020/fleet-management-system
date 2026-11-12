import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import cookieParser from "cookie-parser";
import { AppModule } from "./app.module.js";
import type { AppConfig } from "./config.js";
import type { JobQueue } from "./infra/infra.module.js";
import type { ObjectStorage } from "./files/storage.js";

export async function createApp(config: AppConfig, overrides: { queue?: JobQueue; storage?: ObjectStorage; logger?: false } = {}) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config, overrides), {
    logger: overrides.logger === false ? false : ["error", "warn", "log"],
  });
  app.disable("x-powered-by");
  app.use(cookieParser());
  app.enableCors({ origin: config.corsOrigins, credentials: true });
  app.enableShutdownHooks();
  return app;
}
