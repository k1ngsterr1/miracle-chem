import { Controller, Get, Req } from "@nestjs/common";
import {
  ExpenseCategory,
  ExpenseCostCenter,
  ExpensePaymentMethod,
  ExpenseStatus,
  FormulaRoundingMode,
  LrtTransferStatus,
  MaterialType,
  ProductionBatchStatus,
  RecipeStatus,
  Unit,
  UserRole,
  WagonStatus,
} from "../generated/prisma/index.js";
import { prisma } from "../lib/prisma.js";
import { getRequestContext } from "../lib/request-context.js";
import type { ApiRequest } from "../lib/http.js";

@Controller("meta")
export class MetaController {
  @Get()
  async meta(@Req() request: ApiRequest) {
    const { workspaceId, actor } = await getRequestContext(request, prisma);
    const [workspace, users, productionLines, productLots] = await Promise.all([
      prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
      prisma.user.findMany({
        where: { workspaceId, active: true },
        select: { id: true, name: true, email: true, role: true },
        orderBy: { name: "asc" },
      }),
      prisma.productionLine.findMany({
        where: { workspaceId, active: true },
        orderBy: { name: "asc" },
      }),
      prisma.productLot.findMany({
        where: { workspaceId, availableQuantity: { gt: 0 } },
        include: { batch: { select: { id: true, number: true } } },
        orderBy: { producedAt: "asc" },
      }),
    ]);
    return {
      workspace,
      actor,
      users,
      productionLines,
      productLots,
      enums: {
        units: Object.values(Unit),
        materialTypes: Object.values(MaterialType),
        recipeStatuses: Object.values(RecipeStatus),
        batchStatuses: Object.values(ProductionBatchStatus),
        transferStatuses: Object.values(LrtTransferStatus),
        userRoles: Object.values(UserRole),
        roundingModes: Object.values(FormulaRoundingMode),
        wagonStatuses: Object.values(WagonStatus),
        expenseCategories: Object.values(ExpenseCategory),
        expenseCostCenters: Object.values(ExpenseCostCenter),
        expensePaymentMethods: Object.values(ExpensePaymentMethod),
        expenseStatuses: Object.values(ExpenseStatus),
      },
    };
  }
}
