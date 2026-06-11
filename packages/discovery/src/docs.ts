import Anthropic from "@anthropic-ai/sdk";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { z } from "zod";
import {
  AuthRequirement,
  Operation,
  WorkflowGraph,
  resolveClaudeModel,
  supportsAdaptiveThinking,
} from "@protocolfoundry/core";
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
/* SSRF guard                                                          */
/* ------------------------------------------------------------------ */

export type LookupFn = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: LookupFn = async (hostname) =>
  dnsLookup(hostname, { all: true, verbatim: true });

function isPrivateIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  const [a, b] = [parts[0]!, parts[1]!];
  return (
    a === 0 || // 0.0.0.0/8 ("this host")
    a === 10 || // 10/8
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // 100.64/10 CGNAT
    (a === 169 && b === 254) || // link-local incl. cloud metadata
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12
    (a === 192 && b === 168) || // 192.168/16
    (a === 192 && b === 0) || // 192.0.0/24 special-purpose
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast + reserved
  );
}

function isPrivateAddress(address: string): boolean {
  const v4 = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
  if (v4) return isPrivateIPv4(v4);
  if (isIP(address) === 4) return isPrivateIPv4(address);
  const lower = address.toLowerCase();
  return (
    lower === "::" ||
    lower === "::1" ||
    lower.startsWith("fe8") || // fe80::/10 link-local (fe80–febf)
    lower.startsWith("fe9") ||
    lower.startsWith("fea") ||
    lower.startsWith("feb") ||
    lower.startsWith("fc") || // fc00::/7 unique-local
    lower.startsWith("fd")
  );
}

/**
 * Reject URLs an ingest fetch must never reach: non-http(s) schemes,
 * localhost-style hostnames, and anything resolving to loopback, link-local
 * (incl. cloud metadata), or private ranges. Applied to the user-supplied
 * URL, every autodiscovered spec candidate, and every redirect hop — these
 * all reach the server-side fetcher (SSRF surface).
 */
export async function assertPublicHttpUrl(raw: string, lookupFn: LookupFn = defaultLookup): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a valid URL: ${raw}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Only http(s) URLs can be ingested (got ${url.protocol}//)`);
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host === ""
  ) {
    throw new Error(`Refusing to fetch internal hostname "${host}"`);
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw new Error(`Refusing to fetch private address ${host}`);
    return url;
  }
  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await lookupFn(host);
  } catch {
    throw new Error(`Could not resolve hostname "${host}"`);
  }
  if (resolved.length === 0) throw new Error(`Could not resolve hostname "${host}"`);
  for (const { address } of resolved) {
    if (isPrivateAddress(address)) {
      throw new Error(`Refusing to fetch ${host} — it resolves to private address ${address}`);
    }
  }
  return url;
}

/**
 * Fetch with the SSRF guard on the initial URL and on EVERY redirect hop
 * (redirects are followed manually so a public host can't bounce us to an
 * internal one). Note: a determined DNS-rebinding attacker could still race
 * the check; the gateway/network layer is the backstop for that.
 */
async function safeFetch(
  rawUrl: string,
  fetchFn: typeof fetch,
  lookupFn: LookupFn,
  maxRedirects = 5,
): Promise<Response> {
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertPublicHttpUrl(current, lookupFn);
    const response = await fetchFn(current, { headers: FETCH_HEADERS, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) return response;
      current = new URL(location, current).toString();
      continue;
    }
    return response;
  }
  throw new Error(`Too many redirects fetching ${rawUrl}`);
}

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
/* stage 1b: doc-page link discovery (multi-page crawl)                */
/* ------------------------------------------------------------------ */

const ASSET_EXTENSION = /\.(png|jpe?g|gif|svg|ico|css|js|mjs|map|zip|tar|gz|pdf|woff2?|ttf|eot|mp4|webm|xml|txt)(\?|$)/i;
const SPEC_EXTENSION = /\.(json|ya?ml)(\?|$)/i;
const DOC_LINK_HINT = /api|endpoint|reference|resource|operation|method|rest|integration|webhook|sdk|v\d+|docs?|guide/i;

