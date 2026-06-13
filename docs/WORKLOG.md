# Worklog

<!-- newest entry goes directly below this line -->
## 2026-06-13 — SP1: connector engine core

- Added `@protocolfoundry/connectors` (engine, OIDC discovery, safe transform
  vocabulary) + declarative `ConnectorConfig` in core (ADR-0012).
- Captures only sanctioned redirect handoffs; standard OAuth2/OIDC needs no
  per-provider code, Kite expressed via declarative derive+exchange config.
- Output is `SealedSecret[]` for callers to seal — gateway resolution unchanged.
- Next: SP2 (LLM config derivation + global model switch), SP3 (connect/rotation
  surfaces), SP4 (unsupported-API intake).

---
## 2026-06-13 — Session 24: eval-button feedback + reliable toast + audit mobile

### Done

- **"Run eval does nothing" — root cause + fix**: the button was silently
  `disabled` whenever the project had no eval suite, so a click did nothing and
  showed no reason. Now it's only disabled while a run is active; with no suite
  it stays clickable, shows a "needs a suite ↓" hint, and a click surfaces the
  action's error as a toast. (Verified on prod: generated a coverage suite for
  `razorpay-ifsc` and ran an eval → toast + 100/100.)
- **Toast made reliable**: the client/`useSearchParams` toast in the root layout
  never hydrated (rendered server-side, effects never ran — confirmed via
  instrumentation). Rewrote it as a **pure server component** the page renders
  from `?notice`/`?error`, auto-fading via CSS (5 s success / 9 s error). No
  client JS to fail. Removed it from the layout; the project page renders it.
- **Audit page mobile**: wrapped the table in `.table-scroll`; the filter pills
  already wrap; masthead nav now scrolls (not overflows) across the whole
  ≤760 px range. Verified at 390 px.

---
## 2026-06-13 — Session 23: eval feedback + mobile responsive + homepage CLI demo

### Done

- **Eval-on-live, fully wired**: clicking Run eval on a live release silently
  failed because `startEvalJob` *and* `attachEvalRun` (file + pg stores) still
  rejected non-staged releases — only the button had been freed (Session 21).
  Relaxed all three to allow staged **or** live, so a promoted server can be
  re-graded; tests updated to assert the new behavior (103 pass).
- **Feedback so the user isn't in the dark**:
  - Global **toast** (`components/toast.tsx`, mounted in layout) surfaces
    `?notice`/`?error` from server actions as a fixed, auto-dismissing overlay
    and strips the param — visible regardless of scroll. Removed the easy-to-
    miss top-of-page flash on the project page.
  - **Eval progress bar** on the running release (completed/total tasks, polled
    by the existing 3 s AutoRefresh).
- **Mobile responsive fixes** (verified at 390 px): masthead nav fits / scrolls
  instead of overflowing; data tables wrapped in `.table-scroll` (horizontal
  scroll) + smaller type; release-detail action buttons ("connection bundle",
  "public report") wrap instead of overflowing; release-row controls wrap.
- **Homepage CLI demo** (`components/cli-demo.tsx`): a looping animated terminal
  showing `pf ingest → curate → release` then `claude / gemini / codex mcp add`
  → "available to your agents". New overview section 01 (others renumbered).

### Open questions / next steps

- Deploys via `main` → Render. To re-run a prod eval: connect the upstream
  credential + upload a suite, then Re-run eval on the live release.

---


Running log of project workflow — one entry per working session, newest first.
Each entry: what was done, decisions made, open questions, next steps.
This file is the "documenting the workflow as we move forward" artifact; keep it
honest and terse.

---

## 2026-06-13 — Session 22: prod setup docs + customer bundle credentials

### Done

