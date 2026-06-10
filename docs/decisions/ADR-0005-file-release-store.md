# ADR-0005: File-based release store first; Postgres at the dashboard milestone

- **Status:** accepted
- **Date:** 2026-06-10

## Context

ADR-0003 made releases the unit of deployment (immutable manifest + status
pointer) and ADR-0004 deferred the store. Phase 3 needs releases real:
eval-gated creation, promote, instant rollback, and the gateway serving live
releases. The obvious implementation is Postgres — but provisioning a database
now adds accounts, credentials, and hosting decisions before any customer-facing
need, and the dashboard (the first real multi-user consumer) doesn't exist yet.

## Decision

1. **`packages/releases` ships a `FileReleaseStore`** —
   `releases/<projectId>/` holding write-once `v<N>.manifest.json` (+
   `v<N>.evalrun.json`) and a mutable `index.json` of release records.
   Promote/rollback rewrite only the index: rollback is a pointer swap.
2. **Eval gating is enforced at creation:** a release with a gate requires a
   passing eval run; overrides require `force` **and** `approvedBy`
   (gate bypasses must be attributable).
3. **The gateway consumes a `ManifestSource` interface** — static list (dev)
   or `releaseManifestSource` (live releases, index-mtime cache with a short
   TTL) so promote/rollback take effect without a restart.
4. **Postgres replaces the file store when the dashboard lands** (multi-user
   control plane, concurrent writers, audit queries). The store is behind an
   interface-shaped API, so the swap is additive: same semantics, new backend.

## Consequences

- Release semantics (immutability, gating, instant rollback) are testable and
  shippable today with zero infrastructure.
- Single-writer assumption: concurrent CLI invocations could race on
  `index.json`. Acceptable for one operator; the Postgres store removes it.
- The `ManifestSource` abstraction is also where per-tenant routing and
  white-label domains will plug in later.
