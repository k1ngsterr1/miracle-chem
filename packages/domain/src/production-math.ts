import { Decimal } from "decimal.js";
import { DomainError } from "./errors.js";

export interface ComponentCostInput {
  actualQuantity: Decimal.Value;
  unitCost: Decimal.Value;
}

export interface DeviationResult {
  absolute: Decimal;
  percent: Decimal;
}

export interface CostResult {
  total: Decimal;
  perProductUnit: Decimal;
}

export function plannedComponentQuantity(
  normPerCubicMetre: Decimal.Value,
  plannedVolumeM3: Decimal.Value,
): Decimal {
  return nonNegative(normPerCubicMetre, "Норма компонента").mul(
    nonNegative(plannedVolumeM3, "Плановый объём"),
  );
}

export function recipeScaleFactor(
  requiredVolume: Decimal.Value,
  baseVolume: Decimal.Value,
): Decimal {
  const base = positive(baseVolume, "Базовый объём рецептуры");
  return nonNegative(requiredVolume, "Требуемый объём").div(base);
}

export function waterCementRatio(
  waterMassKg: Decimal.Value,
  cementMassKg: Decimal.Value,
): Decimal {
  return nonNegative(waterMassKg, "Масса воды").div(
    positive(cementMassKg, "Масса цемента"),
  );
}

export function waterInAggregate(
  wetAggregateMassKg: Decimal.Value,
  moisturePercent: Decimal.Value,
): Decimal {
  return nonNegative(wetAggregateMassKg, "Масса заполнителя")
    .mul(nonNegative(moisturePercent, "Влажность"))
    .div(100);
}

export function waterToAdd(
  recipeWaterKg: Decimal.Value,
  aggregateWaterKg: readonly Decimal.Value[],
): Decimal {
  const water = nonNegative(recipeWaterKg, "Вода по рецептуре");
  const contained = aggregateWaterKg.reduce<Decimal>(
    (sum, current) => sum.add(nonNegative(current, "Вода в заполнителе")),
    new Decimal(0),
  );
  return Decimal.max(0, water.sub(contained));
}

export function dryAggregateMass(
  wetMassKg: Decimal.Value,
  moisturePercent: Decimal.Value,
): Decimal {
  const divisor = new Decimal(1).add(
    nonNegative(moisturePercent, "Влажность").div(100),
  );
  return nonNegative(wetMassKg, "Влажная масса").div(divisor);
}

export function deviation(
  actual: Decimal.Value,
  planned: Decimal.Value,
): DeviationResult {
  const plan = positive(planned, "Плановый расход");
  const absolute = new Decimal(actual).sub(plan);
  return { absolute, percent: absolute.div(plan).mul(100) };
}

export function productionLoss(
  loadedMassKg: Decimal.Value,
  productMassKg: Decimal.Value,
): DeviationResult {
  const loaded = positive(loadedMassKg, "Масса загруженных компонентов");
  const absolute = loaded.sub(nonNegative(productMassKg, "Масса продукта"));
  return { absolute, percent: absolute.div(loaded).mul(100) };
}

export function availableProduct(
  produced: Decimal.Value,
  sentToLrt: Decimal.Value,
  writtenOff: Decimal.Value,
  otherShipments: Decimal.Value,
  returned: Decimal.Value = 0,
): Decimal {
  const result = nonNegative(produced, "Произведено")
    .add(nonNegative(returned, "Возвращено"))
    .sub(nonNegative(sentToLrt, "Отправлено на ЛРТ"))
    .sub(nonNegative(writtenOff, "Списано"))
    .sub(nonNegative(otherShipments, "Другие отгрузки"));
  if (result.isNegative()) {
    throw new DomainError("INVALID_ARGUMENT", "Движения продукта превышают произведённое количество");
  }
  return result;
}

export function batchCost(
  components: readonly ComponentCostInput[],
  actualProductOutput: Decimal.Value,
): CostResult {
  const total = components.reduce<Decimal>(
    (sum, component) =>
      sum.add(
        nonNegative(component.actualQuantity, "Фактический расход").mul(
          nonNegative(component.unitCost, "Стоимость единицы"),
        ),
      ),
    new Decimal(0),
  );
  return {
    total,
    perProductUnit: total.div(positive(actualProductOutput, "Фактический выход")),
  };
}

function nonNegative(value: Decimal.Value, label: string): Decimal {
  const decimal = new Decimal(value);
  if (!decimal.isFinite() || decimal.isNegative()) {
    throw new DomainError("INVALID_ARGUMENT", `${label} не может быть отрицательным`);
  }
  return decimal;
}

function positive(value: Decimal.Value, label: string): Decimal {
  const decimal = nonNegative(value, label);
  if (decimal.isZero()) {
    throw new DomainError("DIVISION_BY_ZERO", `${label} должен быть больше нуля`);
  }
  return decimal;
}
