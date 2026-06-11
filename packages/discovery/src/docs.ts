import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { AuthRequirement, Operation, WorkflowGraph } from "@protocolfoundry/core";
import { ingestSource } from "./source.js";

/**
 * Docs-page ingestion (Source.kind "docsUrl"): turn a SaaS API documentation
 * page into a WorkflowGraph.
 *
 * Two stages, cheapest first:
 *  1. Spec autodiscovery — many doc sites embed or link their machine-readable
 *     spec (swagger-ui/redoc config, .json/.yaml links). If one is found and
 *     parses, we ingest THAT: deterministic, lossless, no LLM call.
 *  2. LLM extraction — otherwise the page text goes to a DocsExtractor
 *     (interface, like curation's Curator: tests inject a scripted fake, the
 *     real one is Anthropic-backed) which returns structured operations that
 *     are validated and assembled into a graph. Extracted graphs are
 *     curation INPUT — the human still reviews every operation before
 *     anything is exposed (ADR-0004).
 *
 * Fetching is plain HTTP with an honest UA; if a docs site requires auth or
 * blocks robots, the customer must provide the spec instead — we never
 * circumvent (ADR-0002).
 */

/* ------------------------------------------------------------------ */
/* stage 1: spec autodiscovery                                         */
/* ------------------------------------------------------------------ */

const SPEC_HINT = /openapi|swagger|postman|api[-_.]?spec|\.well-known/i;

/** True when content looks like an HTML page rather than a JSON/YAML spec. */
export function looksLikeHtml(raw: string): boolean {
  const head = raw.slice(0, 1000).trimStart().toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || /<(head|body|meta|title|script|div)[\s>]/.test(head);
}

/**
 * Candidate machine-readable spec URLs referenced by a docs page, most
 * promising first. Pure string scanning — no DOM dependency.
 */
export function findSpecCandidates(html: string, pageUrl: string): string[] {
  const found: string[] = [];
  const push = (raw: string | undefined) => {
    if (!raw) return;
    const cleaned = raw.trim().replace(/&amp;/g, "&");
    if (!cleaned || cleaned.startsWith("data:") || cleaned.startsWith("#")) return;
    try {
      const abs = new URL(cleaned, pageUrl).toString();
      if (!found.includes(abs)) found.push(abs);
    } catch {
      /* unresolvable href — skip */
    }
  };

  // swagger-ui / redoc configuration: url: "...", spec-url="...", specUrl: '...'
  for (const m of html.matchAll(/(?:spec-?url|"url"|'url'|\burl)\s*[:=]\s*["']([^"']+\.(?:json|ya?ml)[^"']*)["']/gi)) {
    push(m[1]);
  }
  // <redoc spec-url=...> and data attributes
  for (const m of html.matchAll(/data-(?:spec-)?url\s*=\s*["']([^"']+)["']/gi)) {
    push(m[1]);
  }
  // plain links/scripts to spec-ish files
  for (const m of html.matchAll(/(?:href|src)\s*=\s*["']([^"']+\.(?:json|ya?ml)(?:\?[^"']*)?)["']/gi)) {
    if (SPEC_HINT.test(m[1]!)) push(m[1]);
  }
  // absolute spec URLs appearing anywhere (e.g. in inline JS or copy)
  for (const m of html.matchAll(/https?:\/\/[^\s"'<>)]+\.(?:json|ya?ml)(?:\?[^\s"'<>)]*)?/gi)) {
    if (SPEC_HINT.test(m[0])) push(m[0]);
  }
  return found.slice(0, 8);
}

/* ------------------------------------------------------------------ */
/* stage 2: LLM extraction                                             */
/* ------------------------------------------------------------------ */

const ExtractedParam = z.object({
  name: z.string().min(1),
  location: z.enum(["path", "query", "header", "body"]),
  type: z.enum(["string", "number", "integer", "boolean", "array", "object"]).default("string"),
  required: z.boolean().default(false),
  description: z.string().optional(),
});

const ExtractedOperation = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]),
  /** Path template with {param} placeholders, e.g. /v1/orders/{id} */
  path: z.string().min(1),
  params: z.array(ExtractedParam).default([]),
  tags: z.array(z.string()).default([]),
});

export const RawDocsExtraction = z.object({
  /** Upstream API base URL if the docs state one (NOT the docs site itself). */
  baseUrl: z.string().optional(),
  auth: z
    .object({
      kind: z.enum(["apiKey", "oauth2", "basic", "bearer", "none"]),
      detail: z.record(z.string()).optional(),
    })
    .optional(),
  operations: z.array(ExtractedOperation),
});
export type RawDocsExtraction = z.infer<typeof RawDocsExtraction>;

