import { randomUUID } from "node:crypto";
import { AuditEvent } from "@protocolfoundry/core";
import {
  hashArgs,
  normalizeQuery,
  type AuditQuery,
  type AuditStore,
  type NewAuditEvent,
} from "./types.js";

/** Structural pool types — fit both pg.Pool and pg-mem's test adapter. */
export interface AuditPgPoolLike {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS audit_events (
  id          text PRIMARY KEY,
  tenant_id   text NOT NULL,
  project_id  text,
  kind        text NOT NULL,
  actor_type  text NOT NULL,
  actor_id    text NOT NULL,
  detail      jsonb NOT NULL,
  occurred_at timestamptz NOT NULL
);
`;

function rowToEvent(row: Record<string, unknown>): AuditEvent {
  const detail = row["detail"];
  return AuditEvent.parse({
    id: row["id"],
    tenantId: row["tenant_id"],
    ...(row["project_id"] ? { projectId: row["project_id"] } : {}),
    kind: row["kind"],
    actor: { type: row["actor_type"], id: row["actor_id"] },
    detail: typeof detail === "string" ? JSON.parse(detail) : detail,
    occurredAt: new Date(row["occurred_at"] as string | Date).toISOString(),
  });
}

/** Postgres audit store — events are append-only rows (no UPDATE path). */
export class PgAuditStore implements AuditStore {
  private schemaReady: Promise<void> | undefined;

  constructor(private readonly pool: AuditPgPoolLike) {}

  private ensureSchema(): Promise<void> {
    this.schemaReady ??= this.pool.query(SCHEMA).then(() => undefined);
    return this.schemaReady;
  }

  hashArgs(args: unknown): string {
    return hashArgs(args);
  }

  async record(event: NewAuditEvent): Promise<AuditEvent> {
    await this.ensureSchema();
    const full: AuditEvent = {
      id: randomUUID(),
      tenantId: event.tenantId ?? "local",
      ...(event.projectId !== undefined ? { projectId: event.projectId } : {}),
      kind: event.kind,
      actor: event.actor,
      detail: event.detail,
      occurredAt: new Date().toISOString(),
    };
    await this.pool.query(
      `INSERT INTO audit_events (id, tenant_id, project_id, kind, actor_type, actor_id, detail, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)`,
      [
        full.id,
        full.tenantId,
        full.projectId ?? null,
        full.kind,
        full.actor.type,
        full.actor.id,
        JSON.stringify(full.detail),
        full.occurredAt,
      ],
    );
    return full;
  }

  async query(query: AuditQuery = {}): Promise<AuditEvent[]> {
    await this.ensureSchema();
    const { limit, offset, kind, projectId } = normalizeQuery(query);
    const where: string[] = [];
    const values: unknown[] = [];
    if (kind) {
      values.push(kind);
      where.push(`kind = $${values.length}`);
    }
    if (projectId) {
      values.push(projectId);
      where.push(`project_id = $${values.length}`);
    }
    const sql = `SELECT * FROM audit_events${
      where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""
    } ORDER BY occurred_at DESC, id DESC LIMIT ${limit} OFFSET ${offset}`;
    const { rows } = await this.pool.query(sql, values);
    return rows.map(rowToEvent);
  }
}
