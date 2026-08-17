import {
  convertQuantity,
  plannedComponentQuantity,
  recipeScaleFactor,
} from "@betonflow/domain";
import { Decimal } from "decimal.js";
import type { Unit } from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { ApiError } from "../lib/api-error.js";

export interface RecipeCalculationInput {
  recipeVersionId: string;
  plannedVolume: string;
  plannedVolumeUnit: Unit;
  calculatedFor: Date;
}

export async function calculateRecipe(
  workspaceId: string,
  input: RecipeCalculationInput,
) {
  const version = await prisma.recipeVersion.findFirst({
    where: { id: input.recipeVersionId, workspaceId },
    include: {
      recipe: true,
      components: {
        include: { material: true },
        orderBy: { position: "asc" },
      },
    },
  });
  if (version === null) {
    throw new ApiError(404, "RECIPE_VERSION_NOT_FOUND", "Версия рецептуры не найдена");
  }

  const volumeM3 = convertQuantity(
    { value: input.plannedVolume, unit: input.plannedVolumeUnit },
    "M3",
  ).value;
  const baseVolumeM3 = convertQuantity(
    { value: version.baseBatchVolume.toString(), unit: version.volumeUnit },
    "M3",
  ).value;
  const scaleFactor = recipeScaleFactor(volumeM3, baseVolumeM3);
  const plannedOutput = new Decimal(version.plannedYield.toString()).mul(scaleFactor);
  let totalCost = new Decimal(0);

  const components = version.components.map((component) => {
    const inRecipeUnit = plannedComponentQuantity(component.normPerM3.toString(), volumeM3);
    const normalized = convertQuantity(
      { value: inRecipeUnit, unit: component.unit },
      component.material.baseUnit,
      component.material.densityKgPerM3?.toString(),
    ).value;
    const unitCost = new Decimal(component.material.costPerBaseUnit.toString());
    const componentCost = normalized.mul(unitCost);
    const freeStock = Decimal.max(
      0,
      new Decimal(component.material.currentStock.toString()).sub(
        component.material.reservedStock.toString(),
      ),
    );
    const shortage = Decimal.max(0, normalized.sub(freeStock));
    totalCost = totalCost.add(componentCost);
    return {
      materialId: component.material.id,
      code: component.material.code,
      name: component.material.name,
      quantity: normalized.toDecimalPlaces(6).toString(),
      unit: component.material.baseUnit,
      normPerM3: component.normPerM3.toString(),
      recipeUnit: component.unit,
      unitCost: unitCost.toDecimalPlaces(4).toString(),
      componentCost: componentCost.toDecimalPlaces(4).toString(),
      freeStock: freeStock.toDecimalPlaces(6).toString(),
      shortage: shortage.toDecimalPlaces(6).toString(),
      sufficient: shortage.isZero(),
    };
  });

  return {
    calculatedFor: input.calculatedFor.toISOString(),
    recipe: {
      id: version.recipe.id,
      code: version.recipe.code,
      name: version.recipe.name,
      versionId: version.id,
      version: version.version,
      concreteGrade: version.concreteGrade,
    },
    plannedVolume: volumeM3.toDecimalPlaces(6).toString(),
    plannedVolumeUnit: "M3" as const,
    plannedOutput: plannedOutput.toDecimalPlaces(6).toString(),
    plannedOutputUnit: version.yieldUnit,
    totalCost: totalCost.toDecimalPlaces(4).toString(),
    costPerM3: totalCost.div(volumeM3).toDecimalPlaces(4).toString(),
    costPerOutputUnit: totalCost.div(plannedOutput).toDecimalPlaces(4).toString(),
    currency: version.components[0]?.material.currency ?? "KZT",
    sufficient: components.every((component) => component.sufficient),
    components,
  };
}
