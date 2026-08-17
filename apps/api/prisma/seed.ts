import { createHash } from "node:crypto";
import { Decimal } from "decimal.js";
import {
  FormulaRoundingMode,
  MaterialType,
  RecipeStatus,
  Unit,
  UserRole,
  WagonStatus,
} from "../src/generated/prisma/index.js";
import { prisma } from "../src/lib/prisma.js";
import { DEFAULT_ACTOR_ID, DEFAULT_WORKSPACE_ID } from "../src/config.js";
import {
  completeBatch,
  confirmBatchConsumption,
  createBatch,
  startBatch,
} from "../src/services/batch-service.js";

const ids = {
  operator: "11111111-1111-4111-8111-111111111113",
  technologist: "11111111-1111-4111-8111-111111111114",
  lrt: "11111111-1111-4111-8111-111111111115",
  line: "22222222-2222-4222-8222-222222222221",
  supplier: "33333333-3333-4333-8333-333333333331",
  cement: "44444444-4444-4444-8444-444444444441",
  water: "44444444-4444-4444-8444-444444444442",
  sand: "44444444-4444-4444-8444-444444444443",
  aggregate: "44444444-4444-4444-8444-444444444444",
  additive: "44444444-4444-4444-8444-444444444445",
  recipe: "55555555-5555-4555-8555-555555555551",
  recipeVersion: "55555555-5555-4555-8555-555555555552",
  wagonOne: "66666666-6666-4666-8666-666666666661",
  wagonTwo: "66666666-6666-4666-8666-666666666662",
  wagonThree: "66666666-6666-4666-8666-666666666663",
} as const;

async function main(): Promise<void> {
  await prisma.workspace.upsert({
    where: { id: DEFAULT_WORKSPACE_ID },
    create: {
      id: DEFAULT_WORKSPACE_ID,
      name: "Miracle Chem Plant",
      timezone: "Asia/Almaty",
      currency: "KZT",
    },
    update: { name: "Miracle Chem Plant" },
  });

  await Promise.all([
    upsertUser(DEFAULT_ACTOR_ID, "Алишер Махмутов", "admin@miracle-chem.local", UserRole.ADMIN),
    upsertUser(ids.operator, "Руслан Ермеков", "operator@miracle-chem.local", UserRole.OPERATOR),
    upsertUser(ids.technologist, "Алия Садыкова", "technologist@miracle-chem.local", UserRole.TECHNOLOGIST),
    upsertUser(ids.lrt, "Данияр Омаров", "lrt@miracle-chem.local", UserRole.LRT_RECEIVER),
  ]);

  await prisma.productionLine.upsert({
    where: { id: ids.line },
    create: {
      id: ids.line,
      workspaceId: DEFAULT_WORKSPACE_ID,
      code: "BSU-01",
      name: "БСУ №1",
      capacity: "60",
      capacityUnit: Unit.M3,
    },
    update: { active: true },
  });
  await prisma.supplier.upsert({
    where: { id: ids.supplier },
    create: {
      id: ids.supplier,
      workspaceId: DEFAULT_WORKSPACE_ID,
      name: "ТОО Цемент Снаб",
      taxId: "120940012345",
      contact: "+7 727 000 00 00",
    },
    update: { active: true },
  });

  await seedMaterial({
    id: ids.cement,
    code: "CEM-I-42.5",
    name: "Цемент ПЦ 500 Д0",
    type: MaterialType.CEMENT,
    unit: Unit.KG,
    density: "1400",
    cost: "68.50",
    minimum: "8000",
    lot: "CEM-1608-01",
    quantity: "50000",
    expiresInDays: 120,
  });
  await seedMaterial({
    id: ids.water,
    code: "WATER-TECH",
    name: "Вода техническая",
    type: MaterialType.WATER,
    unit: Unit.L,
    density: "1000",
    cost: "0.45",
    minimum: "5000",
    lot: "WTR-1608",
    quantity: "80000",
    expiresInDays: 365,
  });
  await seedMaterial({
    id: ids.sand,
    code: "SAND-M2",
    name: "Песок мытый Мк 2.0",
    type: MaterialType.SAND,
    unit: Unit.KG,
    density: "1600",
    cost: "8.20",
    minimum: "12000",
    lot: "SND-1508-04",
    quantity: "90000",
    expiresInDays: 365,
  });
  await seedMaterial({
    id: ids.aggregate,
    code: "AGG-5-20",
    name: "Щебень фракция 5–20",
    type: MaterialType.AGGREGATE,
    unit: Unit.KG,
    density: "1500",
    cost: "11.40",
    minimum: "15000",
    lot: "AGG-1408-02",
    quantity: "120000",
    expiresInDays: 365,
  });
  await seedMaterial({
    id: ids.additive,
    code: "PLAST-P10",
    name: "Пластификатор P10",
    type: MaterialType.CHEMICAL_ADDITIVE,
    unit: Unit.KG,
    density: "1080",
    cost: "1240",
    minimum: "200",
    lot: "P10-0826-11",
    quantity: "1500",
    expiresInDays: 180,
  });

  await seedRecipe();
  await seedFormulas();
  await seedBatches();
  await seedWagons();
}

