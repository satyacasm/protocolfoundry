import { describe, expect, it } from "vitest";
import {
  assertPublicHttpUrl,
  buildExtractionPrompt,
  createAnthropicDocsExtractor,
  findDocLinkCandidates,
  findSpecCandidates,
  graphFromExtraction,
  htmlToText,
  ingestUrl,
  looksLikeHtml,
  RawDocsExtraction,
  type DocsExtractor,
} from "../src/docs.js";

const OPENAPI_SPEC = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Orders API" },
  servers: [{ url: "https://api.example.com/v1" }],
  paths: {
    "/orders": {
      get: { operationId: "listOrders", summary: "List orders", responses: { "200": { description: "ok" } } },
    },
  },
});

// every test hostname "resolves" to a public address
const publicLookup = async () => [{ address: "203.0.113.10", family: 4 }];

function fakeFetch(routes: Record<string, { body: string; status?: number }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const route = routes[url];
    if (!route) return new Response("not found", { status: 404 });
    return new Response(route.body, { status: route.status ?? 200 });
  }) as typeof fetch;
}

describe("looksLikeHtml", () => {
  it("detects HTML pages and not specs", () => {
    expect(looksLikeHtml("<!DOCTYPE html><html><body>docs</body></html>")).toBe(true);
    expect(looksLikeHtml('  <html lang="en"><head></head></html>')).toBe(true);
    expect(looksLikeHtml(OPENAPI_SPEC)).toBe(false);
    expect(looksLikeHtml("openapi: 3.0.0\npaths: {}")).toBe(false);
  });
});

describe("findSpecCandidates", () => {
  it("finds swagger-ui config urls, links, and absolute spec urls; resolves relative", () => {
    const html = `
      <html><body>
        <a href="/static/openapi.json">OpenAPI spec</a>
        <script>SwaggerUIBundle({ url: "/api/swagger.yaml" })</script>
        <redoc spec-url="https://cdn.example.com/specs/api-spec.json"></redoc>
        See https://docs.example.com/files/postman.json for Postman.
        <a href="/pricing.json">pricing data</a>
        <img src="/logo.png" />
      </body></html>`;
    const candidates = findSpecCandidates(html, "https://docs.example.com/reference");
    expect(candidates).toContain("https://docs.example.com/static/openapi.json");
    expect(candidates).toContain("https://docs.example.com/api/swagger.yaml");
    expect(candidates).toContain("https://cdn.example.com/specs/api-spec.json");
    expect(candidates).toContain("https://docs.example.com/files/postman.json");
    // non-spec-ish json is not picked up via href filter
    expect(candidates).not.toContain("https://docs.example.com/pricing.json");
  });
});

describe("htmlToText", () => {
  it("strips scripts, styles, and tags; keeps readable text", () => {
    const text = htmlToText(
      "<html><head><style>.x{color:red}</style><script>var a=1;</script></head>" +
        "<body><h1>Orders API</h1><p>GET /orders &amp; more</p></body></html>",
    );
    expect(text).toContain("Orders API");
    expect(text).toContain("GET /orders & more");
    expect(text).not.toContain("var a=1");
    expect(text).not.toContain("color:red");
  });
});

describe("graphFromExtraction", () => {
  const extraction = RawDocsExtraction.parse({
    baseUrl: "https://api.example.com/v2",
    auth: { kind: "apiKey", detail: { header: "X-Api-Key" } },
    operations: [
      {
        name: "Get order",
        description: "Fetch one order by id.",
        method: "GET",
        path: "/orders/{orderId}",
        params: [{ name: "expand", location: "query", type: "string", required: false }],
      },
      {
        name: "Create order",
        method: "POST",
        path: "/orders",
        params: [{ name: "items", location: "body", type: "array", required: true }],
      },
      // duplicate method+path must be dropped
      { name: "Get order again", method: "GET", path: "/orders/{orderId}", params: [] },
    ],
  });

  it("builds a valid WorkflowGraph with auth, base url, and effects", () => {
    const graph = graphFromExtraction(extraction, "proj", "url:https://docs.example.com");
    expect(graph.baseUrls["default"]).toBe("https://api.example.com/v2");
    expect(graph.operations).toHaveLength(2);
    expect(graph.authRequirements[0]?.kind).toBe("apiKey");

    const get = graph.operations.find((op) => op.http.method === "GET")!;
    expect(get.effect).toBe("read");
    // path placeholder became a required path input even though not listed
    expect(get.parameterLocations["orderId"]).toBe("path");
    expect((get.inputSchema?.["required"] as string[])).toContain("orderId");
    expect(get.parameterLocations["expand"]).toBe("query");
    expect(get.authRequirementIds).toEqual(["docs-auth"]);

    const post = graph.operations.find((op) => op.http.method === "POST")!;
    expect(post.effect).toBe("create");
    expect(post.parameterLocations["items"]).toBe("body");
  });
});

