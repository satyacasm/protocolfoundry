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

- [x] `packages/discovery`: OpenAPI 3.x ingestor → WorkflowGraph
- [x] `packages/generator`: graph → manifest with naive 1:1 tools (baseline);
      destructive operations default to per-call approval gates
- [x] `apps/gateway`: manifest interpreter serving Streamable HTTP MCP
      (official SDK), API-key auth, env-var credentials
- [x] `apps/cli`: `pf ingest` / `pf generate` (CLI-first, per plan)
- [x] Audit log of every tool call (JSONL, hashed args, approval denials included)
- [x] Automated end-to-end validation: examples/taskboard spec + mock upstream,
      real MCP client completes create→list→complete (apps/gateway/test/e2e.test.ts)
- [x] Validate against real public specs programmatically — Petstore (JSON,
      19 ops; their demo server was down upstream) + Open-Meteo (YAML, live
      data end-to-end). Findings: docs/validation/2026-06-10-public-specs.md
- [ ] Interactive pass with MCP Inspector + Claude (needs a human at the browser)

**Exit criterion:** an agent completes a real multi-step task against a generated
server we host. → **Met in the automated harness** (e2e test); remaining: repeat
with Claude against a real public spec.

## Phase 2 — Curation + evals (the differentiating layer)

- [x] LLM curation pass (`packages/curation`): `pf curate` proposes refined
      names/descriptions, composed task-level tools, and exposure warnings as a
      reviewed `CurationProposal` artifact (ADR-0004). Claude `claude-opus-4-8`
      with structured outputs; hallucinated operations dropped defensively.
      Still open: schema trimming, pagination/error absorption.
- [x] `packages/evals`: agent-loop harness over real MCP (completion,
      tool-selection accuracy, steps, token cost) → `EvalRun` + markdown
      report and naive-vs-curated comparison artifacts; `pf eval`.
- [x] Human-in-the-loop review: `pf curate` → human reviews proposal →
      `pf apply --refinements ... --composed ...` (partial approval supported);
      compositions with destructive steps inherit the approval gate.
- [x] Release model (immutable, eval-gated, roll-backable) — delivered at the
      start of Phase 3 (`packages/releases`, ADR-0005).
- [x] **Live exit-criterion run** with `claude-opus-4-8`
      (docs/validation/2026-06-10-phase2-live-evals.md): composed tool = 2
      steps vs 3 and ~18% fewer input tokens when adopted; curated
      descriptions added description-level safety. Completion tied at 100% —
      a 5-op API can't differentiate completion; the headline gap needs a
      large/messy spec.
- [ ] Large-spec eval campaign (Petstore 19 ops when their demo recovers,
      then GitHub-scale) — the completion-rate marketing number.

**Exit criterion:** curated server measurably beats the naive baseline on the same
task suite. Measured live on steps/tokens/safety; completion-rate gap pending
the large-spec campaign.

## Phase 3 — Product (dashboard + hosting business)

- [x] Release store (`packages/releases`, ADR-0005): immutable versioned
      manifests, eval-gated creation (force requires attribution),
      promote/rollback as pointer swaps; gateway serves live releases via
      `ManifestSource` with hot promote/rollback (no restart);
      `pf release create/promote/rollback/list`.
- [x] `apps/web` dashboard v1 (read-only, Next.js 15): overview with live
      servers + eval gauges, per-project release timeline, release detail
      (tool surface, gates, eval report, forced-override attribution), and
      audit viewer with kind filters. Reads the file release store + audit
      log directly — no DB yet.
- [x] Postgres control-plane store (`PgReleaseStore`, ADR-0006): same
      `ReleaseStore` interface and gate semantics, selected via
      `PF_DATABASE_URL` across gateway/CLI/dashboard; pg-mem tests, no infra.
- [x] Dashboard auth (ADR-0006): `PF_DASHBOARD_PASSWORD` → HMAC-signed 12h
      session cookie via middleware; open-mode banner when unset;
      single-operator placeholder until SSO at design-partner onboarding.
- [x] Dashboard v2a — promote/rollback from the UI: server actions gated by
      operator session (refused in open mode), success/error flashes,
      `releasePromoted`/`releaseRolledBack` audit events with user actor.
- [x] Audit events into Postgres (`@protocolfoundry/audit`): JSONL + Postgres
      backends behind one `AuditStore` interface, selected by `PF_DATABASE_URL`;
      gateway and dashboard write through it; audit viewer paginates with
      kind/project filters.
- [x] Dashboard v2b — the Forge: spec upload (file or URL) → ingest →
      operation review with checkboxes → stage naive release, or run LLM
      curation and approve refinements/composed tools per item → stage
      curated release. Operator-gated; artifacts in a file workspace
      (`PF_WORKSPACE_DIR`, Postgres with multi-tenant); audit
      `manifestChange` events for every forge mutation.
- [x] Credential vault (`@protocolfoundry/vault`, ADR-0007): AES-256-GCM at
      rest, file/Postgres backends, `pf vault` CLI, env→vault fallback so no
      manifest changes are needed. KMS key-wrapping at managed hosting.
- [x] Per-tool scopes + scoped bearer tokens (ADR-0007): generator assigns
      read/write/destructive by effect; `pf token issue` mints expiring,
      server-bound, scope-carrying tokens; gateway enforces per tool call;
      RFC 9728 metadata + WWW-Authenticate on 401.
- [x] Eval runs from the dashboard (ADR-0008): per-project eval suites
      uploaded/pasted in the UI (zod-validated); "Run eval" on a staged
      release hosts its manifest on an ephemeral loopback gateway and runs
      the agent suite as an in-process job with live per-task progress; the
      EvalRun attaches to the staged release (`attachEvalRun`, both store
      backends) and completion is audited (`evalCompleted`).
- [ ] Full OAuth 2.1 authorization-code flow via external AS (deferred —
      ADR-0007; metadata endpoint already advertises authorization servers)
- [ ] Multi-tenancy hardening, usage metering, billing (Stripe), white-label CNAME
- [ ] Drift detection: re-ingest spec on schedule, diff the graph, flag breaking
      changes, propose regeneration
- [ ] Onboard first 3–5 design partners as paying customers

## Phase 4 — Wider ingestion + analytics

- [x] Postman Collection v2.1 ingestor (auto-detected by `pf ingest` and the
      Forge): example-body schema inference, dominant-auth heuristic for
      "inherit", multi-host baseUrls, folder tags, `{{var}}`/`:param`
      handling. Validated on Shiprocket's official 92-request collection
      (examples/shiprocket/README.md) — hosted server verified with scoped
      tokens against the real upstream.
- [ ] GraphQL, HAR-recording ingestors; docs crawler
- [ ] Guided walkthrough capture (user demonstrates a workflow; platform records
      authorized network traffic) — replaces the original idea's risky autonomous
      UI discovery with consented recording
- [ ] Agent analytics product: task funnels, failure clustering, capability-gap
      reports for the vendor
- [ ] Registry distribution partnerships (Smithery/Glama et al.)

## Deliberately out of scope

Autonomous crawling of third-party apps, connector marketplace, source-code
delivery. Rationale in [02-product-strategy.md](02-product-strategy.md) § Non-goals.
