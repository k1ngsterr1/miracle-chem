import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from "@nestjs/common";
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
import { requireIdempotencyKey, type ApiRequest } from "../lib/http.js";
import { dayPeriodFromQuery } from "../lib/date-filter.js";
import { listOneCSales } from "../services/one-c-sales-service.js";
import { requirePermission } from "../lib/permissions.js";

const createSchema = z.object({
  number: z.string().trim().min(1).max(80),
  transferAt: z.coerce.date(),
  senderId: z.string().uuid(),
  customerId: z.string().uuid(),
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

@Controller("transfers")
export class TransferController {
  @Get()
  async list(@Req() request: ApiRequest, @Query() query: { status?: string; date?: string }) {
    const { workspaceId } = await getRequestContext(request, prisma);
    const selectedDay = dayPeriodFromQuery(query.date);
    const status = query.status !== undefined && Object.values(LrtTransferStatus).includes(query.status as LrtTransferStatus)
      ? (query.status as LrtTransferStatus)
      : undefined;
    return {
      items: await prisma.lrtTransfer.findMany({
        where: {
          workspaceId,
          ...(status === undefined ? {} : { status }),
          ...(selectedDay === undefined ? {} : { transferAt: { gte: selectedDay.from, lte: selectedDay.to } }),
        },
        include: {
          sender: { select: { name: true } },
          customer: { select: { id: true, name: true } },
          items: { include: { productLot: true, batch: { select: { number: true } } } },
        },
        orderBy: { transferAt: "desc" },
        take: 500,
      }),
    };
  }

  @Get("one-c-sales")
  async oneCSales(@Req() request: ApiRequest, @Query("date") date?: string) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "ACCOUNTING_VIEW");
    return listOneCSales(workspaceId, date);
  }

  @Get(":id")
  async detail(@Req() request: ApiRequest, @Param("id") id: string) {
    const { workspaceId } = await getRequestContext(request, prisma);
    const transfer = await prisma.lrtTransfer.findFirst({
      where: { id, workspaceId },
      include: {
        sender: true,
        customer: { select: { id: true, name: true, taxId: true, contactPerson: true } },
        items: {
          include: {
            productLot: { include: { movements: { orderBy: { occurredAt: "desc" } } } },
            batch: true,
          },
        },
        attachments: true,
      },
    });
    if (transfer === null) throw new ApiError(404, "TRANSFER_NOT_FOUND", "Отгрузка не найдена");
    return transfer;
  }

  @Post()
  async create(@Req() request: ApiRequest, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return createTransfer(workspaceId, actor.id, parseBody(createSchema, body));
  }

  @Post(":id/prepare")
  @HttpCode(HttpStatus.OK)
  async prepare(@Req() request: ApiRequest, @Param("id") id: string) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return prepareTransfer(workspaceId, actor.id, id);
  }

  @Post(":id/send")
  @HttpCode(HttpStatus.OK)
  async send(@Req() request: ApiRequest, @Param("id") id: string) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return sendTransfer(
      workspaceId,
      actor.id,
      id,
      requireIdempotencyKey(request.headers),
    );
  }

  @Post(":id/cancel")
  @HttpCode(HttpStatus.OK)
  async cancel(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const input = parseBody(cancelSchema, body);
    return cancelTransfer(
      workspaceId,
      actor.id,
      id,
      requireIdempotencyKey(request.headers),
      input.reason,
    );
  }

  @Post(":id/accept")
  @HttpCode(HttpStatus.OK)
  async accept(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return acceptTransfer(
      workspaceId,
      actor.id,
      id,
      requireIdempotencyKey(request.headers),
      parseBody(acceptSchema, body),
    );
  }

  @Post(":id/return")
  @HttpCode(HttpStatus.OK)
  async returnProduct(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return returnTransferProduct(
      workspaceId,
      actor.id,
      id,
      requireIdempotencyKey(request.headers),
      parseBody(returnSchema, body),
    );
  }
}
