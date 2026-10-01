import { describe, expect, it } from "vitest";
import { applySelectedDate } from "./use-date-filter.js";

describe("applySelectedDate", () => {
  it("adds the global working date to operational lists", () => {
    expect(applySelectedDate("/batches", "2026-08-29")).toBe("/batches?date=2026-08-29");
    expect(applySelectedDate("/transfers?status=SENT", "2026-08-29")).toBe("/transfers?status=SENT&date=2026-08-29");
    expect(applySelectedDate("/dashboard/analytics", "2026-08-29")).toBe("/dashboard/analytics?date=2026-08-29");
    expect(applySelectedDate("/historical-workbooks/production", "2026-08-29"))
      .toBe("/historical-workbooks/production?date=2026-08-29");
  });

  it("preserves a manually selected report period", () => {
    expect(applySelectedDate("/reports/production?from=2026-08-01&to=2026-08-31", "2026-08-29"))
      .toBe("/reports/production?from=2026-08-01&to=2026-08-31");
  });

  it("removes the working-day filter across operational lists in all-dates mode", () => {
    expect(applySelectedDate("/batches", "2026-08-29", true)).toBe("/batches");
    expect(applySelectedDate("/historical-workbooks/production", "2026-08-29", true))
      .toBe("/historical-workbooks/production");
    expect(applySelectedDate("/transfers?status=SENT", "2026-08-29", true)).toBe("/transfers?status=SENT");
    expect(applySelectedDate("/recipes?date=2026-08-29", "2026-08-29", true)).toBe("/recipes");
    expect(applySelectedDate("/materials/purchase-batches", "2026-08-29", true)).toBe("/materials/purchase-batches");
    expect(applySelectedDate("/dashboard?analytics=false", "2026-08-29", true)).toBe("/dashboard?analytics=false&allDates=true");
    expect(applySelectedDate("/reports/production?from=2026-08-01&to=2026-08-31", "2026-08-29", true))
      .toBe("/reports/production?from=2026-08-01&to=2026-08-31");
  });

  it("does not add a date to static directories or detail pages", () => {
    expect(applySelectedDate("/materials", "2026-08-29")).toBe("/materials");
    expect(applySelectedDate("/batches/batch-id", "2026-08-29")).toBe("/batches/batch-id");
  });
});
