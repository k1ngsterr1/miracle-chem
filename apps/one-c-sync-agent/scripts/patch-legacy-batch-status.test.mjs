import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { patchLegacySnapshotStatus } from "./patch-legacy-batch-status.mjs";

const legacy = `import { existsSync } from "node:fs";
if (command === "bkz-full-sync") {
  await agent.drain();
  if (queue.failed > 0) throw new Error("rejected");
  return queue.pending + queue.sending > 0 ? "QUEUED_FOR_RETRY" : "DELIVERED";
}
if (["bkz-preview"].includes(command)) {}`;

describe("legacy Windows status repair", () => {
  it("rejects unknown layouts and is idempotent", () => {
    expect(() => patchLegacySnapshotStatus("unknown")).toThrow("Unsupported");
    const patched = patchLegacySnapshotStatus(legacy);
    expect(patchLegacySnapshotStatus(patched)).toBe(patched);
  });
  it("checks only the current batch, preserving failures and missing-state errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "legacy-batch-status-"));
    try {
      for (const area of ["sent", "pending", "sending", "failed"]) await mkdir(join(root, area));
      const place = (batch, area) => writeFile(join(root, area,
        createHash("sha256").update(batch).digest("hex") + ".json"), "{}");
      await place("old", "failed");
      await place("current", "sent");
      await place("waiting", "pending");
      await place("rejected", "failed");
      const source = patchLegacySnapshotStatus(legacy).replace('import { existsSync } from "node:fs";', "");
      const check = async (batchId) => {
        const { stdout } = await promisify(execFile)(process.execPath, ["--input-type=module", "-e", `
          import { existsSync } from "node:fs";
          const command = "bkz-full-sync";
          const agent = { drain: async () => {} };
          const queue = { failed: 2, pending: 1, sending: 0 };
          const envelope = ${JSON.stringify({ batchId })};
          const config = ${JSON.stringify({ queueDirectory: root })};
          console.log(await (async () => { ${source} })());
        `]);
        return stdout.trim();
      };
      expect(await check("current")).toBe("DELIVERED");
      expect(await check("waiting")).toBe("QUEUED_FOR_RETRY");
      await expect(check("rejected")).rejects.toThrow("rejected");
      await expect(check("absent")).rejects.toThrow("missing or ambiguous");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
