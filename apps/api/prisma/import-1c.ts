import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Decimal } from "decimal.js";
import {
  AccountingDocumentStatus,
  AccountingDocumentType,
  AuditEntityType,
  ExpenseCategory,
  ExpenseCostCenter,
  ExpensePaymentMethod,
  ExpenseStatus,
  MaterialMovementType,
  MaterialType,
  Prisma,
  Unit,
  UserRole,
} from "../src/generated/prisma/index.js";
import {
  DEFAULT_ACTOR_ID,
  DEFAULT_PRODUCTION_LINE_ID,
  DEFAULT_PRODUCTION_TANK_ID,
  DEFAULT_WORKSPACE_ID,
} from "../src/config.js";
import { prisma } from "../src/lib/prisma.js";
import { hashPassword } from "../src/lib/password.js";

interface OneCLine {
  position: number;
  materialId: string;
  unit: Unit;
  sourceUnit: string;
  quantity: string;
  unitCost: string;
  amount: string;
  vatRateId: string;
  vatAmount: string;
}

interface OneCPurchaseBatch {
  id: string;
  sourceNumber: string;
  number: string;
  receivedAt: string;
  posted: boolean;
  supplierId: string;
  supplierName: string;
  warehouseId: string | null;
  warehouseName: string | null;
  amount: string;
  comment: string | null;
  lines: OneCLine[];
}

interface OneCInvoiceLine {
  position: number;
  description: string;
  materialId: string;
  unit: Unit;
  sourceUnit: string;
  quantity: string;
  unitPrice: string;
  grossAmount: string;
  vatRate: string;
  vatAmount: string;
}

interface OneCInvoice {
  id: string;
  sourceNumber: string;
  number: string;
  documentAt: string;
  counterpartyId: string;
  counterparty: string;
  counterpartyTaxId: string | null;
  warehouseName: string | null;
  totalAmount: string;
  comment: string | null;
  lines: OneCInvoiceLine[];
}

interface OneCImport {
  source: {
    format: string;
    configuration: string;
    configurationVersion: string;
    importedAt: string;
  };
  organization: {
    id: string;
    code: string;
    name: string;
    fullName: string | null;
    taxId: string | null;
  } | null;
  warehouses: Array<{ id: string; code: string; name: string; comment: string | null }>;
  suppliers: Array<{ id: string; name: string; taxId: string | null; fullName: string | null }>;
  materials: Array<{
    id: string;
    code: string;
    name: string;
    fullName: string | null;
    type: MaterialType;
    baseUnit: Unit;
    sourceUnit: string;
  }>;
  purchaseBatches: OneCPurchaseBatch[];
  invoices: OneCInvoice[];
}

