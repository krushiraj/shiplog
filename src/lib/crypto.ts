import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";

function loadKey(keyB64: string | undefined): Buffer {
  if (!keyB64) throw new Error("TOKEN_ENC_KEY is not set (expected a base64-encoded 32-byte key)");
  const key = Buffer.from(keyB64, "base64");
  if (key.length !== 32) throw new Error(`TOKEN_ENC_KEY must decode to 32 bytes, got ${key.length}`);
  return key;
}

export function encrypt(plain: string, keyB64 = process.env.TOKEN_ENC_KEY): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, loadKey(keyB64), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), ct].map((b) => b.toString("base64")).join(".");
}

export function decrypt(blob: string, keyB64 = process.env.TOKEN_ENC_KEY): string {
  const parts = blob.split(".");
  if (parts.length !== 3) throw new Error("Malformed encrypted blob");
  const [iv, tag, ct] = parts.map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv(ALGO, loadKey(keyB64), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
