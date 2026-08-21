import { timingSafeEqual } from "node:crypto";
import type { PrismaClient, User } from "../generated/prisma/index.js";
import { config, DEFAULT_ACTOR_ID, DEFAULT_WORKSPACE_ID } from "../config.js";
import { ApiError } from "./api-error.js";
import type { ApiRequest } from "./http.js";

export interface RequestContext {
  workspaceId: string;
  actor: User;
}

export async function getRequestContext(
  request: ApiRequest,
  client: PrismaClient,
): Promise<RequestContext> {
  const workspaceHeader = request.headers["x-workspace-id"];
  const actorHeader = request.headers["x-actor-id"];
  if (config.authMode === "trusted-gateway") {
    if (config.internalApiKey.length < 32) {
      throw new ApiError(503, "AUTH_NOT_CONFIGURED", "Серверный ключ доверенного шлюза не настроен");
    }
    const suppliedKey = request.headers["x-internal-api-key"];
    if (typeof suppliedKey !== "string" || !secureEqual(suppliedKey, config.internalApiKey)) {
      throw new ApiError(401, "INVALID_GATEWAY_CREDENTIALS", "Запрос не подтверждён доверенным шлюзом");
    }
    if (typeof workspaceHeader !== "string" || typeof actorHeader !== "string") {
      throw new ApiError(401, "IDENTITY_HEADERS_REQUIRED", "Доверенный шлюз должен передать workspace и actor");
    }
  }
  const workspaceId = typeof workspaceHeader === "string" ? workspaceHeader : DEFAULT_WORKSPACE_ID;
  const actorId = typeof actorHeader === "string" ? actorHeader : DEFAULT_ACTOR_ID;
  const actor = await client.user.findFirst({ where: { id: actorId, workspaceId, active: true } });
  if (actor === null) {
    throw new ApiError(401, "INVALID_ACTOR", "Пользователь не найден или отключён");
  }
  return { workspaceId, actor };
}

function secureEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
