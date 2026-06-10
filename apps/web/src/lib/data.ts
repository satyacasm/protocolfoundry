import {
  type AuditEvent,
  type EvalRun,
  type McpServerManifest,
  type Release,
} from "@protocolfoundry/core";
import {
  createAuditStoreFromEnv,
  describeAuditBackend,
  type AuditQuery,
} from "@protocolfoundry/audit";
import {
  createReleaseStoreFromEnv,
  describeReleaseBackend,
} from "@protocolfoundry/releases";

/**
 * Control-plane data access. Uses the same backends the gateway uses —
 * Postgres via PF_DATABASE_URL, or the file store (PF_RELEASES_DIR) and
 * JSONL audit log (PF_AUDIT_LOG) — see ADR-0005/0006.
 */

export const store = createReleaseStoreFromEnv();
export const auditStore = createAuditStoreFromEnv();

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

export async function readAuditEvents(
  limitOrQuery: number | AuditQuery = 100,
  kind?: string,
): Promise<AuditEvent[]> {
  const query: AuditQuery =
    typeof limitOrQuery === "number"
      ? { limit: limitOrQuery, ...(kind ? { kind } : {}) }
      : limitOrQuery;
  return auditStore.query(query);
}

export function dataSourceInfo(): { releasesDir: string; auditLogPath: string } {
  return { releasesDir: describeReleaseBackend(), auditLogPath: describeAuditBackend() };
}
