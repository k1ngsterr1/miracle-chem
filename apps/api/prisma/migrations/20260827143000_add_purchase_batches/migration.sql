-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'PURCHASE_BATCH';

-- CreateTable
CREATE TABLE "purchase_batches" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "recipeVersionId" UUID,
    "targetSalePrice" DECIMAL(20,4),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'KZT',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchase_batches_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "material_lots" ADD COLUMN "purchaseBatchId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "purchase_batches_workspaceId_number_key" ON "purchase_batches"("workspaceId", "number");

-- CreateIndex
CREATE INDEX "purchase_batches_workspaceId_receivedAt_idx" ON "purchase_batches"("workspaceId", "receivedAt");

-- CreateIndex
CREATE INDEX "purchase_batches_recipeVersionId_idx" ON "purchase_batches"("recipeVersionId");

-- CreateIndex
CREATE INDEX "material_lots_purchaseBatchId_idx" ON "material_lots"("purchaseBatchId");

-- AddForeignKey
ALTER TABLE "purchase_batches" ADD CONSTRAINT "purchase_batches_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_batches" ADD CONSTRAINT "purchase_batches_recipeVersionId_fkey" FOREIGN KEY ("recipeVersionId") REFERENCES "recipe_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_purchaseBatchId_fkey" FOREIGN KEY ("purchaseBatchId") REFERENCES "purchase_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
