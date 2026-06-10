import { appendFile, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { AuditEvent } from "@protocolfoundry/core";
import {
  hashArgs,
  normalizeQuery,
  type AuditQuery,
  type AuditStore,
  type NewAuditEvent,
} from "./types.js";

/**
 * Append-only JSONL audit store — the zero-infra backend. Same line format
 * the gateway has written since Phase 1, so existing logs keep working.
 */
export class JsonlAuditStore implements AuditStore {
  constructor(private readonly filePath: string) {}

  hashArgs(args: unknown): string {
    return hashArgs(args);
  }

  async record(event: NewAuditEvent): Promise<AuditEvent> {
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

  async query(query: AuditQuery = {}): Promise<AuditEvent[]> {
    const { limit, offset, kind, projectId } = normalizeQuery(query);
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf8");
    } catch {
      return [];
    }
    const events: AuditEvent[] = [];
    let skipped = 0;
    for (const line of raw.trim().split("\n").reverse()) {
      if (!line) continue;
      let event: AuditEvent;
      try {
        event = AuditEvent.parse(JSON.parse(line));
      } catch {
        continue; // skip malformed lines rather than break the viewer
      }
      if (kind && event.kind !== kind) continue;
      if (projectId && event.projectId !== projectId) continue;
      if (skipped < offset) {
        skipped += 1;
        continue;
      }
      events.push(event);
      if (events.length >= limit) break;
    }
    return events;
  }
}
