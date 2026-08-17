import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { Unit } from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import { parseBody, positiveDecimalString } from "../lib/validation.js";
import { calculateRecipe } from "../services/calculator-service.js";

const recipeCalculationSchema = z.object({
  recipeVersionId: z.string().uuid(),
  plannedVolume: positiveDecimalString,
  plannedVolumeUnit: z.nativeEnum(Unit),
  calculatedFor: z.coerce.date(),
});

export async function registerCalculatorRoutes(app: FastifyInstance): Promise<void> {
  app.post("/calculator/recipe", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    return calculateRecipe(
      workspaceId,
      parseBody(recipeCalculationSchema, request.body),
    );
  });
}
