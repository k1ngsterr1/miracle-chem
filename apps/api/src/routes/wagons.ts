import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { Unit, WagonStatus } from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import { nonNegativeDecimalString, parseBody, positiveDecimalString } from "../lib/validation.js";
import { createWagon, recordWagonLocation } from "../services/wagon-service.js";
import type { ApiRequest } from "../lib/http.js";

const locationFields = {
  status: z.nativeEnum(WagonStatus),
  location: z.string().trim().min(2).max(300),
  cargoDescription: z.string().trim().max(300).optional(),
  cargoQuantity: nonNegativeDecimalString,
  cargoUnit: z.nativeEnum(Unit),
  shipmentNumber: z.string().trim().max(100).optional(),
  note: z.string().trim().max(1000).optional(),
};

const createSchema = z.object({
  number: z.string().trim().min(2).max(50),
  type: z.string().trim().min(2).max(120),
  capacity: positiveDecimalString,
  capacityUnit: z.nativeEnum(Unit),
  tareWeightT: positiveDecimalString.optional(),
  ...locationFields,
  lastReportedAt: z.coerce.date(),
});

const locationSchema = z.object({
  ...locationFields,
  occurredAt: z.coerce.date(),
});

@Controller("wagons")
export class WagonController {
  @Get()
  async list(@Req() request: ApiRequest) {
    const { workspaceId } = await getRequestContext(request, prisma);
    return {
      items: await prisma.wagon.findMany({
        where: { workspaceId, active: true },
        include: {
          locationEvents: {
            include: { actor: { select: { id: true, name: true } } },
            orderBy: { occurredAt: "desc" },
            take: 12,
          },
        },
        orderBy: [{ status: "asc" }, { number: "asc" }],
      }),
    };
  }

  @Post()
  async create(@Req() request: ApiRequest, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return createWagon(workspaceId, actor.id, parseBody(createSchema, body));
  }

  @Post(":id/location")
  async recordLocation(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return recordWagonLocation(
      workspaceId,
      actor.id,
      id,
      parseBody(locationSchema, body),
    );
  }
}
