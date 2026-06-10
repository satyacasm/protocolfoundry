import { appendFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import type { AuditEvent } from "@protocolfoundry/core";

/**
 * Append-only JSONL audit log. Every tool invocation is recorded — success,
 * failure, and approval denial alike (docs/05-security-model.md). Arguments
 * are stored as a hash, never raw, so payloads can't leak via the log.
 */
export class AuditLog {
  constructor(private readonly filePath: string) {}

  hashArgs(args: unknown): string {
    return createHash("sha256").update(JSON.stringify(args ?? {})).digest("hex");
  }

  async record(
    event: Omit<AuditEvent, "id" | "occurredAt" | "tenantId"> & { tenantId?: string },
  ): Promise<AuditEvent> {
    const full: AuditEvent = {
      id: randomUUID(),
      tenantId: event.tenantId ?? "local",
      ...(event.projectId !== undefined ? { projectId: event.projectId } : {}),
      kind: event.kind,
      actor: event.actor,
      detail: event.detail,
      occurredAt: new Date().toISOString(),
    };
    await appendFile(this.filePath, `${JSON.stringify(full)}\n`, "utf8");
    return full;
  }
}
