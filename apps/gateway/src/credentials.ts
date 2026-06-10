import type { VaultStore } from "@protocolfoundry/vault";
import type { CredentialResolver } from "./executor.js";

/**
 * Upstream credential resolution (manifest credentialBindings):
 *   vault:<id>  -> encrypted vault only
 *   env:<NAME>  -> process.env first, then vault under the same name —
 *                  so moving a credential from env into the vault needs no
 *                  manifest change.
 */
export function createCredentialResolver(vault?: VaultStore): CredentialResolver {
  return async (ref: string) => {
    if (ref.startsWith("vault:")) {
      return vault?.getSecret(ref.slice(6));
    }
    if (ref.startsWith("env:")) {
      const name = ref.slice(4);
      return process.env[name] ?? (vault ? await vault.getSecret(name) : undefined);
    }
    return undefined;
  };
}
