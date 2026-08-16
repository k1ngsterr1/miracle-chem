import { Decimal } from "decimal.js";
import { DomainError } from "./errors.js";

export const UNITS = ["G", "KG", "T", "ML", "L", "M3"] as const;
export type Unit = (typeof UNITS)[number];
export type UnitDimension = "MASS" | "VOLUME";

export interface QuantityInput {
  value: Decimal.Value;
  unit: Unit;
}

export interface Quantity {
  value: Decimal;
  unit: Unit;
}

const UNIT_META: Readonly<
  Record<Unit, { dimension: UnitDimension; toBase: Decimal }>
> = {
  G: { dimension: "MASS", toBase: new Decimal("0.001") },
  KG: { dimension: "MASS", toBase: new Decimal(1) },
  T: { dimension: "MASS", toBase: new Decimal(1000) },
  ML: { dimension: "VOLUME", toBase: new Decimal("0.000001") },
  L: { dimension: "VOLUME", toBase: new Decimal("0.001") },
  M3: { dimension: "VOLUME", toBase: new Decimal(1) },
};

export function isUnit(value: string): value is Unit {
  return (UNITS as readonly string[]).includes(value);
}

export function unitDimension(unit: Unit): UnitDimension {
  return UNIT_META[unit].dimension;
}

export function quantity(value: Decimal.Value, unit: Unit): Quantity {
  return { value: new Decimal(value), unit };
}

export function convertQuantity(
  input: QuantityInput,
  targetUnit: Unit,
  densityKgPerM3?: Decimal.Value,
): Quantity {
  const value = new Decimal(input.value);
  const source = UNIT_META[input.unit];
  const target = UNIT_META[targetUnit];

  if (source.dimension === target.dimension) {
    const baseValue = value.mul(source.toBase);
    return { value: baseValue.div(target.toBase), unit: targetUnit };
  }

  if (densityKgPerM3 === undefined) {
    throw new DomainError(
      "DENSITY_REQUIRED",
      `Для пересчёта ${input.unit} → ${targetUnit} требуется плотность в кг/м³`,
      { from: input.unit, to: targetUnit },
    );
  }

  const density = new Decimal(densityKgPerM3);
  if (!density.isFinite() || density.lte(0)) {
    throw new DomainError(
      "INVALID_ARGUMENT",
      "Плотность должна быть положительным числом",
      { density: density.toString() },
    );
  }

  if (source.dimension === "MASS") {
    const kilograms = value.mul(source.toBase);
    const cubicMetres = kilograms.div(density);
    return { value: cubicMetres.div(target.toBase), unit: targetUnit };
  }

  const cubicMetres = value.mul(source.toBase);
  const kilograms = cubicMetres.mul(density);
  return { value: kilograms.div(target.toBase), unit: targetUnit };
}

export function addQuantities(
  left: QuantityInput,
  right: QuantityInput,
  densityKgPerM3?: Decimal.Value,
): Quantity {
  const converted = convertQuantity(right, left.unit, densityKgPerM3);
  return {
    value: new Decimal(left.value).add(converted.value),
    unit: left.unit,
  };
}

export function subtractQuantities(
  left: QuantityInput,
  right: QuantityInput,
  densityKgPerM3?: Decimal.Value,
): Quantity {
  const converted = convertQuantity(right, left.unit, densityKgPerM3);
  return {
    value: new Decimal(left.value).sub(converted.value),
    unit: left.unit,
  };
}
