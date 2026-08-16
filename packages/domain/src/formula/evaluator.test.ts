import { describe, expect, it } from "vitest";
import { DomainError, evaluateFormula, parseFormula } from "../index.js";

const definition = (expression: string) => ({
  name: "Тестовая формула",
  description: "Проверка безопасного вычислителя",
  version: 1,
  expression,
  precision: 3,
  roundingMode: "HALF_UP" as const,
});

describe("safe formula engine", () => {
  it("evaluates precedence, parentheses and percentages", () => {
    const result = evaluateFormula(definition("(norm * volume) * (1 + reserve%)"), {
      norm: { value: "320", unit: "KG" },
      volume: { value: "2.5" },
      reserve: { value: "1.5" },
    });
    expect(result.value).toBe("812.000");
    expect(result.unit).toBe("KG");
    expect(result.usedVariables).toEqual(["norm", "reserve", "volume"]);
    expect(result.trace.length).toBeGreaterThan(3);
  });

  it("supports min, max, round and conditional expressions", () => {
    const result = evaluateFormula(
      definition("actual > limit ? max(round(actual, 1), minimum) : minimum"),
      {
        actual: { value: "13.26", unit: "KG" },
        limit: { value: "10", unit: "KG" },
        minimum: { value: "12", unit: "KG" },
      },
    );
    expect(result.value).toBe("13.300");
    expect(result.unit).toBe("KG");
  });

  it("converts compatible and density-dependent units", () => {
    expect(
      evaluateFormula(definition('convert(cement, "kg", "t")'), {
        cement: { value: "1250", unit: "KG" },
      }).value,
    ).toBe("1.250");
    expect(
      evaluateFormula(definition('convert(volume, "m3", "kg", density)'), {
        volume: { value: "1.25", unit: "M3" },
        density: { value: "2400" },
      }).value,
    ).toBe("3000.000");
  });

  it("rejects missing values and division by zero with domain errors", () => {
    expect(() => evaluateFormula(definition("water / cement"), { water: { value: 100 } })).toThrow(
      "Не заданы переменные: cement",
    );
    expect(() =>
      evaluateFormula(definition("water / cement"), {
        water: { value: 100, unit: "KG" },
        cement: { value: 0, unit: "KG" },
      }),
    ).toThrow("Деление на ноль запрещено");
  });

  it("never accepts executable JavaScript syntax", () => {
    expect(() => parseFormula("globalThis.process.exit()"))
      .toThrowError(DomainError);
    expect(() => parseFormula("constructor.constructor('return 1')()"))
      .toThrowError(DomainError);
  });
});

