import { describe, expect, it } from "vitest";
import { ApiError } from "../lib/api-error.js";
import { enforceArchiveByteLimit, oneCArchiveChunkSchema, oneCArchiveHash,
  oneCArchiveManifestSchema, validateArchiveManifest } from "./one-c-archive-service.js";

const collection = { key: "Документ.ЭСФ", kind: "Documents", name: "ЭСФ", sensitivity: "BUSINESS",
  rowCount: 1, chunkHashes: ["a".repeat(64)] };

function manifest(overrides: Record<string, unknown> = {}) {
  return oneCArchiveManifestSchema.parse({ schemaVersion: 1, source: "1C",
    configuration: "БухгалтерияДляКазахстана", configurationVersion: "3.0.74.2",
    consistency: "SEQUENTIAL_READ_ONLY_NOT_ACCOUNTING_CLOSE",
    readStartedAt: "2026-09-28T08:00:00Z", generatedAt: "2026-09-28T08:05:00Z",
    sourceMetadataCount: 1, collections: [collection], ...overrides });
}

describe("1C archive manifest integrity", () => {
  it("accepts a complete manifest and produces a stable fingerprint", () => {
    const source = manifest();
    expect(() => validateArchiveManifest(source)).not.toThrow();
    expect(oneCArchiveHash(source)).toBe(oneCArchiveHash(structuredClone(source)));
  });

  it("rejects missing metadata, duplicate keys, and rows without chunks", () => {
    for (const source of [
      manifest({ sourceMetadataCount: 2 }),
      manifest({ sourceMetadataCount: 2, collections: [collection, collection] }),
      manifest({ collections: [{ ...collection, chunkHashes: [] }] }),
    ]) {
      expect(() => validateArchiveManifest(source)).toThrow(ApiError);
    }
  });

  it("refuses malformed chunk checksums and configurations", () => {
    expect(oneCArchiveManifestSchema.safeParse({ ...manifest(), collections: [{ ...collection, chunkHashes: ["bad"] }] }).success)
      .toBe(false);
    expect(oneCArchiveManifestSchema.safeParse({ ...manifest(), configuration: "Unknown" }).success).toBe(false);
  });

  it("keeps typed 1C row data unchanged across request validation", () => {
    const records = [{ Ссылка: { type: "OneCInternal", value: "ref" },
      Количество: { type: "Decimal", value: "123.4500" }, Пусто: null }];
    const parsed = oneCArchiveChunkSchema.parse({ collectionKey: collection.key, chunkIndex: 0,
      sha256: oneCArchiveHash(records), records });
    expect(oneCArchiveHash(parsed.records)).toBe(oneCArchiveHash(records));
  });

  it("caps encrypted archive storage at 2 GiB", () => {
    expect(() => enforceArchiveByteLimit(2n * 1024n * 1024n * 1024n - 1n, 1)).not.toThrow();
    expect(() => enforceArchiveByteLimit(2n * 1024n * 1024n * 1024n, 1)).toThrow(ApiError);
  });
});
