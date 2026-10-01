import { z } from "zod";

// Describe every projected field: Zod strips unspecified object keys by default.
const sourceRowsSchema = z.array(z.number().int().positive()).min(1);

export const historicalWorkbookInputSchema = z.object({
  schemaVersion: z.literal(1),
  sourceKey: z.enum(["2026-july-august", "2026-september"]),
  fileName: z.string().min(1).max(255),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  sheets: z.array(z.object({ name: z.string(), maxRow: z.number().int(), maxColumn: z.number().int(),
    rows: z.array(z.unknown()) })).min(1),
  production: z.array(z.object({ sourceSheet: z.string(), sourceRows: sourceRowsSchema,
    dateFrom: z.iso.date(), dateTo: z.iso.date(), customer: z.string().nullable(),
    part: z.string().nullable().optional(), volumeM3: z.string(),
    ingredients: z.array(z.object({ name: z.string(), rate: z.string(), consumed: z.string(),
      sourceRow: z.number().int().positive() })).min(1) })),
  formulas: z.array(z.object({ sourceSheet: z.string(), sourceRows: sourceRowsSchema,
    number: z.string(), customer: z.string().nullable(), components: z.array(z.object({
      name: z.string(), quantity: z.string(), unitPrice: z.string(), lineTotal: z.string(),
      sourceRow: z.number().int().positive(),
    })).min(1), total: z.string(), costPerUnit: z.string().nullable() })),
  sales: z.array(z.object({ sourceSheet: z.string(), sourceRows: sourceRowsSchema,
    date: z.iso.date(), customer: z.string(), quantityM3: z.string(), unitPrice: z.string(),
    total: z.string(), acceptedDate: z.iso.date().nullable(), acceptedQuantity: z.string().nullable() })),
  unlabelledSalesMetrics: z.array(z.object({ sourceSheet: z.string(), sourceRows: sourceRowsSchema,
    date: z.iso.date(), label: z.string().nullable(), columnE: z.string().nullable(),
    columnF: z.string().nullable() })),
});
