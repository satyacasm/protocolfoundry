import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { FileVaultStore, PgVaultStore, type VaultPgPoolLike, type VaultStore } from "../src/stores.js";
import { parseVaultKey } from "../src/crypto.js";

const dir = mkdtempSync(join(tmpdir(), "pf-vault-"));
const KEY = randomBytes(32).toString("base64");

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

function behaviors(name: string, makeStore: (key: string) => VaultStore) {
  describe(name, () => {
    it("round-trips secrets, lists without exposing them, and removes", async () => {
      const store = makeStore(KEY);
      await store.set("PF_CRED_APIKEYAUTH", "super-secret-upstream-key");
      await store.set("stripe-key", "sk_live_abc123");

      expect(await store.getSecret("PF_CRED_APIKEYAUTH")).toBe("super-secret-upstream-key");
      expect(await store.getSecret("missing")).toBeUndefined();

      const entries = await store.list();
      expect(entries.map((e) => e.id)).toEqual(["PF_CRED_APIKEYAUTH", "stripe-key"]);
      expect(JSON.stringify(entries)).not.toContain("super-secret");

      expect(await store.remove("stripe-key")).toBe(true);
      expect(await store.remove("stripe-key")).toBe(false);
      expect(await store.getSecret("stripe-key")).toBeUndefined();
    });

    it("rejects invalid ids", async () => {
      const store = makeStore(KEY);
      await expect(store.set("../evil", "x")).rejects.toThrow(/Credential id/);
    });
  });
}

behaviors("FileVaultStore", (key) => new FileVaultStore(join(dir, `v-${Date.now()}-${Math.random()}.json`), key));
behaviors("PgVaultStore", (key) => {
  const { Pool } = newDb().adapters.createPg();
  return new PgVaultStore(new Pool() as unknown as VaultPgPoolLike, key);
});

describe("encryption", () => {
  it("stores nothing readable on disk and fails closed on a wrong key", async () => {
    const path = join(dir, "sealed.json");
    const store = new FileVaultStore(path, KEY);
    await store.set("api-key", "hunter2-plaintext");

    const onDisk = await readFile(path, "utf8");
    expect(onDisk).not.toContain("hunter2");

    const wrongKey = new FileVaultStore(path, randomBytes(32).toString("base64"));
    await expect(wrongKey.getSecret("api-key")).rejects.toThrow(/decryption failed/);
  });

  it("rejects malformed master keys", () => {
    expect(() => parseVaultKey("too-short")).toThrow(/32 bytes/);
  });
});
