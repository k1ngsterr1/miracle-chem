import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { RecipeStatus, Unit } from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import { nonNegativeDecimalString, parseBody, positiveDecimalString } from "../lib/validation.js";
import {
  changeRecipeStatus,
  createRecipe,
  createRecipeVersion,
} from "../services/recipe-service.js";

const componentSchema = z.object({
  materialId: z.string().uuid(),
  normPerM3: nonNegativeDecimalString,
  unit: z.nativeEnum(Unit),
  allowedDeviationPercent: nonNegativeDecimalString,
  moisturePercent: nonNegativeDecimalString.optional(),
  absorptionPercent: nonNegativeDecimalString.optional(),
  position: z.number().int().min(0).optional(),
});

const versionSchema = z.object({
  concreteGrade: z.string().trim().min(1).max(80),
  baseBatchVolume: positiveDecimalString,
  volumeUnit: z.nativeEnum(Unit),
  waterCementRatio: positiveDecimalString.optional(),
  plannedYield: positiveDecimalString,
  yieldUnit: z.nativeEnum(Unit),
  technologyInstructions: z.string().trim().min(1),
  components: z.array(componentSchema).min(1).max(100),
  publish: z.boolean().optional(),
  effectiveAt: z.coerce.date().optional(),
});

const createSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(200),
  status: z.nativeEnum(RecipeStatus).optional(),
  version: versionSchema,
});

export async function registerRecipeRoutes(app: FastifyInstance): Promise<void> {
  app.get("/recipes", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    const items = await prisma.recipe.findMany({
      where: { workspaceId },
      include: {
        versions: {
          orderBy: { version: "desc" },
          take: 1,
          include: { components: { include: { material: true }, orderBy: { position: "asc" } } },
        },
      },
      orderBy: [{ status: "asc" }, { name: "asc" }],
    });
    return { items };
  });

  app.get<{ Params: { id: string } }>("/recipes/:id", async (request, reply) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    const recipe = await prisma.recipe.findFirst({
      where: { id: request.params.id, workspaceId },
      include: {
        versions: {
          include: { components: { include: { material: true }, orderBy: { position: "asc" } } },
          orderBy: { version: "desc" },
        },
      },
    });
    if (recipe === null) return reply.status(404).send({ error: { code: "RECIPE_NOT_FOUND" } });
    return recipe;
  });

  app.post("/recipes", async (request, reply) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const result = await createRecipe(workspaceId, actor.id, parseBody(createSchema, request.body));
    return reply.status(201).send(result);
  });

  app.post<{ Params: { id: string } }>("/recipes/:id/versions", async (request, reply) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const result = await createRecipeVersion(
      workspaceId,
      actor.id,
      request.params.id,
      parseBody(versionSchema, request.body),
    );
    return reply.status(201).send(result);
  });

  app.patch<{ Params: { id: string } }>("/recipes/:id/status", async (request) => {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const body = parseBody(z.object({ status: z.nativeEnum(RecipeStatus) }), request.body);
    return changeRecipeStatus(workspaceId, actor.id, request.params.id, body.status);
  });
}
