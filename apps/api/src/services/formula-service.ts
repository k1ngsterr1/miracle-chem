import { evaluateFormula, parseFormula, collectFormulaVariables } from "@betonflow/domain";
import { AuditEntityType, FormulaRoundingMode, Prisma, Unit } from "../generated/prisma/index.js";
import { Decimal } from "decimal.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/api-error.js";
import { writeAudit } from "../lib/audit.js";

export interface FormulaVersionInput {
  expression: string;
  precision: number;
  roundingMode: FormulaRoundingMode;
  dosagePercent?: string;
  components?: AdditiveFormulaComponentInput[];
  publish?: boolean;
}

export interface AdditiveFormulaComponentInput {
  materialId: string;
  percentage: string;
  position?: number;
}

export interface FormulaInput extends FormulaVersionInput {
  code: string;
  name: string;
  description: string;
}

export interface EvaluateInput {
  expression: string;
  name?: string;
  description?: string;
  version?: number;
  precision: number;
  roundingMode: FormulaRoundingMode;
  variables: Record<string, { value: string; unit?: Unit }>;
}

export async function createFormula(
  workspaceId: string,
  actorId: string,
  input: FormulaInput,
) {
  const variables = [...collectFormulaVariables(parseFormula(input.expression))].sort();
  return prisma.$transaction(async (tx) => {
    await ensureAdditiveRecipe(tx, workspaceId, input);
    const formula = await tx.formula.create({
      data: {
        workspaceId,
        code: input.code,
        name: input.name,
        description: input.description,
        versions: {
          create: {
            workspaceId,
            version: 1,
            expression: input.expression,
            variables,
            precision: input.precision,
            roundingMode: input.roundingMode,
            ...(input.dosagePercent === undefined ? {} : { dosagePercent: input.dosagePercent }),
            ...(input.publish === true ? { publishedAt: new Date() } : {}),
            ...(input.components === undefined ? {} : {
              components: {
                create: input.components.map((component, index) => ({
                  materialId: component.materialId,
                  percentage: component.percentage,
                  position: component.position ?? index,
                })),
              },
            }),
          },
        },
      },
      include: {
        versions: {
          include: {
            components: { include: { material: true }, orderBy: { position: "asc" } },
          },
        },
      },
    });
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: "FORMULA_CREATED",
      entityType: AuditEntityType.FORMULA,
      entityId: formula.id,
      after: {
        code: formula.code,
        expression: input.expression,
        variables,
        dosagePercent: input.dosagePercent ?? null,
        components: (input.components ?? []).map((component) => ({
          materialId: component.materialId,
          percentage: component.percentage,
          position: component.position ?? null,
        })),
      },
    });
    return formula;
  });
}

