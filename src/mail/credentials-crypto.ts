import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Credentials } from "./provider";

// AES-256-GCM: authenticated encryption, so a tampered ciphertext fails to
// decrypt instead of silently yielding garbage. Stored as
// "v1.<iv>.<tag>.<ciphertext>" (base64url) so the format can change later.
const VERSION = "v1";

export function loadCredentialsKey(raw = process.env.MAIL_CREDENTIALS_KEY): Buffer {
  if (!raw) {
    throw new Error("MAIL_CREDENTIALS_KEY is not set (32 random bytes, base64)");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`MAIL_CREDENTIALS_KEY must decode to 32 bytes, got ${key.length}`);
  }
  return key;
}

export function encryptCredentials(credentials: Credentials, key = loadCredentialsKey()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decryptCredentials(stored: string, key = loadCredentialsKey()): Credentials {
  const [version, iv, tag, ciphertext] = stored.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) {
    throw new Error("Unrecognized encrypted credentials format");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as Credentials;
}