/**
 * Same-origin links from a docs page that may themselves be documentation
 * pages worth crawling (an index page linking out to per-endpoint pages).
 * Hint-matched links (API-ish href or anchor text) come first so a small
 * page budget is spent on the most promising candidates. Spec-looking
 * files are excluded — those are findSpecCandidates' job.
 */
export function findDocLinkCandidates(html: string, pageUrl: string): string[] {
  const base = new URL(pageUrl);
  const self = `${base.origin}${base.pathname}`;
  const hinted: string[] = [];
  const rest: string[] = [];
  const seen = new Set<string>();

  for (const m of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]!.trim().replace(/&amp;/g, "&");
    const text = (m[2] ?? "").replace(/<[^>]+>/g, " ").trim();
    if (!href || href.startsWith("#")) continue;
    if (/^(mailto|javascript|tel|data):/i.test(href)) continue;
    let resolved: URL;
    try {
      resolved = new URL(href, pageUrl);
    } catch {
      continue;
    }
    if (resolved.protocol !== "http:" && resolved.protocol !== "https:") continue;
    if (resolved.origin !== base.origin) continue;
    if (ASSET_EXTENSION.test(resolved.pathname)) continue;
    if (SPEC_EXTENSION.test(resolved.pathname)) continue;
    const normalized = `${resolved.origin}${resolved.pathname}${resolved.search}`;
    if (normalized === self || seen.has(normalized)) continue;
    seen.add(normalized);
    if (DOC_LINK_HINT.test(`${href} ${text}`)) hinted.push(normalized);
    else rest.push(normalized);
  }
  return [...hinted, ...rest].slice(0, 40);
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
        // structured outputs forbid open maps (additionalProperties must be
        // false), so detail is pinned to the keys the gateway's auth
        // application actually reads: header/query param name + location.
        detail: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            in: { type: "string", enum: ["header", "query"] },
          },
        },
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
- "auth": how the API authenticates (apiKey/bearer/oauth2/basic); in "detail" give the credential's parameter "name" (e.g. the header name) and "in" (header or query) when the docs state them.

