-- Preserve historical document snapshots while linking documents that already have a client shipment.
UPDATE "accounting_documents" AS document
SET "customerId" = transfer."customerId"
FROM "lrt_transfers" AS transfer
WHERE document."transferId" = transfer."id"
  AND document."customerId" IS NULL
  AND transfer."customerId" IS NOT NULL;
