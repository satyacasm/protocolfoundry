# ADR-0006: Postgres release store + single-operator dashboard auth

- **Status:** accepted
- **Date:** 2026-06-10

## Context

ADR-0005 shipped the file release store with Postgres planned "at the dashboard
milestone". The dashboard now exists, and the roadmap's next items were the
Postgres control-plane store and dashboard auth. Two constraints shaped both:
no cloud accounts should be required to develop or test, and the product is
still single-operator (design partners come later).

## Decision

### Postgres store

1. **`PgReleaseStore`** implements the same `ReleaseStore` interface as the
   file store (interface + shared `assertReleaseGate` extracted to
   `types.ts`). One table, `releases`: the `manifest` jsonb column is written
   once and never updated; promote/rollback mutate only `status` inside a
   transaction — identical immutability semantics to the file layout.
2. **Backend selection is uniform** via `createReleaseStoreFromEnv()`:
   `PF_DATABASE_URL` → Postgres, else `PF_RELEASES_DIR`/default → file store.
   Gateway, CLI (`--db` flag), and dashboard all use it, so switching backends
   is an env-var change.
3. **Tests run on pg-mem** (in-memory Postgres) through a structural
   `PgPoolLike` type that fits both `pg.Pool` and the test adapter — CI needs
   no database. `changeStamp` is file-store-only; the manifest source falls
   back to TTL reloads on Postgres (2s default — still hot rollback).

### Dashboard auth

4. **Shared operator password → HMAC-signed expiring cookie.**
   `PF_DASHBOARD_PASSWORD` gates everything via Next middleware;
   `/api/login` exchanges the password (compared via HMAC, no
   short-circuit) for a 12h `pf_session` cookie signed with
   `PF_DASHBOARD_SECRET ?? PF_DASHBOARD_PASSWORD`. Web Crypto only, so the
   same code runs in the edge middleware and Node route handlers.
5. **No password set = open mode with a loud banner** — the same convention
   as the gateway's missing API key. Dev stays frictionless; production
   misconfiguration is visible on every page.
6. This is explicitly **single-operator placeholder auth**. Multi-user (SSO /
   Clerk, roles, per-tenant scoping) arrives with design-partner onboarding;
   the middleware boundary is where it will slot in.

## Consequences

- The same release semantics are now provable against both backends (24 tests).
- Concurrent-writer safety arrives with Postgres (transactions) — the file
  store's single-writer caveat from ADR-0005 is resolved for anyone who sets
  `PF_DATABASE_URL`.
- Audit events remain JSONL on the gateway; moving them into Postgres (and
  paginating the dashboard viewer from SQL) is follow-up work.
- Write paths in the dashboard (promote/rollback buttons, curation review)
  are now unblocked by auth, pending CSRF-safe form actions.
