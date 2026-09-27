import { parseBkzMapping, parseBkzSnapshot, type BkzMapping, type BkzSnapshot } from "../src/bkz-adapter.js";
export const ids = { workspace: "11111111-1111-4111-8111-111111111111", organization: "22222222-2222-4222-8222-222222222222", material: "33333333-3333-4333-8333-333333333333", unit: "44444444-4444-4444-8444-444444444444", partner: "55555555-5555-4555-8555-555555555555", document: "66666666-6666-4666-8666-666666666666", nextDocument: "77777777-7777-4777-8777-777777777777" };
export function sampleMapping(): BkzMapping {
  return parseBkzMapping({ version: 1, workspaceId: ids.workspace, sourceInstanceId: ids.workspace, organizationId: ids.organization, approvedBy: "Test operator", approvedAt: "2026-09-26T00:00:00Z", sourceUtcOffset: "+05:00", currency: "KZT", materials: [{ externalId: ids.material, code: "TEST-REAGENT", type: "REAGENT", baseUnit: "KG", sourceBaseUnitId: ids.unit, receiptUnits: [{ externalId: ids.unit, coefficient: "1" }] }], counterparties: [{ externalId: ids.partner, roles: ["customer", "supplier"] }] });
}
export function sampleReceipt() {
  return { documentId: ids.document, organizationId: ids.organization, lineNumber: 1, number: "TEST-001", posted: true, deleted: false, materialId: ids.material, supplierId: ids.partner, unitId: ids.unit, coefficient: "1", quantity: "10", amount: "1120", vatAmount: "120", amountIncludesVat: true, vatInCost: false, currencyName: "KZT", exchangeRate: "1", exchangeMultiplicity: "1", receivedAt: "2026-09-26T08:00:00" };
}
export function sampleSnapshot(): BkzSnapshot {
  return parseBkzSnapshot({ schemaVersion: 1, configuration: "БухгалтерияДляКазахстана", generatedAt: "2026-09-26T06:00:00Z", organizations: [{ externalId: ids.organization }], counterparties: [{ externalId: ids.partner, name: "Тестовый контрагент", taxId: "", deleted: false }], materials: [{ externalId: ids.material, name: "Тестовый реагент", code: "SOURCE-DIFFERENT-CODE", unitId: ids.unit, deleted: false, service: false }], receipts: [] });
}
