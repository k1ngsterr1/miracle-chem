import { DomainError } from "../errors.js";

export type FormulaTokenType =
  | "number"
  | "identifier"
  | "string"
  | "operator"
  | "leftParen"
  | "rightParen"
  | "comma"
  | "question"
  | "colon"
  | "percent"
  | "eof";

export interface FormulaToken {
  type: FormulaTokenType;
  value: string;
  position: number;
}

const MAX_EXPRESSION_LENGTH = 4_096;
const MAX_TOKENS = 512;

export function tokenizeFormula(expression: string): FormulaToken[] {
  if (expression.length > MAX_EXPRESSION_LENGTH) {
    throw new DomainError(
      "FORMULA_LIMIT",
      `Формула длиннее ${MAX_EXPRESSION_LENGTH} символов`,
    );
  }

  const tokens: FormulaToken[] = [];
  let cursor = 0;

  const add = (type: FormulaTokenType, value: string, position: number) => {
    tokens.push({ type, value, position });
    if (tokens.length > MAX_TOKENS) {
      throw new DomainError(
        "FORMULA_LIMIT",
        `Формула содержит больше ${MAX_TOKENS} токенов`,
      );
    }
  };

  while (cursor < expression.length) {
    const char = expression[cursor];
    if (char === undefined) break;

    if (/\s/u.test(char)) {
      cursor += 1;
      continue;
    }

    if (/\d/u.test(char) || (char === "." && /\d/u.test(expression[cursor + 1] ?? ""))) {
      const start = cursor;
      let dots = 0;
      while (cursor < expression.length) {
        const next = expression[cursor];
        if (next === ".") dots += 1;
        if (next === undefined || (!/\d/u.test(next) && next !== ".")) break;
        cursor += 1;
      }
      const value = expression.slice(start, cursor);
      if (dots > 1 || value === ".") {
        throw syntaxError("Некорректное число", start);
      }
      add("number", value, start);
      continue;
    }

    if (/[A-Za-z_]/u.test(char)) {
      const start = cursor;
      cursor += 1;
      while (/[A-Za-z0-9_.]/u.test(expression[cursor] ?? "")) cursor += 1;
      add("identifier", expression.slice(start, cursor), start);
      continue;
    }

    if (char === '"' || char === "'") {
      const start = cursor;
      const quote = char;
      cursor += 1;
      let value = "";
      let closed = false;
      while (cursor < expression.length) {
        const next = expression[cursor];
        if (next === quote) {
          closed = true;
          cursor += 1;
          break;
        }
        if (next === "\\") {
          const escaped = expression[cursor + 1];
          if (escaped !== quote && escaped !== "\\") {
            throw syntaxError("Разрешено экранировать только кавычку и обратный слеш", cursor);
          }
          value += escaped;
          cursor += 2;
          continue;
        }
        value += next;
        cursor += 1;
      }
      if (!closed) throw syntaxError("Незакрытая строка", start);
      add("string", value, start);
      continue;
    }

    const twoChars = expression.slice(cursor, cursor + 2);
    if ([">=", "<=", "==", "!="].includes(twoChars)) {
      add("operator", twoChars, cursor);
      cursor += 2;
      continue;
    }

    const simple: Partial<Record<string, FormulaTokenType>> = {
      "+": "operator",
      "-": "operator",
      "*": "operator",
      "/": "operator",
      ">": "operator",
      "<": "operator",
      "(": "leftParen",
      ")": "rightParen",
      ",": "comma",
      "?": "question",
      ":": "colon",
      "%": "percent",
    };
    const type = simple[char];
    if (type !== undefined) {
      add(type, char, cursor);
      cursor += 1;
      continue;
    }

    throw syntaxError(`Недопустимый символ «${char}»`, cursor);
  }

  add("eof", "", expression.length);
  return tokens;
}

function syntaxError(message: string, position: number): DomainError {
  return new DomainError("FORMULA_SYNTAX", `${message} в позиции ${position + 1}`, {
    position,
  });
}

