import type { AuthRequirement, CredentialGuide, McpServerManifest } from "@protocolfoundry/core";
import { createVaultFromEnv, type VaultStore } from "@protocolfoundry/vault";

/**
 * Credential onboarding (ADR-0011): operators paste upstream credentials into
 * the dashboard; they are sealed into the shared vault, where the gateway's
 * resolver finds them without env changes or restarts (env:NAME refs fall
 * back to the vault row NAME). Secrets pass through these helpers straight to
 * the vault — they are never logged, audited, or returned.
 */

let cached: VaultStore | undefined | null = null;

/** The vault shared with the gateway (PF_VAULT_KEY); undefined in open setups. */
export function getVault(): VaultStore | undefined {
  if (cached === null) cached = createVaultFromEnv();
  return cached ?? undefined;
}

/** Strip the resolver prefix: env:NAME / vault:id -> the vault row id. */
export function vaultRowId(vaultCredentialId: string): string {
  return vaultCredentialId.replace(/^(env|vault):/, "");
}

/** Generic per-auth-kind setup instructions for manifests without authored guides. */
export function fallbackGuide(scheme: AuthRequirement | undefined): CredentialGuide {
  switch (scheme?.kind) {
    case "basic":
      return {
        title: "API key (HTTP Basic)",
        valueFormat: "username:password — many SaaS use <api_key>: with an empty password",
        steps: [
          "Sign in to the upstream provider's dashboard.",
          "Create or copy an API key from its developer/API settings page.",
          "Paste it below as username:password (often just the key followed by a colon).",
        ],
      };
    case "bearer":
    case "oauth2":
      return {
        title: "Access token (Bearer)",
        valueFormat:
          "the raw token — or a full header value like `token <key>:<secret>` for APIs with a custom scheme",
        steps: [
          "Sign in to the upstream provider's developer portal.",
          "Create an app / API client and complete its token or OAuth flow.",
          "Paste the access token below. If the API uses a non-Bearer prefix, paste the full value after `Authorization:`.",
        ],
      };
    default:
      return {
        title: "API key",
        valueFormat: "the raw key, exactly as the provider issued it",
        steps: [
          "Sign in to the upstream provider's dashboard.",
          "Create or copy an API key from its developer/API settings page.",
          "Paste the key below.",
        ],
      };
  }
}

export interface CredentialSlot {
  authRequirementId: string;
  vaultCredentialId: string;
  /** Vault row the gateway resolver reads (env vars on the gateway still win). */
  rowId: string;
  kind: AuthRequirement["kind"] | "unknown";
  guide: CredentialGuide;
  inVault: boolean;
}

/** One slot per manifest credential binding, with guide and connect status. */
export async function listCredentialSlots(
  manifest: McpServerManifest,
  vault: VaultStore | undefined = getVault(),
): Promise<CredentialSlot[]> {
  const rows = new Set((await vault?.list().catch(() => []))?.map((e) => e.id) ?? []);
  return manifest.credentialBindings.map((binding) => {
    const scheme = manifest.authSchemes[binding.authRequirementId];
    return {
      authRequirementId: binding.authRequirementId,
      vaultCredentialId: binding.vaultCredentialId,
      rowId: vaultRowId(binding.vaultCredentialId),
      kind: scheme?.kind ?? "unknown",
      guide: manifest.credentialGuides[binding.authRequirementId] ?? fallbackGuide(scheme),
      inVault: rows.has(vaultRowId(binding.vaultCredentialId)),
    };
  });
}

/** Seal a pasted secret into the vault for one of the manifest's bindings. */
export async function connectCredentialValue(
  manifest: McpServerManifest,
  vaultCredentialId: string,
  secret: string,
  vault: VaultStore | undefined = getVault(),
): Promise<void> {
  const binding = manifest.credentialBindings.find(
    (b) => b.vaultCredentialId === vaultCredentialId,
  );
  if (!binding) {
    throw new Error(`Credential "${vaultCredentialId}" is not declared by this manifest`);
  }
  if (!secret.trim()) throw new Error("Secret is empty");
  if (!vault) {
    throw new Error("No vault configured — set PF_VAULT_KEY (and PF_DATABASE_URL) first");
  }
  await vault.set(vaultRowId(vaultCredentialId), secret);
}

/** Remove a connected credential (rotation hygiene). */
export async function removeCredentialValue(
  manifest: McpServerManifest,
  vaultCredentialId: string,
  vault: VaultStore | undefined = getVault(),
): Promise<boolean> {
  const binding = manifest.credentialBindings.find(
    (b) => b.vaultCredentialId === vaultCredentialId,
  );
  if (!binding) {
    throw new Error(`Credential "${vaultCredentialId}" is not declared by this manifest`);
  }
  if (!vault) return false;
  return vault.remove(vaultRowId(vaultCredentialId));
}
