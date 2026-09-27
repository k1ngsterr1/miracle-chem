import { describe, expect, it } from "vitest";
import { applySelectedDate } from "./use-date-filter.js";

describe("applySelectedDate", () => {
  it("adds the global working date to operational lists", () => {
    expect(applySelectedDate("/batches", "2026-08-29")).toBe("/batches?date=2026-08-29");
    expect(applySelectedDate("/transfers?status=SENT", "2026-08-29")).toBe("/transfers?status=SENT&date=2026-08-29");
    expect(applySelectedDate("/dashboard/analytics", "2026-08-29")).toBe("/dashboard/analytics?date=2026-08-29");
  });

  it("preserves a manually selected report period", () => {
    expect(applySelectedDate("/reports/production?from=2026-08-01&to=2026-08-31", "2026-08-29"))
      .toBe("/reports/production?from=2026-08-01&to=2026-08-31");
  });

  it("does not add a date to static directories or detail pages", () => {
    expect(applySelectedDate("/materials", "2026-08-29")).toBe("/materials");
    expect(applySelectedDate("/batches/batch-id", "2026-08-29")).toBe("/batches/batch-id");
  });
});