async function upsertUser(id: string, name: string, email: string, role: UserRole) {
  return prisma.user.upsert({
    where: { id },
    create: { id, workspaceId: DEFAULT_WORKSPACE_ID, name, email, role },
    update: { name, role, active: true },
  });
}

interface SeedMaterialInput {
  id: string;
  code: string;
  name: string;
  type: MaterialType;
  unit: Unit;
  density: string;
  cost: string;
  minimum: string;
  lot: string;
  quantity: string;
  expiresInDays: number;
}

async function seedMaterial(input: SeedMaterialInput): Promise<void> {
  const material = await prisma.material.upsert({
    where: { id: input.id },
    create: {
      id: input.id,
      workspaceId: DEFAULT_WORKSPACE_ID,
      code: input.code,
      name: input.name,
      type: input.type,
      baseUnit: input.unit,
      densityKgPerM3: input.density,
      costPerBaseUnit: input.cost,
      minimumStock: input.minimum,
    },
    update: { name: input.name, active: true },
  });
  const existingLot = await prisma.materialLot.findUnique({
    where: {
      workspaceId_materialId_lotNumber: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        materialId: material.id,
        lotNumber: input.lot,
      },
    },
  });
  if ((await prisma.materialPriceHistory.count({ where: { materialId: material.id } })) === 0) {
    await prisma.materialPriceHistory.create({
      data: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        materialId: material.id,
        pricePerBaseUnit: input.cost,
        effectiveAt: new Date(),
        source: "SEED",
        note: `Начальная цена ${input.code}`,
      },
    });
  }
  if (existingLot !== null) return;
  const receivedAt = new Date();
  receivedAt.setHours(7, 30, 0, 0);
  const expiresAt = new Date(receivedAt.getTime() + input.expiresInDays * 24 * 60 * 60 * 1000);
  await prisma.$transaction(async (tx) => {
    await tx.materialLot.create({
      data: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        materialId: material.id,
        supplierId: ids.supplier,
        lotNumber: input.lot,
        receivedAt,
        expiresAt,
        certificateNumber: `QC-${input.lot}`,
        certificateUrl: `https://example.local/certificates/${input.lot}.pdf`,
        initialQuantity: input.quantity,
        availableQuantity: input.quantity,
        unit: input.unit,
        unitCost: input.cost,
        densityKgPerM3: input.density,
        qualitySnapshot: { status: "PASSED", laboratory: "Plant QC" },
      },
    });
    await tx.material.update({
      where: { id: material.id },
      data: { currentStock: { increment: input.quantity } },
    });
  });
}

async function seedWagons(): Promise<void> {
  const now = new Date();
  const wagons = [
    {
      id: ids.wagonOne,
      number: "61245873",
      type: "Полувагон",
      capacity: "70",
      status: WagonStatus.IN_TRANSIT,
      location: "Перегон Алматы-1 — Бурундай",
      cargoDescription: "Минеральный наполнитель",
      cargoQuantity: "64.5",
      shipmentNumber: "OTG-20260817-101",
      note: "Отправлен со станции Алматы-1",
    },
    {
      id: ids.wagonTwo,
      number: "52680194",
      type: "Хоппер",
      capacity: "68",
      status: WagonStatus.UNLOADING,
      location: "Склад Miracle Chem · путь №2",
      cargoDescription: "Цемент навалом",
      cargoQuantity: "58.2",
      shipmentNumber: "OTG-20260817-102",
      note: "Вагон под выгрузкой",
    },
    {
      id: ids.wagonThree,
      number: "73419026",
      type: "Крытый вагон",
      capacity: "66",
      status: WagonStatus.EMPTY,
      location: "Станция Алматы-1 · накопительный путь",
      cargoDescription: null,
      cargoQuantity: "0",
      shipmentNumber: null,
      note: "Порожний, ожидает назначение",
    },
  ];

  for (const input of wagons) {
    const wagon = await prisma.wagon.upsert({
      where: { id: input.id },
      create: {
        id: input.id,
        workspaceId: DEFAULT_WORKSPACE_ID,
        number: input.number,
        type: input.type,
        capacity: input.capacity,
        capacityUnit: Unit.T,
        tareWeightT: "24",
        status: input.status,
        currentLocation: input.location,
        cargoDescription: input.cargoDescription,
        cargoQuantity: input.cargoQuantity,
        cargoUnit: Unit.T,
        shipmentNumber: input.shipmentNumber,
        lastReportedAt: now,
      },
      update: {
        type: input.type,
        active: true,
      },
    });
    if ((await prisma.wagonLocationEvent.count({ where: { wagonId: wagon.id } })) === 0) {
      await prisma.wagonLocationEvent.create({
        data: {
          workspaceId: DEFAULT_WORKSPACE_ID,
          wagonId: wagon.id,
          actorId: DEFAULT_ACTOR_ID,
          status: input.status,
          location: input.location,
          cargoDescription: input.cargoDescription,
          cargoQuantity: input.cargoQuantity,
          cargoUnit: Unit.T,
          shipmentNumber: input.shipmentNumber,
          occurredAt: now,
          note: input.note,
        },
      });
    }
  }
}

