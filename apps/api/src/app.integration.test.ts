import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import supertest from "supertest";
import {
  AccountingDocumentStatus,
  AccountingDocumentType,
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
import { hashPassword } from "./lib/password.js";
import { prisma } from "./lib/prisma.js";
import { removeStoredReceipt } from "./lib/receipt-storage.js";

const testIds = {
  workspace: "99999999-9999-4999-8999-999999999999",
  actor: "99999999-9999-4999-8999-999999999991",
  viewer: "99999999-9999-4999-8999-999999999989",
  line: "99999999-9999-4999-8999-999999999992",
  tank: "99999999-9999-4999-8999-999999999990",
  receiptMaterial: "99999999-9999-4999-8999-999999999993",
  scarceMaterial: "99999999-9999-4999-8999-999999999994",
  scarceLot: "99999999-9999-4999-8999-999999999995",
  recipe: "99999999-9999-4999-8999-999999999996",
  recipeVersion: "99999999-9999-4999-8999-999999999997",
  customer: "99999999-9999-4999-8999-999999999998",
} as const;

interface InjectOptions {
  method: "GET" | "POST" | "PATCH";
  url: string;
  headers?: Record<string, string>;
  payload?: unknown;
}

interface InjectResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  payload: string;
  rawPayload: Buffer;
  json: () => any;
}

let nestApp: INestApplication;
let app: { inject: (options: InjectOptions) => Promise<InjectResponse>; close: () => Promise<void> };
let batchId: string;
let profitBatchId: string;
let productLotId: string;
let transferId: string;

const contextHeaders = {
  "x-workspace-id": testIds.workspace,
  "x-actor-id": testIds.actor,
};

