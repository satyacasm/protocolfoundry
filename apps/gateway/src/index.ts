import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { McpServerManifest } from "@protocolfoundry/core";
import { createGatewayApp } from "./app.js";
import { AuditLog } from "./audit.js";

export { createGatewayApp, type GatewayOptions } from "./app.js";
export { AuditLog } from "./audit.js";
export { executePlan, resolveBinding, envCredentialResolver } from "./executor.js";
export { createMcpServerForManifest } from "./mcp.js";

/** Load and validate one manifest file or every *.json in a directory. */
export async function loadManifests(path: string): Promise<McpServerManifest[]> {
  const stats = await stat(path);
  const files = stats.isDirectory()
    ? (await readdir(path)).filter((f) => f.endsWith(".json")).map((f) => join(path, f))
    : [path];
  return Promise.all(
    files.map(async (file) =>
      McpServerManifest.parse(JSON.parse(await readFile(file, "utf8"))),
    ),
  );
}

const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("gateway/src/index.ts")
  || process.argv[1]?.replace(/\\/g, "/").endsWith("gateway/dist/index.js");

if (isMain) {
  const manifestPath = process.env.PF_MANIFEST_PATH;
  if (!manifestPath) {
    console.error("PF_MANIFEST_PATH must point to a manifest file or directory");
    process.exit(1);
  }
  const port = Number(process.env.PF_PORT ?? 3001);
  const manifests = await loadManifests(manifestPath);
  const audit = new AuditLog(process.env.PF_AUDIT_LOG ?? "audit.log.jsonl");
  const app = createGatewayApp(manifests, {
    audit,
    ...(process.env.PF_GATEWAY_API_KEY ? { apiKey: process.env.PF_GATEWAY_API_KEY } : {}),
    approveAll: process.env.PF_APPROVE_ALL === "true",
  });
  app.listen(port, () => {
    for (const m of manifests) {
      console.log(`[gateway] serving "${m.serverName}" at http://localhost:${port}/mcp/${m.serverName}`);
    }
  });
}
