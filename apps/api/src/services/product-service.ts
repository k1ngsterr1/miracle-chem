import { convertQuantity } from "@betonflow/domain";
import { Decimal } from "decimal.js";
import {
  AuditEntityType,
  Prisma,
  ProductLotStatus,
  ProductMovementType,
  ProductionBatchStatus,
  type Unit,
} from "../generated/prisma/index.js";
import { ApiError } from "../lib/api-error.js";
import { writeAudit } from "../lib/audit.js";
import { runIdempotent } from "../lib/idempotency.js";
import { prisma } from "../lib/prisma.js";

export interface RecordProductMovementInput {
  type: "WRITEOFF" | "REJECT" | "OTHER_SHIPMENT";
  quantity: string;
  unit: Unit;
  reason: string;
  metadata?: Prisma.InputJsonValue;
}

export async function recordProductMovement(
  workspaceId: string,
  actorId: string,
  productLotId: string,
  idempotencyKey: string,
  input: RecordProductMovementInput,
) {
  return prisma.$transaction(
    (tx) =>
      runIdempotent(
        tx,
        {
          workspaceId,
          scope: `product-movement:${productLotId}`,
          key: idempotencyKey,
          payload: input as unknown as Prisma.InputJsonValue,
        },
        async () => {
          const lot = await tx.productLot.findFirst({
            where: { id: productLotId, workspaceId },
          });
          if (lot === null) {
            throw new ApiError(404, "PRODUCT_LOT_NOT_FOUND", "Партия готовой продукции не найдена");
          }

          const quantity = convertQuantity(
            { value: input.quantity, unit: input.unit },
            lot.unit,
            lot.densityKgPerM3?.toString(),
          ).value;
          if (quantity.lte(0)) {
            throw new ApiError(422, "INVALID_QUANTITY", "Количество движения должно быть больше нуля");
          }
          const before = new Decimal(lot.availableQuantity.toString());
          if (before.lt(quantity)) {
            throw new ApiError(409, "INSUFFICIENT_PRODUCT", "Недостаточно доступного продукта", {
              available: before.toString(),
              requested: quantity.toString(),
              unit: lot.unit,
            });
          }
          const after = before.sub(quantity);
          const quantityUpdate =
            input.type === ProductMovementType.WRITEOFF
              ? { writtenOffQuantity: { increment: quantity.toString() } }
              : input.type === ProductMovementType.OTHER_SHIPMENT
                ? { otherShipmentQuantity: { increment: quantity.toString() } }
                : { rejectedQuantity: { increment: quantity.toString() } };

          await tx.productLot.update({
            where: { id: lot.id },
            data: {
              ...quantityUpdate,
              availableQuantity: after.toString(),
              status:
                input.type === ProductMovementType.REJECT && after.isZero()
                  ? ProductLotStatus.REJECTED
                  : after.isZero()
                    ? ProductLotStatus.DEPLETED
                    : ProductLotStatus.PARTIALLY_DISPATCHED,
            },
          });
          await tx.productionBatch.update({
            where: { id: lot.batchId },
            data: {
              availableOutput: after.toString(),
              ...(after.isZero() ? { status: ProductionBatchStatus.FULLY_TRANSFERRED } : {}),
            },
          });
          const movement = await tx.productMovement.create({
            data: {
              workspaceId,
              productLotId: lot.id,
              type: input.type,
              quantity: quantity.toString(),
              unit: lot.unit,
              balanceBefore: before.toString(),
              balanceAfter: after.toString(),
              idempotencyKey,
              reason: input.reason,
              ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
            },
          });
          await writeAudit(tx, {
            workspaceId,
            actorId,
            action: `PRODUCT_${input.type}`,
            entityType: AuditEntityType.PRODUCT_LOT,
            entityId: lot.id,
            before: { availableQuantity: before.toString(), unit: lot.unit },
            after: { availableQuantity: after.toString(), unit: lot.unit },
            metadata: { movementId: movement.id, reason: input.reason },
          });
          return {
            movementId: movement.id,
            productLotId: lot.id,
            type: input.type,
            quantity: quantity.toString(),
            unit: lot.unit,
            balanceAfter: after.toString(),
          } satisfies Prisma.InputJsonObject;
        },
      ),
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 10_000, timeout: 30_000 },
  );
}
