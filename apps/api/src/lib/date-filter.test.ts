import { describe, expect, it } from "vitest";
import { ApiError } from "./api-error.js";
import { dayPeriodFromQuery } from "./date-filter.js";

describe("dayPeriodFromQuery", () => {
  it("creates the full Almaty production day", () => {
    const period = dayPeriodFromQuery("2026-08-29");
    expect(period?.from.toISOString()).toBe("2026-08-28T19:00:00.000Z");
    expect(period?.to.toISOString()).toBe("2026-08-29T18:59:59.999Z");
  });

  it("leaves the default period untouched when no date was selected", () => {
    expect(dayPeriodFromQuery(undefined)).toBeUndefined();
  });

  it("rejects an invalid calendar value", () => {
    expect(() => dayPeriodFromQuery("29.08.2026")).toThrow(ApiError);
  });
});
