# ProtocolFoundry

> Foundry for AI protocols, MCP servers, and agent tooling.

Managed platform that turns applications you own into **eval-tested, hosted MCP
servers** — so your customers' AI agents can actually use your product.

Not a spec transpiler: the platform builds a workflow graph of your application,
proposes task-level tools a human reviews and approves, verifies the result with
agent-usability evals, and then hosts and governs the server (OAuth 2.1,
credential vault, audit logs, drift detection, instant rollback).

## Documentation

| Doc | What's in it |
|---|---|
| [docs/guides/local-quickstart.md](docs/guides/local-quickstart.md) | **Start here:** URL → hosted MCP server, step by step on your machine |
| [docs/01-vision.md](docs/01-vision.md) | Problem, product, moat, long-term vision |
| [docs/02-product-strategy.md](docs/02-product-strategy.md) | Buyer, wedge, competition, pricing, risk register |
| [docs/03-architecture.md](docs/03-architecture.md) | Control plane / data plane design, core entities |
| [docs/04-roadmap.md](docs/04-roadmap.md) | Phases 0–4 with exit criteria |
| [docs/05-security-model.md](docs/05-security-model.md) | Trust principles and threat model |
| [docs/decisions/](docs/decisions/) | ADRs (tech stack, wedge, manifest runtime) |
| [docs/WORKLOG.md](docs/WORKLOG.md) | Session-by-session workflow log |

## Repository layout

```
apps/        deployables (Phase 1+: gateway; Phase 3: web dashboard)
packages/
  core/      shared domain types + zod schemas (WorkflowGraph, McpServerManifest, …)
  discovery/ ingestors → WorkflowGraph (Phase 1: OpenAPI)
  generator/ WorkflowGraph + curation → McpServerManifest
docs/        all project documentation
```

## Development

```bash
npm install        # install workspace dependencies
npm run build      # build all workspaces (dependency order)
npm test           # build + run all tests (unit + gateway e2e)
```

Requires Node >= 22.

## Try the Phase 1 pipeline

```bash
# 1. Spec -> workflow graph
npm run dev -w @protocolfoundry/cli -- ingest examples/taskboard/openapi.json --project taskboard -o graph.json

# 2. Graph -> MCP server manifest (select all, or --select op1,op2 for curation)
npm run dev -w @protocolfoundry/cli -- generate graph.json --name taskboard -o manifest.json

# 3. Host it (agents authenticate with PF_GATEWAY_API_KEY; upstream credential
#    comes from the env var named in the manifest's credentialBindings)
PF_MANIFEST_PATH=manifest.json PF_GATEWAY_API_KEY=secret PF_CRED_APIKEYAUTH=<upstream-key> \
  npm run dev -w @protocolfoundry/gateway
# -> Streamable HTTP MCP endpoint at http://localhost:3001/mcp/taskboard
```

## Status

**Phase 1 — spec-to-server pipeline shipped.** OpenAPI → workflow graph →
manifest → hosted MCP server, with inbound API-key auth, approval gates on
destructive tools, and a JSONL audit log; verified by an end-to-end test where
a real MCP client completes a multi-step task. See
[docs/04-roadmap.md](docs/04-roadmap.md) and the [worklog](docs/WORKLOG.md).
