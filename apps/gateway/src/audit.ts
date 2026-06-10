/**
 * Audit storage moved to @protocolfoundry/audit (JSONL + Postgres backends).
 * `AuditLog` remains as the historical name for the JSONL store.
 */
export {
  JsonlAuditStore as AuditLog,
  type AuditSink,
  type AuditStore,
} from "@protocolfoundry/audit";
