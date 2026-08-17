import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { MaterialType, Prisma, Unit } from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import {
  nonNegativeDecimalString,
  parseBody,
  positiveDecimalString,
} from "../lib/validation.js";
import { consumeMaterial, createMaterial, receiveMaterial } from "../services/material-service.js";
import { ApiError } from "../lib/api-error.js";

const createMaterialSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  type: z.nativeEnum(MaterialType),
  baseUnit: z.nativeEnum(Unit),
  densityKgPerM3: positiveDecimalString.optional(),
  costPerBaseUnit: nonNegativeDecimalString,
  minimumStock: nonNegativeDecimalString,
  currency: z.string().length(3).optional(),
});

const receiptSchema = z.object({
  materialId: z.string().uuid(),
  supplierId: z.string().uuid().optional(),
  supplierName: z.string().trim().min(1).max(200).optional(),
  lotNumber: z.string().trim().min(1).max(100),
  receivedAt: z.coerce.date(),
  expiresAt: z.coerce.date().optional(),
  certificateNumber: z.string().trim().max(120).optional(),
  certificateUrl: z.string().url().optional(),
  quantity: positiveDecimalString,
  unit: z.nativeEnum(Unit),
  unitCost: nonNegativeDecimalString,
  currency: z.string().length(3).optional(),
  densityKgPerM3: positiveDecimalString.optional(),
  qualitySnapshot: z.record(z.string(), z.unknown()).optional(),
});

const consumptionSchema = z.object({
  materialId: z.string().uuid(),
  quantity: positiveDecimalString,
  unit: z.nativeEnum(Unit),
  consumedAt: z.coerce.date(),
  reason: z.string().trim().min(3).max(1000),
  reference: z.string().trim().max(200).optional(),
});

export async function registerMaterialRoutes(app: FastifyInstance): Promise<void> {
  app.get("/materials", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    const materials = await prisma.material.findMany({
      where: { workspaceId },
      include: {
        lots: {
          where: { availableQuantity: { gt: 0 } },
          include: { supplier: { select: { name: true } } },
          orderBy: [{ expiresAt: "asc" }, { receivedAt: "asc" }],
          take: 5,
        },
        priceHistory: { orderBy: { effectiveAt: "desc" }, take: 6 },
      },
      orderBy: [{ type: "asc" }, { name: "asc" }],
    });
    return {
      items: materials.map((material) => ({
        ...material,
        isCritical: material.currentStock.lte(material.minimumStock),
        freeStock: material.currentStock.sub(material.reservedStock),
      })),
    };
  });

  app.post("/materials", async (request, reply) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const input = parseBody(createMaterialSchema, request.body);
    const material = await createMaterial(workspaceId, actor.id, input);
    return reply.status(201).send(material);
  });

  app.post("/materials/receipts", async (request, reply) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string") {
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Добавьте заголовок Idempotency-Key");
    }
    const parsed = parseBody(receiptSchema, request.body);
    const input = {
      ...parsed,
      qualitySnapshot: parsed.qualitySnapshot as Prisma.InputJsonValue | undefined,
    };
    const result = await receiveMaterial(workspaceId, actor.id, idempotencyKey, input);
    return reply.status(201).send(result);
  });

  app.post("/materials/consumptions", async (request, reply) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const idempotencyKey = request.headers["idempotency-key"];
    if (typeof idempotencyKey !== "string") {
      throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Добавьте заголовок Idempotency-Key");
    }
    const result = await consumeMaterial(
      workspaceId,
      actor.id,
      idempotencyKey,
      parseBody(consumptionSchema, request.body),
    );
    return reply.status(201).send(result);
  });

  app.get<{ Params: { id: string } }>("/materials/:id/history", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    const material = await prisma.material.findFirst({
      where: { id: request.params.id, workspaceId },
      include: {
        lots: {
          include: { supplier: { select: { name: true } } },
          orderBy: { receivedAt: "desc" },
          take: 200,
        },
        priceHistory: { orderBy: { effectiveAt: "desc" }, take: 200 },
      },
    });
    if (material === null) throw new ApiError(404, "MATERIAL_NOT_FOUND", "Материал не найден");
    const movements = await prisma.materialMovement.findMany({
      where: { workspaceId, materialLot: { materialId: material.id } },
      include: {
        materialLot: { select: { lotNumber: true } },
        batch: { select: { number: true } },
      },
      orderBy: { occurredAt: "desc" },
      take: 500,
    });
    return { material, movements };
  });

  app.get<{ Params: { id: string } }>("/materials/:id/movements", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    const material = await prisma.material.findFirst({
      where: { id: request.params.id, workspaceId },
    });
    if (material === null) throw new ApiError(404, "MATERIAL_NOT_FOUND", "Материал не найден");
    const movements = await prisma.materialMovement.findMany({
      where: { workspaceId, materialLot: { materialId: material.id } },
      include: { materialLot: { select: { lotNumber: true } }, batch: { select: { number: true } } },
      orderBy: { occurredAt: "desc" },
      take: 500,
    });
    return { material, movements };
  });
}
