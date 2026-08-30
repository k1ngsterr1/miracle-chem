import { describe, expect, it } from "vitest";
import { formatKzPhone, formatMetric, formatNumber, normalizeKzPhone, unitLabel } from "./format.js";

describe("format helpers", () => {
  it("renders Decimal strings without exposing storage precision", () => {
    expect(formatNumber("1250.500000")).toContain("1");
    expect(formatNumber("1250.500000")).toContain("250,5");
  });

  it("keeps units next to grouped quantities", () => {
    expect(
      formatMetric([
        { value: "1000", unit: "KG" },
        { value: "2.5", unit: "M3" },
      ]),
    ).toContain(`2,5 ${unitLabel.M3}`);
  });

  it("formats Kazakhstan phone numbers while accepting typing and paste variants", () => {
    expect(formatKzPhone("7001234567")).toBe("+7 (700) 123-45-67");
    expect(formatKzPhone("+7 700 123 45 67")).toBe("+7 (700) 123-45-67");
    expect(formatKzPhone("87001234567")).toBe("+7 (700) 123-45-67");
    expect(formatKzPhone("70")).toBe("+7 (70");
    expect(normalizeKzPhone("+7 (700) 123-45-67")).toBe("+77001234567");
  });
});
