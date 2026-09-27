import { describe, expect, it } from "vitest";
import { parseConfig } from "./config.js";

const base = {
  crmSyncUrl: "https://crm.example.kz/api/integrations/1c/sync",
  apiKey: "a".repeat(32),
  queueDirectory: "C:\\ProgramData\\MiracleChem\\OneCSyncAgent\\queue",
  listenHost: "127.0.0.1",
  listenPort: 8261,
  localIngestKey: "b".repeat(32),
  syncIntervalSeconds: 300,
  requestTimeoutSeconds: 30,
  sentRetentionDays: 30,
};

describe("agent config", () => {
  it("accepts a secure CRM endpoint", () => {
    expect(parseConfig(base)).toMatchObject({ crmSyncUrl: base.crmSyncUrl, listenPort: 8261 });
  });

  it("rejects an insecure public CRM endpoint", () => {
    expect(() => parseConfig({ ...base, crmSyncUrl: "http://crm.example.kz/api/integrations/1c/sync" })).toThrow("HTTPS");
  });
});
