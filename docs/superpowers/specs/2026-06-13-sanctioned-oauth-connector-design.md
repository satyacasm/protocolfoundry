# Sanctioned-OAuth Connector Engine — Design Spec

- **Date:** 2026-06-13
- **Status:** Draft for review
- **Related:** ADR-0002 (authorized-only/sanctioned), ADR-0003 (manifest-interpreted,
  no codegen), ADR-0007 (scoped tokens + vault), ADR-0010 (docs-page LLM ingestion),
  ADR-0011 (credential onboarding — this extends it). New ADR-0012 to be written
  alongside SP1.

## Problem

Today the credential-vault step (ADR-0011) is good at *telling* a user how to get a
token, but the user still has to **leave the product, hunt for the credential, and
paste it back** — and for some providers the hunt is brutal (Kite Connect's
request-token → checksum → access-token dance, daily-rotating access token). We want
to collapse that to "sign in on the provider's own page, we capture the token via the
provider's sanctioned callback," for as many providers as possible **without writing
per-provider code**.

## Hard boundaries (non-negotiable, set during brainstorming)

These were each explicitly decided and one was decided *against*:

1. **Sanctioned flows only.** We capture only what the provider *deliberately redirects
   to our registered callback* (an OAuth `code` / Kite `request_token`). We do **not**
   drive crawlers through logins to sniff requests/responses/headers and lift tokens.
   That is session harvesting — forbidden by the security model (principle 1) and
   ADR-0002, and was explicitly rejected during design.
2. **No per-customer codegen, no executable plugins.** We evaluated LLM-generated
   executable plugins (would have required superseding ADR-0003 + a sandbox + an RCE
   surface) and **rejected it**. Connectors are **declarative data** interpreted by a
   single shared engine, consistent with ADR-0003.
3. **Secrets never enter manifests, prompts, or logs.** Config carries *references and
   instructions only*; secrets go straight to the vault (ADR-0007). The engine reads
   app-level secrets from the vault at exchange time, in memory only.
4. **Nothing ships without human approval.** LLM-derived connector config is reviewed
   by a human before a release can use it (same gate as curation, ADR-0004/0011).

## Architecture & core invariant

A single shared, shipped **connector engine** runs the OAuth2/OIDC authorization-code
flow (PKCE where supported):

- **Standards-compliant providers need no per-API tailoring** — the engine resolves
  authorize/token endpoints from the provider's `.well-known/openid-configuration`
  (**OIDC discovery**).
- **The residue** (non-discoverable, or non-standard handshakes like Kite) is covered by
  a small **declarative config blob** — data, not code.

**Invariant:** a connector's *only* output is `SealedSecret[]` — `{ vaultRowId, secret }`
— sealed into the **same vault row the gateway already resolves** (`vault:<id>` /
`env:NAME` fallback). The gateway's credential-resolution path does **not change**.
Connectors are purely a new *way to fill* an existing vault row.

## Components

### 1. `packages/connectors` (new)

Depends on `core` only. Pure orchestration with **injected I/O** (an injected `fetch`,
no direct vault/browser/`process.env` access) so it is unit-testable with scripted fakes
and **no API key** — matching the `evals`/`discovery` convention.

- **Engine**: given a resolved connector config + app-creds + a redirect URI, produces
  the provider login URL (with CSRF/PKCE `state`), and `exchange(callbackParams)` →
  `SealedSecret[]`.
- **OIDC discovery**: fetch `<issuer>/.well-known/openid-configuration`, cache, derive
  `authorization_endpoint` / `token_endpoint` / PKCE support.
- **Exchange transform vocabulary** (fixed, safe — *not* arbitrary code): `sha256`,
  `concat`, and "place cred X in header | query | body". Sufficient for Kite's
  `checksum = SHA256(api_key + request_token + api_secret)` → `POST /session/token`.
  No `eval`, no dynamic dispatch beyond this enumerated set.

### 2. Connector config schema (in `packages/core`)

Carried in the manifest like `credentialGuides`, keyed by `authRequirementId`, parses to
`{}` for old manifests (back-compat). Shape (zod):

```
connector?: {
  id: string;                       // "oauth2-generic" | provider slug for residue
  discovery?: { issuer: string };   // OR explicit endpoints below
  authorizeUrl?: string;
  tokenUrl?: string;
  appCredentials: { id: string; label: string; valueFormat: string }[];
  params: {
    scopes?: string[];
    pkce?: boolean;
    callbackParam: string;          // "code" | "request_token"
    grantType?: string;
  };
  exchange?: ExchangeStep[];        // only for non-standard residue (Kite)
  produces: { vaultRowId: string; from: string }[];
  rotation?: string;                // "Access token expires daily ~6am IST"
}
```

Secrets are **never** in this object — `appCredentials` are labels/formats; values live
in vault rows the operator fills once.

### 3. LLM config derivation + global model switch (`packages/discovery` + `core`)

