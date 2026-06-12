# ADR-0011: Credential onboarding — vault-first connect flow with manifest-embedded setup guides

Status: Accepted (2026-06-12)

## Context

Hosted MCP servers need upstream credentials (Kite's daily access token,
Chargebee API keys, …), but the people who have those credentials are
customers, not platform operators with Render env access. Until now the only
paths were gateway env vars (requires a prod env change + restart per
credential, doesn't scale past one user) or `pf vault set` (requires
PF_VAULT_KEY in hand). There was also nowhere to tell a user *how* to obtain
a given credential — Kite's request-token → checksum → access-token dance is
genuinely hard to guess, and each SaaS has a different auth scheme (Basic,
apiKey header/query, Bearer, custom prefixes like `token key:secret`).

The credential resolver (gateway) already reads `env:NAME` refs as
process.env first, then vault row `NAME` — so a vault write is live
immediately with no restart and no manifest change.

## Decision

1. **Manifests carry setup instructions, never secrets**: optional
   `credentialGuides` map (keyed by authRequirementId) with `title`,
   `valueFormat`, ordered `steps`, optional `helpUrl`/`rotation`. Old
   manifests parse unchanged (defaults to `{}`).
2. **The dashboard project page gets a Credentials section**: one slot per
   credential binding showing connect status (vault row present), the guide
   (manifest-authored, else a generic per-auth-kind fallback), and a
   paste-to-connect form. Submitted values are sealed straight into the
   shared vault (`PF_VAULT_KEY` + Postgres, same key the gateway decrypts
   with — ADR-0007); audit records `credentialConnected`/`credentialRevoked`
   with the binding id only.
3. **The gateway's missing-credential error teaches the path**: it names the
   binding, the project, and the dashboard Credentials panel (plus the guide
   title when present), so an agent transcript tells the human exactly what
   to do.
4. **CLI parity**: `pf creds <manifest.json>` prints the bindings, guides,
   and both connect paths (dashboard or `pf vault set`).

## Consequences

- Users hand a credential to the operator (or an operator session) once;
  no prod env churn per user or per daily rotation. Env vars still override
  the vault, preserving existing deployments.
- Guides live in the manifest, so they version with releases and ship in
  connection bundles. Existing releases without guides degrade to generic
  per-kind instructions.
- Still one credential set per server: every caller of a hosted server
  shares the operator-connected upstream account. True per-caller
  credentials (binding a gateway token to its own vault namespace) is the
  natural next step and needs its own ADR.
- The dashboard connect form is operator-authenticated; a public
  self-service submission page (customers pasting their own keys without an
  operator session) is explicitly out of scope here.
