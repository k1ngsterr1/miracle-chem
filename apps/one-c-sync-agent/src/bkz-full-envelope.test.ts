import { describe, expect, it } from "vitest";
import { buildBkzFullEnvelope } from "./bkz-full-envelope.js";
import { sampleFullSnapshot } from "../test/full-snapshot-fixture.js";

describe("BKZ full snapshot envelope", () => {
  it("uses a stable batch id so a retry cannot create a second delivery", () => {
    const snapshot = sampleFullSnapshot().snapshot;
    const binding = {
      workspaceId: "11111111-1111-4111-8111-111111111111",
      sourceInstanceId: "22222222-2222-4222-8222-222222222222",
      organizationId: snapshot.organizations[0]!.externalId,
    };
    const first = buildBkzFullEnvelope(snapshot, binding);
    const second = buildBkzFullEnvelope(JSON.parse(JSON.stringify(snapshot)), binding);
    expect(first.batchId).toBe(second.batchId);
    expect(first.snapshot).toEqual(snapshot);
  });
});
