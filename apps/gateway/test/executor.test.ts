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

const OAUTH_SPEC = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Things API" },
  components: {
    securitySchemes: {
      login: { type: "oauth2", flows: {} },
    },
  },
  security: [{ login: [] }],
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

  it("passes a secret with its own scheme prefix through raw (Kite-style 'token key:secret')", async () => {
    let seenAuth: string | undefined;
    const server = createServer((req, res) => {
      seenAuth = req.headers["authorization"];
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ status: "success" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as AddressInfo).port;

    try {
      const graph = ingestOpenApi(OAUTH_SPEC, "proj", "src-test");
      const manifest = generateManifest(
        graph,
        { operationIds: ["listThings"], taskFlowIds: [] },
        { serverName: "things", baseUrls: { default: `http://127.0.0.1:${port}` } },
      );
      const tool = manifest.tools[0]!;

      // Plain token: Bearer prefix applied as before.
      await executePlan(manifest, tool, {}, () => "plain-secret");
      expect(seenAuth).toBe("Bearer plain-secret");

      // Secret that already names its scheme (Kite Connect): sent verbatim.
      await executePlan(manifest, tool, {}, () => "token apikey:accesstoken");
      expect(seenAuth).toBe("token apikey:accesstoken");
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
    }
  });

  it("points the caller at the dashboard connect flow when a credential is missing", async () => {
    const graph = ingestOpenApi(OAUTH_SPEC, "proj", "src-test");
    const manifest = generateManifest(
      graph,
      { operationIds: ["listThings"], taskFlowIds: [] },
      { serverName: "things", baseUrls: { default: "http://127.0.0.1:59999" } },
    );
    const tool = manifest.tools[0]!;

    const failure = await executePlan(manifest, tool, {}, () => undefined).then(
      () => {
        throw new Error("expected executePlan to reject");
      },
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(failure).toContain('Credential "env:PF_CRED_LOGIN" is not configured');
    // the agent (and the human reading its transcript) must learn where to fix it
    expect(failure).toContain('project "proj"');
    expect(failure).toMatch(/dashboard.*Credentials/i);
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
