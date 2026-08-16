import { createHash } from "node:crypto";
import type { Prisma } from "../generated/prisma/index.js";
import { ApiError } from "./api-error.js";

interface IdempotencyParams {
  workspaceId: string;
  scope: string;
  key: string;
  payload: unknown;
}

export async function runIdempotent<T extends Prisma.InputJsonValue>(
  tx: Prisma.TransactionClient,
  params: IdempotencyParams,
  operation: () => Promise<T>,
): Promise<T> {
  if (!params.key.trim()) {
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Для операции требуется Idempotency-Key");
  }
  const requestHash = createHash("sha256")
    .update(stableStringify(params.payload))
    .digest("hex");
  const existing = await tx.idempotencyRecord.findUnique({
    where: {
      workspaceId_scope_key: {
        workspaceId: params.workspaceId,
        scope: params.scope,
        key: params.key,
      },
    },
  });
  if (existing !== null) {
    if (existing.requestHash !== requestHash) {
      throw new ApiError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Этот Idempotency-Key уже использован с другими данными",
      );
    }
    return existing.response as T;
  }

  const result = await operation();
  await tx.idempotencyRecord.create({
    data: {
      workspaceId: params.workspaceId,
      scope: params.scope,
      key: params.key,
      requestHash,
      statusCode: 200,
      response: result,
    },
  });
  return result;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => `${JSON.stringify(key)}:${stableStringify(nested)}`)
    .join(",")}}`;
}

