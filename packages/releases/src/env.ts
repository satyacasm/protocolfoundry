import pg from "pg";
import { FileReleaseStore } from "./store.js";
import { PgReleaseStore, type PgPoolLike } from "./pg-store.js";
import type { ReleaseStore } from "./types.js";

/**
 * Standard backend selection across gateway, CLI, and dashboard:
 *   PF_DATABASE_URL  -> Postgres store (ADR-0006)
 *   PF_RELEASES_DIR  -> file store at that path
 *   neither          -> file store at ./releases
 */
export function createReleaseStoreFromEnv(
  env: Record<string, string | undefined> = process.env,
): ReleaseStore {
  const databaseUrl = env["PF_DATABASE_URL"];
  if (databaseUrl) {
    return new PgReleaseStore(
      new pg.Pool({ connectionString: databaseUrl }) as unknown as PgPoolLike,
    );
  }
  return new FileReleaseStore(env["PF_RELEASES_DIR"] ?? "releases");
}

export function describeReleaseBackend(
  env: Record<string, string | undefined> = process.env,
): string {
  if (env["PF_DATABASE_URL"]) return "postgres (PF_DATABASE_URL)";
  return `file store at ${env["PF_RELEASES_DIR"] ?? "releases"}`;
}
