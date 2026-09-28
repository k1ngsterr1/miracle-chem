import { describe, expect, it } from "vitest";
import { fullSnapshotSchema } from "./one-c-full-snapshot-service.js";

const id = "00000000-0000-0000-0000-000000000001";
const base = {
  schemaVersion: 1,
  source: "1C",
  configuration: "БухгалтерияДляКазахстана",
  configurationVersion: "3.0.74.2",
  consistency: "SEQUENTIAL_READ_ONLY_NOT_ACCOUNTING_CLOSE",
  readStartedAt: "2026-09-28T08:30:00Z",
  generatedAt: "2026-09-28T08:30:35Z",
  organizations: [], counterparties: [], materials: [], receipts: [], balances: [],
  accountingInventory: [], receivables: [], sales: [], saleLines: [], invoices: [],
  invoiceLines: [], incomingPayments: [], outgoingPayments: [],
};

describe("expanded 1C source snapshot", () => {
  it("retains production and contract data, including a genuinely empty contract date", () => {
    const parsed = fullSnapshotSchema.shape.snapshot.parse({
      ...base,
      contracts: [{ externalId: id, code: "1", name: "Договор", counterpartyId: id,
        organizationId: id, contractNumber: "1", contractAt: null, deleted: false }],
      productionReports: [{ externalId: id, number: "1", documentAt: "2026-09-28T08:30:00",
        organizationId: id, warehouseId: id, posted: true, deleted: false }],
    });
    expect(parsed.contracts?.[0]?.contractAt).toBeNull();
    expect(parsed.productionReports).toHaveLength(1);
  });

  it("rejects malformed extended collections", () => {
    expect(fullSnapshotSchema.shape.snapshot.safeParse({ ...base, contracts: "missing" }).success).toBe(false);
    expect(fullSnapshotSchema.shape.snapshot.safeParse({ ...base,
      productionReports: [{ externalId: "bad" }] }).success).toBe(false);
  });
});
