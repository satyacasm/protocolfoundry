# Worklog

Running log of project workflow — one entry per working session, newest first.
Each entry: what was done, decisions made, open questions, next steps.
This file is the "documenting the workflow as we move forward" artifact; keep it
honest and terse.

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
