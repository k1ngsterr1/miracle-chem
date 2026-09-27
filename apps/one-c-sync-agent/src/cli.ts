#!/usr/bin/env node
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { defaultConfigPath, initializeConfig, loadConfig } from "./config.js";
import { SyncAgent } from "./runtime.js";
import { initializeBkzState, parseBkzMapping, parseBkzSnapshot, prepareBkzPlan } from "./bkz-adapter.js";
import { proposeBkzAuthorityMapping } from "./bkz-authority.js";
import { initializeBkzCollector, readJsonFile, syncBkzSnapshot } from "./bkz-collector.js";
import { buildBkzFullEnvelope } from "./bkz-full-envelope.js";

async function main(): Promise<void> {
  const [command = "help", ...argumentsList] = process.argv.slice(2);
  const configPath = option(argumentsList, "--config") ?? defaultConfigPath();
  if (command === "init") {
    if (existsSync(configPath)) throw new Error(`Конфигурация уже существует: ${configPath}`);
    const config = await initializeConfig(configPath);
    process.stdout.write(`Создан ${configPath}\nЛокальный ключ приёма: ${config.localIngestKey}\nЗаполните crmSyncUrl и apiKey, затем запустите serve.\n`);
    return;
  }
  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(help());
    return;
  }
  if (command === "bkz-propose-mapping") {
    const snapshot = parseBkzSnapshot(await readJsonFile(requiredPath(argumentsList, "--snapshot")));
    const proposal = proposeBkzAuthorityMapping(snapshot, {
      workspaceId: requiredText(argumentsList, "--workspace-id"),
      organizationId: requiredText(argumentsList, "--organization-id"),
      sourceInstanceId: requiredText(argumentsList, "--source-instance-id"),
      approvedBy: requiredText(argumentsList, "--approved-by"),
      approvedAt: new Date().toISOString(),
      sourceUtcOffset: requiredText(argumentsList, "--source-utc-offset"),
    });
    const output = requiredPath(argumentsList, "--output");
    await writeFile(output, `${JSON.stringify(proposal.mapping, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    process.stdout.write(`${JSON.stringify({ status: "PROPOSED_MAPPING_REVIEW_BEFORE_USE", output,
      materials: proposal.mapping.materials.length, counterparties: proposal.mapping.counterparties.length,
      excludedServices: proposal.excludedServices, excludedDeletedMaterials: proposal.excludedDeletedMaterials,
      unclassifiedCounterparties: proposal.unclassifiedCounterparties }, null, 2)}\n`);
    return;
  }
  if (command === "bkz-full-sync") {
    const snapshot = await readJsonFile(requiredPath(argumentsList, "--snapshot"));
    const mapping = parseBkzMapping(await readJsonFile(requiredPath(argumentsList, "--mapping")));
    const envelope = buildBkzFullEnvelope(snapshot, mapping);
    const config = await loadConfig(configPath);
    const agent = new SyncAgent(config);
    await agent.initialize();
    const queued = await agent.enqueueSnapshot(envelope);
    await agent.drain();
    const status = await agent.status();
    const queue = status.queue as { pending: number; sending: number; sent: number; failed: number };
    if (queue.failed > 0) throw new Error(`Пакет ${envelope.batchId} отклонён CRM; проверьте журнал агента`);
    process.stdout.write(`${JSON.stringify({ status: queue.pending + queue.sending > 0 ? "QUEUED_FOR_RETRY" : "DELIVERED",
      batchId: envelope.batchId, duplicate: queued.duplicate, queue })}\n`);
    return;
  }
  if (["bkz-preview", "bkz-baseline", "bkz-sync"].includes(command)) {
    const required = (name: string): string => { const path = option(argumentsList, name); if (!path) throw new Error(`Укажите ${name}`); return path; };
    const snapshot = parseBkzSnapshot(await readJsonFile(required("--snapshot")));
    const mapping = parseBkzMapping(await readJsonFile(required("--mapping")));
    if (command === "bkz-preview") {
      const state = initializeBkzState(snapshot, mapping);
      const plan = prepareBkzPlan(snapshot, mapping, state);
      process.stdout.write(`${JSON.stringify({
        status: "PREVIEW_ONLY",
        historicalDocumentsExcluded: Object.keys(state.documents).length,
        importedByIncrementalSync: {
          customers: plan.delta.customers?.length,
          suppliers: plan.delta.suppliers?.length,
          materials: plan.delta.materials?.length,
          newReceiptLines: plan.delta.receipts?.length,
        },
        readOnlySourceDataNotYetSynchronized: {
          diagnosticBalances: snapshot.balances.length,
          accountingInventory: snapshot.accountingInventory.length,
          receivables: snapshot.receivables.length,
          sales: snapshot.sales.length,
          invoices: snapshot.invoices.length,
          incomingPayments: snapshot.incomingPayments.length,
          outgoingPayments: snapshot.outgoingPayments.length,
        },
        reviews: plan.reviews,
      }, null, 2)}\n`);
      return;
    }
    const config = await loadConfig(configPath);
    const root = required("--state-directory");
    if (command === "bkz-baseline") {
      if (!argumentsList.includes("--accept-reviewed-baseline")) throw new Error("Сначала сверьте остатки и mapping, затем явно укажите --accept-reviewed-baseline. Исторические поступления не будут загружены.");
      await initializeBkzCollector(root, config, snapshot, mapping);
      process.stdout.write("Baseline сохранён. Исторические поступления исключены; данные в CRM не отправлялись.\n");
    } else {
      process.stdout.write(`${JSON.stringify(await syncBkzSnapshot(root, config, snapshot, mapping))}\n`);
    }
    return;
  }
  const config = await loadConfig(configPath);
  const agent = new SyncAgent(config);
  await agent.initialize();
  if (command === "sync") {
    await agent.drain();
    process.stdout.write(`${JSON.stringify(await agent.status())}\n`);
    return;
  }
  if (command === "status") {
    process.stdout.write(`${JSON.stringify(await agent.status(), null, 2)}\n`);
    return;
  }
  if (command === "serve") {
    const server = await agent.serve();
    await agent.drain();
    const timer = setInterval(() => { void agent.drain(); }, config.syncIntervalSeconds * 1_000);
    const shutdown = (): void => {
      clearInterval(timer);
      server.close(() => process.exit(0));
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    return;
  }
  throw new Error(`Неизвестная команда: ${command}`);
}

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`Для ${name} укажите путь к конфигурации`);
  return resolve(value);
}

function requiredPath(args: string[], name: string): string {
  const value = option(args, name);
  if (!value) throw new Error(`Укажите ${name}`);
  return value;
}

function requiredText(args: string[], name: string): string {
  const index = args.indexOf(name);
  const value = index < 0 ? undefined : args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Укажите ${name}`);
  return value;
}

function help(): string {
  return [
    "Miracle Chem — агент обмена с офлайн 1С",
    "",
    "Команды:",
    "  init [--config <path>]   Создать безопасный шаблон config.json",
    "  serve [--config <path>]  Слушать 127.0.0.1 и отправлять очередь по расписанию",
    "  sync [--config <path>]   Однократно отправить локальную очередь",
    "  status [--config <path>] Показать состояние очереди",
    "  bkz-propose-mapping --snapshot <json> --workspace-id <uuid> --organization-id <uuid> --source-instance-id <uuid> --approved-by <text> --source-utc-offset <+05:00> --output <json>",
    "  bkz-full-sync --snapshot <json> --mapping <json> [--config <agent-config.json>]  Поставить полный снимок в надёжную очередь и отправить",
    "  bkz-preview --snapshot <json> --mapping <json>  Проверить mapping, без отправки",
    "  bkz-baseline --snapshot <json> --mapping <json> --state-directory <path> --accept-reviewed-baseline [--config <path>]",
    "  bkz-sync --snapshot <json> --mapping <json> --state-directory <path> [--config <path>]",
    "",
  ].join("\n");
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
