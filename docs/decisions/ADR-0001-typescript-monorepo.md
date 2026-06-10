# ADR-0001: TypeScript monorepo with npm workspaces

- **Status:** accepted
- **Date:** 2026-06-10

## Context

The system spans a web dashboard, an MCP gateway runtime, and several engine
packages (discovery, generator, evals) that share domain types (WorkflowGraph,
McpServerManifest). The MCP ecosystem's reference implementation
(`@modelcontextprotocol/sdk`) and the dashboard stack are TypeScript-native.

## Decision

- TypeScript end-to-end, strict mode.
- Single repo, **npm workspaces** (no pnpm/turbo yet — Node 24 + npm 11 are already
  installed; add Turborepo only when build times demand it).
- Layout: `apps/*` for deployables (`web`, `gateway`), `packages/*` for libraries
  (`core`, `discovery`, `generator`, `evals`).
- Shared domain types + zod schemas live in `packages/core`; everything else
  depends on it and nothing in `core` depends outward.

## Consequences

- One language across control plane, data plane, and engines; types flow from
  `core` into every component and into API payloads.
- npm workspaces is the least-tooling option; if cross-package build orchestration
  becomes painful, adopting Turborepo later is non-breaking.
- Python is deliberately excluded for now (no ML training workloads; LLM calls go
  through the Anthropic SDK, which is fine in TS).
