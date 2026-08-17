import { availableProduct, convertQuantity } from "@betonflow/domain";
import { Decimal } from "decimal.js";
import {
  AuditEntityType,
  LrtTransferStatus,
  Prisma,
  ProductLotStatus,
  ProductMovementType,
  ProductionBatchStatus,
  type Unit,
} from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/api-error.js";
import { runIdempotent } from "../lib/idempotency.js";
import { writeAudit } from "../lib/audit.js";

export interface CreateTransferInput {
  number: string;
  transferAt: Date;
  senderId: string;
  receiverId?: string;
  receiverName?: string;
  transport?: string;
  comments?: string;
  items: Array<{ productLotId: string; quantity: string; unit: Unit }>;
}

export interface AcceptTransferInput {
  items: Array<{
    transferItemId: string;
    acceptedQuantity: string;
    rejectedQuantity?: string;
    unit: Unit;
  }>;
}

export interface ReturnTransferInput {
  items: Array<{ transferItemId: string; quantity: string; unit: Unit; reason?: string }>;
}

export async function createTransfer(
  workspaceId: string,
  actorId: string,
  input: CreateTransferInput,
) {
  return prisma.$transaction(async (tx) => {
    const lots = await tx.productLot.findMany({
      where: { workspaceId, id: { in: input.items.map((item) => item.productLotId) } },
    });
    if (lots.length !== input.items.length) {
      throw new ApiError(422, "PRODUCT_LOT_NOT_FOUND", "Одна или несколько партий продукта не найдены");
    }
    const duplicateLots = new Set(input.items.map((item) => item.productLotId));
    if (duplicateLots.size !== input.items.length) {
      throw new ApiError(400, "DUPLICATE_TRANSFER_ITEM", "Партию нельзя добавить в отгрузку дважды");
    }
    const items = input.items.map((item) => {
      const lot = lots.find((candidate) => candidate.id === item.productLotId);
      if (lot === undefined) throw new ApiError(422, "PRODUCT_LOT_NOT_FOUND", "Партия не найдена");
      const quantity = convertQuantity(
        { value: item.quantity, unit: item.unit },
        lot.unit,
        lot.densityKgPerM3?.toString(),
      ).value;
      if (quantity.lte(0)) throw new ApiError(422, "INVALID_QUANTITY", "Количество отгрузки должно быть больше нуля");
      return {
        productLotId: lot.id,
        batchId: lot.batchId,
        requestedQuantity: quantity.toString(),
        unit: lot.unit,
      };
    });
    const transfer = await tx.lrtTransfer.create({
      data: {
        workspaceId,
        number: input.number,
        transferAt: input.transferAt,
        senderId: input.senderId,
        ...(input.receiverId === undefined ? {} : { receiverId: input.receiverId }),
        ...(input.receiverName === undefined ? {} : { receiverName: input.receiverName }),
        ...(input.transport === undefined ? {} : { transport: input.transport }),
        ...(input.comments === undefined ? {} : { comments: input.comments }),
        items: { create: items },
      },
      include: { items: { include: { productLot: true, batch: true } } },
    });
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: "LRT_TRANSFER_CREATED",
      entityType: AuditEntityType.LRT_TRANSFER,
      entityId: transfer.id,
      after: {
        number: transfer.number,
        items: items as unknown as Prisma.InputJsonValue,
      },
    });
    return transfer;
  });
}

export async function prepareTransfer(
  workspaceId: string,
  actorId: string,
  transferId: string,
) {
  return prisma.$transaction(async (tx) => {
    const transfer = await tx.lrtTransfer.findFirst({
      where: { id: transferId, workspaceId },
      include: { items: { include: { productLot: true } } },
    });
    if (transfer === null) throw new ApiError(404, "TRANSFER_NOT_FOUND", "Отгрузка не найдена");
    if (transfer.status !== LrtTransferStatus.DRAFT) {
      throw new ApiError(409, "INVALID_TRANSFER_STATUS", "Подготовить можно только черновик");
    }
    for (const item of transfer.items) {
      if (item.productLot.availableQuantity.lt(item.requestedQuantity)) {
        throw new ApiError(409, "INSUFFICIENT_PRODUCT", `Недостаточно продукта в партии ${item.productLot.number}`);
      }
    }
    const updated = await tx.lrtTransfer.update({
      where: { id: transfer.id },
      data: { status: LrtTransferStatus.PREPARED },
    });
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: "LRT_TRANSFER_PREPARED",
      entityType: AuditEntityType.LRT_TRANSFER,
      entityId: transfer.id,
      before: { status: transfer.status },
      after: { status: updated.status },
    });
    return updated;
  });
}

