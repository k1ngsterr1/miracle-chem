import { describe, expect, it } from "vitest";
import { oneCDocumentStatus, sourceDecimal, sourceMoney, sumSourceDecimals } from "./use-one-c-source.js";

describe("1C read-only record formatting", () => {
  it("keeps all source decimal places and sums amounts without floating-point rounding", () => {
    expect(sourceDecimal("1.2345670")).toBe("1,234567");
    expect(sumSourceDecimals(["0.10", "0.20", "1000000000000000.01"])).toBe("1000000000000000.31");
    expect(sumSourceDecimals(["1.25", "-0.50"])).toBe("0.75");
    expect(sourceMoney("1234.5600", "тенге")).toContain("1 234,56 ₸");
  });

  it("does not turn an unposted or deleted source document into a completed CRM operation", () => {
    expect(oneCDocumentStatus(true, false)).toBe("Проведён");
    expect(oneCDocumentStatus(false, false)).toBe("Не проведён");
    expect(oneCDocumentStatus(true, true)).toBe("Помечен на удаление");
  });
});
