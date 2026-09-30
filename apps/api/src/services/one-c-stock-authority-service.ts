import { OneCSyncEntityType, type Prisma } from "../generated/prisma/index.js";
import { ApiError } from "../lib/api-error.js";

/** Source-owned stock is changed only by inbound exchange, never by CRM operations. */
export async function requireCrmStockAuthority(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  materialIds: string[],
): Promise<void> {
  const references = await tx.oneCExternalReference.findMany({
    where: { workspaceId, source: "1C", entityType: OneCSyncEntityType.MATERIAL,
      internalId: { in: [...new Set(materialIds)] } },
    select: { internalId: true },
  });
  if (references.length > 0) {
    throw new ApiError(409, "ONE_C_STOCK_READ_ONLY",
      "Остатками этих материалов управляет 1С. Оформите складскую операцию в 1С и дождитесь обмена.",
      { materialIds: references.map((ref) => ref.internalId) });
  }
}
