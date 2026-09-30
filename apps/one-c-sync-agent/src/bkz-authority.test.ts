import { describe, expect, it } from "vitest";
import { proposeBkzAuthorityMapping } from "./bkz-authority.js";
import { ids, sampleReceipt, sampleSnapshot } from "../test/bkz-fixtures.js";

const options = { workspaceId: ids.workspace, organizationId: ids.organization,
  sourceInstanceId: ids.nextDocument, approvedBy: "Test reviewer",
  approvedAt: "2026-09-26T00:00:00Z", sourceUtcOffset: "+05:00" };

describe("1C authoritative catalog proposal", () => {
  it("keeps 1C codes, classifies source groups, and derives dual roles from documents", () => {
    const snapshot = sampleSnapshot();
    snapshot.materials[0]!.groupName = "Материалы";
    snapshot.materials[0]!.unitName = "кг";
    snapshot.counterparties[0]!.groupName = "Поставщики - основные ";
    snapshot.receipts = [sampleReceipt()];
    snapshot.invoices = [{ organizationId: ids.organization, counterpartyId: ids.partner }];
    snapshot.materials.push({ externalId: ids.nextDocument, code: "FINISHED", name: "Готовая добавка",
      groupName: "Готовая продукция", unitId: ids.unit, unitName: "кг", service: false, deleted: false });
    const result = proposeBkzAuthorityMapping(snapshot, options);
    expect(result.mapping.materials.map((item) => [item.code, item.type])).toEqual([
      ["SOURCE-DIFFERENT-CODE", "REAGENT"], ["FINISHED", "CHEMICAL_ADDITIVE"],
    ]);
    expect(result.mapping.counterparties).toEqual([{ externalId: ids.partner, roles: ["customer", "supplier"] }]);
    expect(result.unclassifiedCounterparties).toEqual([]);
  });

  it("refuses a new stock group rather than guessing its production meaning", () => {
    const snapshot = sampleSnapshot(); snapshot.materials[0]!.groupName = "Неизвестная группа";
    snapshot.materials[0]!.unitName = "кг";
    expect(() => proposeBkzAuthorityMapping(snapshot, options)).toThrow("Новая группа");
  });

  it.each([["м", "M"], ["пар", "PAIR"], ["шт", "PCS"]])("preserves root-level inventory in %s", (unitName, baseUnit) => {
    const snapshot = sampleSnapshot();
    snapshot.materials[0]!.groupName = null;
    snapshot.materials[0]!.unitName = unitName;
    expect(proposeBkzAuthorityMapping(snapshot, options).mapping.materials[0]).toMatchObject({ type: "OTHER", baseUnit });
  });
});
