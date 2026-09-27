import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputDirectory = resolve(process.env.MIRACLE_CHEM_WINDOWS_PACKAGE_DIR ?? join(packageDirectory, "release", "windows"));

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });
await cp(join(packageDirectory, "dist"), join(outputDirectory, "app"), { recursive: true });
await cp(join(packageDirectory, "config.example.json"), join(outputDirectory, "config.example.json"));
await cp(join(packageDirectory, "one-c"), join(outputDirectory, "one-c"), { recursive: true });
const buildScriptPath = join(outputDirectory, "one-c", "Build-MiracleChemFullSnapshot.ps1");
const buildScript = await readFile(buildScriptPath, "utf8");
await writeFile(buildScriptPath, `\uFEFF${buildScript}`, "utf8");
const fullSyncScriptPath = join(outputDirectory, "one-c", "Run-BkzFullSync.ps1");
const fullSyncScript = await readFile(fullSyncScriptPath, "utf8");
await writeFile(fullSyncScriptPath, `\uFEFF${fullSyncScript}`, "utf8");
await cp(join(packageDirectory, "scripts", "install-windows-task.ps1"), join(outputDirectory, "install-windows-task.ps1"));
await cp(join(packageDirectory, "scripts", "uninstall-windows-task.ps1"), join(outputDirectory, "uninstall-windows-task.ps1"));
// Windows PowerShell 5.1 interprets BOM-less .ps1 files as ANSI and corrupts
// Cyrillic strings. Keep the source UTF-8; mark only release copies as UTF-8.
for (const fileName of ["install-windows-task.ps1", "uninstall-windows-task.ps1"]) {
  const outputPath = join(outputDirectory, fileName);
  const source = await readFile(outputPath, "utf8");
  await writeFile(outputPath, `\uFEFF${source}`, "utf8");
}
await writeFile(join(outputDirectory, "Run-Agent.cmd"), [
  "@echo off",
  "setlocal",
  "set \"AGENT_ROOT=%ProgramData%\\MiracleChem\\OneCSyncAgent\"",
  "set \"CONFIG=%AGENT_ROOT%\\config.json\"",
  "node \"%~dp0app\\src\\cli.js\" %* --config \"%CONFIG%\"",
].join("\r\n"), "utf8");
await writeFile(join(outputDirectory, "README.txt"), [
  "Miracle Chem — Windows Sync Agent",
  "",
  "1. Install Node.js 22 LTS on the computer where 1C runs.",
  "2. Run PowerShell as administrator: .\\install-windows-task.ps1",
  "3. Fill %ProgramData%\\MiracleChem\\OneCSyncAgent\\config.json with CRM URL and ONE_C_SYNC_API_KEY.",
  "4. Copy the generated localIngestKey to the 1C external processing settings.",
  "5. For Kazakhstan Accounting 3.0, build the external processing with one-c\\Build-MiracleChemFullSnapshot.ps1",
  "   using the installed 1cv8.exe. Open MiracleChemFullSnapshot.epf in 1C after reviewing its source and approving 1C's security prompt.",
  "   Its read-only check covers 13 source collections, including receivables and both payment directions.",
  "   The send button needs one-c-exchange.json and a running local agent; do not enable it before the HTTPS CRM endpoint and mapping are approved.",
  "   One-c\\MiracleChemSync.bsl remains the older delta-only example.",
  "The verified read-only PowerShell exporter and COM collector are also in one-c/.",
  "Review bkz.mapping.example.json, reconcile existing CRM IDs and stock, then run bkz-preview and explicit bkz-baseline.",
  "Run-BkzCollector.ps1 performs one collection/delivery cycle; do not enable scheduling until mapping and CRM endpoint are approved.",
  "",
  "The agent listens only on 127.0.0.1:8261 and sends data outbound to CRM over HTTPS.",
].join("\r\n"), "utf8");
process.stdout.write(`Windows package created: ${outputDirectory}\n`);
