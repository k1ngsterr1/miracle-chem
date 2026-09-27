import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { AgentLogger } from "./types.js";

export function createLogger(rootDirectory: string): AgentLogger {
  const logDirectory = join(rootDirectory, "logs");
  async function write(level: "INFO" | "WARN" | "ERROR", event: string, data: Record<string, unknown> = {}): Promise<void> {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    const row = JSON.stringify({ timestamp: now.toISOString(), level, event, ...data });
    await mkdir(logDirectory, { recursive: true });
    await appendFile(join(logDirectory, `${day}.jsonl`), `${row}\n`, "utf8");
    // The task scheduler captures stdout; this makes diagnostics available without opening a file.
    process.stdout.write(`${row}\n`);
  }
  return {
    info: (event, data) => write("INFO", event, data),
    warn: (event, data) => write("WARN", event, data),
    error: (event, data) => write("ERROR", event, data),
  };
}
