ALTER TABLE "attachments" ADD COLUMN "expenseId" UUID;

CREATE INDEX "attachments_expenseId_idx" ON "attachments"("expenseId");

ALTER TABLE "attachments" ADD CONSTRAINT "attachments_expenseId_fkey" FOREIGN KEY ("expenseId") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
