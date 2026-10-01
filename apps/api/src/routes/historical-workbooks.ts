import { Controller, Get, Param, Query, Req, Res } from "@nestjs/common";
import type { Response } from "express";
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

interface HistoricalPayload {
  schemaVersion: number;
  sourceKey: string;
  fileName: string;
  sha256: string;
  sheets: Array<{ name: string; maxRow: number; maxColumn: number; rows: unknown[] }>;
  production: HistoricalProduction[];
  formulas: unknown[];
  sales: unknown[];
  unlabelledSalesMetrics: unknown[];
}

function asHistoricalPayload(value: unknown): HistoricalPayload {
  const payload = value as HistoricalPayload;
  if (payload?.schemaVersion !== 1 || !Array.isArray(payload.production) || !Array.isArray(payload.sheets)) {
    throw new ApiError(409, "HISTORICAL_WORKBOOK_INVALID", "Исторический отчёт не удалось прочитать");
  }
  return payload;
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
  async production(@Req() request: ApiRequest, @Query("date") date?: string) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    requirePermission(actor.role, "BATCHES_VIEW");
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new ApiError(400, "INVALID_DATE", "Неверная дата");
    }
    const books = await prisma.historicalWorkbook.findMany({ where: { workspaceId, active: true },
      select: { id: true, payload: true } });
    return { items: books.flatMap((book) => {
      const payload = asHistoricalPayload(book.payload);
      return payload.production.filter((row) => date === undefined || row.dateFrom <= date && row.dateTo >= date)
        .map((row) => ({ ...row, workbookId: book.id, fileName: payload.fileName,
          id: `${book.id}:${row.sourceSheet}:${row.sourceRows[0]}` }));
    }) };
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
