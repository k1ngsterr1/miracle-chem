import type { FastifyInstance } from "fastify";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import { ApiError } from "../lib/api-error.js";
import { createXlsx } from "../lib/xlsx.js";
import {
  getDashboard,
  getExpenseReport,
  getMaterialConsumptionReport,
  getLrtTransferReport,
  getProductBalanceReport,
  getProductBalanceSummary,
  getProductLotTrace,
  getProductionReport,
  getProductionSummary,
  getRecipeEfficiencyReport,
  type BalanceGroupBy,
  type Period,
  type ProductionGroupBy,
} from "../services/report-service.js";

const productionGroups: ProductionGroupBy[] = ["day", "week", "month", "shift", "grade", "line", "operator"];
const balanceGroups: BalanceGroupBy[] = ["productLot", "batch", "grade", "line", "operator"];

export async function registerReportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/dashboard", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
    return getDashboard(workspaceId, workspace.timezone);
  });

  app.get("/reports/production", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    return { items: await getProductionReport(workspaceId, parsePeriod(request.query)) };
  });

  app.get("/reports/expenses", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    return { items: await getExpenseReport(workspaceId, parsePeriod(request.query)) };
  });

  app.get("/reports/production-summary", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    const query = request.query as { groupBy?: string };
    const groupBy = parseGroupBy(query.groupBy);
    return { groupBy, items: await getProductionSummary(workspaceId, parsePeriod(request.query), groupBy) };
  });

  app.get("/reports/material-consumption", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    return { items: await getMaterialConsumptionReport(workspaceId, parsePeriod(request.query)) };
  });

  app.get("/reports/product-balance", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    return { items: await getProductBalanceReport(workspaceId, parsePeriod(request.query)) };
  });

  app.get("/reports/product-balance-summary", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    const query = request.query as { groupBy?: string };
    const groupBy = parseBalanceGroupBy(query.groupBy);
    return { groupBy, items: await getProductBalanceSummary(workspaceId, parsePeriod(request.query), groupBy) };
  });

  app.get("/reports/recipe-efficiency", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    return { items: await getRecipeEfficiencyReport(workspaceId, parsePeriod(request.query)) };
  });

  app.get("/reports/lrt", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    return { items: await getLrtTransferReport(workspaceId, parsePeriod(request.query)) };
  });

  app.get<{ Params: { id: string } }>("/reports/product-trace/:id", async (request) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    const result = await getProductLotTrace(workspaceId, request.params.id);
    if (result === null) throw new ApiError(404, "PRODUCT_LOT_NOT_FOUND", "Партия продукта не найдена");
    return result;
  });

  app.get("/reports/export", async (request, reply) => {
    const { workspaceId } = await getRequestContext(request, prisma);
    const query = request.query as { type?: string; format?: string; from?: string; to?: string; groupBy?: string };
    const period = parsePeriod(query);
    const type = query.type ?? "production";
    const rows = type === "expenses"
      ? await getExpenseReport(workspaceId, period)
      : type === "materials"
      ? await getMaterialConsumptionReport(workspaceId, period)
      : type === "balance"
        ? await getProductBalanceReport(workspaceId, period)
        : type === "balance-summary"
          ? await getProductBalanceSummary(workspaceId, period, parseBalanceGroupBy(query.groupBy))
        : type === "production-summary"
          ? await getProductionSummary(workspaceId, period, parseGroupBy(query.groupBy))
          : type === "recipe-efficiency"
            ? await getRecipeEfficiencyReport(workspaceId, period)
            : type === "lrt"
              ? await getLrtTransferReport(workspaceId, period)
        : await getProductionReport(workspaceId, period);
    const basename = `miracle-chem-${type}-${period.from.toISOString().slice(0, 10)}-${period.to
      .toISOString()
      .slice(0, 10)}`;
    if (query.format === "xlsx") {
      const output = createXlsx(rows, "Miracle Chem report");
      return reply
        .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("content-disposition", `attachment; filename="${basename}.xlsx"`)
        .send(output);
    }
    const csv = toCsv(rows);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="${basename}.csv"`)
      .send(`\uFEFF${csv}`);
  });
}

function parseGroupBy(value: string | undefined): ProductionGroupBy {
  const groupBy = value ?? "day";
  if (!productionGroups.includes(groupBy as ProductionGroupBy)) {
    throw new ApiError(400, "INVALID_GROUPING", "Допустимые группировки: day, week, month, shift, grade, line, operator");
  }
  return groupBy as ProductionGroupBy;
}

function parseBalanceGroupBy(value: string | undefined): BalanceGroupBy {
  const groupBy = value ?? "productLot";
  if (!balanceGroups.includes(groupBy as BalanceGroupBy)) {
    throw new ApiError(400, "INVALID_BALANCE_GROUPING", "Допустимые группировки: productLot, batch, grade, line, operator");
  }
  return groupBy as BalanceGroupBy;
}

function parsePeriod(queryValue: unknown): Period {
  const query = queryValue as { from?: string; to?: string };
  const to = query.to === undefined ? new Date() : new Date(query.to);
  const from = query.from === undefined
    ? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000)
    : new Date(query.from);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
    throw new ApiError(400, "INVALID_PERIOD", "Некорректный период отчёта");
  }
  return { from, to };
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0] ?? {});
  const escape = (value: unknown) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [headers.map(escape).join(","), ...rows.map((row) => headers.map((key) => escape(row[key])).join(","))].join("\r\n");
}
