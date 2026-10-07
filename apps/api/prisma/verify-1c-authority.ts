import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Decimal } from "decimal.js";
import { prisma } from "../src/lib/prisma.js";
import { mapOneCMaterialUnit } from "../src/services/one-c-material-unit.js";

type SourceRow = Record<string, unknown>;

function required(value: unknown, field: string): string {
  assert.equal(typeof value, "string", `Missing ${field}`);
  assert.ok((value as string).length > 0, `Empty ${field}`);
  return value as string;
}

async function main(): Promise<void> {
  const [snapshotPath, workspaceId] = process.argv.slice(2);
  if (!snapshotPath || !workspaceId) {
    throw new Error("Usage: verify-1c-authority.ts <snapshot.json> <staging-workspace-id>");
  }
  const bytes = await readFile(resolve(snapshotPath));
  const source = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
  const sourceHash = createHash("sha256").update(bytes).digest("hex");
  assert.ok(Array.isArray(source.accountingInventory), "Missing 1C accounting inventory");
  const stored = await prisma.oneCSourceSnapshot.findFirst({
    where: { workspaceId, sha256: sourceHash }, select: { organizationExternalId: true },
  });
  assert.ok(stored, "The exact source snapshot was not staged in this workspace");
  const materialRefs = await prisma.oneCExternalReference.findMany({
    where: { workspaceId, source: "1C", entityType: "MATERIAL" },
    select: { externalId: true, internalId: true },
  });
  const internalIdByExternalId = new Map(materialRefs.map((ref) => [ref.externalId.split(":").at(-1)!, ref.internalId]));
  const actual = await prisma.material.findMany({
    where: { workspaceId }, select: { id: true, code: true, currentStock: true,
      lots: { select: { availableQuantity: true, qualitySnapshot: true } } },
  });
  const actualById = new Map(actual.map((material) => [material.id, material]));
  const sourceMaterials = new Map((source.materials as SourceRow[]).map((item) => [required(item.externalId, "material.externalId"), item]));
  const expectedStockById = new Map<string, Decimal>();
  let checkedBalances = 0;
  for (const row of source.accountingInventory as SourceRow[]) {
    if (row.organizationId !== stored.organizationExternalId) continue;
    const sourceMaterialId = required(row.materialId, "inventory.materialId");
    const internalId = internalIdByExternalId.get(sourceMaterialId);
    assert.ok(internalId, `No CRM material for 1C material ${sourceMaterialId}`);
    const material = actualById.get(internalId);
    assert.ok(material, `Mapped CRM material not found: ${internalId}`);
    const sourceMaterial = sourceMaterials.get(sourceMaterialId);
    assert.ok(sourceMaterial, `Source material not found: ${sourceMaterialId}`);
    assert.equal(material.code, sourceMaterial.code, "Material code diverged from 1C");
    const unit = mapOneCMaterialUnit({ externalId: sourceMaterialId,
      code: required(sourceMaterial.code, "material.code"), unitName: required(sourceMaterial.unitName, "material.unitName") });
    assert.ok(unit, `Accounting unit is not approved for ${sourceMaterialId}`);
    const warehouseId = required(row.warehouseId, "inventory.warehouseId");
    const quantity = new Decimal(required(row.quantityDebit, "quantityDebit"))
      .sub(required(row.quantityCredit, "quantityCredit")).mul(unit.quantityFactor);
    const value = new Decimal(required(row.amountDebit, "amountDebit"))
      .sub(required(row.amountCredit, "amountCredit"));
    const lot = material.lots.find((item) => {
      const metadata = item.qualitySnapshot as Record<string, unknown> | null;
      return metadata?.sourceWarehouseId === warehouseId && metadata?.accountCode === row.accountCode;
    });
    assert.ok(lot, `No opening lot for ${sourceMaterialId}/${warehouseId}`);
    assert.ok(new Decimal(lot.availableQuantity.toString()).eq(quantity), "Opening quantity differs from 1C");
    assert.ok(new Decimal(required((lot.qualitySnapshot as Record<string, unknown>).bookValue, "bookValue")).eq(value),
      "Book value differs from 1C");
    expectedStockById.set(internalId, (expectedStockById.get(internalId) ?? new Decimal(0)).add(quantity));
    checkedBalances += 1;
  }
  for (const material of actual) {
    assert.ok(new Decimal(material.currentStock.toString()).eq(expectedStockById.get(material.id) ?? 0),
      `Current stock differs from 1C: ${material.code}`);
  }
  assert.equal(await prisma.materialLot.count({ where: { workspaceId } }), checkedBalances,
    "Unexpected opening lots outside 1C accounting balances");
  process.stdout.write(`${JSON.stringify({ status: "VERIFIED", workspaceId, sourceHash,
    materials: actual.length, accountingBalances: checkedBalances })}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(async () => { await prisma.$disconnect(); });
