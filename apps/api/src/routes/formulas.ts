import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { FormulaRoundingMode, Unit } from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import { decimalString, parseBody, positiveDecimalString } from "../lib/validation.js";
import {
  createFormula,
  createFormulaVersion,
  evaluateAndLogFormula,
} from "../services/formula-service.js";
import { ApiError } from "../lib/api-error.js";
import type { ApiRequest } from "../lib/http.js";

const additiveComponentSchema = z.object({
  materialId: z.string().uuid(),
  percentage: positiveDecimalString,
  position: z.number().int().min(0).optional(),
});

const versionFields = {
  expression: z.string().trim().min(1).max(4096),
  precision: z.number().int().min(0).max(12),
  roundingMode: z.nativeEnum(FormulaRoundingMode),
  dosagePercent: positiveDecimalString.optional(),
  components: z.array(additiveComponentSchema).min(1).max(250).optional(),
  publish: z.boolean().optional(),
};

function validateAdditiveRecipe(
  value: { dosagePercent?: string; components?: unknown[] },
  context: z.RefinementCtx,
): void {
  if ((value.dosagePercent === undefined) !== (value.components === undefined)) {
    context.addIssue({
      code: "custom",
      path: value.dosagePercent === undefined ? ["dosagePercent"] : ["components"],
      message: "Для формулы добавки укажите дозировку и состав рецептуры",
    });
  }
}

const versionSchema = z.object(versionFields).superRefine(validateAdditiveRecipe);

const createSchema = z.object({
  code: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
  ...versionFields,
}).superRefine(validateAdditiveRecipe);

const evaluateSchema = z.object({
  expression: z.string().trim().min(1).max(4096).optional(),
  precision: z.number().int().min(0).max(12).optional(),
  roundingMode: z.nativeEnum(FormulaRoundingMode).optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  version: z.number().int().positive().optional(),
  formulaVersionId: z.string().uuid().optional(),
  batchId: z.string().uuid().optional(),
  variables: z.record(
    z.string(),
    z.object({ value: decimalString, unit: z.nativeEnum(Unit).optional() }),
  ),
}).superRefine((value, context) => {
  if (value.formulaVersionId === undefined && value.expression === undefined) {
    context.addIssue({ code: "custom", path: ["expression"], message: "Укажите выражение или версию формулы" });
  }
});

@Controller("formulas")
export class FormulaController {
  @Get()
  async list(@Req() request: ApiRequest) {
    const { workspaceId } = await getRequestContext(request, prisma);
    return {
      items: await prisma.formula.findMany({
        where: { workspaceId },
        include: {
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            include: {
              components: {
                include: { material: true },
                orderBy: { position: "asc" },
              },
            },
          },
        },
        orderBy: { name: "asc" },
      }),
    };
  }

  @Post()
  async create(@Req() request: ApiRequest, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return createFormula(workspaceId, actor.id, parseBody(createSchema, body));
  }

  @Post(":id/versions")
  async createVersion(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return createFormulaVersion(
      workspaceId,
      actor.id,
      id,
      parseBody(versionSchema, body),
    );
  }

  @Post("evaluate")
  @HttpCode(HttpStatus.OK)
  async evaluate(@Req() request: ApiRequest, @Body() requestBody: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const body = parseBody(evaluateSchema, requestBody);
    if (body.formulaVersionId !== undefined) {
      const stored = await prisma.formulaVersion.findFirst({
        where: { id: body.formulaVersionId, workspaceId },
        include: { formula: true },
      });
      if (stored === null) throw new ApiError(404, "FORMULA_NOT_FOUND", "Версия формулы не найдена");
      return evaluateAndLogFormula(
        workspaceId,
        actor.id,
        {
          expression: stored.expression,
          name: stored.formula.name,
          description: stored.formula.description,
          version: stored.version,
          precision: stored.precision,
          roundingMode: stored.roundingMode,
          variables: body.variables,
        },
        stored.id,
        body.batchId,
      );
    }
    return evaluateAndLogFormula(workspaceId, actor.id, {
      expression: body.expression ?? "",
      name: body.name,
      description: body.description,
      version: body.version,
      precision: body.precision ?? 3,
      roundingMode: body.roundingMode ?? FormulaRoundingMode.HALF_UP,
      variables: body.variables,
    });
  }
}
