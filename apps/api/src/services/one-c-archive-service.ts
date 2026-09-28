import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { AuditEntityType, type Prisma } from "../generated/prisma/index.js";
import { config } from "../config.js";
import { ApiError } from "../lib/api-error.js";
import { prisma } from "../lib/prisma.js";
import { requireOneCSyncBinding } from "./one-c-sync-service.js";

const guid = z.string().uuid();
const hash = z.string().regex(/^[0-9a-f]{64}$/u);
const maxArchiveEncryptedBytes = 2n * 1024n * 1024n * 1024n;
const collection = z.object({
  key: z.string().min(1).max(512),
  kind: z.string().min(1).max(80),
  name: z.string().min(1).max(400),
  sensitivity: z.enum(["BUSINESS", "HR", "SYSTEM_SECRET"]),
  rowCount: z.number().int().nonnegative(),
  chunkHashes: z.array(hash).max(20_000),
});

export const oneCArchiveManifestSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.literal("1C"),
  configuration: z.literal("БухгалтерияДляКазахстана"),
  configurationVersion: z.string().min(1).max(80),
  consistency: z.literal("SEQUENTIAL_READ_ONLY_NOT_ACCOUNTING_CLOSE"),
  readStartedAt: z.string().datetime({ offset: true }),
  generatedAt: z.string().datetime({ offset: true }),
  sourceMetadataCount: z.number().int().positive(),
  collections: z.array(collection).min(1).max(5_000),
});

export const oneCArchiveStartSchema = z.object({
  workspaceId: guid,
  sourceInstanceId: guid,
  organizationExternalId: guid,
  manifest: oneCArchiveManifestSchema,
});

export const oneCArchiveChunkSchema = z.object({
  collectionKey: z.string().min(1).max(512),
  chunkIndex: z.number().int().nonnegative(),
  sha256: hash,
  records: z.array(z.record(z.string(), z.unknown())).min(1).max(1_000),
});

type ArchiveManifest = z.infer<typeof oneCArchiveManifestSchema>;
type ArchiveChunk = z.infer<typeof oneCArchiveChunkSchema>;

export function oneCArchiveHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function validateArchiveManifest(manifest: ArchiveManifest): void {
  if (Date.parse(manifest.readStartedAt) > Date.parse(manifest.generatedAt) ||
      manifest.collections.length !== manifest.sourceMetadataCount) {
    throw new ApiError(422, "ONE_C_ARCHIVE_MANIFEST_INVALID", "Манифест выгрузки 1С неполный или содержит неверное время");
  }
  const keys = new Set<string>();
  let totalRows = 0;
  let totalChunks = 0;
  for (const item of manifest.collections) {
    if (keys.has(item.key) || (item.rowCount === 0) !== (item.chunkHashes.length === 0) ||
        item.chunkHashes.length > item.rowCount) {
      throw new ApiError(422, "ONE_C_ARCHIVE_MANIFEST_INVALID", `Неверные количество или порции коллекции ${item.key}`);
    }
    keys.add(item.key);
    totalRows += item.rowCount;
    totalChunks += item.chunkHashes.length;
  }
  if (totalRows > 5_000_000 || totalChunks > 50_000) {
    throw new ApiError(413, "ONE_C_ARCHIVE_TOO_LARGE", "Архив 1С превышает лимит количества строк или порций");
  }
}

export function enforceArchiveByteLimit(currentBytes: bigint, incomingBytes: number): void {
  if (currentBytes < 0n || !Number.isSafeInteger(incomingBytes) || incomingBytes < 0 ||
      currentBytes + BigInt(incomingBytes) > maxArchiveEncryptedBytes) {
    throw new ApiError(413, "ONE_C_ARCHIVE_STORAGE_LIMIT", "Архив 1С превысит лимит 2 ГиБ зашифрованных данных");
  }
}

async function lockArchiveImport(tx: Prisma.TransactionClient, importId: string): Promise<void> {
  if (!guid.safeParse(importId).success) throw new ApiError(404, "ONE_C_ARCHIVE_NOT_FOUND", "Архив 1С не найден");
  await tx.$queryRaw`SELECT "id" FROM "one_c_archive_imports" WHERE "id" = ${importId}::uuid FOR UPDATE`;
}

function archiveKey(): Buffer {
  const encoded = config.oneCArchiveEncryptionKey;
  if (!/^[A-Za-z0-9+/]{43}=$/u.test(encoded)) {
    throw new ApiError(503, "ONE_C_ARCHIVE_KEY_NOT_CONFIGURED", "Ключ шифрования архива 1С не настроен");
  }
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32 || key.toString("base64") !== encoded) {
    throw new ApiError(503, "ONE_C_ARCHIVE_KEY_NOT_CONFIGURED", "Ключ шифрования архива 1С некорректен");
  }
  return key;
}

