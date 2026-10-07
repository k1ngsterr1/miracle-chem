import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { Unit } from "../generated/prisma/index.js";
import { mapOneCMaterialUnit, plausibleTonneBalance } from "./one-c-material-unit.js";

describe("1C accounting unit mapping", () => {
  it("normalizes only the two audited tonne materials to kilograms", () => {
    expect(mapOneCMaterialUnit({ externalId: "2bd46f6e-ac26-11f1-b015-00155d320501",
      code: "00000000015", unitName: "т" })).toEqual({ baseUnit: Unit.KG, quantityFactor: "1000" });
    expect(mapOneCMaterialUnit({ externalId: "31b148c1-ac26-11f1-b015-00155d320501",
      code: "00000000016", unitName: "т" })).toEqual({ baseUnit: Unit.KG, quantityFactor: "1000" });
    expect(mapOneCMaterialUnit({ externalId: "2BD46F6E-AC26-11F1-B015-00155D320501",
      code: "00000000015", unitName: "Т" })).toEqual({ baseUnit: Unit.KG, quantityFactor: "1000" });
    expect(mapOneCMaterialUnit({ externalId: "2bd46f6e-ac26-11f1-b015-00155d320501",
      code: "WRONG", unitName: "т" })).toBeNull();
    expect(mapOneCMaterialUnit({ externalId: "77777777-7777-4777-8777-777777777773",
      code: "NEW", unitName: "т" })).toBeNull();
  });

  it("keeps ordinary units unchanged", () => {
    expect(mapOneCMaterialUnit({ externalId: "x", code: "x", unitName: "кг" }))
      .toEqual({ baseUnit: Unit.KG, quantityFactor: "1" });
    expect(mapOneCMaterialUnit({ externalId: "x", code: "x", unitName: "усл" })).toBeNull();
  });

  it("permits real depletion at a consistent KG cost but blocks a 1000x scale error", () => {
    expect(plausibleTonneBalance(new Decimal("5500"), new Decimal("443.9655"),
      new Decimal("11"), new Decimal("4883.62"))).toBe(true);
    expect(plausibleTonneBalance(new Decimal("5500"), new Decimal("443.9655"),
      new Decimal("5500000"), new Decimal("2441810.25"))).toBe(false);
    expect(plausibleTonneBalance(new Decimal("0"), new Decimal("0"),
      new Decimal("11"), new Decimal("4883.62"))).toBe(false);
  });
});
