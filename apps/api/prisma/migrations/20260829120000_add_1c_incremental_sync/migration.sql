CREATE TYPE "OneCSyncRunStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');
CREATE TYPE "OneCSyncReviewStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
CREATE TYPE "OneCSyncEntityType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'MATERIAL', 'PURCHASE_RECEIPT', 'ACCOUNTING_DOCUMENT');

ALTER TYPE "AuditEntityType" ADD VALUE 'ONE_C_SYNC';

CREATE TABLE "one_c_sync_runs" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "source" VARCHAR(40) NOT NULL DEFAULT '1C',
  "batchId" VARCHAR(160) NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL,
  "status" "OneCSyncRunStatus" NOT NULL DEFAULT 'PROCESSING',
  "summary" JSONB,
  "error" JSONB,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "one_c_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "one_c_external_references" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "source" VARCHAR(40) NOT NULL DEFAULT '1C',
  "entityType" "OneCSyncEntityType" NOT NULL,
  "externalId" VARCHAR(200) NOT NULL,
  "internalId" UUID NOT NULL,
  "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
  "payloadHash" VARCHAR(64) NOT NULL,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "one_c_external_references_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "one_c_sync_reviews" (
  "id" UUID NOT NULL,
  "workspaceId" UUID NOT NULL,
  "source" VARCHAR(40) NOT NULL DEFAULT '1C',
  "entityType" "OneCSyncEntityType" NOT NULL,
  "externalId" VARCHAR(200) NOT NULL,
  "payload" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "status" "OneCSyncReviewStatus" NOT NULL DEFAULT 'PENDING',
  "resolvedAt" TIMESTAMP(3),
  "resolvedById" UUID,
  "resolutionNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "one_c_sync_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "one_c_sync_runs_workspaceId_source_batchId_key" ON "one_c_sync_runs"("workspaceId", "source", "batchId");
CREATE INDEX "one_c_sync_runs_workspaceId_startedAt_idx" ON "one_c_sync_runs"("workspaceId", "startedAt");
CREATE UNIQUE INDEX "one_c_external_references_workspaceId_source_entityType_externalId_key" ON "one_c_external_references"("workspaceId", "source", "entityType", "externalId");
CREATE INDEX "one_c_external_references_workspaceId_entityType_internalId_idx" ON "one_c_external_references"("workspaceId", "entityType", "internalId");
CREATE UNIQUE INDEX "one_c_sync_reviews_workspaceId_source_entityType_externalId_key" ON "one_c_sync_reviews"("workspaceId", "source", "entityType", "externalId");
CREATE INDEX "one_c_sync_reviews_workspaceId_status_createdAt_idx" ON "one_c_sync_reviews"("workspaceId", "status", "createdAt");

ALTER TABLE "one_c_sync_runs" ADD CONSTRAINT "one_c_sync_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "one_c_external_references" ADD CONSTRAINT "one_c_external_references_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "one_c_sync_reviews" ADD CONSTRAINT "one_c_sync_reviews_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