function encryptRecords(records: ArchiveChunk["records"]): Buffer {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", archiveKey(), nonce);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(records), "utf8"), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
}

function decryptRecords(encrypted: Uint8Array): ArchiveChunk["records"] {
  const bytes = Buffer.from(encrypted);
  if (bytes.length < 28) throw new ApiError(500, "ONE_C_ARCHIVE_CORRUPT", "Повреждена порция архива 1С");
  const decipher = createDecipheriv("aes-256-gcm", archiveKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  try {
    return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8")) as ArchiveChunk["records"];
  } catch {
    throw new ApiError(500, "ONE_C_ARCHIVE_CORRUPT", "Не удалось проверить порцию архива 1С");
  }
}

export async function startOneCArchive(input: z.infer<typeof oneCArchiveStartSchema>) {
  archiveKey();
  validateArchiveManifest(input.manifest);
  const archiveId = oneCArchiveHash(input.manifest);
  const baseline = await prisma.oneCSourceSnapshot.findFirst({
    where: { workspaceId: input.workspaceId, sourceInstanceId: input.sourceInstanceId,
      organizationExternalId: input.organizationExternalId }, select: { id: true },
  });
  if (!baseline) throw new ApiError(409, "ONE_C_SOURCE_NOT_APPROVED", "Источник архива 1С не привязан к CRM");
  const existing = await prisma.oneCArchiveImport.findUnique({
    where: { workspaceId_sourceInstanceId_archiveId: {
      workspaceId: input.workspaceId, sourceInstanceId: input.sourceInstanceId, archiveId,
    } }, select: { id: true, status: true },
  });
  if (existing) return { importId: existing.id, archiveId, status: existing.status, replayed: true };
  let created;
  try {
    created = await prisma.oneCArchiveImport.create({ data: {
      workspaceId: input.workspaceId, sourceInstanceId: input.sourceInstanceId, archiveId,
      configuration: input.manifest.configuration, configurationVersion: input.manifest.configurationVersion,
      readStartedAt: new Date(input.manifest.readStartedAt), generatedAt: new Date(input.manifest.generatedAt),
      manifestSha256: archiveId, manifest: input.manifest as Prisma.InputJsonValue,
    }, select: { id: true, status: true } });
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
      const raced = await prisma.oneCArchiveImport.findUnique({ where: { workspaceId_sourceInstanceId_archiveId: {
        workspaceId: input.workspaceId, sourceInstanceId: input.sourceInstanceId, archiveId,
      } }, select: { id: true, status: true } });
      if (raced) return { importId: raced.id, archiveId, status: raced.status, replayed: true };
    }
    throw error;
  }
  return { importId: created.id, archiveId, status: created.status, replayed: false };
}

export async function receiveOneCArchiveChunk(importId: string, input: ArchiveChunk) {
  archiveKey();
  const computed = oneCArchiveHash(input.records);
  if (computed !== input.sha256) {
    throw new ApiError(422, "ONE_C_ARCHIVE_CHUNK_INVALID", "Порция не соответствует манифесту 1С");
  }
  return prisma.$transaction(async (tx) => {
    await lockArchiveImport(tx, importId);
    const archive = await tx.oneCArchiveImport.findUnique({ where: { id: importId },
      select: { status: true, manifest: true, workspaceId: true, sourceInstanceId: true, encryptedBytes: true } });
    if (!archive) throw new ApiError(404, "ONE_C_ARCHIVE_NOT_FOUND", "Архив 1С не найден");
    requireOneCSyncBinding(archive);
    const manifest = oneCArchiveManifestSchema.parse(archive.manifest);
    const expected = manifest.collections.find((item) => item.key === input.collectionKey);
    if (!expected || expected.chunkHashes[input.chunkIndex] !== input.sha256) {
      throw new ApiError(422, "ONE_C_ARCHIVE_CHUNK_INVALID", "Порция не соответствует манифесту 1С");
    }
    const existing = await tx.oneCArchiveChunk.findUnique({ where: {
      importId_collectionKey_chunkIndex: { importId, collectionKey: input.collectionKey, chunkIndex: input.chunkIndex },
    }, select: { sha256: true, rowCount: true } });
    if (existing) {
      if (existing.sha256 !== computed || existing.rowCount !== input.records.length) {
        throw new ApiError(409, "ONE_C_ARCHIVE_CHUNK_CHANGED", "Повторная порция архива отличается от принятой");
      }
      return { status: "ACCEPTED", replayed: true };
    }
    if (archive.status !== "STAGING") throw new ApiError(409, "ONE_C_ARCHIVE_COMPLETE", "Завершённый архив нельзя изменить");
    const encryptedData = new Uint8Array(encryptRecords(input.records));
    enforceArchiveByteLimit(archive.encryptedBytes, encryptedData.byteLength);
    await tx.oneCArchiveChunk.create({ data: { importId, collectionKey: input.collectionKey,
      chunkIndex: input.chunkIndex, rowCount: input.records.length, sha256: computed,
      encryptedData } });
    await tx.oneCArchiveImport.update({ where: { id: importId },
      data: { encryptedBytes: { increment: BigInt(encryptedData.byteLength) } } });
    return { status: "ACCEPTED", replayed: false };
  }, { maxWait: 10_000, timeout: 30_000 });
}

