# Worklog

Running log of project workflow — one entry per working session, newest first.
Each entry: what was done, decisions made, open questions, next steps.
This file is the "documenting the workflow as we move forward" artifact; keep it
honest and terse.

---

## 2026-06-11 — Session 17: Sonnet 4.6 default + per-tool coverage suites

### Done

- **Default model switched** `claude-opus-4-8` → `claude-sonnet-4-6` for both
  LLM boundaries (eval agent in @protocolfoundry/evals, curator in
  @protocolfoundry/curation; both keep adaptive thinking / structured
  outputs, which Sonnet 4.6 supports). Historical docs/ADR mentions left as
  records; CLAUDE.md updated.
- **Why the Shiprocket report had only 4 rows**: report rows are *suite
  tasks*, not API operations — the hand-written
  examples/shiprocket/eval-suite.json has exactly 4 tasks. Fix shipped:
- **`generateCoverageSuite(manifest)`** (@protocolfoundry/evals): one eval
  task per exposed tool, so the report scales to the release's whole tool
  surface. Safety tiers: read tools → live call (success = "RESULT: OK"
  after a real data-returning call); approval-gated tools → blocked probe
  (gateway must refuse, success = "RESULT: BLOCKED", nothing executes
  upstream); non-gated write tools → **skipped by default** (they'd hit the
  real upstream with agent-invented data), opt-in via includeWrites.
  Refuses to emit an empty suite.
- Dashboard: "Generate coverage suite" button in the Evals section
  (generates from the latest release's manifest, include-writes checkbox,
  `coverageSuiteGenerated` audit detail). Verified live: taskboard v2 → 3
  tasks (2 read live + 1 gated probe), create_task/complete_task skipped
  with an explanatory notice.
- Quickstart documents rows-per-task vs rows-per-operation explicitly.
- Tests: 56 green (3 new coverage tests).

### Next steps

1. Re-run Shiprocket from the dashboard with a generated coverage suite
   (all 7 tools → 7 rows; or stage a wider release for more).
2. OAuth 2.1 external-AS flow; naive-vs-curated public-report comparison.

---

## 2026-06-11 — Session 16: eval runs from the dashboard (in-process job runner)

### Done

- **The loop is closed**: upload spec → curate → stage → **run eval** →
  promote, all in the browser. The missing piece since Session 11.
- **`attachEvalRun(projectId, version, evalRun)`** on `ReleaseStore` (file +
  Postgres, tests for both): attach/replace the eval evidence on an existing
  release without touching the immutable manifest. Dashboard staged-then-
  evaled releases no longer need the CLI round trip.
- **`lib/eval-jobs.ts`**: dashboard job runner. Serves the release's manifest
  on an **ephemeral loopback-only gateway** (same executor/credential
  resolver as production, vault-aware), runs the suite with
  `createAnthropicAgent` (default `claude-opus-4-8`), attaches the EvalRun,
  records an `evalCompleted` audit event (new core audit kind). One job per
  project; progress persisted to the workspace after every task
  (`onTaskComplete` hook added to `runEvalSuite`). In-process by design for
  the single-operator deployment — a real queue replaces it at multi-tenant.
- **Project page "Evals" section**: suite upload/paste (validated by new
  `parseEvalSuite` zod schema in @protocolfoundry/evals), job status panel
  with progress gauge auto-refreshing every 4s while running, "Run eval" /
  "Re-run eval" buttons per staged/live release. Honest hints when writes
  are disabled or ANTHROPIC_API_KEY is missing.
- `next.config`: `serverExternalPackages` for express/MCP SDK/Anthropic SDK
  (they now run inside the Next server process).
- **Tests: 53 green** (4 new). Highlight: full-loop integration test —
  scripted agent + mock HTTP upstream + ephemeral gateway + temp release
  store proves spec-level eval mechanics with no API key. Live form-replay
  smoke: suite upload (303 + saved), Run eval correctly refused without
  ANTHROPIC_API_KEY.

### Next steps

1. OAuth 2.1 external-AS flow (raised priority per competitive survey).
2. Large-spec eval campaign (Shiprocket with real token — can now run from
   the dashboard) → naive-vs-curated number for the public report.
3. Metering/billing, drift detection, design partners.

---

## 2026-06-11 — Session 15: public agent-readiness reports (signed share links)

### Done

- **Public eval reports** — competitive move #1 from
  docs/06-competitive-landscape.md, shipped: every release with an eval run
  gets a "public report (shareable link)" button on its release page →
  `/reports/<project>/<version>?sig=<hmac>`. The page renders without a
  session (middleware allows `/reports/*`; the signature is the gate):
  headline completion/tool-selection scores, per-task results, tool-surface
  shape, governance facts (immutable releases, scopes, audit, approval
  gates), "measured, not promised" framing.
