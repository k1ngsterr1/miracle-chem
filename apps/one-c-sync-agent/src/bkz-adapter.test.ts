import { describe, expect, it } from "vitest";
import { initializeBkzState, parseBkzMapping, prepareBkzPlan } from "./bkz-adapter.js";
import { ids, sampleMapping, sampleReceipt, sampleSnapshot } from "../test/bkz-fixtures.js";


describe("BKZ snapshot adapter", () => {
  it("requires approval and explicit mappings instead of inferring by name/code", () => {
    expect(() => parseBkzMapping({ ...sampleMapping(), approvedBy: "" })).toThrow();
    expect(() => parseBkzMapping({ ...sampleMapping(), materials: [...sampleMapping().materials, ...sampleMapping().materials] })).toThrow();
    const snapshot = sampleSnapshot();
    const plan = prepareBkzPlan(snapshot, sampleMapping(), initializeBkzState(snapshot, sampleMapping()));
    expect(plan.delta.materials).toEqual([expect.objectContaining({ code: "TEST-REAGENT", productionEligible: true })]);
    expect(plan.delta.customers).toHaveLength(1); expect(plan.delta.suppliers).toHaveLength(1);
  });

  it("never imports historical posted receipts, and emits unchanged masters only once", () => {
    const snapshot = sampleSnapshot(); snapshot.receipts = [sampleReceipt()];
    const mapping = sampleMapping(); const initial = initializeBkzState(snapshot, mapping);
    const first = prepareBkzPlan(snapshot, mapping, initial);
    expect(first.delta.receipts).toEqual([]);
    snapshot.generatedAt = "2026-09-26T06:10:00Z";
    const repeat = prepareBkzPlan(snapshot, mapping, first.nextState);
    expect(repeat.delta.materials).toEqual([]); expect(repeat.delta.customers).toEqual([]); expect(repeat.delta.receipts).toEqual([]);
  });

  it.each([
    [true, false, "100.0000"], [true, true, "112.0000"],
    [false, false, "112.0000"], [false, true, "124.0000"],
  ])("uses VAT flags (%s,%s) and exact line total", (amountIncludesVat, vatInCost, cost) => {
    const mapping = sampleMapping(); const snapshot = sampleSnapshot(); const state = initializeBkzState(snapshot, mapping);
    snapshot.receipts = [{ ...sampleReceipt(), amountIncludesVat, vatInCost }];
    const plan = prepareBkzPlan(snapshot, mapping, state);
    expect(plan.reviews).toEqual([]);
    expect(plan.delta.receipts).toEqual([expect.objectContaining({ unitCost: String(Number(cost)), quantity: "10", receivedAt: "2026-09-26T03:00:00.000Z", externalId: `${ids.workspace}:${ids.document}:1` })]);
  });

  it("converts approved packaging coefficient into base quantity and cost", () => {
    const mapping = sampleMapping(); mapping.materials[0]!.receiptUnits[0]!.coefficient = "1000";
    const snapshot = sampleSnapshot(); const state = initializeBkzState(snapshot, mapping);
    snapshot.receipts = [{ ...sampleReceipt(), coefficient: "1000", quantity: "5.5", amount: "2832500", vatAmount: "0" }];
    expect(prepareBkzPlan(snapshot, mapping, state).delta.receipts).toEqual([expect.objectContaining({ quantity: "5500", unitCost: "515", unit: "KG" })]);
  });

  it("rounds half-up once and keeps exact decimal string quantities", () => {
    const snapshot = sampleSnapshot(); const mapping = sampleMapping(); const state = initializeBkzState(snapshot, mapping);
    snapshot.receipts = [{ ...sampleReceipt(), quantity: "3", amount: "1", vatAmount: "0" }];
    expect(prepareBkzPlan(snapshot, mapping, state).delta.receipts![0]).toMatchObject({ unitCost: "0.3333" });
    snapshot.receipts[0]!.amount = "1.00005"; snapshot.receipts[0]!.quantity = "1";
    expect(prepareBkzPlan(snapshot, mapping, state).delta.receipts![0]).toMatchObject({ unitCost: "1.0001" });
  });

  it("holds an entire document when any line is unmapped", () => {
    const snapshot = sampleSnapshot(); const mapping = sampleMapping(); const state = initializeBkzState(snapshot, mapping);
    snapshot.receipts = [sampleReceipt(), { ...sampleReceipt(), lineNumber: 2, materialId: ids.nextDocument }];
    const plan = prepareBkzPlan(snapshot, mapping, state);
    expect(plan.delta.receipts).toEqual([]); expect(plan.reviews).toHaveLength(1); expect(plan.nextState.documents[ids.document]).toBeUndefined();
  });

  it("detects changed, appended, cancelled and missing previously sent documents", () => {
    const snapshot = sampleSnapshot(); const mapping = sampleMapping(); const state = initializeBkzState(snapshot, mapping);
    snapshot.receipts = [sampleReceipt()];
    const sent = prepareBkzPlan(snapshot, mapping, state).nextState;
    for (const lines of [[{ ...sampleReceipt(), quantity: "11" }], [sampleReceipt(), { ...sampleReceipt(), lineNumber: 2 }], [{ ...sampleReceipt(), posted: false }], [{ ...sampleReceipt(), deleted: true }], []]) {
      const plan = prepareBkzPlan({ ...snapshot, generatedAt: "2026-09-26T06:15:00Z", receipts: lines }, mapping, sent);
      expect(plan.reviews).toHaveLength(1);
      expect(plan.delta.receipts).toEqual([expect.objectContaining({ externalId: `${ids.workspace}:${ids.document}:1`, posted: false, quantity: "10" })]);
    }
  });

  it("holds a modified historical document without inventing stock corrections", () => {
    const snapshot = sampleSnapshot(); snapshot.receipts = [sampleReceipt()]; const mapping = sampleMapping(); const state = initializeBkzState(snapshot, mapping);
    snapshot.receipts.push({ ...sampleReceipt(), lineNumber: 2 });
    const plan = prepareBkzPlan(snapshot, mapping, state);
    expect(plan.reviews).toHaveLength(1); expect(plan.delta.receipts).toEqual([]);
  });

  it("allows a previously unposted document to be posted after baseline", () => {
    const snapshot = sampleSnapshot(); snapshot.receipts = [{ ...sampleReceipt(), posted: false }]; const mapping = sampleMapping(); const state = initializeBkzState(snapshot, mapping);
    snapshot.receipts[0]!.posted = true;
    expect(prepareBkzPlan(snapshot, mapping, state).delta.receipts).toHaveLength(1);
  });

  it("namespaces source IDs and omits an empty tax ID rather than erasing CRM data", () => {
    const snapshot = sampleSnapshot(); const mapping = sampleMapping(); const state = initializeBkzState(snapshot, mapping);
    snapshot.receipts = [sampleReceipt()];
    const plan = prepareBkzPlan(snapshot, mapping, state);
    expect(plan.delta.customers![0]).toMatchObject({ externalId: `${ids.workspace}:${ids.partner}` });
    expect(plan.delta.customers![0]).not.toHaveProperty("taxId");
    expect(plan.delta.receipts![0]).toMatchObject({ materialExternalId: `${ids.workspace}:${ids.material}`, supplierExternalId: `${ids.workspace}:${ids.partner}` });
    const other = { ...mapping, sourceInstanceId: ids.nextDocument };
    expect(prepareBkzPlan(snapshot, other, initializeBkzState(snapshot, other)).delta.materials![0]).not.toEqual(plan.delta.materials![0]);
  });

  it("refuses mapping/source changes, stale snapshots and inconsistent document status", () => {
    const snapshot = sampleSnapshot(); const mapping = sampleMapping(); const state = initializeBkzState(snapshot, mapping);
    expect(() => prepareBkzPlan(snapshot, { ...mapping, sourceInstanceId: ids.nextDocument }, state)).toThrow("Mapping");
    expect(() => prepareBkzPlan({ ...snapshot, generatedAt: "2026-09-25T00:00:00Z" }, mapping, state)).toThrow("старее");
    snapshot.receipts = [sampleReceipt(), { ...sampleReceipt(), lineNumber: 2, posted: false }];
    expect(() => prepareBkzPlan(snapshot, mapping, state)).toThrow("Несогласованный");
  });

  it.each([{ coefficient: "2" }, { quantity: "0" }, { currencyName: "USD" }, { exchangeRate: "500" }, { amount: "-1" }, { vatAmount: "2000" }, { receivedAt: "2026-02-30T08:00:00" }])("holds invalid monetary/unit input %j", (change) => {
    const snapshot = sampleSnapshot(); const mapping = sampleMapping(); const state = initializeBkzState(snapshot, mapping);
    snapshot.receipts = [{ ...sampleReceipt(), ...change }];
    const plan = prepareBkzPlan(snapshot, mapping, state);
    expect(plan.reviews).toHaveLength(1); expect(plan.delta.receipts).toEqual([]);
  });
});
