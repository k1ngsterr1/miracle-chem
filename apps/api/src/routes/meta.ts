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
    const [workspace, users, productionLines, productionTanks, productLots, customers] = await Promise.all([
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
      prisma.productionTank.findMany({
        where: { workspaceId, active: true },
        include: { productionLine: { select: { id: true, code: true, name: true } } },
        orderBy: { name: "asc" },
      }),
      prisma.productLot.findMany({
        where: { workspaceId, availableQuantity: { gt: 0 } },
        include: { batch: { select: { id: true, number: true } } },
        orderBy: { producedAt: "asc" },
      }),
      prisma.customer.findMany({
        where: { workspaceId, active: true },
        select: { id: true, name: true, taxId: true, contactPerson: true, contractNumber: true, paymentTermDays: true, creditLimit: true },
        orderBy: { name: "asc" },
      }),
    ]);
    const { passwordHash: _passwordHash, ...safeActor } = actor;
    return {
      workspace,
      actor: safeActor,
      users,
      productionLines,
      productionTanks,
      productLots,
      customers,
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
