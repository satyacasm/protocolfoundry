#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { CurationProposal, EvalRun, McpServerManifest, WorkflowGraph } from "@protocolfoundry/core";
import { createReleaseStoreFromEnv, ReleaseGateError } from "@protocolfoundry/releases";
import {
  applyCuration,
  createAnthropicCurator,
  proposeCuration,
} from "@protocolfoundry/curation";
import { ingestOpenApi } from "@protocolfoundry/discovery";
import {
  createAnthropicAgent,
  renderEvalReport,
  runEvalSuite,
  type EvalSuite,
} from "@protocolfoundry/evals";
import { generateManifest } from "@protocolfoundry/generator";

const USAGE = `ProtocolFoundry CLI — spec-to-server pipeline

Usage:
  pf ingest <openapi-file> --project <id> [-o <graph.json>]
      Ingest an OpenAPI 3.x spec (JSON or YAML) into a workflow graph.

  pf generate <graph.json> [--name <serverName>] [--select <op1,op2,...>]
              [--base-url <url>] [-o <manifest.json>]
      Generate a naive (1:1) MCP server manifest. Defaults to ALL operations;
      use --select for the human-in-the-loop subset.

  pf curate <graph.json> [--select <op1,op2,...>] [--model <id>] [-o <proposal.json>]
      LLM curation pass: propose agent-friendly tool names/descriptions and
      composed task-level tools. Requires ANTHROPIC_API_KEY. Review the
      proposal before applying it.

  pf apply <graph.json> <proposal.json> [--refinements <op1,...>|all]
           [--composed <name1,...>|all] [--name <serverName>] [--base-url <url>]
           [-o <manifest.json>]
      Apply the approved parts of a curation proposal -> curated manifest.
      Defaults to accepting everything (review the proposal first!).

  pf eval <suite.json> --endpoint <mcp-url> [--key <gateway-key>]
          [--model <id>] [--manifest-ref <ref>] [--project <id>]
          [-o <evalrun.json>] [--report <report.md>]
      Run an agent-usability eval suite against a hosted MCP endpoint.
      Requires ANTHROPIC_API_KEY.

  pf release create <manifest.json> [--eval <evalrun.json>]
             [--min-completion 0.8] [--min-selection 0.8]
             [--approved-by <name>] [--force] [--dir <releases-dir>]
      Create an immutable, eval-gated release (status: staged).
      --force (with --approved-by) overrides a failing or missing gate.

  pf release promote <projectId> <version> [--dir <releases-dir>]
      Make a staged release live (previous live is retired). The gateway
      in PF_RELEASES_DIR mode picks this up without a restart.

  pf release rollback <projectId> [--dir <releases-dir>]
      Instantly revert to the previous live release.

  pf release list <projectId> [--dir <releases-dir>]

Serve live releases with the gateway (hot promote/rollback):
  PF_RELEASES_DIR=releases npm run dev -w @protocolfoundry/gateway
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

  if (command === "curate") {
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
    const curator = createAnthropicCurator(flags.get("--model") ?? undefined);
    console.log(`Curating ${operationIds.length} operation(s) with ${curator.model}...`);
    const proposal = await proposeCuration(graph, operationIds, curator);
    const outPath = flags.get("-o") ?? "proposal.json";
    await writeFile(outPath, JSON.stringify(proposal, null, 2), "utf8");
    console.log(`Proposal -> ${outPath}`);
    console.log(`  ${proposal.refinements.length} refinement(s):`);
    for (const r of proposal.refinements) console.log(`    ${r.operationId} -> ${r.toolName}`);
    console.log(`  ${proposal.composedTools.length} composed task-level tool(s):`);
    for (const t of proposal.composedTools) {
      console.log(`    ${t.name} (${t.steps.map((s) => s.operationId).join(" -> ")})`);
    }
    for (const w of proposal.warnings) console.log(`  WARNING ${w.operationId}: ${w.reason}`);
    console.log("Review the proposal, then run: pf apply <graph> <proposal>");
    return;
  }

  if (command === "apply") {
    const [graphPath, proposalPath] = positional;
    if (!graphPath || !proposalPath) {
      console.error(USAGE);
      process.exit(1);
    }
    const graph = WorkflowGraph.parse(JSON.parse(await readFile(graphPath, "utf8")));
    const proposal = CurationProposal.parse(JSON.parse(await readFile(proposalPath, "utf8")));
    const refinementsFlag = flags.get("--refinements") ?? "all";
    const composedFlag = flags.get("--composed") ?? "all";
    const baseUrl = flags.get("--base-url");
    const name = flags.get("--name");
    const manifest = applyCuration(
      graph,
      proposal,
      {
        refinementOperationIds:
          refinementsFlag === "all" ? "all" : refinementsFlag.split(",").map((s) => s.trim()),
        composedToolNames:
          composedFlag === "all" ? "all" : composedFlag.split(",").map((s) => s.trim()),
      },
      {
        ...(name ? { serverName: name } : {}),
        ...(baseUrl ? { baseUrls: { default: baseUrl } } : {}),
      },
    );
    const outPath = flags.get("-o") ?? "manifest.curated.json";
    await writeFile(outPath, JSON.stringify(manifest, null, 2), "utf8");
    console.log(`Curated manifest "${manifest.serverName}" with ${manifest.tools.length} tool(s) -> ${outPath}`);
    for (const tool of manifest.tools) {
      const kind = tool.plan.length > 1 ? `composed[${tool.plan.length} steps]` : "1:1";
      const gate = tool.approval === "perCall" ? "  [requires approval]" : "";
      console.log(`  ${tool.name}  (${kind})${gate}`);
    }
    return;
  }

  if (command === "eval") {
    const suitePath = positional[0];
    const endpointUrl = flags.get("--endpoint");
    if (!suitePath || !endpointUrl) {
      console.error(USAGE);
      process.exit(1);
    }
    const suite = JSON.parse(await readFile(suitePath, "utf8")) as EvalSuite;
    const agent = createAnthropicAgent(flags.get("--model") ?? undefined);
    console.log(`Running ${suite.tasks.length} task(s) against ${endpointUrl} with ${agent.model}...`);
    const gatewayKey = flags.get("--key");
    const run = await runEvalSuite(
      suite,
      { url: endpointUrl, ...(gatewayKey ? { apiKey: gatewayKey } : {}) },
      agent,
      flags.get("--manifest-ref") ?? "unspecified",
      flags.get("--project") ?? "unspecified",
    );
    const outPath = flags.get("-o") ?? "evalrun.json";
    await writeFile(outPath, JSON.stringify(run, null, 2), "utf8");
    const report = renderEvalReport(run, suite.name);
    const reportPath = flags.get("--report") ?? "evalreport.md";
    await writeFile(reportPath, report, "utf8");
    console.log(`Task completion: ${Math.round(run.taskCompletionRate * 100)}%`);
    console.log(`Tool-selection accuracy: ${Math.round(run.toolSelectionAccuracy * 100)}%`);
    console.log(`Run -> ${outPath}; report -> ${reportPath}`);
    return;
  }

  if (command === "release") {
    const [action, ...args] = positional;
    // Backend: --db <postgres-url> > PF_DATABASE_URL > --dir / PF_RELEASES_DIR
    const dbUrl = flags.get("--db");
    const dir = flags.get("--dir");
    const store = createReleaseStoreFromEnv({
      ...process.env,
      ...(dbUrl ? { PF_DATABASE_URL: dbUrl } : {}),
      ...(dir ? { PF_DATABASE_URL: dbUrl, PF_RELEASES_DIR: dir } : {}),
    });

    if (action === "create") {
      const manifestPath = args[0];
      if (!manifestPath) {
        console.error(USAGE);
        process.exit(1);
      }
      const manifest = McpServerManifest.parse(
        JSON.parse(await readFile(manifestPath, "utf8")),
      );
      const evalPath = flags.get("--eval");
      const evalRun = evalPath
        ? EvalRun.parse(JSON.parse(await readFile(evalPath, "utf8")))
        : undefined;
      const approvedBy = flags.get("--approved-by");
      try {
        const release = await store.createRelease(manifest, {
          ...(evalRun ? { evalRun } : {}),
          gate: {
            minTaskCompletionRate: Number(flags.get("--min-completion") ?? 0.8),
            minToolSelectionAccuracy: Number(flags.get("--min-selection") ?? 0.8),
          },
          ...(approvedBy ? { approvedBy } : {}),
          force: flags.get("--force") === "true",
        });
        console.log(
          `Created release v${release.version} for "${release.projectId}" (status: ${release.status})`,
        );
        console.log(`Promote it with: pf release promote ${release.projectId} ${release.version}`);
      } catch (error) {
        if (error instanceof ReleaseGateError) {
          console.error(`BLOCKED: ${error.message}`);
          process.exit(2);
        }
        throw error;
      }
      return;
    }

    if (action === "promote") {
      const [projectId, versionRaw] = args;
      if (!projectId || !versionRaw) {
        console.error(USAGE);
        process.exit(1);
      }
      const release = await store.promote(projectId, Number(versionRaw));
      console.log(`v${release.version} is now LIVE for "${projectId}"`);
      return;
    }

    if (action === "rollback") {
      const projectId = args[0];
      if (!projectId) {
        console.error(USAGE);
        process.exit(1);
      }
      const release = await store.rollback(projectId);
      console.log(`Rolled back: v${release.version} is LIVE again for "${projectId}"`);
      return;
    }

    if (action === "list") {
      const projectId = args[0];
      if (!projectId) {
        console.error(USAGE);
        process.exit(1);
      }
      const releases = await store.list(projectId);
      if (releases.length === 0) {
        console.log(`No releases for "${projectId}"`);
        return;
      }
      for (const r of [...releases].sort((a, b) => b.version - a.version)) {
        const eval_ = r.evalRunId ? "  eval:yes" : "  eval:no";
        const by = r.approvedBy ? `  approvedBy:${r.approvedBy}` : "";
        console.log(`  v${r.version}  ${r.status.toUpperCase().padEnd(10)}${eval_}${by}  ${r.createdAt}`);
      }
      return;
    }

    console.error(USAGE);
    process.exit(1);
  }

  console.error(USAGE);
  process.exit(command ? 1 : 0);
}

await main();
