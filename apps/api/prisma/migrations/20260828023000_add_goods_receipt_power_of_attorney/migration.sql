ALTER TYPE "AccountingDocumentType" ADD VALUE IF NOT EXISTS 'POWER_OF_ATTORNEY';

ALTER TABLE "accounting_documents" ADD COLUMN "details" JSONB;
