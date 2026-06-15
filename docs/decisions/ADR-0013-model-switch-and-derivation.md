# ADR-0013: Global model switch + LLM connector derivation in curation

Status: Accepted (2026-06-15)

## Context

Every LLM boundary pinned its own model default (discovery defaulted to opus,
curation to haiku, the web forge to whatever the factory chose), so there was no
single global control. Separately, SP1's ConnectorConfig had to be hand-authored.

## Decision

1. One global default: `resolveGlobalModel(explicit?, boundary?)` in core with
   precedence explicit > `PF_ANTHROPIC_MODEL_<BOUNDARY>` > `PF_ANTHROPIC_MODEL` >
   haiku. Every `createAnthropic*` factory falls back to it; per-call overrides
   (CLI `--model`, eval form) still win. The dashboard shows the active model
   read-only; a writable picker is deferred to SP3.
2. A separate `ConnectorDeriver` LLM boundary derives best-effort ConnectorConfigs
   from the graph's auth requirements + base URLs during the curation pass.
   Output is validated against ConnectorConfig (invalid dropped, never shipped)
   and folded into the existing CurationProposal, applied by applyCuration —
   reusing the human-approve-before-apply gate (ADR-0004). No new approval surface.
3. The OpenAPI ingestor now preserves OAuth flow URLs / OIDC issuer in
   AuthRequirement.detail so derivation has real signal.

## Consequences

- Operators switch models in one place (`PF_ANTHROPIC_MODEL`); default is haiku,
  including for doc extraction — raise it per-boundary (`PF_ANTHROPIC_MODEL_DISCOVERY`).
- Most OAuth/OIDC providers get an auto-derived config the operator just approves;
  non-OAuth credentials keep the manual paste flow (ADR-0011).
- SP3 adds the connect-time surfaces (popup, `pf connect`, gateway re-auth deep-link),
  a writable model picker, and richer dashboard review of derived configs.
