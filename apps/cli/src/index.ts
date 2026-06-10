#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { WorkflowGraph } from "@protocolfoundry/core";
import { ingestOpenApi } from "@protocolfoundry/discovery";
import { generateManifest } from "@protocolfoundry/generator";

const USAGE = `ProtocolFoundry CLI — spec-to-server pipeline (Phase 1)

Usage:
  pf ingest <openapi-file> --project <id> [-o <graph.json>]
      Ingest an OpenAPI 3.x spec (JSON or YAML) into a workflow graph.

  pf generate <graph.json> [--name <serverName>] [--select <op1,op2,...>]
              [--base-url <url>] [-o <manifest.json>]
      Generate an MCP server manifest. Defaults to selecting ALL operations;
      use --select for the human-in-the-loop subset.

Serve the manifest with the gateway:
  PF_MANIFEST_PATH=manifest.json npm run dev -w @protocolfoundry/gateway
`;

function parseFlags(argv: string[]): { positional: string[]; flags: Map<string, string> } {
  const positional: string[] = [];
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith("-")) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) {
        flags.set(arg, "true");
      } else {
        flags.set(arg, value);
        i++;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, flags };
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseFlags(rest);

  if (command === "ingest") {
    const specPath = positional[0];
    const projectId = flags.get("--project");
    if (!specPath || !projectId) {
      console.error(USAGE);
      process.exit(1);
    }
    const raw = await readFile(specPath, "utf8");
    const graph = ingestOpenApi(raw, projectId, `openapi:${specPath}`);
    const outPath = flags.get("-o") ?? "graph.json";
    await writeFile(outPath, JSON.stringify(graph, null, 2), "utf8");
    console.log(`Ingested ${graph.operations.length} operation(s) -> ${outPath}`);
    for (const op of graph.operations) {
      console.log(`  ${op.id}  [${op.effect}]  ${op.http.method} ${op.http.path}`);
    }
    return;
  }

  if (command === "generate") {
    const graphPath = positional[0];
    if (!graphPath) {
      console.error(USAGE);
      process.exit(1);
    }
    const graph = WorkflowGraph.parse(JSON.parse(await readFile(graphPath, "utf8")));
    const select = flags.get("--select");
    const operationIds = select
      ? select.split(",").map((s) => s.trim())
      : graph.operations.map((op) => op.id);
    const baseUrl = flags.get("--base-url");
    const name = flags.get("--name");
    const manifest = generateManifest(
      graph,
      { operationIds, taskFlowIds: [] },
      {
        ...(name ? { serverName: name } : {}),
        ...(baseUrl ? { baseUrls: { default: baseUrl } } : {}),
      },
    );
    const outPath = flags.get("-o") ?? "manifest.json";
    await writeFile(outPath, JSON.stringify(manifest, null, 2), "utf8");
    console.log(`Generated manifest "${manifest.serverName}" with ${manifest.tools.length} tool(s) -> ${outPath}`);
    for (const tool of manifest.tools) {
      const gate = tool.approval === "perCall" ? "  [requires approval]" : "";
      console.log(`  ${tool.name}${gate}`);
    }
    if (manifest.credentialBindings.length > 0) {
      console.log("Credentials the gateway needs (env vars):");
      for (const binding of manifest.credentialBindings) {
        console.log(`  ${binding.vaultCredentialId.replace(/^env:/, "")}`);
      }
    }
    return;
  }

  console.error(USAGE);
  process.exit(command ? 1 : 0);
}

await main();
