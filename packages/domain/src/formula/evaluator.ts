import { Decimal } from "decimal.js";
import { DomainError } from "../errors.js";
import { convertQuantity, isUnit, type Unit } from "../units.js";
import { parseFormula } from "./parser.js";
import type {
  FormulaAstNode,
  FormulaDefinition,
  FormulaEvaluation,
  FormulaTraceStep,
  FormulaTraceValue,
  FormulaVariables,
  RoundingMode,
} from "./types.js";

interface NumericRuntimeValue {
  kind: "number";
  value: Decimal;
  unit: Unit | null;
}

interface BooleanRuntimeValue {
  kind: "boolean";
  value: boolean;
}

interface StringRuntimeValue {
  kind: "string";
  value: string;
}

type RuntimeValue = NumericRuntimeValue | BooleanRuntimeValue | StringRuntimeValue;

const ROUNDING_MAP: Readonly<Record<RoundingMode, Decimal.Rounding>> = {
  HALF_UP: Decimal.ROUND_HALF_UP,
  UP: Decimal.ROUND_UP,
  DOWN: Decimal.ROUND_DOWN,
};

export function evaluateFormula(
  definition: FormulaDefinition,
  variables: FormulaVariables,
): FormulaEvaluation {
  validateDefinition(definition);
  const ast = parseFormula(definition.expression);
  const trace: FormulaTraceStep[] = [];
  const usedVariables = [...collectFormulaVariables(ast)].sort();
  const missingVariables = usedVariables.filter((name) => variables[name] === undefined);
  if (missingVariables.length > 0) {
    throw new DomainError(
      "MISSING_VARIABLE",
      `Не заданы переменные: ${missingVariables.join(", ")}`,
      { missingVariables },
    );
  }

  const evaluated = evaluateNode(ast, variables, trace);
  const numeric = requireNumber(evaluated, "Результат формулы");
  const rounded = numeric.value.toDecimalPlaces(
    definition.precision,
    ROUNDING_MAP[definition.roundingMode],
  );
  addTrace(trace, "final-round", definition.expression, [numeric], {
    ...numeric,
    value: rounded,
  }, `Округление до ${definition.precision} знаков (${definition.roundingMode})`);

  return {
    value: rounded.toFixed(definition.precision),
    unit: numeric.unit,
    usedVariables,
    trace,
  };
}

export function collectFormulaVariables(ast: FormulaAstNode): Set<string> {
  const variables = new Set<string>();
  const visit = (node: FormulaAstNode): void => {
    switch (node.type) {
      case "variable":
        variables.add(node.name);
        return;
      case "unary":
      case "percent":
        visit(node.operand);
        return;
      case "binary":
        visit(node.left);
        visit(node.right);
        return;
      case "conditional":
        visit(node.condition);
        visit(node.whenTrue);
        visit(node.whenFalse);
        return;
      case "call":
        node.arguments.forEach(visit);
        return;
      case "number":
      case "string":
        return;
    }
  };
  visit(ast);
  return variables;
}

function evaluateNode(
  node: FormulaAstNode,
  variables: FormulaVariables,
  trace: FormulaTraceStep[],
): RuntimeValue {
  switch (node.type) {
    case "number":
      return { kind: "number", value: new Decimal(node.value), unit: null };
    case "string":
      return { kind: "string", value: node.value };
    case "variable": {
      const variable = variables[node.name];
      if (variable === undefined) {
        throw new DomainError("MISSING_VARIABLE", `Не задана переменная «${node.name}»`, {
          variable: node.name,
        });
      }
      return {
        kind: "number",
        value: new Decimal(variable.value),
        unit: variable.unit ?? null,
      };
    }
    case "unary": {
      const operand = requireNumber(evaluateNode(node.operand, variables, trace), "Унарный оператор");
      const result: NumericRuntimeValue = {
        ...operand,
        value: node.operator === "-" ? operand.value.neg() : operand.value,
      };
      addTrace(trace, `unary-${node.operator}`, renderNode(node), [operand], result, `Унарный оператор ${node.operator}`);
      return result;
    }
    case "percent": {
      const operand = requireNumber(evaluateNode(node.operand, variables, trace), "Процент");
      const result: NumericRuntimeValue = { ...operand, value: operand.value.div(100) };
      addTrace(trace, "percent", renderNode(node), [operand], result, "Преобразование процентов в коэффициент");
      return result;
    }
    case "binary":
      return evaluateBinary(node, variables, trace);
    case "conditional": {
      const condition = requireBoolean(
        evaluateNode(node.condition, variables, trace),
        "Условие",
      );
      const result = evaluateNode(condition.value ? node.whenTrue : node.whenFalse, variables, trace);
      addTrace(
        trace,
        "conditional",
        renderNode(node),
        [condition],
        result,
        condition.value ? "Выбрана ветка «истина»" : "Выбрана ветка «ложь»",
      );
      return result;
    }
    case "call":
      return evaluateCall(node, variables, trace);
  }
}

