import { readFile, writeFile } from "node:fs/promises";
import { parseVaultKey, seal, unseal, type SealedSecret } from "./crypto.js";

export interface VaultEntry {
  id: string;
  createdAt: string;
}

/**
 * Encrypted-at-rest credential storage. Secrets go in via set() and only
 * ever come out inside the gateway's credential resolver — never in lists,
 * logs, manifests, or LLM prompts (docs/05-security-model.md).
 */
export interface VaultStore {
  set(id: string, secret: string): Promise<void>;
  getSecret(id: string): Promise<string | undefined>;
  list(): Promise<VaultEntry[]>;
  remove(id: string): Promise<boolean>;
}

function assertId(id: string): void {
  if (!/^[A-Za-z0-9_.-]+$/.test(id)) {
    throw new Error("Credential id must be letters, digits, dot, dash, or underscore");
  }
}

interface FileVaultShape {
  vaultVersion: 1;
  credentials: Record<string, SealedSecret & { createdAt: string }>;
}

export class FileVaultStore implements VaultStore {
  private readonly key: Buffer;

  constructor(
    private readonly filePath: string,
    base64Key: string,
  ) {
    this.key = parseVaultKey(base64Key);
  }

  private async load(): Promise<FileVaultShape> {
    try {
      return JSON.parse(await readFile(this.filePath, "utf8")) as FileVaultShape;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { vaultVersion: 1, credentials: {} };
      }
      throw error;
    }
  }

  private async save(shape: FileVaultShape): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(shape, null, 2), "utf8");
  }

  async set(id: string, secret: string): Promise<void> {
    assertId(id);
    const shape = await this.load();
    shape.credentials[id] = { ...seal(this.key, secret), createdAt: new Date().toISOString() };
    await this.save(shape);
  }

  async getSecret(id: string): Promise<string | undefined> {
    const sealed = (await this.load()).credentials[id];
    return sealed === undefined ? undefined : unseal(this.key, sealed);
  }

  async list(): Promise<VaultEntry[]> {
    const shape = await this.load();
    return Object.entries(shape.credentials)
      .map(([id, v]) => ({ id, createdAt: v.createdAt }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  async remove(id: string): Promise<boolean> {
    const shape = await this.load();
    if (!(id in shape.credentials)) return false;
    delete shape.credentials[id];
    await this.save(shape);
    return true;
  }
}

export interface VaultPgPoolLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS vault_credentials (
  id         text PRIMARY KEY,
  iv         text NOT NULL,
  tag        text NOT NULL,
  data       text NOT NULL,
  created_at timestamptz NOT NULL
);
`;

export class PgVaultStore implements VaultStore {
  private readonly key: Buffer;
  private schemaReady: Promise<void> | undefined;

  constructor(
    private readonly pool: VaultPgPoolLike,
    base64Key: string,
  ) {
    this.key = parseVaultKey(base64Key);
  }

  private ensureSchema(): Promise<void> {
    this.schemaReady ??= this.pool.query(SCHEMA).then(() => undefined);
    return this.schemaReady;
  }

  async set(id: string, secret: string): Promise<void> {
    assertId(id);
    await this.ensureSchema();
    const sealed = seal(this.key, secret);
    await this.pool.query("DELETE FROM vault_credentials WHERE id = $1", [id]);
    await this.pool.query(
      "INSERT INTO vault_credentials (id, iv, tag, data, created_at) VALUES ($1, $2, $3, $4, $5)",
      [id, sealed.iv, sealed.tag, sealed.data, new Date().toISOString()],
    );
  }

  async getSecret(id: string): Promise<string | undefined> {
    await this.ensureSchema();
    const { rows } = await this.pool.query(
      "SELECT iv, tag, data FROM vault_credentials WHERE id = $1",
      [id],
    );
    const row = rows[0];
    if (!row) return undefined;
    return unseal(this.key, {
      iv: String(row["iv"]),
      tag: String(row["tag"]),
      data: String(row["data"]),
    });
  }

  async list(): Promise<VaultEntry[]> {
    await this.ensureSchema();
    const { rows } = await this.pool.query(
      "SELECT id, created_at FROM vault_credentials ORDER BY id",
    );
    return rows.map((r) => ({
      id: String(r["id"]),
      createdAt: new Date(r["created_at"] as string | Date).toISOString(),
    }));
  }

  async remove(id: string): Promise<boolean> {
    await this.ensureSchema();
    const existing = await this.getSecret(id).catch(() => undefined);
    await this.pool.query("DELETE FROM vault_credentials WHERE id = $1", [id]);
    return existing !== undefined;
  }
}
