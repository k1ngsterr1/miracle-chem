import { describe, expect, it } from "vitest";
import {
  availableProduct,
  batchCost,
  deviation,
  dryAggregateMass,
  plannedComponentQuantity,
  productionLoss,
  recipeScaleFactor,
  waterCementRatio,
  waterInAggregate,
  waterToAdd,
} from "./index.js";

describe("production calculations", () => {
  it("calculates planned quantity and recipe scaling", () => {
    expect(plannedComponentQuantity("320", "7.5").toString()).toBe("2400");
    expect(recipeScaleFactor("7.5", "1").toString()).toBe("7.5");
  });

  it("calculates W/C and moisture correction", () => {
    expect(waterCementRatio("180", "400").toString()).toBe("0.45");
    const aggregateWater = waterInAggregate("900", "4");
    expect(aggregateWater.toString()).toBe("36");
    expect(waterToAdd("180", [aggregateWater, "9"]).toString()).toBe("135");
    expect(dryAggregateMass("1040", "4").toString()).toBe("1000");
  });

  it("calculates deviations and production losses", () => {
    const actualDeviation = deviation("102", "100");
    expect(actualDeviation.absolute.toString()).toBe("2");
    expect(actualDeviation.percent.toString()).toBe("2");
    const loss = productionLoss("2400", "2352");
    expect(loss.absolute.toString()).toBe("48");
    expect(loss.percent.toString()).toBe("2");
  });

  it("calculates available product and rejects overdraw", () => {
    expect(availableProduct("20", "7", "1", "2", "0.5").toString()).toBe("10.5");
    expect(() => availableProduct("10", "11", 0, 0)).toThrow(
      "Движения продукта превышают произведённое количество",
    );
  });

  it("calculates batch and unit cost", () => {
    const result = batchCost(
      [
        { actualQuantity: "100", unitCost: "50.25" },
        { actualQuantity: "200", unitCost: "2.125" },
      ],
      "5",
    );
    expect(result.total.toString()).toBe("5450");
    expect(result.perProductUnit.toString()).toBe("1090");
  });
});