- **Derivation (optional)**: an ingestion step derives the declarative config from the
  spec/doc when discovery alone is insufficient. Behind an interface, scripted fakes in
  tests (like ADR-0010). Emits **data**, **human-reviewed before release**.
- **Global model switch**: every LLM boundary (docs extraction, curation, evals,
  derivation) reads **one global setting** — env `PF_ANTHROPIC_MODEL` plus a
  dashboard/CLI control — **default `haiku`** (`DEFAULT_CLAUDE_MODEL` already = haiku),
  with optional per-boundary override. Reuses `resolveClaudeModel` (`packages/core`).
  Fixes current per-call-site pins (e.g. `packages/discovery/src/docs.ts:398` defaulting
  to opus). Note: curation/eval quality historically used a stronger model — the override
  path preserves that for operators who want it; the *default* is haiku per product call.

### 4. Connect & rotation surfaces

- **Dashboard (`apps/web`)**: Credentials panel gains (a) app-credential slots the
  operator pastes once → vault; (b) a "Connect with …" button opening the provider login
  (popup); (c) a callback route that validates `state`, runs `engine.exchange`, seals the
  result, audits `credentialConnected`; (d) a "reconnect needed / expires daily" badge
  driven by `rotation`.
- **CLI (`apps/cli`)**: `pf connect <project|manifest> [binding]` opens the browser, a
  **localhost loopback** catches the redirect, the engine exchanges using vault app-creds
  + `PF_VAULT_KEY`, seals locally. (Browser-open + loopback injected for tests.)
- **Gateway (`apps/gateway`)**: the missing/expired-credential teaching error (ADR-0011)
  is extended to detect upstream 401/expiry, name the connector + rotation, and deep-link
  a **one-click re-auth** (same flow; app-creds already in vault).

### 5. "Request unsupported API" intake (`apps/web`)

When discovery + derivation can't produce a usable config (or the operator hits a gap), a
dashboard button opens an **overlay form** to submit the spec/doc + a note to the
developers. Persisted as `AuditEvent` (`connectorRequestSubmitted`) + a small store row
the team can list. No email infra in v1.

## Redirect-URL registration (operational note)

Sanctioned flows require a redirect URL **registered with the provider**:

- Dashboard: a stable HTTPS callback (one per deployment), documented per connector via
  `redirectUrlHint`.
- CLI: a fixed localhost port the connector declares; operator registers
  `http://127.0.0.1:<port>` in the provider console. Providers that forbid localhost
  redirects fall back to the dashboard flow.

## Data flow (connect)

1. Operator registers the app in the provider console → gets app-level creds → pastes
   once into the connector's `appCredentials` slots → sealed to vault.
2. Operator/CLI triggers connect → engine builds login URL (discovery or explicit
   endpoints) → user signs in **on the provider's page**.
3. Provider redirects to our registered callback with `callbackParam` (+ our `state`).
4. Callback validates `state`, loads app-creds from vault, `engine.exchange` runs
   (standard token POST, or the declarative `exchange` steps for Kite) → token(s).
5. Token(s) sealed into the binding's vault row(s). Audit `credentialConnected`.
6. Gateway resolves the binding from vault exactly as before — **zero gateway change**.

Rotation = repeat 2–5; app-creds already present, so it is genuinely one click.

## Testing

- Connector engine + exchange vocabulary + discovery: unit tests with scripted fake
  `fetch`, **no API key** (incl. a Kite-shaped checksum exchange fixture).
- Config schema: round-trip + back-compat (old manifest parses to `{}`).
- LLM derivation: scripted-fake model, no API key.
- Web callback + CLI loopback: injected browser-open + HTTP; assert seal + audit, and
  that `state` mismatch is rejected.
- Global model switch: env + override resolution, default = haiku.

## Decomposition / build order

Each sub-project gets its own spec → plan → implementation cycle.

- **SP1 — Generic engine core**: `packages/connectors` (engine, OIDC discovery, exchange
  vocabulary), connector config schema in `core`, **ADR-0012**. *First; everything
  depends on it.*
- **SP2 — Derivation + global model switch**: LLM config derivation in `discovery`;
  global `PF_ANTHROPIC_MODEL` wiring across all LLM boundaries + dashboard/CLI control.
- **SP3 — Connect & rotation surfaces**: web callback/buttons/badge, `pf connect`,
  gateway expired-credential teaching error.
- **SP4 — Request-unsupported-API intake**: dashboard button + overlay form + persistence.

## Out of scope (v1)

- Public, unauthenticated customer self-service connect page (still deferred per ADR-0011;
  connect is operator-in-dashboard + CLI).
- Per-caller credentials (one credential set per server still holds — ADR-0011).
- Sandboxed executable connector plugins (evaluated, rejected; revisit only via a
  superseding ADR if a real provider proves inexpressible declaratively).
- Headless/scripted re-login (would require interactive sign-in automation — forbidden).
- Email/Slack notification for connector requests (audit + store row only in v1).
