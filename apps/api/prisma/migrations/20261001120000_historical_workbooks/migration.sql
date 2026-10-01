CREATE TABLE "historical_workbooks" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sourceKey" VARCHAR(80) NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "payload" JSONB NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "historical_workbooks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "historical_workbooks_workspaceId_sourceKey_sha256_key"
    ON "historical_workbooks"("workspaceId", "sourceKey", "sha256");
CREATE INDEX "historical_workbooks_workspaceId_sourceKey_active_idx"
    ON "historical_workbooks"("workspaceId", "sourceKey", "active");
CREATE UNIQUE INDEX "historical_workbooks_one_active_per_source_idx"
    ON "historical_workbooks"("workspaceId", "sourceKey") WHERE "active" = true;
ALTER TABLE "historical_workbooks" ADD CONSTRAINT "historical_workbooks_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
