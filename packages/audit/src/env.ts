import pg from "pg";
import { JsonlAuditStore } from "./jsonl.js";
import { PgAuditStore, type AuditPgPoolLike } from "./pg.js";
import type { AuditStore } from "./types.js";

/**
 * Same backend convention as releases (ADR-0006):
 *   PF_DATABASE_URL -> Postgres audit_events table
 *   else            -> JSONL file at PF_AUDIT_LOG (default audit.log.jsonl)
 */
export function createAuditStoreFromEnv(
  env: Record<string, string | undefined> = process.env,
): AuditStore {
  const databaseUrl = env["PF_DATABASE_URL"];
  if (databaseUrl) {
    return new PgAuditStore(
      new pg.Pool({ connectionString: databaseUrl }) as unknown as AuditPgPoolLike,
    );
  }
  return new JsonlAuditStore(env["PF_AUDIT_LOG"] ?? "audit.log.jsonl");
}

export function describeAuditBackend(
  env: Record<string, string | undefined> = process.env,
): string {
  if (env["PF_DATABASE_URL"]) return "postgres (PF_DATABASE_URL)";
  return env["PF_AUDIT_LOG"] ?? "audit.log.jsonl";
}
