/**
 * AES-256-GCM encryption for Spotify OAuth tokens at rest.
 * Key: SPOTIFY_TOKEN_ENCRYPTION_KEY — 64-char hex string (32 bytes).
 * Storage format: "<iv_hex>:<ciphertext_hex>:<tag_hex>"
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const KEY_ENV = process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY ?? "";

function getKey(): Buffer {
  if (!KEY_ENV || KEY_ENV.length !== 64) {
    throw new Error("SPOTIFY_TOKEN_ENCRYPTION_KEY must be a 64-char hex string");
  }
  return Buffer.from(KEY_ENV, "hex");
}

export function encryptToken(plaintext: string): string {
  const key = getKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${ct.toString("hex")}:${tag.toString("hex")}`;
}

export function decryptToken(stored: string): string {
  const key = getKey();
  const parts = stored.split(":");
  if (parts.length !== 3) throw new Error("Invalid token format");
  const [ivHex, ctHex, tagHex] = parts;
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctHex, "hex")),
    decipher.final(),
  ]).toString("utf8");
}
