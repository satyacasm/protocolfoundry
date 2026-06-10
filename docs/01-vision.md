# Vision

> **ProtocolFoundry** — "Foundry for AI protocols, MCP servers, and agent tooling."

## One-liner

ProtocolFoundry turns existing software products into first-class participants in the agent
economy: paste in what you have (an OpenAPI spec, API docs, a recorded workflow),
review what we found, and get a hosted, secure, agent-tested MCP server.

## The problem

AI agents are becoming a primary consumer of software, but almost all existing
applications were designed for humans behind GUIs. The gap shows up in three ways:

1. **No agent interface at all.** Most SaaS products have no MCP server. Their
   customers' agents either can't use the product or fall back to brittle browser
   automation.
2. **Bad agent interfaces.** Naive "one tool per REST endpoint" MCP servers are
   actively harmful: 200 endpoint-shaped tools blow up agent context windows,
   tool descriptions copied from API docs confuse tool selection, and agents fail
   at multi-step tasks that any human user completes in one sitting.
3. **No trust layer.** Even when an MCP server exists, buyers can't answer basic
   questions: which credentials does it hold, what can it actually do, who
   approved that, and what did an agent do last Tuesday at 3am?

Building a *good* MCP server — task-level tools, correct auth, hosting, monitoring,
versioning — is weeks of specialized work that most teams can't prioritize, and it
goes stale every time the product changes.

## The product

A managed platform that takes an application the customer owns or is authorized to
integrate with, and produces a hosted MCP server through a supervised pipeline:

1. **Ingest** — the customer provides what exists: OpenAPI/GraphQL specs, API docs
   URLs, Postman collections, recorded network traffic (HAR), or guided walkthroughs
   of the app. Authentication is connected explicitly by the customer (OAuth, API
   keys, service accounts) — never harvested.
2. **Understand** — the platform builds a **workflow graph**: operations, data
   schemas, dependencies between calls, auth requirements, and the *business tasks*
   that span multiple operations (e.g. "create invoice → attach line items → send").
3. **Curate (human-in-the-loop)** — the customer reviews the graph and selects what
   to expose. The platform proposes task-level tools, not raw endpoints. Destructive
   operations get approval gates. Nothing ships without explicit selection.
4. **Generate & verify** — the platform generates the MCP server and runs an
   **agent-usability eval**: real agent loops attempt realistic tasks against the
   generated server, and the results (tool-selection accuracy, task completion,
   token cost) gate the release.
5. **Host & operate** — managed hosting with credential vault, OAuth 2.1-compliant
   authorization, per-tool scopes, full audit logs, usage analytics, drift detection
   (the upstream API changed → flag and regenerate), and versioned releases.

The customer consumes an endpoint (`mcp.customer-domain.com` via CNAME if they
want); they do not receive or maintain source code.

## What makes this different (the moat)

- **Curation over translation.** Anyone can transpile OpenAPI → MCP. The value is
  the layer that makes agents *succeed*: composed task-level tools, trimmed schemas,
  rewritten descriptions, normalized errors, pagination handled internally.
- **Evals as a gate.** "Your MCP server scores 94% task completion with Claude and
  GPT agents" is a deliverable nobody else markets. It converts MCP from a checkbox
  into a measurable quality bar, and it makes regeneration safe.
- **Trust as a feature.** Approval workflows, scoped credentials, audit trails, and
  drift alerts are what let enterprises say yes.
- **Operational telemetry.** Once agents use the server, the customer gets a new
  analytics category: *what are agents doing with my product, where do they fail,
  and what should I build next?*

## Long-term

Become the infrastructure layer through which existing software exposes business
capabilities to agents — generation, hosting, governance, and analytics — the way
Stripe became the layer through which software accepts payments.

See [02-product-strategy.md](02-product-strategy.md) for the wedge, buyer, and
competitive positioning, and [04-roadmap.md](04-roadmap.md) for sequencing.
