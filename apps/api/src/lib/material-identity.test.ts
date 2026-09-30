import { describe, expect, it } from "vitest";
import { matchesMaterial, SODIUM_GLUCONATE } from "./material-identity.js";

describe("sodium gluconate display identity", () => {
  it.each(["Глюконат натрия", "Глюканат натрия", "Sodium gluconate"])(
    "recognizes %s without requiring a CRM-specific code", (name) => {
      expect(matchesMaterial({ code: "00000000011", name }, SODIUM_GLUCONATE)).toBe(true);
    },
  );

  it("does not include unrelated sodium reagents", () => {
    expect(matchesMaterial({ code: "SALT", name: "Хлорид натрия" }, SODIUM_GLUCONATE)).toBe(false);
  });
});
