import { Injectable, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { ApiError } from "./api-error.js";
import type { ApiRequest } from "./http.js";
import { type Permission, requirePermission } from "./permissions.js";
import { prisma } from "./prisma.js";
import { getRequestContext } from "./request-context.js";

/**
 * Enforces access on the API boundary. UI navigation is only a convenience;
 * every CRM route must make its decision here as well.
 */
@Injectable()
export class AuthorizationGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ApiRequest>();
    const permission = permissionForRequest(request.method, request.path);
    if (permission === null) return true;
    const requestContext = await getRequestContext(request, prisma);
    requirePermission(requestContext.actor.role, permission);
    return true;
  }
}

function permissionForRequest(method: string, path: string): Permission | null {
  const normalizedPath = path.replace(/^\/api(?=\/|$)/u, "").replace(/\/+$/u, "") || "/";
  if (normalizedPath === "/health" || normalizedPath.startsWith("/auth")) return null;
  if ((normalizedPath === "/integrations/1c/sync" || normalizedPath === "/integrations/1c/snapshot") && method === "POST") return null;
  if (normalizedPath.startsWith("/integrations/1c/archive")) return method === "POST" ? null : "ONE_C_ARCHIVE_VIEW";
  if (normalizedPath === "/integrations/1c/reconciliation") return "ONE_C_ARCHIVE_VIEW";
  if (normalizedPath.startsWith("/integrations/1c/source/")) {
    const section = normalizedPath.slice("/integrations/1c/source/".length);
    if (method !== "GET") throw new ApiError(403, "ACCESS_POLICY_MISSING", "Раздел 1С доступен только для чтения");
    if (section === "warehouses") return "MATERIALS_VIEW";
    if (section === "receipts" || section === "contracts") return "ONE_C_SOURCE_FINANCE_VIEW";
    if (section === "specifications" || section === "production") return "RECIPES_VIEW";
    throw new ApiError(404, "ONE_C_SOURCE_SECTION_NOT_FOUND", "Раздел данных 1С не найден");
  }
  const isRead = method === "GET";

  if (normalizedPath === "/dashboard" || normalizedPath.startsWith("/dashboard/") || normalizedPath === "/meta") return "DASHBOARD_VIEW";
  if (normalizedPath.startsWith("/reports")) return "REPORTS_VIEW";
  if (normalizedPath.startsWith("/materials")) {
    if (isRead) return "MATERIALS_VIEW";
    return normalizedPath.includes("/consumptions") ? "MATERIALS_MOVE" : "MATERIALS_MANAGE";
  }
  if (normalizedPath.startsWith("/recipes")) return isRead ? "RECIPES_VIEW" : "RECIPES_MANAGE";
  if (normalizedPath.startsWith("/formulas")) {
    if (isRead) return "FORMULAS_VIEW";
    return normalizedPath.endsWith("/evaluate") ? "FORMULAS_EVALUATE" : "FORMULAS_MANAGE";
  }
  if (normalizedPath.startsWith("/calculator")) return "FORMULAS_EVALUATE";
  if (normalizedPath.startsWith("/batches")) {
    if (isRead) return "BATCHES_VIEW";
    if (normalizedPath.endsWith("/quality-checks")) return "QUALITY_MANAGE";
    if (/\/(start|consumption|complete)$/u.test(normalizedPath)) return "BATCHES_OPERATE";
    return "BATCHES_MANAGE";
  }
  if (normalizedPath.startsWith("/product-lots")) return isRead ? "PRODUCT_LOTS_VIEW" : "PRODUCT_LOTS_MANAGE";
  if (normalizedPath === "/transfers/one-c-sales") {
    if (!isRead) throw new ApiError(403, "ACCESS_POLICY_MISSING", "Реализации 1С доступны только для чтения");
    return "ACCOUNTING_VIEW";
  }
  if (normalizedPath.startsWith("/transfers")) {
    if (isRead) return "TRANSFERS_VIEW";
    return /\/(accept|return)$/u.test(normalizedPath) ? "TRANSFERS_ACCEPT" : "TRANSFERS_MANAGE";
  }
  if (normalizedPath.startsWith("/wagons")) return isRead ? "WAGONS_VIEW" : "WAGONS_MANAGE";
  if (normalizedPath.startsWith("/expenses")) return isRead ? "EXPENSES_VIEW" : "EXPENSES_MANAGE";
  if (normalizedPath.startsWith("/customers")) return isRead ? "CUSTOMERS_VIEW" : "CUSTOMERS_MANAGE";
  if (normalizedPath.startsWith("/attachments")) return isRead ? "ATTACHMENTS_VIEW" : "ATTACHMENTS_MANAGE";
  if (normalizedPath.startsWith("/adjustments")) return isRead ? "ADJUSTMENTS_VIEW" : "ADJUSTMENTS_MANAGE";
  if (normalizedPath === "/integrations/1c/finance") return "ACCOUNTING_VIEW";
  if (normalizedPath.startsWith("/integrations/1c")) return isRead ? "MATERIALS_VIEW" : "MATERIALS_MANAGE";
  if (normalizedPath.startsWith("/accounting")) return accountingPermission(method, normalizedPath);
  if (normalizedPath.startsWith("/admin/users")) return "USER_MANAGEMENT";
  if (normalizedPath.startsWith("/admin/company-profile")) return "COMPANY_PROFILE_MANAGEMENT";

  throw new ApiError(403, "ACCESS_POLICY_MISSING", "Для API-маршрута не настроена политика доступа");
}

function accountingPermission(method: string, path: string): Permission {
  if (method === "GET") return "ACCOUNTING_VIEW";
  if (path === "/accounting") return "ACCOUNTING_CREATE";
  if (path.endsWith("/issue")) return "ACCOUNTING_ISSUE_DIRECTLY";
  if (path.endsWith("/submit")) return "ACCOUNTING_SUBMIT";
  if (path.endsWith("/approve")) return "ACCOUNTING_APPROVE";
  if (path.endsWith("/pay")) return "ACCOUNTING_MARK_PAID";
  if (path.endsWith("/cancel")) return "ACCOUNTING_CANCEL";
  throw new ApiError(403, "ACCESS_POLICY_MISSING", "Для операции с бухгалтерским документом не настроена политика доступа");
}