export async function createFormulaVersion(
  workspaceId: string,
  actorId: string,
  formulaId: string,
  input: FormulaVersionInput,
) {
  const variables = [...collectFormulaVariables(parseFormula(input.expression))].sort();
  return prisma.$transaction(
    async (tx) => {
      const formula = await tx.formula.findFirst({ where: { id: formulaId, workspaceId } });
      if (formula === null) throw new ApiError(404, "FORMULA_NOT_FOUND", "Формула не найдена");
      await ensureAdditiveRecipe(tx, workspaceId, input);
      const latest = await tx.formulaVersion.findFirst({
        where: { formulaId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      const version = await tx.formulaVersion.create({
        data: {
          workspaceId,
          formulaId,
          version: (latest?.version ?? 0) + 1,
          expression: input.expression,
          variables,
          precision: input.precision,
          roundingMode: input.roundingMode,
          ...(input.dosagePercent === undefined ? {} : { dosagePercent: input.dosagePercent }),
          ...(input.publish === true ? { publishedAt: new Date() } : {}),
          ...(input.components === undefined ? {} : {
            components: {
              create: input.components.map((component, index) => ({
                materialId: component.materialId,
                percentage: component.percentage,
                position: component.position ?? index,
              })),
            },
          }),
        },
        include: {
          components: { include: { material: true }, orderBy: { position: "asc" } },
        },
      });
      await writeAudit(tx, {
        workspaceId,
        actorId,
        action: "FORMULA_VERSION_CREATED",
        entityType: AuditEntityType.FORMULA,
        entityId: formulaId,
        after: {
          versionId: version.id,
          version: version.version,
          expression: version.expression,
          dosagePercent: version.dosagePercent,
          components: version.components.map((component) => ({
            materialId: component.materialId,
            percentage: component.percentage.toString(),
          })),
        },
      });
      return version;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function ensureAdditiveRecipe(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  input: FormulaVersionInput,
): Promise<void> {
  if (input.dosagePercent === undefined && input.components === undefined) return;
  if (input.dosagePercent === undefined || input.components === undefined) {
    throw new ApiError(400, "INCOMPLETE_ADDITIVE_FORMULA", "Укажите дозировку и состав формулы добавки");
  }
  const dosagePercent = new Decimal(input.dosagePercent);
  if (dosagePercent.lte(0) || dosagePercent.gt(100)) {
    throw new ApiError(400, "INVALID_ADDITIVE_DOSAGE", "Дозировка добавки должна быть больше 0 и не больше 100%");
  }
  const uniqueIds = [...new Set(input.components.map((component) => component.materialId))];
  if (uniqueIds.length !== input.components.length) {
    throw new ApiError(400, "DUPLICATE_ADDITIVE_COMPONENT", "Материал нельзя добавить в рецептуру формулы дважды");
  }
  const totalPercentage = input.components.reduce(
    (total, component) => total.add(component.percentage),
    new Decimal(0),
  );
  if (!totalPercentage.eq(100)) {
    throw new ApiError(400, "INVALID_ADDITIVE_COMPOSITION", "Сумма долей компонентов должна быть равна 100%");
  }
  const materials = await tx.material.findMany({
    where: { workspaceId, id: { in: uniqueIds }, active: true },
    select: { id: true, baseUnit: true },
  });
  if (materials.length !== uniqueIds.length) {
    throw new ApiError(422, "MATERIAL_NOT_FOUND", "Один или несколько компонентов формулы не найдены на складе");
  }
  const massUnits = new Set<Unit>([Unit.G, Unit.KG, Unit.T]);
  if (materials.some((material) => !massUnits.has(material.baseUnit))) {
    throw new ApiError(422, "ADDITIVE_COMPONENT_UNIT_MISMATCH", "Компоненты формулы добавки должны учитываться по массе");
  }
}

export async function evaluateAndLogFormula(
  workspaceId: string,
  actorId: string,
  input: EvaluateInput,
  formulaVersionId?: string,
  batchId?: string,
) {
  const result = evaluateFormula(
    {
      name: input.name ?? "Предварительный расчёт",
      description: input.description ?? "Проверка формулы",
      version: input.version ?? 1,
      expression: input.expression,
      precision: input.precision,
      roundingMode: input.roundingMode,
    },
    input.variables,
  );
  if (formulaVersionId !== undefined) {
    await prisma.$transaction(async (tx) => {
      const formulaVersion = await tx.formulaVersion.findFirst({
        where: { id: formulaVersionId, workspaceId },
      });
      if (formulaVersion === null) throw new ApiError(404, "FORMULA_NOT_FOUND", "Версия формулы не найдена");
      if (batchId !== undefined) {
        const batch = await tx.productionBatch.findFirst({ where: { id: batchId, workspaceId }, select: { id: true } });
        if (batch === null) throw new ApiError(404, "BATCH_NOT_FOUND", "Замес для расчёта не найден");
      }
      const calculation = await tx.formulaCalculationLog.create({
        data: {
          formulaVersionId,
          ...(batchId === undefined ? {} : { batchId }),
          input: input.variables,
          resultValue: result.value,
          ...(result.unit === null ? {} : { resultUnit: result.unit }),
          trace: result.trace as unknown as Prisma.InputJsonValue,
        },
      });
      await writeAudit(tx, {
        workspaceId,
        actorId,
        action: "FORMULA_CALCULATED",
        entityType: AuditEntityType.FORMULA,
        entityId: formulaVersion.formulaId,
        after: {
          calculationId: calculation.id,
          formulaVersionId,
          batchId: batchId ?? null,
          input: input.variables,
          resultValue: result.value,
          resultUnit: result.unit,
          trace: result.trace as unknown as Prisma.InputJsonValue,
        },
      });
    });
  }
  return result;
}
