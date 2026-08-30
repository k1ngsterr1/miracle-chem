import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const PREFIX = "scrypt-v1";

export function hashPassword(password: string): string {
  if (password.length < 8) throw new Error("Password must contain at least 8 characters");
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEY_LENGTH);
  return `${PREFIX}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const [prefix, encodedSalt, encodedHash] = storedHash.split("$");
  if (prefix !== PREFIX || encodedSalt === undefined || encodedHash === undefined) return false;
  try {
    const expected = Buffer.from(encodedHash, "base64url");
    const actual = scryptSync(password, Buffer.from(encodedSalt, "base64url"), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}
