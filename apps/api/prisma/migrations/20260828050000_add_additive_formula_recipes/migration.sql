ALTER TABLE "formula_versions" ADD COLUMN "dosagePercent" DECIMAL(12,6);

CREATE TABLE "additive_formula_components" (
    "id" UUID NOT NULL,
    "formulaVersionId" UUID NOT NULL,
    "materialId" UUID NOT NULL,
    "percentage" DECIMAL(12,6) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "additive_formula_components_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "additive_formula_components_formulaVersionId_materialId_key"
ON "additive_formula_components"("formulaVersionId", "materialId");

CREATE INDEX "additive_formula_components_formulaVersionId_position_idx"
ON "additive_formula_components"("formulaVersionId", "position");

ALTER TABLE "additive_formula_components"
ADD CONSTRAINT "additive_formula_components_formulaVersionId_fkey"
FOREIGN KEY ("formulaVersionId") REFERENCES "formula_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "additive_formula_components"
ADD CONSTRAINT "additive_formula_components_materialId_fkey"
FOREIGN KEY ("materialId") REFERENCES "materials"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
