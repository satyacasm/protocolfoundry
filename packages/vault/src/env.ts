import pg from "pg";
import { FileVaultStore, PgVaultStore, type VaultPgPoolLike, type VaultStore } from "./stores.js";

/**
 * Backend convention matches releases/audit (ADR-0006):
 *   PF_VAULT_KEY unset  -> no vault (returns undefined; env-var credentials only)
 *   PF_DATABASE_URL set -> Postgres vault_credentials table
 *   else                -> encrypted file at PF_VAULT_PATH (default vault.json)
 */
export function createVaultFromEnv(
  env: Record<string, string | undefined> = process.env,
): VaultStore | undefined {
  const key = env["PF_VAULT_KEY"];
  if (!key) return undefined;
  const databaseUrl = env["PF_DATABASE_URL"];
  if (databaseUrl) {
    return new PgVaultStore(
      new pg.Pool({ connectionString: databaseUrl }) as unknown as VaultPgPoolLike,
      key,
    );
  }
  return new FileVaultStore(env["PF_VAULT_PATH"] ?? "vault.json", key);
}
