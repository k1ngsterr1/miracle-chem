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
