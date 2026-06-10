import { randomUUID } from "node:crypto";
import { EvalRun, McpServerManifest, Release } from "@protocolfoundry/core";
import {
  assertReleaseGate,
  type CreateReleaseOptions,
  type ReleaseStore,
} from "./types.js";

/**
 * Minimal structural pool types so the store works with both `pg.Pool` and
 * pg-mem's adapter in tests, without binding our API to either.
 */
export interface PgQueryResult {
  rows: Array<Record<string, unknown>>;
}
export interface PgPoolClient {
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
  release(): void;
}
export interface PgPoolLike {
  query(text: string, values?: unknown[]): Promise<PgQueryResult>;
  connect(): Promise<PgPoolClient>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS releases (
  id          text PRIMARY KEY,
  project_id  text NOT NULL,
  version     int  NOT NULL,
  status      text NOT NULL,
  manifest    jsonb NOT NULL,
  eval_run    jsonb,
  eval_run_id text,
  approved_by text,
  created_at  timestamptz NOT NULL,
  UNIQUE (project_id, version)
);
`;

function rowToRelease(row: Record<string, unknown>): Release {
  return Release.parse({
    id: row["id"],
    projectId: row["project_id"],
    manifestRef: `pg:v${row["version"]}`,
    version: row["version"],
    status: row["status"],
    ...(row["eval_run_id"] ? { evalRunId: row["eval_run_id"] } : {}),
    ...(row["approved_by"] ? { approvedBy: row["approved_by"] } : {}),
    createdAt: new Date(row["created_at"] as string | Date).toISOString(),
  });
}

function parseJsonb(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

/**
 * Postgres-backed release store (ADR-0006). Same semantics as the file store:
 * the manifest column is written once and never updated — promote/rollback
 * touch only the status column. Works against any Postgres via PF_DATABASE_URL.
 */
export class PgReleaseStore implements ReleaseStore {
  private schemaReady: Promise<void> | undefined;

  constructor(private readonly pool: PgPoolLike) {}

  private ensureSchema(): Promise<void> {
    this.schemaReady ??= this.pool.query(SCHEMA).then(() => undefined);
    return this.schemaReady;
  }

  private async tx<T>(fn: (client: PgPoolClient) => Promise<T>): Promise<T> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async listProjects(): Promise<string[]> {
    await this.ensureSchema();
    const { rows } = await this.pool.query(
      "SELECT DISTINCT project_id FROM releases ORDER BY project_id",
    );
    return rows.map((r) => String(r["project_id"]));
  }

  async list(projectId: string): Promise<Release[]> {
    await this.ensureSchema();
    const { rows } = await this.pool.query(
      "SELECT * FROM releases WHERE project_id = $1 ORDER BY version",
      [projectId],
    );
    return rows.map(rowToRelease);
  }

  async createRelease(
    manifest: McpServerManifest,
    options: CreateReleaseOptions = {},
  ): Promise<Release> {
    assertReleaseGate(options);
    const { evalRun, approvedBy } = options;
    return this.tx(async (client) => {
      const { rows } = await client.query(
        "SELECT COALESCE(MAX(version), 0) AS v FROM releases WHERE project_id = $1",
        [manifest.projectId],
      );
      const version = Number(rows[0]?.["v"] ?? 0) + 1;
      const release = {
        id: randomUUID(),
        project_id: manifest.projectId,
        version,
        status: "staged",
        eval_run_id: evalRun?.id ?? null,
        approved_by: approvedBy ?? null,
        created_at: new Date().toISOString(),
      };
      await client.query(
        `INSERT INTO releases (id, project_id, version, status, manifest, eval_run, eval_run_id, approved_by, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)`,
        [
          release.id,
          release.project_id,
          release.version,
          release.status,
          JSON.stringify(manifest),
          evalRun ? JSON.stringify(evalRun) : null,
          release.eval_run_id,
          release.approved_by,
          release.created_at,
        ],
      );
      return rowToRelease(release as unknown as Record<string, unknown>);
    });
  }

  async promote(projectId: string, version: number): Promise<Release> {
    return this.tx(async (client) => {
      const { rows } = await client.query(
        "SELECT * FROM releases WHERE project_id = $1 AND version = $2",
        [projectId, version],
      );
      const target = rows[0];
      if (!target) throw new Error(`No release v${version} for project "${projectId}"`);
      if (target["status"] !== "staged") {
        throw new Error(
          `Release v${version} is "${target["status"]}" — only staged releases can be promoted`,
        );
      }
      await client.query(
        "UPDATE releases SET status = 'retired' WHERE project_id = $1 AND status = 'live'",
        [projectId],
      );
      await client.query(
        "UPDATE releases SET status = 'live' WHERE project_id = $1 AND version = $2",
        [projectId, version],
      );
      return rowToRelease({ ...target, status: "live" });
    });
  }

  async rollback(projectId: string): Promise<Release> {
    return this.tx(async (client) => {
      const live = (
        await client.query(
          "SELECT * FROM releases WHERE project_id = $1 AND status = 'live'",
          [projectId],
        )
      ).rows[0];
      if (!live) throw new Error(`Project "${projectId}" has no live release to roll back`);
      const previous = (
        await client.query(
          "SELECT * FROM releases WHERE project_id = $1 AND status = 'retired' ORDER BY version DESC",
          [projectId],
        )
      ).rows[0];
      if (!previous) {
        throw new Error(`Project "${projectId}" has no previous release to roll back to`);
      }
      await client.query(
        "UPDATE releases SET status = 'rolledBack' WHERE project_id = $1 AND version = $2",
        [projectId, live["version"]],
      );
      await client.query(
        "UPDATE releases SET status = 'live' WHERE project_id = $1 AND version = $2",
        [projectId, previous["version"]],
      );
      return rowToRelease({ ...previous, status: "live" });
    });
  }

  async getLive(
    projectId: string,
  ): Promise<{ release: Release; manifest: McpServerManifest } | undefined> {
    await this.ensureSchema();
    const { rows } = await this.pool.query(
      "SELECT * FROM releases WHERE project_id = $1 AND status = 'live'",
      [projectId],
    );
    const row = rows[0];
    if (!row) return undefined;
    return {
      release: rowToRelease(row),
      manifest: McpServerManifest.parse(parseJsonb(row["manifest"])),
    };
  }

  async getManifest(projectId: string, version: number): Promise<McpServerManifest> {
    await this.ensureSchema();
    const { rows } = await this.pool.query(
      "SELECT manifest FROM releases WHERE project_id = $1 AND version = $2",
      [projectId, version],
    );
    if (!rows[0]) throw new Error(`No release v${version} for project "${projectId}"`);
    return McpServerManifest.parse(parseJsonb(rows[0]["manifest"]));
  }

  async getEvalRun(projectId: string, version: number): Promise<EvalRun | undefined> {
    await this.ensureSchema();
    const { rows } = await this.pool.query(
      "SELECT eval_run FROM releases WHERE project_id = $1 AND version = $2",
      [projectId, version],
    );
    const value = rows[0]?.["eval_run"];
    if (value === null || value === undefined) return undefined;
    return EvalRun.parse(parseJsonb(value));
  }
}
