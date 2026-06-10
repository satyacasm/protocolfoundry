# Competitive Landscape (June 2026)

Survey of who else turns APIs into MCP servers, what they compete on, and the
moves that keep ProtocolFoundry differentiated. Complements
[02-product-strategy.md](02-product-strategy.md) § Competitive landscape (the
short version); this doc is the working map and gets refreshed as the market
moves. Strategy decisions that fall out of it are recorded at the bottom.

## The four competitor archetypes

### 1. Spec-to-server platforms (closest competitors)

| Player | What they do | Strengths | Where we beat them |
|---|---|---|---|
| **Speakeasy Gram** | OpenAPI or TypeScript functions → curated "toolsets," each instantly a hosted MCP server; MCP gateway; an `eval` command exists | Closest analogue: curation + hosting + gateway in one; SDK-business distribution; polished docs | Evals are a CLI afterthought, not a release gate. No immutable eval-gated release model, no per-tool scope enforcement by effect, no audit-everything posture. Gram curates by grouping; we curate by *composing task-level tools* and prove the delta with scored runs |
| **Stainless** | SDK codegen with MCP server output from OpenAPI | Strong codegen brand, dev mindshare | Output is endpoint-shaped code the customer must host/govern themselves; no evals, no hosted governance |
| **Tyk AI Studio** | Open-core AI gateway; generates MCP tools from OpenAPI behind their API-management plane; per-tool rate limits, PII redaction, token metering | Enterprise governance story, existing gateway install base, open-source since Mar 2026 | It's an *API-management* upsell: 1:1 endpoint translation, no curation pass, no agent-usability evals. Buyers without Tyk won't adopt a whole APIM stack to get MCP |
| **MCP.link** (automation-ai-labs) | OSS: any OpenAPI 3 spec → MCP interface; hosted converter at mcp-link.vercel.app | Free, instant, zero code change | Naive 1:1 mapping is precisely the failure mode we exist to fix (200 verb-tools, no evals, no auth/vault/audit). It validates demand and sets the floor |
| **openapi-mcp-generator family** (harsha-iiiv TS, cnoe-io Python, abutbul Python) | OSS codegen: spec → runnable MCP server source; cnoe-io adds LLM-enhanced docs and even `--generate-eval` | Free, hackable, Docker-ready; cnoe-io shows evals are becoming table stakes | Generated source = customer owns hosting, upgrades, drift, security. Our manifest-interpreted gateway (ADR-0003) means zero per-customer code to maintain. Watch cnoe-io: their eval flag is the first OSS echo of our headline feature |

### 2. Connector catalogs (segment-B players, not head-on)

**Composio** (850+ integrations, scoped permissions, managed auth),
**Zapier MCP** (8,000 apps), **Pipedream** (10k+ tools / 2,700 apps,
workflow-shaped tools), **Klavis**, **Nango**, **Workato**. They sell breadth
of *other people's* apps to agent builders. We sell depth on *your own* app to
its vendor. Different buyer (head of platform vs automation dev). Risk to
watch: Composio launching a "publish your own API" self-serve flow would cross
into our wedge.

### 3. Registries / distribution (channel, not competition)

**Smithery** ("app store" for MCP), **Glama** (discovery + gateway hosting),
**mcp.run**, **MCPBundles**. They distribute existing servers. Phase-4 roadmap
already targets them as partners: an eval-scored ProtocolFoundry badge on a
registry listing is marketing for both sides.

### 4. DIY (the real competitor)

FastMCP, official SDKs, an engineer with two free weeks. Unchanged from
strategy doc: the counter is everything after the demo works — evals, hosting,
auth, scopes, audit, drift, maintenance.

## What the market competes on (observed)

1. **Time-to-server** — everyone is minutes-from-spec now. Table stakes.
2. **Auth/credential handling** — managed OAuth is the #1 hosted-platform
   selling point. We have vault + scoped tokens; full OAuth 2.1 AS is the gap
   (deferred in ADR-0007 — schedule it before design-partner onboarding).
