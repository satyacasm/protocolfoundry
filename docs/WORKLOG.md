# Worklog

Running log of project workflow — one entry per working session, newest first.
Each entry: what was done, decisions made, open questions, next steps.
This file is the "documenting the workflow as we move forward" artifact; keep it
honest and terse.

---

## 2026-06-10 — Session 10: audit events → Postgres + paginated viewer

### Done

- **`@protocolfoundry/audit`**: `AuditStore` interface (record + paginated
  query, newest-first, kind/project filters, hashed args) with two backends —
  `JsonlAuditStore` (same line format as the Phase 1 log, existing files keep
  working) and `PgAuditStore` (append-only `audit_events` table, no UPDATE
  path). `createAuditStoreFromEnv()`: `PF_DATABASE_URL` → Postgres, else
  `PF_AUDIT_LOG` JSONL — same convention as releases.
- **Gateway** writes through the store (`AuditLog` kept as a back-compat
  alias for the JSONL backend; `McpServerDeps.audit` is now the `AuditSink`
  interface). **Dashboard** reads via `auditStore.query` and its
  promote/rollback actions record through the same store — fixing the gap
  where dashboard audit writes were JSONL-only even when releases used pg.
- **Audit viewer pagination**: 50/page with older/newer links that preserve
  the kind filter; verified live (single-page log correctly shows no links).
- 28 tests green — 4 new, running the same behavioral suite against BOTH
  audit backends (ordering, filters, no-overlap pagination, no raw args
  stored).

### Next steps

1. Dashboard v2b: curation review UI, source upload.
2. OAuth 2.1 on the gateway; credential vault.
3. Large-spec eval campaign (Shiprocket collection waiting in
   examples/shiprocket — needs the Phase 4 Postman ingestor or a converter).

---

## 2026-06-10 — Session 9: dashboard write paths (promote/rollback from the UI)

### Done

- **Server actions** (`apps/web/src/lib/actions.ts`): `promoteRelease` /
  `rollbackRelease` — operator-gated (session cookie re-verified inside the
  action; **refused entirely in open mode** so an unprotected dashboard stays
  read-only), append `releasePromoted`/`releaseRolledBack` audit events with
  `actor user:operator`, redirect back with success/error flash messages.
- **Project page**: release rows restructured (version links + action
  buttons); Promote on staged releases, Roll back on live (only when a
  retired predecessor exists); flash banners; read-only hint in open mode.
- Verified live end-to-end via no-JS form replay (curl/Node): promote v3 →
  303, store v3 LIVE / v1 RETIRED, audit event written; Roll back button
  appeared; rollback → v1 live again + audit event; unauthenticated POST →
  307 to /login (middleware blocks before the action runs).

### Incident note

- Windows Defender flagged my own PowerShell diagnostic (Invoke-WebRequest +
  hidden-input regex = `Trojan:Win32/PowhidSubExec.B` behavioral signature)
  while testing the forms. **False positive on the test command, not the
  project** — no file quarantined; switched HTTP verification to curl/Node.
  Lesson recorded: don't scrape hidden form fields from PowerShell on Windows.

### Next steps

1. Audit events → Postgres (paginated viewer).
2. Dashboard v2b: curation review UI, source upload.
3. OAuth 2.1 on the gateway; credential vault.

---

## 2026-06-10 — Session 8: Postgres store + dashboard auth

### Done

- **`PgReleaseStore`** (ADR-0006): Postgres backend behind the same
  `ReleaseStore` interface as the file store — `ReleaseStore` + shared
  `assertReleaseGate` extracted to `types.ts`. One `releases` table; manifest
  jsonb written once, status-only mutations in transactions (same
  immutability semantics). Structural `PgPoolLike` works with `pg.Pool` and
  pg-mem.
- **Uniform backend selection**: `createReleaseStoreFromEnv()` —
  `PF_DATABASE_URL` → Postgres, else `PF_RELEASES_DIR`/default file store.
  Wired into gateway (release mode), CLI (`pf release ... --db <url>`), and
  dashboard. `releaseManifestSource` generalized over the interface
  (changeStamp fast-path for files, TTL reload for pg — hot rollback intact).
- **Dashboard auth** (ADR-0006): Next middleware gating all pages on an
  HMAC-signed 12h `pf_session` cookie; `/login` page (styled as the
  floor-access gate) + `/api/login` (HMAC password compare) +
  `/api/logout`; `PF_DASHBOARD_PASSWORD` env, `PF_DASHBOARD_SECRET`
  optional signing key; open-mode banner when unset. Web Crypto only, so
  middleware (edge) and routes share the code.
- Verified live: unauthenticated → 307 /login; wrong password →
  /login?error=1; correct password → session cookie → data renders, logout
  shown, banner gone.
