import { describe, expect, it } from "vitest";
import { DomainError, addQuantities, convertQuantity } from "./index.js";

describe("unit conversion", () => {
  it("converts mass units without losing decimal precision", () => {
    expect(convertQuantity({ value: "1250000", unit: "G" }, "T").value.toString()).toBe("1.25");
  });

  it("converts volume and mass only with density", () => {
    expect(convertQuantity({ value: "1.5", unit: "M3" }, "KG", "2400").value.toString()).toBe("3600");
    expect(() => convertQuantity({ value: "1", unit: "M3" }, "KG")).toThrowError(DomainError);
  });

  it("normalizes units before addition", () => {
    const result = addQuantities(
      { value: "500", unit: "KG" },
      { value: "0.25", unit: "T" },
    );
    expect(result.value.toString()).toBe("750");
    expect(result.unit).toBe("KG");
  });

  it("rejects zero density", () => {
    expect(() => convertQuantity({ value: "1", unit: "M3" }, "KG", 0)).toThrow(
      "Плотность должна быть положительным числом",
    );
  });
});