const RAW_EXTRACTION_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["operations"],
  properties: {
    baseUrl: { type: "string" },
    auth: {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
        kind: { type: "string", enum: ["apiKey", "oauth2", "basic", "bearer", "none"] },
        detail: { type: "object", additionalProperties: { type: "string" } },
      },
    },
    operations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "method", "path"],
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"] },
          path: { type: "string" },
          params: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "location"],
              properties: {
                name: { type: "string" },
                location: { type: "string", enum: ["path", "query", "header", "body"] },
                type: {
                  type: "string",
                  enum: ["string", "number", "integer", "boolean", "array", "object"],
                },
                required: { type: "boolean" },
                description: { type: "string" },
              },
            },
          },
          tags: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
} as const;

/**
 * Pluggable LLM boundary, mirroring curation's Curator: tests inject a
 * scripted fake; the real implementation is createAnthropicDocsExtractor.
 */
export interface DocsExtractor {
  readonly model: string;
  extract(prompt: string): Promise<RawDocsExtraction>;
}

/** Strip tags/scripts/styles and collapse whitespace for the prompt. */
export function htmlToText(html: string, maxChars = 160_000): string {
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}

export function buildExtractionPrompt(docText: string, pageUrl: string): string {
  return `You are extracting the HTTP API surface from a SaaS product's API documentation page so it can be turned into tools for AI agents. Source page: ${pageUrl}

Documentation text (HTML stripped):

${docText}

Extract every concrete REST endpoint the documentation describes:

- "operations": one entry per endpoint with method, path template (use {param} placeholders exactly as the path expects), a short human name, a one-or-two sentence description of what it does, and its parameters with location (path/query/header/body), type, and whether required. Body fields are individual params with location "body".
- "baseUrl": the API base URL if the docs state one (e.g. https://api.example.com/v2). This is the API host, never the documentation site's own URL.
- "auth": how the API authenticates (apiKey/bearer/oauth2/basic) with useful detail (e.g. header name).

Rules:
- Only endpoints explicitly documented on the page — do not invent or generalize.
- Skip navigation, marketing, SDK install instructions, and code samples that don't define endpoints.
- Deduplicate: one operation per method+path.
- If the page documents nothing concrete, return an empty operations list.`;
}

/** Real Claude-backed extractor. Requires ANTHROPIC_API_KEY in the environment. */
export function createAnthropicDocsExtractor(model = "claude-opus-4-8"): DocsExtractor {
  const client = new Anthropic();
  return {
    model,
    async extract(prompt: string): Promise<RawDocsExtraction> {
      const response = await client.messages.create({
        model,
        max_tokens: 32000,
        thinking: { type: "adaptive" },
        messages: [{ role: "user", content: prompt }],
        output_config: {
          format: { type: "json_schema", schema: RAW_EXTRACTION_JSON_SCHEMA },
        },
      });
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (!text) {
        throw new Error(`Docs extraction returned no output (stop_reason: ${response.stop_reason})`);
      }
      return RawDocsExtraction.parse(JSON.parse(text));
    },
  };
}

function effectFor(method: Operation["http"]["method"]): Operation["effect"] {
  switch (method) {
    case "GET":
    case "HEAD":
      return "read";
    case "POST":
      return "create";
    case "PUT":
    case "PATCH":
      return "update";
    case "DELETE":
      return "delete";
  }
}

function slugify(name: string, method: string, path: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (base) return base;
  return `${method.toLowerCase()}_${path.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "")}`;
}

