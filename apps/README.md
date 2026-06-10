# apps/

Deployable applications (see docs/04-roadmap.md):

- `gateway/` — multi-tenant MCP runtime interpreting manifests (Phase 1, live).
  Env: `PF_RELEASES_DIR` (serve live releases; promote/rollback apply without
  restart) or `PF_MANIFEST_PATH` (dev: static file or dir), `PF_PORT`,
  `PF_GATEWAY_API_KEY` (inbound agent auth), `PF_AUDIT_LOG`, `PF_APPROVE_ALL`,
  plus `PF_CRED_*` upstream credentials named by the manifest's
  credentialBindings.
- `cli/` — `pf ingest <openapi> --project <id>` and `pf generate <graph>`
  (Phase 1, live). Run via `npm run dev -w @protocolfoundry/cli -- <args>`.
- `web/` — Next.js control-plane dashboard (Phase 3, read-only v1).
  `npm run dev -w @protocolfoundry/web` → http://localhost:3100.
  Env: `PF_DATABASE_URL` (Postgres) or `PF_RELEASES_DIR` (file store),
  `PF_AUDIT_LOG` (gateway audit file), `PF_DASHBOARD_PASSWORD` (operator
  login; open mode with a banner when unset), optional `PF_DASHBOARD_SECRET`
  (cookie signing key, defaults to the password).