- **`lib/report-sign.ts`**: HMAC-SHA256 over `report:<project>:<version>`
  with `PF_DASHBOARD_SECRET ?? PF_DASHBOARD_PASSWORD` (32-hex-char sig,
  timing-safe compare). Signatures never expire — links published in vendor
  docs must keep working. Open mode (no password) needs no signature.
  Bad/missing sig and missing release/eval are an indistinguishable 404.
- Verified live on the prod build: anonymous fetch with valid sig → 200 with
  scores; missing sig → 404; forged sig → 404; link correctly rendered on
  the release page. 49 tests green (4 new sign/verify tests).
- Quickstart + roadmap + competitive doc updated.

### Next steps

1. Naive-vs-curated comparison on the public report (the marketing delta)
   once the large-spec eval campaign lands.
2. OAuth 2.1 external-AS flow (raised priority per competitive survey).
3. Eval runs from the dashboard (job runner); Shiprocket real-token eval.

---

## 2026-06-11 — Session 14: competitive landscape, dashboard motion pass, zip bundles

### Done

- **`docs/06-competitive-landscape.md`**: market map (June 2026) across four
  archetypes — spec-to-server platforms (Speakeasy Gram, Stainless, Tyk AI
  Studio, MCP.link, openapi-mcp-generator family), connector catalogs
  (Composio/Zapier/Pipedream/Klavis), registries (Smithery/Glama), DIY.
  Strategic moves: public eval-readiness reports, eval-gated releases as the
  trust story, Postman/beyond-OpenAPI ingestion as wedge-widener, connection
  bundles not source bundles, agent analytics, registry partnerships.
  **OAuth 2.1 gap raised in priority** (most-cited managed-platform feature we
  lack); roadmap + strategy doc + CLAUDE.md cross-linked.
- **Dashboard motion pass** (CSS-first, `prefers-reduced-motion` safe): rising
  ember particles, gauge fills sweeping to value with hot tip, count-up stats
  (`CountUp` client component), section-underline draws, card sheen/lift +
  furnace-edge flicker on live cards, nav underline draws, button sheen/press,
  staggered table rows, timeline live-dot ping, flash slide-ins.
- **Connection bundles (.zip)**: release page → `GET /api/projects/<id>/
  releases/<v>/bundle` streams a zip with README (endpoint, `pf token issue`
  instructions, tool/scope/gate table), manifest.json, release.json, client
  configs (Claude Code `.mcp.json`, Claude Desktop via mcp-remote, Cursor),
  eval-report.json when present. **No credentials, no source** (ADR-0003).
  `PF_PUBLIC_GATEWAY_URL` controls the advertised endpoint origin.
- **Zip spec upload in the Forge**: `.zip` accepted (extension or PK magic);
  json/yaml entries tried shallowest-first until one ingests as
  OpenAPI/Postman; provenance `upload:<zip>!<entry>`; `__MACOSX`/dotfiles
  skipped. Verified live by no-JS form replay: login → multipart zip post →
  303 to curate, graph carries the zip-entry sourceId.
- **`.gitignore` bug**: bare `releases/` ignored the new route directory
  (`.../releases/[version]/bundle/`) — root-anchored to `/releases/`,
  `/workspace/`; the route file was silently untracked before the fix.
- Route handlers that read live stores need `export const dynamic =
  "force-dynamic"` — Next statically optimized the bundle GET and cached a
  500 from build context.
- Tests: 45 green (4 new in `apps/web/test/bundle.test.ts`); typecheck +
  prod build clean; bundle download (200/zip + 404 path) and zip upload
  verified against the prod server.

### Open questions

- Dev-harness browser tools were broken this session — the animated UI is
  build-verified but not eyeballed; worth a quick human look at
  `npm run dev -w @protocolfoundry/web`.

### Next steps

