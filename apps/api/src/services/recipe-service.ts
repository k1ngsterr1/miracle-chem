import { createHash } from "node:crypto";
import { AuditEntityType, Prisma, RecipeStatus, type Unit } from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/api-error.js";
import { writeAudit } from "../lib/audit.js";

export interface RecipeComponentInput {
  materialId: string;
  normPerM3: string;
  unit: Unit;
  allowedDeviationPercent: string;
  moisturePercent?: string;
  absorptionPercent?: string;
  position?: number;
}

export interface RecipeVersionInput {
  concreteGrade: string;
  baseBatchVolume: string;
  volumeUnit: Unit;
  waterCementRatio?: string;
  plannedYield: string;
  yieldUnit: Unit;
  technologyInstructions: string;
  components: RecipeComponentInput[];
  publish?: boolean;
  effectiveAt?: Date;
}

export interface CreateRecipeInput {
  code: string;
  name: string;
  customerId: string;
  status?: RecipeStatus;
  version: RecipeVersionInput;
}

export async function createRecipe(
  workspaceId: string,
  actorId: string,
  input: CreateRecipeInput,
) {
  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { id: input.customerId, workspaceId, active: true },
      select: { id: true },
    });
    if (customer === null) throw new ApiError(422, "CUSTOMER_NOT_FOUND", "Активный клиент не найден");
    await ensureMaterials(tx, workspaceId, input.version.components);
    const recipe = await tx.recipe.create({
      data: {
        workspaceId,
        customerId: customer.id,
        code: input.code,
        name: input.name,
        status: input.status ?? RecipeStatus.DRAFT,
      },
    });
    const version = await createVersionRecord(tx, workspaceId, recipe.id, 1, input.version);
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: "RECIPE_CREATED",
      entityType: AuditEntityType.RECIPE,
      entityId: recipe.id,
      after: {
        code: recipe.code,
        name: recipe.name,
        customerId: customer.id,
        status: recipe.status,
        versionId: version.id,
      },
    });
    return { recipe, version };
  });
}

export async function createRecipeVersion(
  workspaceId: string,
  actorId: string,
  recipeId: string,
  input: RecipeVersionInput,
) {
  return prisma.$transaction(
    async (tx) => {
      const recipe = await tx.recipe.findFirst({ where: { id: recipeId, workspaceId } });
      if (recipe === null) throw new ApiError(404, "RECIPE_NOT_FOUND", "Рецептура не найдена");
      await ensureMaterials(tx, workspaceId, input.components);
      const latest = await tx.recipeVersion.findFirst({
        where: { recipeId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const version = await createVersionRecord(
        tx,
        workspaceId,
        recipeId,
        (latest?.version ?? 0) + 1,
        input,
      );
      await writeAudit(tx, {
        workspaceId,
        actorId,
        action: "RECIPE_VERSION_CREATED",
        entityType: AuditEntityType.RECIPE_VERSION,
        entityId: version.id,
        after: { recipeId, version: version.version, snapshotHash: version.snapshotHash },
      });
      return version;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function changeRecipeStatus(
  workspaceId: string,
  actorId: string,
  recipeId: string,
  status: RecipeStatus,
) {
  return prisma.$transaction(async (tx) => {
    const before = await tx.recipe.findFirst({ where: { id: recipeId, workspaceId } });
    if (before === null) throw new ApiError(404, "RECIPE_NOT_FOUND", "Рецептура не найдена");
    if (status === RecipeStatus.ACTIVE) {
      const version = await tx.recipeVersion.findFirst({ where: { recipeId } });
      if (version === null) {
        throw new ApiError(422, "RECIPE_HAS_NO_VERSION", "Нельзя активировать рецептуру без версии");
      }
    }
    const recipe = await tx.recipe.update({ where: { id: recipeId }, data: { status } });
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: "RECIPE_STATUS_CHANGED",
      entityType: AuditEntityType.RECIPE,
      entityId: recipeId,
      before: { status: before.status },
      after: { status },
    });
    return recipe;
  });
}

async function createVersionRecord(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  recipeId: string,
  version: number,
  input: RecipeVersionInput,
) {
  const snapshot = {
    recipeId,
    version,
    concreteGrade: input.concreteGrade,
    baseBatchVolume: input.baseBatchVolume,
    volumeUnit: input.volumeUnit,
    waterCementRatio: input.waterCementRatio ?? null,
    plannedYield: input.plannedYield,
    yieldUnit: input.yieldUnit,
    technologyInstructions: input.technologyInstructions,
    components: [...input.components].sort((left, right) =>
      left.materialId.localeCompare(right.materialId),
    ),
  };
  const snapshotHash = createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
  return tx.recipeVersion.create({
    data: {
      workspaceId,
      recipeId,
      version,
      concreteGrade: input.concreteGrade,
      baseBatchVolume: input.baseBatchVolume,
      volumeUnit: input.volumeUnit,
      ...(input.waterCementRatio === undefined ? {} : { waterCementRatio: input.waterCementRatio }),
      plannedYield: input.plannedYield,
      yieldUnit: input.yieldUnit,
      technologyInstructions: input.technologyInstructions,
      snapshotHash,
      ...(input.publish === true ? { publishedAt: input.effectiveAt ?? new Date() } : {}),
      components: {
        create: input.components.map((component, index) => ({
          materialId: component.materialId,
          normPerM3: component.normPerM3,
          unit: component.unit,
          allowedDeviationPercent: component.allowedDeviationPercent,
          moisturePercent: component.moisturePercent ?? "0",
          absorptionPercent: component.absorptionPercent ?? "0",
          position: component.position ?? index,
        })),
      },
    },
    include: { components: { include: { material: true }, orderBy: { position: "asc" } } },
  });
}

async function ensureMaterials(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  components: RecipeComponentInput[],
): Promise<void> {
  const uniqueIds = [...new Set(components.map((component) => component.materialId))];
  if (uniqueIds.length !== components.length) {
    throw new ApiError(400, "DUPLICATE_RECIPE_COMPONENT", "Материал нельзя добавить в версию рецептуры дважды");
  }
  const count = await tx.material.count({ where: { workspaceId, id: { in: uniqueIds }, active: true } });
  if (count !== uniqueIds.length) {
    throw new ApiError(422, "MATERIAL_NOT_FOUND", "Один или несколько материалов рецептуры не найдены");
  }
}
