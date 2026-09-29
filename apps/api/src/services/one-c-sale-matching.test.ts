import { describe, expect, it } from "vitest";
import { Decimal } from "decimal.js";
import { AccountingDocumentStatus, LrtTransferStatus, Unit } from "../generated/prisma/index.js";
import { saleMatchesTransfer } from "./one-c-sale-matching.js";

const sale = {
  customerId: "customer-a",
  documentAt: new Date("2026-09-15T07:00:00.000Z"),
  status: AccountingDocumentStatus.ISSUED,
  items: [
    { description: "Добавка КТ-1", quantity: new Decimal(3), unit: "кг" },
    { description: "Добавка КТ-1", quantity: new Decimal(2), unit: "кг" },
  ],
};
const transfer = {
  customerId: "customer-a",
  transferAt: new Date("2026-09-15T04:00:00.000Z"),
  status: LrtTransferStatus.SENT,
  items: [{ productLot: { concreteGrade: " добавка КТ-1 " }, sentQuantity: new Decimal(5), unit: Unit.KG }],
};

describe("saleMatchesTransfer", () => {
  it("matches the same customer, Almaty calendar day and summed positions", () => {
    expect(saleMatchesTransfer(sale, transfer)).toBe(true);
  });

  it("rejects another customer, day, position or quantity", () => {
    expect(saleMatchesTransfer(sale, { ...transfer, customerId: "customer-b" })).toBe(false);
    expect(saleMatchesTransfer(sale, { ...transfer, transferAt: new Date("2026-09-14T18:00:00.000Z") })).toBe(false);
    expect(saleMatchesTransfer(sale, { ...transfer, items: [{ ...transfer.items[0]!, productLot: { concreteGrade: "Другой продукт" } }] })).toBe(false);
    expect(saleMatchesTransfer(sale, { ...transfer, items: [{ ...transfer.items[0]!, sentQuantity: new Decimal(4) }] })).toBe(false);
  });

  it("never treats drafts or unshipped transfers as completed dispatches", () => {
    expect(saleMatchesTransfer({ ...sale, status: AccountingDocumentStatus.DRAFT }, transfer)).toBe(false);
    expect(saleMatchesTransfer(sale, { ...transfer, status: LrtTransferStatus.DRAFT })).toBe(false);
    expect(saleMatchesTransfer(sale, { ...transfer, status: LrtTransferStatus.CANCELLED })).toBe(false);
  });

  it("does not guess unknown units or match empty positions", () => {
    expect(saleMatchesTransfer({ ...sale, items: [{ ...sale.items[0]!, unit: "упаковка" }] }, transfer)).toBe(false);
    expect(saleMatchesTransfer({ ...sale, items: [] }, transfer)).toBe(false);
  });
});