- 24 tests green (3 new pg-mem tests: gate semantics, full lifecycle with
  manifest/eval round-trip, ManifestSource hot promote).

### Open questions / follow-ups

- Audit events still JSONL on the gateway — move to Postgres + paginate the
  audit viewer from SQL.
- Dashboard v2 write paths (promote/rollback buttons, curation review) now
  unblocked; needs CSRF-safe form actions.

### Next steps

1. Dashboard v2 write paths (promote/rollback from the UI).
2. Audit → Postgres.
3. OAuth 2.1 on the gateway; credential vault.

---

## 2026-06-10 — Session 7: control-plane dashboard v1 (read-only)

### Done

- **`apps/web`** — Next.js 15 dashboard, "precision foundry" design language
  (dark steel + molten-ember accent, Chakra Petch display / IBM Plex Mono
  data, blueprint-grid + grain atmosphere, instrument-gauge eval bars,
  pulsing live badges). Port 3100.
  - **Overview ("The Floor")**: stat strip (projects, live servers, releases,
    audited tool calls), furnace-slot project cards with live-edge glow +
    eval gauges, recent audit activity.
  - **Project page**: release timeline (live node glows) with status badges,
    eval gauges per release, forced-override attribution chips.
  - **Release detail**: manifest panel (endpoint, base URL, auth schemes,
    provenance), tool-surface table (1:1 vs composed chips, per-call-approval
    gates), full eval report with per-task results.
  - **Audit viewer**: kind filters, actor, hashed args, upstream statuses,
    gated events highlighted.
- Reads the live file release store + gateway audit log directly (server
  components, `PF_RELEASES_DIR` / `PF_AUDIT_LOG`) — zero mock data; verified
  rendering the real Phase 2/3 artifacts (composed tool, 67% gauge, satya's
  gate override, gated deletion event).
- `FileReleaseStore.getEvalRun()` added for the report pages.
- All 21 tests + full workspace typecheck green.

### Decisions

- Dashboard v1 is deliberately read-only: write paths (promote/rollback
  buttons, curation review UI, source upload) need auth + the Postgres store
  first — sequenced behind them in the roadmap.

### Next steps

1. Postgres control-plane store (replaces file store behind the same API).
2. Dashboard auth, then v2 write paths (promote/rollback, curation review).
3. OAuth 2.1 on the gateway; credential vault.

---

## 2026-06-10 — Session 6: Phase 3 kickoff — eval-gated releases + hot rollback

### Done

- **`packages/releases`** (ADR-0005): file-based release store —
  `releases/<project>/v<N>.manifest.json` write-once + mutable `index.json`.
  - Eval gate enforced at creation (default bar 80%/80% via CLI); `--force`
    requires `--approved-by` so overrides are attributable.
  - Promote (staged→live, old live→retired) and rollback (live→rolledBack,
    previous→live) are index pointer swaps.
- **Gateway refactor**: consumes a `ManifestSource` interface — static list
  (dev, `PF_MANIFEST_PATH`) or `releaseManifestSource` (`PF_RELEASES_DIR`),
  which mtime-watches each project index. **Promote/rollback take effect with
  no gateway restart** (proven in e2e: tool surface hot-swapped v1→v2→v1).
- **CLI**: `pf release create/promote/rollback/list`.
- Live demo with real Phase 2 artifacts: the gate **blocked** the curated
  manifest's release (its live eval scored 67% tool-selection < 80% bar) —
  the quality gate working on real data; forced+attributed override, promote,
  rollback all exercised.
- 21 tests passing (5 new: gate enforcement, lifecycle, on-disk immutability,
  hot promote/rollback e2e, 404 for projects without a live release).

### Decisions

- ADR-0005: file store now (zero infra, single-writer), Postgres when the
  dashboard lands; gateway abstracts over `ManifestSource`.

### Next steps (Phase 3 continues)

1. `apps/web` dashboard (Next.js): projects, releases, eval reports, audit
   viewer — first read-only, then curation review UI.
2. Postgres store + multi-tenancy when the dashboard needs it.
3. OAuth 2.1 on the gateway; credential vault.

---

## 2026-06-10 — Session 5: live Phase 2 validation (real Claude curation + evals)

### Done

- Ran the full Phase 2 loop live with `claude-opus-4-8` (user provided an API
  key; **key was pasted in chat — rotate it**). Full findings:
  `docs/validation/2026-06-10-phase2-live-evals.md`.
- Curation: valid proposal first try (5 refinements, 1 composed tool with
  correct step bindings, deleteTask warning). Human review caught and fixed a
  misleading composed-tool name before apply — the ADR-0004 workflow working
  as designed.
