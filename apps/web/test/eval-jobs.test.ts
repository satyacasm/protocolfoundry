import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AuditSink } from "@protocolfoundry/audit";
import { McpServerManifest } from "@protocolfoundry/core";
import type { AgentModel, EvalSuite } from "@protocolfoundry/evals";
import { FileReleaseStore } from "@protocolfoundry/releases";
import { startEvalJob } from "../src/lib/eval-jobs";
import { getEvalJob } from "../src/lib/workspace";

/**
 * Full dashboard eval loop without an API key: scripted agent, mock upstream,
 * ephemeral in-process gateway, EvalRun attached to a temp release store.
 */

let upstream: Server;
let upstreamPort: number;
let workDir: string;
let store: FileReleaseStore;

const recorded: string[] = [];
const audit: AuditSink = {
  record: async (event) => {
    recorded.push(event.kind);
    return {
      id: "test",
      tenantId: "test",
      actor: event.actor,
      kind: event.kind,
      detail: event.detail ?? {},
      occurredAt: new Date().toISOString(),
      ...(event.projectId ? { projectId: event.projectId } : {}),
    };
  },
  hashArgs: () => "test-hash",
};

const suite: EvalSuite = {
  name: "smoke",
  tasks: [
    {
      id: "ping-task",
      description: "Ping the upstream",
      prompt: "Ping the service and report the result.",
      expectedTools: ["ping"],
      successPattern: "pong",
    },
  ],
};

/** Calls the ping tool once, then reports the result. */
const scriptedAgent: AgentModel = {
  model: "scripted-test-agent",
  async turn(messages) {
    const calledBefore = messages.some(
      (m) => Array.isArray(m.content) && m.content.some((b) => b.type === "tool_result"),
    );
    if (calledBefore) {
      return { text: "The service replied pong.", toolCalls: [], inputTokens: 10, outputTokens: 5 };
    }
    messages.push({ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "ping", input: {} }] });
    return {
      text: "",
      toolCalls: [{ id: "t1", name: "ping", input: {} }],
      inputTokens: 10,
      outputTokens: 5,
    };
  },
};

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pf-evaljob-"));
  process.env.PF_WORKSPACE_DIR = join(workDir, "workspace");
  store = new FileReleaseStore(join(workDir, "releases"));

  upstreamPort = await new Promise<number>((resolve) => {
    upstream = createServer((_req, res) => {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ pong: true }));
    }).listen(0, "127.0.0.1", () => {
      const address = upstream.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });

  const manifest = McpServerManifest.parse({
    manifestVersion: 1,
    projectId: "pingdemo",
    serverName: "pingdemo",
    serverDescription: "Eval job test server",
    baseUrls: { default: `http://127.0.0.1:${upstreamPort}` },
    upstreamOperations: { ping: { method: "GET", pathTemplate: "/ping" } },
    tools: [
      {
        name: "ping",
        description: "Ping the service.",
        inputSchema: { type: "object", properties: {} },
        plan: [{ operationId: "ping" }],
      },
    ],
    credentialBindings: [],
    workflowGraphRef: "graph:test",
    createdAt: new Date().toISOString(),
  });
  await store.createRelease(manifest, { force: true, approvedBy: "test" });
});

afterAll(async () => {
  upstream?.close();
  delete process.env.PF_WORKSPACE_DIR;
  await rm(workDir, { recursive: true, force: true });
});

describe("startEvalJob", () => {
  it("runs the suite against an ephemeral gateway and attaches the EvalRun", async () => {
    const { state, done } = await startEvalJob("pingdemo", 1, "test-operator", {
      agent: scriptedAgent,
      releaseStore: store,
      audit,
      suite,
    });
    expect(state.status).toBe("running");
    expect(state.totalTasks).toBe(1);

    const finished = await done;
    expect(finished.status).toBe("succeeded");
    expect(finished.completedTasks).toBe(1);

    const run = await store.getEvalRun("pingdemo", 1);
    expect(run).toBeDefined();
    expect(run!.taskCompletionRate).toBe(1);
    expect(run!.toolSelectionAccuracy).toBe(1);
    expect(run!.agentModel).toBe("scripted-test-agent");
    expect((await store.list("pingdemo"))[0]!.evalRunId).toBe(run!.id);

    // job state persisted for the dashboard, audit trail written
    const job = await getEvalJob("pingdemo");
    expect(job?.status).toBe("succeeded");
    expect(job?.evalRunId).toBe(run!.id);
    expect(recorded).toContain("evalCompleted");
    expect(recorded).toContain("toolInvocation");
  });

  it("refuses to start without a suite or while a job is running", async () => {
    await expect(
      startEvalJob("nosuite", 1, "test-operator", { agent: scriptedAgent, releaseStore: store, audit }),
    ).rejects.toThrow(/No eval suite/);
  });
});