const defaultImportPath = "/tmp/miracle-chem-1c-import/miracle-chem-1c.json";
const importPath = resolve(process.argv[2] ?? process.env.ONE_C_IMPORT_FILE ?? defaultImportPath);

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function main(): Promise<void> {
  if (process.env.ONE_C_ALLOW_LEGACY_FULL_IMPORT !== "yes") {
    throw new Error("Полный импорт 1С отключён: используйте безопасный инкрементальный endpoint /api/integrations/1c/sync. Для разового восстановления из резервной копии требуется явное ONE_C_ALLOW_LEGACY_FULL_IMPORT=yes.");
  }
  const input = JSON.parse(await readFile(importPath, "utf8")) as OneCImport;
  const password = process.env.DEFAULT_ADMIN_PASSWORD;
  if (password === undefined || password.length < 8) {
    throw new Error("DEFAULT_ADMIN_PASSWORD must contain at least 8 characters");
  }
  const passwordHash = hashPassword(password);
  // A one-off legacy dump can contain every 1C nomenclature. Obvious services, equipment and
  // office goods never belong to the production warehouse. Future imports use the explicit
  // productionEligible mapping in the incremental integration instead of a name heuristic.
  const productionMaterials = input.materials.filter((material) => !isClearlyNonProductionMaterial(material));
  const materialById = new Map(productionMaterials.map((material) => [material.id, material]));
  const supplierIds = new Set(input.suppliers.map((supplier) => supplier.id));
  const postedBatches = input.purchaseBatches
    .filter((batch) => batch.posted)
    .sort((left, right) => left.receivedAt.localeCompare(right.receivedAt));
  const stockByMaterial = new Map<string, Decimal>();
  const latestCost = new Map<string, { at: string; value: string }>();

  for (const batch of postedBatches) {
    for (const line of batch.lines) {
      const material = materialById.get(line.materialId);
      if (material === undefined) continue;
      if (material.baseUnit !== line.unit) {
        throw new Error(
          `Единица материала ${material.code} (${material.baseUnit}) не совпадает со строкой 1С (${line.unit})`,
        );
      }
      const previous = latestCost.get(line.materialId);
      if (previous === undefined || previous.at <= batch.receivedAt) {
        latestCost.set(line.materialId, { at: batch.receivedAt, value: line.unitCost });
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    // The dump is the new source of truth. TRUNCATE is transactional and the pre-import
    // PostgreSQL backup is created by the operator before this script is executed.
    await tx.$executeRawUnsafe('TRUNCATE TABLE "workspaces" CASCADE');

    await tx.workspace.create({
      data: {
        id: DEFAULT_WORKSPACE_ID,
        name: input.organization?.name ?? "Miracle Chem",
        timezone: "Asia/Almaty",
        currency: "KZT",
      },
    });
    await tx.user.create({
      data: {
        id: DEFAULT_ACTOR_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        name: "Администратор Miracle Chem",
        email: "admin@miracle-chem.local",
        passwordHash,
        role: UserRole.ADMIN,
      },
    });
    await tx.productionLine.create({
      data: {
        id: DEFAULT_PRODUCTION_LINE_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        code: "LINE-01",
        name: "Линия №1",
        capacity: "0",
        capacityUnit: Unit.M3,
      },
    });
    await tx.productionTank.create({
      data: {
        id: DEFAULT_PRODUCTION_TANK_ID,
        workspaceId: DEFAULT_WORKSPACE_ID,
        productionLineId: DEFAULT_PRODUCTION_LINE_ID,
        code: "TANK-01",
        name: "Чан №1",
        capacityUnit: Unit.M3,
      },
    });

    for (const supplier of input.suppliers) {
      await tx.supplier.create({
        data: {
          id: supplier.id,
          workspaceId: DEFAULT_WORKSPACE_ID,
          name: supplier.name,
          taxId: supplier.taxId,
          contact: supplier.fullName === supplier.name ? null : supplier.fullName,
        },
      });
    }

    for (const material of productionMaterials) {
      await tx.material.create({
        data: {
          id: material.id,
          workspaceId: DEFAULT_WORKSPACE_ID,
          code: material.code,
          name: material.name,
          type: material.type,
          baseUnit: material.baseUnit,
          costPerBaseUnit: latestCost.get(material.id)?.value ?? "0",
          currentStock: "0",
          reservedStock: "0",
          minimumStock: "0",
          currency: "KZT",
          active: true,
        },
      });
    }

    for (const batch of [...input.purchaseBatches].sort((left, right) => left.receivedAt.localeCompare(right.receivedAt))) {
      await tx.purchaseBatch.create({
        data: {
          id: batch.id,
          workspaceId: DEFAULT_WORKSPACE_ID,
          number: batch.number,
          receivedAt: new Date(batch.receivedAt),
          currency: "KZT",
          notes: [
            `Импортировано из 1С: Поступление товаров и услуг №${batch.sourceNumber}`,
            `Проведён: ${batch.posted ? "да" : "нет"}`,
            batch.warehouseName === null ? null : `Склад: ${batch.warehouseName}`,
            batch.comment,
          ].filter(Boolean).join(" · "),
        },
      });

      for (const line of batch.lines) {
        const material = materialById.get(line.materialId);
        if (material === undefined) continue;
        await tx.materialPriceHistory.create({
          data: {
            workspaceId: DEFAULT_WORKSPACE_ID,
            materialId: line.materialId,
            pricePerBaseUnit: line.unitCost,
            currency: "KZT",
            effectiveAt: new Date(batch.receivedAt),
            source: "1C_PURCHASE",
            referenceId: batch.id,
            note: `ПТУ №${batch.sourceNumber}; проведён: ${batch.posted ? "да" : "нет"}`,
          },
        });
        if (!batch.posted) continue;

        const before = stockByMaterial.get(line.materialId) ?? new Decimal(0);
        const quantity = new Decimal(line.quantity);
        const after = before.add(quantity);
        stockByMaterial.set(line.materialId, after);
        const lot = await tx.materialLot.create({
          data: {
            workspaceId: DEFAULT_WORKSPACE_ID,
            materialId: line.materialId,
            purchaseBatchId: batch.id,
            supplierId: supplierIds.has(batch.supplierId) ? batch.supplierId : null,
            lotNumber: `1C-${batch.sourceNumber}-${String(line.position).padStart(2, "0")}`,
            receivedAt: new Date(batch.receivedAt),
            initialQuantity: line.quantity,
            availableQuantity: line.quantity,
            reservedQuantity: "0",
            unit: line.unit,
            unitCost: line.unitCost,
            currency: "KZT",
            qualitySnapshot: asJson({
              source: "1C",
              sourceDocumentId: batch.id,
              sourceDocumentNumber: batch.sourceNumber,
              warehouse: batch.warehouseName,
              posted: true,
            }),
          },
        });
        await tx.materialMovement.create({
          data: {
            workspaceId: DEFAULT_WORKSPACE_ID,
            materialLotId: lot.id,
            type: MaterialMovementType.RECEIPT,
            quantity: line.quantity,
            unit: line.unit,
            baseQuantity: line.quantity,
            baseUnit: material.baseUnit,
            stockBefore: before.toString(),
            stockAfter: after.toString(),
            reservedBefore: "0",
            reservedAfter: "0",
            reason: `Импорт из 1С, ПТУ №${batch.sourceNumber}`,
            metadata: asJson({ source: "1C", sourceDocumentId: batch.id }),
            occurredAt: new Date(batch.receivedAt),
          },
        });
      }

      if (batch.posted) {
        await tx.expense.create({
          data: {
            id: batch.id,
            workspaceId: DEFAULT_WORKSPACE_ID,
            number: `1C-РАСХОД-${batch.sourceNumber}`,
            category: ExpenseCategory.RAW_MATERIALS,
            costCenter: ExpenseCostCenter.WAREHOUSE,
            paymentMethod: ExpensePaymentMethod.BANK_TRANSFER,
            status: ExpenseStatus.RECORDED,
            incurredAt: new Date(batch.receivedAt),
            amount: batch.amount,
            currency: "KZT",
            description: batch.lines.map((line) => materialById.get(line.materialId)?.name).filter(Boolean).join(", ") || "Поступление из 1С",
            counterparty: batch.supplierName,
            documentNumber: batch.sourceNumber,
            note: `Источник: 1С, Поступление товаров и услуг (${batch.id})`,
            createdById: DEFAULT_ACTOR_ID,
          },
        });
      }
    }

    for (const [materialId, stock] of stockByMaterial) {
      await tx.material.update({ where: { id: materialId }, data: { currentStock: stock.toString() } });
    }

    for (const invoice of input.invoices) {
      const vatAmount = invoice.lines.reduce((sum, line) => sum.add(line.vatAmount), new Decimal(0));
      const totalAmount = new Decimal(invoice.totalAmount);
      const subtotal = Decimal.max(0, totalAmount.sub(vatAmount));
      await tx.accountingDocument.create({
        data: {
          id: invoice.id,
          workspaceId: DEFAULT_WORKSPACE_ID,
          number: invoice.number,
          type: AccountingDocumentType.PAYMENT_INVOICE,
          status: AccountingDocumentStatus.ISSUED,
          documentAt: new Date(invoice.documentAt),
          issuedAt: new Date(invoice.documentAt),
          counterparty: invoice.counterparty,
          counterpartyTaxId: invoice.counterpartyTaxId,
          basis: `Счёт на оплату покупателю №${invoice.sourceNumber} из 1С`,
          subtotal: subtotal.toString(),
          vatRate: invoice.lines[0]?.vatRate ?? "0",
          vatAmount: vatAmount.toString(),
          totalAmount: totalAmount.toString(),
          currency: "KZT",
          notes: [
            `Источник: 1С (${invoice.id})`,
            invoice.warehouseName === null ? null : `Склад: ${invoice.warehouseName}`,
            invoice.comment,
          ].filter(Boolean).join(" · "),
          createdById: DEFAULT_ACTOR_ID,
          items: {
            create: invoice.lines.map((line) => {
              const gross = new Decimal(line.grossAmount);
              const net = Decimal.max(0, gross.sub(line.vatAmount));
              const quantity = new Decimal(line.quantity);
              return {
                description: line.description,
                quantity: line.quantity,
                unit: line.sourceUnit,
                unitPrice: quantity.isZero() ? "0" : net.div(quantity).toDecimalPlaces(4).toString(),
                amount: net.toString(),
                position: line.position,
              };
            }),
          },
        },
      });
    }

    await tx.auditLog.create({
      data: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        actorId: DEFAULT_ACTOR_ID,
        action: "IMPORT_1C_DT",
        entityType: AuditEntityType.WORKSPACE,
        entityId: DEFAULT_WORKSPACE_ID,
        after: asJson(input.source),
        metadata: asJson({
          file: importPath,
          organization: input.organization,
          warehouses: input.warehouses,
          counts: {
            suppliers: input.suppliers.length,
            materials: input.materials.length,
            purchaseBatches: input.purchaseBatches.length,
            postedPurchaseBatches: postedBatches.length,
            invoices: input.invoices.length,
          },
        }),
      },
    });
  }, { maxWait: 10_000, timeout: 120_000 });

  const counts = await Promise.all([
    prisma.material.count(),
    prisma.materialLot.count(),
    prisma.materialPriceHistory.count(),
    prisma.purchaseBatch.count(),
    prisma.supplier.count(),
    prisma.expense.count(),
    prisma.accountingDocument.count(),
  ]);
  console.log(JSON.stringify({
    importedFrom: importPath,
    materials: counts[0],
    materialLots: counts[1],
    priceHistory: counts[2],
    purchaseBatches: counts[3],
    counterparties: counts[4],
    expenses: counts[5],
    accountingDocuments: counts[6],
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

function isClearlyNonProductionMaterial(material: OneCImport["materials"][number]): boolean {
  const label = `${material.name} ${material.fullName ?? ""}`.toLocaleLowerCase("ru");
  return /подарочн(?:ый|ого)\s+сертификат|ноутбук|^емкость\s|^услуга\s/u.test(label);
}
