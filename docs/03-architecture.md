# Architecture

High-level system design. This describes the target shape; the roadmap
([04-roadmap.md](04-roadmap.md)) defines how much of it exists per phase.

## Two-plane design

```
┌────────────────────────── CONTROL PLANE ──────────────────────────┐
│                                                                   │
│  Dashboard (Next.js)                                              │
│   └─ projects, source ingestion, graph review/curation UI,        │
│      eval reports, releases, analytics, audit log viewer          │
│                                                                   │
│  Discovery Engine                                                 │
│   └─ ingestors: OpenAPI · GraphQL · Postman · HAR · docs crawler  │
│   └─ LLM analysis → Workflow Graph (operations, schemas,          │
│      dependencies, auth requirements, candidate task flows)       │
│                                                                   │
│  Generator                                                        │
│   └─ Workflow Graph + user selections → MCP Server Manifest       │
│      (tools, resources, prompts, auth bindings, scopes)           │
│                                                                   │
│  Eval Harness                                                     │
│   └─ agent loops run task suites against a staged server;         │
│      scores gate promotion to a release                           │
│                                                                   │
│  Postgres (projects, graphs, manifests, releases, eval runs,      │
│  audit events) · Credential Vault (KMS-encrypted)                 │
└───────────────────────────────┬───────────────────────────────────┘
                                │ signed release artifacts
┌───────────────────────────────▼───────────────────────────────────┐
│                           DATA PLANE                               │
│                                                                   │
│  MCP Gateway (multi-tenant runtime)                               │
│   └─ Streamable HTTP MCP endpoint per release                     │
│   └─ OAuth 2.1 resource server (MCP authorization spec)           │
│   └─ manifest interpreter: tool call → upstream API call(s)       │
│   └─ per-tool scopes · rate limits · approval gates               │
│   └─ audit log + usage telemetry → control plane                  │
└───────────────────────────────────────────────────────────────────┘
```

## Core design decision: manifest-interpreted servers, not codegen

The Generator does **not** emit per-customer source code to compile and deploy.
It emits a declarative **MCP Server Manifest** (versioned JSON) that the shared
multi-tenant Gateway interprets at runtime:

- one runtime to operate, patch, and secure — not thousands of deployed codebases
- instant releases and rollbacks (a release = a manifest version pointer)
- the manifest is auditable: reviewers see exactly what each tool can do
- escape hatch: a `custom` tool kind can reference sandboxed code modules later

This is the single most important early architecture choice — it is what makes
"managed hosting" operationally survivable. See ADR-0003.

## Key entities (shared types in `packages/core`)

- **Project** — one target application owned by a customer.
- **Source** — an ingested artifact (OpenAPI spec, HAR, docs URL…).
- **WorkflowGraph** — nodes (operations, schemas, auth contexts) + edges
  (data deps, sequence deps); candidate **TaskFlows** spanning multiple operations.
- **McpServerManifest** — the curated, generated server definition: tools
  (each mapping to one operation or a composed task flow), resources, prompts,
  auth bindings, scopes, approval requirements.
- **Release** — an immutable, eval-gated manifest version served by the gateway.
- **EvalRun** — task suite results (completion, tool-selection accuracy, cost)
  for a manifest version × agent model.
- **AuditEvent** — every tool invocation and every control-plane mutation.

## Auth model

- **Customer → platform:** standard SaaS auth on the dashboard.
- **Agent → MCP server:** OAuth 2.1 per the MCP authorization spec (the gateway is
  a resource server); API-key fallback for internal deployments.
- **MCP server → upstream app:** credentials the customer explicitly connected,
  stored in the vault, scoped per tool, never exposed to the agent or the LLM
  pipeline.

## Tech stack (ADR-0001)

- TypeScript end-to-end; npm-workspaces monorepo.
- `apps/web` — Next.js dashboard (also hosts control-plane API routes initially).
- `apps/gateway` — Node service (Fastify) speaking Streamable HTTP MCP via the
  official `@modelcontextprotocol/sdk`.
- `packages/core` — shared domain types + validation (zod).
- `packages/discovery` — ingestors + LLM graph analysis (Claude via Anthropic SDK).
- `packages/generator` — graph → manifest.
- `packages/evals` — agent-loop harness.
- Postgres (likely Neon/Supabase) + a job queue for discovery/eval runs.
- Deploy: Vercel for `apps/web`; long-lived Node host (Fly/Railway/containers) for
  the gateway — MCP sessions and SSE streams want a persistent runtime.
