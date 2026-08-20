import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  AdjustmentTargetType,
  ExpenseCategory,
  ExpenseCostCenter,
  ExpensePaymentMethod,
  ExpenseStatus,
  MaterialType,
  ProductMovementType,
  ProductionBatchStatus,
  RecipeStatus,
  Unit,
  UserRole,
  WagonStatus,
} from "./generated/prisma/index.js";
import { buildApp } from "./app.js";
import { prisma } from "./lib/prisma.js";

const testIds = {
  workspace: "99999999-9999-4999-8999-999999999999",
  actor: "99999999-9999-4999-8999-999999999991",
  line: "99999999-9999-4999-8999-999999999992",
  receiptMaterial: "99999999-9999-4999-8999-999999999993",
  scarceMaterial: "99999999-9999-4999-8999-999999999994",
  scarceLot: "99999999-9999-4999-8999-999999999995",
  recipe: "99999999-9999-4999-8999-999999999996",
  recipeVersion: "99999999-9999-4999-8999-999999999997",
} as const;

let app: FastifyInstance;
let batchId: string;
let productLotId: string;
let transferId: string;

const contextHeaders = {
  "x-workspace-id": testIds.workspace,
  "x-actor-id": testIds.actor,
};

beforeAll(async () => {
  await cleanupTestWorkspace();
  await prisma.workspace.create({
    data: {
      id: testIds.workspace,
      name: "Miracle Chem Integration Test",
      users: {
        create: {
          id: testIds.actor,
          name: "Integration Admin",
          email: "integration@miracle-chem.test",
          role: UserRole.ADMIN,
        },
      },
      productionLines: {
        create: {
          id: testIds.line,
          code: "TEST-LINE",
          name: "Integration line",
          capacity: "60",
          capacityUnit: Unit.M3,
        },
      },
      materials: {
        create: [
          {
            id: testIds.receiptMaterial,
            code: "TEST-RECEIPT",
            name: "Receipt material",
            type: MaterialType.CEMENT,
            baseUnit: Unit.KG,
            costPerBaseUnit: "10",
          },
          {
            id: testIds.scarceMaterial,
            code: "TEST-SCARCE",
            name: "Scarce material",
            type: MaterialType.CEMENT,
            baseUnit: Unit.KG,
            costPerBaseUnit: "10",
            currentStock: "1",
          },
        ],
      },
    },
  });
  await prisma.materialLot.create({
    data: {
      id: testIds.scarceLot,
      workspaceId: testIds.workspace,
      materialId: testIds.scarceMaterial,
      lotNumber: "SCARCE-LOT",
      receivedAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
      initialQuantity: "1",
      availableQuantity: "1",
      unit: Unit.KG,
      unitCost: "10",
    },
  });
  await prisma.recipe.create({
    data: {
      id: testIds.recipe,
      workspaceId: testIds.workspace,
      code: "TEST-B30",
      name: "Integration B30",
      status: RecipeStatus.ACTIVE,
      versions: {
        create: {
          id: testIds.recipeVersion,
          workspaceId: testIds.workspace,
          version: 1,
          concreteGrade: "B30",
          baseBatchVolume: "1",
          volumeUnit: Unit.M3,
          plannedYield: "1",
          yieldUnit: Unit.M3,
          technologyInstructions: "Integration test",
          snapshotHash: "0".repeat(64),
          publishedAt: new Date(),
          components: {
            create: {
              materialId: testIds.scarceMaterial,
              normPerM3: "5",
              unit: Unit.KG,
            },
          },
        },
      },
    },
  });
  app = await buildApp();
  await app.ready();
}, 30_000);

afterAll(async () => {
  await cleanupTestWorkspace();
  await app.close();
}, 30_000);

