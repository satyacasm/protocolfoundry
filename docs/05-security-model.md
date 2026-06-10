# Security & Trust Model

Security is the adoption blocker for this product, so it is a feature, not a
checkbox. Buyers must be able to answer: *what can this server do, with whose
credentials, who approved it, and what did agents actually do?*

## Principles

1. **Explicit authorization only.** We integrate with applications the customer
   owns or is authorized to access. Credentials are connected deliberately by the
   customer (OAuth grants, API keys, service accounts) — never scraped, phished,
   or harvested from sessions. No circumvention of anti-bot measures or ToS.
2. **Least privilege by construction.** Each tool in a manifest declares the
   minimal upstream scopes it needs; the gateway enforces them. Unselected
   capabilities don't exist in the manifest at all.
3. **Nothing ships without human approval.** Manifest changes require explicit
   customer review. Destructive operations (deletes, payments, sends) can require
   per-call approval gates at runtime.
4. **Everything is auditable.** Every tool invocation (caller, tool, arguments
   hash, upstream calls, result status) and every control-plane mutation produces
   an immutable AuditEvent.

## Threat model (initial)

| Threat | Mitigation |
|---|---|
| Credential theft from platform | Vault with KMS envelope encryption; credentials never enter LLM prompts or logs; data-plane fetches decrypt just-in-time, in-memory only |
| Prompt injection via upstream API responses | Response data is treated as untrusted content; tool results are schema-validated and size-capped; no tool result is ever interpreted as instructions by the gateway |
| Over-broad agent access | OAuth 2.1 with per-client scopes mapped to per-tool permissions; short-lived tokens |
| Confused-deputy / tenant crossing | Manifest + credentials resolved strictly by tenant; no shared upstream clients; per-tenant rate limits |
| Malicious/compromised customer input (specs, HAR files) | Ingestors parse untrusted input in isolated workers; no code execution from sources; HAR import strips cookies/tokens by default |
| Destructive agent actions | Approval gates, dry-run mode, per-tool rate limits, instant release rollback |
| Generated server drift from upstream | Drift detection diffs re-ingested specs; breaking changes block releases until re-reviewed |

## Compliance posture (later, but design for it now)

- Audit-log immutability and export (SIEM-friendly)
- Data residency option via regional data planes
- SOC 2 readiness: access controls, change management (releases are the change
  log), vendor inventory
- Customer data minimization: we store schemas and metadata, not customers'
  customer-data; payload logging is opt-in and redacted by default
