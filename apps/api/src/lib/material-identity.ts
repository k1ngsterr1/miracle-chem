import { Decimal } from "decimal.js";
import { Unit } from "../generated/prisma/index.js";

export const MAIN_REAGENTS = [
  { code: "KT-1", name: "КТ-1", aliases: ["КТ-1", "КТ1", "KT-1", "KT1"] },
  { code: "KT-2", name: "КТ-2", aliases: ["КТ-2", "КТ2", "KT-2", "KT2"] },
  { code: "SODIUM-GLUCONATE", name: "Глюконат Натрия", aliases: ["ГЛЮКОНАТ НАТРИЯ", "ГЛЮКАНАТ НАТРИЯ", "SODIUM GLUCONATE"] },
  { code: "AOS", name: "Пеногаситель (АОС)", aliases: ["ПЕНОГАСИТЕЛ", "АОС", "AOS"] },
  { code: "SUGAR", name: "Сахар", aliases: ["САХАР", "SUGAR"] },
  { code: "SALT", name: "Соль", aliases: ["СОЛЬ", "SALT"] },
  { code: "LST", name: "ЛСТ", aliases: ["ЛСТ", "LST"] },
] as const;

export const SODIUM_GLUCONATE = MAIN_REAGENTS[2];

export interface MaterialIdentity {
  code: string;
  name: string;
}

export function matchesMaterial(
  material: MaterialIdentity,
  definition: (typeof MAIN_REAGENTS)[number],
): boolean {
  const searchable = normalizeMaterialIdentity(`${material.code} ${material.name}`);
  return definition.aliases.some((alias) => searchable.includes(normalizeMaterialIdentity(alias)));
}

export function quantityInKilograms(quantity: { toString(): string }, unit: Unit): Decimal {
  const value = new Decimal(quantity.toString());
  if (unit === Unit.T) return value.mul(1000);
  if (unit === Unit.G) return value.div(1000);
  return value;
}

function normalizeMaterialIdentity(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleUpperCase("ru-RU")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
