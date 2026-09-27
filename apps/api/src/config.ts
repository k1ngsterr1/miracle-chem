import "dotenv/config";
import { resolve } from "node:path";

const nodeEnv = process.env.NODE_ENV ?? "development";
const authMode = nodeEnv === "test" ? "demo" : (process.env.AUTH_MODE ?? "session");
if (authMode !== "demo" && authMode !== "session" && authMode !== "trusted-gateway") {
  throw new Error("AUTH_MODE must be demo, session or trusted-gateway");
}

const authSessionSecret = process.env.AUTH_SESSION_SECRET ?? "";
if (authMode === "session" && authSessionSecret.length < 32) {
  throw new Error("AUTH_SESSION_SECRET must contain at least 32 characters when AUTH_MODE=session");
}

export const config = {
  port: Number(process.env.API_PORT ?? 4100),
  host: process.env.API_HOST ?? "0.0.0.0",
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  nodeEnv,
  authMode,
  authSessionSecret,
  authSessionHours: Number(process.env.AUTH_SESSION_HOURS ?? 12),
  internalApiKey: process.env.INTERNAL_API_KEY ?? "",
  oneCSyncApiKey: process.env.ONE_C_SYNC_API_KEY ?? (nodeEnv === "test" ? "one-c-integration-test-key-must-be-long" : ""),
  oneCSyncWorkspaceId: process.env.ONE_C_SYNC_WORKSPACE_ID ?? "",
  oneCSyncSourceInstanceId: process.env.ONE_C_SYNC_SOURCE_INSTANCE_ID ?? "",
  oneCSyncOrganizationId: process.env.ONE_C_SYNC_ORGANIZATION_ID ?? "",
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 600),
  storageDir: resolve(process.env.UPLOAD_STORAGE_DIR ?? "./storage"),
};

export const DEFAULT_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
export const DEFAULT_ACTOR_ID = "11111111-1111-4111-8111-111111111112";
export const DEFAULT_PRODUCTION_LINE_ID = "22222222-2222-4222-8222-222222222221";
export const DEFAULT_PRODUCTION_TANK_ID = "22222222-2222-4222-8222-222222222222";
