import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server as HttpServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ingestOpenApi } from "@protocolfoundry/discovery";
import { generateManifest } from "@protocolfoundry/generator";
import { createGatewayApp } from "../src/app.js";
import { AuditLog } from "../src/audit.js";
import { createTaskboardApp } from "../../../examples/taskboard/upstream.js";

const SPEC_PATH = join(import.meta.dirname, "../../../examples/taskboard/openapi.json");
const UPSTREAM_API_KEY = "demo-upstream-key";
const GATEWAY_API_KEY = "gateway-secret";

const auditPath = join(tmpdir(), `pf-audit-${Date.now()}.jsonl`);
let upstream: HttpServer;
let gateway: HttpServer;
let gatewayUrl: URL;

function listen(server: HttpServer): Promise<number> {
  return new Promise((resolve) => {
    server.on("listening", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

async function connectClient(apiKey?: string): Promise<Client> {
  const client = new Client({ name: "e2e-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(gatewayUrl, {
    requestInit: apiKey ? { headers: { Authorization: `Bearer ${apiKey}` } } : {},
  });
  await client.connect(transport);
  return client;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content[0]?.text ?? "";
}

beforeAll(async () => {
  // 1. Upstream SaaS app the customer owns (API-key protected)
  upstream = createTaskboardApp(UPSTREAM_API_KEY).listen(0);
  const upstreamPort = await listen(upstream);

  // 2. Pipeline: OpenAPI spec -> workflow graph -> manifest
  const raw = await readFile(SPEC_PATH, "utf8");
  const graph = ingestOpenApi(raw, "taskboard", "src-e2e");
  const manifest = generateManifest(
    graph,
    { operationIds: graph.operations.map((op) => op.id), taskFlowIds: [] },
    { serverName: "taskboard", baseUrls: { default: `http://localhost:${upstreamPort}` } },
  );

  // 3. Upstream credential is connected explicitly (env vault, Phase 1)
  process.env["PF_CRED_APIKEYAUTH"] = UPSTREAM_API_KEY;

  // 4. Gateway hosts the manifest behind its own inbound API key
  const app = createGatewayApp([manifest], {
    audit: new AuditLog(auditPath),
    apiKey: GATEWAY_API_KEY,
  });
  gateway = app.listen(0);
  const gatewayPort = await listen(gateway);
  gatewayUrl = new URL(`http://localhost:${gatewayPort}/mcp/taskboard`);
});

afterAll(async () => {
  upstream?.close();
  gateway?.close();
  await rm(auditPath, { force: true });
});

describe("spec -> graph -> manifest -> hosted MCP server", () => {
  it("rejects agents that do not present the gateway API key", async () => {
    await expect(connectClient(undefined)).rejects.toThrow(/401|Unauthorized/i);
    await expect(connectClient("wrong-key")).rejects.toThrow(/401|Unauthorized/i);
  });

  it("lets an authorized agent complete a real multi-step task", async () => {
    const client = await connectClient(GATEWAY_API_KEY);
    try {
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([
        "complete_task",
        "create_task",
        "delete_task",
        "get_task",
        "list_tasks",
      ]);

      // create -> read back -> complete: the Phase 1 exit criterion
      const created = await client.callTool({
        name: "create_task",
        arguments: { title: "Ship Phase 1", assignee: "satya" },
      });
      expect(created.isError).toBeFalsy();
      const task = JSON.parse(textOf(created)) as { id: string; done: boolean };
      expect(task.done).toBe(false);

      const listed = await client.callTool({ name: "list_tasks", arguments: {} });
      expect(textOf(listed)).toContain("Ship Phase 1");

      const completed = await client.callTool({
        name: "complete_task",
        arguments: { id: task.id },
      });
      expect((JSON.parse(textOf(completed)) as { done: boolean }).done).toBe(true);

      const filtered = await client.callTool({
        name: "list_tasks",
        arguments: { done: true },
      });
      expect(textOf(filtered)).toContain(task.id);
    } finally {
      await client.close();
    }
  });

  it("blocks destructive tools behind the approval gate", async () => {
    const client = await connectClient(GATEWAY_API_KEY);
    try {
      const result = await client.callTool({
        name: "delete_task",
        arguments: { id: "anything" },
      });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("approval");
    } finally {
      await client.close();
    }
  });

  it("records every invocation in the audit log with hashed args", async () => {
    const lines = (await readFile(auditPath, "utf8")).trim().split("\n");
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(events.length).toBeGreaterThanOrEqual(5);

    const kinds = new Set(events.map((e) => e["kind"]));
    expect(kinds.has("toolInvocation")).toBe(true);
    expect(kinds.has("approvalDenied")).toBe(true);

    for (const event of events) {
      const detail = event["detail"] as Record<string, unknown>;
      expect(detail["argsSha256"]).toMatch(/^[a-f0-9]{64}$/);
      expect(JSON.stringify(event)).not.toContain(UPSTREAM_API_KEY);
    }
  });
});
