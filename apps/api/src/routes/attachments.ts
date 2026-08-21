import { Body, Controller, Get, Post, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { AuditEntityType } from "../generated/prisma/index.js";
import { ApiError } from "../lib/api-error.js";
import { writeAudit } from "../lib/audit.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import { parseBody } from "../lib/validation.js";
import type { ApiRequest } from "../lib/http.js";

const targetTypes = ["MATERIAL_LOT", "LRT_TRANSFER", "QUALITY_CHECK"] as const;
type AttachmentTargetType = (typeof targetTypes)[number];

const createSchema = z.object({
  targetType: z.enum(targetTypes),
  targetId: z.string().uuid(),
  name: z.string().trim().min(1).max(255),
  storageKey: z.string().trim().min(1).max(1000),
  mimeType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().nonnegative().max(250_000_000),
  url: z.string().url().optional(),
});

@Controller("attachments")
export class AttachmentController {
  @Get()
  async list(@Req() request: ApiRequest, @Query() query: { targetType?: string; targetId?: string }) {
    const { workspaceId } = await getRequestContext(request, prisma);
    if (!targetTypes.includes(query.targetType as AttachmentTargetType) || query.targetId === undefined) {
      throw new ApiError(400, "ATTACHMENT_TARGET_REQUIRED", "Укажите targetType и targetId");
    }
    await assertTarget(workspaceId, query.targetType as AttachmentTargetType, query.targetId);
    return {
      items: await prisma.attachment.findMany({
        where: targetWhere(query.targetType as AttachmentTargetType, query.targetId),
        orderBy: { createdAt: "desc" },
      }),
    };
  }

  @Post()
  async create(@Req() request: ApiRequest, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const input = parseBody(createSchema, body);
    const auditEntityType = await assertTarget(workspaceId, input.targetType, input.targetId);
    const attachment = await prisma.$transaction(async (tx) => {
      const created = await tx.attachment.create({
        data: {
          name: input.name,
          storageKey: input.storageKey,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
          ...(input.url === undefined ? {} : { url: input.url }),
          ...targetData(input.targetType, input.targetId),
        },
      });
      await writeAudit(tx, {
        workspaceId,
        actorId: actor.id,
        action: "ATTACHMENT_LINKED",
        entityType: auditEntityType,
        entityId: input.targetId,
        after: {
          attachmentId: created.id,
          name: created.name,
          storageKey: created.storageKey,
          mimeType: created.mimeType,
          sizeBytes: created.sizeBytes,
        },
      });
      return created;
    });
    return attachment;
  }
}

async function assertTarget(
  workspaceId: string,
  targetType: AttachmentTargetType,
  targetId: string,
): Promise<AuditEntityType> {
  if (targetType === "MATERIAL_LOT") {
    const row = await prisma.materialLot.findFirst({ where: { id: targetId, workspaceId }, select: { id: true } });
    if (row === null) throw new ApiError(404, "MATERIAL_LOT_NOT_FOUND", "Партия материала не найдена");
    return AuditEntityType.MATERIAL_LOT;
  }
  if (targetType === "LRT_TRANSFER") {
    const row = await prisma.lrtTransfer.findFirst({ where: { id: targetId, workspaceId }, select: { id: true } });
    if (row === null) throw new ApiError(404, "TRANSFER_NOT_FOUND", "Отгрузка не найдена");
    return AuditEntityType.LRT_TRANSFER;
  }
  const row = await prisma.qualityCheck.findFirst({ where: { id: targetId, workspaceId }, select: { id: true } });
  if (row === null) throw new ApiError(404, "QUALITY_CHECK_NOT_FOUND", "Запись контроля качества не найдена");
  return AuditEntityType.QUALITY_CHECK;
}

function targetWhere(targetType: AttachmentTargetType, targetId: string) {
  if (targetType === "MATERIAL_LOT") return { materialLotId: targetId };
  if (targetType === "LRT_TRANSFER") return { transferId: targetId };
  return { qualityCheckId: targetId };
}

function targetData(targetType: AttachmentTargetType, targetId: string) {
  if (targetType === "MATERIAL_LOT") return { materialLotId: targetId };
  if (targetType === "LRT_TRANSFER") return { transferId: targetId };
  return { qualityCheckId: targetId };
}
