ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'CUSTOMER';
ALTER TYPE "AuditEntityType" ADD VALUE IF NOT EXISTS 'CUSTOMER_CONCRETE_RECIPE';

CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "taxId" TEXT,
    "contactPerson" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_concrete_recipes" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "concreteGrade" TEXT NOT NULL,
    "basisVolume" DECIMAL(18,6) NOT NULL DEFAULT 1,
    "basisUnit" "Unit" NOT NULL DEFAULT 'M3',
    "binderMassKg" DECIMAL(18,6) NOT NULL,
    "additiveFormulaVersionId" UUID NOT NULL,
    "additiveDosagePercent" DECIMAL(12,6) NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_concrete_recipes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "customer_concrete_components" (
    "id" UUID NOT NULL,
    "customerConcreteRecipeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit" "Unit" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_concrete_components_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "customers_workspaceId_name_key" ON "customers"("workspaceId", "name");
CREATE INDEX "customers_workspaceId_active_idx" ON "customers"("workspaceId", "active");
CREATE UNIQUE INDEX "customer_concrete_recipes_customerId_name_key" ON "customer_concrete_recipes"("customerId", "name");
CREATE INDEX "customer_concrete_recipes_workspaceId_customerId_idx" ON "customer_concrete_recipes"("workspaceId", "customerId");
CREATE INDEX "customer_concrete_recipes_additiveFormulaVersionId_idx" ON "customer_concrete_recipes"("additiveFormulaVersionId");
CREATE UNIQUE INDEX "customer_concrete_components_customerConcreteRecipeId_name_key" ON "customer_concrete_components"("customerConcreteRecipeId", "name");
CREATE INDEX "customer_concrete_components_customerConcreteRecipeId_position_idx" ON "customer_concrete_components"("customerConcreteRecipeId", "position");

ALTER TABLE "customers" ADD CONSTRAINT "customers_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_concrete_recipes" ADD CONSTRAINT "customer_concrete_recipes_workspaceId_fkey"
FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_concrete_recipes" ADD CONSTRAINT "customer_concrete_recipes_customerId_fkey"
FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_concrete_recipes" ADD CONSTRAINT "customer_concrete_recipes_additiveFormulaVersionId_fkey"
FOREIGN KEY ("additiveFormulaVersionId") REFERENCES "formula_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_concrete_components" ADD CONSTRAINT "customer_concrete_components_customerConcreteRecipeId_fkey"
FOREIGN KEY ("customerConcreteRecipeId") REFERENCES "customer_concrete_recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
