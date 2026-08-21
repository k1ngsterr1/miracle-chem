import { Body, Controller, HttpCode, HttpStatus, Post, Req } from "@nestjs/common";
import { z } from "zod";
import { Unit } from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import { parseBody, positiveDecimalString } from "../lib/validation.js";
import { calculateRecipe } from "../services/calculator-service.js";
import type { ApiRequest } from "../lib/http.js";

const recipeCalculationSchema = z.object({
  recipeVersionId: z.string().uuid(),
  plannedVolume: positiveDecimalString,
  plannedVolumeUnit: z.nativeEnum(Unit),
  calculatedFor: z.coerce.date(),
});

@Controller("calculator")
export class CalculatorController {
  @Post("recipe")
  @HttpCode(HttpStatus.OK)
  async calculateRecipe(@Req() request: ApiRequest, @Body() body: unknown) {
    const { workspaceId } = await getRequestContext(request, prisma);
    return calculateRecipe(
      workspaceId,
      parseBody(recipeCalculationSchema, body),
    );
  }
}
