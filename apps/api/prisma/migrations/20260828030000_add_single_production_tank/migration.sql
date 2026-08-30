CREATE TABLE "production_tanks" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "productionLineId" UUID NOT NULL,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "capacity" DECIMAL(20,6),
  "capacityUnit" "Unit" NOT NULL DEFAULT 'M3',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "production_tanks_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "production_batches" ADD COLUMN "productionTankId" UUID;

CREATE UNIQUE INDEX "production_tanks_workspaceId_code_key" ON "production_tanks"("workspaceId", "code");
CREATE INDEX "production_tanks_workspaceId_active_idx" ON "production_tanks"("workspaceId", "active");
CREATE INDEX "production_tanks_productionLineId_active_idx" ON "production_tanks"("productionLineId", "active");
CREATE INDEX "production_batches_workspaceId_productionTankId_scheduledAt_idx" ON "production_batches"("workspaceId", "productionTankId", "scheduledAt");

ALTER TABLE "production_tanks" ADD CONSTRAINT "production_tanks_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "production_tanks" ADD CONSTRAINT "production_tanks_productionLineId_fkey" FOREIGN KEY ("productionLineId") REFERENCES "production_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_productionTankId_fkey" FOREIGN KEY ("productionTankId") REFERENCES "production_tanks"("id") ON DELETE SET NULL ON UPDATE CASCADE;
