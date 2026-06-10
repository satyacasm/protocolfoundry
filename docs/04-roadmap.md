# Roadmap

Sequencing principle: ship the narrowest thing that proves the riskiest assumption
(see [02-product-strategy.md](02-product-strategy.md) § Riskiest assumptions),
then widen. Phases are scope gates, not time estimates.

## Phase 0 — Foundation (current)

- [x] Refine the idea: buyer, wedge, differentiation, non-goals
- [x] Repo + monorepo skeleton + docs structure + ADRs
- [x] Core domain types (`packages/core`): WorkflowGraph, McpServerManifest,
      Release, EvalRun
- [x] Decide product name → **ProtocolFoundry** (domain registration still open)
- [ ] 10 design-partner conversations with SaaS vendors (validate assumption #1
      **before** building the dashboard)

## Phase 1 — Spec-to-server pipeline (CLI-first, no dashboard)

Goal: one real OpenAPI spec in → hosted, working MCP server out. Prove the engine
before building UI around it.

- [ ] `packages/discovery`: OpenAPI 3.x ingestor → WorkflowGraph
- [ ] `packages/generator`: graph → manifest with naive 1:1 tools (baseline)
- [ ] `apps/gateway`: manifest interpreter serving Streamable HTTP MCP
      (official SDK), API-key auth, env-var credentials
- [ ] Validate end-to-end with MCP Inspector + Claude against 2–3 public specs
      (e.g. a Stripe-like spec, an internal test app)
- [ ] Audit log of every tool call (even in MVP — it's a core differentiator)

**Exit criterion:** an agent completes a real multi-step task against a generated
server we host.

## Phase 2 — Curation + evals (the differentiating layer)

- [ ] LLM curation pass: compose TaskFlows into task-level tools, rewrite
      descriptions, trim schemas, absorb pagination/errors
- [ ] `packages/evals`: task-suite harness; score completion / tool-selection /
      cost across agent models; eval report artifact
- [ ] Release model: manifests are immutable, eval-gated, instantly roll-backable
- [ ] Human-in-the-loop review: curation proposals approved/edited before release
      (CLI or minimal web view)

**Exit criterion:** curated server measurably beats the naive baseline on the same
task suite — this number is the marketing.

## Phase 3 — Product (dashboard + hosting business)

- [ ] `apps/web` dashboard: projects, source upload, graph review/curation UI,
      eval reports, releases, audit viewer
- [ ] Credential vault (KMS-encrypted), per-tool scopes
- [ ] OAuth 2.1 authorization on the gateway (MCP auth spec)
- [ ] Multi-tenancy hardening, usage metering, billing (Stripe), white-label CNAME
- [ ] Drift detection: re-ingest spec on schedule, diff the graph, flag breaking
      changes, propose regeneration
- [ ] Onboard first 3–5 design partners as paying customers

## Phase 4 — Wider ingestion + analytics

- [ ] GraphQL, Postman, HAR-recording ingestors; docs crawler
- [ ] Guided walkthrough capture (user demonstrates a workflow; platform records
      authorized network traffic) — replaces the original idea's risky autonomous
      UI discovery with consented recording
- [ ] Agent analytics product: task funnels, failure clustering, capability-gap
      reports for the vendor
- [ ] Registry distribution partnerships (Smithery/Glama et al.)

## Deliberately out of scope

Autonomous crawling of third-party apps, connector marketplace, source-code
delivery. Rationale in [02-product-strategy.md](02-product-strategy.md) § Non-goals.
