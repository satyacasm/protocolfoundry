import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { McpServerManifest } from "@protocolfoundry/core";
import { createAuditStoreFromEnv } from "@protocolfoundry/audit";
import { createVaultFromEnv } from "@protocolfoundry/vault";
import { createCredentialResolver } from "./credentials.js";
import {
  createReleaseStoreFromEnv,
  describeReleaseBackend,
  releaseManifestSource,
  staticManifestSource,
} from "@protocolfoundry/releases";
import { createGatewayApp } from "./app.js";
import { AuditLog } from "./audit.js";

export { createGatewayApp, type GatewayOptions } from "./app.js";
export { AuditLog } from "./audit.js";
export { createCredentialResolver } from "./credentials.js";
export { executePlan, resolveBinding, envCredentialResolver } from "./executor.js";
export { createMcpServerForManifest, type AuthContext } from "./mcp.js";
export { issueToken, verifyToken, type TokenClaims } from "./tokens.js";

/**
 * Load and validate one manifest file or every *.json in a directory.
 * Non-manifest JSON files in a directory (specs, graphs) are skipped with a
 * warning; actual manifest validation failures name the offending file.
 */
export async function loadManifests(path: string): Promise<McpServerManifest[]> {
  const stats = await stat(path);
  const isDirectory = stats.isDirectory();
  const files = isDirectory
    ? (await readdir(path)).filter((f) => f.endsWith(".json")).map((f) => join(path, f))
    : [path];

  const manifests: McpServerManifest[] = [];
  for (const file of files) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(file, "utf8"));
    } catch (error) {
      throw new Error(`${file} is not valid JSON: ${error instanceof Error ? error.message : error}`);
    }
    const looksLikeManifest =
      typeof parsed === "object" && parsed !== null && "manifestVersion" in parsed;
    if (!looksLikeManifest) {
      if (isDirectory) {
        console.warn(`[gateway] skipping ${file} — no manifestVersion field (not a manifest)`);
        continue;
      }
      throw new Error(`${file} is not an MCP server manifest (missing manifestVersion)`);
    }
    try {
      manifests.push(McpServerManifest.parse(parsed));
    } catch (error) {
      throw new Error(`${file} failed manifest validation: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (manifests.length === 0) {
    throw new Error(`No valid manifests found at ${path}`);
  }
  return manifests;
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("gateway/src/index.ts")
  || process.argv[1]?.replace(/\\/g, "/").endsWith("gateway/dist/index.js");

if (isMain) {
  const manifestPath = process.env.PF_MANIFEST_PATH;
  const releaseMode = Boolean(process.env.PF_RELEASES_DIR || process.env.PF_DATABASE_URL);
  if (!manifestPath && !releaseMode) {
    console.error(
      "Set PF_DATABASE_URL or PF_RELEASES_DIR (serve live releases, hot promote/rollback) or PF_MANIFEST_PATH (dev: static manifest file/dir)",
    );
    process.exit(1);
  }
  const port = Number(process.env.PF_PORT ?? 3001);
  const audit = createAuditStoreFromEnv();
  const vault = createVaultFromEnv();
  if (vault) console.log("[gateway] credential vault enabled (PF_VAULT_KEY)");
  const options = {
    audit,
    resolveCredential: createCredentialResolver(vault),
    ...(process.env.PF_GATEWAY_API_KEY ? { apiKey: process.env.PF_GATEWAY_API_KEY } : {}),
    ...(process.env.PF_GATEWAY_TOKEN_SECRET
      ? { tokenSecret: process.env.PF_GATEWAY_TOKEN_SECRET }
      : {}),
    ...(process.env.PF_AUTH_SERVER_URL
      ? { authorizationServers: [process.env.PF_AUTH_SERVER_URL] }
      : {}),
    approveAll: process.env.PF_APPROVE_ALL === "true",
  };

  const source = releaseMode
    ? releaseManifestSource(createReleaseStoreFromEnv())
    : staticManifestSource(await loadManifests(manifestPath!));
  const app = createGatewayApp(source, options);
  app.listen(port, async () => {
    const names = await source.names();
    const mode = releaseMode
      ? `live releases, ${describeReleaseBackend()}`
      : `static manifests from ${manifestPath}`;
    console.log(`[gateway] mode: ${mode}`);
    for (const name of names) {
      console.log(`[gateway] serving "${name}" at http://localhost:${port}/mcp/${name}`);
    }
    if (names.length === 0) {
      console.warn("[gateway] no live releases yet — promote one with: pf release promote <project> <version>");
    }
  });
}
