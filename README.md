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
npm run typecheck  # typecheck all workspaces
npm run build      # build all workspaces
```

Requires Node >= 22.

## Status

**Phase 0 — Foundation.** Docs, decisions, and domain types are in place; the
Phase 1 spec-to-server pipeline is next. See [docs/04-roadmap.md](docs/04-roadmap.md)
and the [worklog](docs/WORKLOG.md).
