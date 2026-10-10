import { Decimal } from "decimal.js";

export type OneCAccountingBalanceIssue =
  | "NEGATIVE_NET_BALANCE"
  | "VALUE_WITHOUT_QUANTITY"
  | "QUANTITY_WITHOUT_VALUE";

/** A 1C ledger balance is authoritative even when it cannot be used as an ordinary CRM stock lot. */
export function accountingBalanceIssue(quantity: Decimal, amount: Decimal): OneCAccountingBalanceIssue | null {
  if (quantity.isNegative() || amount.isNegative()) return "NEGATIVE_NET_BALANCE";
  if (quantity.isZero() && !amount.isZero()) return "VALUE_WITHOUT_QUANTITY";
  if (!quantity.isZero() && amount.isZero()) return "QUANTITY_WITHOUT_VALUE";
  return null;
}

/** Only positive physical stock with a positive book value has a usable unit cost. */
export function comparableAccountingUnitCost(quantity: Decimal, amount: Decimal): boolean {
  return quantity.gt(0) && amount.gt(0);
}
