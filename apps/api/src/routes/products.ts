import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { Prisma, ProductMovementType, Unit } from "../generated/prisma/index.js";
import { ApiError } from "../lib/api-error.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import { parseBody, positiveDecimalString } from "../lib/validation.js";
import { recordProductMovement } from "../services/product-service.js";
import { requireIdempotencyKey, type ApiRequest } from "../lib/http.js";

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

@Controller("product-lots")
export class ProductController {
  @Get()
  async list(@Req() request: ApiRequest) {
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
  }

  @Get(":id")
  async detail(@Req() request: ApiRequest, @Param("id") id: string) {
    const { workspaceId } = await getRequestContext(request, prisma);
    const lot = await prisma.productLot.findFirst({
      where: { id, workspaceId },
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
  }

  @Post(":id/movements")
  @HttpCode(HttpStatus.OK)
  async addMovement(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const parsed = parseBody(movementSchema, body);
    return recordProductMovement(
      workspaceId,
      actor.id,
      id,
      requireIdempotencyKey(request.headers),
      {
        ...parsed,
        metadata: parsed.metadata as Prisma.InputJsonValue | undefined,
      },
    );
  }
}