async function seedRecipe(): Promise<void> {
  await prisma.recipe.upsert({
    where: { id: ids.recipe },
    create: {
      id: ids.recipe,
      workspaceId: DEFAULT_WORKSPACE_ID,
      code: "B30-P4-F200",
      name: "Бетон B30 П4 F200 W8",
      status: RecipeStatus.ACTIVE,
    },
    update: { status: RecipeStatus.ACTIVE },
  });
  const existing = await prisma.recipeVersion.findUnique({ where: { id: ids.recipeVersion } });
  if (existing !== null) return;
  const components = [
    { materialId: ids.cement, normPerM3: "390", unit: Unit.KG, deviation: "2", moisture: "0", absorption: "0" },
    { materialId: ids.water, normPerM3: "175", unit: Unit.L, deviation: "2", moisture: "0", absorption: "0" },
    { materialId: ids.sand, normPerM3: "760", unit: Unit.KG, deviation: "3", moisture: "4.2", absorption: "1.1" },
    { materialId: ids.aggregate, normPerM3: "1080", unit: Unit.KG, deviation: "3", moisture: "1.3", absorption: "0.8" },
    { materialId: ids.additive, normPerM3: "4.8", unit: Unit.KG, deviation: "1.5", moisture: "0", absorption: "0" },
  ];
  const snapshotHash = createHash("sha256").update(JSON.stringify(components)).digest("hex");
  await prisma.recipeVersion.create({
    data: {
      id: ids.recipeVersion,
      workspaceId: DEFAULT_WORKSPACE_ID,
      recipeId: ids.recipe,
      version: 1,
      concreteGrade: "B30 П4 F200 W8",
      baseBatchVolume: "1",
      volumeUnit: Unit.M3,
      waterCementRatio: "0.449",
      plannedYield: "1",
      yieldUnit: Unit.M3,
      technologyInstructions:
        "Загрузить заполнители, добавить 70% воды, цемент, остаток воды и P10. Перемешивать не менее 45 секунд.",
      snapshotHash,
      publishedAt: new Date(),
      components: {
        create: components.map((component, position) => ({
          materialId: component.materialId,
          normPerM3: component.normPerM3,
          unit: component.unit,
          allowedDeviationPercent: component.deviation,
          moisturePercent: component.moisture,
          absorptionPercent: component.absorption,
          position,
        })),
      },
    },
  });
}

async function seedFormulas(): Promise<void> {
  const formulas = [
    ["PLAN_COMPONENT", "Плановый расход компонента", "normPerM3 * plannedVolumeM3", 3],
    ["WATER_CEMENT", "Водоцементное отношение", "waterMass / cementMass", 4],
    ["WATER_CORRECTION", "Коррекция воды", "max(0, recipeWater - aggregateWater)", 3],
    ["DEVIATION", "Отклонение расхода, %", "(actual - planned) / planned * 100", 2],
    ["UNIT_COST", "Себестоимость единицы", "batchCost / actualOutput", 2],
  ] as const;
  for (const [code, name, expression, precision] of formulas) {
    await prisma.formula.upsert({
      where: { workspaceId_code: { workspaceId: DEFAULT_WORKSPACE_ID, code } },
      create: {
        workspaceId: DEFAULT_WORKSPACE_ID,
        code,
        name,
        description: name,
        versions: {
          create: {
            workspaceId: DEFAULT_WORKSPACE_ID,
            version: 1,
            expression,
            variables: expression.match(/[A-Za-z_][A-Za-z0-9_]*/gu) ?? [],
            precision,
            roundingMode: FormulaRoundingMode.HALF_UP,
            publishedAt: new Date(),
          },
        },
      },
      update: { active: true },
    });
  }
}

