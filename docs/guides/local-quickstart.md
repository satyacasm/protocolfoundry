# Local quickstart: turn your app's URL into a hosted MCP server

This is the from-scratch, on-your-machine walkthrough. At the end you'll have
an MCP endpoint running locally that Claude (or any MCP client) can use to
operate your application — with curated tools, an audit log, approval gates on
destructive operations, and an eval score.

> **Scope note:** today the pipeline starts from an **OpenAPI 3.x spec**
> (JSON or YAML). If your URL is an app whose API has a spec, you're set.
> Crawling arbitrary UIs / docs pages is Phase 4 (see docs/04-roadmap.md).
> Only do this for applications you own or are authorized to integrate with.

## 0. Prerequisites

- Node.js ≥ 22 (`node --version`)
- This repo, installed and built:

```powershell
git clone <repo> ; cd "MCP SaaS"
npm install
npm run build
```

- Optional but recommended: `ANTHROPIC_API_KEY` in your environment — needed
  only for the two LLM-powered steps (`pf curate`, `pf eval`). Everything else
  runs offline.

All `pf` commands below are run as:

```powershell
npm run dev -w @protocolfoundry/cli -- <command> <args>
```

(If that's too wordy, `npm run build` once and use `node apps/cli/dist/index.js <command>`.)

## 1. Get your application's OpenAPI spec

Given a URL like `https://app.example.com`, the spec is usually at one of:

- `https://app.example.com/openapi.json` (or `/openapi.yaml`)
- `https://app.example.com/swagger.json` / `/api-docs` / `/v3/api-docs`
- linked from the API docs page, or exported from your framework
  (FastAPI: `/openapi.json`; NestJS/Spring/Rails grape-swagger all generate one)

Download it:

```powershell
Invoke-WebRequest https://app.example.com/openapi.json -OutFile spec.json
```

Works with JSON or YAML, OpenAPI 3.x only (Swagger 2.0 will be rejected with a
clear error).

## 2. Ingest: spec → workflow graph

```powershell
npm run dev -w @protocolfoundry/cli -- ingest spec.json --project myapp -o graph.json
```

This prints every discovered operation with its effect class:

```
Ingested 19 operation(s) -> graph.json
  listOrders   [read]    GET /orders
  createOrder  [create]  POST /orders
  deleteOrder  [delete]  DELETE /orders/{id}
  ...
```

Skim this list — it's your first review checkpoint. Note the operation ids you
actually want agents to have.

## 3. Generate a manifest (choose your path)

### Path A — fast (naive 1:1 tools, no LLM, no API key)

```powershell
npm run dev -w @protocolfoundry/cli -- generate graph.json --name myapp --select listOrders,createOrder,getOrder -o manifest.json
```

- `--select` is the human-in-the-loop step: expose only what you choose.
  Omit it to expose everything (fine for small APIs; don't do it for 200-op ones).
- Destructive operations (DELETE) automatically get a per-call approval gate.
- If the spec has no `servers:` entry or a relative one (common), add
  `--base-url https://app.example.com`.

### Path B — curated (recommended; needs ANTHROPIC_API_KEY)

```powershell
npm run dev -w @protocolfoundry/cli -- curate graph.json -o proposal.json
```

Claude proposes agent-friendly tool names/descriptions, **composed task-level
tools** (multi-step business actions as one tool), and warnings on risky
operations. **Open proposal.json and review it** — rename, delete, or edit
anything (this matters: in our own validation the model proposed a misleading
tool name that review caught). Then apply what you approved:

```powershell
npm run dev -w @protocolfoundry/cli -- apply graph.json proposal.json --name myapp -o manifest.json
# partial approval: --refinements listOrders,createOrder --composed create_and_send_order
```

## 4. Connect credentials and host it

The generate/apply step prints which env vars the gateway needs, derived from
the spec's security schemes, e.g.:

```
Credentials the gateway needs (env vars):
  PF_CRED_APIKEYAUTH
```

Set those to real credentials for YOUR app (API key, bearer token, or
`user:pass` for basic auth), pick a gateway key that agents must present, and
start the gateway:

```powershell
$env:PF_CRED_APIKEYAUTH = "<your real upstream API key>"
$env:PF_GATEWAY_API_KEY = "<invent a strong secret for agents>"
$env:PF_MANIFEST_PATH   = "manifest.json"
npm run dev -w @protocolfoundry/gateway
# -> [gateway] serving "myapp" at http://localhost:3001/mcp/myapp
```

Notes:
- Upstream credentials never appear in logs, manifests, or tool results.
- Without `PF_GATEWAY_API_KEY` the endpoint is open (dev only — it warns loudly).
- `$env:PF_APPROVE_ALL = "true"` lets gated (destructive) tools execute; leave
  it unset to keep them blocked.

> **Encrypted vault instead of env vars (recommended):**
>
> ```powershell
> $env:PF_VAULT_KEY = (npm run -s dev -w @protocolfoundry/cli -- keygen)
> npm run dev -w @protocolfoundry/cli -- vault set PF_CRED_APIKEYAUTH --secret "<your real key>"
> ```
>
> Start the gateway with the same `PF_VAULT_KEY` and drop the plaintext env
> var — `env:` bindings fall back to the vault automatically. Keep the key
> safe; secrets are AES-256-GCM sealed on disk (or in Postgres).
>
> **Least-privilege agent tokens instead of the master API key:**
>
> ```powershell
> $env:PF_GATEWAY_TOKEN_SECRET = (npm run -s dev -w @protocolfoundry/cli -- keygen)
> npm run dev -w @protocolfoundry/cli -- token issue --server myapp --scopes read --days 30
> ```
>
> Give that `pft_...` token to the agent as its Bearer credential: it can call
> read tools but gets "Insufficient scope" on write/destructive ones
> (scopes are assigned per tool from the operation's effect).

## 5. Point an agent at it

**Claude Code:**

```powershell
claude mcp add --transport http myapp http://localhost:3001/mcp/myapp --header "Authorization: Bearer <your gateway key>"
```

Open a new Claude Code session and ask it to do something real
("list my open orders and create a test order").

**MCP Inspector (visual):**

```powershell
npx @modelcontextprotocol/inspector
# Streamable HTTP -> http://localhost:3001/mcp/myapp
# header: Authorization: Bearer <your gateway key>
```

**Quick scriptable check (no LLM):**

```powershell
npx tsx scripts/mcp-call.ts http://localhost:3001/mcp/myapp <gateway-key> list
npx tsx scripts/mcp-call.ts http://localhost:3001/mcp/myapp <gateway-key> call list_orders
```

Every call lands in `audit.log.jsonl` (override with `$env:PF_AUDIT_LOG`).

## 6. Score it (eval) — needs ANTHROPIC_API_KEY

Write a small task suite describing what an agent should be able to do
(copy `examples/taskboard/eval-suite.json` as a template — success patterns
should describe **outcomes**, not exact wording), then:

```powershell
npm run dev -w @protocolfoundry/cli -- eval suite.json --endpoint http://localhost:3001/mcp/myapp --key <gateway-key> -o run.json --report report.md
```

You get task completion %, tool-selection accuracy, steps, and token cost per
task. This is the number that gates releases.

## 7. Release it properly (versioned, gated, roll-backable)

```powershell
# create: blocked unless the eval meets the bar (default 80%/80%)
npm run dev -w @protocolfoundry/cli -- release create manifest.json --eval run.json --dir releases
# overriding a failing gate requires attribution:
#   ... --force --approved-by you

npm run dev -w @protocolfoundry/cli -- release promote myapp 1 --dir releases
```

Then run the gateway in release mode instead of step 4's static mode:

```powershell
$env:PF_RELEASES_DIR = "releases"   # (instead of PF_MANIFEST_PATH)
npm run dev -w @protocolfoundry/gateway
```

From now on, `pf release promote` / `pf release rollback myapp` change what's
served **without restarting the gateway**. Ship v2 confidently; roll back in
one command if agents misbehave.

> **Postgres instead of files (optional):** set `$env:PF_DATABASE_URL` to any
> Postgres connection string (Neon, Supabase, local, Docker) and every command
> above — plus the gateway and dashboard — uses Postgres instead of the
> `releases/` directory, **including audit events** (an `audit_events` table
> replaces the JSONL file). Schemas are created automatically. Per-command
> override: `pf release ... --db <url>`.

## 8. Watch it in the dashboard

```powershell
$env:PF_RELEASES_DIR        = "releases"
$env:PF_AUDIT_LOG           = "audit.log.jsonl"
$env:PF_DASHBOARD_PASSWORD  = "<pick an operator password>"   # omit = open mode (banner)
npm run dev -w @protocolfoundry/web
# -> http://localhost:3100 (log in with the password)
```

Projects, release timelines with eval gauges, the exact tool surface agents
see, full eval reports, and the audit log with approval-gate events.

> **Prefer clicking to typing?** The dashboard's **Forge** page covers steps
> 1–3 in the browser: upload the spec (or paste its URL), review/check the
> operations, optionally run LLM curation and approve its proposals item by
> item, and stage the release — then promote it from the project page.
> Step 6 too: upload the eval suite on the project page and hit **Run eval**
> on a staged release — the run executes in the background (live progress on
> the page) and its scores attach to the release before you promote.
> Requires `PF_DASHBOARD_PASSWORD` (writes are disabled in open mode) and,
> for the curation/eval buttons, `ANTHROPIC_API_KEY` on the dashboard server.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Unsupported OpenAPI version` | Spec is Swagger 2.0 — convert to OpenAPI 3 (e.g. `npx swagger2openapi spec.json`) |
| `No upstream base URL known` | Spec lacks `servers:` — pass `--base-url https://app.example.com` to generate/apply |
| Tool fails: `Credential "env:PF_CRED_X" is not configured` | Set that env var in the gateway's shell before starting it |
| 401 from the MCP endpoint | Agent isn't sending `Authorization: Bearer <PF_GATEWAY_API_KEY>` |
| Tool returns `requires per-call human approval` | Working as intended (destructive op); set `PF_APPROVE_ALL=true` only if you mean it |
| Upstream 4xx/5xx in tool results | The gateway surfaces upstream errors verbatim — test the API directly with the same credentials |
| `BLOCKED: Eval gate failed` on release create | That's the product working; improve the manifest or override attributably with `--force --approved-by <you>` |
| Gateway port busy | `$env:PF_PORT = "3002"` |

## Current limitations (roadmap items)

- Spec-first only: no UI crawling/HAR ingestion yet (Phase 4).
- Upstream auth: apiKey / bearer / basic. OAuth upstream flows and the real
  credential vault are Phase 3 work (env vars stand in for the vault today).
- Agent-side auth is a static gateway key; OAuth 2.1 per the MCP spec is
  planned.
- Local hosting only — managed cloud hosting is the eventual product.
