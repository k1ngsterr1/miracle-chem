const nodeEnv = process.env.NODE_ENV ?? "development";
const authMode = process.env.AUTH_MODE ?? (nodeEnv === "production" ? "trusted-gateway" : "demo");
if (authMode !== "demo" && authMode !== "trusted-gateway") {
  throw new Error("AUTH_MODE must be either demo or trusted-gateway");
}

export const config = {
  port: Number(process.env.API_PORT ?? 4100),
  host: process.env.API_HOST ?? "0.0.0.0",
  webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
  nodeEnv,
  authMode,
  internalApiKey: process.env.INTERNAL_API_KEY ?? "",
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 600),
};

export const DEFAULT_WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
export const DEFAULT_ACTOR_ID = "11111111-1111-4111-8111-111111111112";