export async function finalizeOneCArchive(importId: string) {
  return prisma.$transaction(async (tx) => {
    await lockArchiveImport(tx, importId);
    const archive = await tx.oneCArchiveImport.findUnique({ where: { id: importId },
      select: { status: true, manifest: true, archiveId: true, workspaceId: true, sourceInstanceId: true } });
    if (!archive) throw new ApiError(404, "ONE_C_ARCHIVE_NOT_FOUND", "Архив 1С не найден");
    requireOneCSyncBinding(archive);
    if (archive.status === "COMPLETE") return { status: "COMPLETE", replayed: true, archiveId: archive.archiveId };
    const manifest = oneCArchiveManifestSchema.parse(archive.manifest);
    const chunks = await tx.oneCArchiveChunk.findMany({ where: { importId },
      select: { collectionKey: true, chunkIndex: true, rowCount: true, sha256: true } });
    const actual = new Map(chunks.map((item) => [`${item.collectionKey}:${item.chunkIndex}`, item]));
    let totalRows = 0;
    let expectedChunks = 0;
    for (const item of manifest.collections) {
      let rows = 0;
      for (let index = 0; index < item.chunkHashes.length; index++) {
        const chunk = actual.get(`${item.key}:${index}`);
        if (!chunk || chunk.sha256 !== item.chunkHashes[index]) {
          throw new ApiError(409, "ONE_C_ARCHIVE_INCOMPLETE", `Не получена порция ${item.key}:${index}`);
        }
        rows += chunk.rowCount;
        expectedChunks++;
      }
      if (rows !== item.rowCount) throw new ApiError(409, "ONE_C_ARCHIVE_INCOMPLETE", `Не совпадает количество строк ${item.key}`);
      totalRows += rows;
    }
    if (chunks.length !== expectedChunks) throw new ApiError(409, "ONE_C_ARCHIVE_INCOMPLETE", "В архиве есть лишние порции");
    await tx.oneCArchiveImport.update({ where: { id: importId }, data: { status: "COMPLETE", completedAt: new Date() } });
    return { status: "COMPLETE", replayed: false, archiveId: archive.archiveId,
      collections: manifest.collections.length, rows: totalRows };
  }, { timeout: 120_000 });
}

export async function listOneCArchives(workspaceId: string) {
  return prisma.oneCArchiveImport.findMany({ where: { workspaceId, status: "COMPLETE" },
    orderBy: { generatedAt: "desc" }, take: 20,
    select: { id: true, archiveId: true, configurationVersion: true, readStartedAt: true,
      generatedAt: true, completedAt: true, manifest: true } });
}

export async function readOneCArchiveChunk(workspaceId: string, actorId: string, importId: string, collectionKey: string, chunkIndex: number) {
  const archive = await prisma.oneCArchiveImport.findFirst({ where: { id: importId, workspaceId, status: "COMPLETE" },
    select: { manifest: true } });
  if (!archive) throw new ApiError(404, "ONE_C_ARCHIVE_NOT_FOUND", "Архив 1С не найден");
  const manifest = oneCArchiveManifestSchema.parse(archive.manifest);
  const expected = manifest.collections.find((item) => item.key === collectionKey);
  if (!expected) throw new ApiError(404, "ONE_C_ARCHIVE_COLLECTION_NOT_FOUND", "Коллекция 1С не найдена");
  if (expected.sensitivity === "SYSTEM_SECRET") {
    throw new ApiError(403, "ONE_C_ARCHIVE_SECRET_RESTRICTED", "Системные секреты 1С не выдаются через CRM API");
  }
  const chunk = await prisma.oneCArchiveChunk.findUnique({ where: {
    importId_collectionKey_chunkIndex: { importId, collectionKey, chunkIndex },
  }, select: { sha256: true, encryptedData: true } });
  if (!chunk) throw new ApiError(404, "ONE_C_ARCHIVE_CHUNK_NOT_FOUND", "Порция архива 1С не найдена");
  const records = decryptRecords(chunk.encryptedData);
  if (oneCArchiveHash(records) !== chunk.sha256) throw new ApiError(500, "ONE_C_ARCHIVE_CORRUPT", "Нарушена целостность архива 1С");
  await prisma.auditLog.create({ data: { workspaceId, actorId, action: "ONE_C_ARCHIVE_CHUNK_READ",
    entityType: AuditEntityType.ONE_C_SYNC, entityId: importId,
    metadata: { collectionKey, chunkIndex, rowCount: records.length } } });
  return { collectionKey, chunkIndex, records };
}
