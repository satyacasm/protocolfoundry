import type { McpServerManifest } from "@protocolfoundry/core";
import { FileReleaseStore } from "./store.js";

/**
 * What the gateway consumes: serverName -> manifest. Implemented both by a
 * static list (dev mode) and by the release store (production mode).
 */
export interface ManifestSource {
  get(serverName: string): Promise<McpServerManifest | undefined>;
  names(): Promise<string[]>;
}

export function staticManifestSource(manifests: McpServerManifest[]): ManifestSource {
  const byName = new Map(manifests.map((m) => [m.serverName, m]));
  return {
    async get(serverName) {
      return byName.get(serverName);
    },
    async names() {
      return [...byName.keys()];
    },
  };
}

interface CacheEntry {
  mtimeMs: number | undefined;
  manifest: McpServerManifest | undefined;
}

/**
 * Serves each project's LIVE release. Promote/rollback rewrite only the
 * project's index.json, so this source re-checks the index mtime (at most
 * once per cacheTtlMs) and reloads the manifest when it changed — releases
 * go live or roll back without a gateway restart.
 */
export function releaseManifestSource(
  store: FileReleaseStore,
  cacheTtlMs = 2000,
): ManifestSource {
  const byProject = new Map<string, CacheEntry>();
  let lastCheck = 0;
  let nameIndex = new Map<string, string>(); // serverName -> projectId

  async function refresh(): Promise<void> {
    const now = Date.now();
    if (now - lastCheck < cacheTtlMs && nameIndex.size > 0) return;
    lastCheck = now;
    const nextNames = new Map<string, string>();
    for (const projectId of await store.listProjects()) {
      const mtimeMs = await store.indexMtimeMs(projectId);
      const cached = byProject.get(projectId);
      if (!cached || cached.mtimeMs !== mtimeMs) {
        const live = await store.getLive(projectId);
        byProject.set(projectId, { mtimeMs, manifest: live?.manifest });
      }
      const manifest = byProject.get(projectId)?.manifest;
      if (manifest) nextNames.set(manifest.serverName, projectId);
    }
    nameIndex = nextNames;
  }

  return {
    async get(serverName) {
      await refresh();
      const projectId = nameIndex.get(serverName);
      if (!projectId) return undefined;
      return byProject.get(projectId)?.manifest;
    },
    async names() {
      await refresh();
      return [...nameIndex.keys()];
    },
  };
}