function evaluateBinary(
  node: Extract<FormulaAstNode, { type: "binary" }>,
  variables: FormulaVariables,
  trace: FormulaTraceStep[],
): RuntimeValue {
  const left = requireNumber(evaluateNode(node.left, variables, trace), `Оператор ${node.operator}`);
  const right = requireNumber(evaluateNode(node.right, variables, trace), `Оператор ${node.operator}`);
  let result: RuntimeValue;

  if (isComparisonOperator(node.operator)) {
    const comparable = alignUnits(left, right);
    const comparison = comparable.left.value.comparedTo(comparable.right.value);
    const value = {
      ">": comparison > 0,
      ">=": comparison >= 0,
      "<": comparison < 0,
      "<=": comparison <= 0,
      "==": comparison === 0,
      "!=": comparison !== 0,
    }[node.operator];
    result = { kind: "boolean", value: value ?? false };
  } else if (node.operator === "+" || node.operator === "-") {
    const aligned = alignUnits(left, right);
    result = {
      kind: "number",
      value:
        node.operator === "+"
          ? aligned.left.value.add(aligned.right.value)
          : aligned.left.value.sub(aligned.right.value),
      unit: aligned.left.unit,
    };
  } else if (node.operator === "*") {
    if (left.unit !== null && right.unit !== null) {
      throw new DomainError(
        "INCOMPATIBLE_UNITS",
        "Умножение двух размерных значений в формулах не поддерживается",
        { leftUnit: left.unit, rightUnit: right.unit },
      );
    }
    result = {
      kind: "number",
      value: left.value.mul(right.value),
      unit: left.unit ?? right.unit,
    };
  } else {
    if (right.value.isZero()) {
      throw new DomainError("DIVISION_BY_ZERO", "Деление на ноль запрещено");
    }
    if (left.unit === null && right.unit !== null) {
      throw new DomainError(
        "INCOMPATIBLE_UNITS",
        "Нельзя делить безразмерное значение на размерное",
        { rightUnit: right.unit },
      );
    }
    if (left.unit !== null && right.unit !== null) {
      const aligned = alignUnits(left, right);
      result = {
        kind: "number",
        value: aligned.left.value.div(aligned.right.value),
        unit: null,
      };
    } else {
      result = {
        kind: "number",
        value: left.value.div(right.value),
        unit: left.unit,
      };
    }
  }

  addTrace(trace, `binary-${node.operator}`, renderNode(node), [left, right], result, `Операция ${node.operator}`);
  return result;
}

function isComparisonOperator(
  operator: Extract<FormulaAstNode, { type: "binary" }>["operator"],
): operator is ">" | ">=" | "<" | "<=" | "==" | "!=" {
  return [">", ">=", "<", "<=", "==", "!="].includes(operator);
}

