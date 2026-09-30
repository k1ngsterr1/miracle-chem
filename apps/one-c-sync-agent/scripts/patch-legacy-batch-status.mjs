// Compatibility repair for the pre-listener Windows CLI. Does not read or write 1C.
import { copyFile, readFile, rename, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function patchLegacySnapshotStatus(source) {
  const marker = "LEGACY_BATCH_STATUS_REPAIR";
  if (source.includes(marker)) return source;
  const start = source.indexOf('if (command === "bkz-full-sync")');
  const end = source.indexOf('if (["bkz-preview"', start);
  if (start < 0 || end < 0) throw new Error("Unsupported legacy CLI layout; nothing changed");
  const block = source.slice(start, end);
  const condition = "if (queue.failed > 0)";
  const aggregate = 'queue.pending + queue.sending > 0 ? "QUEUED_FOR_RETRY" : "DELIVERED"';
  if (!block.includes("await agent.drain()") || block.split(condition).length !== 2 ||
      block.split(aggregate).length !== 2 || !source.includes('import { existsSync } from "node:fs"')) {
    throw new Error("Unsupported legacy CLI status check; nothing changed");
  }
  const replacement = `// ${marker}: only this batch determines this invocation's outcome.
        const { createHash } = await import("node:crypto");
        const { join } = await import("node:path");
        const batchFile = createHash("sha256").update(envelope.batchId).digest("hex") + ".json";
        const batchAreas = ["pending", "sending", "sent", "failed"].filter(
            (area) => existsSync(join(config.queueDirectory, area, batchFile)));
        if (batchAreas.length !== 1) throw new Error("Current batch queue state is missing or ambiguous");
        const batchState = batchAreas[0];
        if (batchState === "failed")`;
  return source.slice(0, start) + block.replace(condition, replacement)
    .replace(aggregate, 'batchState === "sent" ? "DELIVERED" : "QUEUED_FOR_RETRY"') + source.slice(end);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: node patch-legacy-batch-status.mjs <installed-cli.js>");
  const original = await readFile(path, "utf8");
  const patched = patchLegacySnapshotStatus(original);
  if (patched === original) {
    console.log("ALREADY_PATCHED");
  } else {
    const backup = `${path}.before-batch-status-${Date.now()}.bak`;
    await copyFile(path, backup, constants.COPYFILE_EXCL);
    const temporary = `${path}.batch-status-${process.pid}.tmp`;
    await writeFile(temporary, patched, { encoding: "utf8", flag: "wx" });
    await rename(temporary, path);
    console.log(`PATCHED; backup: ${backup}`);
  }
}
