import { Controller, Get, Header, Param, Query, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";
import { ApiError } from "../lib/api-error.js";
import type { ApiRequest } from "../lib/http.js";
import { requirePermission } from "../lib/permissions.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";

interface HistoricalProduction {
  sourceSheet: string;
  sourceRows: number[];
  dateFrom: string;
  dateTo: string;
  customer: string | null;
  part?: string | null;
  volumeM3: string;
  ingredients: Array<{ name: string; rate: string; consumed: string; sourceRow: number }>;
}

interface HistoricalFormula {
  sourceSheet: string;
  sourceRows: number[];
  number: string;
  customer: string | null;
  components: Array<{ name: string; quantity: string; unitPrice: string; lineTotal: string; sourceRow: number }>;
  total: string;
  costPerUnit: string | null;
}

interface HistoricalSale {
  sourceSheet: string;
  sourceRows: number[];
  date: string;
  customer: string;
  quantityM3: string;
  unitPrice: string;
  total: string;
  acceptedDate: string | null;
  acceptedQuantity: string | null;
}

interface HistoricalPayload {
  schemaVersion: number;
  sourceKey: string;
  fileName: string;
  sha256: string;
  sheets: Array<{ name: string; maxRow: number; maxColumn: number; rows: unknown[] }>;
  production: HistoricalProduction[];
  formulas: HistoricalFormula[];
  sales: HistoricalSale[];
  unlabelledSalesMetrics: unknown[];
}

const sourceRowsSchema = z.array(z.number().int().positive()).min(1);
const ingredientSchema = z.object({ name: z.string(), rate: z.string(), consumed: z.string(), sourceRow: z.number().int() });
const productionSchema = z.object({ sourceSheet: z.string(), sourceRows: sourceRowsSchema,
  dateFrom: z.iso.date(), dateTo: z.iso.date(), customer: z.string().nullable(), part: z.string().nullable().optional(),
  volumeM3: z.string(), ingredients: z.array(ingredientSchema).min(1) });
const formulaSchema = z.object({ sourceSheet: z.string(), sourceRows: sourceRowsSchema,
  number: z.string(), customer: z.string().nullable(), components: z.array(z.object({ name: z.string(),
    quantity: z.string(), unitPrice: z.string(), lineTotal: z.string(), sourceRow: z.number().int() })).min(1),
  total: z.string(), costPerUnit: z.string().nullable() });
const saleSchema = z.object({ sourceSheet: z.string(), sourceRows: sourceRowsSchema, date: z.iso.date(),
  customer: z.string(), quantityM3: z.string(), unitPrice: z.string(), total: z.string(),
  acceptedDate: z.string().nullable(), acceptedQuantity: z.string().nullable() });
const payloadSchema = z.object({ schemaVersion: z.literal(1), sourceKey: z.string(), fileName: z.string(),
  sha256: z.string(), sheets: z.array(z.object({ name: z.string(), maxRow: z.number(), maxColumn: z.number(),
    rows: z.array(z.unknown()) })), production: z.array(productionSchema), formulas: z.array(formulaSchema),
  sales: z.array(saleSchema), unlabelledSalesMetrics: z.array(z.unknown()) });

function asHistoricalPayload(value: unknown): HistoricalPayload {
  const result = payloadSchema.safeParse(value);
  if (!result.success) {
    throw new ApiError(409, "HISTORICAL_WORKBOOK_INVALID", "Исторический отчёт не удалось прочитать");
  }
  return result.data;
}

function checkedDate(date?: string): string | undefined {
  const parsed = date === undefined ? null : new Date(`${date}T12:00:00Z`);
  if (date !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(date)
    || parsed === null || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)) {
    throw new ApiError(400, "INVALID_DATE", "Неверная дата");
  }
  return date;
}

async function activeBooks(workspaceId: string) {
  return prisma.historicalWorkbook.findMany({ where: { workspaceId, active: true },
    orderBy: { sourceKey: "asc" }, select: { id: true, payload: true } });
}

function sourceRowId(workbookId: string, sourceSheet: string, sourceRows: number[]) {
  return `${workbookId}:${sourceSheet}:${sourceRows[0]}`;
}

const rawRowSchema = z.object({ number: z.number().int().positive(), cells: z.array(z.object({
  address: z.string(), value: z.string().nullable(),
})) });

function sourceSheetRows(payload: HistoricalPayload, name: string) {
  const sheet = payload.sheets.find((item) => item.name === name);
  return (sheet?.rows ?? []).flatMap((raw) => {
    const result = rawRowSchema.safeParse(raw);
    return result.success ? [result.data] : [];
  });
}

function cellValue(row: { cells: Array<{ address: string; value: string | null }> } | undefined, column: string) {
  return row?.cells.find((cell) => cell.address.startsWith(column) && /^\d+$/.test(cell.address.slice(column.length)))?.value ?? null;
}

