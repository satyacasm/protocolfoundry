# apps/

Deployable applications (see docs/04-roadmap.md):

- `gateway/` — multi-tenant MCP runtime interpreting manifests (Phase 1, live).
  Env: `PF_MANIFEST_PATH` (file or dir), `PF_PORT`, `PF_GATEWAY_API_KEY`
  (inbound agent auth), `PF_AUDIT_LOG`, `PF_APPROVE_ALL`, plus `PF_CRED_*`
  upstream credentials named by the manifest's credentialBindings.
- `cli/` — `pf ingest <openapi> --project <id>` and `pf generate <graph>`
  (Phase 1, live). Run via `npm run dev -w @protocolfoundry/cli -- <args>`.
- `web/` — Next.js dashboard / control plane (Phase 3, not started).
