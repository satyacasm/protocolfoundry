# ADR-0009: Render blueprint deployment with dev/prod branch environments

- **Status:** accepted
- **Date:** 2026-06-11

## Context

Phase-1 deployables exist (`apps/gateway`, `apps/web`) but the project had no
hosting story: no environments, no CI, and deploys would have meant hand-run
commands. The architecture doc already constrains the options: both apps need
**long-lived Node hosts** — the gateway holds MCP sessions and SSE streams,
and the dashboard runs in-process eval jobs that outlive the HTTP response
(ADR-0008) — so serverless platforms (Vercel, Lambda) are out. The release
store speaks standard Postgres via `pg` (ADR-0006), and per-environment
secrets (`PF_VAULT_KEY`, `PF_GATEWAY_TOKEN_SECRET`) must be shared between
the gateway and web within an environment but never across environments
(ADR-0007).

We want push-to-deploy: every push to an environment's branch ships that
environment, with two isolated environments (dev, prod).

## Decision

1. **Render** hosts everything, declared in a single root `render.yaml`
   blueprint: 4 web services (gateway + web, × dev/prod) and 2 Postgres
   databases. Native Node runtime (`npm ci && npm run build`), no Docker —
   the monorepo builds in one tree and each service starts its own
   entrypoint. This honors ADR-0003: one shared manifest-interpreting
   gateway per environment, no per-customer codegen or per-customer infra.
2. **Branch = environment.** New long-lived branches `dev` and `prod`; each
   Render service pins its `branch`, with `autoDeploy: true`. Pushing `dev`
   deploys the dev pair; pushing `prod` deploys the prod pair. Promotion is
   a PR `dev → prod`. `main` stays the default branch for history.
3. **CI in GitHub Actions** (`.github/workflows/ci.yml`): typecheck, full
   test suite, and both builds on pushes/PRs to `main`/`dev`/`prod`. Render
   services should be set to "Auto-Deploy: After CI Checks Pass" so red
   builds never ship. No deploy credentials live in GitHub — Render pulls
   the repo itself.
4. **Secrets** live only in Render env vars. Per-environment env groups
   (`pf-shared-dev`, `pf-shared-prod`) hold the values that gateway and web
   must agree on (`PF_VAULT_KEY`, `PF_GATEWAY_TOKEN_SECRET`). `PF_VAULT_KEY`
   is operator-supplied (`sync: false`) because it must decode to exactly
   32 bytes; HMAC-style secrets use Render `generateValue`.
5. **State:** each environment gets its own Postgres (release store + vault
   rows). Prod web gets a 1 GB persistent disk for the Forge workspace
   (`PF_WORKSPACE_DIR=/var/data/workspace`); dev workspace is ephemeral.

## Consequences

- Push-to-deploy with zero deploy secrets in GitHub; the blueprint is the
  reviewable source of truth for infra.
- Dev and prod are fully isolated (DBs, vault keys, tokens) — a leaked dev
  key exposes nothing in prod.
- Render lock-in is shallow: both apps are plain `node`/`next start`
  processes; moving to Fly/containers later means rewriting `render.yaml`
  into Dockerfiles, nothing in `src/`.
- Costs: dev tier is free (free Postgres expires after 30 days and must be
  recreated); prod ≈ $20/mo (2× starter + basic-256mb).
- Free-tier dev services spin down when idle — first request after idle is
  slow; fine for an integration environment.
- A real job queue (multi-tenancy phase) will need a worker service added to
  the blueprint; the disk-backed workspace moves to the DB then.
