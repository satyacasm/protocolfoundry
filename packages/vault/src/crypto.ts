import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope for vault secrets. The master key comes from
 * PF_VAULT_KEY (32 bytes, base64) — generate one with `pf keygen`.
 * Cloud KMS wrapping replaces the raw env key at the managed-hosting
 * milestone; the sealed format is unchanged by that swap.
 */

export interface SealedSecret {
  iv: string; // base64, 12 bytes
  tag: string; // base64, 16 bytes
  data: string; // base64 ciphertext
}

export function parseVaultKey(base64Key: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(base64Key, "base64");
  } catch {
    throw new Error("PF_VAULT_KEY is not valid base64");
  }
  if (key.length !== 32) {
    throw new Error(
      `PF_VAULT_KEY must decode to exactly 32 bytes (got ${key.length}) — generate one with: pf keygen`,
    );
  }
  return key;
}

export function seal(key: Buffer, plaintext: string): SealedSecret {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
    data: data.toString("base64"),
  };
}

export function unseal(key: Buffer, sealed: SealedSecret): string {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
  try {
    return Buffer.concat([
      decipher.update(Buffer.from(sealed.data, "base64")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("Vault decryption failed — wrong PF_VAULT_KEY or tampered data");
  }
}
