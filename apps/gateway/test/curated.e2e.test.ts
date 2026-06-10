import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server as HttpServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CurationProposal } from "@protocolfoundry/core";
import { applyCuration } from "@protocolfoundry/curation";
import { ingestOpenApi } from "@protocolfoundry/discovery";
import { createGatewayApp } from "../src/app.js";
import { AuditLog } from "../src/audit.js";
import { createTaskboardApp } from "../../../examples/taskboard/upstream.js";

const SPEC_PATH = join(import.meta.dirname, "../../../examples/taskboard/openapi.json");
const UPSTREAM_KEY = "demo-upstream-key";
const GATEWAY_KEY = "gateway-secret";

const auditPath = join(tmpdir(), `pf-audit-curated-${Date.now()}.jsonl`);
let upstream: HttpServer;
let gateway: HttpServer;
let client: Client;

function listen(server: HttpServer): Promise<number> {
  return new Promise((resolve) => {
    server.on("listening", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

beforeAll(async () => {
  upstream = createTaskboardApp(UPSTREAM_KEY).listen(0);
  const upstreamPort = await listen(upstream);

  const graph = ingestOpenApi(await readFile(SPEC_PATH, "utf8"), "taskboard", "src-e2e");
  // Hand-written proposal — same artifact shape the LLM curator produces.
  const proposal: CurationProposal = {
    proposalVersion: 1,
    projectId: "taskboard",
    refinements: [
      {
        operationId: "createTask",
        toolName: "create_task",
        description: "Create a task. Call when the user wants to add work to the board.",
      },
      {
        operationId: "completeTask",
        toolName: "mark_task_done",
        description: "Mark a task done by id.",
      },
    ],
    composedTools: [
      {
        name: "log_finished_task",
        description: "Create a task and immediately mark it done — for logging already-completed work in one call.",
        arguments: [
          { name: "title", type: "string", description: "Task title", required: true },
        ],
        steps: [
          { operationId: "createTask", bindings: [{ arg: "title", expression: "$args.title" }] },
          { operationId: "completeTask", bindings: [{ arg: "id", expression: "$steps[0].output.id" }] },
        ],
        rationale: "Common one-shot user request.",
      },
    ],
    warnings: [],
    proposedBy: "human",
    createdAt: new Date().toISOString(),
  };

  const manifest = applyCuration(
    graph,
    proposal,
    { refinementOperationIds: "all", composedToolNames: "all" },
    { serverName: "taskboard", baseUrls: { default: `http://localhost:${upstreamPort}` } },
  );

  process.env["PF_CRED_APIKEYAUTH"] = UPSTREAM_KEY;
  gateway = createGatewayApp([manifest], {
    audit: new AuditLog(auditPath),
    apiKey: GATEWAY_KEY,
  }).listen(0);
  const gatewayPort = await listen(gateway);

  client = new Client({ name: "curated-e2e", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`http://localhost:${gatewayPort}/mcp/taskboard`), {
      requestInit: { headers: { Authorization: `Bearer ${GATEWAY_KEY}` } },
    }),
  );
});

afterAll(async () => {
  await client?.close();
  upstream?.close();
  gateway?.close();
  await rm(auditPath, { force: true });
});

describe("curated manifest on the gateway", () => {
  it("executes a composed task-level tool as one agent call with two upstream steps", async () => {
    const result = await client.callTool({
      name: "log_finished_task",
      arguments: { title: "Wrote the Phase 2 eval harness" },
    });
    expect(result.isError).toBeFalsy();
    const content = result.content as Array<{ text?: string }>;
    const task = JSON.parse(content[0]?.text ?? "{}") as { id: string; done: boolean; title: string };
    // The $steps[0].output.id binding carried the created id into step 2.
    expect(task.done).toBe(true);
    expect(task.title).toBe("Wrote the Phase 2 eval harness");

    // Audit shows ONE tool invocation with TWO upstream calls.
    const lines = (await readFile(auditPath, "utf8")).trim().split("\n");
    const event = lines.map((l) => JSON.parse(l)).find(
      (e) => (e.detail as { tool?: string }).tool === "log_finished_task",
    ) as { detail: { upstream: unknown[] } };
    expect(event.detail.upstream).toHaveLength(2);
  });

  it("serves curated names and descriptions to agents", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(["create_task", "log_finished_task", "mark_task_done"]);
    expect(tools.find((t) => t.name === "mark_task_done")!.description).toBe(
      "Mark a task done by id.",
    );
  });
});
