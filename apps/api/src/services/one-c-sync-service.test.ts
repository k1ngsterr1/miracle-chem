import { beforeEach, describe, expect, it, vi } from "vitest";
import { initializeBkzState, prepareBkzPlan } from "../../../one-c-sync-agent/src/bkz-adapter.js";
import { sampleMapping, sampleReceipt, sampleSnapshot } from "../../../one-c-sync-agent/test/bkz-fixtures.js";

const mocks = vi.hoisted(() => {
  const record = { id: "33333333-3333-4333-8333-333333333333" };
  const tx = {
    customer: { update: vi.fn().mockResolvedValue(record), create: vi.fn().mockResolvedValue(record), findUnique: vi.fn().mockResolvedValue(null) },
    supplier: { update: vi.fn().mockResolvedValue(record), create: vi.fn().mockResolvedValue(record), findUnique: vi.fn().mockResolvedValue(null) },
    material: { update: vi.fn().mockResolvedValue(record), create: vi.fn().mockResolvedValue(record), findUnique: vi.fn().mockResolvedValue(null) },
    oneCExternalReference: { findUnique: vi.fn(), upsert: vi.fn().mockResolvedValue({}) },
    oneCSyncReview: { upsert: vi.fn().mockResolvedValue({}) },
    oneCSyncRun: { update: vi.fn().mockImplementation(async ({ data }: { data: object }) => ({ id: "run", ...data })) },
  };
  return { tx, prisma: { workspace: { findUnique: vi.fn().mockResolvedValue(record) }, oneCSyncRun: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn().mockResolvedValue({ id: "run" }), update: vi.fn() }, $transaction: vi.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)) } };
});
vi.mock("../lib/prisma.js", () => ({ prisma: mocks.prisma }));
vi.mock("../lib/audit.js", () => ({ writeAudit: vi.fn().mockResolvedValue(undefined) }));
import { oneCDeltaSchema, syncOneCDelta } from "./one-c-sync-service.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tx.oneCExternalReference.findUnique.mockResolvedValue({ internalId: "33333333-3333-4333-8333-333333333333", sourceUpdatedAt: new Date("2026-01-01Z") });
  mocks.tx.customer.findUnique.mockResolvedValue(null); mocks.tx.supplier.findUnique.mockResolvedValue(null);
});

describe("1C partial field updates (without database writes)", () => {
  it("does not erase CRM contacts or material prices absent from a 1C delta", async () => {
    const snapshot = sampleSnapshot(); const mapping = sampleMapping();
    const plan = prepareBkzPlan(snapshot, mapping, initializeBkzState(snapshot, mapping));
    await syncOneCDelta(oneCDeltaSchema.parse(plan.delta));
    expect(mocks.tx.customer.update).toHaveBeenCalledTimes(1);
    const customer = mocks.tx.customer.update.mock.calls[0]![0].data;
    for (const field of ["phone", "email", "address", "contactPerson", "taxId"]) expect(customer).not.toHaveProperty(field);
    expect(mocks.tx.supplier.update.mock.calls[0]![0].data).not.toHaveProperty("contact");
    const material = mocks.tx.material.update.mock.calls[0]![0].data;
    for (const field of ["costPerBaseUnit", "minimumStock", "densityKgPerM3"]) expect(material).not.toHaveProperty(field);
  });

  it("still accepts explicitly provided financial values and defaults the first material cost", async () => {
    const snapshot = sampleSnapshot(); const mapping = sampleMapping();
    const plan = prepareBkzPlan(snapshot, mapping, initializeBkzState(snapshot, mapping));
    const input = oneCDeltaSchema.parse(plan.delta);
    input.materials[0]!.costPerBaseUnit = "125.5"; input.materials[0]!.minimumStock = "500";
    await syncOneCDelta(input);
    expect(mocks.tx.material.update.mock.calls[0]![0].data).toMatchObject({ costPerBaseUnit: "125.5", minimumStock: "500" });
    mocks.tx.oneCExternalReference.findUnique.mockResolvedValue(null);
    await syncOneCDelta(oneCDeltaSchema.parse(plan.delta));
    expect(mocks.tx.material.create.mock.calls[0]![0].data).toMatchObject({ costPerBaseUnit: "0" });
  });

  it("accepts the collector receipt contract, including packaging and VAT cost", () => {
    const snapshot = sampleSnapshot(); const mapping = sampleMapping(); const state = initializeBkzState(snapshot, mapping);
    snapshot.receipts = [sampleReceipt()];
    const plan = prepareBkzPlan(snapshot, mapping, state);
    const parsed = oneCDeltaSchema.parse(plan.delta);
    expect(parsed.receipts).toHaveLength(1);
    expect(parsed.receipts[0]).toMatchObject({ unitCost: "100", quantity: "10", unit: "KG", posted: true });
  });

  it("quarantines new GUIDs with colliding customer/supplier names without binding or overwriting", async () => {
    const snapshot = sampleSnapshot(); const mapping = sampleMapping(); const plan = prepareBkzPlan(snapshot, mapping, initializeBkzState(snapshot, mapping));
    mocks.tx.oneCExternalReference.findUnique.mockResolvedValue(null);
    mocks.tx.customer.findUnique.mockResolvedValue({ id: "existing-customer" });
    mocks.tx.supplier.findUnique.mockResolvedValue({ id: "existing-supplier" });
    plan.delta.materials = [];
    const result = await syncOneCDelta(oneCDeltaSchema.parse(plan.delta));
    expect(result.summary).toMatchObject({ quarantined: 2, created: 0 });
    expect(mocks.tx.customer.update).not.toHaveBeenCalled(); expect(mocks.tx.customer.create).not.toHaveBeenCalled();
    expect(mocks.tx.supplier.update).not.toHaveBeenCalled(); expect(mocks.tx.supplier.create).not.toHaveBeenCalled();
    expect(mocks.tx.oneCExternalReference.upsert).not.toHaveBeenCalled();
  });
});
