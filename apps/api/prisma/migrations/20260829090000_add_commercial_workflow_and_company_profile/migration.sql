ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DIRECTOR';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MANAGER';

ALTER TYPE "AccountingDocumentStatus" ADD VALUE IF NOT EXISTS 'PENDING_DIRECTOR_APPROVAL';
ALTER TYPE "AccountingDocumentStatus" ADD VALUE IF NOT EXISTS 'PENDING_ACCOUNTANT_APPROVAL';

CREATE TABLE "company_profiles" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "legalName" TEXT,
    "taxId" TEXT,
    "address" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "bankName" TEXT,
    "iban" TEXT,
    "bic" TEXT,
    "directorName" TEXT,
    "accountantName" TEXT,
    "signatoryName" TEXT,
    "signatoryPosition" TEXT,
    "documentFooter" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "company_profiles_workspaceId_key" ON "company_profiles"("workspaceId");

ALTER TABLE "company_profiles" ADD CONSTRAINT "company_profiles_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "accounting_documents" ADD COLUMN "customerId" UUID;
CREATE INDEX "accounting_documents_workspaceId_customerId_documentAt_idx"
ON "accounting_documents"("workspaceId", "customerId", "documentAt");
ALTER TABLE "accounting_documents" ADD CONSTRAINT "accounting_documents_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
