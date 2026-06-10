# ProtocolFoundry — Agent Integration & MCP Builder Platform

> "Foundry for AI protocols, MCP servers, and agent tooling."

Managed SaaS that turns applications the customer owns (or is authorized to
integrate with) into eval-tested, hosted MCP servers. The original idea has been
refined and split into proper docs — **read the docs, don't rely on this file for
product detail.**

## Where things live

- Product idea & strategy: `docs/01-vision.md`, `docs/02-product-strategy.md`
- System design: `docs/03-architecture.md`
- Competitor map & differentiation moves: `docs/06-competitive-landscape.md`
- What to build next: `docs/04-roadmap.md` (currently **Phase 0 → Phase 1**)
- Security/trust rules: `docs/05-security-model.md`
- Decisions already made: `docs/decisions/ADR-*.md` — don't relitigate these
  without writing a superseding ADR
- Session log: `docs/WORKLOG.md`
- End-user walkthrough (URL → hosted MCP server): `docs/guides/local-quickstart.md`
  — keep it in sync when CLI commands or env vars change

## Working conventions (follow these every session)

1. **Update `docs/WORKLOG.md`** at the end of any session that changes code or
   docs: what was done, decisions, open questions, next steps. Newest entry first.
2. **Significant decisions get an ADR** in `docs/decisions/` (numbered, with
   Status/Context/Decision/Consequences). Update roadmap/architecture docs to
   match.
3. Keep docs and code in sync — if implementation diverges from
   `docs/03-architecture.md`, fix the doc in the same change.

## Codebase

- TypeScript npm-workspaces monorepo (ADR-0001), Node >= 22, strict TS.
- `packages/core` — domain types + zod schemas (WorkflowGraph, McpServerManifest,
  Release, EvalRun, AuditEvent). Everything depends on core; core depends on
  nothing internal.
- `packages/discovery` — ingestors producing WorkflowGraph (Phase 1: OpenAPI).
- `packages/generator` — graph + curation selection → manifest (naive 1:1).
- `packages/curation` — LLM curation pass → `CurationProposal` (human-reviewed),
  `applyCuration` → curated manifest with composed task-level tools (ADR-0004).
- `packages/evals` — agent-loop eval harness over MCP; `EvalRun` + reports.
  LLM boundaries (`Curator`, `AgentModel`) are interfaces — tests use scripted
  fakes, no API key; real impls use Anthropic SDK (`claude-sonnet-4-6`, adaptive
  thinking, structured outputs).
- `apps/` — `gateway` + `cli` (Phase 1–2), `web` dashboard (Phase 3).
- Commands: `npm run typecheck` / `npm run build` / `npm run test` (root, runs
  all workspaces).

## Hard constraints

- Generated servers are **manifest-interpreted** by a shared gateway — never
  per-customer codegen (ADR-0003).
- Only integrate with apps the customer owns/is authorized for; credentials are
  explicitly connected, never harvested; no anti-bot circumvention (ADR-0002,
  security model).
- Credentials must never enter LLM prompts, logs, or manifests — vault references
  only.