describe("Miracle Chem API integration", () => {
  it("responds to health and evaluates formulas on the backend", async () => {
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", service: "miracle-chem-api" });

    const calculation = await app.inject({
      method: "POST",
      url: "/api/formulas/evaluate",
      headers: contextHeaders,
      payload: {
        expression: "waterMass / cementMass",
        precision: 4,
        roundingMode: "HALF_UP",
        variables: {
          waterMass: { value: "875", unit: "KG" },
          cementMass: { value: "1950", unit: "KG" },
        },
      },
    });
    expect(calculation.statusCode).toBe(200);
    expect(calculation.json()).toMatchObject({ value: "0.4487" });
    expect(calculation.json().trace.length).toBeGreaterThanOrEqual(2);

    const recipeCalculation = await app.inject({
      method: "POST",
      url: "/api/calculator/recipe",
      headers: contextHeaders,
      payload: {
        recipeVersionId: testIds.recipeVersion,
        plannedVolume: "1",
        plannedVolumeUnit: "M3",
        calculatedFor: new Date().toISOString(),
      },
    });
    expect(recipeCalculation.statusCode).toBe(200);
    expect(recipeCalculation.json()).toMatchObject({
      plannedVolume: "1",
      totalCost: "50",
      sufficient: false,
    });
    expect(recipeCalculation.json().components[0]).toMatchObject({ shortage: "4", sufficient: false });
  });

  it("makes material receipts idempotent", async () => {
    const payload = {
      materialId: testIds.receiptMaterial,
      lotNumber: "RECEIPT-IDEMPOTENT",
      receivedAt: new Date().toISOString(),
      quantity: "100",
      unit: "KG",
      unitCost: "12.5",
    };
    const headers = { ...contextHeaders, "idempotency-key": "receipt-once" };
    const first = await app.inject({ method: "POST", url: "/api/materials/receipts", headers, payload });
    const second = await app.inject({ method: "POST", url: "/api/materials/receipts", headers, payload });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(await prisma.materialLot.count({
      where: { workspaceId: testIds.workspace, materialId: testIds.receiptMaterial },
    })).toBe(1);
    expect(await prisma.materialMovement.count({
      where: { workspaceId: testIds.workspace, idempotencyKey: "receipt-once" },
    })).toBe(1);
    expect(await prisma.materialPriceHistory.count({
      where: { workspaceId: testIds.workspace, materialId: testIds.receiptMaterial },
    })).toBe(1);
  });

  it("records warehouse consumption once and keeps reserved stock protected", async () => {
    const payload = {
      materialId: testIds.receiptMaterial,
      quantity: "25",
      unit: "KG",
      consumedAt: new Date().toISOString(),
      reason: "Integration warehouse consumption",
      reference: "REQ-25",
    };
    const headers = { ...contextHeaders, "idempotency-key": "warehouse-consumption-once" };
    const first = await app.inject({ method: "POST", url: "/api/materials/consumptions", headers, payload });
    const retried = await app.inject({ method: "POST", url: "/api/materials/consumptions", headers, payload });
    expect(first.statusCode).toBe(201);
    expect(retried.json()).toEqual(first.json());
    expect((await prisma.material.findUniqueOrThrow({ where: { id: testIds.receiptMaterial } })).currentStock.toString()).toBe("75");
    expect(await prisma.materialMovement.count({
      where: { workspaceId: testIds.workspace, idempotencyKey: "warehouse-consumption-once" },
    })).toBe(1);
  });

  it("rolls every reservation back when any material is insufficient", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/batches",
      headers: contextHeaders,
      payload: {
        number: "TEST-INSUFFICIENT",
        scheduledAt: new Date().toISOString(),
        recipeVersionId: testIds.recipeVersion,
        plannedVolume: "1",
        plannedVolumeUnit: "M3",
        operatorId: testIds.actor,
        productionLineId: testIds.line,
      },
    });
    expect(created.statusCode).toBe(201);
    batchId = created.json().id as string;

    const started = await app.inject({
      method: "POST",
      url: `/api/batches/${batchId}/start`,
      headers: { ...contextHeaders, "idempotency-key": "start-insufficient" },
    });
    expect(started.statusCode).toBe(409);
    expect(started.json().error.code).toBe("INSUFFICIENT_STOCK");
    const [batch, lot, material, allocations, reservations] = await Promise.all([
      prisma.productionBatch.findUniqueOrThrow({ where: { id: batchId } }),
      prisma.materialLot.findUniqueOrThrow({ where: { id: testIds.scarceLot } }),
      prisma.material.findUniqueOrThrow({ where: { id: testIds.scarceMaterial } }),
      prisma.batchMaterialAllocation.count({ where: { batchComponent: { batchId } } }),
      prisma.materialMovement.count({ where: { batchId, type: "RESERVATION" } }),
    ]);
    expect(batch.status).toBe(ProductionBatchStatus.PLANNED);
    expect(lot.reservedQuantity.toString()).toBe("0");
    expect(material.reservedStock.toString()).toBe("0");
    expect(allocations).toBe(0);
    expect(reservations).toBe(0);
  });

  it("does not double-decrement product on retry and records later stock operations once", async () => {
    const completed = await prisma.productionBatch.create({
      data: {
        workspaceId: testIds.workspace,
        number: "TEST-COMPLETED",
        status: ProductionBatchStatus.COMPLETED,
        scheduledAt: new Date(),
        startedAt: new Date(),
        completedAt: new Date(),
        recipeVersionId: testIds.recipeVersion,
        recipeSnapshot: {},
        formulaSnapshot: [],
        concreteGrade: "B30",
        plannedVolume: "10",
        plannedVolumeUnit: Unit.M3,
        actualVolume: "10",
        actualVolumeUnit: Unit.M3,
        plannedOutput: "10",
        plannedOutputUnit: Unit.M3,
        actualOutput: "10",
        actualOutputUnit: Unit.M3,
        goodOutput: "10",
        availableOutput: "10",
        outputAccountingUnit: Unit.M3,
        totalCost: "1000",
        costPerOutputUnit: "100",
        operatorId: testIds.actor,
        productionLineId: testIds.line,
        lockedAt: new Date(),
      },
    });
    const lot = await prisma.productLot.create({
      data: {
        workspaceId: testIds.workspace,
        batchId: completed.id,
        number: "TEST-PRODUCT-LOT",
        concreteGrade: "B30",
        producedQuantity: "10",
        goodQuantity: "10",
        availableQuantity: "10",
        unit: Unit.M3,
        totalCost: "1000",
        unitCost: "100",
      },
    });
    productLotId = lot.id;
    await prisma.productMovement.create({
      data: {
        workspaceId: testIds.workspace,
        productLotId,
        type: ProductMovementType.PRODUCTION,
        quantity: "10",
        unit: Unit.M3,
        balanceBefore: "0",
        balanceAfter: "10",
      },
    });
    const transfer = await app.inject({
      method: "POST",
      url: "/api/transfers",
      headers: contextHeaders,
      payload: {
        number: "TEST-LRT-1",
        transferAt: new Date().toISOString(),
        senderId: testIds.actor,
        receiverName: "Integration receiver",
        items: [{ productLotId, quantity: "4", unit: "M3" }],
      },
    });
    expect(transfer.statusCode).toBe(201);
    transferId = transfer.json().id as string;
    expect((await app.inject({
      method: "POST",
      url: `/api/transfers/${transferId}/prepare`,
      headers: contextHeaders,
    })).statusCode).toBe(200);
    const sendHeaders = { ...contextHeaders, "idempotency-key": "send-once" };
    const sent = await app.inject({ method: "POST", url: `/api/transfers/${transferId}/send`, headers: sendHeaders });
    const retried = await app.inject({ method: "POST", url: `/api/transfers/${transferId}/send`, headers: sendHeaders });
    expect(sent.statusCode).toBe(200);
    expect(retried.statusCode).toBe(200);
    expect(retried.json()).toEqual(sent.json());
    expect((await prisma.productLot.findUniqueOrThrow({ where: { id: productLotId } })).availableQuantity.toString()).toBe("6");
    expect(await prisma.productMovement.count({
      where: { workspaceId: testIds.workspace, idempotencyKey: "send-once" },
    })).toBe(1);

    const transferItem = await prisma.lrtTransferItem.findFirstOrThrow({ where: { transferId } });
    const accepted = await app.inject({
      method: "POST",
      url: `/api/transfers/${transferId}/accept`,
      headers: { ...contextHeaders, "idempotency-key": "accept-once" },
      payload: {
        items: [{ transferItemId: transferItem.id, acceptedQuantity: "4", rejectedQuantity: "0", unit: "M3" }],
      },
    });
    expect(accepted.statusCode).toBe(200);
    const returned = await app.inject({
      method: "POST",
      url: `/api/transfers/${transferId}/return`,
      headers: { ...contextHeaders, "idempotency-key": "return-after-accept" },
      payload: { items: [{ transferItemId: transferItem.id, quantity: "1", unit: "M3", reason: "Returned after acceptance" }] },
    });
    expect(returned.statusCode).toBe(200);
    expect((await prisma.productLot.findUniqueOrThrow({ where: { id: productLotId } })).availableQuantity.toString()).toBe("7");

    const writeoffHeaders = { ...contextHeaders, "idempotency-key": "writeoff-once" };
    const writeoffPayload = { type: "WRITEOFF", quantity: "1", unit: "M3", reason: "Integration test write-off" };
    const writeoff = await app.inject({
      method: "POST",
      url: `/api/product-lots/${productLotId}/movements`,
      headers: writeoffHeaders,
      payload: writeoffPayload,
    });
    const writeoffRetry = await app.inject({
      method: "POST",
      url: `/api/product-lots/${productLotId}/movements`,
      headers: writeoffHeaders,
      payload: writeoffPayload,
    });
    expect(writeoff.statusCode).toBe(200);
    expect(writeoffRetry.json()).toEqual(writeoff.json());
    expect((await prisma.productLot.findUniqueOrThrow({ where: { id: productLotId } })).availableQuantity.toString()).toBe("6");
  });

  it("applies approved adjustments as separate idempotent documents", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/adjustments",
      headers: contextHeaders,
      payload: {
        targetType: AdjustmentTargetType.PRODUCT_LOT,
        targetId: productLotId,
        reason: "Inventory reconciliation integration test",
        changes: { quantityDelta: "1", unit: "M3" },
      },
    });
    expect(created.statusCode).toBe(201);
    const adjustmentId = created.json().id as string;
    expect((await app.inject({
      method: "POST",
      url: `/api/adjustments/${adjustmentId}/approve`,
      headers: contextHeaders,
    })).statusCode).toBe(200);
    const applyHeaders = { ...contextHeaders, "idempotency-key": "adjust-once" };
    const applied = await app.inject({ method: "POST", url: `/api/adjustments/${adjustmentId}/apply`, headers: applyHeaders });
    const retried = await app.inject({ method: "POST", url: `/api/adjustments/${adjustmentId}/apply`, headers: applyHeaders });
    expect(applied.statusCode).toBe(200);
    expect(retried.json()).toEqual(applied.json());
    expect((await prisma.productLot.findUniqueOrThrow({ where: { id: productLotId } })).availableQuantity.toString()).toBe("7");
    expect(await prisma.productMovement.count({
      where: { productLotId, type: ProductMovementType.ADJUSTMENT },
    })).toBe(1);
  });

  it("tracks wagon dislocation as an append-only event history", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/wagons",
      headers: contextHeaders,
      payload: {
        number: "TEST-WAGON-01",
        type: "Hopper",
        capacity: "68",
        capacityUnit: "T",
        status: WagonStatus.EMPTY,
        location: "Test origin",
        cargoQuantity: "0",
        cargoUnit: "T",
        lastReportedAt: new Date().toISOString(),
      },
    });
    expect(created.statusCode).toBe(201);
    const wagonId = created.json().id as string;
    const moved = await app.inject({
      method: "POST",
      url: `/api/wagons/${wagonId}/location`,
      headers: contextHeaders,
      payload: {
        status: WagonStatus.IN_TRANSIT,
        location: "Test destination route",
        cargoDescription: "Cement",
        cargoQuantity: "60",
        cargoUnit: "T",
        shipmentNumber: "TEST-SHIPMENT-1",
        occurredAt: new Date().toISOString(),
      },
    });
    expect(moved.statusCode).toBe(201);
    expect(moved.json()).toMatchObject({
      status: WagonStatus.IN_TRANSIT,
      currentLocation: "Test destination route",
      shipmentNumber: "TEST-SHIPMENT-1",
    });
    expect(await prisma.wagonLocationEvent.count({ where: { wagonId } })).toBe(2);
  });

  it("records financial expenses idempotently and keeps cancelled entries in history", async () => {
    const payload = {
      category: ExpenseCategory.MAINTENANCE,
      costCenter: ExpenseCostCenter.PRODUCTION,
      paymentMethod: ExpensePaymentMethod.BANK_TRANSFER,
      incurredAt: new Date().toISOString(),
      amount: "42000",
      description: "Integration mixer maintenance",
      counterparty: "Integration Service",
      documentNumber: "TEST-ACT-42",
    };
    const headers = { ...contextHeaders, "idempotency-key": "expense-create-once" };
    const created = await app.inject({ method: "POST", url: "/api/expenses", headers, payload });
    const retried = await app.inject({ method: "POST", url: "/api/expenses", headers, payload });
    expect(created.statusCode).toBe(201);
    expect(retried.statusCode).toBe(201);
    expect(retried.json()).toEqual(created.json());
    expect(await prisma.expense.count({ where: { workspaceId: testIds.workspace } })).toBe(1);

    const expenseId = created.json().id as string;
    const cancelHeaders = { ...contextHeaders, "idempotency-key": "expense-cancel-once" };
    const cancelled = await app.inject({
      method: "POST",
      url: `/api/expenses/${expenseId}/cancel`,
      headers: cancelHeaders,
      payload: { reason: "Integration cancellation" },
    });
    const cancelRetry = await app.inject({
      method: "POST",
      url: `/api/expenses/${expenseId}/cancel`,
      headers: cancelHeaders,
      payload: { reason: "Integration cancellation" },
    });
    expect(cancelled.statusCode).toBe(200);
    expect(cancelRetry.json()).toEqual(cancelled.json());
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: expenseId } })).status).toBe(ExpenseStatus.CANCELLED);

    const listing = await app.inject({
      method: "GET",
      url: "/api/expenses?from=2020-01-01&to=2030-01-01",
      headers: contextHeaders,
    });
    expect(listing.statusCode).toBe(200);
    expect(listing.json()).toMatchObject({
      summary: { recordedCount: 0, cancelledCount: 1, totals: [] },
    });
    expect(listing.json().items).toHaveLength(1);

    const report = await app.inject({
      method: "GET",
      url: "/api/reports/expenses?from=2020-01-01&to=2030-01-01",
      headers: contextHeaders,
    });
    expect(report.statusCode).toBe(200);
    expect(report.json().items[0]).toMatchObject({
      expenseNumber: created.json().number,
      status: ExpenseStatus.CANCELLED,
      amount: "42000",
    });
  });

  it("links attachment metadata to scoped records and exports valid XLSX", async () => {
    const attachment = await app.inject({
      method: "POST",
      url: "/api/attachments",
      headers: contextHeaders,
      payload: {
        targetType: "LRT_TRANSFER",
        targetId: transferId,
        name: "transfer-act.pdf",
        storageKey: `transfers/${transferId}/act.pdf`,
        mimeType: "application/pdf",
        sizeBytes: 1024,
        url: "https://storage.example.test/transfer-act.pdf",
      },
    });
    expect(attachment.statusCode).toBe(201);
    const listing = await app.inject({
      method: "GET",
      url: `/api/attachments?targetType=LRT_TRANSFER&targetId=${transferId}`,
      headers: contextHeaders,
    });
    expect(listing.statusCode).toBe(200);
    expect(listing.json().items).toHaveLength(1);

    const summary = await app.inject({
      method: "GET",
      url: "/api/reports/production-summary?groupBy=operator&from=2020-01-01&to=2030-01-01",
      headers: contextHeaders,
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ groupBy: "operator" });
    expect(summary.json().items.length).toBeGreaterThan(0);

    const exportResponse = await app.inject({
      method: "GET",
      url: "/api/reports/export?type=production-summary&groupBy=operator&format=xlsx&from=2020-01-01&to=2030-01-01",
      headers: contextHeaders,
    });
    expect(exportResponse.statusCode).toBe(200);
    expect(exportResponse.headers["content-type"]).toContain("spreadsheetml.sheet");
    expect(exportResponse.rawPayload.subarray(0, 2).toString()).toBe("PK");
  });
});

