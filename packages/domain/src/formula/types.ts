import type { Decimal } from "decimal.js";
import type { Unit } from "../units.js";

export type RoundingMode = "HALF_UP" | "UP" | "DOWN";

export interface FormulaVariableValue {
  value: Decimal.Value;
  unit?: Unit;
}

export interface FormulaDefinition {
  name: string;
  description: string;
  version: number;
  expression: string;
  precision: number;
  roundingMode: RoundingMode;
}

export type FormulaVariables = Readonly<Record<string, FormulaVariableValue>>;

export interface FormulaTraceValue {
  value: string;
  unit: Unit | null;
}

export interface FormulaTraceStep {
  index: number;
  operation: string;
  expression: string;
  inputs: FormulaTraceValue[];
  result: FormulaTraceValue | boolean | string;
  explanation: string;
}

export interface FormulaEvaluation {
  value: string;
  unit: Unit | null;
  usedVariables: string[];
  trace: FormulaTraceStep[];
}

export type FormulaAstNode =
  | { type: "number"; value: string }
  | { type: "string"; value: string }
  | { type: "variable"; name: string }
  | { type: "unary"; operator: "+" | "-"; operand: FormulaAstNode }
  | { type: "percent"; operand: FormulaAstNode }
  | {
      type: "binary";
      operator: "+" | "-" | "*" | "/" | ">" | ">=" | "<" | "<=" | "==" | "!=";
      left: FormulaAstNode;
      right: FormulaAstNode;
    }
  | {
      type: "conditional";
      condition: FormulaAstNode;
      whenTrue: FormulaAstNode;
      whenFalse: FormulaAstNode;
    }
  | { type: "call"; name: string; arguments: FormulaAstNode[] };
