-- CreateEnum
CREATE TYPE "AccountingDocumentType" AS ENUM ('WAYBILL', 'PAYMENT_INVOICE', 'COMPLETION_ACT');

-- CreateEnum
CREATE TYPE "AccountingDocumentStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'CANCELLED');

-- AlterEnum
ALTER TYPE "AuditEntityType" ADD VALUE 'ACCOUNTING_DOCUMENT';

-- CreateTable
CREATE TABLE "accounting_documents" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "type" "AccountingDocumentType" NOT NULL,
    "status" "AccountingDocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "documentAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "issuedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "counterparty" TEXT NOT NULL,
    "counterpartyTaxId" TEXT,
    "basis" TEXT,
    "subtotal" DECIMAL(20,2) NOT NULL,
    "vatRate" DECIMAL(8,4) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(20,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(20,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'KZT',
    "transferId" UUID,
    "expenseId" UUID,
    "notes" TEXT,
    "createdById" UUID NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_document_items" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(20,6) NOT NULL,
    "unit" "Unit" NOT NULL,
    "unitPrice" DECIMAL(20,4) NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_document_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "accounting_documents_workspaceId_type_status_documentAt_idx" ON "accounting_documents"("workspaceId", "type", "status", "documentAt");

-- CreateIndex
CREATE INDEX "accounting_documents_workspaceId_counterparty_documentAt_idx" ON "accounting_documents"("workspaceId", "counterparty", "documentAt");

-- CreateIndex
CREATE INDEX "accounting_documents_transferId_idx" ON "accounting_documents"("transferId");

-- CreateIndex
CREATE INDEX "accounting_documents_expenseId_idx" ON "accounting_documents"("expenseId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_documents_workspaceId_number_key" ON "accounting_documents"("workspaceId", "number");

-- CreateIndex
CREATE INDEX "accounting_document_items_documentId_position_idx" ON "accounting_document_items"("documentId", "position");

-- AddForeignKey
ALTER TABLE "accounting_documents" ADD CONSTRAINT "accounting_documents_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_documents" ADD CONSTRAINT "accounting_documents_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "lrt_transfers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_documents" ADD CONSTRAINT "accounting_documents_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_documents" ADD CONSTRAINT "accounting_documents_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_document_items" ADD CONSTRAINT "accounting_document_items_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "accounting_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
