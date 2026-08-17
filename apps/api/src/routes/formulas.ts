import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { FormulaRoundingMode, Unit } from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import { decimalString, parseBody } from "../lib/validation.js";
import {
  createFormula,
  createFormulaVersion,
  evaluateAndLogFormula,
} from "../services/formula-service.js";
import { ApiError } from "../lib/api-error.js";

const versionSchema = z.object({
  expression: z.string().trim().min(1).max(4096),
  precision: z.number().int().min(0).max(12),
  roundingMode: z.nativeEnum(FormulaRoundingMode),
  publish: z.boolean().optional(),
});

const createSchema = versionSchema.extend({
  code: z.string().trim().min(1).max(60),
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(2000),
});

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

export async function registerFormulaRoutes(app: FastifyInstance): Promise<void> {
  app.get("/formulas", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    return {
      items: await prisma.formula.findMany({
        where: { workspaceId },
        include: { versions: { orderBy: { version: "desc" }, take: 1 } },
        orderBy: { name: "asc" },
      }),
    };
  });

  app.post("/formulas", async (request, reply) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const result = await createFormula(workspaceId, actor.id, parseBody(createSchema, request.body));
    return reply.status(201).send(result);
  });

  app.post<{ Params: { id: string } }>("/formulas/:id/versions", async (request, reply) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const result = await createFormulaVersion(
      workspaceId,
      actor.id,
      request.params.id,
      parseBody(versionSchema, request.body),
    );
    return reply.status(201).send(result);
  });

  app.post("/formulas/evaluate", async (request) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const body = parseBody(evaluateSchema, request.body);
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
  });
}
