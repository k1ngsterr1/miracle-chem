import "reflect-metadata";
import { randomUUID } from "node:crypto";
import { RequestMethod } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { json, type NextFunction, type Response } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { AppModule } from "./app.module.js";
import { config } from "./config.js";
import { ApiExceptionFilter } from "./lib/api-error.js";
import type { ApiRequest } from "./lib/http.js";

export async function buildApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: config.nodeEnv === "test" ? false : ["log", "error", "warn"],
  });
  app.setGlobalPrefix("api", {
    exclude: [{ path: "health", method: RequestMethod.GET }],
  });
  app.use(json({ limit: "1mb" }));
  app.enableCors({ origin: config.webOrigin, credentials: false });
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(rateLimit({ limit: config.rateLimitMax, windowMs: 60_000, standardHeaders: "draft-8", legacyHeaders: false }));
  app.use((request: ApiRequest, response: Response, next: NextFunction) => {
    request.requestId = typeof request.headers["x-request-id"] === "string"
      ? request.headers["x-request-id"]
      : randomUUID();
    response.setHeader("x-request-id", request.requestId);
    next();
  });
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  return app;
}