- **Diagnosed prod** (`protocolfoundry-web.onrender.com`, logged in): all pages
  link and render (overview, project, release detail, Forge, audit).
  - _Correction:_ an earlier read showed "Vault unavailable" — but that was a
    **stale pre-redeploy build**. `PF_VAULT_KEY` *was* set; after the redeploy
    the vault is available and the Credentials **Connect** form works.
  - The `zerodha-api-docs` eval is re-runnable on its live release now, but the
    button is disabled because the project has **no eval suite** yet (and the
    Kite credential isn't connected — needed for a non-zero score). To re-run:
    Generate/upload a suite → connect the Kite token → Re-run eval.
- **Deployment doc** (`docs/guides/deployment.md`): spelled out that
  `PF_VAULT_KEY` is **required** for credential onboarding (with the exact
  "Vault unavailable" failure mode), that `ANTHROPIC_API_KEY` must be a real
  key, added an env-var table, and a "Connecting credentials & running evals"
  section (the eval form is now on live releases too — Session 21).
- **Customer connection bundle** (`apps/web/src/lib/bundle.ts`): added an
  **Upstream credentials** section to the README — lists each binding with its
  auth kind and guide title, and states secrets are operator-connected in the
  dashboard and vaulted, never in the bundle (ADR-0011). Test covers it.
- Generated a real TMDB bundle (`demo/build-bundle.mts` → prod gateway URL) to
  verify: 29 tools, composed tools flagged, eval report, the new creds section.

### Open questions / next steps

- User to set `PF_VAULT_KEY` in Render's `pf-shared` group, then connect the
  upstream credential and re-run the eval on the live release.

---

## 2026-06-13 — Session 21: eval re-run on live releases + glossary widget

### Done

- **Composed-tool binding fix** (shipped `1567129`): the gateway binding
  resolver couldn't follow array indices, so curated composed plans that
  reference `$steps[0].output.results[0].id` (the first search hit) resolved
  `undefined` → "Missing required path parameter". Added a `parsePath`
  tokenizer (`results[0].id` → `results, 0, id`) used in both `$args`/`$steps`
  resolution, plus `resolveBinding` unit tests. Found during the TMDB demo.
- **Eval re-run on live releases**: the project page only showed the eval
  form (model picker + Run/Re-run) for `staged` releases, so once a server
  was promoted there was no way to re-evaluate it. Now the form renders for
  `live` releases too (`startEval` already accepted any version; this was a
  pure UI gate). Promote stays staged-only. Verified locally: the live TMDB
  v1 shows `haiku ▼` + "Re-run eval".
- **Glossary help widget** (`components/glossary.tsx`): a fixed "? Terms"
  button on every page opens a plain-language popover defining MCP server,
  tool, manifest, curation, composed tool, eval run, gate, release,
  credential/vault, gateway, approval gate, audit log — for non-technical
  operators. Closes on Esc / outside click. Styled with the porcelain tokens.

### Notes for prod (Render, auto-deploys from `main`)

- Login page is up at the web host → `PF_DASHBOARD_PASSWORD` is set (not open
  mode), so write controls render once logged in.
- For the eval Run/Re-run button to actually work in prod, `ANTHROPIC_API_KEY`
  must be a **real** key in Render (the blueprint ships a placeholder), an
  eval **suite** must be uploaded, and the upstream **credential** connected
  (so the ephemeral eval gateway's tool calls reach the real API).

### Open questions / next steps

- Couldn't fully verify authenticated prod pages (no prod password in hand);
  same code as the verified local run is now deploying.

---

## 2026-06-12 — Session 20: credential onboarding (ADR-0011) + quickstart sync

### Done

- **Credential onboarding flow (ADR-0011)**: customers, not platform
  operators, hold upstream credentials (Kite's daily access token, Chargebee
  keys, …), but the only connect paths were prod env vars (restart per
  credential) or `pf vault set` (needs PF_VAULT_KEY in hand) — and nowhere to
  tell a user *how* to obtain a given credential. Added:
  - `credentialGuides` map on `McpServerManifest` (keyed by authRequirementId:
    `title`, `valueFormat`, ordered `steps`, optional `helpUrl`/`rotation`) —
    instructions only, never secrets. Old manifests parse unchanged (`{}`).
  - Dashboard **Credentials** panel on the project page: one slot per binding
    with guide (manifest-authored, else generic per-auth-kind fallback in
    `credentials.ts`), connect status (vault row present), and a
    paste-to-connect form. Secrets seal straight into the shared vault
    (`PF_VAULT_KEY` + Postgres, same key the gateway decrypts with), live
    immediately with no restart; connect/revoke audited by binding id only.
  - Gateway missing-credential error now names the binding, project, and
    Credentials panel (+ guide title when present) so an agent transcript
    tells the human exactly where to go.
  - `pf creds <manifest.json>` CLI: prints bindings, guides, and both connect
    paths (dashboard or `pf vault set`).
- **Quickstart synced** (`docs/guides/local-quickstart.md`, per CLAUDE.md
  convention): step 4 now documents `pf creds` and presents three connect
  options (env var / vault / dashboard panel); step 8 documents the
  Credentials panel and the `PF_VAULT_KEY` + `PF_DATABASE_URL` it needs;
  troubleshooting row for the missing-credential error and the "vault is
  Phase 3" limitation updated to match reality.

### Open questions / next steps

- Guides aren't authored by the generator/curation yet — manifests ship `{}`
  and the dashboard/CLI use generic fallback guides. Authoring real guides
  (e.g. Kite's request-token dance) during curation is the natural follow-up.
- Still one credential set per server (every caller shares the
  operator-connected account); true per-caller credentials need their own ADR.
- Public self-service submission page (customers paste keys without an
  operator session) is explicitly out of scope in ADR-0011.

---

## 2026-06-12 — Session 19: credential redaction in executor errors, overview FAQ + 3D frontend

### Done

- **Security fix (HIGH finding on pushed code)**: the executor's
  "upstream unreachable" error interpolated the full request URL, which
  leaks apiKey secrets applied with `in: "query"`; `upstreamCalls[].url`
  had the same exposure in logs/audit. Errors now strip the query string
  entirely; call records keep non-secret params but mask auth-carrying
  ones as `***`. TDD'd (two new executor tests, one against a live local
  listener). Pushed as `ec21e1d`.
- **Overview page upgrade** (porcelain language kept): new FAQ accordion
  as section 01 describing the product (what ProtocolFoundry is, MCP,
  docs-URL ingestion, eval gates, credential handling, manifest-interpreted
  gateway — six items, single-open, grid-rows height animation); real CSS
  3D in the hero — a machined hexagonal prism (`preserve-3d` faces + caps)
  with orbital hairline rings and motes that spins and tilts toward the
  pointer (`foundry3d.tsx`), replacing the torus PNG; 3D pointer-tilt +
  glare on project cards; two royalty-free Unsplash photos
  (`bg-facade.jpg`, `bg-volume.jpg`) masked in as low-opacity backdrop
  elements (hero left edge, FAQ right edge, activity left edge).
  All motion gated behind `prefers-reduced-motion`; photos/prism hidden
  on mobile. Verified in-browser at 1440px and 390px (accordion, tilt
  vars, layout).

- **Kite Connect auth diagnosis + fix**: user's zerodha-api-docs eval showed
  92% tool selection but 16% completion. Probed api.kite.trade live: it
  rejects `Authorization: Bearer …` with 400 "unknown Authorization scheme"
  (InputException) — Kite requires `Authorization: token api_key:access_token`.
  The executor's bearer/oauth2 branch always prefixed `Bearer `, so every
  upstream call failed; the agent still picked the right tools (selection
  counts failed calls) but could never complete tasks. Fix: a secret that
  already contains a space is sent verbatim (it names its own scheme), so
  re-vaulting the credential as `token <key>:<token>` fixes the live server
  with no re-forge. TDD'd against a local header-echo listener.
  `X-Kite-Version: 3` confirmed NOT required.

### Open questions / next steps

- Favicon 404 on the dashboard (pre-existing, cosmetic).
- Consider reusing the FAQ/3D treatments on the login and forge pages.
- Kite access tokens expire daily — the vaulted credential must be refreshed
  each trading day; consider a credential-freshness warning in the dashboard.
- If Kite eval completion stays low after the auth fix, check composed-tool
  bindings against Kite's `{"status","data":{…}}` response envelope
  (`$steps[n].output.data.<field>`, not `.<field>`).

---

## 2026-06-11 — Session 18: customer bundle verified, multi-page docs crawl, upstream-error clarity

### Done

- **Verified the customer bundle end-to-end** (`npm run dist` →
  `dist/customer-release/pf.exe` + README): ingest → generate → `pf serve` →
  MCP initialize/tools/list/tools/call over Streamable HTTP, including a
  fully live run against `https://api.apis.guru/v2/openapi.yaml` (real JSON
  back through `tools/call`) and against the NWS docs page
  (`weather.gov/documentation/services-web-api` → spec autodiscovered →
  live alert data through the gateway). The relative-server-URL fix in
  `openapi.ts` confirmed working (Petstore `/api/v3` resolves against the
  source URL).
- **Multi-page docs crawl** (ADR-0010 amended): `ingestUrl` now follows
  same-origin links from a docs index page breadth-first (default 12 pages
  / 2 hops, `--max-pages`/`--depth` CLI flags), runs spec autodiscovery on
  every crawled page (first working spec wins), and merges per-page LLM
  extractions (only pages showing `METHOD /path` signatures are extracted)
  into one WorkflowGraph. SSRF guard on every hop; cross-origin links never
  followed. Verified live against Flipkart Seller docs: crawled 11 pages
  (listing/order API refs) and correctly handed off to LLM extraction.
  5 new tests (`findDocLinkCandidates`, crawl merge, child-page spec
  discovery, page budget, origin confinement).
- **Upstream failure clarity**: `executePlan` now unwraps undici's cause
  chain — tool errors read `Upstream GET <url> unreachable: connect
  ECONNREFUSED …` instead of bare `fetch failed` (what an agent in
  Claude/Gemini actually sees when a credential/base-URL is wrong). New
  executor test.
- **bundle.mjs**: aborts with an actionable message when `pf.exe` is locked
  by a still-running serve (was: silent catch, then cryptic pkg EPERM).

### Live LLM extraction validated (same day, with API key)

- **Flipkart Seller docs end-to-end with haiku**: `pf ingest
  https://seller.flipkart.com/api-docs/FMSAPI.html --model haiku
  --max-pages 3 --depth 1` crawled 3 pages and extracted **41 operations**
  (listings, shipments, returns, OAuth endpoints) with the correct base URL
  (`https://api.flipkart.net`) and oauth2 auth detail. Generated a 3-tool
  manifest, served it, MCP tools/list + tools/call worked — the call reached
  Flipkart's real gateway (its own 404 came back for the docs-stated path;
  exact route verification is what curation review is for).
- Four LLM-boundary fixes shaken out by the live run:
  1. `createAnthropicDocsExtractor` now resolves model aliases via
     `resolveClaudeModel` (was sending the literal string "haiku").
  2. Extraction request now **streams** (`messages.stream().finalMessage()`)
     — non-streaming 32K-token requests are rejected by the SDK.
  3. Structured-output schema: `auth.detail` open map → pinned `{name, in}`
     (API forbids `additionalProperties` other than `false`).
  4. New `supportsAdaptiveThinking()` in core — haiku models 400 on
     `thinking: adaptive`; gate applied in discovery extractor, curation
     curator, and evals agent (the latter two had the same latent bug).
- 87 tests green (core models test added).

### Open questions

- Petstore demo upstream was returning 500s for all callers; if used in
  demos, prefer apis.guru or api.weather.gov.

### Next steps

- Eval-gate a crawled-docs server once extraction can run with a key.
- Consider surfacing crawl progress in the Forge UI (currently CLI log only).

---

## 2026-06-11 — Session 17: docs-page ingestion (ADR-0010)

### Done

- **`pf ingest <url>` / Forge URL field now accept SaaS API-documentation
  pages**, not just machine-readable specs. New `packages/discovery/src/docs.ts`
  (`ingestUrl`), shared by CLI and Forge:
  1. spec autodiscovery in the HTML (swagger-ui/redoc configs, spec-ish
     links) — deterministic, no LLM;
  2. fallback: `DocsExtractor` LLM boundary (interface like `Curator`;
     scripted fakes in tests, real `createAnthropicDocsExtractor` with
     structured outputs) extracts documented endpoints → validated →
     `WorkflowGraph` (dedupe per method+path, path placeholders forced to
     required inputs, effect from method, auth requirement carried).
- Extraction lands in the normal curation/review pipeline — hallucinated
  endpoints die at human review; the eval gate stays the backstop.
- `Source.kind "docsUrl"` is finally implemented. Plain authenticated-free
  fetch only, honest UA, no anti-bot circumvention (ADR-0002).
- 10 new tests (57 total green): autodiscovery, relative resolution,
  HTML→text, extraction→graph assembly, both ingestUrl paths, error
  messages. CLAUDE.md / architecture / quickstart synced.

### Decisions

- ADR-0010: autodiscovery before LLM; no headless browser for
  client-rendered docs apps (clear failure message instead) — a rendering
  crawler is a separate later decision.

### Next steps

- Try `pf ingest` against a few real SaaS docs sites from a network-open
  environment; tune `findSpecCandidates` patterns with what we learn.

---

## 2026-06-11 — Session 16: dashboard redesign — "porcelain" design language

### Done

- **Full visual redesign of `apps/web`** to a light, Apple-product-page
  aesthetic ("porcelain"), chosen from 4 mockup directions
  (`design-themes/`): studio-light surfaces, hairline borders, rounded
  cards with layered shadows, Schibsted Grotesk display / Instrument Sans
  text / Spline Sans Mono.
- **Motion**: scroll-progress rail under the fixed glass nav; soft
  rise-on-scroll reveals (`<Reveal>`, IntersectionObserver); parallax hero
  (`<Parallax>`, rAF) with a studio backdrop and floating machined-metal
  elements; hover micro-interactions; `prefers-reduced-motion` respected
  throughout (`src/components/scrollfx.tsx`).
- **Loading graphics**: hexagonal brand-mark spinner + indeterminate bar
  (`src/components/loader.tsx`), wired as the route-level `loading.tsx`.
- **Generated art assets** (`public/art/`): all imagery is authored in-repo
  (SVG → transparent PNGs rendered via headless Chromium), so it is
  copyright-free by construction — the sandbox's network policy blocks
  stock-photo CDNs (Unsplash/Pexels/picsum all 403), so nothing external
  is hotlinked.
- Overview page got an Apple-style hero (full-bleed, parallax, CTAs);
  every other page restyles automatically via the shared classes in
  `globals.css` (all class names kept). Responsive pass for phones.
- 47 tests green; production `next build` clean.

### Decisions

- Theme direction "porcelain" picked by operator preference for an
  apple.com-like product feel; other three mockups kept in
  `design-themes/` for reference.

### Next steps

- Consider real stock photography (hotlinked Unsplash) once deployed —
  browsers can fetch what this sandbox cannot.

---

## 2026-06-11 — Session 15: production deployment on Render (ADR-0009)

### Done

- **ADR-0009**: Render blueprint deployment, branch-per-environment.
  Root `render.yaml` declares 4 services (gateway + web × dev/prod) and
  2 Postgres DBs; each service pins its branch with `autoDeploy: true`,
  so **every push to `dev`/`prod` deploys that environment** — no deploy
  secrets in GitHub.
- New long-lived branches **`dev`** and **`prod`** (both cut from the same
  commit, so the first blueprint sync deploys identical code to both).
  Promotion flow: feature → `dev` (PR) → `prod` (PR). `main` stays default.
- **CI** (`.github/workflows/ci.yml`): npm ci → full test suite (builds all
  workspaces first) → typecheck → web build, on pushes/PRs to
  `main`/`dev`/`prod`. Render services should use "Auto-Deploy: After CI
  Checks Pass".
- Per-env secret wiring: env groups `pf-shared-{dev,prod}` keep
  `PF_VAULT_KEY` + `PF_GATEWAY_TOKEN_SECRET` identical across gateway/web
  within an env, never across envs. Operator supplies `PF_VAULT_KEY`,
  `PF_DASHBOARD_PASSWORD`, `ANTHROPIC_API_KEY` in the Render dashboard
  (documented in `docs/guides/deployment.md`); the rest are
  `generateValue`/`fromDatabase`.
- Prod web gets a 1 GB disk for the Forge workspace
  (`PF_WORKSPACE_DIR=/var/data/workspace`); dev workspace stays ephemeral.
- Architecture doc deploy section synced to Render/ADR-0009.

### Decisions

- Render over Fly/Railway (native branch auto-deploy, blueprint IaC, no
  Docker needed for a single-tree monorepo) — ADR-0009.

### Open questions

- When does dev's free Postgres expiry (30 days) become annoying enough to
  pay for basic-256mb in dev too?
- Custom domains + `PF_AUTH_SERVER_URL` (OAuth resource metadata) once a
  real authorization server exists.

### Next steps

- Operator: connect the blueprint in the Render dashboard and fill the
  `sync: false` secrets (one-time, see `docs/guides/deployment.md`).
- Flip the four services to "Auto-Deploy: After CI Checks Pass".

---

## 2026-06-11 — Session 14: eval runs from the dashboard (ADR-0008)

### Done

- **The browser loop is closed**: ingest → curate → stage → **eval** →
  promote, all from the dashboard. The "no eval" chip on forge-staged
  releases now resolves in the UI instead of via `pf eval`.
- **`ReleaseStore.attachEvalRun`** (file + Postgres): attach/replace the
  eval on a *staged* release (latest run wins, `evalRunId` updated);
  live/retired releases are sealed — their eval is what they were promoted
  on. Manifest immutability untouched.
- **In-process eval job runner** (`apps/web/src/lib/eval-jobs.ts`):
  - hosts the staged manifest on an **ephemeral loopback gateway**
    (`createGatewayApp` on `127.0.0.1:0`, one-time key, production env→vault
    credential resolver, shared audit store — eval tool calls hit the real
    upstream and are audited like real traffic);
  - file-backed job records (`workspace/<project>/jobs/eval-v<N>.json`) with
    per-task progress via a new `runEvalSuite` `onResult` callback;
  - server action validates fast, then schedules the run with Next `after()`;
    project page auto-refreshes while a job is active; stale "running"
    records (server restart mid-run) surface as *interrupted*;
  - success appends a new `evalCompleted` audit event (kind added to core +
    audit viewer filters, alongside `manifestChange`).
- **Eval suites are dashboard-managed**: upload/paste JSON on the project
  page, zod-validated (`parseEvalSuite`, also checks success-pattern
  regexes), stored in the forge workspace, audited.
- Architecture doc synced: `apps/web` now needs a long-lived Node host
  (in-process jobs outlive the response — serverless would kill them).
- 47 tests green (6 new): attachEvalRun semantics on both store backends,
  suite validation + progress callback, and a dashboard-job e2e (scripted
  agent → ephemeral gateway → eval attached, audit trail clean of secrets).
- Verified live via no-JS form replay: suite upload (303 + notice, table
  rendered, Run eval enabled) → Run eval with a dummy API key → job executed
  after the response and recorded a clean `failed` with the real Anthropic
  401 → page shows the failure chip; unauthenticated POST still 307s to
  /login. `next build` green with the gateway/express server-external
  packages.

### Next steps

1. Eval Shiprocket with a real account token (user) — large-spec eval
   campaign continues.
2. Metering/billing, drift detection, design partners.
3. Multi-tenant job queue (DB-backed) when the in-process runner stops being
   enough — job-record format is already the UI contract.

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
