-- CreateEnum
CREATE TYPE "WagonStatus" AS ENUM ('EMPTY', 'LOADING', 'LOADED', 'IN_TRANSIT', 'AT_DESTINATION', 'UNLOADING', 'RETURNING', 'MAINTENANCE');

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'WAGON';

-- CreateTable
CREATE TABLE "material_price_history" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "pricePerBaseUnit" DECIMAL(20,4) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'KZT',
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "referenceId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "material_price_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wagons" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "capacity" DECIMAL(20,6) NOT NULL,
    "capacityUnit" "Unit" NOT NULL DEFAULT 'M3',
    "tareWeightT" DECIMAL(20,6),
    "status" "WagonStatus" NOT NULL DEFAULT 'EMPTY',
    "currentLocation" TEXT NOT NULL,
    "cargoDescription" TEXT,
    "cargoQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "cargoUnit" "Unit" NOT NULL DEFAULT 'M3',
    "shipmentNumber" TEXT,
    "lastReportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wagons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wagon_location_events" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "wagonId" UUID NOT NULL,
    "status" "WagonStatus" NOT NULL,
    "location" TEXT NOT NULL,
    "cargoDescription" TEXT,
    "cargoQuantity" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "cargoUnit" "Unit" NOT NULL DEFAULT 'M3',
    "shipmentNumber" TEXT,
    "note" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wagon_location_events_pkey" PRIMARY KEY ("id")
);

-- Backfill the price ledger so every existing warehouse item starts with a traceable price.
INSERT INTO "material_price_history" (
    "id",
    "workspaceId",
    "materialId",
    "pricePerBaseUnit",
    "currency",
    "effectiveAt",
    "source",
    "note"
)
SELECT
    gen_random_uuid(),
    "workspaceId",
    "id",
    "costPerBaseUnit",
    "currency",
    "updatedAt",
    'BACKFILL',
    'Начальная цена при включении журнала цен'
FROM "materials";

-- CreateIndex
CREATE INDEX "material_price_history_workspaceId_materialId_effectiveAt_idx" ON "material_price_history"("workspaceId", "materialId", "effectiveAt");

-- CreateIndex
CREATE INDEX "material_price_history_referenceId_idx" ON "material_price_history"("referenceId");

-- CreateIndex
CREATE INDEX "wagons_workspaceId_status_lastReportedAt_idx" ON "wagons"("workspaceId", "status", "lastReportedAt");

-- CreateIndex
CREATE UNIQUE INDEX "wagons_workspaceId_number_key" ON "wagons"("workspaceId", "number");

-- CreateIndex
CREATE INDEX "wagon_location_events_workspaceId_occurredAt_idx" ON "wagon_location_events"("workspaceId", "occurredAt");

-- CreateIndex
CREATE INDEX "wagon_location_events_wagonId_occurredAt_idx" ON "wagon_location_events"("wagonId", "occurredAt");

-- AddForeignKey
ALTER TABLE "material_price_history" ADD CONSTRAINT "material_price_history_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_price_history" ADD CONSTRAINT "material_price_history_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wagons" ADD CONSTRAINT "wagons_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wagon_location_events" ADD CONSTRAINT "wagon_location_events_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wagon_location_events" ADD CONSTRAINT "wagon_location_events_wagonId_fkey" FOREIGN KEY ("wagonId") REFERENCES "wagons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wagon_location_events" ADD CONSTRAINT "wagon_location_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
