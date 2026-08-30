import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { ApiError } from "./api-error.js";
import type { ApiRequest } from "./http.js";

export const AUTH_COOKIE_NAME = "mc_session";

interface SessionClaims {
  userId: string;
  workspaceId: string;
  expiresAt: number;
}

export function createSessionToken(userId: string, workspaceId: string): string {
  assertSessionConfigured();
  const claims: SessionClaims = {
    userId,
    workspaceId,
    expiresAt: Math.floor(Date.now() / 1000) + Math.round(config.authSessionHours * 60 * 60),
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function readSessionClaims(request: ApiRequest): SessionClaims {
  const token = readSessionToken(request);
  if (token === null) throw new ApiError(401, "AUTH_REQUIRED", "Войдите в систему");
  return verifySessionToken(token);
}

export function readOptionalSessionClaims(request: ApiRequest): SessionClaims | null {
  const token = readSessionToken(request);
  return token === null ? null : verifySessionToken(token);
}

function verifySessionToken(token: string): SessionClaims {
  const [payload, suppliedSignature] = token.split(".");
  if (payload === undefined || suppliedSignature === undefined || !secureEqual(suppliedSignature, sign(payload))) {
    throw new ApiError(401, "INVALID_SESSION", "Сессия недействительна. Войдите повторно");
  }
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SessionClaims>;
    if (typeof value.userId !== "string" || typeof value.workspaceId !== "string" || typeof value.expiresAt !== "number") {
      throw new Error("Invalid session payload");
    }
    if (value.expiresAt <= Math.floor(Date.now() / 1000)) {
      throw new ApiError(401, "SESSION_EXPIRED", "Сессия истекла. Войдите повторно");
    }
    return value as SessionClaims;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, "INVALID_SESSION", "Сессия недействительна. Войдите повторно");
  }
}

export function sessionCookie(token: string): string {
  const maxAge = Math.round(config.authSessionHours * 60 * 60);
  return `${AUTH_COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${config.nodeEnv === "production" ? "; Secure" : ""}`;
}

export function clearedSessionCookie(): string {
  return `${AUTH_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${config.nodeEnv === "production" ? "; Secure" : ""}`;
}

function readSessionToken(request: ApiRequest): string | null {
  const authorization = request.headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim() || null;
  }
  const cookies = request.headers.cookie;
  if (typeof cookies !== "string") return null;
  for (const pair of cookies.split(";")) {
    const [name, ...parts] = pair.trim().split("=");
    if (name === AUTH_COOKIE_NAME) return parts.join("=") || null;
  }
  return null;
}

function sign(payload: string): string {
  assertSessionConfigured();
  return createHmac("sha256", config.authSessionSecret).update(payload).digest("base64url");
}

function assertSessionConfigured(): void {
  if (config.authSessionSecret.length < 32 || !Number.isFinite(config.authSessionHours) || config.authSessionHours <= 0) {
    throw new ApiError(503, "AUTH_NOT_CONFIGURED", "Сессионная авторизация не настроена");
  }
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
