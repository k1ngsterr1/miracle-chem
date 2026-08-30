import type { Request } from "express";
import { ApiError } from "./api-error.js";
import type { RequestContext } from "./request-context.js";

export interface ApiRequest extends Request {
  requestId?: string;
  requestContext?: RequestContext;
}

export function requireIdempotencyKey(headers: ApiRequest["headers"]): string {
  const value = headers["idempotency-key"];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Добавьте заголовок Idempotency-Key");
  }
  return value;
}
