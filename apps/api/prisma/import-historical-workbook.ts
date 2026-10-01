import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Prisma } from "../src/generated/prisma/index.js";
import { prisma } from "../src/lib/prisma.js";
import { historicalWorkbookInputSchema } from "./historical-workbook-input-schema.js";

async function main(): Promise<void> {
  const [workspaceId, jsonPath, workbookPath] = process.argv.slice(2);
  if (!workspaceId || !jsonPath || !workbookPath) {
    throw new Error("Usage: import-historical-workbook <workspace-uuid> <extracted-json> <original-xlsx>");
  }
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true } });
  if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
  const [jsonBytes, workbookBytes] = await Promise.all([readFile(resolve(jsonPath)), readFile(resolve(workbookPath))]);
  const input = historicalWorkbookInputSchema.parse(JSON.parse(jsonBytes.toString("utf8")));
  const hash = createHash("sha256").update(workbookBytes).digest("hex");
  if (hash !== input.sha256) throw new Error("Original workbook SHA-256 does not match extracted JSON");
  if (input.fileName !== workbookPath.split(/[\\/]/).at(-1)) throw new Error("Original workbook name does not match JSON");
  const result = await prisma.$transaction(async (tx) => {
    await tx.historicalWorkbook.updateMany({ where: { workspaceId, sourceKey: input.sourceKey, active: true },
      data: { active: false } });
    return tx.historicalWorkbook.upsert({
      where: { workspaceId_sourceKey_sha256: { workspaceId, sourceKey: input.sourceKey, sha256: input.sha256 } },
      create: { workspaceId, sourceKey: input.sourceKey, fileName: input.fileName,
        sha256: input.sha256, payload: input as Prisma.InputJsonValue },
      // The same source file may be reimported after an importer fix. Restore the full
      // extracted payload without changing the existing workbook identity.
      update: { active: true, payload: input as Prisma.InputJsonValue },
      select: { id: true, sourceKey: true, sha256: true, active: true },
    });
  });
  process.stdout.write(JSON.stringify({ ...result, workspace: workspace.name, sheetCount: input.sheets.length,
    productionCount: input.production.length, formulaCount: input.formulas.length,
    salesCount: input.sales.length, unlabelledSalesMetricCount: input.unlabelledSalesMetrics.length }) + "\n");
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
