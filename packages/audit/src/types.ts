import { createHash } from "node:crypto";
import type { AuditEvent } from "@protocolfoundry/core";

/** Event as callers provide it; the store fills id/tenantId/occurredAt. */
export type NewAuditEvent = Omit<AuditEvent, "id" | "occurredAt" | "tenantId"> & {
  tenantId?: string;
};

export interface AuditQuery {
  /** Max events to return (newest first). Default 100, capped at 500. */
  limit?: number;
  /** Skip this many (for pagination). */
  offset?: number;
  kind?: string;
  projectId?: string;
}

/** What the gateway/dashboard need to WRITE audit events. */
export interface AuditSink {
  hashArgs(args: unknown): string;
  record(event: NewAuditEvent): Promise<AuditEvent>;
}

/** Full store: write + paginated reads (newest first). */
export interface AuditStore extends AuditSink {
  query(query?: AuditQuery): Promise<AuditEvent[]>;
}

/** Arguments are stored as a hash, never raw (docs/05-security-model.md). */
export function hashArgs(args: unknown): string {
  return createHash("sha256").update(JSON.stringify(args ?? {})).digest("hex");
}

export function normalizeQuery(query: AuditQuery = {}): Required<
  Pick<AuditQuery, "limit" | "offset">
> &
  Pick<AuditQuery, "kind" | "projectId"> {
  return {
    limit: Math.min(Math.max(1, Math.floor(query.limit ?? 100)), 500),
    offset: Math.max(0, Math.floor(query.offset ?? 0)),
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.projectId ? { projectId: query.projectId } : {}),
  };
}
