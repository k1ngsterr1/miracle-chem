import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Unit, WagonStatus } from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import { nonNegativeDecimalString, parseBody, positiveDecimalString } from "../lib/validation.js";
import { createWagon, recordWagonLocation } from "../services/wagon-service.js";

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

export async function registerWagonRoutes(app: FastifyInstance): Promise<void> {
  app.get("/wagons", async (request) => {
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
  });

  app.post("/wagons", async (request, reply) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const wagon = await createWagon(workspaceId, actor.id, parseBody(createSchema, request.body));
    return reply.status(201).send(wagon);
  });

  app.post<{ Params: { id: string } }>("/wagons/:id/location", async (request, reply) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const wagon = await recordWagonLocation(
      workspaceId,
      actor.id,
      request.params.id,
      parseBody(locationSchema, request.body),
    );
    return reply.status(201).send(wagon);
  });
}
