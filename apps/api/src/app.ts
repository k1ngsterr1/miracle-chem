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
import { ApiError, ApiExceptionFilter } from "./lib/api-error.js";
import { AuthorizationGuard } from "./lib/authorization-guard.js";
import type { ApiRequest } from "./lib/http.js";
import { requireOneCSyncKey } from "./services/one-c-sync-service.js";

const maxOneCSnapshotBytes = 10 * 1024 * 1024;

export async function buildApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: config.nodeEnv === "test" ? false : ["log", "error", "warn"],
  });
  app.setGlobalPrefix("api", {
    exclude: [{ path: "health", method: RequestMethod.GET }],
  });
  // Reject unauthenticated or oversized uploads before buffering their JSON body.
  app.use("/api/integrations/1c/snapshot", rateLimit({
    limit: 30,
    windowMs: 60_000,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }));
  app.use("/api/integrations/1c/snapshot", (request: ApiRequest, response: Response, next: NextFunction) => {
    try {
      requireOneCSyncKey(request.headers["x-one-c-sync-key"]);
    } catch (error) {
      if (error instanceof ApiError) {
        response.status(error.statusCode).json({ error: { code: error.code, message: error.message, details: error.details } });
        return;
      }
      next(error);
      return;
    }
    const declaredLength = Number(request.headers["content-length"]);
    if (Number.isFinite(declaredLength) && declaredLength > maxOneCSnapshotBytes) {
      response.status(413).json({ error: { code: "ONE_C_SNAPSHOT_TOO_LARGE", message: "Снимок 1С превышает 10 МиБ" } });
      return;
    }
    next();
  });
  app.use("/api/integrations/1c/snapshot", json({ limit: "10mb" }));
  app.use(json({ limit: "1mb" }));
  app.enableCors({ origin: config.webOrigin, credentials: true });
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(rateLimit({ limit: config.rateLimitMax, windowMs: 60_000, standardHeaders: "draft-8", legacyHeaders: false }));
  app.use((request: ApiRequest, response: Response, next: NextFunction) => {
    request.requestId = typeof request.headers["x-request-id"] === "string"
      ? request.headers["x-request-id"]
      : randomUUID();
    response.setHeader("x-request-id", request.requestId);
    next();
  });
  app.useGlobalGuards(new AuthorizationGuard());
  app.useGlobalFilters(new ApiExceptionFilter());
  await app.init();
  return app;
}
