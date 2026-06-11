# ADR-0010: Docs-page ingestion — spec autodiscovery, then reviewed LLM extraction

- **Status:** accepted
- **Date:** 2026-06-11

## Context

Discovery accepted machine-readable inputs only (OpenAPI 3.x, Postman v2.1).
Many SaaS products expose neither publicly — what developers actually have is
the URL of an API documentation page. Asking customers to hand-build a spec is
a real onboarding wall, and the `Source.kind` enum reserved `"docsUrl"` for
exactly this from day one.

Two risks shape the design: LLM extraction can hallucinate endpoints, and
fetching third-party docs must stay inside our authorization rules (ADR-0002:
no anti-bot circumvention, only apps the customer owns/is authorized for).

## Decision

`ingestUrl(url, projectId, options)` in `packages/discovery` (`docs.ts`),
shared by `pf ingest <url>` and the Forge's URL field:

1. **Fetch** with a plain, honestly identified HTTP GET. If the response is a
   spec (JSON/YAML), ingest it exactly as before.
2. **Spec autodiscovery** (HTML responses): scan for machine-readable spec
   references — swagger-ui/redoc config URLs, spec-ish `.json`/`.yaml` links,
   absolute spec URLs in inline JS — resolve them against the page URL and
   try each (max 8). The first one that parses into a non-empty graph wins.
   Deterministic, lossless, zero LLM cost; expected to cover most real doc
   sites.
3. **LLM extraction** (fallback): strip the page to text and ask a
   `DocsExtractor` — an interface mirroring curation's `Curator` (scripted
   fakes in tests, no API key; real impl `createAnthropicDocsExtractor`,
   `claude-opus-4-8`, adaptive thinking, structured outputs) — for the
   documented endpoints (method, path template, params with locations, base
   URL, auth scheme). The zod-validated result is assembled into a normal
   `WorkflowGraph` (deduped per method+path, path placeholders forced into
   required inputs, effects inferred from method).

Extracted graphs flow into the SAME curation pipeline as every other source:
a human reviews every operation before a manifest exists (ADR-0004), so
hallucinated endpoints die at review, and the eval gate (ADR-0004/0008)
catches anything that slips through before a release can serve traffic.

## Consequences

- Onboarding input is now "any of: spec file, spec URL, docs-page URL" —
  the Forge and CLI need no new concepts, just looser input.
- No headless browser: client-rendered docs apps with no spec link and no
  static text fail with a clear message pointing at the spec-URL path.
  A rendering crawler is a separate, later decision.
- `packages/discovery` now depends on `@anthropic-ai/sdk` + `zod` (same
  boundary pattern as curation/evals; tests stay offline).
- Extraction quality is bounded by the docs themselves; the human review +
  eval gate remain the correctness backstop, not the extractor.
