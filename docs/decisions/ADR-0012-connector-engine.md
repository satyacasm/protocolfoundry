# ADR-0012: Sanctioned-OAuth connector engine (data-driven, no codegen)

Status: Accepted (2026-06-13)

## Context

ADR-0011 made operators paste upstream credentials by hand. The biggest
friction is providers whose token acquisition is a multi-step dance (Kite
Connect: request_token -> SHA256 checksum -> access_token, rotating daily).
We want "sign in on the provider's own page, we capture the token" for as
many providers as possible without per-provider code.

## Decision

1. A single shared, data-driven **connector engine**
   (`@protocolfoundry/connectors`) runs the OAuth2/OIDC authorization-code
   flow. Standards-compliant providers need no tailoring — endpoints come
   from OIDC `.well-known/openid-configuration` discovery. The residue
   (non-standard handshakes) is expressed by a **declarative ConnectorConfig**
   (`packages/core`) with a fixed, safe transform vocabulary (`sha256`,
   `concat`) — enough for Kite's checksum, never arbitrary code.
2. We **capture only sanctioned redirect handoffs** — the params a provider
   deliberately redirects to our registered callback. No crawler/traffic
   interception (ADR-0002, security model principle 1).
3. We **evaluated and rejected** LLM-generated executable plugins: they would
   break ADR-0003 (per-customer codegen) and add an RCE surface. ConnectorConfig
   is data interpreted by the shared engine, so ADR-0003 holds.
4. The engine's only output is `SealedSecret[]` sealed into the **same vault
   rows the gateway already resolves** (ADR-0007) — gateway resolution is
   unchanged. Secrets never enter the config, prompts, or logs.

## Consequences

- A large slice of modern APIs connect with zero per-provider code; non-standard
  ones need a small, human-reviewed config blob (nothing ships without approval).
- "Sanctioned-only" means each provider still requires its own app registration
  (client id/secret or api_key/secret) — irreducible if we stay in-bounds.
- SP1 ships the engine + schema only. Connect/rotation surfaces (dashboard popup,
  `pf connect`, gateway expired-credential deep-link), LLM config derivation, the
  global model switch, and unsupported-API intake follow in SP2–SP4.
