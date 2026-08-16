import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LrtTransferStatus, Unit } from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import { nonNegativeDecimalString, parseBody, positiveDecimalString } from "../lib/validation.js";
import { ApiError } from "../lib/api-error.js";
import {
  acceptTransfer,
  cancelTransfer,
  createTransfer,
  prepareTransfer,
  returnTransferProduct,
  sendTransfer,
} from "../services/transfer-service.js";

const createSchema = z.object({
  number: z.string().trim().min(1).max(80),
  transferAt: z.coerce.date(),
  senderId: z.string().uuid(),
  receiverId: z.string().uuid().optional(),
  receiverName: z.string().trim().min(1).max(200).optional(),
  transport: z.string().trim().max(500).optional(),
  comments: z.string().max(5000).optional(),
  items: z.array(
    z.object({
      productLotId: z.string().uuid(),
      quantity: positiveDecimalString,
      unit: z.nativeEnum(Unit),
    }),
  ).min(1).max(100),
});

const acceptSchema = z.object({
  items: z.array(
    z.object({
      transferItemId: z.string().uuid(),
      acceptedQuantity: nonNegativeDecimalString,
      rejectedQuantity: nonNegativeDecimalString.optional(),
      unit: z.nativeEnum(Unit),
    }),
  ).min(1),
});

const returnSchema = z.object({
  items: z.array(
    z.object({
      transferItemId: z.string().uuid(),
      quantity: positiveDecimalString,
      unit: z.nativeEnum(Unit),
      reason: z.string().trim().min(3).max(1000).optional(),
    }),
  ).min(1),
});

const cancelSchema = z.object({ reason: z.string().trim().min(3).max(1000) });

export async function registerTransferRoutes(app: FastifyInstance): Promise<void> {
  app.get("/transfers", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    const query = request.query as { status?: string };
    const status = query.status !== undefined && Object.values(LrtTransferStatus).includes(query.status as LrtTransferStatus)
      ? (query.status as LrtTransferStatus)
      : undefined;
    return {
      items: await prisma.lrtTransfer.findMany({
        where: { workspaceId, ...(status === undefined ? {} : { status }) },
        include: {
          sender: { select: { name: true } },
          receiver: { select: { name: true } },
          items: { include: { productLot: true, batch: { select: { number: true } } } },
        },
        orderBy: { transferAt: "desc" },
        take: 500,
      }),
    };
  });

  app.get<{ Params: { id: string } }>("/transfers/:id", async (request, reply) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    const transfer = await prisma.lrtTransfer.findFirst({
      where: { id: request.params.id, workspaceId },
      include: {
        sender: true,
        receiver: true,
        items: {
          include: {
            productLot: { include: { movements: { orderBy: { occurredAt: "desc" } } } },
            batch: true,
          },
        },
        attachments: true,
      },
    });
    if (transfer === null) return reply.status(404).send({ error: { code: "TRANSFER_NOT_FOUND" } });
    return transfer;
  });

  app.post("/transfers", async (request, reply) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const transfer = await createTransfer(workspaceId, actor.id, parseBody(createSchema, request.body));
    return reply.status(201).send(transfer);
  });

  app.post<{ Params: { id: string } }>("/transfers/:id/prepare", async (request) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return prepareTransfer(workspaceId, actor.id, request.params.id);
  });

  app.post<{ Params: { id: string } }>("/transfers/:id/send", async (request) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return sendTransfer(
      workspaceId,
      actor.id,
      request.params.id,
      requireIdempotencyKey(request.headers),
    );
  });

  app.post<{ Params: { id: string } }>("/transfers/:id/cancel", async (request) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const input = parseBody(cancelSchema, request.body);
    return cancelTransfer(
      workspaceId,
      actor.id,
      request.params.id,
      requireIdempotencyKey(request.headers),
      input.reason,
    );
  });

  app.post<{ Params: { id: string } }>("/transfers/:id/accept", async (request) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return acceptTransfer(
      workspaceId,
      actor.id,
      request.params.id,
      requireIdempotencyKey(request.headers),
      parseBody(acceptSchema, request.body),
    );
  });

  app.post<{ Params: { id: string } }>("/transfers/:id/return", async (request) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return returnTransferProduct(
      workspaceId,
      actor.id,
      request.params.id,
      requireIdempotencyKey(request.headers),
      parseBody(returnSchema, request.body),
    );
  });
}

function requireIdempotencyKey(headers: Record<string, unknown>): string {
  const value = headers["idempotency-key"];
  if (typeof value !== "string") {
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Добавьте заголовок Idempotency-Key");
  }
  return value;
}
