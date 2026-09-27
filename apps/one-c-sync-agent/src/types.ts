export interface AgentConfig {
  crmSyncUrl: string;
  apiKey: string;
  queueDirectory: string;
  listenHost: "127.0.0.1" | "::1";
  listenPort: number;
  localIngestKey: string;
  syncIntervalSeconds: number;
  requestTimeoutSeconds: number;
  sentRetentionDays: number;
}

export interface OneCDelta {
  workspaceId: string;
  batchId: string;
  generatedAt: string;
  source?: "1C";
  customers?: unknown[];
  suppliers?: unknown[];
  materials?: unknown[];
  receipts?: unknown[];
  [key: string]: unknown;
}

export interface OneCFullSnapshotEnvelope {
  kind: "FULL_SNAPSHOT";
  source: "1C";
  workspaceId: string;
  sourceInstanceId: string;
  organizationExternalId: string;
  batchId: string;
  generatedAt: string;
  snapshot: Record<string, unknown[]> & Record<string, unknown>;
}

export interface SyncResponse {
  replayed?: boolean;
  runId?: string;
  status?: "COMPLETED" | "PARTIAL" | "PROCESSING" | "FAILED";
  summary?: unknown;
}

export interface AgentLogger {
  info(event: string, data?: Record<string, unknown>): Promise<void>;
  warn(event: string, data?: Record<string, unknown>): Promise<void>;
  error(event: string, data?: Record<string, unknown>): Promise<void>;
}