function evaluateCall(
  node: Extract<FormulaAstNode, { type: "call" }>,
  variables: FormulaVariables,
  trace: FormulaTraceStep[],
): RuntimeValue {
  const name = node.name.toLowerCase();

  if (name === "if") {
    requireArgumentCount(name, node.arguments, 3, 3);
    const conditionNode = node.arguments[0];
    const trueNode = node.arguments[1];
    const falseNode = node.arguments[2];
    if (conditionNode === undefined || trueNode === undefined || falseNode === undefined) {
      throw new DomainError("INVALID_ARGUMENT", "if ожидает три аргумента");
    }
    const condition = requireBoolean(evaluateNode(conditionNode, variables, trace), "if");
    const result = evaluateNode(condition.value ? trueNode : falseNode, variables, trace);
    addTrace(trace, "if", renderNode(node), [condition], result, condition.value ? "Условие истинно" : "Условие ложно");
    return result;
  }

  if (name === "convert") {
    requireArgumentCount(name, node.arguments, 3, 4);
    const [valueNode, fromNode, toNode, densityNode] = node.arguments;
    if (valueNode === undefined || fromNode === undefined || toNode === undefined) {
      throw new DomainError("INVALID_ARGUMENT", "convert ожидает значение и две единицы");
    }
    const numeric = requireNumber(evaluateNode(valueNode, variables, trace), "convert");
    const from = requireString(evaluateNode(fromNode, variables, trace), "convert").value.toUpperCase();
    const to = requireString(evaluateNode(toNode, variables, trace), "convert").value.toUpperCase();
    if (!isUnit(from) || !isUnit(to)) {
      throw new DomainError("INVALID_ARGUMENT", `Неизвестная единица в convert: ${from} → ${to}`);
    }
    if (numeric.unit !== null && numeric.unit !== from) {
      throw new DomainError(
        "INCOMPATIBLE_UNITS",
        `Значение имеет единицу ${numeric.unit}, но convert ожидает ${from}`,
      );
    }
    const density = densityNode === undefined
      ? undefined
      : requireNumber(evaluateNode(densityNode, variables, trace), "convert density").value;
    const converted = convertQuantity({ value: numeric.value, unit: from }, to, density);
    const result: NumericRuntimeValue = { kind: "number", value: converted.value, unit: converted.unit };
    addTrace(trace, "convert", renderNode(node), [numeric], result, `Преобразование ${from} → ${to}`);
    return result;
  }

  const args = node.arguments.map((argument) => evaluateNode(argument, variables, trace));
  if (name === "round") {
    requireArgumentCount(name, node.arguments, 1, 2);
    const value = requireNumber(args[0], "round");
    const digits = args[1] === undefined ? 0 : requireInteger(args[1], "round precision");
    if (digits < 0 || digits > 12) {
      throw new DomainError("INVALID_ARGUMENT", "Точность round должна быть от 0 до 12");
    }
    const result: NumericRuntimeValue = {
      ...value,
      value: value.value.toDecimalPlaces(digits, Decimal.ROUND_HALF_UP),
    };
    addTrace(trace, "round", renderNode(node), [value], result, `Округление до ${digits} знаков`);
    return result;
  }

  if (name === "abs") {
    requireArgumentCount(name, node.arguments, 1, 1);
    const value = requireNumber(args[0], "abs");
    const result: NumericRuntimeValue = { ...value, value: value.value.abs() };
    addTrace(trace, "abs", renderNode(node), [value], result, "Абсолютное значение");
    return result;
  }

  if (name === "min" || name === "max") {
    requireArgumentCount(name, node.arguments, 2, 32);
    const numbers = args.map((argument) => requireNumber(argument, name));
    const first = numbers[0];
    if (first === undefined) throw new DomainError("INVALID_ARGUMENT", `${name} требует аргументы`);
    const aligned = numbers.map((number) => alignUnits(first, number).right);
    const selected = aligned.reduce((current, value) => {
      const comparison = value.value.comparedTo(current.value);
      return name === "min" ? (comparison < 0 ? value : current) : comparison > 0 ? value : current;
    });
    const result: NumericRuntimeValue = { ...selected, unit: first.unit };
    addTrace(trace, name, renderNode(node), numbers, result, `${name === "min" ? "Минимальное" : "Максимальное"} значение`);
    return result;
  }

  throw new DomainError("INVALID_ARGUMENT", `Функция «${node.name}» не поддерживается`, {
    function: node.name,
  });
}