async function seedBatches(): Promise<void> {
  const today = new Date();
  today.setMinutes(0, 0, 0);
  const completedNumber = `ZM-${today.toISOString().slice(0, 10).replaceAll("-", "")}-001`;
  let completed = await prisma.productionBatch.findFirst({
    where: { workspaceId: DEFAULT_WORKSPACE_ID, number: completedNumber },
    include: { components: true },
  });
  if (completed === null) {
    completed = await createBatch(DEFAULT_WORKSPACE_ID, DEFAULT_ACTOR_ID, {
      number: completedNumber,
      scheduledAt: new Date(today.getTime() - 4 * 60 * 60 * 1000),
      recipeVersionId: ids.recipeVersion,
      plannedVolume: "5",
      plannedVolumeUnit: Unit.M3,
      operatorId: ids.operator,
      productionLineId: ids.line,
      comments: "Демонстрационный завершённый замес",
    });
    await startBatch(DEFAULT_WORKSPACE_ID, DEFAULT_ACTOR_ID, completed.id, `seed-start-${completed.id}`);
    const refreshed = await prisma.productionBatch.findUniqueOrThrow({
      where: { id: completed.id },
      include: { components: true },
    });
    await confirmBatchConsumption(
      DEFAULT_WORKSPACE_ID,
      DEFAULT_ACTOR_ID,
      completed.id,
      `seed-consumption-${completed.id}`,
      {
        components: refreshed.components.map((component, index) => ({
          batchComponentId: component.id,
          actualQuantity: new Decimal(component.plannedQuantity.toString())
            .mul(index % 2 === 0 ? "1.01" : "0.99")
            .toString(),
          actualUnit: component.actualUnit,
          lossQuantity: index === 3 ? "8" : "0",
          lossUnit: component.lossUnit,
        })),
      },
    );
    await completeBatch(
      DEFAULT_WORKSPACE_ID,
      DEFAULT_ACTOR_ID,
      completed.id,
      `seed-complete-${completed.id}`,
      {
        productLotNumber: `LOT-${completedNumber}`,
        actualVolume: "5",
        actualVolumeUnit: Unit.M3,
        actualOutput: "5",
        goodOutput: "4.9",
        rejectedOutput: "0.1",
        technologicalLoss: "0.05",
        outputUnit: Unit.M3,
        densityKgPerM3: "2410",
        qualitySummary: { slumpMm: 180, temperatureC: 19.5, status: "PASSED" },
      },
    );
  }

  const activeNumber = `ZM-${today.toISOString().slice(0, 10).replaceAll("-", "")}-002`;
  const active = await prisma.productionBatch.findFirst({
    where: { workspaceId: DEFAULT_WORKSPACE_ID, number: activeNumber },
  });
  if (active === null) {
    const created = await createBatch(DEFAULT_WORKSPACE_ID, DEFAULT_ACTOR_ID, {
      number: activeNumber,
      scheduledAt: today,
      recipeVersionId: ids.recipeVersion,
      plannedVolume: "3",
      plannedVolumeUnit: Unit.M3,
      operatorId: ids.operator,
      productionLineId: ids.line,
      comments: "Активный замес для демонстрации",
    });
    await startBatch(DEFAULT_WORKSPACE_ID, DEFAULT_ACTOR_ID, created.id, `seed-start-${created.id}`);
  }

  const plannedNumber = `ZM-${today.toISOString().slice(0, 10).replaceAll("-", "")}-003`;
  const planned = await prisma.productionBatch.findFirst({
    where: { workspaceId: DEFAULT_WORKSPACE_ID, number: plannedNumber },
  });
  if (planned === null) {
    await createBatch(DEFAULT_WORKSPACE_ID, DEFAULT_ACTOR_ID, {
      number: plannedNumber,
      scheduledAt: new Date(today.getTime() + 2 * 60 * 60 * 1000),
      recipeVersionId: ids.recipeVersion,
      plannedVolume: "7.5",
      plannedVolumeUnit: Unit.M3,
      operatorId: ids.operator,
      productionLineId: ids.line,
      comments: "Следующий замес в плане",
    });
  }
}

await main();
await prisma.$disconnect();
