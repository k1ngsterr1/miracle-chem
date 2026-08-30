import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { config } from "../config.js";
import { ApiError } from "./api-error.js";

export const MAX_EXPENSE_RECEIPT_BYTES = 10 * 1024 * 1024;
export const EXPENSE_RECEIPT_ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf";

export interface ExpenseReceiptUpload {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

interface StoredReceipt {
  storageKey: string;
  mimeType: string;
  sizeBytes: number;
}

export async function storeExpenseReceipt(
  workspaceId: string,
  expenseId: string,
  file: ExpenseReceiptUpload,
): Promise<StoredReceipt> {
  if (file.size <= 0 || file.buffer.length <= 0) {
    throw new ApiError(400, "EXPENSE_RECEIPT_EMPTY", "Файл чека пуст");
  }
  if (file.size > MAX_EXPENSE_RECEIPT_BYTES || file.buffer.length > MAX_EXPENSE_RECEIPT_BYTES) {
    throw new ApiError(413, "EXPENSE_RECEIPT_TOO_LARGE", "Размер чека не должен превышать 10 МБ");
  }
  const detected = detectReceipt(file.buffer);
  if (detected === null) {
    throw new ApiError(415, "EXPENSE_RECEIPT_TYPE_UNSUPPORTED", "Загрузите чек Kaspi в формате JPG, PNG, WEBP или PDF");
  }
  const storageKey = `expense-receipts/${workspaceId}/${expenseId}/${randomUUID()}.${detected.extension}`;
  const path = storedPath(storageKey);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, file.buffer, { flag: "wx" });
  return { storageKey, mimeType: detected.mimeType, sizeBytes: file.buffer.length };
}

export async function readStoredReceipt(storageKey: string): Promise<Buffer> {
  try {
    return await readFile(storedPath(storageKey));
  } catch (cause) {
    if (isMissingFile(cause)) {
      throw new ApiError(404, "EXPENSE_RECEIPT_FILE_NOT_FOUND", "Файл чека не найден");
    }
    throw cause;
  }
}

export async function removeStoredReceipt(storageKey: string): Promise<void> {
  try {
    await unlink(storedPath(storageKey));
  } catch (cause) {
    if (!isMissingFile(cause)) throw cause;
  }
}

export function safeReceiptName(name: string): string {
  const sanitized = name
    .normalize("NFC")
    .replace(/[\\/\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (sanitized === "" ? "Чек Kaspi" : sanitized).slice(0, 255);
}

function storedPath(storageKey: string): string {
  const root = resolve(config.storageDir);
  const path = resolve(root, storageKey);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new ApiError(400, "INVALID_STORAGE_KEY", "Некорректный путь к файлу");
  }
  return path;
}

function detectReceipt(buffer: Buffer): { mimeType: string; extension: string } | null {
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") {
    return { mimeType: "image/webp", extension: "webp" };
  }
  if (buffer.length >= 5 && buffer.toString("ascii", 0, 5) === "%PDF-") {
    return { mimeType: "application/pdf", extension: "pdf" };
  }
  return null;
}

function isMissingFile(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "code" in cause && cause.code === "ENOENT";
}
