# ADR-0007: Scoped gateway tokens + encrypted credential vault

- **Status:** accepted
- **Date:** 2026-06-10

## Context

Two roadmap items remained on the gateway's trust story: "OAuth 2.1
authorization (MCP auth spec)" and "credential vault (KMS-encrypted)".
The MCP authorization spec casts the MCP server as an OAuth 2.1 *resource
server*; running a full *authorization server* (authorize/token endpoints,
PKCE, consent UI) is a product of its own and premature for a single-operator
platform.

## Decision

### Resource-server side now, authorization server later

1. **Scoped bearer tokens** (`pft_<payload>.<sig>`): HMAC-SHA256-signed,
   expiring, bound to one server name (or `*`), carrying scopes. Minted by
   the operator: `pf token issue --server <name> --scopes read,write`
   (secret: `PF_GATEWAY_TOKEN_SECRET`). The static `PF_GATEWAY_API_KEY`
   remains as full-access back-compat; with neither set the gateway stays
   open-dev-mode with a loud warning.
2. **Per-tool scope enforcement**: the generator now assigns
   `requiredScopes` by effect class — `read` → `read`, create/update/execute
   → `write`, delete → `destructive`; composed tools require the union of
   their steps' scopes. The gateway rejects tool calls whose token lacks a
   required scope (audited as `insufficient_scope`).
3. **Spec-shaped discovery**: 401s carry
   `WWW-Authenticate: Bearer resource_metadata="..."`, and
   `/.well-known/oauth-protected-resource/mcp/<server>` serves RFC 9728
   metadata (resource, `authorization_servers` via `PF_AUTH_SERVER_URL`,
   `scopes_supported` derived from the live manifest).
4. **Deliberately deferred**: authorization-code + PKCE flows. When needed
   (multi-tenant SaaS), an external AS (or the MCP SDK's proxy provider)
   plugs in ahead of the same scope-enforcement machinery; the metadata
   endpoint already advertises it.

### Credential vault

5. **`@protocolfoundry/vault`**: AES-256-GCM encrypted-at-rest secrets,
   master key from `PF_VAULT_KEY` (32-byte base64, `pf keygen`). File and
   Postgres backends under the standard env conventions. Secrets never
   appear in lists, logs, or manifests; decryption fails closed on a wrong
   key. Cloud-KMS key wrapping replaces the raw env key at managed hosting —
   the sealed format doesn't change.
6. **Resolution order keeps migrations free**: manifest `vault:<id>` refs hit
   the vault only; existing `env:<NAME>` refs resolve env-var first, then
   vault under the same name — moving a secret into the vault requires no
   manifest change. The credential resolver became async to support this.

## Consequences

- Customers can hand agents least-privilege credentials ("read-only token for
  the support bot") instead of one master key — per-tool scopes from the
  manifest finally do something.
- Upstream secrets are no longer plaintext in shell profiles; rotating
  `PF_VAULT_KEY` requires re-sealing (re-`pf vault set`) — documented
  limitation until KMS.
- The gateway is not yet a *complete* MCP-auth implementation (no dynamic
  client registration, no code flow) — clients using OAuth discovery will
  find metadata but must be provisioned tokens out-of-band for now.
