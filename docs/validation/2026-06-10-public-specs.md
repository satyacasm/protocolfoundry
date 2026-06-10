# Validation run: real public OpenAPI specs — 2026-06-10

Phase 1 roadmap item: validate the spec-to-server pipeline beyond the Taskboard
example. Two real public specs, one gateway instance hosting both.

## Swagger Petstore (`petstore3.swagger.io`, JSON, 19 operations)

- **Ingest:** all 19 operations extracted with correct effect classification,
  both security schemes detected (`petstore_auth` oauth2 + `api_key` apiKey).
- **Curation:** `--select` subset of 6 tools worked as the human-in-the-loop step.
- **Relative server URL:** spec declares `servers: [{url: "/api/v3"}]` —
  `--base-url` override handled it.
- **Hosting/MCP:** tools listed correctly, `delete_pet` blocked by the approval
  gate, upstream failures surfaced as clean tool errors.
- **Upstream result: the public demo server itself is broken** — direct
  `Invoke-WebRequest` calls (no auth, browser-identical) also return 500.
  Not a pipeline defect. Re-test when their demo recovers, or run the Petstore
  container locally.

## Open-Meteo forecast API (YAML, live, no auth)

- **Ingest:** YAML parsing path exercised; spec has no `operationId`
  (slug fallback → `get_v1_forecast`) and no `servers` entry (generator's
  guard produced a clear error; `--base-url` resolved it).
- **End-to-end success:** `get_v1_forecast latitude=28.61 longitude=77.21
  current=temperature_2m,wind_speed_10m` returned live Delhi weather (37.6 °C)
  through the hosted MCP endpoint.
- Multi-manifest hosting verified: one gateway served `/mcp/petstore` and
  `/mcp/openmeteo` simultaneously; audit log attributed events to each.

## Findings → backlog

1. **`loadManifests` directory mode is indiscriminate** — it parses every
   `*.json` in the directory and crashes on non-manifest files with a ZodError
   that doesn't name the offending file. Fix: skip non-manifests gracefully +
   include filename in errors. (Hit when a spec/graph sat beside manifests.)
2. **Array query params serialize by accident** — JS `String([...])` happens to
   produce the comma-joined form Open-Meteo expects, but OpenAPI
   `style`/`explode` serialization needs explicit handling for correctness.
3. **Descriptions need curation** — Open-Meteo's tool description is the API's
   marketing blurb; Petstore's are terse. Exactly the gap the Phase 2 LLM
   curation pass fills.
4. **Auto-generated tool names** like `get_v1_forecast` are usable but not
   agent-friendly (`get_weather_forecast` would be) — also Phase 2 curation.
5. Petstore at 19 ops was already unwieldy to eyeball — confirms that curation
   UX (not just `--select` on the CLI) matters, and GitHub-scale specs
   (~900 ops) will need search/grouping in the review step.

## Still open (needs a human at the browser)

- MCP Inspector visual pass: `npx @modelcontextprotocol/inspector` →
  Streamable HTTP → `http://localhost:3002/mcp/openmeteo`, header
  `Authorization: Bearer <gateway key>`.
- Claude as the agent:
  `claude mcp add --transport http openmeteo http://localhost:3002/mcp/openmeteo --header "Authorization: Bearer <gateway key>"`
  then ask for a weather comparison across cities in a fresh session.
