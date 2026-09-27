import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { sampleFullSnapshot } from "../test/full-snapshot-fixture.js";
import { FULL_SNAPSHOT_COLLECTIONS, fullSnapshotCounts, parseFullSnapshot } from "./full-snapshot.js";

describe("native 1C full snapshot boundary", () => {
  it("requires every business collection, including receivables and both payment directions", () => {
    const envelope = sampleFullSnapshot();
    expect(fullSnapshotCounts(parseFullSnapshot(envelope))).toMatchObject({
      receivables: 1, incomingPayments: 1, outgoingPayments: 1,
    });
    const incomplete = structuredClone(envelope);
    delete incomplete.snapshot.outgoingPayments;
    expect(() => parseFullSnapshot(incomplete)).toThrow("outgoingPayments");
    expect(() => parseFullSnapshot({ ...envelope, generatedAt: "2026-09-26T08:01:00Z" })).toThrow("дата");
  });

  it("keeps the BSL exporter and transport contract aligned", async () => {
    const bsl = await readFile(new URL("../one-c/MiracleChemFullSnapshot.bsl", import.meta.url), "utf8");
    for (const name of FULL_SNAPSHOT_COLLECTIONS) {
      expect(bsl).toContain(`Снимок.Вставить("${name}"`);
    }
    expect(bsl).toContain('Новый HTTPЗапрос("/v1/snapshot")');
  });
});
