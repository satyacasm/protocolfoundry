# ADR-0002: Spec-first discovery; SaaS vendors as the first customer

- **Status:** accepted
- **Date:** 2026-06-10

## Context

The original concept ("point us at any web app and we'll discover its workflows
from UI, traffic, and docs") spans two customer segments and a wide spectrum of
discovery difficulty. Autonomous UI-level discovery of arbitrary apps is
research-grade, brittle, and legally risky for apps the user doesn't own.
Meanwhile, nearly every SaaS vendor already has an OpenAPI/GraphQL spec and is
under pressure to ship an official MCP server.

## Decision

1. **First customer segment: SaaS vendors exposing their own product** (and
   enterprise internal-tools teams — same ownership story). Integrator/agency use
   cases come later.
2. **Discovery starts from structured sources**: OpenAPI 3.x first, then GraphQL,
   Postman collections, HAR recordings, and docs crawling (Phase 4).
3. **Autonomous browser discovery of third-party apps is a non-goal.** Its
   eventual replacement is *consented walkthrough recording*: the customer
   demonstrates a workflow in their own app and the platform captures authorized
   traffic.

## Consequences

- Phase 1 is tractable: OpenAPI → graph → manifest → hosted server, no browser
  automation, no anti-bot gray zones.
- The "workflow graph" abstraction is still the core IR — structured sources
  populate it now; richer ingestors populate the same IR later without reworking
  the generator or gateway.
- Marketing leads with "official MCP server for your product, eval-scored and
  hosted," not "we reverse-engineer any app."
