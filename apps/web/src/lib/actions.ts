"use server";

import { appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { AuditEvent } from "@protocolfoundry/core";
import { dataSourceInfo, store } from "./data";
import { SESSION_COOKIE, sessionSecret, verifySessionToken } from "./session";

/**
 * Control-plane mutations (dashboard v2 write paths). Rules:
 * - Writes are REFUSED in open mode — promote/rollback require a logged-in
 *   operator, so an unprotected dashboard stays read-only.
 * - Every mutation is appended to the same audit log the gateway writes.
 */

async function requireOperator(): Promise<string> {
  const secret = sessionSecret();
  if (!secret) {
    throw new Error("Dashboard is in open mode (read-only). Set PF_DASHBOARD_PASSWORD to enable writes.");
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySessionToken(token, secret))) {
    throw new Error("Not authenticated");
  }
  return "operator";
}

async function appendAudit(
  kind: AuditEvent["kind"],
  projectId: string,
  detail: Record<string, unknown>,
  actorId: string,
): Promise<void> {
  const event: AuditEvent = {
    id: randomUUID(),
    tenantId: "local",
    projectId,
    kind,
    actor: { type: "user", id: actorId },
    detail,
    occurredAt: new Date().toISOString(),
  };
  await appendFile(dataSourceInfo().auditLogPath, `${JSON.stringify(event)}\n`, "utf8");
}

function backToProject(projectId: string, notice: string, isError = false): never {
  const param = isError ? "error" : "notice";
  redirect(`/projects/${projectId}?${param}=${encodeURIComponent(notice)}`);
}

export async function promoteRelease(projectId: string, version: number): Promise<void> {
  let actor: string;
  try {
    actor = await requireOperator();
  } catch (error) {
    backToProject(projectId, error instanceof Error ? error.message : String(error), true);
  }
  try {
    const release = await store.promote(projectId, version);
    await appendAudit("releasePromoted", projectId, { version: release.version }, actor);
  } catch (error) {
    backToProject(projectId, error instanceof Error ? error.message : String(error), true);
  }
  backToProject(projectId, `v${version} is now live`);
}

export async function rollbackRelease(projectId: string): Promise<void> {
  let actor: string;
  try {
    actor = await requireOperator();
  } catch (error) {
    backToProject(projectId, error instanceof Error ? error.message : String(error), true);
  }
  let restoredVersion: number;
  try {
    const release = await store.rollback(projectId);
    restoredVersion = release.version;
    await appendAudit("releaseRolledBack", projectId, { restoredVersion }, actor);
  } catch (error) {
    backToProject(projectId, error instanceof Error ? error.message : String(error), true);
  }
  backToProject(projectId, `Rolled back — v${restoredVersion} is live again`);
}