async function cleanupTestWorkspace(): Promise<void> {
  const workspaceId = testIds.workspace;
  if ((await prisma.workspace.count({ where: { id: workspaceId } })) === 0) return;
  await prisma.$transaction(async (tx) => {
    await tx.expense.deleteMany({ where: { workspaceId } });
    await tx.wagonLocationEvent.deleteMany({ where: { workspaceId } });
    await tx.wagon.deleteMany({ where: { workspaceId } });
    await tx.productMovement.deleteMany({ where: { workspaceId } });
    await tx.lrtTransfer.deleteMany({ where: { workspaceId } });
    await tx.productLotMaterialTrace.deleteMany({ where: { productLot: { workspaceId } } });
    await tx.productLot.deleteMany({ where: { workspaceId } });
    await tx.materialMovement.deleteMany({ where: { workspaceId } });
    await tx.adjustmentDocument.deleteMany({ where: { workspaceId } });
    await tx.productionBatch.deleteMany({ where: { workspaceId } });
    await tx.recipe.deleteMany({ where: { workspaceId } });
    await tx.formula.deleteMany({ where: { workspaceId } });
    await tx.materialLot.deleteMany({ where: { workspaceId } });
    await tx.materialPriceHistory.deleteMany({ where: { workspaceId } });
    await tx.material.deleteMany({ where: { workspaceId } });
    await tx.supplier.deleteMany({ where: { workspaceId } });
    await tx.productionLine.deleteMany({ where: { workspaceId } });
    await tx.auditLog.deleteMany({ where: { workspaceId } });
    await tx.idempotencyRecord.deleteMany({ where: { workspaceId } });
    await tx.user.deleteMany({ where: { workspaceId } });
    await tx.workspace.delete({ where: { id: workspaceId } });
  });
}
