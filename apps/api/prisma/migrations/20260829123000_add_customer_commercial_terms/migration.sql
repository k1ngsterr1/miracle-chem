ALTER TABLE "customers"
  ADD COLUMN "contractNumber" TEXT,
  ADD COLUMN "contractSignedAt" TIMESTAMP(3),
  ADD COLUMN "contractValidUntil" TIMESTAMP(3),
  ADD COLUMN "paymentTermDays" INTEGER,
  ADD COLUMN "creditLimit" DECIMAL(20, 2);

CREATE INDEX "customers_workspaceId_contractValidUntil_idx" ON "customers"("workspaceId", "contractValidUntil");
