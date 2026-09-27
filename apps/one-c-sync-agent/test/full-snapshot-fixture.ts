import type { OneCFullSnapshotEnvelope } from "../src/types.js";
import { ids } from "./bkz-fixtures.js";

export function sampleFullSnapshot(): OneCFullSnapshotEnvelope {
  const generatedAt = "2026-09-26T08:00:00Z";
  return {
    kind: "FULL_SNAPSHOT", source: "1C", workspaceId: ids.workspace,
    sourceInstanceId: ids.workspace, organizationExternalId: ids.organization,
    batchId: "1c-full-snapshot-001", generatedAt,
    snapshot: {
      schemaVersion: 1, source: "1C", configuration: "БухгалтерияДляКазахстана",
      configurationVersion: "3.0.74.2", consistency: "SEQUENTIAL_READ_ONLY_NOT_ACCOUNTING_CLOSE",
      readStartedAt: "2026-09-26T07:59:00Z", generatedAt,
      organizations: [{ externalId: ids.organization, code: "1", name: "Test" }],
      counterparties: [], materials: [], receipts: [], balances: [], accountingInventory: [],
      receivables: [{ organizationId: ids.organization, counterpartyId: ids.partner,
        contractId: ids.document, amountDebit: "3575000", amountCredit: "0" }],
      sales: [], saleLines: [], invoices: [], invoiceLines: [],
      incomingPayments: [{ externalId: ids.document, amount: "150000" }],
      outgoingPayments: [{ externalId: ids.nextDocument, amount: "40000" }],
    },
  };
}
