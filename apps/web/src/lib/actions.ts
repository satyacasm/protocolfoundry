"use server";

import { redirect } from "next/navigation";
import { store } from "./data";
import { appendAudit, requireOperator } from "./operator";

/**
 * Control-plane mutations (dashboard v2 write paths). Rules:
 * - Writes are REFUSED in open mode — promote/rollback require a logged-in
 *   operator, so an unprotected dashboard stays read-only.
 * - Every mutation is appended to the same audit log the gateway writes.
 */

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