const viewerHeaders = {
  "x-workspace-id": testIds.workspace,
  "x-actor-id": testIds.viewer,
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
          passwordHash: hashPassword("Integration#2026"),
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
  await prisma.user.create({
    data: {
      id: testIds.viewer,
      workspaceId: testIds.workspace,
      name: "Integration Viewer",
      email: "viewer@miracle-chem.test",
      role: UserRole.VIEWER,
    },
  });
  await prisma.customer.create({
    data: {
      id: testIds.customer,
      workspaceId: testIds.workspace,
      name: "ZZZ Integration recipe customer",
    },
  });
  await prisma.productionTank.create({
    data: {
      id: testIds.tank,
      workspaceId: testIds.workspace,
      productionLineId: testIds.line,
      code: "TEST-TANK",
      name: "Integration tank",
      capacity: "5",
      capacityUnit: Unit.M3,
    },
  });
  await prisma.recipe.create({
    data: {
      id: testIds.recipe,
      workspaceId: testIds.workspace,
      customerId: testIds.customer,
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
  nestApp = await buildApp();
  app = createTestClient(nestApp);
}, 30_000);

function createTestClient(application: INestApplication) {
  return {
    async inject(options: InjectOptions): Promise<InjectResponse> {
      const method = options.method.toLocaleLowerCase("en-US") as "get" | "post" | "patch";
      let testRequest = supertest(application.getHttpServer())[method](options.url);
      for (const [name, value] of Object.entries(options.headers ?? {})) {
        testRequest = testRequest.set(name, value);
      }
      if (options.payload !== undefined) testRequest = testRequest.send(options.payload);
      const response = await testRequest;
      return {
        statusCode: response.status,
        headers: response.headers,
        payload: response.text,
        rawPayload: Buffer.isBuffer(response.body) ? response.body : Buffer.from(response.text),
        json: () => response.body,
      };
    },
    close: () => application.close(),
  };
}

afterAll(async () => {
  await cleanupTestWorkspace();
  await app.close();
}, 30_000);

describe("Miracle Chem NestJS API integration", () => {
  it("synchronizes an offline 1C delta idempotently and quarantines unapproved nomenclature", async () => {
    const delta = {
      workspaceId: testIds.workspace,
      batchId: "1c-integration-batch-001",
      generatedAt: "2026-08-29T10:00:00.000Z",
      customers: [{
        externalId: "1c-customer-001",
        updatedAt: "2026-08-29T09:55:00.000Z",
        name: "1C Integration Customer",
        taxId: "123456789012",
        active: true,
      }],
      suppliers: [{
        externalId: "1c-supplier-001",
        updatedAt: "2026-08-29T09:55:00.000Z",
        name: "1C Integration Supplier",
      }],
      materials: [
        {
          externalId: "1c-material-kt1",
          updatedAt: "2026-08-29T09:55:00.000Z",
          code: "1C-KT-1",
          name: "1C КТ-1",
          type: MaterialType.REAGENT,
          baseUnit: Unit.KG,
          costPerBaseUnit: "120",
          productionEligible: true,
        },
        {
          externalId: "1c-material-non-production",
          updatedAt: "2026-08-29T09:55:00.000Z",
          code: "1C-NON-PRODUCTION",
          name: "Ноутбук из 1С",
          type: MaterialType.OTHER,
          baseUnit: Unit.PCS,
          costPerBaseUnit: "100000",
          productionEligible: false,
        },
      ],
      receipts: [{
        externalId: "1c-receipt-kt1-001",
        updatedAt: "2026-08-29T09:58:00.000Z",
        posted: true,
        number: "ПТУ-1C-001",
        receivedAt: "2026-08-29T09:58:00.000Z",
        materialExternalId: "1c-material-kt1",
        supplierExternalId: "1c-supplier-001",
        lotNumber: "1C-LOT-001",
        quantity: "125",
        unit: Unit.KG,
        unitCost: "120",
      }],
    };
    const headers = { "x-one-c-sync-key": "one-c-integration-test-key-must-be-long" };
    const first = await app.inject({ method: "POST", url: "/api/integrations/1c/sync", headers, payload: delta });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ replayed: false, status: "PARTIAL", summary: { created: 4, quarantined: 1 } });

    const replay = await app.inject({ method: "POST", url: "/api/integrations/1c/sync", headers, payload: delta });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toMatchObject({ replayed: true, status: "PARTIAL" });

    const [materials, reviews, runs] = await Promise.all([
      app.inject({ method: "GET", url: "/api/materials", headers: contextHeaders }),
      app.inject({ method: "GET", url: "/api/integrations/1c/reviews", headers: contextHeaders }),
      app.inject({ method: "GET", url: "/api/integrations/1c/runs", headers: contextHeaders }),
    ]);
    expect(materials.statusCode).toBe(200);
    expect(materials.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "1C-KT-1", currentStock: "125" }),
    ]));
    expect(materials.json().items).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "1C-NON-PRODUCTION" }),
    ]));
    expect(reviews.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ externalId: "1c-material-non-production", status: "PENDING" }),
    ]));
    expect(runs.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ batchId: delta.batchId, status: "PARTIAL" }),
    ]));

    const importedMaterial = await prisma.material.findUniqueOrThrow({
      where: { workspaceId_code: { workspaceId: testIds.workspace, code: "1C-KT-1" } },
      select: { id: true },
    });
    await prisma.$transaction(async (tx) => {
      const importedLots = await tx.materialLot.findMany({ where: { workspaceId: testIds.workspace, materialId: importedMaterial.id }, select: { id: true } });
      await tx.materialMovement.deleteMany({ where: { materialLotId: { in: importedLots.map((lot) => lot.id) } } });
      await tx.materialPriceHistory.deleteMany({ where: { workspaceId: testIds.workspace, materialId: importedMaterial.id } });
      await tx.materialLot.deleteMany({ where: { id: { in: importedLots.map((lot) => lot.id) } } });
      await tx.oneCExternalReference.deleteMany({ where: { workspaceId: testIds.workspace, externalId: { startsWith: "1c-" } } });
      await tx.oneCSyncReview.deleteMany({ where: { workspaceId: testIds.workspace, externalId: { startsWith: "1c-" } } });
      await tx.oneCSyncRun.deleteMany({ where: { workspaceId: testIds.workspace, batchId: delta.batchId } });
      await tx.material.delete({ where: { id: importedMaterial.id } });
      await tx.supplier.deleteMany({ where: { workspaceId: testIds.workspace, name: "1C Integration Supplier" } });
      await tx.customer.deleteMany({ where: { workspaceId: testIds.workspace, name: "1C Integration Customer" } });
    });
  });

  it("enforces module permissions on the server instead of relying on hidden navigation", async () => {
    const [warehouse, warehouseWrite, reports, customers] = await Promise.all([
      app.inject({ method: "GET", url: "/api/materials", headers: viewerHeaders }),
      app.inject({
        method: "POST",
        url: "/api/materials",
        headers: viewerHeaders,
        payload: { code: "NOPE", name: "No access", type: MaterialType.REAGENT, baseUnit: Unit.KG, costPerBaseUnit: "0", minimumStock: "0" },
      }),
      app.inject({ method: "GET", url: "/api/reports/production", headers: viewerHeaders }),
      app.inject({ method: "GET", url: "/api/customers", headers: viewerHeaders }),
    ]);
    expect(warehouse.statusCode).toBe(403);
    expect(warehouseWrite.statusCode).toBe(403);
    expect(reports.statusCode).toBe(200);
    expect(customers.statusCode).toBe(200);
  });

  it("authenticates by password and returns an HttpOnly session", async () => {
    const rejected = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "integration@miracle-chem.test", password: "WrongPassword" },
    });
    expect(rejected.statusCode).toBe(401);

    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { email: "integration@miracle-chem.test", password: "Integration#2026" },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json()).toMatchObject({
      user: { id: testIds.actor, role: UserRole.ADMIN },
      workspace: { id: testIds.workspace },
    });
    const setCookie = login.headers["set-cookie"];
    const rawCookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const cookie = rawCookie?.split(";")[0];
    expect(rawCookie).toContain("HttpOnly");
    expect(cookie).toBeTruthy();

    const session = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: cookie ?? "" },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().user).toMatchObject({ id: testIds.actor, email: "integration@miracle-chem.test" });
  });

  it("stores commercial terms in a customer profile", async () => {
    const updated = await app.inject({
      method: "PATCH",
      url: `/api/customers/${testIds.customer}`,
      headers: contextHeaders,
      payload: {
        contractNumber: "MC-INT-24",
        contractSignedAt: "2026-01-10T00:00:00.000Z",
        contractValidUntil: "2027-01-09T00:00:00.000Z",
        paymentTermDays: 14,
        creditLimit: "1500000.50",
      },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({
      contractNumber: "MC-INT-24",
      paymentTermDays: 14,
      creditLimit: "1500000.5",
    });

    const detail = await app.inject({ method: "GET", url: `/api/customers/${testIds.customer}`, headers: contextHeaders });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      contractNumber: "MC-INT-24",
      contractValidUntil: "2027-01-09T00:00:00.000Z",
      receivables: [],
    });
  });

  it("manages employee access, company requisites and the manager → director → accountant document workflow", async () => {
    const manager = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: contextHeaders,
      payload: { name: "Integration Manager", email: "manager@miracle-chem.test", password: "Manager#2026", role: UserRole.MANAGER },
    });
    expect(manager.statusCode).toBe(201);
    const accountant = await app.inject({
      method: "POST",
      url: "/api/admin/users",
      headers: contextHeaders,
      payload: { name: "Integration Accountant", email: "accountant@miracle-chem.test", password: "Accountant#2026", role: UserRole.ACCOUNTANT },
    });
    expect(accountant.statusCode).toBe(201);
    const managerHeaders = { "x-workspace-id": testIds.workspace, "x-actor-id": manager.json().id as string };
    const accountantHeaders = { "x-workspace-id": testIds.workspace, "x-actor-id": accountant.json().id as string };

    const forbiddenUsers = await app.inject({ method: "GET", url: "/api/admin/users", headers: managerHeaders });
    expect(forbiddenUsers.statusCode).toBe(403);

    const company = await app.inject({
      method: "PUT",
      url: "/api/admin/company-profile",
      headers: contextHeaders,
      payload: {
        legalName: "ТОО Miracle Chem Integration",
        taxId: "900101300000",
        address: "г. Алматы, пр. Тестовый, 1",
        bankName: "Integration Bank",
        iban: "KZ000000000000000000",
        bic: "INTEKZKZ",
        signatoryName: "Айдар Тестов",
      },
    });
    expect(company.statusCode).toBe(200);
    expect(company.json()).toMatchObject({ legalName: "ТОО Miracle Chem Integration", bic: "INTEKZKZ" });

    const created = await app.inject({
      method: "POST",
      url: "/api/accounting",
      headers: { ...managerHeaders, "idempotency-key": "manager-waybill-create" },
      payload: {
        type: AccountingDocumentType.WAYBILL,
        documentAt: new Date().toISOString(),
        customerId: testIds.customer,
        currency: "KZT",
        items: [{ description: "Добавка для бетона", quantity: "3", unit: "KG", unitPrice: "0" }],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ customerId: testIds.customer, counterparty: "ZZZ Integration recipe customer", status: AccountingDocumentStatus.DRAFT });

    const managerList = await app.inject({ method: "GET", url: "/api/accounting?from=2020-01-01&to=2030-01-01", headers: managerHeaders });
    expect(managerList.statusCode).toBe(200);
    expect(managerList.json().items.map((item: { id: string }) => item.id)).toContain(created.json().id);

    const submitted = await app.inject({
      method: "POST",
      url: `/api/accounting/${created.json().id as string}/submit`,
      headers: { ...managerHeaders, "idempotency-key": "manager-waybill-submit" },
    });
    expect(submitted.json().status).toBe(AccountingDocumentStatus.PENDING_DIRECTOR_APPROVAL);
    const directorApproved = await app.inject({
      method: "POST",
      url: `/api/accounting/${created.json().id as string}/approve`,
      headers: { ...contextHeaders, "idempotency-key": "manager-waybill-director-approve" },
    });
    expect(directorApproved.json().status).toBe(AccountingDocumentStatus.PENDING_ACCOUNTANT_APPROVAL);
    const accountantApproved = await app.inject({
      method: "POST",
      url: `/api/accounting/${created.json().id as string}/approve`,
      headers: { ...accountantHeaders, "idempotency-key": "manager-waybill-accountant-approve" },
    });
    expect(accountantApproved.json().status).toBe(AccountingDocumentStatus.ISSUED);

    const printable = await app.inject({ method: "GET", url: `/api/accounting/${created.json().id as string}/pdf`, headers: managerHeaders });
    expect(printable.statusCode).toBe(200);
    expect(printable.rawPayload.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("responds to health and evaluates formulas on the backend", async () => {
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ status: "ok", service: "miracle-chem-api", framework: "nestjs" });

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

    const invalidAdditiveFormula = await app.inject({
      method: "POST",
      url: "/api/formulas",
      headers: contextHeaders,
      payload: {
        code: "TEST-ADDITIVE-INVALID",
        name: "Invalid additive formula",
        description: "Composition must total one hundred percent",
        expression: "binderMass * dosagePercent / 100",
        precision: 6,
        roundingMode: "HALF_UP",
        dosagePercent: "1.2",
        components: [{ materialId: testIds.scarceMaterial, percentage: "90" }],
        publish: true,
      },
    });
    expect(invalidAdditiveFormula.statusCode).toBe(400);
    expect(invalidAdditiveFormula.json().error.code).toBe("INVALID_ADDITIVE_COMPOSITION");

    const additiveFormula = await app.inject({
      method: "POST",
      url: "/api/formulas",
      headers: contextHeaders,
      payload: {
        code: "TEST-ADDITIVE",
        name: "Integration additive",
        description: "Formula with a percentage composition",
        expression: "binderMass * dosagePercent / 100",
        precision: 6,
        roundingMode: "HALF_UP",
        dosagePercent: "1.2",
        components: [{ materialId: testIds.scarceMaterial, percentage: "100" }],
        publish: true,
      },
    });
    expect(additiveFormula.statusCode).toBe(201);
    expect(additiveFormula.json().versions[0]).toMatchObject({
      dosagePercent: "1.2",
      components: [{ materialId: testIds.scarceMaterial, percentage: "100" }],
    });

    const additiveCalculation = await app.inject({
      method: "POST",
      url: "/api/calculator/additive",
      headers: contextHeaders,
      payload: {
        formulaVersionId: additiveFormula.json().versions[0].id,
        binderMass: "100",
        binderMassUnit: "KG",
      },
    });
    expect(additiveCalculation.statusCode).toBe(200);
    expect(additiveCalculation.json()).toMatchObject({
      dosagePercent: "1.2",
      additiveQuantity: "1.2",
      compositionTotalPercent: "100",
      totalCost: "12",
      sufficient: false,
    });
    expect(additiveCalculation.json().components[0]).toMatchObject({
      percentage: "100",
      quantity: "1.2",
      shortage: "0.2",
      sufficient: false,
    });
  });

  it("stores customer concrete compositions and calculates the actual additive dosage", async () => {
    const formula = await app.inject({
      method: "POST",
      url: "/api/formulas",
      headers: contextHeaders,
      payload: {
        code: "TEST-CUSTOMER-ADDITIVE",
        name: "Integration customer additive",
        description: "Formula used in a customer concrete composition",
        expression: "binderMass * dosagePercent / 100",
        precision: 6,
        roundingMode: "HALF_UP",
        dosagePercent: "1.1",
        components: [{ materialId: testIds.scarceMaterial, percentage: "100" }],
        publish: true,
      },
    });
    expect(formula.statusCode).toBe(201);

    const customer = await app.inject({
      method: "POST",
      url: "/api/customers",
      headers: contextHeaders,
      payload: {
        name: "Integration Concrete Plant",
        taxId: "123456789012",
        contactPerson: "Integration Technologist",
      },
    });
    expect(customer.statusCode).toBe(201);
    expect(customer.json()).toMatchObject({ name: "Integration Concrete Plant", concreteRecipes: [] });

    const recipe = await app.inject({
      method: "POST",
      url: `/api/customers/${customer.json().id as string}/recipes`,
      headers: contextHeaders,
      payload: {
        name: "Bridge concrete B35",
        concreteGrade: "B35 P4 F300 W12",
        basisVolume: "1",
        binderMassKg: "400",
        additiveFormulaVersionId: formula.json().versions[0].id,
        additiveDosagePercent: "1.2",
        components: [
          { name: "Cement CEM I", quantity: "400", unit: "KG" },
          { name: "Water", quantity: "165", unit: "KG" },
          { name: "Sand", quantity: "720", unit: "KG" },
        ],
      },
    });
    expect(recipe.statusCode).toBe(201);
    expect(recipe.json()).toMatchObject({
      concreteGrade: "B35 P4 F300 W12",
      additiveDosagePercent: "1.2",
      additiveQuantityKg: "4.8",
      additiveQuantityPerM3Kg: "4.8",
      recommendedDosagePercent: "1.1",
      additiveFormulaVersion: { formula: { name: "Integration customer additive" } },
    });
    expect(recipe.json().components).toHaveLength(3);

    const listing = await app.inject({ method: "GET", url: "/api/customers", headers: contextHeaders });
    expect(listing.statusCode).toBe(200);
    expect(listing.json()).toMatchObject({
      summary: { activeCustomers: 2, concreteRecipes: 1, formulasInUse: 1 },
      items: [
        { name: "Integration Concrete Plant", concreteRecipes: [{ additiveQuantityPerM3Kg: "4.8" }] },
        { id: testIds.customer, name: "ZZZ Integration recipe customer", concreteRecipes: [] },
      ],
    });

    const detail = await app.inject({
      method: "GET",
      url: `/api/customers/${customer.json().id as string}`,
      headers: contextHeaders,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().concreteRecipes[0].components.map((component: { name: string }) => component.name)).toEqual([
      "Cement CEM I",
      "Water",
      "Sand",
    ]);
  });

  it("exposes one production line with one assigned tank", async () => {
    const meta = await app.inject({ method: "GET", url: "/api/meta", headers: contextHeaders });
    expect(meta.statusCode).toBe(200);
    expect(meta.json().productionLines).toHaveLength(1);
    expect(meta.json().productionTanks).toHaveLength(1);
    expect(meta.json().productionTanks[0]).toMatchObject({
      id: testIds.tank,
      productionLineId: testIds.line,
      productionLine: { id: testIds.line },
    });
  });

  it("returns all main warehouse reagents on the dashboard", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/dashboard",
      headers: contextHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().mainReagents).toHaveLength(7);
    expect(response.json().mainReagents.map((material: { name: string }) => material.name)).toEqual([
      "КТ-1",
      "КТ-2",
      "Глюконат Натрия",
      "Пеногаситель (АОС)",
      "Сахар",
      "Соль",
      "ЛСТ",
    ]);
    expect(response.json().mainReagents.every((material: { missing: boolean }) => material.missing)).toBe(true);

    const gluconate = await prisma.material.create({
      data: {
        workspaceId: testIds.workspace,
        code: "SODIUM-GLUCONATE-TEST",
        name: "Глюконат натрия",
        type: MaterialType.REAGENT,
        baseUnit: Unit.KG,
        currentStock: "3000",
        reservedStock: "100",
        minimumStock: "500",
        costPerBaseUnit: "700",
      },
    });
    await prisma.materialLot.createMany({
      data: [
        {
          workspaceId: testIds.workspace,
          materialId: gluconate.id,
          lotNumber: "GLUCONATE-PRICE-600",
          receivedAt: new Date(),
          initialQuantity: "1000",
          availableQuantity: "1000",
          reservedQuantity: "100",
          unit: Unit.KG,
          unitCost: "600",
        },
        {
          workspaceId: testIds.workspace,
          materialId: gluconate.id,
          lotNumber: "GLUCONATE-PRICE-700",
          receivedAt: new Date(),
          initialQuantity: "2000",
          availableQuantity: "2000",
          unit: Unit.KG,
          unitCost: "700",
        },
      ],
    });

    const dashboardWithStock = await app.inject({ method: "GET", url: "/api/dashboard", headers: contextHeaders });
    const dashboardGluconate = dashboardWithStock.json().mainReagents.find(
      (material: { code: string }) => material.code === "SODIUM-GLUCONATE",
    );
    expect(dashboardGluconate).toMatchObject({
      currentStock: "3000",
      reservedStock: "100",
      freeStock: "2900",
      missing: false,
    });

    const warehouse = await app.inject({ method: "GET", url: "/api/materials", headers: contextHeaders });
    expect(warehouse.statusCode).toBe(200);
    expect(warehouse.json().summary.sodiumGluconate).toEqual({
      name: "Глюконат Натрия",
      totalMassKg: "3000",
      freeMassKg: "2900",
      lotCount: 2,
      priceVariants: 2,
    });
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

  it("accepts recipe versions with more than five distinct reagents", async () => {
    await prisma.material.createMany({
      data: Array.from({ length: 6 }, (_, index) => ({
        workspaceId: testIds.workspace,
        code: `TEST-REAGENT-${index + 1}`,
        name: `Integration reagent ${index + 1}`,
        type: MaterialType.REAGENT,
        baseUnit: Unit.KG,
        costPerBaseUnit: "1",
      })),
    });
    const reagents = await prisma.material.findMany({
      where: { workspaceId: testIds.workspace, code: { startsWith: "TEST-REAGENT-" } },
      orderBy: { code: "asc" },
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/recipes",
      headers: contextHeaders,
      payload: {
        code: "TEST-MULTI-REAGENT",
        name: "Integration multi reagent recipe",
        customerId: testIds.customer,
        status: RecipeStatus.ACTIVE,
        version: {
          concreteGrade: "B35",
          baseBatchVolume: "1",
          volumeUnit: Unit.M3,
          plannedYield: "1",
          yieldUnit: Unit.M3,
          technologyInstructions: "Integration test with six reagents",
          publish: true,
          components: reagents.map((material, index) => ({
            materialId: material.id,
            normPerM3: String(index + 1),
            unit: Unit.KG,
            allowedDeviationPercent: "1",
            position: index,
          })),
        },
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().recipe).toMatchObject({ customerId: testIds.customer });
    expect(created.json().version.components).toHaveLength(6);
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
    expect(created.json().productionTankId).toBe(testIds.tank);
    batchId = created.json().id as string;

    const readiness = await app.inject({
      method: "GET",
      url: `/api/batches/${batchId}`,
      headers: contextHeaders,
    });
    expect(readiness.statusCode).toBe(200);
    expect(readiness.json().stockReadiness).toMatchObject({
      status: "SHORTAGE",
      warnings: [expect.objectContaining({
        materialName: "Scarce material",
        level: "SHORTAGE",
        freeStock: "1",
        requiredQuantity: "5",
        projectedStock: "-4",
        shortfall: "4",
      })],
    });

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

    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard", headers: contextHeaders });
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().stockWarnings).toContainEqual(expect.objectContaining({
      name: "Scarce material",
      level: "SHORTAGE",
      plannedDemand: "5",
      projectedStock: "-4",
      shortfall: "4",
    }));
  });

  it("calculates actual batch reagent cost from consumed warehouse lots", async () => {
    const material = await prisma.material.create({
      data: {
        workspaceId: testIds.workspace,
        code: "TEST-ACTUAL-COST",
        name: "Actual cost reagent",
        type: MaterialType.REAGENT,
        baseUnit: Unit.KG,
        currentStock: "10",
        costPerBaseUnit: "999",
      },
    });
    await prisma.materialLot.createMany({
      data: [
        {
          workspaceId: testIds.workspace,
          materialId: material.id,
          lotNumber: "ACTUAL-PRICE-10",
          receivedAt: new Date("2026-08-01T00:00:00.000Z"),
          expiresAt: new Date("2026-09-01T00:00:00.000Z"),
          initialQuantity: "3",
          availableQuantity: "3",
          unit: Unit.KG,
          unitCost: "10",
        },
        {
          workspaceId: testIds.workspace,
          materialId: material.id,
          lotNumber: "ACTUAL-PRICE-20",
          receivedAt: new Date("2026-08-02T00:00:00.000Z"),
          expiresAt: new Date("2026-10-01T00:00:00.000Z"),
          initialQuantity: "7",
          availableQuantity: "7",
          unit: Unit.KG,
          unitCost: "20",
        },
      ],
    });
    const recipe = await prisma.recipe.create({
      data: {
        workspaceId: testIds.workspace,
        customerId: testIds.customer,
        code: "TEST-ACTUAL-COST-RECIPE",
        name: "Actual cost recipe",
        status: RecipeStatus.ACTIVE,
        versions: {
          create: {
            workspaceId: testIds.workspace,
            version: 1,
            concreteGrade: "B30",
            baseBatchVolume: "1",
            volumeUnit: Unit.M3,
            plannedYield: "1",
            yieldUnit: Unit.M3,
            technologyInstructions: "Actual lot cost integration test",
            snapshotHash: "1".repeat(64),
            publishedAt: new Date(),
            components: { create: { materialId: material.id, normPerM3: "5", unit: Unit.KG } },
          },
        },
      },
      include: { versions: true },
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/batches",
      headers: contextHeaders,
      payload: {
        number: "TEST-ACTUAL-COST-BATCH",
        scheduledAt: new Date().toISOString(),
        recipeVersionId: recipe.versions[0]?.id,
        plannedVolume: "1",
        plannedVolumeUnit: Unit.M3,
        operatorId: testIds.actor,
        productionLineId: testIds.line,
        productionTankId: testIds.tank,
      },
    });
    expect(created.statusCode).toBe(201);
    const actualCostBatchId = created.json().id as string;
    expect((await app.inject({
      method: "POST",
      url: `/api/batches/${actualCostBatchId}/start`,
      headers: { ...contextHeaders, "idempotency-key": "actual-cost-start" },
    })).statusCode).toBe(200);
    const component = await prisma.batchComponent.findFirstOrThrow({ where: { batchId: actualCostBatchId } });
    expect((await app.inject({
      method: "POST",
      url: `/api/batches/${actualCostBatchId}/consumption`,
      headers: { ...contextHeaders, "idempotency-key": "actual-cost-consumption" },
      payload: {
        components: [{
          batchComponentId: component.id,
          actualQuantity: "5",
          actualUnit: Unit.KG,
          lossQuantity: "0",
          lossUnit: Unit.KG,
        }],
      },
    })).statusCode).toBe(200);
    const completed = await app.inject({
      method: "POST",
      url: `/api/batches/${actualCostBatchId}/complete`,
      headers: { ...contextHeaders, "idempotency-key": "actual-cost-complete" },
      payload: {
        productLotNumber: "TEST-ACTUAL-COST-PRODUCT",
        actualVolume: "1",
        actualVolumeUnit: Unit.M3,
        actualOutput: "1",
        goodOutput: "1",
        rejectedOutput: "0",
        technologicalLoss: "0",
        outputUnit: Unit.M3,
      },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ totalCost: "70", costPerOutputUnit: "70" });

    const detail = await app.inject({ method: "GET", url: `/api/batches/${actualCostBatchId}`, headers: contextHeaders });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().economics).toMatchObject({
      calculationStatus: "NO_SHIPMENT",
      actualQuantities: [{ value: "5", unit: "KG" }],
      actualMaterialCost: "70",
      actualUnitCost: "70",
    });
    expect(detail.json().economics.components[0]).toMatchObject({
      actualQuantity: "5",
      averageUnitCost: "14",
      actualCost: "70",
      costSource: "WAREHOUSE_LOTS",
    });
    expect(detail.json().economics.components[0].lots).toEqual(expect.arrayContaining([
      expect.objectContaining({ lotNumber: "ACTUAL-PRICE-10", quantity: "3", unitCost: "10", cost: "30" }),
      expect.objectContaining({ lotNumber: "ACTUAL-PRICE-20", quantity: "2", unitCost: "20", cost: "40" }),
    ]));
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
        productionTankId: testIds.tank,
        lockedAt: new Date(),
      },
    });
    profitBatchId = completed.id;
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
        customerId: testIds.customer,
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
    const receiptFile = Buffer.from("%PDF-1.4\n% Miracle Chem Kaspi receipt integration test\n");
    const uploadedReceipt = await supertest(nestApp.getHttpServer())
      .post(`/api/expenses/${expenseId}/receipts`)
      .set(contextHeaders)
      .attach("file", receiptFile, { filename: "kaspi-check.pdf", contentType: "application/pdf" });
    expect(uploadedReceipt.status).toBe(201);
    expect(uploadedReceipt.body).toMatchObject({
      name: "kaspi-check.pdf",
      mimeType: "application/pdf",
      sizeBytes: receiptFile.length,
      expenseId,
    });

    const receiptFileResponse = await supertest(nestApp.getHttpServer())
      .get(`/api/expenses/${expenseId}/receipts/${uploadedReceipt.body.id as string}/file`)
      .set(contextHeaders);
    expect(receiptFileResponse.status).toBe(200);
    expect(receiptFileResponse.headers["content-type"]).toContain("application/pdf");
    expect(Buffer.from(receiptFileResponse.body)).toEqual(receiptFile);

    const rejectedReceipt = await supertest(nestApp.getHttpServer())
      .post(`/api/expenses/${expenseId}/receipts`)
      .set(contextHeaders)
      .attach("file", Buffer.from("not a receipt"), { filename: "kaspi-check.txt", contentType: "text/plain" });
    expect(rejectedReceipt.status).toBe(415);

    const expenseDetail = await app.inject({
      method: "GET",
      url: `/api/expenses/${expenseId}`,
      headers: contextHeaders,
    });
    expect(expenseDetail.statusCode).toBe(200);
    expect(expenseDetail.json().attachments).toHaveLength(1);
    await removeStoredReceipt(uploadedReceipt.body.storageKey as string);

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
    expect(listing.json().items[0].attachments).toHaveLength(1);

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

  it("calculates accounting documents on the server and applies their workflow idempotently", async () => {
    const payload = {
      type: AccountingDocumentType.PAYMENT_INVOICE,
      documentAt: new Date().toISOString(),
      dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      counterparty: "Integration Buyer",
      counterpartyTaxId: "123456789012",
      basis: "Concrete supply integration test",
      vatRate: "12",
      currency: "KZT",
      transferId,
      items: [
        { description: "Concrete B30", quantity: "2", unit: "M3", unitPrice: "100" },
        { description: "Delivery", quantity: "1", unit: "SERVICE", unitPrice: "50" },
      ],
    };
    const createHeaders = { ...contextHeaders, "idempotency-key": "accounting-create-once" };
    const created = await app.inject({ method: "POST", url: "/api/accounting", headers: createHeaders, payload });
    const retried = await app.inject({ method: "POST", url: "/api/accounting", headers: createHeaders, payload });
    expect(created.statusCode).toBe(201);
    expect(retried.json()).toEqual(created.json());
    expect(created.json()).toMatchObject({
      type: AccountingDocumentType.PAYMENT_INVOICE,
      status: AccountingDocumentStatus.DRAFT,
      subtotal: "250",
      vatAmount: "30",
      totalAmount: "280",
    });
    expect(created.json().items).toHaveLength(2);
    expect(await prisma.accountingDocument.count({ where: { workspaceId: testIds.workspace } })).toBeGreaterThanOrEqual(2);

    const documentId = created.json().id as string;
    const invoicePdf = await app.inject({ method: "GET", url: `/api/accounting/${documentId}/pdf`, headers: contextHeaders });
    expect(invoicePdf.statusCode).toBe(200);
    expect(invoicePdf.headers["content-type"]).toContain("application/pdf");
    expect(invoicePdf.headers["content-disposition"]).toContain("payment-invoice");
    expect(invoicePdf.rawPayload.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(invoicePdf.rawPayload.byteLength).toBeGreaterThan(5_000);

    const issueHeaders = { ...contextHeaders, "idempotency-key": "accounting-issue-once" };
    const issued = await app.inject({ method: "POST", url: `/api/accounting/${documentId}/issue`, headers: issueHeaders });
    const issueRetry = await app.inject({ method: "POST", url: `/api/accounting/${documentId}/issue`, headers: issueHeaders });
    expect(issued.statusCode).toBe(200);
    expect(issueRetry.json()).toEqual(issued.json());
    expect(issued.json().status).toBe(AccountingDocumentStatus.ISSUED);

    const batchEconomics = await app.inject({
      method: "GET",
      url: `/api/batches/${profitBatchId}`,
      headers: contextHeaders,
    });
    expect(batchEconomics.statusCode).toBe(200);
    expect(batchEconomics.json().economics).toMatchObject({
      calculationStatus: "CALCULATED",
      shippedQuantity: "3",
      invoicedQuantity: "2",
      invoicedRevenue: "250",
      soldCost: "200",
      grossProfit: "50",
      marginPercent: "20",
    });

    const dashboardWithDebt = await app.inject({ method: "GET", url: "/api/dashboard", headers: contextHeaders });
    expect(dashboardWithDebt.statusCode).toBe(200);
    expect(dashboardWithDebt.json().metrics.dailyRevenue).toContainEqual({ currency: "KZT", amount: "280" });
    expect(dashboardWithDebt.json().metrics.accountsReceivable).toContainEqual({ currency: "KZT", amount: "280" });
    expect(dashboardWithDebt.json().receivables).toContainEqual(expect.objectContaining({
      counterparty: "ZZZ Integration recipe customer",
      amount: "280",
      invoiceCount: 1,
    }));

    const customerWithDebt = await app.inject({ method: "GET", url: `/api/customers/${testIds.customer}`, headers: contextHeaders });
    expect(customerWithDebt.statusCode).toBe(200);
    expect(customerWithDebt.json().timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "TRANSFER", title: "Отгрузка №TEST-LRT-1" }),
      expect.objectContaining({ kind: "DOCUMENT", title: `Счёт на оплату №${created.json().number as string}` }),
      expect.objectContaining({ kind: "DEBT", amount: "280", currency: "KZT" }),
    ]));

    const paid = await app.inject({
      method: "POST",
      url: `/api/accounting/${documentId}/pay`,
      headers: { ...contextHeaders, "idempotency-key": "accounting-pay-once" },
    });
    expect(paid.statusCode).toBe(200);
    expect(paid.json().status).toBe(AccountingDocumentStatus.PAID);

    const dashboardAfterPayment = await app.inject({ method: "GET", url: "/api/dashboard", headers: contextHeaders });
    expect(dashboardAfterPayment.json().metrics.dailyRevenue).toContainEqual({ currency: "KZT", amount: "280" });
    expect(dashboardAfterPayment.json().metrics.accountsReceivable).toEqual([]);
    expect(dashboardAfterPayment.json().receivables).toEqual([]);

    const customerAfterPayment = await app.inject({ method: "GET", url: `/api/customers/${testIds.customer}`, headers: contextHeaders });
    expect(customerAfterPayment.statusCode).toBe(200);
    expect(customerAfterPayment.json().timeline).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "PAYMENT", title: `Оплата по счёту №${created.json().number as string}`, amount: "280" }),
    ]));

    const detail = await app.inject({ method: "GET", url: `/api/accounting/${documentId}`, headers: contextHeaders });
    const listing = await app.inject({ method: "GET", url: "/api/accounting?from=2020-01-01&to=2030-01-01", headers: contextHeaders });
    expect(detail.statusCode).toBe(200);
    expect(listing.statusCode).toBe(200);
    expect(listing.json().summary.totals).toContainEqual({ currency: "KZT", amount: "280" });
  });

  it("creates a goods receipt power of attorney and generates a safe A4 print form", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/accounting",
      headers: { ...contextHeaders, "idempotency-key": "power-of-attorney-create-once" },
      payload: {
        type: AccountingDocumentType.POWER_OF_ATTORNEY,
        documentAt: "2026-08-28T00:00:00.000Z",
        dueAt: "2026-09-07T00:00:00.000Z",
        counterparty: "ТОО Безопасная <поставка>",
        counterpartyTaxId: "123456789012",
        basis: "Договор поставки №42",
        powerOfAttorney: {
          representativeName: "Иванов Иван Иванович",
          representativePosition: "Кладовщик",
          representativeIin: "900101300000",
          identityDocument: "№012345678",
          identityIssuedBy: "МВД РК",
          identityIssuedAt: "2020-04-15T00:00:00.000Z",
        },
        items: [
          { description: "Глюконат натрия", quantity: "250", unit: "KG", unitPrice: "0" },
          { description: "Пеногаситель АОС", quantity: "10", unit: "PCS", unitPrice: "0" },
        ],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      type: AccountingDocumentType.POWER_OF_ATTORNEY,
      status: AccountingDocumentStatus.DRAFT,
      subtotal: "0",
      totalAmount: "0",
      details: { representativeName: "Иванов Иван Иванович", identityDocument: "№012345678" },
    });
    expect(created.json().number).toMatch(/^DOV-20260828-/u);

    const printable = await app.inject({
      method: "GET",
      url: `/api/accounting/${created.json().id}/print`,
      headers: contextHeaders,
    });
    expect(printable.statusCode).toBe(200);
    expect(printable.headers["content-type"]).toContain("text/html");
    expect(printable.headers["content-disposition"]).toContain("power-of-attorney");
    expect(printable.payload).toContain("ДОВЕРЕННОСТЬ");
    expect(printable.payload).toContain("Иванов Иван Иванович");
    expect(printable.payload).toContain("Глюконат натрия");
    expect(printable.payload).toContain("ТОО Безопасная &lt;поставка&gt;");
    expect(printable.payload).not.toContain("ТОО Безопасная <поставка>");

    const pdf = await app.inject({
      method: "GET",
      url: `/api/accounting/${created.json().id as string}/pdf`,
      headers: contextHeaders,
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers["content-disposition"]).toContain("power-of-attorney");
    expect(pdf.rawPayload.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("forms a waybill as a downloadable PDF", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/accounting",
      headers: { ...contextHeaders, "idempotency-key": "waybill-pdf-create-once" },
      payload: {
        type: AccountingDocumentType.WAYBILL,
        documentAt: "2026-08-29T00:00:00.000Z",
        customerId: testIds.customer,
        basis: "Договор поставки № PDF-1",
        currency: "KZT",
        items: [{ description: "Добавка для бетона", quantity: "12.5", unit: "KG", unitPrice: "780" }],
      },
    });
    expect(created.statusCode).toBe(201);
    const printable = await app.inject({
      method: "GET",
      url: `/api/accounting/${created.json().id as string}/pdf`,
      headers: contextHeaders,
    });
    expect(printable.statusCode).toBe(200);
    expect(printable.headers["content-type"]).toContain("application/pdf");
    expect(printable.headers["content-disposition"]).toContain("waybill");
    expect(printable.rawPayload.subarray(0, 5).toString("ascii")).toBe("%PDF-");

    const act = await app.inject({
      method: "POST",
      url: "/api/accounting",
      headers: { ...contextHeaders, "idempotency-key": "completion-act-pdf-create-once" },
      payload: {
        type: AccountingDocumentType.COMPLETION_ACT,
        documentAt: "2026-08-29T00:00:00.000Z",
        customerId: testIds.customer,
        currency: "KZT",
        items: [{ description: "Технологическое сопровождение", quantity: "1", unit: "SERVICE", unitPrice: "10000" }],
      },
    });
    expect(act.statusCode).toBe(201);
    const actPdf = await app.inject({ method: "GET", url: `/api/accounting/${act.json().id as string}/pdf`, headers: contextHeaders });
    expect(actPdf.statusCode).toBe(200);
    expect(actPdf.headers["content-disposition"]).toContain("completion-act");
    expect(actPdf.rawPayload.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("receives a multi-item purchase batch and calculates warehouse production economics", async () => {
    const payload = {
      number: "27-TEST",
      receivedAt: new Date().toISOString(),
      recipeVersionId: testIds.recipeVersion,
      targetSalePrice: "100",
      items: [{
        materialId: testIds.receiptMaterial,
        supplierName: "Integration Supplier",
        quantity: "20",
        unit: Unit.KG,
        unitCost: "13",
      }],
    };
    const headers = { ...contextHeaders, "idempotency-key": "purchase-batch-once" };
    const created = await app.inject({ method: "POST", url: "/api/materials/purchase-batches", headers, payload });
    const retried = await app.inject({ method: "POST", url: "/api/materials/purchase-batches", headers, payload });
    expect(created.statusCode).toBe(201);
    expect(retried.json()).toEqual(created.json());
    expect(await prisma.purchaseBatch.count({ where: { workspaceId: testIds.workspace } })).toBe(1);
    expect(await prisma.materialLot.count({ where: { purchaseBatchId: created.json().purchaseBatchId } })).toBe(1);
    expect(await prisma.materialMovement.count({ where: { workspaceId: testIds.workspace, idempotencyKey: "purchase-batch-once" } })).toBe(1);

    const listing = await app.inject({ method: "GET", url: "/api/materials/purchase-batches", headers: contextHeaders });
    expect(listing.statusCode).toBe(200);
    expect(listing.json().items[0]).toMatchObject({
      number: "27-TEST",
      totalCost: "260",
      forecast: {
        maximumOutput: "0.2",
        costPerM3: "50",
        projectedRevenue: "20",
        projectedProductionCost: "10",
        projectedProfit: "10",
      },
    });
    expect(listing.json().suppliers).toContainEqual(expect.objectContaining({ name: "Integration Supplier" }));
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
    await tx.accountingDocument.deleteMany({ where: { workspaceId } });
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
    await tx.customer.deleteMany({ where: { workspaceId } });
    await tx.formula.deleteMany({ where: { workspaceId } });
    await tx.materialLot.deleteMany({ where: { workspaceId } });
    await tx.purchaseBatch.deleteMany({ where: { workspaceId } });
    await tx.materialPriceHistory.deleteMany({ where: { workspaceId } });
    await tx.material.deleteMany({ where: { workspaceId } });
    await tx.supplier.deleteMany({ where: { workspaceId } });
    await tx.productionTank.deleteMany({ where: { workspaceId } });
    await tx.productionLine.deleteMany({ where: { workspaceId } });
    await tx.auditLog.deleteMany({ where: { workspaceId } });
    await tx.idempotencyRecord.deleteMany({ where: { workspaceId } });
    await tx.user.deleteMany({ where: { workspaceId } });
    await tx.workspace.delete({ where: { id: workspaceId } });
  });
}
