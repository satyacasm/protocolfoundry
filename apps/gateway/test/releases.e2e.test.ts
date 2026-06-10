import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { EvalRun } from "@protocolfoundry/core";
import { ingestOpenApi } from "@protocolfoundry/discovery";
import { generateManifest } from "@protocolfoundry/generator";
import { FileReleaseStore, releaseManifestSource } from "@protocolfoundry/releases";
import { createGatewayApp } from "../src/app.js";
import { AuditLog } from "../src/audit.js";

const SPEC_PATH = join(import.meta.dirname, "../../../examples/taskboard/openapi.json");
const GATEWAY_KEY = "gateway-secret";
const GATE = { minTaskCompletionRate: 0.8, minToolSelectionAccuracy: 0.8 };

let rootDir: string;
let store: FileReleaseStore;
let gateway: HttpServer;
let gatewayUrl: string;

const passingEval = (): EvalRun => ({
  id: randomUUID(),
  projectId: "taskboard",
  manifestRef: "test",
  agentModel: "scripted",
  results: [],
  taskCompletionRate: 1,
  toolSelectionAccuracy: 1,
  ranAt: new Date().toISOString(),
});

async function listToolNames(): Promise<string[]> {
  const client = new Client({ name: "releases-e2e", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(gatewayUrl), {
      requestInit: { headers: { Authorization: `Bearer ${GATEWAY_KEY}` } },
    }),
  );
  try {
    const { tools } = await client.listTools();
    return tools.map((t) => t.name).sort();
  } finally {
    await client.close();
  }
}

beforeAll(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "pf-rel-e2e-"));
  store = new FileReleaseStore(rootDir);

  const graph = ingestOpenApi(await readFile(SPEC_PATH, "utf8"), "taskboard", "src");
  const allOps = graph.operations.map((op) => op.id);

  // v1: read-only subset; v2: everything — distinguishable tool lists.
  const v1 = generateManifest(
    graph,
    { operationIds: ["listTasks", "getTask"], taskFlowIds: [] },
    { serverName: "taskboard" },
  );
  const v2 = generateManifest(
    graph,
    { operationIds: allOps, taskFlowIds: [] },
    { serverName: "taskboard" },
  );
  await store.createRelease(v1, { evalRun: passingEval(), gate: GATE });
  await store.createRelease(v2, { evalRun: passingEval(), gate: GATE });
  await store.promote("taskboard", 1);

  // cacheTtlMs 0: re-check the index every request (test determinism).
  const gatewayApp = createGatewayApp(releaseManifestSource(store, 0), {
    audit: new AuditLog(join(rootDir, "audit.jsonl")),
    apiKey: GATEWAY_KEY,
  });
  gateway = gatewayApp.listen(0);
  const port = await new Promise<number>((resolve) => {
    gateway.on("listening", () => {
      const address = gateway.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
  gatewayUrl = `http://localhost:${port}/mcp/taskboard`;
});

afterAll(async () => {
  gateway?.close();
  await rm(rootDir, { recursive: true, force: true });
});

describe("gateway serving live releases", () => {
  it("serves the live release, hot-swaps on promote, and hot-reverts on rollback", async () => {
    // v1 live: read-only tools
    expect(await listToolNames()).toEqual(["get_task", "list_tasks"]);

    // promote v2 — no gateway restart
    await store.promote("taskboard", 2);
    expect(await listToolNames()).toEqual([
      "complete_task",
      "create_task",
      "delete_task",
      "get_task",
      "list_tasks",
    ]);

    // rollback — instantly back to v1's surface
    await store.rollback("taskboard");
    expect(await listToolNames()).toEqual(["get_task", "list_tasks"]);
  });

  it("returns 404 for projects without a live release", async () => {
    const response = await fetch(gatewayUrl.replace("/taskboard", "/ghost"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GATEWAY_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
    });
    expect(response.status).toBe(404);
  });
});