3. **Governance** — audit, rate limits, PII controls (Tyk), scoped permissions
   (Composio). We're competitive; per-tool effect-based scopes are ahead.
4. **Curation quality** — only Gram and we treat tool design as a product.
   Nobody else *measures* it.
5. **Evals** — our headline. Gram has an eval command; cnoe-io has a flag.
   Nobody gates releases on evals or publishes scores. The window where
   "eval-tested" is a differentiator rather than table stakes is maybe 6–12
   months — move fast on the public-proof angle.

## Strategic moves (what extra we do to win)

1. **Make eval scores public-facing proof, not just internal QA.** A shareable
   per-release "agent-readiness report" (completion %, tool-selection %, token
   cost vs naive baseline) the vendor can link from their docs/changelog.
   Nobody in the table above can publish such a number today.
   *Shipped 2026-06-11*: signed public `/reports/<project>/<version>` links
   from every release page.
2. **Eval-gated immutable releases as the trust story** — "CI/CD for MCP."
   Promote/rollback + audit + forced-override attribution is an enterprise
   narrative none of the codegen tools and few of the platforms can tell.
3. **Beyond-OpenAPI ingestion as wedge-widener.** Postman collections (shipped,
   Phase 4 — none of the listed competitors ingest Postman natively), then
   GraphQL/HAR. Many long-tail vendors have a Postman collection but no clean
   OpenAPI spec; that's an underserved on-ramp.
4. **Connection bundles, not source bundles.** Competitors hand you code to
   run; we hand a zip with the manifest, client configs (Claude/Cursor),
   scoped-token instructions, and the eval report — everything needed to
   connect, nothing to maintain (keeps ADR-0003 intact).
5. **Agent analytics** (Phase 4) — capability-gap reports for the vendor.
   No competitor offers "what did agents try and fail to do with your API."
6. **Registry partnerships** with Smithery/Glama for distribution, with the
   eval badge as the differentiator on the listing.
7. **Close the OAuth 2.1 gap** before design partners — it's the most-cited
   managed-platform feature we lack end-to-end.

## What we deliberately don't chase

Connector breadth (Composio's game), APIM platform features (Tyk's game),
SDK codegen (Speakeasy/Stainless's game), free naive conversion (race to
zero — let MCP.link have it and be the upgrade path from it).

## Sources

- [Composio: 4 best hosted MCP platforms 2026](https://composio.dev/content/hosted-mcp-platforms)
- [Speakeasy Gram product page](https://www.speakeasy.com/product/gram) · [Gram repo](https://github.com/speakeasy-api/gram) · [Advanced tool curation](https://www.speakeasy.com/docs/mcp/build/toolsets/advanced-tool-curation) · [Choosing an MCP gateway](https://www.speakeasy.com/blog/choosing-an-mcp-gateway)
- [Tyk AI Studio](https://tyk.io/tyk-ai-studio/) · [docs](https://tyk.io/docs/ai-management/ai-studio/overview) · [MCP gateway guide](https://tyk.io/learning-center/mcp-gateway-architecture-technical-guide/)
- [MCP.link repo](https://github.com/automation-ai-labs/mcp-link)
- [openapi-mcp-generator (TS)](https://github.com/harsha-iiiv/openapi-mcp-generator) · [cnoe-io/openapi-mcp-codegen](https://github.com/cnoe-io/openapi-mcp-codegen) · [abutbul/openapi-mcp-generator](https://github.com/abutbul/openapi-mcp-generator)
- [Klavis: Pipedream MCP alternatives](https://www.klavis.ai/blog/pipedream-mcp-alternatives-ai-agents) · [Composio: Smithery alternatives](https://composio.dev/content/smithery-alternative) · [Composio: Glama alternatives](https://composio.dev/content/glama-alternatives)
- [Prefect: best MCP deployment platforms](https://www.prefect.io/resources/best-mcp-deployment-platforms-enterprise-2026) · [Jinba: top MCP server tools](https://jinba.io/blog/top-mcp-server-tools-enterprise-2026)
- [awesome-mcp-enterprise](https://github.com/bh-rat/awesome-mcp-enterprise)
