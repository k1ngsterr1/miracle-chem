import { Decimal } from "decimal.js";
import { OneCSyncEntityType } from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { fullSnapshotSchema } from "./one-c-full-snapshot-service.js";

export async function loadOneCFinance(workspaceId: string) {
  const projected = await prisma.oneCSyncRun.findFirst({ where: { workspaceId, source: "1C_FULL_SNAPSHOT",
    summary: { path: ["appliedToOperationalTables"], equals: true } },
    orderBy: [{ generatedAt: "desc" }, { completedAt: "desc" }], select: { summary: true } });
  const snapshotId = (projected?.summary as Record<string, unknown> | null)?.snapshotId;
  if (typeof snapshotId !== "string") return null;
  const saved = await prisma.oneCSourceSnapshot.findFirst({ where: { id: snapshotId, workspaceId },
    select: { sourceInstanceId: true, organizationExternalId: true, generatedAt: true, payload: true } });
  if (!saved) return null;
  const parsed = fullSnapshotSchema.shape.snapshot.safeParse(saved.payload);
  if (!parsed.success) return null;
  const snapshot = parsed.data;
  const refs = await prisma.oneCExternalReference.findMany({ where: { workspaceId, source: "1C",
    entityType: OneCSyncEntityType.CUSTOMER, externalId: { startsWith: `${saved.sourceInstanceId}:` } },
    select: { externalId: true, internalId: true } });
  const customerIds = new Map(refs.map((ref) => [ref.externalId.slice(saved.sourceInstanceId.length + 1), ref.internalId]));
  const counterparties = new Map(snapshot.counterparties.map((row) => [row.externalId, row]));
  const invoices = new Map<string, number>();
  for (const row of snapshot.invoices) {
    if (row.organizationId !== saved.organizationExternalId || row.deleted) continue;
    invoices.set(row.counterpartyId, (invoices.get(row.counterpartyId) ?? 0) + 1);
  }
  const latestDocuments = new Map<string, Date>();
  for (const row of [...snapshot.sales, ...snapshot.invoices]) {
    if (row.organizationId !== saved.organizationExternalId || row.deleted) continue;
    const date = new Date(`${row.documentAt}+05:00`);
    if (!Number.isNaN(date.getTime()) && date > (latestDocuments.get(row.counterpartyId) ?? new Date(0))) {
      latestDocuments.set(row.counterpartyId, date);
    }
  }
  const balances = new Map<string, Decimal>();
  const advances = new Map<string, Decimal>();
  for (const row of snapshot.receivables) {
    if (row.organizationId !== saved.organizationExternalId) continue;
    const net = new Decimal(row.amountDebit).sub(row.amountCredit);
    if (net.isPositive()) balances.set(row.counterpartyId, (balances.get(row.counterpartyId) ?? new Decimal(0)).add(net));
    if (net.isNegative()) advances.set(row.counterpartyId, (advances.get(row.counterpartyId) ?? new Decimal(0)).add(net.abs()));
  }
  const receivables = [...balances].map(([counterpartyId, amount]) => {
    const partner = counterparties.get(counterpartyId);
    return { counterpartyExternalId: counterpartyId, customerId: customerIds.get(counterpartyId) ?? null,
      counterparty: partner?.name ?? "Контрагент 1С", counterpartyTaxId: partner?.taxId || null,
      currency: "KZT", amount: amount.toString(), overdueAmount: "0",
      invoiceCount: invoices.get(counterpartyId) ?? 0, linkedShipmentCount: 0,
      lastDocumentAt: (latestDocuments.get(counterpartyId) ?? saved.generatedAt).toISOString(), nearestDueAt: null };
  }).sort((a, b) => new Decimal(b.amount).comparedTo(a.amount));
  const payments = (direction: "INCOMING" | "OUTGOING") =>
    (direction === "INCOMING" ? snapshot.incomingPayments : snapshot.outgoingPayments)
      .filter((row) => row.organizationId === saved.organizationExternalId)
      .map((row) => ({ externalId: row.externalId, number: row.number,
        documentAt: new Date(`${row.documentAt}+05:00`).toISOString(),
        counterparty: counterparties.get(row.counterpartyId)?.name ?? "Контрагент 1С",
        customerId: customerIds.get(row.counterpartyId) ?? null,
        amount: row.amount, currency: row.currencyName, purpose: row.purpose,
        posted: row.posted, deleted: row.deleted, direction }))
      .sort((a, b) => b.documentAt.localeCompare(a.documentAt));
  const sales = snapshot.sales.filter((row) => row.organizationId === saved.organizationExternalId && row.posted && !row.deleted)
    .map((row) => ({ amount: row.amount, documentAt: new Date(`${row.documentAt}+05:00`).toISOString() }));
  const totalReceivables = receivables.reduce((sum, row) => sum.add(row.amount), new Decimal(0));
  const totalPrepayments = [...advances.values()].reduce((sum, amount) => sum.add(amount), new Decimal(0));
  return { source: "1C" as const, snapshotAt: saved.generatedAt.toISOString(),
    receivables, totalReceivables: totalReceivables.toString(), totalPrepayments: totalPrepayments.toString(),
    incomingPayments: payments("INCOMING"), outgoingPayments: payments("OUTGOING"), sales };
}

export async function getOneCFinance(workspaceId: string) {
  const finance = await loadOneCFinance(workspaceId);
  if (!finance) return { available: false as const };
  const received = finance.incomingPayments.filter((row) => row.posted && !row.deleted)
    .reduce((sum, row) => sum.add(row.amount), new Decimal(0));
  const paid = finance.outgoingPayments.filter((row) => row.posted && !row.deleted)
    .reduce((sum, row) => sum.add(row.amount), new Decimal(0));
  return { available: true as const, source: finance.source, snapshotAt: finance.snapshotAt,
    totalReceivables: finance.totalReceivables, totalPrepayments: finance.totalPrepayments,
    receivedPayments: received.toString(), paidPayments: paid.toString(),
    receivables: finance.receivables, incomingPayments: finance.incomingPayments,
    outgoingPayments: finance.outgoingPayments };
}
