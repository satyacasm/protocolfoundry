# Worklog

Running log of project workflow — one entry per working session, newest first.
Each entry: what was done, decisions made, open questions, next steps.
This file is the "documenting the workflow as we move forward" artifact; keep it
honest and terse.

---

## 2026-06-10 — Session 2: ProtocolFoundry naming + Phase 1 pipeline

### Done

- Named the product: **ProtocolFoundry** — "Foundry for AI protocols, MCP
  servers, and agent tooling." Renamed packages to `@protocolfoundry/*`.
- Fixed a broken git situation: a stray `.git` existed at `C:\` (drive root),
  which made `git add` scan the whole disk. Initialized a proper repo in the
  project directory instead. Foundation committed as the root commit.
- Extended core schemas so manifests are fully self-contained for the gateway
  (ADR-0003): `UpstreamOperation`/`upstreamOperations`, `authSchemes`,
  `parameterLocations`; `WorkflowGraph.baseUrls`.
- **Phase 1 pipeline shipped end-to-end:**
  - `packages/discovery` — OpenAPI 3.x ingestor (JSON + YAML, local $ref
    resolution with cycle guard, security schemes → auth requirements,
    param locations, effect classification from HTTP method).
  - `packages/generator` — naive 1:1 manifest generation with snake_case tool
    names, identity arg bindings, per-call approval gates on delete operations,
    env-vault credential bindings.
  - `apps/gateway` — Express + official MCP SDK, stateless Streamable HTTP,
    one endpoint per manifest at `/mcp/<serverName>`, inbound API-key auth,
    upstream credential injection (apiKey/bearer/basic), JSONL audit log with
    hashed args, approval-gate enforcement.
  - `apps/cli` — `pf ingest`, `pf generate`.
  - `examples/taskboard` — demo spec + API-key-protected mock upstream.
- Tests: 8 passing (discovery + generator unit, gateway e2e with a real MCP
  client: authorized multi-step task, 401 for missing/wrong key, approval gate
  blocks delete, audit log integrity). **Phase 1 exit criterion met** in the
  automated harness.

### Decisions

- Gateway uses Express (the MCP SDK's documented integration) instead of the
  originally-noted Fastify — architecture doc updated.
- Gateway tsconfig disables `exactOptionalPropertyTypes` only — the SDK's types
  aren't written for it.

### Open questions

- Domain registration for ProtocolFoundry.
- Stray `C:\.git` still exists on the machine (outside this project) — owner
  should remove it manually to avoid future tooling confusion.

### Next steps

1. Validate against 2–3 real public OpenAPI specs with MCP Inspector / Claude.
2. Start Phase 2: LLM curation pass (task-level tools) + eval harness skeleton.
3. Design-partner conversations (Phase 0 item, still open).

---

## 2026-06-10 — Session 1: idea refinement + project setup

### Done

- Critiqued and refined the original idea from `CLAUDE.md`:
  - Identified that it conflated two customer segments; chose **SaaS vendors
    exposing their own product** as the wedge (ADR-0002).
  - Named the real moat: **curation + agent-usability evals + governance**, not
    spec→MCP translation (which is commoditizing).
  - Replaced risky autonomous UI discovery with a phased ingestion plan ending in
    consented walkthrough recording.
- Wrote the docs set: vision (01), product strategy (02), architecture (03),
  roadmap (04), security model (05), ADRs 0001–0003.
- Set up TypeScript npm-workspaces monorepo: `packages/core` (domain types:
  WorkflowGraph, McpServerManifest, Release, EvalRun, AuditEvent),
  `packages/discovery`, `packages/generator` as stubs; `apps/` reserved.
- Rewrote `CLAUDE.md` as working project instructions pointing into `docs/`
  (original idea text preserved/refined in `docs/01-vision.md`).
- Verified the workspace typechecks (`npm run typecheck`).

### Decisions

- ADR-0001: TypeScript + npm workspaces (no Turborepo yet).
- ADR-0002: spec-first discovery, vendor-first GTM, no autonomous UI scraping.
- ADR-0003: manifest-interpreted multi-tenant gateway, not per-customer codegen.

### Open questions

- ~~Product name~~ → resolved 2026-06-10: **ProtocolFoundry**. Domain registration still open.
- DB choice for Phase 1+ (Neon vs Supabase) — defer until the CLI pipeline needs
  persistence.
- Eval task-suite design: hand-authored per project vs LLM-proposed + human-edited.

### Next steps (Phase 1 start)

1. OpenAPI 3.x ingestor in `packages/discovery` → WorkflowGraph.
2. Naive generator pass (1:1 tools) in `packages/generator` → manifest.
3. `apps/gateway` skeleton with `@modelcontextprotocol/sdk` interpreting a
   hand-written manifest, validated with MCP Inspector.
