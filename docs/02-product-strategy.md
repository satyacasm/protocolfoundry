# Product Strategy

## Who is the buyer? (the most important improvement to the original idea)

The original pitch conflated two very different customers. They need different
products, sales motions, and pricing:

| | **A. SaaS vendors** (expose *their own* product) | **B. Integrators** (consume *other people's* products) |
|---|---|---|
| Job to be done | "Our customers' agents need to use our product. Ship an official MCP server." | "Connect my agent to 50 tools I use." |
| Budget owner | Head of Product / Platform Eng | Individual dev / automation team |
| Existing competition | Weak — mostly DIY or consultants | Strong — Composio, Zapier MCP, Pipedream, registries |
| Willingness to pay | High (it's their product surface) | Low-to-medium (commoditizing fast) |
| Auth complexity | They own the auth — clean | Per-end-user OAuth juggling — messy |
| Legal exposure | None (their own app) | ToS/anti-bot risk for UI-level discovery |

**Decision: lead with segment A — "the official-MCP-server platform for SaaS
vendors."** Every B2B SaaS company is currently being asked by customers and by
their own roadmap, "where is your MCP server?" Most have an OpenAPI spec, no
bandwidth, and no in-house MCP expertise. That is a clean wedge with a named buyer,
a clear deliverable, and recurring hosting revenue. Segment B (internal tooling
teams, agencies) remains addressable later with the same engine.

Secondary early segment: **enterprise internal-tools teams** exposing internal
services (they also own the apps, so the same trust story applies).

## Competitive landscape and positioning

> Detailed, current market map (players, archetypes, strategic moves):
> [06-competitive-landscape.md](06-competitive-landscape.md). Summary below.

- **Composio / Zapier MCP / Pipedream** — catalogs of pre-built connectors for
  segment B. They sell breadth of *other people's* apps. We sell depth on *your*
  app. Not head-on competitors for the vendor wedge.
- **Speakeasy / Stainless** — generate MCP servers as a byproduct of SDK generation
  from OpenAPI. Closest analogue. Their output is endpoint-shaped; our pitch is the
  curation + eval + hosting + governance layer above raw translation.
- **Smithery / Glama and registries** — distribution and hosting of existing
  servers, not generation/curation. Potential channel partners.
- **FastMCP / official SDKs** — the DIY route. Our real competitor is "an engineer
  with two free weeks." Counter: evals, hosting, auth, maintenance, and drift
  handling are the 80% that comes after the demo works.

**Positioning statement:** *"We don't transpile your API into 200 tools. We build,
test, host, and govern the MCP server your customers' agents will actually succeed
with — and prove it with eval scores."*

## Differentiators (ranked)

1. **Agent-usability evals** — every generated server ships with a scored report
   (task completion rate, tool-selection accuracy, token cost) across major agent
   models. This is the headline feature; treat it like CI for MCP.
2. **Task-level tool curation** — workflow graph → composed tools that match
   business tasks, not REST verbs. Schema trimming, description rewriting,
   pagination/error handling absorbed into the server.
3. **Governance** — approval gates, per-tool scopes, audit logs, versioned
   releases, drift detection against the upstream API.
4. **Managed everything** — hosting, OAuth 2.1 authorization, credential vault,
   monitoring, white-label CNAME (`mcp.vendor.com`).
5. **Agent analytics** — what agents attempt, where they fail, which capabilities
   are missing. A new product-analytics category for the vendor.

## Pricing model (initial hypothesis)

- **Starter** — 1 MCP server from an OpenAPI spec, hosted, basic auth, community
  support. Low monthly fee; exists to make the funnel frictionless.
- **Growth** — workflow-level tool curation, eval reports, custom domain, audit
  logs, usage analytics. Per-server monthly fee + metered tool-call usage.
- **Enterprise** — SSO, private networking/self-hosted data plane, approval
  workflows, SLAs, multiple environments (staging/prod). Annual contract.

One-time **discovery/mapping engagements** (the original idea's "discovery fee")
fit as paid onboarding for complex apps, not as the core revenue line — recurring
hosting + usage is the business.

## Riskiest assumptions (test in this order)

1. SaaS vendors will pay for a managed MCP server rather than DIY with FastMCP.
   → Validate with 10 design-partner conversations before building the dashboard.
2. Eval scores meaningfully change buyer behavior (they should — nobody can
   currently answer "does my MCP server work?").
3. Spec-first generation covers enough of the market; UI/traffic discovery can wait.
4. Hosting margin survives usage-based LLM costs in the curation pipeline
   (generation is LLM-heavy but one-time; serving is cheap).

## Explicit non-goals (for now)

- Autonomous browser-based discovery of arbitrary third-party apps (legal/brittleness
  risk; revisit in Phase 3 with recorded-session input instead).
- A public connector marketplace (that's Composio's game).
- Selling generated source code (the managed endpoint *is* the product).
