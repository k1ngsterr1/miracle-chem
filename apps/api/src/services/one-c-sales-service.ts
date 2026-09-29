import { AccountingDocumentStatus, AccountingDocumentType, LrtTransferStatus } from "../generated/prisma/index.js";
import { dayPeriodFromQuery, startOfAlmatyDay } from "../lib/date-filter.js";
import { prisma } from "../lib/prisma.js";
import { saleMatchesTransfer } from "./one-c-sale-matching.js";

const matchableTransferStatuses = [
  LrtTransferStatus.SENT,
  LrtTransferStatus.ACCEPTED,
  LrtTransferStatus.PARTIALLY_ACCEPTED,
  LrtTransferStatus.REJECTED,
];

export async function listOneCSales(workspaceId: string, date?: string) {
  const selectedDay = dayPeriodFromQuery(date);
  const documents = await prisma.accountingDocument.findMany({
    where: {
      workspaceId,
      type: AccountingDocumentType.WAYBILL,
      details: { path: ["source"], equals: "1C" },
      ...(selectedDay === undefined ? {} : { documentAt: { gte: selectedDay.from, lte: selectedDay.to } }),
    },
    select: {
      id: true, number: true, status: true, documentAt: true, customerId: true,
      counterparty: true, totalAmount: true, currency: true,
      items: { select: { id: true, description: true, quantity: true, unit: true }, orderBy: { position: "asc" } },
    },
    orderBy: [{ documentAt: "desc" }, { id: "desc" }],
    take: 501,
  });
  const visibleDocuments = documents.slice(0, 500);
  const tooManyDocuments = documents.length > 500;
  const active = visibleDocuments.filter((document) => document.customerId &&
    (document.status === AccountingDocumentStatus.ISSUED || document.status === AccountingDocumentStatus.PAID));
  const customers = [...new Set(active.map((document) => document.customerId!))];
  const dates = active.map((document) => startOfAlmatyDay(document.documentAt).getTime());
  const candidateTransfers = dates.length === 0 ? [] : await prisma.lrtTransfer.findMany({
    where: {
      workspaceId,
      customerId: { in: customers },
      status: { in: matchableTransferStatuses },
      transferAt: { gte: new Date(Math.min(...dates)), lt: new Date(Math.max(...dates) + 86_400_000) },
    },
    select: {
      id: true, number: true, customerId: true, transferAt: true, status: true,
      items: { select: { sentQuantity: true, unit: true, productLot: { select: { concreteGrade: true } } } },
    },
    orderBy: { transferAt: "desc" },
    take: 5001,
  });
  const tooManyCandidates = candidateTransfers.length > 5000;
  const byCustomerAndDay = new Map<string, typeof candidateTransfers>();
  if (!tooManyCandidates && !tooManyDocuments) {
    for (const transfer of candidateTransfers) {
      if (!transfer.customerId) continue;
      const key = `${transfer.customerId}:${startOfAlmatyDay(transfer.transferAt).getTime()}`;
      const group = byCustomerAndDay.get(key) ?? [];
      group.push(transfer);
      byCustomerAndDay.set(key, group);
    }
  }
  const matchesByDocument = new Map<string, typeof candidateTransfers>();
  const documentsPerTransfer = new Map<string, number>();
  if (!tooManyCandidates && !tooManyDocuments) {
    for (const document of active) {
      const key = `${document.customerId}:${startOfAlmatyDay(document.documentAt).getTime()}`;
      const matches = (byCustomerAndDay.get(key) ?? [])
        .filter((transfer) => saleMatchesTransfer(document, transfer));
      matchesByDocument.set(document.id, matches);
      for (const transfer of matches) {
        documentsPerTransfer.set(transfer.id, (documentsPerTransfer.get(transfer.id) ?? 0) + 1);
      }
    }
  }
  return {
    items: visibleDocuments.map((document) => {
      if (tooManyCandidates || tooManyDocuments ||
          (document.status !== AccountingDocumentStatus.ISSUED && document.status !== AccountingDocumentStatus.PAID)) {
        return { ...document, reconciliation: { state: "NOT_CHECKED" as const, transfer: null } };
      }
      const matches = matchesByDocument.get(document.id) ?? [];
      const unique = matches.length === 1 && documentsPerTransfer.get(matches[0]!.id) === 1;
      return { ...document, reconciliation: unique
        ? { state: "MATCHED" as const, transfer: { id: matches[0]!.id, number: matches[0]!.number } }
        : { state: matches.length > 1 || matches.some((transfer) => (documentsPerTransfer.get(transfer.id) ?? 0) > 1)
          ? "AMBIGUOUS" as const : "UNMATCHED" as const, transfer: null } };
    }),
    hasMore: tooManyDocuments,
  };
}
