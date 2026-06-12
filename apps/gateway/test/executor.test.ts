import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { ingestOpenApi } from "@protocolfoundry/discovery";
import { generateManifest } from "@protocolfoundry/generator";
import { executePlan } from "../src/executor.js";

const SPEC = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Things API" },
  paths: {
    "/things": {
      get: { operationId: "listThings", summary: "List things", responses: { "200": { description: "ok" } } },
    },
  },
});

const QUERY_KEY_SPEC = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Things API" },
  components: {
    securitySchemes: {
      qkey: { type: "apiKey", in: "query", name: "api_key" },
    },
  },
  security: [{ qkey: [] }],
  paths: {
    "/things": {
      get: { operationId: "listThings", summary: "List things", responses: { "200": { description: "ok" } } },
    },
  },
});

describe("executePlan network failures", () => {
  it("names the upstream URL and the network cause instead of bare 'fetch failed'", async () => {
    const graph = ingestOpenApi(SPEC, "proj", "src-test");
    // nothing listens on this port, so the connect is refused immediately
    const manifest = generateManifest(
      graph,
      { operationIds: ["listThings"], taskFlowIds: [] },
      { serverName: "things", baseUrls: { default: "http://127.0.0.1:59999" } },
    );
    const tool = manifest.tools[0]!;

    const failure = await executePlan(manifest, tool, {}).then(
      () => {
        throw new Error("expected executePlan to reject");
      },
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(failure).toContain("http://127.0.0.1:59999/things");
    // the undici cause (ECONNREFUSED) must surface, not just "fetch failed"
    expect(failure).toMatch(/ECONNREFUSED|connect/i);
  });

  it("never leaks query-string credentials in the unreachable error", async () => {
    const graph = ingestOpenApi(QUERY_KEY_SPEC, "proj", "src-test");
    const manifest = generateManifest(
      graph,
      { operationIds: ["listThings"], taskFlowIds: [] },
      { serverName: "things", baseUrls: { default: "http://127.0.0.1:59999" } },
    );
    const tool = manifest.tools[0]!;

    const failure = await executePlan(manifest, tool, {}, () => "supersecret123").then(
      () => {
        throw new Error("expected executePlan to reject");
      },
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(failure).toContain("http://127.0.0.1:59999/things");
    expect(failure).not.toContain("supersecret123");
    expect(failure).not.toContain("api_key");
  });

  it("redacts query-string credentials in the upstream call record", async () => {
    const server = createServer((_req, res) => {
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify([{ id: 1 }]));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const graph = ingestOpenApi(QUERY_KEY_SPEC, "proj", "src-test");
      const manifest = generateManifest(
        graph,
        { operationIds: ["listThings"], taskFlowIds: [] },
        { serverName: "things", baseUrls: { default: `http://127.0.0.1:${port}` } },
      );
      const tool = manifest.tools[0]!;

      const result = await executePlan(manifest, tool, {}, () => "supersecret123");
      expect(result.upstreamCalls).toHaveLength(1);
      expect(result.upstreamCalls[0]!.url).toContain("api_key=***");
      expect(result.upstreamCalls[0]!.url).not.toContain("supersecret123");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });
});