export async function sendTransfer(
  workspaceId: string,
  actorId: string,
  transferId: string,
  idempotencyKey: string,
) {
  return prisma.$transaction(
    (tx) =>
      runIdempotent(tx, {
        workspaceId,
        scope: `lrt-send:${transferId}`,
        key: idempotencyKey,
        payload: { transferId },
      }, async () => {
        const transfer = await tx.lrtTransfer.findFirst({
          where: { id: transferId, workspaceId },
          include: { items: { include: { productLot: true, batch: true } } },
        });
        if (transfer === null) throw new ApiError(404, "TRANSFER_NOT_FOUND", "Отгрузка не найдена");
        const sendableStatuses: LrtTransferStatus[] = [
          LrtTransferStatus.DRAFT,
          LrtTransferStatus.PREPARED,
        ];
        if (!sendableStatuses.includes(transfer.status)) {
          throw new ApiError(409, "INVALID_TRANSFER_STATUS", "Отправить можно черновик или подготовленную отгрузку");
        }
        for (const item of transfer.items) {
          const lot = item.productLot;
          const quantity = new Decimal(item.requestedQuantity.toString());
          const before = new Decimal(lot.availableQuantity.toString());
          if (before.lt(quantity)) {
            throw new ApiError(409, "INSUFFICIENT_PRODUCT", `Недостаточно продукта в партии ${lot.number}`, {
              available: before.toString(),
              requested: quantity.toString(),
              unit: lot.unit,
            });
          }
          const after = before.sub(quantity);
          await tx.productLot.update({
            where: { id: lot.id },
            data: {
              availableQuantity: after.toString(),
              sentToLrtQuantity: { increment: quantity.toString() },
              status: after.isZero() ? ProductLotStatus.DEPLETED : ProductLotStatus.PARTIALLY_DISPATCHED,
            },
          });
          await tx.lrtTransferItem.update({
            where: { id: item.id },
            data: { sentQuantity: quantity.toString() },
          });
          await tx.productMovement.create({
            data: {
              workspaceId,
              productLotId: lot.id,
              transferItemId: item.id,
              type: ProductMovementType.LRT_DISPATCH,
              quantity: quantity.toString(),
              unit: lot.unit,
              balanceBefore: before.toString(),
              balanceAfter: after.toString(),
              idempotencyKey,
            },
          });
          await tx.productionBatch.update({
            where: { id: item.batchId },
            data: {
              sentToLrt: { increment: quantity.toString() },
              availableOutput: after.toString(),
              status: after.isZero()
                ? ProductionBatchStatus.FULLY_TRANSFERRED
                : ProductionBatchStatus.PARTIALLY_TRANSFERRED,
            },
          });
        }
        const updated = await tx.lrtTransfer.update({
          where: { id: transfer.id },
          data: { status: LrtTransferStatus.SENT, sentAt: new Date() },
        });
        await writeAudit(tx, {
          workspaceId,
          actorId,
          action: "LRT_TRANSFER_SENT",
          entityType: AuditEntityType.LRT_TRANSFER,
          entityId: transfer.id,
          before: { status: transfer.status },
          after: { status: updated.status, sentAt: updated.sentAt?.toISOString() ?? null },
        });
        return {
          transferId: transfer.id,
          number: transfer.number,
          status: updated.status,
          sentAt: updated.sentAt?.toISOString() ?? null,
        } satisfies Prisma.InputJsonObject;
      }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 },
  );
}

