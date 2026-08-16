import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma, ProductMovementType, Unit } from "../generated/prisma/index.js";
import { ApiError } from "../lib/api-error.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import { parseBody, positiveDecimalString } from "../lib/validation.js";
import { recordProductMovement } from "../services/product-service.js";

const movementSchema = z.object({
  type: z.enum([
    ProductMovementType.WRITEOFF,
    ProductMovementType.REJECT,
    ProductMovementType.OTHER_SHIPMENT,
  ]),
  quantity: positiveDecimalString,
  unit: z.nativeEnum(Unit),
  reason: z.string().trim().min(3).max(1000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export async function registerProductRoutes(app: FastifyInstance): Promise<void> {
  app.get("/product-lots", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    return {
      items: await prisma.productLot.findMany({
        where: { workspaceId },
        include: {
          batch: { select: { id: true, number: true, completedAt: true } },
          movements: { orderBy: { occurredAt: "desc" }, take: 25 },
        },
        orderBy: { producedAt: "desc" },
        take: 500,
      }),
    };
  });

  app.get<{ Params: { id: string } }>("/product-lots/:id", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    const lot = await prisma.productLot.findFirst({
      where: { id: request.params.id, workspaceId },
      include: {
        batch: true,
        movements: { orderBy: { occurredAt: "desc" } },
        materialTrace: {
          include: {
            allocation: {
              include: { materialLot: { include: { material: true, supplier: true } } },
            },
          },
        },
      },
    });
    if (lot === null) throw new ApiError(404, "PRODUCT_LOT_NOT_FOUND", "Партия готовой продукции не найдена");
    return lot;
  });

  app.post<{ Params: { id: string } }>("/product-lots/:id/movements", async (request) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const parsed = parseBody(movementSchema, request.body);
    return recordProductMovement(
      workspaceId,
      actor.id,
      request.params.id,
      requireIdempotencyKey(request.headers),
      {
        ...parsed,
        metadata: parsed.metadata as Prisma.InputJsonValue | undefined,
      },
    );
  });
}

function requireIdempotencyKey(headers: Record<string, unknown>): string {
  const value = headers["idempotency-key"];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Добавьте заголовок Idempotency-Key");
  }
  return value;
}