Rules:
- Only endpoints explicitly documented on the page — do not invent or generalize.
- Skip navigation, marketing, SDK install instructions, and code samples that don't define endpoints.
- Deduplicate: one operation per method+path.
- If the page documents nothing concrete, return an empty operations list.`;
}

/**
 * Real Claude-backed extractor. Requires ANTHROPIC_API_KEY in the environment.
 * Accepts a friendly alias ("haiku" | "sonnet" | "opus" | "fable") or a full
 * model ID; defaults to opus (extraction quality bounds everything downstream).
 */
export function createAnthropicDocsExtractor(modelOrAlias?: string): DocsExtractor {
  const model = modelOrAlias ? resolveClaudeModel(modelOrAlias) : "claude-opus-4-8";
  const client = new Anthropic();
  return {
    model,
    async extract(prompt: string): Promise<RawDocsExtraction> {
      // Streamed: doc pages are large and extraction can exceed the SDK's
      // non-streaming time limit at this max_tokens.
      const response = await client.messages
        .stream({
          model,
          max_tokens: 32000,
          ...(supportsAdaptiveThinking(model) ? { thinking: { type: "adaptive" as const } } : {}),
          messages: [{ role: "user", content: prompt }],
          output_config: {
            format: { type: "json_schema", schema: RAW_EXTRACTION_JSON_SCHEMA },
          },
        })
        .finalMessage();
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
  /** Injected for tests; defaults to dns.lookup (SSRF guard). */
  lookupFn?: LookupFn;
  /** Needed only when the page has no discoverable machine-readable spec. */
  extractor?: DocsExtractor;
  /** Total page-fetch budget for the docs crawl, entry page included. */
  maxPages?: number;
  /** How many link hops from the entry page to follow (0 = entry only). */
  maxDepth?: number;
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
  const lookupFn = options.lookupFn ?? defaultLookup;
  const log = options.log ?? (() => {});
  const maxPages = Math.max(1, options.maxPages ?? 12);
  const maxDepth = Math.max(0, options.maxDepth ?? 2);
  const sourceId = `url:${url}`;

  const response = await safeFetch(url, fetchFn, lookupFn);
  if (!response.ok) throw new Error(`Fetching ${url} failed: HTTP ${response.status}`);
  const raw = await response.text();

  if (!looksLikeHtml(raw)) {
    return ingestSource(raw, projectId, sourceId);
  }

  log(`HTML documentation page detected at ${url}`);

  /**
   * Try every machine-readable spec candidate a page references; the first
   * one that parses into operations wins (deterministic, lossless, no LLM).
   */
  const trySpecCandidates = async (html: string, pageUrl: string): Promise<WorkflowGraph | undefined> => {
    for (const candidate of findSpecCandidates(html, pageUrl)) {
      try {
        // safeFetch re-validates: page content names the candidates, so they
        // are attacker-controllable even when the page URL itself is fine.
        const specResponse = await safeFetch(candidate, fetchFn, lookupFn);
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
    return undefined;
  };

  // stage 1: a linked machine-readable spec beats scraping every time
  const entrySpec = await trySpecCandidates(raw, url);
  if (entrySpec) return entrySpec;

  // stage 1b: breadth-first crawl of same-origin doc links (an index page
  // linking out to per-endpoint pages). Every crawled page gets the same
  // spec-autodiscovery treatment; pages are kept for LLM extraction.
  const pages: Array<{ url: string; html: string }> = [{ url, html: raw }];
  const visited = new Set<string>([url]);
  let frontier: Array<{ url: string; html: string }> = [{ url, html: raw }];

  for (let depth = 0; depth < maxDepth && pages.length < maxPages && frontier.length > 0; depth++) {
    const next: Array<{ url: string; html: string }> = [];
    for (const page of frontier) {
      for (const link of findDocLinkCandidates(page.html, page.url)) {
        if (pages.length >= maxPages) break;
        if (visited.has(link)) continue;
        visited.add(link);
        let html: string;
        try {
          const linkResponse = await safeFetch(link, fetchFn, lookupFn);
          if (!linkResponse.ok) continue;
          html = await linkResponse.text();
        } catch {
          continue; // unreachable or blocked (SSRF guard) — skip
        }
        if (!looksLikeHtml(html)) continue;
        log(`Crawled docs page: ${link}`);
        const spec = await trySpecCandidates(html, link);
        if (spec) return spec;
        pages.push({ url: link, html });
        next.push({ url: link, html });
      }
      if (pages.length >= maxPages) break;
    }
    frontier = next;
  }

  // stage 2: LLM extraction from the page text(s)
  if (!options.extractor) {
    throw new Error(
      `${url} is an HTML docs page with no discoverable OpenAPI/Postman spec. ` +
        "LLM extraction is required — set ANTHROPIC_API_KEY (CLI/dashboard wire the extractor automatically).",
    );
  }
  log(`No spec link found — extracting endpoints with ${options.extractor.model}`);

  // The entry page is always extracted; crawled pages only when their text
  // actually describes endpoints (keeps the LLM spend proportional).
  const endpointSignal = /\b(GET|POST|PUT|PATCH|DELETE|HEAD)\s+\/\S/;
  const texts = pages
    .map((page) => ({ url: page.url, text: htmlToText(page.html) }))
    .filter((page, index) => index === 0 || (page.text.length >= 200 && endpointSignal.test(page.text)));

  if (texts.every((page) => page.text.length < 200)) {
    throw new Error(
      `${url} has almost no readable text (likely a fully client-rendered docs app). ` +
        "Point at the underlying spec URL instead.",
    );
  }

  const extractions: RawDocsExtraction[] = [];
  for (const page of texts) {
    if (page.text.length < 200) continue;
    if (texts.length > 1) log(`Extracting endpoints from ${page.url}`);
    extractions.push(await options.extractor.extract(buildExtractionPrompt(page.text, page.url)));
  }

  // merge: operations concatenate (graphFromExtraction dedupes method+path);
  // the first page to state a base URL / auth scheme wins.
  const merged: RawDocsExtraction = {
    baseUrl: extractions.find((e) => e.baseUrl)?.baseUrl,
    auth: extractions.find((e) => e.auth && e.auth.kind !== "none")?.auth,
    operations: extractions.flatMap((e) => e.operations),
  };

  const graph = graphFromExtraction(merged, projectId, sourceId);
  if (graph.operations.length === 0) {
    throw new Error(`No API operations could be extracted from ${url}`);
  }
  return graph;
}
