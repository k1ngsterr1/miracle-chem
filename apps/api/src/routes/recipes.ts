import { Body, Controller, Get, Param, Patch, Post, Req } from "@nestjs/common";
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
import { ApiError } from "../lib/api-error.js";
import type { ApiRequest } from "../lib/http.js";

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

@Controller("recipes")
export class RecipeController {
  @Get()
  async list(@Req() request: ApiRequest) {
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
  }

  @Get(":id")
  async detail(@Req() request: ApiRequest, @Param("id") id: string) {
    const { workspaceId } = await getRequestContext(request, prisma);
    const recipe = await prisma.recipe.findFirst({
      where: { id, workspaceId },
      include: {
        versions: {
          include: { components: { include: { material: true }, orderBy: { position: "asc" } } },
          orderBy: { version: "desc" },
        },
      },
    });
    if (recipe === null) throw new ApiError(404, "RECIPE_NOT_FOUND", "Рецептура не найдена");
    return recipe;
  }

  @Post()
  async create(@Req() request: ApiRequest, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return createRecipe(workspaceId, actor.id, parseBody(createSchema, body));
  }

  @Post(":id/versions")
  async createVersion(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    return createRecipeVersion(
      workspaceId,
      actor.id,
      id,
      parseBody(versionSchema, body),
    );
  }

  @Patch(":id/status")
  async changeStatus(@Req() request: ApiRequest, @Param("id") id: string, @Body() body: unknown) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const input = parseBody(z.object({ status: z.nativeEnum(RecipeStatus) }), body);
    return changeRecipeStatus(workspaceId, actor.id, id, input.status);
  }
}
