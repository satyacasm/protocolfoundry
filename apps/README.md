# apps/

Deployable applications (see docs/04-roadmap.md):

- `gateway/` — multi-tenant MCP runtime interpreting manifests (Phase 1, live).
  Env: `PF_DATABASE_URL` or `PF_RELEASES_DIR` (serve live releases;
  promote/rollback apply without restart) or `PF_MANIFEST_PATH` (dev: static
  file or dir), `PF_PORT`, `PF_GATEWAY_API_KEY` (static full-access key),
  `PF_GATEWAY_TOKEN_SECRET` (verify scoped `pft_` tokens from `pf token
  issue`), `PF_AUTH_SERVER_URL` (advertised in RFC 9728 metadata),
  `PF_VAULT_KEY`/`PF_VAULT_PATH` (encrypted credential vault; `env:` bindings
  fall back to it), `PF_AUDIT_LOG`, `PF_APPROVE_ALL`, plus `PF_CRED_*` env
  credentials when not using the vault.
- `cli/` — `pf ingest <openapi> --project <id>` and `pf generate <graph>`
  (Phase 1, live). Run via `npm run dev -w @protocolfoundry/cli -- <args>`.
- `web/` — Next.js control-plane dashboard (Phase 3, read-only v1).
  `npm run dev -w @protocolfoundry/web` → http://localhost:3100.
  Env: `PF_DATABASE_URL` (Postgres) or `PF_RELEASES_DIR` (file store),
  `PF_AUDIT_LOG` (gateway audit file), `PF_DASHBOARD_PASSWORD` (operator
  login; open mode with a banner when unset), optional `PF_DASHBOARD_SECRET`
  (cookie signing key, defaults to the password), `PF_WORKSPACE_DIR` (forge
  artifacts: ingested graphs + curation proposals, default `workspace/`),
  `ANTHROPIC_API_KEY` (enables the Run LLM curation button).
