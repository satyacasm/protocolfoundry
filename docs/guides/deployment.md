# Deployment — Render (ADR-0009)

Both deployables — the **gateway** (`apps/gateway`, MCP sessions / SSE) and
the **dashboard** (`apps/web`, in-process eval jobs) — run as long-lived Node
services on [Render](https://render.com), declared as a blueprint at the repo
root.

## Current mode: FREE test (`render.yaml`)

The active blueprint is 100% free tier — no payment info needed:

| Service                  | Branch | Plan | Database                                  |
| ------------------------ | ------ | ---- | ----------------------------------------- |
| `protocolfoundry-gateway`  | `main` | free | `protocolfoundry-db` (free, expires 30 d) |
| `protocolfoundry-web`      | `main` | free | `protocolfoundry-db`                      |

**Every push to `main` deploys both services.** Setup:

1. Render dashboard → **New → Blueprint** → `satyacasm/protocolfoundry`,
   branch `main`.
2. Fill the prompted secrets (all live in the shared `pf-shared` env group or
   on the web service — see the table below):
   - **`PF_VAULT_KEY`** — `openssl rand -base64 32` (or `pf keygen`). **Required
     for credential onboarding.** Without it the dashboard shows _"Vault
     unavailable"_, the **Connect** form on every project is disabled, and no
     upstream credential can be attached — so evals against any authenticated
     API fail (every tool call is unauthenticated). Don't skip it.
   - **`PF_DASHBOARD_PASSWORD`** — your operator login (omit ⇒ open mode, writes
     disabled).
   - **`ANTHROPIC_API_KEY`** — a **real** key to run curation or evals. A
     placeholder only works if you never click those buttons; the eval/curate
     calls fail at runtime with an auth error otherwise.
3. Done. Gateway health: `GET /healthz`; dashboard: log in at `/login`.

Free-tier caveats: services sleep after ~15 min idle (first hit is slow);
the free Postgres expires after 30 days (recreate or upgrade); no disk, so
in-flight Forge work resets on deploy (promoted releases are safe in
Postgres).

### Required env vars at a glance

| Var | Where | Set by | Purpose |
| --- | --- | --- | --- |
| `PF_VAULT_KEY` | `pf-shared` group (gateway + web) | you (`sync:false`) | seal/decrypt upstream credentials — **same value on both services** |
| `PF_DASHBOARD_PASSWORD` | web | you (`sync:false`) | operator login |
| `ANTHROPIC_API_KEY` | web | you (`sync:false`) | curation + eval agent models (real key) |
| `PF_GATEWAY_TOKEN_SECRET` | `pf-shared` group | Render (auto) | mint/verify agent tokens |
| `PF_DASHBOARD_SECRET` | web | Render (auto) | dashboard session cookie |
| `PF_DATABASE_URL` | both | Render (from DB) | release store + vault rows |

### Connecting credentials & running evals (ADR-0011)

Once `PF_VAULT_KEY` is set on both services:

1. Open a project → **Credentials** panel → paste the upstream token. It's
   sealed straight into the vault and picked up by the gateway immediately —
   **no restart, no redeploy**. Secrets never enter manifests, logs, or prompts.
2. Upload (or **Generate**) an eval suite for the project.
3. Hit **Run eval** / **Re-run eval** with the model picker. The eval form now
   appears on **live** releases too (not only staged), so a promoted server can
   be re-graded — e.g. after connecting a credential or trying a stronger model.

If an eval scores near zero against an authenticated API, the credential almost
certainly isn't connected (check the Credentials panel reads _"connected"_, and
that `PF_VAULT_KEY` is set).

## Full mode: dev + prod (`render.paid.yaml`, requires payment info)

When ready, copy `render.paid.yaml` over `render.yaml` and sync the
blueprint. That restores the two-environment layout:

