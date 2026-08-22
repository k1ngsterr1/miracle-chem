/*
  Warnings:

  - Changed the type of `unit` on the `accounting_document_items` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- AlterTable
ALTER TABLE "accounting_document_items" DROP COLUMN "unit",
ADD COLUMN     "unit" VARCHAR(20) NOT NULL;