export async function cancelTransfer(
  workspaceId: string,
  actorId: string,
  transferId: string,
  idempotencyKey: string,
  reason: string,
) {
  return prisma.$transaction(
    (tx) => runIdempotent(tx, {
      workspaceId,
      scope: `lrt-cancel:${transferId}`,
      key: idempotencyKey,
      payload: { transferId, reason },
    }, async () => {
      const transfer = await tx.lrtTransfer.findFirst({ where: { id: transferId, workspaceId } });
      if (transfer === null) throw new ApiError(404, "TRANSFER_NOT_FOUND", "Отгрузка не найдена");
      const cancellable: LrtTransferStatus[] = [LrtTransferStatus.DRAFT, LrtTransferStatus.PREPARED];
      if (!cancellable.includes(transfer.status)) {
        throw new ApiError(409, "INVALID_TRANSFER_STATUS", "Отменить можно только неотправленную отгрузку");
      }
      const updated = await tx.lrtTransfer.update({
        where: { id: transfer.id },
        data: { status: LrtTransferStatus.CANCELLED, comments: appendReason(transfer.comments, reason) },
      });
      await writeAudit(tx, {
        workspaceId,
        actorId,
        action: "LRT_TRANSFER_CANCELLED",
        entityType: AuditEntityType.LRT_TRANSFER,
        entityId: transfer.id,
        before: { status: transfer.status },
        after: { status: updated.status, reason },
      });
      return { transferId: transfer.id, status: updated.status } satisfies Prisma.InputJsonObject;
    }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function acceptTransfer(
  workspaceId: string,
  actorId: string,
  transferId: string,
  idempotencyKey: string,
  input: AcceptTransferInput,
) {
  return prisma.$transaction(
    (tx) =>
      runIdempotent(tx, {
        workspaceId,
        scope: `lrt-accept:${transferId}`,
        key: idempotencyKey,
        payload: input as unknown as Prisma.InputJsonValue,
      }, async () => {
        const transfer = await tx.lrtTransfer.findFirst({
          where: { id: transferId, workspaceId },
          include: { items: { include: { productLot: true } } },
        });
        if (transfer === null) throw new ApiError(404, "TRANSFER_NOT_FOUND", "Отгрузка не найдена");
        if (transfer.status !== LrtTransferStatus.SENT) {
          throw new ApiError(409, "INVALID_TRANSFER_STATUS", "Принять можно только отправленную передачу");
        }
        if (input.items.length !== transfer.items.length) {
          throw new ApiError(400, "ALL_TRANSFER_ITEMS_REQUIRED", "Передайте результат по каждой партии");
        }
        let totalSent = new Decimal(0);
        let totalAccepted = new Decimal(0);
        let totalRejected = new Decimal(0);
        for (const item of transfer.items) {
          const result = input.items.find((candidate) => candidate.transferItemId === item.id);
          if (result === undefined) throw new ApiError(400, "TRANSFER_ITEM_MISSING", "Нет результата по позиции");
          const accepted = convertQuantity(
            { value: result.acceptedQuantity, unit: result.unit },
            item.unit,
            item.productLot.densityKgPerM3?.toString(),
          ).value;
          const rejected = convertQuantity(
            { value: result.rejectedQuantity ?? "0", unit: result.unit },
            item.unit,
            item.productLot.densityKgPerM3?.toString(),
          ).value;
          const sent = new Decimal(item.sentQuantity.toString());
          if (!accepted.add(rejected).eq(sent)) {
            throw new ApiError(422, "ACCEPTANCE_BALANCE_MISMATCH", "Принятое и отклонённое количество должно равняться отправленному");
          }
          await tx.lrtTransferItem.update({
            where: { id: item.id },
            data: { acceptedQuantity: accepted.toString(), rejectedQuantity: rejected.toString() },
          });
          totalSent = totalSent.add(sent);
          totalAccepted = totalAccepted.add(accepted);
          totalRejected = totalRejected.add(rejected);
        }
        const status = totalAccepted.eq(totalSent)
          ? LrtTransferStatus.ACCEPTED
          : totalRejected.eq(totalSent)
            ? LrtTransferStatus.REJECTED
            : LrtTransferStatus.PARTIALLY_ACCEPTED;
        const updated = await tx.lrtTransfer.update({
          where: { id: transfer.id },
          data: { status, acceptedAt: new Date() },
        });
        await writeAudit(tx, {
          workspaceId,
          actorId,
          action: "LRT_TRANSFER_ACCEPTED",
          entityType: AuditEntityType.LRT_TRANSFER,
          entityId: transfer.id,
          before: { status: transfer.status },
          after: {
            status,
            accepted: totalAccepted.toString(),
            rejected: totalRejected.toString(),
          },
        });
        return {
          transferId: transfer.id,
          status: updated.status,
          acceptedAt: updated.acceptedAt?.toISOString() ?? null,
        } satisfies Prisma.InputJsonObject;
      }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function returnTransferProduct(
  workspaceId: string,
  actorId: string,
  transferId: string,
  idempotencyKey: string,
  input: ReturnTransferInput,
) {
  return prisma.$transaction(
    (tx) =>
      runIdempotent(tx, {
        workspaceId,
        scope: `lrt-return:${transferId}`,
        key: idempotencyKey,
        payload: input as unknown as Prisma.InputJsonValue,
      }, async () => {
        const transfer = await tx.lrtTransfer.findFirst({
          where: { id: transferId, workspaceId },
          include: { items: { include: { productLot: true, batch: true } } },
        });
        if (transfer === null) throw new ApiError(404, "TRANSFER_NOT_FOUND", "Отгрузка не найдена");
        const returnableStatuses: LrtTransferStatus[] = [
          LrtTransferStatus.SENT,
          LrtTransferStatus.ACCEPTED,
          LrtTransferStatus.PARTIALLY_ACCEPTED,
          LrtTransferStatus.REJECTED,
        ];
        if (!returnableStatuses.includes(transfer.status)) {
          throw new ApiError(409, "INVALID_TRANSFER_STATUS", "Для этой отгрузки возврат невозможен");
        }
        for (const returnItem of input.items) {
          const item = transfer.items.find((candidate) => candidate.id === returnItem.transferItemId);
          if (item === undefined) throw new ApiError(404, "TRANSFER_ITEM_NOT_FOUND", "Позиция отгрузки не найдена");
          const quantity = convertQuantity(
            { value: returnItem.quantity, unit: returnItem.unit },
            item.unit,
            item.productLot.densityKgPerM3?.toString(),
          ).value;
          const maximumReturn = new Decimal(item.sentQuantity.toString())
            .sub(item.returnedQuantity.toString());
          if (quantity.gt(maximumReturn)) {
            throw new ApiError(409, "RETURN_EXCEEDS_AVAILABLE", "Возврат превышает непринятое количество", {
              maximumReturn: maximumReturn.toString(),
              unit: item.unit,
            });
          }
          const lot = item.productLot;
          const before = new Decimal(lot.availableQuantity.toString());
          const after = before.add(quantity);
          const recalculated = availableProduct(
            lot.producedQuantity.toString(),
            lot.sentToLrtQuantity.toString(),
            lot.writtenOffQuantity.toString(),
            lot.otherShipmentQuantity.toString(),
            new Decimal(lot.returnedQuantity.toString()).add(quantity),
          );
          if (!recalculated.eq(after)) {
            throw new ApiError(500, "PRODUCT_BALANCE_INVARIANT", "Нарушен баланс партии продукта");
          }
          await tx.productLot.update({
            where: { id: lot.id },
            data: {
              returnedQuantity: { increment: quantity.toString() },
              availableQuantity: after.toString(),
              status: ProductLotStatus.PARTIALLY_DISPATCHED,
            },
          });
          await tx.lrtTransferItem.update({
            where: { id: item.id },
            data: { returnedQuantity: { increment: quantity.toString() } },
          });
          await tx.productMovement.create({
            data: {
              workspaceId,
              productLotId: lot.id,
              transferItemId: item.id,
              type: ProductMovementType.LRT_RETURN,
              quantity: quantity.toString(),
              unit: lot.unit,
              balanceBefore: before.toString(),
              balanceAfter: after.toString(),
              idempotencyKey,
              ...(returnItem.reason === undefined ? {} : { reason: returnItem.reason }),
            },
          });
          await tx.productionBatch.update({
            where: { id: item.batchId },
            data: {
              availableOutput: after.toString(),
              status: ProductionBatchStatus.PARTIALLY_TRANSFERRED,
            },
          });
        }
        await writeAudit(tx, {
          workspaceId,
          actorId,
          action: "LRT_PRODUCT_RETURNED",
          entityType: AuditEntityType.LRT_TRANSFER,
          entityId: transfer.id,
          after: { items: input.items as unknown as Prisma.InputJsonValue },
        });
        return {
          transferId: transfer.id,
          returned: true,
        } satisfies Prisma.InputJsonObject;
      }),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

function appendReason(comments: string | null, reason: string): string {
  const cancellation = `Отмена: ${reason}`;
  return comments === null || comments.trim() === "" ? cancellation : `${comments}\n${cancellation}`;
}