- Evals: naive vs curated side by side. Composed tool, when adopted: 2 steps
  vs 3, ~18% fewer input tokens. Both manifests: 100% completion (5-op API is
  too easy for completion to differentiate — need Petstore/GitHub scale next).
- Two real findings from the harness: curated descriptions produce
  description-level safety (agent refused delete before the gateway gate),
  and composed-tool adoption flakes without prescriptive trigger descriptions.
- Fixes landed: curation prompt now requires "use INSTEAD of A then B" trigger
  descriptions; eval suite made outcome-based; `zodOutputFormat` (zod v4-only)
  replaced with a hand-written JSON schema for structured outputs;
  `scripts/compare-evals.ts` + `scripts/run-taskboard-upstream.ts` added.

### Open questions

- Demonstrate the completion-rate gap on a large API (Petstore re-test when
  their demo recovers; then a GitHub-scale spec) — the marketing number.
- Evals backlog: upstream state-reset hook between runs.

### Next steps

1. Phase 3 kickoff: release store + DB (eval-gated releases), then dashboard.
2. Large-spec eval campaign for the headline number.

---

## 2026-06-10 — Session 4: Phase 2 — LLM curation + agent-usability evals

### Done

- **`packages/curation`** — the differentiating layer (ADR-0004):
  - `pf curate`: Claude (`claude-opus-4-8`, adaptive thinking, structured
    outputs via zod schema) proposes a `CurationProposal`: refined tool
    names/descriptions, composed task-level tools (multi-step plans with
    `$args`/`$steps[n].output` bindings), and exposure warnings.
  - Proposals are defensive: hallucinated operationIds dropped, names
    re-sanitized, destructive steps keep approval gates.
  - `pf apply`: human approves (fully/partially) → curated manifest.
- **`packages/evals`** — agent-usability harness:
  - Real agent loop over MCP against a hosted endpoint; scores task
    completion, tool-selection accuracy, steps, tokens → core `EvalRun`.
  - Markdown report + naive-vs-curated comparison renderer; `pf eval`.
- LLM boundaries are interfaces (`Curator`, `AgentModel`) — all 16 tests pass
  with scripted fakes, zero API cost. Key e2e: a composed tool executed two
  upstream calls from ONE agent call with step-output binding, audit-logged as
  one invocation with two upstream entries.
- Gateway `loadManifests` backlog fix: skips non-manifest JSON with a warning,
  names the offending file in validation errors.
- `examples/taskboard/eval-suite.json` — starter suite incl. an
  approval-gate-probing task.

### Decisions

- ADR-0004: curation is a reviewed proposal artifact, never a direct manifest;
  evals are the gate; LLM boundaries are injectable interfaces.
- Release model deferred to Phase 3 (needs the DB/release store).

### Open questions / blocked

- **Live exit-criterion run needs ANTHROPIC_API_KEY** (not set on this
  machine). When available:
  1. `pf curate graph.json -o proposal.json` (review it)
  2. `pf apply graph.json proposal.json -o manifest.curated.json`
  3. Host both manifests; `pf eval examples/taskboard/eval-suite.json
     --endpoint <url> --key <gateway-key>` against each; compare reports.

### Next steps

1. Live naive-vs-curated eval run (above) — the marketing number.
2. Phase 3 kickoff: release store + DB, then dashboard.
3. Curation backlog: schema trimming, pagination/error absorption.

---

## 2026-06-10 — Session 3: public-spec validation (Petstore + Open-Meteo)

### Done

- Ran the pipeline against two real public specs; full report in
  `docs/validation/2026-06-10-public-specs.md`.
- **Open-Meteo (YAML): complete end-to-end success** — live weather data
  through the hosted MCP endpoint. Exercised: YAML parsing, missing
  operationId fallback, missing servers guard, multi-manifest hosting.
- **Petstore (JSON, 19 ops):** ingest/curation/hosting/approval-gate all
  correct; their public demo server is returning 500s to everyone, so upstream
  calls couldn't complete (verified independent of our stack).
- Added `scripts/mcp-call.ts` (generic endpoint exerciser) and
  `scripts/validate-petstore.ts`; root package.json gained `"type": "module"`.

### Backlog from findings

1. `loadManifests` should skip/clearly report non-manifest JSON files.
2. OpenAPI query-param `style`/`explode` serialization (arrays work by luck).
3. Tool names + descriptions need the Phase 2 curation pass (confirmed
   empirically — marketing blurbs and `get_v1_forecast`-style names).
4. Curation UX needs search/grouping for big specs before GitHub-scale (~900 ops).

### Next steps

1. User: interactive MCP Inspector + Claude pass (commands in the validation doc).
2. Phase 2 kickoff: LLM curation pass + eval harness.

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
