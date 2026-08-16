export type DomainErrorCode =
  | "FORMULA_SYNTAX"
  | "FORMULA_LIMIT"
  | "MISSING_VARIABLE"
  | "DIVISION_BY_ZERO"
  | "INVALID_ARGUMENT"
  | "INCOMPATIBLE_UNITS"
  | "DENSITY_REQUIRED";

export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: DomainErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
}