function reportPeriod(label: string): { from: string; to: string } | null {
  if (/^2026-\d{2}-\d{2}$/.test(label)) return { from: label, to: label };
  const month = { июля: "07", августа: "08", сентября: "09", октября: "10" } as Record<string, string>;
  const single = /^(\d{1,2})\s+(июля|августа|сентября|октября)$/u.exec(label.toLocaleLowerCase("ru"));
  if (single) {
    const day = single[1]!.padStart(2, "0");
    const date = `2026-${month[single[2]!]!}-${day}`;
    return { from: date, to: date };
  }
  const range = /^(\d{2})-(\d{2})\.(\d{2})$/u.exec(label);
  if (range) return { from: `2026-${range[3]}-${range[1]}`, to: `2026-${range[3]}-${range[2]}` };
  return null;
}

@Controller("historical-workbooks")
export class HistoricalWorkbookController {
  @Get()
  async list(@Req() request: ApiRequest, @Res({ passthrough: true }) response: Response) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "ONE_C_SOURCE_FINANCE_VIEW");
    response.setHeader("Cache-Control", "private, no-store");
    const books = await prisma.historicalWorkbook.findMany({ where: { workspaceId, active: true },
      orderBy: { sourceKey: "asc" }, select: { id: true, sourceKey: true, fileName: true, sha256: true,
        importedAt: true, payload: true } });
    return { items: books.map((book) => {
      const payload = asHistoricalPayload(book.payload);
      return { id: book.id, sourceKey: book.sourceKey, fileName: book.fileName, sha256: book.sha256,
        importedAt: book.importedAt, sheets: payload.sheets.map((sheet) => ({ name: sheet.name, rowCount: sheet.rows.length })),
        productionCount: payload.production.length, formulaCount: payload.formulas.length,
        salesCount: payload.sales.length, unlabelledSalesMetricCount: payload.unlabelledSalesMetrics.length };
    }) };
  }

  @Get("production")
  @Header("Cache-Control", "private, no-store")
  async production(@Req() request: ApiRequest, @Query("date") date?: string) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "BATCHES_VIEW");
    checkedDate(date);
    const books = await activeBooks(workspaceId);
    return { items: books.flatMap((book) => {
      const payload = asHistoricalPayload(book.payload);
      return payload.production.filter((row) => date === undefined || row.dateFrom <= date && row.dateTo >= date)
        .map((row) => ({ ...row, workbookId: book.id, fileName: payload.fileName,
          id: sourceRowId(book.id, row.sourceSheet, row.sourceRows) }));
    }) };
  }

  @Get("sales")
  @Header("Cache-Control", "private, no-store")
  async sales(@Req() request: ApiRequest, @Query("date") date?: string,
      @Query("from") from?: string, @Query("to") to?: string) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "HISTORICAL_SALES_VIEW");
    const canViewMoney = ["ADMIN", "DIRECTOR", "ACCOUNTANT"].includes(actor.role);
    checkedDate(date);
    checkedDate(from);
    checkedDate(to);
    if (from && to && from > to) throw new ApiError(400, "INVALID_DATE_RANGE", "Начало периода позже конца");
    const books = await activeBooks(workspaceId);
    return { items: books.flatMap((book) => {
      const payload = asHistoricalPayload(book.payload);
      return payload.sales.filter((row) => (date === undefined || row.date === date)
        && (from === undefined || row.date >= from) && (to === undefined || row.date <= to))
        .map((row) => ({ ...row, unitPrice: canViewMoney ? row.unitPrice : null,
          total: canViewMoney ? row.total : null, workbookId: book.id, fileName: payload.fileName,
          id: sourceRowId(book.id, row.sourceSheet, row.sourceRows) + `:${row.customer}` }));
    }) };
  }

  @Get("formulas")
  @Header("Cache-Control", "private, no-store")
  async formulas(@Req() request: ApiRequest) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "FORMULAS_VIEW");
    const books = await activeBooks(workspaceId);
    return { items: books.flatMap((book) => {
      const payload = asHistoricalPayload(book.payload);
      return payload.formulas.map((row) => ({ ...row, workbookId: book.id,
        fileName: payload.fileName, id: sourceRowId(book.id, row.sourceSheet, row.sourceRows) }));
    }) };
  }

  @Get("material-usage")
  @Header("Cache-Control", "private, no-store")
  async materialUsage(@Req() request: ApiRequest, @Query("date") date?: string) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "MATERIALS_VIEW");
    checkedDate(date);
    const books = await activeBooks(workspaceId);
    return { items: books.flatMap((book) => {
      const payload = asHistoricalPayload(book.payload);
      return payload.production.filter((row) => date === undefined || row.dateFrom <= date && row.dateTo >= date)
        .flatMap((row) => row.ingredients.map((ingredient) => ({
          ...ingredient, workbookId: book.id, fileName: payload.fileName,
          sourceSheet: row.sourceSheet, dateFrom: row.dateFrom, dateTo: row.dateTo,
          customer: row.customer, volumeM3: row.volumeM3,
          id: `${sourceRowId(book.id, row.sourceSheet, row.sourceRows)}:${ingredient.sourceRow}`,
        })));
    }) };
  }

  @Get("customers")
  @Header("Cache-Control", "private, no-store")
  async customers(@Req() request: ApiRequest) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "CUSTOMERS_VIEW");
    const books = await activeBooks(workspaceId);
    const customers = new Map<string, { name: string; production: Array<{ id: string; dateFrom: string;
      dateTo: string; volumeM3: string; fileName: string }>; sales: Array<{ id: string; date: string;
      quantityM3: string; fileName: string }>; formulas: Array<{ id: string; number: string; fileName: string }> }>();
    function entry(name: string) {
      const key = name.trim().toLocaleLowerCase("ru");
      const existing = customers.get(key);
      if (existing) return existing;
      const created = { name, production: [], sales: [], formulas: [] };
      customers.set(key, created);
      return created;
    }
    for (const book of books) {
      const payload = asHistoricalPayload(book.payload);
      for (const row of payload.production) if (row.customer) {
        entry(row.customer).production.push({ id: sourceRowId(book.id, row.sourceSheet, row.sourceRows),
          dateFrom: row.dateFrom, dateTo: row.dateTo, volumeM3: row.volumeM3, fileName: payload.fileName });
      }
      for (const row of payload.sales) {
        entry(row.customer).sales.push({ id: sourceRowId(book.id, row.sourceSheet, row.sourceRows) + `:${row.customer}`,
          date: row.date, quantityM3: row.quantityM3, fileName: payload.fileName });
      }
      for (const row of payload.formulas) if (row.customer) {
        entry(row.customer).formulas.push({ id: sourceRowId(book.id, row.sourceSheet, row.sourceRows),
          number: row.number, fileName: payload.fileName });
      }
    }
    return { items: [...customers.values()].sort((a, b) => a.name.localeCompare(b.name, "ru")) };
  }

  @Get("warehouse")
  @Header("Cache-Control", "private, no-store")
  async warehouse(@Req() request: ApiRequest, @Query("date") date?: string) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "MATERIALS_VIEW");
    checkedDate(date);
    const books = await activeBooks(workspaceId);
    const claims: Array<{ id: string; workbookId: string; fileName: string; sourceSheet: string;
      sourceRow: number; supplier: string | null; material: string; quantityKg: string }> = [];
    const checkpoints: Array<{ id: string; workbookId: string; fileName: string; sourceSheet: string;
      sourceRows: number[]; periodLabel: string; dateFrom: string; dateTo: string;
      materials: Array<{ name: string; before: string | null; used: string | null; after: string | null }> }> = [];
    for (const book of books) {
      const payload = asHistoricalPayload(book.payload);
      const rows = sourceSheetRows(payload, "вирт склад");
      const byNumber = new Map(rows.map((row) => [row.number, row]));
      const header = byNumber.get(4);
      for (const row of rows) {
        const material = cellValue(row, "B");
        const quantity = cellValue(row, "E");
        if (date === undefined && material && quantity && Number.isFinite(Number(quantity))) {
          claims.push({ id: `${book.id}:вирт склад:${row.number}:claim`, workbookId: book.id,
            fileName: payload.fileName, sourceSheet: "вирт склад", sourceRow: row.number,
            supplier: cellValue(row, "A"), material, quantityKg: quantity });
        }
        if (cellValue(row, "I") !== "точка отчета") continue;
        const periodLabel = cellValue(row, "H");
        const period = periodLabel === null ? null : reportPeriod(periodLabel);
        const usedRow = byNumber.get(row.number + 1);
        const afterRow = byNumber.get(row.number + 2);
        if (!period || !periodLabel || cellValue(usedRow, "I") !== "расход"
          || cellValue(afterRow, "I") !== "остаток"
          || date !== undefined && (period.from > date || period.to < date)) continue;
        const materials = ["J", "K", "L", "M", "N", "O"].flatMap((column) => {
          const name = cellValue(header, column);
          if (!name) return [];
          return [{ name, before: cellValue(row, column), used: cellValue(usedRow, column),
            after: cellValue(afterRow, column) }];
        });
        checkpoints.push({ id: `${book.id}:вирт склад:${row.number}:checkpoint`, workbookId: book.id,
          fileName: payload.fileName, sourceSheet: "вирт склад",
          sourceRows: [row.number, row.number + 1, row.number + 2], periodLabel,
          dateFrom: period.from, dateTo: period.to, materials });
      }
    }
    return { claims, checkpoints };
  }

  @Get(":id")
  async detail(@Req() request: ApiRequest, @Param("id") id: string,
      @Res({ passthrough: true }) response: Response) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "ONE_C_SOURCE_FINANCE_VIEW");
    response.setHeader("Cache-Control", "private, no-store");
    const book = await prisma.historicalWorkbook.findFirst({ where: { id, workspaceId, active: true },
      select: { id: true, sourceKey: true, fileName: true, sha256: true, importedAt: true, payload: true } });
    if (!book) throw new ApiError(404, "HISTORICAL_WORKBOOK_NOT_FOUND", "Исторический отчёт не найден");
    return { ...book, payload: asHistoricalPayload(book.payload) };
  }
}
