-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('RAW_MATERIALS', 'LOGISTICS', 'UTILITIES', 'MAINTENANCE', 'SALARY', 'TAXES', 'RENT', 'LABORATORY', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseCostCenter" AS ENUM ('PRODUCTION', 'WAREHOUSE', 'LOGISTICS', 'LABORATORY', 'ADMINISTRATION', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpensePaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'CORPORATE_CARD', 'OFFSET', 'OTHER');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('RECORDED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'EXPENSE';

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "category" "ExpenseCategory" NOT NULL,
    "costCenter" "ExpenseCostCenter" NOT NULL,
    "paymentMethod" "ExpensePaymentMethod" NOT NULL,
    "status" "ExpenseStatus" NOT NULL DEFAULT 'RECORDED',
    "incurredAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'KZT',
    "description" TEXT NOT NULL,
    "counterparty" TEXT,
    "documentNumber" TEXT,
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "expenses_workspaceId_incurredAt_idx" ON "expenses"("workspaceId", "incurredAt");

-- CreateIndex
CREATE INDEX "expenses_workspaceId_status_category_incurredAt_idx" ON "expenses"("workspaceId", "status", "category", "incurredAt");

-- CreateIndex
CREATE INDEX "expenses_workspaceId_costCenter_incurredAt_idx" ON "expenses"("workspaceId", "costCenter", "incurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_workspaceId_number_key" ON "expenses"("workspaceId", "number");

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