function alignUnits(
  left: NumericRuntimeValue,
  right: NumericRuntimeValue,
): { left: NumericRuntimeValue; right: NumericRuntimeValue } {
  if (left.unit === right.unit) return { left, right };
  if (left.unit === null || right.unit === null) {
    throw new DomainError(
      "INCOMPATIBLE_UNITS",
      "Нельзя совместить размерное и безразмерное значения",
      { leftUnit: left.unit, rightUnit: right.unit },
    );
  }
  try {
    const converted = convertQuantity({ value: right.value, unit: right.unit }, left.unit);
    return {
      left,
      right: { kind: "number", value: converted.value, unit: converted.unit },
    };
  } catch (error) {
    if (error instanceof DomainError && error.code === "DENSITY_REQUIRED") {
      throw new DomainError(
        "INCOMPATIBLE_UNITS",
        `Несовместимые единицы ${left.unit} и ${right.unit}; используйте convert с плотностью`,
        { leftUnit: left.unit, rightUnit: right.unit },
      );
    }
    throw error;
  }
}

function requireNumber(value: RuntimeValue | undefined, context: string): NumericRuntimeValue {
  if (value?.kind !== "number") {
    throw new DomainError("INVALID_ARGUMENT", `${context}: ожидалось числовое значение`);
  }
  if (!value.value.isFinite()) {
    throw new DomainError("INVALID_ARGUMENT", `${context}: значение должно быть конечным`);
  }
  return value;
}

function requireBoolean(value: RuntimeValue | undefined, context: string): BooleanRuntimeValue {
  if (value?.kind !== "boolean") {
    throw new DomainError("INVALID_ARGUMENT", `${context}: ожидалось логическое условие`);
  }
  return value;
}

function requireString(value: RuntimeValue | undefined, context: string): StringRuntimeValue {
  if (value?.kind !== "string") {
    throw new DomainError("INVALID_ARGUMENT", `${context}: ожидалась строка`);
  }
  return value;
}

function requireInteger(value: RuntimeValue | undefined, context: string): number {
  const numeric = requireNumber(value, context);
  if (!numeric.value.isInteger()) {
    throw new DomainError("INVALID_ARGUMENT", `${context}: ожидалось целое число`);
  }
  return numeric.value.toNumber();
}

function requireArgumentCount(
  name: string,
  args: FormulaAstNode[],
  min: number,
  max: number,
): void {
  if (args.length < min || args.length > max) {
    const expected = min === max ? String(min) : `${min}–${max}`;
    throw new DomainError(
      "INVALID_ARGUMENT",
      `Функция ${name} ожидает ${expected} аргумента(ов), получено ${args.length}`,
    );
  }
}

function validateDefinition(definition: FormulaDefinition): void {
  if (!definition.name.trim()) throw new DomainError("INVALID_ARGUMENT", "У формулы должно быть название");
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new DomainError("INVALID_ARGUMENT", "Версия формулы должна быть положительным целым числом");
  }
  if (!Number.isInteger(definition.precision) || definition.precision < 0 || definition.precision > 12) {
    throw new DomainError("INVALID_ARGUMENT", "Точность формулы должна быть от 0 до 12");
  }
}

function addTrace(
  trace: FormulaTraceStep[],
  operation: string,
  expression: string,
  inputs: RuntimeValue[],
  result: RuntimeValue,
  explanation: string,
): void {
  trace.push({
    index: trace.length + 1,
    operation,
    expression,
    inputs: inputs.map(toTraceValue).filter((value): value is FormulaTraceValue => typeof value !== "boolean" && typeof value !== "string"),
    result: toTraceValue(result),
    explanation,
  });
}

function toTraceValue(value: RuntimeValue): FormulaTraceValue | boolean | string {
  if (value.kind === "boolean" || value.kind === "string") return value.value;
  return { value: value.value.toString(), unit: value.unit };
}

function renderNode(node: FormulaAstNode): string {
  switch (node.type) {
    case "number":
      return node.value;
    case "string":
      return JSON.stringify(node.value);
    case "variable":
      return node.name;
    case "unary":
      return `${node.operator}${renderNode(node.operand)}`;
    case "percent":
      return `${renderNode(node.operand)}%`;
    case "binary":
      return `(${renderNode(node.left)} ${node.operator} ${renderNode(node.right)})`;
    case "conditional":
      return `(${renderNode(node.condition)} ? ${renderNode(node.whenTrue)} : ${renderNode(node.whenFalse)})`;
    case "call":
      return `${node.name}(${node.arguments.map(renderNode).join(", ")})`;
  }
}
