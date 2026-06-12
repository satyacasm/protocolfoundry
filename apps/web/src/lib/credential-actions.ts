"use server";

import { redirect } from "next/navigation";
import { store } from "./data";
import { connectCredentialValue, removeCredentialValue } from "./credentials";
import { appendAudit, requireOperator } from "./operator";

/**
 * Credential connect/disconnect (ADR-0011). The pasted secret goes straight
 * into the vault; audit events record WHICH binding changed, never the value.
 */

function back(projectId: string, notice: string, isError = false): never {
  const param = isError ? "error" : "notice";
  redirect(`/projects/${projectId}?${param}=${encodeURIComponent(notice)}`);
}

async function latestManifest(projectId: string) {
  const releases = await store.list(projectId);
  const newest = [...releases].sort((a, b) => b.version - a.version)[0];
  if (!newest) throw new Error(`No releases for "${projectId}"`);
  return store.getManifest(projectId, newest.version);
}

export async function connectCredential(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const vaultCredentialId = String(formData.get("vaultCredentialId") ?? "");
  let actor: string;
  try {
    actor = await requireOperator();
  } catch (error) {
    back(projectId, error instanceof Error ? error.message : String(error), true);
  }
  try {
    const manifest = await latestManifest(projectId);
    await connectCredentialValue(manifest, vaultCredentialId, String(formData.get("secret") ?? ""));
    await appendAudit("credentialConnected", projectId, { vaultCredentialId }, actor);
  } catch (error) {
    back(projectId, error instanceof Error ? error.message : String(error), true);
  }
  back(projectId, `Credential ${vaultCredentialId} connected — live immediately, no restart needed`);
}

export async function disconnectCredential(formData: FormData): Promise<void> {
  const projectId = String(formData.get("projectId") ?? "");
  const vaultCredentialId = String(formData.get("vaultCredentialId") ?? "");
  let actor: string;
  try {
    actor = await requireOperator();
  } catch (error) {
    back(projectId, error instanceof Error ? error.message : String(error), true);
  }
  let removed = false;
  try {
    const manifest = await latestManifest(projectId);
    removed = await removeCredentialValue(manifest, vaultCredentialId);
    if (removed) {
      await appendAudit("credentialRevoked", projectId, { vaultCredentialId }, actor);
    }
  } catch (error) {
    back(projectId, error instanceof Error ? error.message : String(error), true);
  }
  back(
    projectId,
    removed ? `Credential ${vaultCredentialId} removed from the vault` : "Nothing to remove",
  );
}
