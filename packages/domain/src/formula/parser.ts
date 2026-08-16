import { DomainError } from "../errors.js";
import type { FormulaAstNode } from "./types.js";
import { tokenizeFormula, type FormulaToken, type FormulaTokenType } from "./tokenizer.js";

const MAX_AST_NODES = 256;
const ALLOWED_FUNCTIONS = new Set(["if", "convert", "round", "abs", "min", "max"]);

export function parseFormula(expression: string): FormulaAstNode {
  const parser = new FormulaParser(tokenizeFormula(expression));
  return parser.parse();
}

class FormulaParser {
  private cursor = 0;
  private nodeCount = 0;

  constructor(private readonly tokens: FormulaToken[]) {}

  parse(): FormulaAstNode {
    const result = this.parseConditional();
    this.expect("eof", "Ожидался конец формулы");
    return result;
  }

  private parseConditional(): FormulaAstNode {
    const condition = this.parseComparison();
    if (!this.match("question")) return condition;
    const whenTrue = this.parseConditional();
    this.expect("colon", "В условном выражении отсутствует «:»");
    const whenFalse = this.parseConditional();
    return this.node({ type: "conditional", condition, whenTrue, whenFalse });
  }

  private parseComparison(): FormulaAstNode {
    let left = this.parseAdditive();
    while (this.current().type === "operator" && [">", ">=", "<", "<=", "==", "!="].includes(this.current().value)) {
      const operator = this.advance().value as ">" | ">=" | "<" | "<=" | "==" | "!=";
      const right = this.parseAdditive();
      left = this.node({ type: "binary", operator, left, right });
    }
    return left;
  }

  private parseAdditive(): FormulaAstNode {
    let left = this.parseMultiplicative();
    while (this.current().type === "operator" && ["+", "-"].includes(this.current().value)) {
      const operator = this.advance().value as "+" | "-";
      const right = this.parseMultiplicative();
      left = this.node({ type: "binary", operator, left, right });
    }
    return left;
  }

  private parseMultiplicative(): FormulaAstNode {
    let left = this.parseUnary();
    while (this.current().type === "operator" && ["*", "/"].includes(this.current().value)) {
      const operator = this.advance().value as "*" | "/";
      const right = this.parseUnary();
      left = this.node({ type: "binary", operator, left, right });
    }
    return left;
  }

  private parseUnary(): FormulaAstNode {
    if (this.current().type === "operator" && ["+", "-"].includes(this.current().value)) {
      const operator = this.advance().value as "+" | "-";
      return this.node({ type: "unary", operator, operand: this.parseUnary() });
    }
    return this.parsePostfix();
  }

  private parsePostfix(): FormulaAstNode {
    let expression = this.parsePrimary();
    while (this.match("percent")) {
      expression = this.node({ type: "percent", operand: expression });
    }
    return expression;
  }

  private parsePrimary(): FormulaAstNode {
    const token = this.current();
    if (this.match("number")) return this.node({ type: "number", value: token.value });
    if (this.match("string")) return this.node({ type: "string", value: token.value });

    if (this.match("identifier")) {
      if (!this.match("leftParen")) {
        return this.node({ type: "variable", name: token.value });
      }
      if (!ALLOWED_FUNCTIONS.has(token.value.toLowerCase())) {
        throw this.error(`Функция «${token.value}» не поддерживается`, token);
      }
      const args: FormulaAstNode[] = [];
      if (!this.check("rightParen")) {
        do {
          args.push(this.parseConditional());
        } while (this.match("comma"));
      }
      this.expect("rightParen", "После аргументов функции отсутствует «)»");
      return this.node({ type: "call", name: token.value, arguments: args });
    }

    if (this.match("leftParen")) {
      const expression = this.parseConditional();
      this.expect("rightParen", "Отсутствует закрывающая скобка");
      return expression;
    }

    throw this.error("Ожидалось число, переменная, функция или скобка", token);
  }

  private current(): FormulaToken {
    const token = this.tokens[this.cursor];
    if (token === undefined) {
      return { type: "eof", value: "", position: this.tokens.at(-1)?.position ?? 0 };
    }
    return token;
  }

  private advance(): FormulaToken {
    const token = this.current();
    if (token.type !== "eof") this.cursor += 1;
    return token;
  }

  private check(type: FormulaTokenType): boolean {
    return this.current().type === type;
  }

  private match(type: FormulaTokenType): boolean {
    if (!this.check(type)) return false;
    this.advance();
    return true;
  }

  private expect(type: FormulaTokenType, message: string): FormulaToken {
    if (this.check(type)) return this.advance();
    throw this.error(message, this.current());
  }

  private node<T extends FormulaAstNode>(node: T): T {
    this.nodeCount += 1;
    if (this.nodeCount > MAX_AST_NODES) {
      throw new DomainError(
        "FORMULA_LIMIT",
        `Формула содержит больше ${MAX_AST_NODES} операций`,
      );
    }
    return node;
  }

  private error(message: string, token: FormulaToken): DomainError {
    return new DomainError(
      "FORMULA_SYNTAX",
      `${message} в позиции ${token.position + 1}`,
      { position: token.position, token: token.value },
    );
  }
}
