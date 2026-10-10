import { Decimal } from "decimal.js";
import { describe, expect, it } from "vitest";
import { accountingBalanceIssue, comparableAccountingUnitCost } from "./one-c-accounting-balance.js";

describe("1C accounting balances", () => {
  it.each([
    ["5", "100", null, true],
    ["0", "0", null, false],
    ["0", "100", "VALUE_WITHOUT_QUANTITY", false],
    ["5", "0", "QUANTITY_WITHOUT_VALUE", false],
    ["-2", "-40", "NEGATIVE_NET_BALANCE", false],
    ["5", "-40", "NEGATIVE_NET_BALANCE", false],
  ] as const)("classifies quantity %s and value %s without rewriting 1C", (quantity, amount, issue, comparable) => {
    const sourceQuantity = new Decimal(quantity);
    const sourceAmount = new Decimal(amount);
    expect(accountingBalanceIssue(sourceQuantity, sourceAmount)).toBe(issue);
    expect(comparableAccountingUnitCost(sourceQuantity, sourceAmount)).toBe(comparable);
  });
});
