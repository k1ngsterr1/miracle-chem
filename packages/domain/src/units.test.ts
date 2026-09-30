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

  it("keeps item quantities separate from mass and volume", () => {
    expect(convertQuantity({ value: "12", unit: "PCS" }, "PCS").value.toString()).toBe("12");
    expect(() => convertQuantity({ value: "1", unit: "PCS" }, "KG", "1000")).toThrow(
      "Нельзя пересчитать PCS → KG",
    );
  });

  it("preserves meters and pairs without inventing cross-dimensional conversions", () => {
    expect(addQuantities({ value: "2.5", unit: "M" }, { value: "3", unit: "M" }).value.toString()).toBe("5.5");
    expect(convertQuantity({ value: "12", unit: "PAIR" }, "PAIR").value.toString()).toBe("12");
    for (const [from, to] of [["M", "KG"], ["KG", "M"], ["M", "L"], ["L", "M"],
      ["PAIR", "PCS"], ["PCS", "PAIR"], ["PAIR", "KG"]] as const) {
      expect(() => convertQuantity({ value: "1", unit: from }, to, "1000")).toThrow(`Нельзя пересчитать ${from} → ${to}`);
    }
  });
});