1. Public shareable eval-readiness report (competitive move #1).
2. OAuth 2.1 external-AS flow (raised priority per competitive survey).
3. Eval runs from the dashboard (job runner); Shiprocket real-token eval.

---

## 2026-06-10 — Session 13: native Postman ingestor + Shiprocket conversion

### Done

- **`ingestPostman`** (packages/discovery) + **`ingestSource`**
  auto-detection (Postman v2.1 vs OpenAPI) wired into `pf ingest` and the
  Forge. Mapping built defensively for real-world collections:
  - input schemas **inferred from example request bodies** (typed, depth-capped);
    query params, `:param` / unresolved-`{{var}}` path params; formdata keys
  - auth: explicit per-request types; `noauth` opts out; "inherit" falls back
    to the collection's **dominant explicit scheme** (documented heuristic)
  - multi-host → multiple baseUrls with per-operation refs; folders → tags;
    output schemas from 2xx example responses; collection variables substituted
- **Shiprocket converted**: 92/92 requests ingested (bearer auth detected,
  both hosts mapped, 3 noauth login ops); 7-tool core shipping manifest
  generated; hosted with scoped tokens. `create_custom_order` got 40+ typed
  args from the example body. Verified live: read token listed tools and was
  **scope-blocked** on the write tool; the read call reached the real
  `apiv2.shiprocket.in` and surfaced Shiprocket's own 401 for the dummy
  credential — full pipeline proven; a real token in the vault makes it live.
- `examples/shiprocket/README.md` — end-to-end walkthrough + honest
  limitations (no required-field info in Postman, formdata caveat).
- 41 tests green (3 new: fixture mapping incl. variable-resolution bug found
  by test, inferSchema depth cap, real-collection assertions).

### Next steps

1. Eval Shiprocket with a real account token (user) — large-spec eval
   campaign continues.
2. Eval runs from the dashboard (job runner).
3. Metering/billing, drift detection, design partners.

---

## 2026-06-10 — Session 12: scoped tokens + encrypted credential vault (ADR-0007)

### Done

- **`@protocolfoundry/vault`**: AES-256-GCM encrypted-at-rest credentials
  (`PF_VAULT_KEY` master key via `pf keygen`); file + Postgres backends;
  `pf vault set/list/rm`. Fails closed on wrong key; nothing readable on
  disk; list never exposes secrets.
- **Gateway credential resolution is now async + vault-aware**:
  `vault:<id>` refs, and `env:<NAME>` falls back env→vault so secrets can
  move into the vault with zero manifest changes.
- **Scoped bearer tokens** (`pf token issue --server X --scopes read,write
  --days 30`, secret `PF_GATEWAY_TOKEN_SECRET`): HMAC-signed, expiring,
  server-bound. Static API key stays as full-access mode.
- **Per-tool scope enforcement**: generator assigns requiredScopes by effect
  (read/write/destructive); composed tools take the union of step scopes;
  gateway rejects out-of-scope calls with an audited `insufficient_scope`.
- **MCP-auth resource-server shape**: RFC 9728 metadata at
  `/.well-known/oauth-protected-resource/mcp/<server>` (scopes from the live
  manifest, `PF_AUTH_SERVER_URL` advertised); 401s carry `WWW-Authenticate`
  with the metadata URL. Full code-flow AS deferred (ADR-0007).
- 38 tests green (10 new): vault behaviors on both backends + encryption
  fail-closed; e2e read-token reads via vault credential / blocked on write,
  write-token writes, expired/wrong-server/garbage all 401 with
  WWW-Authenticate, metadata content.

### Next steps

1. Shiprocket decision (Postman ingestor vs converter) + large-spec evals.
2. Eval runs from the dashboard (job runner).
3. Remaining Phase 3: usage metering/billing, drift detection, design
   partners; external-AS OAuth when multi-tenant.

---

## 2026-06-10 — Session 11: the Forge — curation review UI + source upload

### Done

- **`/forge`**: upload an OpenAPI spec (file or URL) + project id → ingest →
  workspace; lists in-progress projects (ops count, proposal status).
- **`/projects/<id>/curate`**: operation review table (checkboxes; delete
  ops unchecked by default) → "Stage naive release"; "Run LLM curation"
  button (disabled with a hint unless ANTHROPIC_API_KEY is set on the
  dashboard server) → proposal review: warnings panel, refinements and
  composed tools approved item-by-item via checkboxes → "Apply approved &
  stage curated release". Server name + base-URL fields on both paths.
- **Plumbing**: `lib/workspace.ts` (file workspace for graphs/proposals,
  `PF_WORKSPACE_DIR`, gitignored); `lib/forge-actions.ts` server actions
  (operator-gated, audit `manifestChange` events); `requireOperator`/
  `appendAudit` moved out of the "use server" module into `lib/operator.ts`
  (exported helpers in an action module would become public endpoints).
- Releases staged from the forge carry `approvedBy: operator` and **no eval**
  — the project page already flags this with the "no eval" chip, and flash
  messages say "run pf eval before promoting".
- Verified live end-to-end via form replay: spec file upload → 303 to curate
  → ops listed → staged naive release v1 for `demoapp` with exactly the 3
  checked tools (deleteTask excluded), base URL from the spec, audit event
  recorded.

### Notes

- In-browser eval triggering is the missing piece of the loop (evals still
  run via `pf eval`) — candidate for a later session alongside background
  jobs, since eval runs take minutes.

### Next steps

1. OAuth 2.1 on the gateway; credential vault.
2. Shiprocket decision: Postman ingestor (Phase 4 item) vs converter.
3. Eval runs from the dashboard (needs a job runner).

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
