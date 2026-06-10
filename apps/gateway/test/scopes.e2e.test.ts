import { mkdtempSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server as HttpServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ingestOpenApi } from "@protocolfoundry/discovery";
import { generateManifest } from "@protocolfoundry/generator";
import { FileVaultStore } from "@protocolfoundry/vault";
import { createGatewayApp } from "../src/app.js";
import { AuditLog } from "../src/audit.js";
import { createCredentialResolver } from "../src/credentials.js";
import { issueToken } from "../src/tokens.js";
import { createTaskboardApp } from "../../../examples/taskboard/upstream.js";

const SPEC_PATH = join(import.meta.dirname, "../../../examples/taskboard/openapi.json");
const UPSTREAM_KEY = "demo-upstream-key";
const TOKEN_SECRET = randomBytes(32).toString("base64");

const dir = mkdtempSync(join(tmpdir(), "pf-scopes-"));
let upstream: HttpServer;
let gateway: HttpServer;
let baseUrl: string;

function listen(server: HttpServer): Promise<number> {
  return new Promise((resolve) => {
    server.on("listening", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

async function connect(token: string): Promise<Client> {
  const client = new Client({ name: "scopes-e2e", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/taskboard`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

const text = (r: Awaited<ReturnType<Client["callTool"]>>): string =>
  (r.content as Array<{ text?: string }>)[0]?.text ?? "";

beforeAll(async () => {
  upstream = createTaskboardApp(UPSTREAM_KEY).listen(0);
  const upstreamPort = await listen(upstream);

  const graph = ingestOpenApi(await readFile(SPEC_PATH, "utf8"), "taskboard", "src");
  const manifest = generateManifest(
    graph,
    { operationIds: graph.operations.map((op) => op.id), taskFlowIds: [] },
    { serverName: "taskboard", baseUrls: { default: `http://localhost:${upstreamPort}` } },
  );

  // Upstream credential comes from the encrypted vault — NOT the environment.
  delete process.env["PF_CRED_APIKEYAUTH"];
  const vault = new FileVaultStore(join(dir, "vault.json"), randomBytes(32).toString("base64"));
  await vault.set("PF_CRED_APIKEYAUTH", UPSTREAM_KEY);

  gateway = createGatewayApp([manifest], {
    audit: new AuditLog(join(dir, "audit.jsonl")),
    tokenSecret: TOKEN_SECRET,
    resolveCredential: createCredentialResolver(vault),
    authorizationServers: ["https://auth.example.com"],
  }).listen(0);
  baseUrl = `http://localhost:${await listen(gateway)}`;
});

afterAll(async () => {
  upstream?.close();
  gateway?.close();
  await rm(dir, { recursive: true, force: true });
});

describe("scoped tokens + vault credentials", () => {
  it("read-scope token can read (via vault credential) but not write", async () => {
    const readToken = issueToken(TOKEN_SECRET, {
      server: "taskboard",
      scopes: ["read"],
      ttlMs: 60_000,
    });
    const client = await connect(readToken);
    try {
      const list = await client.callTool({ name: "list_tasks", arguments: {} });
      expect(list.isError).toBeFalsy(); // upstream auth came from the vault

      const create = await client.callTool({
        name: "create_task",
        arguments: { title: "should be denied" },
      });
      expect(create.isError).toBe(true);
      expect(text(create)).toContain("Insufficient scope");
      expect(text(create)).toContain("write");
    } finally {
      await client.close();
    }
  });

  it("write-scope token can create tasks", async () => {
    const writeToken = issueToken(TOKEN_SECRET, {
      server: "taskboard",
      scopes: ["read", "write"],
      ttlMs: 60_000,
    });
    const client = await connect(writeToken);
    try {
      const create = await client.callTool({
        name: "create_task",
        arguments: { title: "scoped write works" },
      });
      expect(create.isError).toBeFalsy();
    } finally {
      await client.close();
    }
  });

  it("rejects expired, wrong-server, and garbage tokens with WWW-Authenticate", async () => {
    const expired = issueToken(TOKEN_SECRET, { server: "taskboard", scopes: ["read"], ttlMs: -1 });
    const wrongServer = issueToken(TOKEN_SECRET, { server: "otherapp", scopes: ["read"], ttlMs: 60_000 });
    for (const bad of [expired, wrongServer, "garbage"]) {
      const response = await fetch(`${baseUrl}/mcp/taskboard`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bad}`,
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
      });
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("resource_metadata=");
    }
  });

  it("serves RFC 9728 protected resource metadata with the tool scopes", async () => {
    const response = await fetch(
      `${baseUrl}/.well-known/oauth-protected-resource/mcp/taskboard`,
    );
    expect(response.status).toBe(200);
    const metadata = (await response.json()) as Record<string, unknown>;
    expect(metadata["resource"]).toContain("/mcp/taskboard");
    expect(metadata["authorization_servers"]).toEqual(["https://auth.example.com"]);
    expect(metadata["scopes_supported"]).toEqual(["destructive", "read", "write"]);
  });
});
