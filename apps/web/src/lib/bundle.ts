import JSZip from "jszip";
import type { EvalRun, McpServerManifest, Release } from "@protocolfoundry/core";

/**
 * Connection bundle: a downloadable .zip with everything a customer needs to
 * point an MCP client at their hosted server — manifest, client configs,
 * token instructions, eval report. Deliberately NOT generated source code
 * (ADR-0003: the managed endpoint is the product) and NEVER credentials
 * (vault references only).
 */

const gatewayUrl = (): string =>
  (process.env.PF_PUBLIC_GATEWAY_URL ?? "http://localhost:3001").replace(/\/+$/, "");

function readme(release: Release, manifest: McpServerManifest, evalRun: EvalRun | undefined): string {
  const endpoint = `${gatewayUrl()}/mcp/${manifest.serverName}`;
  const scopes = [...new Set(manifest.tools.flatMap((t) => t.requiredScopes))].sort();
  const toolRows = manifest.tools
    .map(
      (t) =>
        `| \`${t.name}\` | ${t.plan.length > 1 ? `composed (${t.plan.length} steps)` : "1:1"} | ${
          t.requiredScopes.join(", ") || "—"
        } | ${t.approval === "perCall" ? "per-call approval" : "—"} |`,
    )
    .join("\n");

  return `# ${manifest.serverName} — MCP connection bundle

Release **v${release.version}** (${release.status}) · ${manifest.projectId} · generated ${new Date().toISOString()}

${manifest.serverDescription}

## Endpoint

\`\`\`
${endpoint}
\`\`\`

Streamable HTTP MCP, served by the ProtocolFoundry gateway. If your gateway
runs elsewhere, substitute its origin — the path stays \`/mcp/${manifest.serverName}\`.

## Authenticate

Issue a scoped, expiring bearer token (run on the gateway host):

\`\`\`
pf token issue --server ${manifest.serverName} --scopes ${scopes.join(",") || "read"} --days 30
\`\`\`

Narrow the scopes to what the agent actually needs — the gateway enforces
them per tool call. Then send \`Authorization: Bearer <token>\` (the client
configs in \`clients/\` show where it goes).

## Tools (${manifest.tools.length})

| Tool | Kind | Required scopes | Gate |
|---|---|---|---|
${toolRows}

## Eval

${
  evalRun
    ? `Scored against agent model \`${evalRun.agentModel}\`: task completion ${Math.round(
        evalRun.taskCompletionRate * 100,
      )}%, tool-selection accuracy ${Math.round(
        evalRun.toolSelectionAccuracy * 100,
      )}%. Full results in \`eval-report.json\`.`
    : "This release shipped **without** an eval run — score it with `pf eval` before relying on it."
}

## Contents

- \`README.md\` — this file
- \`manifest.json\` — the exact manifest this release serves (vault/env credential references only — no secrets)
- \`release.json\` — release metadata (version, status, timestamps)
- \`clients/claude-code.mcp.json\` — drop into your repo as \`.mcp.json\`
- \`clients/claude-desktop.json\` — merge into \`claude_desktop_config.json\`
- \`clients/cursor.mcp.json\` — drop into \`.cursor/mcp.json\`
${evalRun ? "- `eval-report.json` — full eval run\n" : ""}
This bundle contains **no credentials**. Upstream secrets stay in the
ProtocolFoundry vault; tokens are issued and revoked independently.
`;
}

function clientConfigs(manifest: McpServerManifest): Record<string, string> {
  const url = `${gatewayUrl()}/mcp/${manifest.serverName}`;
  const name = manifest.serverName;
  const httpEntry = {
    type: "http",
    url,
    headers: { Authorization: "Bearer <paste your pf token here>" },
  };
  return {
    "clients/claude-code.mcp.json": JSON.stringify({ mcpServers: { [name]: httpEntry } }, null, 2),
    "clients/cursor.mcp.json": JSON.stringify({ mcpServers: { [name]: httpEntry } }, null, 2),
    "clients/claude-desktop.json": JSON.stringify(
      {
        mcpServers: {
          [name]: {
            command: "npx",
            args: ["-y", "mcp-remote", url, "--header", "Authorization: Bearer <paste your pf token here>"],
          },
        },
      },
      null,
      2,
    ),
  };
}

export async function buildConnectionBundle(
  release: Release,
  manifest: McpServerManifest,
  evalRun: EvalRun | undefined,
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file("README.md", readme(release, manifest, evalRun));
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("release.json", JSON.stringify(release, null, 2));
  for (const [path, content] of Object.entries(clientConfigs(manifest))) {
    zip.file(path, content);
  }
  if (evalRun) zip.file("eval-report.json", JSON.stringify(evalRun, null, 2));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Pull spec candidates (OpenAPI/Postman, json/yaml) out of an uploaded zip. */
export async function extractSpecCandidates(
  data: ArrayBuffer,
): Promise<Array<{ name: string; text: string }>> {
  const zip = await JSZip.loadAsync(data);
  const candidates: Array<{ name: string; text: string }> = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const name = entry.name;
    if (name.startsWith("__MACOSX/") || name.split("/").pop()?.startsWith(".")) continue;
    if (!/\.(json|ya?ml)$/i.test(name)) continue;
    candidates.push({ name, text: await entry.async("text") });
  }
  // shallower entries first — the spec usually sits at the zip root
  return candidates.sort(
    (a, b) => a.name.split("/").length - b.name.split("/").length || a.name.localeCompare(b.name),
  );
}

export function looksLikeZip(fileName: string, bytes: Uint8Array): boolean {
  if (/\.zip$/i.test(fileName)) return true;
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}
