import { describe, expect, it } from "vitest";
import { formatMetric, formatNumber, unitLabel } from "./format.js";

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
});

