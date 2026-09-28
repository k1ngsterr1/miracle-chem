import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareBkzArchive } from "./bkz-archive.js";

const directories: string[] = [];

async function fixture(overrides: Record<string, unknown> = {}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "miracle-one-c-archive-test-"));
  directories.push(directory);
  await writeFile(join(directory, "0000-0000.json"), JSON.stringify([{ Ссылка: { type: "OneCInternal", value: "ref" } }]));
  await writeFile(join(directory, "manifest.json"), JSON.stringify({
    schemaVersion: 1, source: "1C", configuration: "БухгалтерияДляКазахстана",
    configurationVersion: "3.0.74.2", consistency: "SEQUENTIAL_READ_ONLY_NOT_ACCOUNTING_CLOSE",
    readStartedAt: "2026-09-28T08:00:00Z", generatedAt: "2026-09-28T08:05:00Z",
    sourceMetadataCount: 1, complete: true, errors: [],
    collections: [{ key: "Справочник.Организации", kind: "Catalogs", name: "Организации",
      sensitivity: "BUSINESS", rowCount: 1, chunkFiles: ["0000-0000.json"], status: "EXPORTED" }],
    ...overrides,
  }));
  return directory;
}

afterEach(async () => {
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

describe("BKZ archive transfer preflight", () => {
  it("counts and hashes every source row before upload", async () => {
    const prepared = await prepareBkzArchive(await fixture());
    expect(prepared.manifest.sourceMetadataCount).toBe(1);
    expect(prepared.manifest.collections[0]?.chunkHashes[0]).toMatch(/^[0-9a-f]{64}$/u);
    expect(prepared.chunks[0]?.fileName).toBe("0000-0000.json");
  });

  it("refuses a partial or failed export", async () => {
    await expect(prepareBkzArchive(await fixture({ complete: false }))).rejects.toThrow("неполная");
    await expect(prepareBkzArchive(await fixture({ errors: [{ source: "Документ.ЭСФ" }] }))).rejects.toThrow("неполная");
  });

  it("refuses a truncated collection or a path outside the private export", async () => {
    const item = { key: "Справочник.Организации", kind: "Catalogs", name: "Организации",
      sensitivity: "BUSINESS", rowCount: 2, chunkFiles: ["0000-0000.json"], status: "EXPORTED" };
    await expect(prepareBkzArchive(await fixture({ collections: [item] }))).rejects.toThrow("количество строк");
    await expect(prepareBkzArchive(await fixture({ collections: [{ ...item, rowCount: 1, chunkFiles: ["../secret.json"] }] })))
      .rejects.toThrow("небезопасный путь");
  });
});
