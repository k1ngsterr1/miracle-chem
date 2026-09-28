import { execFile } from "node:child_process";
import { readFile, readdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { makeInitialConfig } from "./config.js";

const projectRoot = new URL("../../../", import.meta.url);
const run = promisify(execFile);

describe("production 1C binding configuration", () => {
  it("documents and writes every 1C variable required by production Compose", async () => {
    const [compose, bootstrap, example] = await Promise.all([
      readFile(new URL("compose.production.yaml", projectRoot), "utf8"),
      readFile(new URL("deploy/bootstrap-vps.sh", projectRoot), "utf8"),
      readFile(new URL(".env.example", projectRoot), "utf8"),
    ]);
    const required = [...compose.matchAll(/\$\{(ONE_C_SYNC_[A-Z_]+):\?set /gu)].map((match) => match[1]);
    expect(required).toEqual([
      "ONE_C_SYNC_API_KEY", "ONE_C_SYNC_WORKSPACE_ID",
      "ONE_C_SYNC_SOURCE_INSTANCE_ID", "ONE_C_SYNC_ORGANIZATION_ID",
    ]);
    for (const name of required) {
      expect(bootstrap).toContain(`${name}=%s`);
      expect(example).toContain(`${name}=`);
    }
  });

  it("validates the Windows config before starting the service without requiring an active listener", async () => {
    const installer = await readFile(new URL("apps/one-c-sync-agent/scripts/install-windows-task.ps1", projectRoot), "utf8");
    expect(installer).toContain("& $node $cli validate-config --config $ConfigPath");
    expect(installer).not.toContain("& $node $cli status --config $ConfigPath");
    const directory = await mkdtemp(join(tmpdir(), "miracle-chem-one-c-config-"));
    try {
      const configPath = join(directory, "config.json");
      await writeFile(configPath, JSON.stringify({ ...makeInitialConfig(), apiKey: "a".repeat(32), listenPort: 65534 }));
      const cli = fileURLToPath(new URL("apps/one-c-sync-agent/src/cli.ts", projectRoot));
      const { stdout } = await run(process.execPath, ["--import", "tsx", cli, "validate-config", "--config", configPath],
        { cwd: fileURLToPath(projectRoot) });
      expect(stdout).toContain("Конфигурация агента корректна");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("upgrades an existing VPS .env without changing existing values and rejects conflicting bindings", async () => {
    const directory = await mkdtemp(join(tmpdir(), "miracle-chem-one-c-env-"));
    const envFile = join(directory, ".env");
    const script = fileURLToPath(new URL("deploy/upgrade-one-c-env.sh", projectRoot));
    const bindings = {
      ONE_C_SYNC_WORKSPACE_ID: "11111111-1111-4111-8111-111111111111",
      ONE_C_SYNC_SOURCE_INSTANCE_ID: "22222222-2222-4222-8222-222222222222",
      ONE_C_SYNC_ORGANIZATION_ID: "33333333-3333-4333-8333-333333333333",
    };
    const environment = { ...process.env, MIRACLE_ENV_FILE: envFile, ...bindings };
    try {
      await writeFile(envFile, "POSTGRES_USER=existing-user\nONE_C_SYNC_API_KEY=existing-key\n");
      await run("bash", [script], { env: environment });
      const upgraded = await readFile(envFile, "utf8");
      expect(upgraded).toContain("POSTGRES_USER=existing-user");
      expect(upgraded).toContain("ONE_C_SYNC_API_KEY=existing-key");
      for (const [key, value] of Object.entries(bindings)) expect(upgraded).toContain(`${key}=${value}`);
      expect(upgraded).toMatch(/ONE_C_ARCHIVE_ENCRYPTION_KEY=[A-Za-z0-9+/=]+/u);
      const backups = (await readdir(directory)).filter((name) => name.includes("before-one-c"));
      expect(backups).toHaveLength(1);
      expect(await readFile(join(directory, backups[0]!), "utf8")).toBe("POSTGRES_USER=existing-user\nONE_C_SYNC_API_KEY=existing-key\n");
      await run("bash", [script], { env: environment });
      expect(await readFile(envFile, "utf8")).toBe(upgraded);
      await expect(run("bash", [script], { env: { ...environment, ONE_C_SYNC_WORKSPACE_ID: bindings.ONE_C_SYNC_SOURCE_INSTANCE_ID } })).rejects.toThrow();
      expect(await readFile(envFile, "utf8")).toBe(upgraded);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
