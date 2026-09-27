CREATE TABLE "one_c_source_snapshots" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sourceInstanceId" UUID NOT NULL,
    "organizationExternalId" UUID NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "one_c_source_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "one_c_source_snapshots_workspaceId_sourceInstanceId_sha256_key"
    ON "one_c_source_snapshots"("workspaceId", "sourceInstanceId", "sha256");
CREATE INDEX "one_c_source_snapshots_workspaceId_generatedAt_idx"
    ON "one_c_source_snapshots"("workspaceId", "generatedAt");
ALTER TABLE "one_c_source_snapshots"
    ADD CONSTRAINT "one_c_source_snapshots_workspaceId_fkey"
    FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
