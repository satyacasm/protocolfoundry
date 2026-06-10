import { readFile } from "node:fs/promises";
import {
  AuditEvent,
  type EvalRun,
  type McpServerManifest,
  type Release,
} from "@protocolfoundry/core";
import {
  createReleaseStoreFromEnv,
  describeReleaseBackend,
} from "@protocolfoundry/releases";

/**
 * Control-plane data access (read-only v1). Uses the same release backend
 * the gateway serves from — Postgres via PF_DATABASE_URL or the file store
 * via PF_RELEASES_DIR (ADR-0005/0006) — plus the gateway's JSONL audit log.
 */

const auditLogPath = process.env.PF_AUDIT_LOG ?? "audit.log.jsonl";

export const store = createReleaseStoreFromEnv();

export interface ProjectSummary {
  projectId: string;
  releases: Release[];
  live: Release | undefined;
  staged: number;
  liveEval: EvalRun | undefined;
  serverName: string | undefined;
}

export async function getProjects(): Promise<ProjectSummary[]> {
  const projects: ProjectSummary[] = [];
  for (const projectId of await store.listProjects()) {
    const releases = await store.list(projectId);
    const live = releases.find((r) => r.status === "live");
    const liveEval = live ? await store.getEvalRun(projectId, live.version) : undefined;
    let serverName: string | undefined;
    if (live) {
      serverName = (await store.getManifest(projectId, live.version)).serverName;
    }
    projects.push({
      projectId,
      releases: [...releases].sort((a, b) => b.version - a.version),
      live,
      staged: releases.filter((r) => r.status === "staged").length,
      liveEval,
      serverName,
    });
  }
  return projects.sort((a, b) => a.projectId.localeCompare(b.projectId));
}

export interface ReleaseDetail {
  release: Release;
  manifest: McpServerManifest;
  evalRun: EvalRun | undefined;
}

export async function getReleaseDetail(
  projectId: string,
  version: number,
): Promise<ReleaseDetail | undefined> {
  const releases = await store.list(projectId);
  const release = releases.find((r) => r.version === version);
  if (!release) return undefined;
  return {
    release,
    manifest: await store.getManifest(projectId, version),
    evalRun: await store.getEvalRun(projectId, version),
  };
}

export async function readAuditEvents(limit = 100, kind?: string): Promise<AuditEvent[]> {
  let raw: string;
  try {
    raw = await readFile(auditLogPath, "utf8");
  } catch {
    return [];
  }
  const events: AuditEvent[] = [];
  for (const line of raw.trim().split("\n").reverse()) {
    if (!line) continue;
    try {
      const event = AuditEvent.parse(JSON.parse(line));
      if (kind && event.kind !== kind) continue;
      events.push(event);
      if (events.length >= limit) break;
    } catch {
      // skip malformed lines rather than break the viewer
    }
  }
  return events;
}

export function dataSourceInfo(): { releasesDir: string; auditLogPath: string } {
  return { releasesDir: describeReleaseBackend(), auditLogPath };
}
