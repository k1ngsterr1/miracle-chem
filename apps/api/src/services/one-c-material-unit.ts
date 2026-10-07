import { Decimal } from "decimal.js";
import { Unit } from "../generated/prisma/index.js";

// Audited source GUIDs/codes from the bound BKZ database. A catalogue unit alone
// does not establish the accounting register's unit, so other tonne items fail closed.
const approvedTonneItems = new Map([
  ["2bd46f6e-ac26-11f1-b015-00155d320501", "00000000015"], // KT-1
  ["31b148c1-ac26-11f1-b015-00155d320501", "00000000016"], // KT-2
]);

/** Source accounting quantity -> stable CRM base unit; no material ID or lot migration. */
export function mapOneCMaterialUnit(material: { externalId: string; code: string; unitName: string }):
  { baseUnit: Unit; quantityFactor: string } | null {
  switch (material.unitName.trim().toLocaleLowerCase("ru")) {
    case "кг": return { baseUnit: Unit.KG, quantityFactor: "1" };
    case "т": return approvedTonneItems.get(material.externalId.toLowerCase()) === material.code.trim()
      ? { baseUnit: Unit.KG, quantityFactor: "1000" } : null;
    case "шт": return { baseUnit: Unit.PCS, quantityFactor: "1" };
    case "м": return { baseUnit: Unit.M, quantityFactor: "1" };
    case "пар": return { baseUnit: Unit.PAIR, quantityFactor: "1" };
    default: return null;
  }
}

/** Fail closed if a tonne interpretation contradicts known KG stock or KZT/kg cost. */
export function plausibleTonneBalance(currentStock: Decimal, currentCost: Decimal,
  proposedStock: Decimal, proposedValue: Decimal): boolean {
  if (proposedStock.isZero()) return true;
  if (currentCost.lte(0) || proposedStock.lte(0) || proposedValue.lte(0)) return false;
  const costRatio = proposedValue.div(proposedStock).div(currentCost);
  // A material can be almost fully consumed. Large upward jumps and a 1000x
  // price shift are the dangerous signatures of a mismatched register unit.
  return costRatio.gte("0.1") && costRatio.lte("10") &&
    (currentStock.lte(0) || proposedStock.lte(currentStock.mul(100)));
}