/** Validated extraction -> WorkflowGraph (same IR every ingestor produces). */
export function graphFromExtraction(
  extraction: RawDocsExtraction,
  projectId: string,
  sourceId: string,
): WorkflowGraph {
  const auth: AuthRequirement[] =
    extraction.auth && extraction.auth.kind !== "none"
      ? [
          {
            id: "docs-auth",
            kind: extraction.auth.kind,
            ...(extraction.auth.detail ? { detail: extraction.auth.detail } : {}),
          },
        ]
      : [];

  const seen = new Set<string>();
  const operations: Operation[] = [];
  for (const op of extraction.operations) {
    const dedupe = `${op.method} ${op.path}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);

    let id = slugify(op.name, op.method, op.path);
    while (operations.some((existing) => existing.id === id)) id = `${id}_`;

    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const parameterLocations: Record<string, "path" | "query" | "header" | "body"> = {};
    for (const param of op.params) {
      properties[param.name] = {
        type: param.type,
        ...(param.description ? { description: param.description } : {}),
      };
      parameterLocations[param.name] = param.location;
      if (param.required || param.location === "path") required.push(param.name);
    }
    // every {placeholder} in the path must be an input
    for (const m of op.path.matchAll(/\{([^}]+)\}/g)) {
      const name = m[1]!;
      if (!properties[name]) {
        properties[name] = { type: "string" };
        parameterLocations[name] = "path";
        required.push(name);
      }
    }

    operations.push(
      Operation.parse({
        id,
        name: op.name,
        ...(op.description ? { description: op.description } : {}),
        http: { method: op.method, path: op.path, baseUrlRef: "default" },
        inputSchema: {
          type: "object",
          properties,
          ...(required.length ? { required: [...new Set(required)] } : {}),
        },
        parameterLocations,
        authRequirementIds: auth.map((a) => a.id),
        effect: effectFor(op.method),
        tags: op.tags,
        sourceId,
      }),
    );
  }

  return WorkflowGraph.parse({
    graphVersion: 1,
    projectId,
    baseUrls: extraction.baseUrl ? { default: extraction.baseUrl } : {},
    operations,
    edges: [],
    taskFlows: [],
    authRequirements: auth,
    createdAt: new Date().toISOString(),
  });
}

/* ------------------------------------------------------------------ */
/* orchestration: URL in, graph out                                    */
/* ------------------------------------------------------------------ */

export interface IngestUrlOptions {
  /** Injected for tests; defaults to global fetch. */
  fetchFn?: typeof fetch;
  /** Needed only when the page has no discoverable machine-readable spec. */
  extractor?: DocsExtractor;
  log?: (message: string) => void;
}

const FETCH_HEADERS = {
  "User-Agent": "ProtocolFoundry-ingest/0.1 (+https://github.com/satyacasm/protocolfoundry)",
  Accept: "application/json, text/yaml, text/html;q=0.9, */*;q=0.8",
};

/**
 * Ingest anything reachable by URL: a machine-readable spec (OpenAPI JSON/
 * YAML or Postman collection) or a SaaS API documentation page (HTML).
 * Used by both `pf ingest <url>` and the dashboard Forge.
 */
export async function ingestUrl(
  url: string,
  projectId: string,
  options: IngestUrlOptions = {},
): Promise<WorkflowGraph> {
  const fetchFn = options.fetchFn ?? fetch;
  const log = options.log ?? (() => {});
  const sourceId = `url:${url}`;

  const response = await fetchFn(url, { headers: FETCH_HEADERS });
  if (!response.ok) throw new Error(`Fetching ${url} failed: HTTP ${response.status}`);
  const raw = await response.text();

  if (!looksLikeHtml(raw)) {
    return ingestSource(raw, projectId, sourceId);
  }

  log(`HTML documentation page detected at ${url}`);

  // stage 1: a linked machine-readable spec beats scraping every time
  for (const candidate of findSpecCandidates(raw, url)) {
    try {
      const specResponse = await fetchFn(candidate, { headers: FETCH_HEADERS });
      if (!specResponse.ok) continue;
      const specRaw = await specResponse.text();
      if (looksLikeHtml(specRaw)) continue;
      const graph = ingestSource(specRaw, projectId, `url:${candidate}`);
      if (graph.operations.length > 0) {
        log(`Found machine-readable spec: ${candidate}`);
        return graph;
      }
    } catch {
      /* candidate didn't parse as a spec — try the next one */
    }
  }

  // stage 2: LLM extraction from the page text
  if (!options.extractor) {
    throw new Error(
      `${url} is an HTML docs page with no discoverable OpenAPI/Postman spec. ` +
        "LLM extraction is required — set ANTHROPIC_API_KEY (CLI/dashboard wire the extractor automatically).",
    );
  }
  log(`No spec link found — extracting endpoints with ${options.extractor.model}`);
  const text = htmlToText(raw);
  if (text.length < 200) {
    throw new Error(
      `${url} has almost no readable text (likely a fully client-rendered docs app). ` +
        "Point at the underlying spec URL instead.",
    );
  }
  const extraction = await options.extractor.extract(buildExtractionPrompt(text, url));
  const graph = graphFromExtraction(extraction, projectId, sourceId);
  if (graph.operations.length === 0) {
    throw new Error(`No API operations could be extracted from ${url}`);
  }
  return graph;
}
