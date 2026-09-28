CREATE TABLE "one_c_archive_imports" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "sourceInstanceId" UUID NOT NULL,
    "archiveId" VARCHAR(64) NOT NULL,
    "configuration" VARCHAR(160) NOT NULL,
    "configurationVersion" VARCHAR(80) NOT NULL,
    "readStartedAt" TIMESTAMP(3) NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "manifestSha256" VARCHAR(64) NOT NULL,
    "manifest" JSONB NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'STAGING',
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "one_c_archive_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "one_c_archive_chunks" (
    "id" UUID NOT NULL,
    "importId" UUID NOT NULL,
    "collectionKey" VARCHAR(512) NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "encryptedData" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "one_c_archive_chunks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "one_c_archive_imports_workspaceId_sourceInstanceId_archiveId_key" ON "one_c_archive_imports"("workspaceId", "sourceInstanceId", "archiveId");
CREATE INDEX "one_c_archive_imports_workspaceId_status_generatedAt_idx" ON "one_c_archive_imports"("workspaceId", "status", "generatedAt");
CREATE UNIQUE INDEX "one_c_archive_chunks_importId_collectionKey_chunkIndex_key" ON "one_c_archive_chunks"("importId", "collectionKey", "chunkIndex");
CREATE INDEX "one_c_archive_chunks_importId_collectionKey_idx" ON "one_c_archive_chunks"("importId", "collectionKey");
ALTER TABLE "one_c_archive_imports" ADD CONSTRAINT "one_c_archive_imports_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "one_c_archive_chunks" ADD CONSTRAINT "one_c_archive_chunks_importId_fkey" FOREIGN KEY ("importId") REFERENCES "one_c_archive_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
