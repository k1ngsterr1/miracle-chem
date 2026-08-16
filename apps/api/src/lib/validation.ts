import { z, type ZodType } from "zod";
import { ApiError } from "./api-error.js";

export const decimalString = z
  .union([z.string(), z.number()])
  .transform((value) => String(value))
  .refine((value) => /^-?\d+(?:\.\d+)?$/u.test(value), "Ожидалось десятичное число");

export const nonNegativeDecimalString = decimalString.refine(
  (value) => !value.startsWith("-"),
  "Значение не может быть отрицательным",
);

export const positiveDecimalString = nonNegativeDecimalString.refine(
  (value) => Number(value) > 0,
  "Значение должно быть больше нуля",
);

export function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "VALIDATION_ERROR", "Некорректные данные запроса", {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

