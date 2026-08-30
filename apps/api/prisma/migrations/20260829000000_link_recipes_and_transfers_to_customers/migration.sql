-- Keep historical records readable; all newly created recipes and shipments require a client in the API.
ALTER TABLE "recipes" ADD COLUMN "customerId" UUID;
ALTER TABLE "lrt_transfers" ADD COLUMN "customerId" UUID;

CREATE INDEX "recipes_workspaceId_customerId_status_idx"
ON "recipes"("workspaceId", "customerId", "status");

CREATE INDEX "lrt_transfers_workspaceId_customerId_transferAt_idx"
ON "lrt_transfers"("workspaceId", "customerId", "transferAt");

ALTER TABLE "recipes" ADD CONSTRAINT "recipes_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "lrt_transfers" ADD CONSTRAINT "lrt_transfers_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