| Service                      | Branch | Plan    | Database                  |
| ---------------------------- | ------ | ------- | ------------------------- |
| `protocolfoundry-gateway-dev`  | `dev`  | free    | `protocolfoundry-db-dev` (free, expires in 30 days) |
| `protocolfoundry-web-dev`      | `dev`  | free    | `protocolfoundry-db-dev`  |
| `protocolfoundry-gateway-prod` | `prod` | starter | `protocolfoundry-db-prod` (basic-256mb) |
| `protocolfoundry-web-prod`     | `prod` | starter + 1 GB disk | `protocolfoundry-db-prod` |

**Every push to `dev` deploys the dev pair; every push to `prod` deploys the
prod pair.** No GitHub secrets or deploy workflows are needed — Render watches
the branches directly (`autoDeploy: true`). GitHub Actions (`.github/workflows/ci.yml`)
runs typecheck + tests + builds on those branches.

### One-time setup (full mode)

1. **Render account** with the GitHub repo authorized (prod plans require
   payment info: 2× starter services ≈ $7/mo each, basic-256mb Postgres ≈ $6/mo).
2. Copy `render.paid.yaml` → `render.yaml`, commit, push. In the Render
   dashboard: **New → Blueprint** (or re-sync the existing one) from `main`.
   Render provisions all six resources (4 services + 2 databases).
3. Fill in the `sync: false` secrets when prompted (or later under each
   service / env group → Environment):
   - `PF_VAULT_KEY` (env groups `pf-shared-dev` and `pf-shared-prod`) —
     32-byte base64, one **per environment**, generate with `pf keygen` or
     `openssl rand -base64 32`. The same key must serve web (encrypt) and
     gateway (decrypt) in one env — the env group guarantees that. **Never
     reuse the dev key in prod.** Losing it orphans all vaulted credentials
     (ADR-0007).
   - `PF_DASHBOARD_PASSWORD` (each web service) — dashboard login.
   - `ANTHROPIC_API_KEY` (each web service) — curation + eval agent models.
4. On each of the four services, set **Settings → Auto-Deploy → "After CI
   Checks Pass"** so a red GitHub Actions run blocks the deploy.

`PF_GATEWAY_TOKEN_SECRET` and `PF_DASHBOARD_SECRET` are auto-generated by
Render (`generateValue`); nothing to do.

## Branch flow

```
feature branch ──PR──▶ dev ──(auto-deploy dev)──▶ verify on dev URLs
                        │
                        └──PR──▶ prod ──(auto-deploy prod)
```

- Day-to-day work merges into **`dev`**; the dev environment is the always-on
  integration target.
- Promotion to production is a PR from `dev` → `prod` (fast-forward content,
  reviewed). Merging deploys prod.
- `main` remains the default branch for history/PRs; keep `dev` in sync with
  it. Never commit directly to `prod`.

## What lives where (per environment)

- **Postgres** (`PF_DATABASE_URL`): release store + encrypted credential
  vault rows. Dev and prod are fully separate databases — no shared state.
- **Disk** (prod web only, `/var/data`): the Forge workspace
  (`PF_WORKSPACE_DIR`) — pre-release project files, eval suites, job records.
  Dev uses the ephemeral filesystem (a redeploy clears in-flight forge work;
  acceptable for dev).
- Rollbacks: Render keeps previous deploys — "Rollback" in the service
  dashboard, or revert the commit on the branch.

## Verifying a deploy

- Gateway: `GET https://<gateway-host>/healthz` → `{ ok: true, servers: [...] }`
  (this is also Render's health check; a failing instance never receives traffic).
- Dashboard: log in at `https://<web-host>/login` with `PF_DASHBOARD_PASSWORD`.

## Constraints that shaped this (don't undo casually)

- **No serverless / no Vercel** for either app: the gateway holds SSE/MCP
  sessions and `apps/web` runs eval jobs after the response returns
  (ADR-0008, docs/03-architecture.md).
- Secrets exist only in Render env vars — never in `render.yaml`, git, or
  manifests (docs/05-security-model.md).
