-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'TECHNOLOGIST', 'OPERATOR', 'STOREKEEPER', 'QUALITY_MANAGER', 'LRT_RECEIVER', 'VIEWER');

-- CreateEnum
CREATE TYPE "MaterialType" AS ENUM ('CEMENT', 'WATER', 'SAND', 'AGGREGATE', 'CHEMICAL_ADDITIVE', 'REAGENT', 'OTHER');

-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('G', 'KG', 'T', 'ML', 'L', 'M3');

-- CreateEnum
CREATE TYPE "RecipeStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FormulaRoundingMode" AS ENUM ('HALF_UP', 'UP', 'DOWN');

-- CreateEnum
CREATE TYPE "ProductionBatchStatus" AS ENUM ('PLANNED', 'PREPARATION', 'IN_PROGRESS', 'COMPLETED', 'PARTIALLY_TRANSFERRED', 'FULLY_TRANSFERRED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "MaterialMovementType" AS ENUM ('RECEIPT', 'RESERVATION', 'RESERVATION_RELEASE', 'CONSUMPTION', 'RETURN', 'LOSS', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "ProductLotStatus" AS ENUM ('AVAILABLE', 'PARTIALLY_DISPATCHED', 'DEPLETED', 'BLOCKED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ProductMovementType" AS ENUM ('PRODUCTION', 'LRT_DISPATCH', 'LRT_RETURN', 'WRITEOFF', 'REJECT', 'OTHER_SHIPMENT', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "LrtTransferStatus" AS ENUM ('DRAFT', 'PREPARED', 'SENT', 'ACCEPTED', 'PARTIALLY_ACCEPTED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "QualityCheckStatus" AS ENUM ('PENDING', 'PASSED', 'FAILED', 'CONDITIONAL');

-- CreateEnum
CREATE TYPE "AdjustmentStatus" AS ENUM ('DRAFT', 'APPROVED', 'APPLIED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdjustmentTargetType" AS ENUM ('MATERIAL_LOT', 'PRODUCTION_BATCH', 'PRODUCT_LOT', 'LRT_TRANSFER');

-- CreateEnum
CREATE TYPE "AuditEntityType" AS ENUM ('WORKSPACE', 'USER', 'PRODUCTION_LINE', 'MATERIAL', 'MATERIAL_LOT', 'RECIPE', 'RECIPE_VERSION', 'FORMULA', 'PRODUCTION_BATCH', 'PRODUCT_LOT', 'LRT_TRANSFER', 'QUALITY_CHECK', 'ADJUSTMENT');

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Almaty',
    "currency" VARCHAR(3) NOT NULL DEFAULT 'KZT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_lines" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" DECIMAL(20,6) NOT NULL,
    "capacityUnit" "Unit" NOT NULL DEFAULT 'M3',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "contact" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "MaterialType" NOT NULL,
    "baseUnit" "Unit" NOT NULL,
    "densityKgPerM3" DECIMAL(20,6),
    "costPerBaseUnit" DECIMAL(20,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'KZT',
    "currentStock" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "reservedStock" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "minimumStock" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_lots" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "supplierId" UUID,
    "lotNumber" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "certificateNumber" TEXT,
    "certificateUrl" TEXT,
    "initialQuantity" DECIMAL(20,6) NOT NULL,
    "availableQuantity" DECIMAL(20,6) NOT NULL,
    "reservedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "unit" "Unit" NOT NULL,
    "unitCost" DECIMAL(20,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'KZT',
    "densityKgPerM3" DECIMAL(20,6),
    "qualitySnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "material_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "RecipeStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_versions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "recipeId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "concreteGrade" TEXT NOT NULL,
    "baseBatchVolume" DECIMAL(20,6) NOT NULL,
    "volumeUnit" "Unit" NOT NULL DEFAULT 'M3',
    "waterCementRatio" DECIMAL(12,6),
    "plannedYield" DECIMAL(20,6) NOT NULL,
    "yieldUnit" "Unit" NOT NULL DEFAULT 'M3',
    "technologyInstructions" TEXT NOT NULL,
    "snapshotHash" VARCHAR(64) NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipe_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recipe_components" (
    "id" UUID NOT NULL,
    "recipeVersionId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "normPerM3" DECIMAL(20,6) NOT NULL,
    "unit" "Unit" NOT NULL,
    "allowedDeviationPercent" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "moisturePercent" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "absorptionPercent" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipe_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulas" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "formulas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formula_versions" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "formulaId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "expression" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "precision" INTEGER NOT NULL DEFAULT 3,
    "roundingMode" "FormulaRoundingMode" NOT NULL DEFAULT 'HALF_UP',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formula_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formula_calculation_logs" (
    "id" UUID NOT NULL,
    "formulaVersionId" UUID NOT NULL,
    "batchId" UUID,
    "input" JSONB NOT NULL,
    "resultValue" DECIMAL(30,12) NOT NULL,
    "resultUnit" "Unit",
    "trace" JSONB NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formula_calculation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_batches" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "ProductionBatchStatus" NOT NULL DEFAULT 'PLANNED',
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "recipeVersionId" UUID NOT NULL,
    "recipeSnapshot" JSONB NOT NULL,
    "formulaSnapshot" JSONB NOT NULL,
    "concreteGrade" TEXT NOT NULL,
    "plannedVolume" DECIMAL(20,6) NOT NULL,
    "plannedVolumeUnit" "Unit" NOT NULL DEFAULT 'M3',
    "actualVolume" DECIMAL(20,6),
    "actualVolumeUnit" "Unit" NOT NULL DEFAULT 'M3',
    "plannedOutput" DECIMAL(20,6) NOT NULL,
    "plannedOutputUnit" "Unit" NOT NULL DEFAULT 'M3',
    "actualOutput" DECIMAL(20,6),
    "actualOutputUnit" "Unit" NOT NULL DEFAULT 'M3',
    "goodOutput" DECIMAL(20,6),
    "rejectedOutput" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "technologicalLoss" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "sentToLrt" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "availableOutput" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "outputAccountingUnit" "Unit" NOT NULL DEFAULT 'M3',
    "totalCost" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "costPerOutputUnit" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'KZT',
    "operatorId" UUID NOT NULL,
    "productionLineId" UUID NOT NULL,
    "qualitySummary" JSONB,
    "comments" TEXT,
    "negativeStockOverride" BOOLEAN NOT NULL DEFAULT false,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_components" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "materialNameSnapshot" TEXT NOT NULL,
    "materialTypeSnapshot" "MaterialType" NOT NULL,
    "plannedQuantity" DECIMAL(20,6) NOT NULL,
    "plannedUnit" "Unit" NOT NULL,
    "reservedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "reservedUnit" "Unit" NOT NULL,
    "actualQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "actualUnit" "Unit" NOT NULL,
    "returnedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "returnedUnit" "Unit" NOT NULL,
    "lossQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "lossUnit" "Unit" NOT NULL,
    "deviationQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "deviationUnit" "Unit" NOT NULL,
    "deviationPercent" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "allowedDeviationPercent" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "withinTolerance" BOOLEAN NOT NULL DEFAULT true,
    "unitCostSnapshot" DECIMAL(20,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'KZT',
    "componentCost" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "moisturePercent" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "absorptionPercent" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_material_allocations" (
    "id" UUID NOT NULL,
    "batchComponentId" UUID NOT NULL,
    "materialLotId" UUID NOT NULL,
    "reservedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "consumedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "returnedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "lossQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "unit" "Unit" NOT NULL,
    "unitCostSnapshot" DECIMAL(20,4) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_material_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "material_movements" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "materialLotId" UUID NOT NULL,
    "batchId" UUID,
    "type" "MaterialMovementType" NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unit" "Unit" NOT NULL,
    "baseQuantity" DECIMAL(20,6) NOT NULL,
    "baseUnit" "Unit" NOT NULL,
    "stockBefore" DECIMAL(20,6) NOT NULL,
    "stockAfter" DECIMAL(20,6) NOT NULL,
    "reservedBefore" DECIMAL(20,6) NOT NULL,
    "reservedAfter" DECIMAL(20,6) NOT NULL,
    "idempotencyKey" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_lots" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "concreteGrade" TEXT NOT NULL,
    "status" "ProductLotStatus" NOT NULL DEFAULT 'AVAILABLE',
    "producedQuantity" DECIMAL(20,6) NOT NULL,
    "goodQuantity" DECIMAL(20,6) NOT NULL,
    "rejectedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "lossQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "sentToLrtQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "returnedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "writtenOffQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "otherShipmentQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "availableQuantity" DECIMAL(20,6) NOT NULL,
    "unit" "Unit" NOT NULL,
    "densityKgPerM3" DECIMAL(20,6),
    "totalCost" DECIMAL(20,4) NOT NULL,
    "unitCost" DECIMAL(20,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'KZT',
    "qualitySnapshot" JSONB,
    "producedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_lot_material_trace" (
    "id" UUID NOT NULL,
    "productLotId" UUID NOT NULL,
    "allocationId" UUID NOT NULL,
    "consumedQuantity" DECIMAL(20,6) NOT NULL,
    "unit" "Unit" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_lot_material_trace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lrt_transfers" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "LrtTransferStatus" NOT NULL DEFAULT 'DRAFT',
    "transferAt" TIMESTAMP(3) NOT NULL,
    "senderId" UUID NOT NULL,
    "receiverId" UUID,
    "receiverName" TEXT,
    "transport" TEXT,
    "comments" TEXT,
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lrt_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lrt_transfer_items" (
    "id" UUID NOT NULL,
    "transferId" UUID NOT NULL,
    "productLotId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "requestedQuantity" DECIMAL(20,6) NOT NULL,
    "sentQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "acceptedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "returnedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "rejectedQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "unit" "Unit" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lrt_transfer_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_movements" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "productLotId" UUID NOT NULL,
    "transferItemId" UUID,
    "type" "ProductMovementType" NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unit" "Unit" NOT NULL,
    "balanceBefore" DECIMAL(20,6) NOT NULL,
    "balanceAfter" DECIMAL(20,6) NOT NULL,
    "idempotencyKey" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_checks" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "performedById" UUID NOT NULL,
    "status" "QualityCheckStatus" NOT NULL DEFAULT 'PENDING',
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "slumpMm" DECIMAL(12,3),
    "temperatureC" DECIMAL(12,3),
    "densityKgPerM3" DECIMAL(20,6),
    "strengthMpa" DECIMAL(12,3),
    "metrics" JSONB,
    "comments" TEXT,

    CONSTRAINT "quality_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "url" TEXT,
    "materialLotId" UUID,
    "transferId" UUID,
    "qualityCheckId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "adjustment_documents" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'DRAFT',
    "targetType" "AdjustmentTargetType" NOT NULL,
    "targetId" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "changes" JSONB NOT NULL,
    "createdById" UUID NOT NULL,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "appliedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "adjustment_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" "AuditEntityType" NOT NULL,
    "entityId" UUID NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "requestId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_workspaceId_role_active_idx" ON "users"("workspaceId", "role", "active");

-- CreateIndex
CREATE UNIQUE INDEX "users_workspaceId_email_key" ON "users"("workspaceId", "email");

-- CreateIndex
CREATE INDEX "production_lines_workspaceId_active_idx" ON "production_lines"("workspaceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "production_lines_workspaceId_code_key" ON "production_lines"("workspaceId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_workspaceId_name_key" ON "suppliers"("workspaceId", "name");

-- CreateIndex
CREATE INDEX "materials_workspaceId_type_active_idx" ON "materials"("workspaceId", "type", "active");

-- CreateIndex
CREATE INDEX "materials_workspaceId_currentStock_minimumStock_idx" ON "materials"("workspaceId", "currentStock", "minimumStock");

-- CreateIndex
CREATE UNIQUE INDEX "materials_workspaceId_code_key" ON "materials"("workspaceId", "code");

-- CreateIndex
CREATE INDEX "material_lots_workspaceId_materialId_expiresAt_idx" ON "material_lots"("workspaceId", "materialId", "expiresAt");

-- CreateIndex
CREATE INDEX "material_lots_workspaceId_availableQuantity_idx" ON "material_lots"("workspaceId", "availableQuantity");

-- CreateIndex
CREATE UNIQUE INDEX "material_lots_workspaceId_materialId_lotNumber_key" ON "material_lots"("workspaceId", "materialId", "lotNumber");

-- CreateIndex
CREATE INDEX "recipes_workspaceId_status_idx" ON "recipes"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_workspaceId_code_key" ON "recipes"("workspaceId", "code");

-- CreateIndex
CREATE INDEX "recipe_versions_workspaceId_concreteGrade_idx" ON "recipe_versions"("workspaceId", "concreteGrade");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_versions_recipeId_version_key" ON "recipe_versions"("recipeId", "version");

-- CreateIndex
CREATE INDEX "recipe_components_recipeVersionId_position_idx" ON "recipe_components"("recipeVersionId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "recipe_components_recipeVersionId_materialId_key" ON "recipe_components"("recipeVersionId", "materialId");

-- CreateIndex
CREATE INDEX "formulas_workspaceId_active_idx" ON "formulas"("workspaceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "formulas_workspaceId_code_key" ON "formulas"("workspaceId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "formula_versions_formulaId_version_key" ON "formula_versions"("formulaId", "version");

-- CreateIndex
CREATE INDEX "formula_calculation_logs_batchId_calculatedAt_idx" ON "formula_calculation_logs"("batchId", "calculatedAt");

-- CreateIndex
CREATE INDEX "production_batches_workspaceId_status_scheduledAt_idx" ON "production_batches"("workspaceId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "production_batches_workspaceId_productionLineId_scheduledAt_idx" ON "production_batches"("workspaceId", "productionLineId", "scheduledAt");

-- CreateIndex
CREATE INDEX "production_batches_workspaceId_operatorId_scheduledAt_idx" ON "production_batches"("workspaceId", "operatorId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "production_batches_workspaceId_number_key" ON "production_batches"("workspaceId", "number");

-- CreateIndex
CREATE INDEX "batch_components_batchId_withinTolerance_idx" ON "batch_components"("batchId", "withinTolerance");

-- CreateIndex
CREATE UNIQUE INDEX "batch_components_batchId_materialId_key" ON "batch_components"("batchId", "materialId");

-- CreateIndex
CREATE INDEX "batch_material_allocations_materialLotId_idx" ON "batch_material_allocations"("materialLotId");

-- CreateIndex
CREATE UNIQUE INDEX "batch_material_allocations_batchComponentId_materialLotId_key" ON "batch_material_allocations"("batchComponentId", "materialLotId");

-- CreateIndex
CREATE INDEX "material_movements_workspaceId_materialLotId_occurredAt_idx" ON "material_movements"("workspaceId", "materialLotId", "occurredAt");

-- CreateIndex
CREATE INDEX "material_movements_workspaceId_batchId_occurredAt_idx" ON "material_movements"("workspaceId", "batchId", "occurredAt");

-- CreateIndex
CREATE INDEX "material_movements_workspaceId_idempotencyKey_idx" ON "material_movements"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "product_lots_workspaceId_status_producedAt_idx" ON "product_lots"("workspaceId", "status", "producedAt");

-- CreateIndex
CREATE INDEX "product_lots_workspaceId_concreteGrade_producedAt_idx" ON "product_lots"("workspaceId", "concreteGrade", "producedAt");

-- CreateIndex
CREATE UNIQUE INDEX "product_lots_workspaceId_number_key" ON "product_lots"("workspaceId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "product_lots_batchId_key" ON "product_lots"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "product_lot_material_trace_productLotId_allocationId_key" ON "product_lot_material_trace"("productLotId", "allocationId");

-- CreateIndex
CREATE INDEX "lrt_transfers_workspaceId_status_transferAt_idx" ON "lrt_transfers"("workspaceId", "status", "transferAt");

-- CreateIndex
CREATE UNIQUE INDEX "lrt_transfers_workspaceId_number_key" ON "lrt_transfers"("workspaceId", "number");

-- CreateIndex
CREATE INDEX "lrt_transfer_items_batchId_idx" ON "lrt_transfer_items"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "lrt_transfer_items_transferId_productLotId_key" ON "lrt_transfer_items"("transferId", "productLotId");

-- CreateIndex
CREATE INDEX "product_movements_workspaceId_productLotId_occurredAt_idx" ON "product_movements"("workspaceId", "productLotId", "occurredAt");

-- CreateIndex
CREATE INDEX "product_movements_workspaceId_idempotencyKey_idx" ON "product_movements"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "quality_checks_workspaceId_batchId_checkedAt_idx" ON "quality_checks"("workspaceId", "batchId", "checkedAt");

-- CreateIndex
CREATE INDEX "attachments_materialLotId_idx" ON "attachments"("materialLotId");

-- CreateIndex
CREATE INDEX "attachments_transferId_idx" ON "attachments"("transferId");

-- CreateIndex
CREATE INDEX "attachments_qualityCheckId_idx" ON "attachments"("qualityCheckId");

-- CreateIndex
CREATE INDEX "adjustment_documents_workspaceId_targetType_targetId_idx" ON "adjustment_documents"("workspaceId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "adjustment_documents_workspaceId_number_key" ON "adjustment_documents"("workspaceId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "adjustment_documents_workspaceId_idempotencyKey_key" ON "adjustment_documents"("workspaceId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "audit_logs_workspaceId_entityType_entityId_occurredAt_idx" ON "audit_logs"("workspaceId", "entityType", "entityId", "occurredAt");

-- CreateIndex
CREATE INDEX "audit_logs_workspaceId_actorId_occurredAt_idx" ON "audit_logs"("workspaceId", "actorId", "occurredAt");

-- CreateIndex
CREATE INDEX "idempotency_records_expiresAt_idx" ON "idempotency_records"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_workspaceId_scope_key_key" ON "idempotency_records"("workspaceId", "scope", "key");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_lines" ADD CONSTRAINT "production_lines_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "materials" ADD CONSTRAINT "materials_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_lots" ADD CONSTRAINT "material_lots_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipes" ADD CONSTRAINT "recipes_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_versions" ADD CONSTRAINT "recipe_versions_recipeId_fkey" FOREIGN KEY ("recipeId") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_components" ADD CONSTRAINT "recipe_components_recipeVersionId_fkey" FOREIGN KEY ("recipeVersionId") REFERENCES "recipe_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recipe_components" ADD CONSTRAINT "recipe_components_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulas" ADD CONSTRAINT "formulas_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formula_versions" ADD CONSTRAINT "formula_versions_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formula_versions" ADD CONSTRAINT "formula_versions_formulaId_fkey" FOREIGN KEY ("formulaId") REFERENCES "formulas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formula_calculation_logs" ADD CONSTRAINT "formula_calculation_logs_formulaVersionId_fkey" FOREIGN KEY ("formulaVersionId") REFERENCES "formula_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formula_calculation_logs" ADD CONSTRAINT "formula_calculation_logs_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "production_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_recipeVersionId_fkey" FOREIGN KEY ("recipeVersionId") REFERENCES "recipe_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_batches" ADD CONSTRAINT "production_batches_productionLineId_fkey" FOREIGN KEY ("productionLineId") REFERENCES "production_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_components" ADD CONSTRAINT "batch_components_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "production_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_components" ADD CONSTRAINT "batch_components_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_material_allocations" ADD CONSTRAINT "batch_material_allocations_batchComponentId_fkey" FOREIGN KEY ("batchComponentId") REFERENCES "batch_components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_material_allocations" ADD CONSTRAINT "batch_material_allocations_materialLotId_fkey" FOREIGN KEY ("materialLotId") REFERENCES "material_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_movements" ADD CONSTRAINT "material_movements_materialLotId_fkey" FOREIGN KEY ("materialLotId") REFERENCES "material_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_movements" ADD CONSTRAINT "material_movements_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "production_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_lots" ADD CONSTRAINT "product_lots_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_lots" ADD CONSTRAINT "product_lots_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "production_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_lot_material_trace" ADD CONSTRAINT "product_lot_material_trace_productLotId_fkey" FOREIGN KEY ("productLotId") REFERENCES "product_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_lot_material_trace" ADD CONSTRAINT "product_lot_material_trace_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "batch_material_allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lrt_transfers" ADD CONSTRAINT "lrt_transfers_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lrt_transfers" ADD CONSTRAINT "lrt_transfers_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lrt_transfers" ADD CONSTRAINT "lrt_transfers_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lrt_transfer_items" ADD CONSTRAINT "lrt_transfer_items_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "lrt_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lrt_transfer_items" ADD CONSTRAINT "lrt_transfer_items_productLotId_fkey" FOREIGN KEY ("productLotId") REFERENCES "product_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lrt_transfer_items" ADD CONSTRAINT "lrt_transfer_items_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "production_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_movements" ADD CONSTRAINT "product_movements_productLotId_fkey" FOREIGN KEY ("productLotId") REFERENCES "product_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_movements" ADD CONSTRAINT "product_movements_transferItemId_fkey" FOREIGN KEY ("transferItemId") REFERENCES "lrt_transfer_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "production_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_checks" ADD CONSTRAINT "quality_checks_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_materialLotId_fkey" FOREIGN KEY ("materialLotId") REFERENCES "material_lots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "lrt_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_qualityCheckId_fkey" FOREIGN KEY ("qualityCheckId") REFERENCES "quality_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_documents" ADD CONSTRAINT "adjustment_documents_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_documents" ADD CONSTRAINT "adjustment_documents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "adjustment_documents" ADD CONSTRAINT "adjustment_documents_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
