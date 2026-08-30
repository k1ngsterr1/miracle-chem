import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { Unit, WagonStatus } from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import { nonNegativeDecimalString, parseBody, positiveDecimalString } from "../lib/validation.js";
import { createWagon, recordWagonLocation } from "../services/wagon-service.js";
import type { ApiRequest } from "../lib/http.js";
import { dayPeriodFromQuery } from "../lib/date-filter.js";

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
  async list(@Req() request: ApiRequest, @Query("date") date?: string) {
    const { workspaceId } = await getRequestContext(request, prisma);
    const selectedDay = dayPeriodFromQuery(date);
    const items = await prisma.wagon.findMany({
      where: {
        workspaceId,
        active: true,
        ...(selectedDay === undefined ? {} : { lastReportedAt: { lte: selectedDay.to } }),
      },
      include: {
        locationEvents: {
          where: selectedDay === undefined ? undefined : { occurredAt: { lte: selectedDay.to } },
          include: { actor: { select: { id: true, name: true } } },
          orderBy: { occurredAt: "desc" },
          take: 12,
        },
      },
      orderBy: [{ status: "asc" }, { number: "asc" }],
    });
    return {
      items: items.map((wagon) => {
        const latest = wagon.locationEvents[0];
        return latest === undefined ? wagon : {
          ...wagon,
          status: latest.status,
          location: latest.location,
          cargoDescription: latest.cargoDescription,
          cargoQuantity: latest.cargoQuantity,
          cargoUnit: latest.cargoUnit,
          shipmentNumber: latest.shipmentNumber,
          note: latest.note,
          lastReportedAt: latest.occurredAt,
        };
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
