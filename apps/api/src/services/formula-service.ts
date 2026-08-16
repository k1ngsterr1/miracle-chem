import { evaluateFormula, parseFormula, collectFormulaVariables } from "@betonflow/domain";
import { AuditEntityType, FormulaRoundingMode, Prisma, type Unit } from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/api-error.js";
import { writeAudit } from "../lib/audit.js";

export interface FormulaVersionInput {
  expression: string;
  precision: number;
  roundingMode: FormulaRoundingMode;
  publish?: boolean;
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
            ...(input.publish === true ? { publishedAt: new Date() } : {}),
          },
        },
      },
      include: { versions: true },
    });
    await writeAudit(tx, {
      workspaceId,
      actorId,
      action: "FORMULA_CREATED",
      entityType: AuditEntityType.FORMULA,
      entityId: formula.id,
      after: { code: formula.code, expression: input.expression, variables },
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
          ...(input.publish === true ? { publishedAt: new Date() } : {}),
        },
      });
      await writeAudit(tx, {
        workspaceId,
        actorId,
        action: "FORMULA_VERSION_CREATED",
        entityType: AuditEntityType.FORMULA,
        entityId: formulaId,
        after: { versionId: version.id, version: version.version, expression: version.expression },
      });
      return version;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
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
