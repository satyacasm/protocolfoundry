import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server as HttpServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ingestOpenApi } from "@protocolfoundry/discovery";
import { generateManifest } from "@protocolfoundry/generator";
import { AuditLog, createGatewayApp } from "@protocolfoundry/gateway";
import { renderComparisonReport, renderEvalReport } from "../src/report.js";
import { parseEvalSuite, runEvalSuite, type AgentModel, type AgentTurn } from "../src/runner.js";
import { createTaskboardApp } from "../../../examples/taskboard/upstream.js";

const SPEC_PATH = join(import.meta.dirname, "../../../examples/taskboard/openapi.json");
const UPSTREAM_KEY = "demo-upstream-key";
const GATEWAY_KEY = "gateway-secret";

const auditPath = join(tmpdir(), `pf-audit-evals-${Date.now()}.jsonl`);
let upstream: HttpServer;
let gateway: HttpServer;
let endpointUrl: string;

function listen(server: HttpServer): Promise<number> {
  return new Promise((resolve) => {
    server.on("listening", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });
}

/**
 * Scripted agent: turn 1 creates a task, turn 2 completes it using the id
 * parsed from the tool result, turn 3 reports. Exercises the full harness
 * loop (tool listing, execution, transcript, scoring) without an API key.
 */
function createScriptedAgent(): AgentModel {
  return {
    model: "scripted-test-agent",
    async turn(messages, _tools): Promise<AgentTurn> {
      const turnNumber = messages.filter((m) => m.role === "user").length;
      if (turnNumber === 1) {
        const turn: AgentTurn = {
          text: "",
          toolCalls: [{ id: "call_1", name: "create_task", input: { title: "Eval harness task" } }],
          inputTokens: 100,
          outputTokens: 20,
        };
        messages.push({
          role: "assistant",
          content: [{ type: "tool_use", id: "call_1", name: "create_task", input: turn.toolCalls[0]!.input }],
        });
        return turn;
      }
      if (turnNumber === 2) {
        const lastResult = messages[messages.length - 2]; // user msg with tool_result
        const blocks = lastResult?.content as Anthropic.ToolResultBlockParam[];
        const created = JSON.parse(String(blocks[0]?.content ?? "{}")) as { id: string };
        const turn: AgentTurn = {
          text: "",
          toolCalls: [{ id: "call_2", name: "complete_task", input: { id: created.id } }],
          inputTokens: 150,
          outputTokens: 25,
        };
        messages.push({
          role: "assistant",
          content: [{ type: "tool_use", id: "call_2", name: "complete_task", input: turn.toolCalls[0]!.input }],
        });
        return turn;
      }
      messages.push({ role: "assistant", content: "Task created and completed successfully." });
      return {
        text: "Task created and completed successfully.",
        toolCalls: [],
        inputTokens: 180,
        outputTokens: 15,
      };
    },
  };
}

/** Agent that answers immediately without using any tools (failure case). */
const lazyAgent: AgentModel = {
  model: "lazy-test-agent",
  async turn(messages) {
    messages.push({ role: "assistant", content: "I cannot do that." });
    return { text: "I cannot do that.", toolCalls: [], inputTokens: 50, outputTokens: 5 };
  },
};

beforeAll(async () => {
  upstream = createTaskboardApp(UPSTREAM_KEY).listen(0);
  const upstreamPort = await listen(upstream);

  const graph = ingestOpenApi(await readFile(SPEC_PATH, "utf8"), "taskboard", "src-evals");
  const manifest = generateManifest(
    graph,
    { operationIds: graph.operations.map((op) => op.id), taskFlowIds: [] },
    { serverName: "taskboard", baseUrls: { default: `http://localhost:${upstreamPort}` } },
  );

  process.env["PF_CRED_APIKEYAUTH"] = UPSTREAM_KEY;
  gateway = createGatewayApp([manifest], {
    audit: new AuditLog(auditPath),
    apiKey: GATEWAY_KEY,
  }).listen(0);
  const gatewayPort = await listen(gateway);
  endpointUrl = `http://localhost:${gatewayPort}/mcp/taskboard`;
});

afterAll(async () => {
  upstream?.close();
  gateway?.close();
  await rm(auditPath, { force: true });
});

const SUITE = {
  name: "taskboard-basics",
  tasks: [
    {
      id: "create-complete",
      description: "Create a task and mark it complete",
      prompt: "Create a task titled 'Eval harness task' and mark it complete. State the outcome.",
      expectedTools: ["create_task", "complete_task"],
      successPattern: "completed successfully",
    },
  ],
};

describe("runEvalSuite", () => {
  it("scores a capable agent at 100% completion and correct tool selection", async () => {
    const progress: Array<[string, number, number]> = [];
    const run = await runEvalSuite(
      SUITE,
      { url: endpointUrl, apiKey: GATEWAY_KEY },
      createScriptedAgent(),
      "manifest:test",
      "taskboard",
      {
        onResult: async (result, completed, total) => {
          progress.push([result.taskId, completed, total]);
        },
      },
    );
    expect(progress).toEqual([["create-complete", 1, 1]]);
    expect(run.taskCompletionRate).toBe(1);
    expect(run.toolSelectionAccuracy).toBe(1);
    expect(run.results[0]!.steps).toBe(3);
    expect(run.results[0]!.inputTokens).toBeGreaterThan(0);
    expect(run.agentModel).toBe("scripted-test-agent");

    const report = renderEvalReport(run, SUITE.name);
    expect(report).toContain("Task completion | **100%**");
  });

  it("scores a failing agent at 0% and records the failure reason", async () => {
    const run = await runEvalSuite(
      SUITE,
      { url: endpointUrl, apiKey: GATEWAY_KEY },
      lazyAgent,
      "manifest:test",
      "taskboard",
    );
    expect(run.taskCompletionRate).toBe(0);
    expect(run.toolSelectionAccuracy).toBe(0);
    expect(run.results[0]!.failureReason).toMatch(/did not match/);

    const good = await runEvalSuite(
      SUITE,
      { url: endpointUrl, apiKey: GATEWAY_KEY },
      createScriptedAgent(),
      "manifest:test",
      "taskboard",
    );
    const comparison = renderComparisonReport(run, good, {
      baseline: "naive",
      candidate: "curated",
    });
    expect(comparison).toContain("+100pp");
  });
});

describe("parseEvalSuite", () => {
  it("accepts valid suites (string or object) and rejects malformed ones", () => {
    expect(parseEvalSuite(JSON.stringify(SUITE)).tasks).toHaveLength(1);
    expect(parseEvalSuite(SUITE).name).toBe("taskboard-basics");
    expect(() => parseEvalSuite({ name: "empty", tasks: [] })).toThrow();
    expect(() => parseEvalSuite("not json")).toThrow();
    expect(() =>
      parseEvalSuite({
        name: "bad-regex",
        tasks: [{ ...SUITE.tasks[0], successPattern: "(" }],
      }),
    ).toThrow();
  });
});