describe("ingestUrl", () => {
  it("ingests a machine-readable spec URL directly", async () => {
    const graph = await ingestUrl("https://api.example.com/openapi.json", "proj", {
      lookupFn: publicLookup, fetchFn: fakeFetch({ "https://api.example.com/openapi.json": { body: OPENAPI_SPEC } }),
    });
    expect(graph.operations.map((op) => op.id)).toEqual(["listOrders"]);
  });

  it("autodiscovers a linked spec from an HTML docs page (no LLM needed)", async () => {
    const html = `<html><body><h1>Docs</h1>
      <script>SwaggerUIBundle({ url: "/openapi.json" })</script></body></html>`;
    const graph = await ingestUrl("https://docs.example.com/api", "proj", {
      lookupFn: publicLookup, fetchFn: fakeFetch({
        "https://docs.example.com/api": { body: html },
        "https://docs.example.com/openapi.json": { body: OPENAPI_SPEC },
      }),
    });
    expect(graph.operations.map((op) => op.id)).toEqual(["listOrders"]);
  });

  it("falls back to the LLM extractor when no spec link works", async () => {
    const html = `<html><body><h1>Orders API reference</h1>
      <p>${"Authenticate with a bearer token. ".repeat(20)}</p>
      <h2>GET /orders/{id}</h2><p>Returns a single order.</p></body></html>`;
    const prompts: string[] = [];
    const extractor: DocsExtractor = {
      model: "scripted-fake",
      async extract(prompt) {
        prompts.push(prompt);
        return RawDocsExtraction.parse({
          baseUrl: "https://api.example.com",
          operations: [{ name: "Get order", method: "GET", path: "/orders/{id}", params: [] }],
        });
      },
    };
    const graph = await ingestUrl("https://docs.example.com/reference", "proj", {
      lookupFn: publicLookup, fetchFn: fakeFetch({ "https://docs.example.com/reference": { body: html } }),
      extractor,
    });
    expect(graph.operations).toHaveLength(1);
    expect(graph.operations[0]?.id).toBe("get_order");
    // the prompt carried the page text, not raw HTML
    expect(prompts[0]).toContain("GET /orders/{id}");
    expect(prompts[0]).not.toContain("<h2>");
  });

  it("fails with a clear message when extraction is needed but unavailable", async () => {
    const html = `<html><body><h1>Docs</h1><p>${"endpoint reference text ".repeat(30)}</p></body></html>`;
    await expect(
      ingestUrl("https://docs.example.com/api", "proj", {
        lookupFn: publicLookup, fetchFn: fakeFetch({ "https://docs.example.com/api": { body: html } }),
      }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("propagates HTTP failures", async () => {
    await expect(
      ingestUrl("https://docs.example.com/missing", "proj", { lookupFn: publicLookup, fetchFn: fakeFetch({}) }),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe("SSRF guard", () => {
  it("rejects non-http schemes, localhost, and private/metadata IPs", async () => {
    await expect(assertPublicHttpUrl("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(assertPublicHttpUrl("http://localhost:3001/")).rejects.toThrow(/internal/);
    await expect(assertPublicHttpUrl("http://127.0.0.1/")).rejects.toThrow(/private/);
    await expect(assertPublicHttpUrl("http://169.254.169.254/latest/meta-data")).rejects.toThrow(/private/);
    await expect(assertPublicHttpUrl("http://10.2.3.4/")).rejects.toThrow(/private/);
    await expect(assertPublicHttpUrl("http://192.168.1.1/")).rejects.toThrow(/private/);
    await expect(assertPublicHttpUrl("http://[::1]/")).rejects.toThrow(/private/);
  });

  it("rejects hostnames that resolve to private addresses", async () => {
    const internalLookup = async () => [{ address: "10.0.0.5", family: 4 }];
    await expect(assertPublicHttpUrl("https://internal.evil.example", internalLookup)).rejects.toThrow(
      /resolves to private/,
    );
  });

  it("accepts hostnames resolving publicly", async () => {
    const url = await assertPublicHttpUrl("https://docs.example.com/api", publicLookup);
    expect(url.hostname).toBe("docs.example.com");
  });

  it("blocks ingestUrl from fetching a private target", async () => {
    await expect(
      ingestUrl("http://169.254.169.254/latest/meta-data", "proj", {
        lookupFn: publicLookup,
        fetchFn: fakeFetch({ "http://169.254.169.254/latest/meta-data": { body: "secrets" } }),
      }),
    ).rejects.toThrow(/private/);
  });

  it("skips autodiscovered spec candidates pointing at private hosts", async () => {
    // page is public, but names an internal spec URL — it must be skipped,
    // falling through to the no-extractor error rather than fetching it
    const html = `<html><body><h1>Docs</h1>
      <p>${"endpoint reference text ".repeat(30)}</p>
      <a href="http://127.0.0.1:8080/openapi.json">spec</a></body></html>`;
    const fetched: string[] = [];
    const spyFetch: typeof fetch = (async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      if (String(input) === "https://docs.example.com/api") return new Response(html);
      return new Response(OPENAPI_SPEC);
    }) as typeof fetch;
    await expect(
      ingestUrl("https://docs.example.com/api", "proj", {
        lookupFn: publicLookup,
        fetchFn: spyFetch,
      }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
    expect(fetched).toEqual(["https://docs.example.com/api"]);
  });

  it("re-validates redirect hops", async () => {
    const redirectFetch: typeof fetch = (async (input: RequestInfo | URL) => {
      if (String(input) === "https://docs.example.com/spec.json") {
        return new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secrets" } });
      }
      return new Response("should never get here");
    }) as typeof fetch;
    await expect(
      ingestUrl("https://docs.example.com/spec.json", "proj", {
        lookupFn: publicLookup,
        fetchFn: redirectFetch,
      }),
    ).rejects.toThrow(/private/);
  });
});

describe("findDocLinkCandidates", () => {
  it("returns same-origin page links resolved absolute, hint-matched first", () => {
    const html = `
      <html><body>
        <a href="orders.html">Orders API</a>
        <a href="/docs/payments">Payments endpoints</a>
        <a href="https://docs.example.com/shipping#auth">Shipping API reference</a>
        <a href="https://other.example.com/api">External API</a>
        <a href="/static/openapi.json">spec file</a>
        <a href="/logo.png">logo</a>
        <a href="mailto:dev@example.com">contact</a>
        <a href="javascript:void(0)">toggle</a>
        <a href="#section">anchor</a>
      </body></html>`;
    const links = findDocLinkCandidates(html, "https://docs.example.com/index.html");
    expect(links).toContain("https://docs.example.com/orders.html");
    expect(links).toContain("https://docs.example.com/docs/payments");
    // fragment stripped
    expect(links).toContain("https://docs.example.com/shipping");
    // never leaves the docs site
    expect(links.some((l) => l.includes("other.example.com"))).toBe(false);
    // specs, assets, and non-http links are not page candidates
    expect(links.some((l) => l.endsWith(".json"))).toBe(false);
    expect(links.some((l) => l.endsWith(".png"))).toBe(false);
    expect(links.some((l) => l.startsWith("mailto:") || l.startsWith("javascript:"))).toBe(false);
  });

  it("does not return the page itself or duplicates", () => {
    const html = `
      <a href="/index.html">home</a>
      <a href="/orders">Orders API</a>
      <a href="/orders#create">Create order</a>`;
    const links = findDocLinkCandidates(html, "https://docs.example.com/index.html");
    expect(links).not.toContain("https://docs.example.com/index.html");
    expect(links.filter((l) => l === "https://docs.example.com/orders")).toHaveLength(1);
  });
});

describe("ingestUrl multi-page crawl", () => {
  const INDEX = `<html><body><h1>Developer API reference</h1>
    <p>${"Welcome to our API documentation portal. ".repeat(10)}</p>
    <a href="/docs/orders">Orders API</a>
    <a href="/docs/payments">Payments API</a></body></html>`;
  const ORDERS_PAGE = `<html><body><h2>GET /orders/{id}</h2>
    <p>${"Returns a single order with full detail. ".repeat(10)}</p></body></html>`;
  const PAYMENTS_PAGE = `<html><body><h2>POST /payments</h2>
    <p>${"Creates a payment for an order. ".repeat(10)}</p></body></html>`;

  it("follows same-site links from an index page and merges operations from all pages", async () => {
    const extractor: DocsExtractor = {
      model: "scripted-fake",
      async extract(prompt) {
        if (prompt.includes("Returns a single order")) {
          return RawDocsExtraction.parse({
            baseUrl: "https://api.example.com",
            operations: [{ name: "Get order", method: "GET", path: "/orders/{id}", params: [] }],
          });
        }
        if (prompt.includes("Creates a payment")) {
          return RawDocsExtraction.parse({
            operations: [{ name: "Create payment", method: "POST", path: "/payments", params: [] }],
          });
        }
        return RawDocsExtraction.parse({ operations: [] });
      },
    };
    const graph = await ingestUrl("https://docs.example.com/index", "proj", {
      lookupFn: publicLookup,
      fetchFn: fakeFetch({
        "https://docs.example.com/index": { body: INDEX },
        "https://docs.example.com/docs/orders": { body: ORDERS_PAGE },
        "https://docs.example.com/docs/payments": { body: PAYMENTS_PAGE },
      }),
      extractor,
    });
    expect(graph.operations.map((op) => op.id).sort()).toEqual(["create_payment", "get_order"]);
    // baseUrl found on one page applies to the merged graph
    expect(graph.baseUrls["default"]).toBe("https://api.example.com");
  });

  it("discovers a machine-readable spec linked from a crawled child page (no LLM)", async () => {
    const child = `<html><body><h2>API reference</h2>
      <script>SwaggerUIBundle({ url: "/openapi.json" })</script></body></html>`;
    const graph = await ingestUrl("https://docs.example.com/index", "proj", {
      lookupFn: publicLookup,
      fetchFn: fakeFetch({
        "https://docs.example.com/index": INDEX_LINKING("/reference", "Full API reference"),
        "https://docs.example.com/reference": { body: child },
        "https://docs.example.com/openapi.json": { body: OPENAPI_SPEC },
      }),
    });
    expect(graph.operations.map((op) => op.id)).toEqual(["listOrders"]);
  });

  it("respects the maxPages budget", async () => {
    const fetched: string[] = [];
    const spyFetch: typeof fetch = (async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      const routes: Record<string, string> = {
        "https://docs.example.com/index": INDEX,
        "https://docs.example.com/docs/orders": ORDERS_PAGE,
        "https://docs.example.com/docs/payments": PAYMENTS_PAGE,
      };
      return new Response(routes[String(input)] ?? "not found", {
        status: routes[String(input)] ? 200 : 404,
      });
    }) as typeof fetch;
    const extractor: DocsExtractor = {
      model: "scripted-fake",
      async extract() {
        return RawDocsExtraction.parse({
          operations: [{ name: "Get order", method: "GET", path: "/orders/{id}", params: [] }],
        });
      },
    };
    await ingestUrl("https://docs.example.com/index", "proj", {
      lookupFn: publicLookup,
      fetchFn: spyFetch,
      extractor,
      maxPages: 2,
    });
    // entry page + at most 1 crawled page
    expect(fetched.filter((u) => !u.endsWith(".json"))).toHaveLength(2);
  });

  it("never crawls off-origin links", async () => {
    const fetched: string[] = [];
    const index = `<html><body><h1>API docs</h1>
      <p>${"Read about our API endpoints here. ".repeat(10)}</p>
      <a href="https://evil.example.net/api">Partner API reference</a></body></html>`;
    const spyFetch: typeof fetch = (async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      return new Response(index);
    }) as typeof fetch;
    const extractor: DocsExtractor = {
      model: "scripted-fake",
      async extract() {
        return RawDocsExtraction.parse({
          operations: [{ name: "List things", method: "GET", path: "/things", params: [] }],
        });
      },
    };
    await ingestUrl("https://docs.example.com/index", "proj", {
      lookupFn: publicLookup,
      fetchFn: spyFetch,
      extractor,
    });
    expect(fetched).toEqual(["https://docs.example.com/index"]);
  });
});

function INDEX_LINKING(href: string, text: string): { body: string } {
  return {
    body: `<html><body><h1>Developer documentation</h1>
      <p>${"Start integrating with our platform today. ".repeat(10)}</p>
      <a href="${href}">${text}</a></body></html>`,
  };
}

describe("buildExtractionPrompt", () => {
  it("includes the page url and the doc text", () => {
    const prompt = buildExtractionPrompt("GET /things returns things", "https://d.example.com");
    expect(prompt).toContain("https://d.example.com");
    expect(prompt).toContain("GET /things");
  });
});

describe("createAnthropicDocsExtractor", () => {
  it("resolves friendly model aliases like the other LLM boundaries", () => {
    expect(createAnthropicDocsExtractor("haiku").model).toBe("claude-haiku-4-5");
    expect(createAnthropicDocsExtractor("claude-sonnet-4-6").model).toBe("claude-sonnet-4-6");
  });
});
