import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Server as HttpServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { JsonlAuditStore } from "@protocolfoundry/audit";
import { ingestOpenApi } from "@protocolfoundry/discovery";
import { generateManifest } from "@protocolfoundry/generator";
import { FileReleaseStore } from "@protocolfoundry/releases";
import type { AgentModel, AgentTurn } from "@protocolfoundry/evals";
import { startEvalJob, readEvalJob } from "../src/lib/eval-jobs";
import { saveEvalSuite } from "../src/lib/workspace";
import { createTaskboardApp } from "../../../examples/taskboard/upstream.js";

/**
 * Dashboard eval job e2e (ADR-0008): staged release + uploaded suite ->
 * job hosts the manifest on an ephemeral loopback gateway, runs the agent
 * loop, attaches the EvalRun to the release, records progress + audit.
 * Scripted agent — no API key.
 */

const SPEC_PATH = join(import.meta.dirname, "../../../examples/taskboard/openapi.json");
const UPSTREAM_KEY = "demo-upstream-key";

let workDir: string;
let upstream: HttpServer;
let store: FileReleaseStore;
let audit: JsonlAuditStore;
let auditPath: string;

function createScriptedAgent(): AgentModel {
  return {
    model: "scripted-test-agent",
    async turn(messages, _tools): Promise<AgentTurn> {
      const turnNumber = messages.filter((m) => m.role === "user").length;
      if (turnNumber === 1) {
        const input = { title: "Eval harness task" };
        messages.push({
          role: "assistant",
          content: [{ type: "tool_use", id: "call_1", name: "create_task", input }],
        });
        return {
          text: "",
          toolCalls: [{ id: "call_1", name: "create_task", input }],
          inputTokens: 100,
          outputTokens: 20,
        };
      }
      if (turnNumber === 2) {
        const lastResult = messages[messages.length - 2];
        const blocks = lastResult?.content as Anthropic.ToolResultBlockParam[];
        const created = JSON.parse(String(blocks[0]?.content ?? "{}")) as { id: string };
        const input = { id: created.id };
        messages.push({
          role: "assistant",
          content: [{ type: "tool_use", id: "call_2", name: "complete_task", input }],
        });
        return {
          text: "",
          toolCalls: [{ id: "call_2", name: "complete_task", input }],
          inputTokens: 150,
          outputTokens: 25,
        };
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

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "pf-evaljobs-"));
  process.env["PF_WORKSPACE_DIR"] = join(workDir, "workspace");
  auditPath = join(workDir, "audit.jsonl");
  audit = new JsonlAuditStore(auditPath);
  store = new FileReleaseStore(join(workDir, "releases"));

  upstream = createTaskboardApp(UPSTREAM_KEY).listen(0);
  const upstreamPort = await new Promise<number>((resolve) => {
    upstream.once("listening", () => {
      const address = upstream.address();
      resolve(typeof address === "object" && address ? address.port : 0);
    });
  });

  const graph = ingestOpenApi(await readFile(SPEC_PATH, "utf8"), "taskboard", "src-evaljob");
  const manifest = generateManifest(
    graph,
    { operationIds: graph.operations.map((op) => op.id), taskFlowIds: [] },
    { serverName: "taskboard", baseUrls: { default: `http://localhost:${upstreamPort}` } },
  );
  process.env["PF_CRED_APIKEYAUTH"] = UPSTREAM_KEY;
  await store.createRelease(manifest); // forge-style: staged, no eval

  await saveEvalSuite("taskboard", {
    name: "taskboard-basics",
    tasks: [
      {
        id: "create-complete",
        description: "Create a task and mark it complete",
        prompt: "Create a task titled 'Eval harness task' and mark it complete.",
        expectedTools: ["create_task", "complete_task"],
        successPattern: "completed successfully",
      },
    ],
  });
});

afterAll(async () => {
  upstream?.close();
  await rm(workDir, { recursive: true, force: true });
  delete process.env["PF_WORKSPACE_DIR"];
});

describe("dashboard eval jobs", () => {
  it("refuses to start without a staged release at that version", async () => {
    await expect(
      startEvalJob({ store, audit, projectId: "taskboard", version: 9, actorId: "operator" }),
    ).rejects.toThrow(/No release v9/);
  });

  it("runs the suite against an ephemeral gateway and attaches the eval to the release", async () => {
    const { job, run } = await startEvalJob({
      store,
      audit,
      projectId: "taskboard",
      version: 1,
      actorId: "operator",
      agent: createScriptedAgent(),
    });
    expect(job.status).toBe("running");
    expect(job.totalTasks).toBe(1);

    // double-launch guard while the job is active
    await expect(
      startEvalJob({ store, audit, projectId: "taskboard", version: 1, actorId: "operator" }),
    ).rejects.toThrow(/already running/);

    await run();

    const finished = await readEvalJob("taskboard", 1);
    expect(finished!.status).toBe("succeeded");
    expect(finished!.completedTasks).toBe(1);
    expect(finished!.evalRunId).toBeDefined();

    const evalRun = await store.getEvalRun("taskboard", 1);
    expect(evalRun!.id).toBe(finished!.evalRunId);
    expect(evalRun!.taskCompletionRate).toBe(1);
    expect(evalRun!.toolSelectionAccuracy).toBe(1);
    expect((await store.list("taskboard"))[0]!.evalRunId).toBe(evalRun!.id);

    // audit trail: the eval's tool calls went through a real gateway, plus
    // the completion event — and no upstream secret leaked into the log
    const lines = (await readFile(auditPath, "utf8")).trim().split("\n");
    const events = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
    const kinds = events.map((e) => e["kind"]);
    expect(kinds).toContain("toolInvocation");
    expect(kinds).toContain("evalCompleted");
    expect(JSON.stringify(events)).not.toContain(UPSTREAM_KEY);
    const completed = events.find((e) => e["kind"] === "evalCompleted")!;
    expect((completed["detail"] as Record<string, unknown>)["taskCompletionRate"]).toBe(1);
  });

  it("runs an eval on a live (promoted) release too, attaching the new run", async () => {
    // a promoted server can be re-graded — eval is no longer staged-only
    await store.promote("taskboard", 1);
    const { job, run } = await startEvalJob({
      store,
      audit,
      projectId: "taskboard",
      version: 1,
      actorId: "operator",
      agent: createScriptedAgent(),
    });
    expect(job.status).toBe("running");
    await run();

    const finished = await readEvalJob("taskboard", 1);
    expect(finished!.status).toBe("succeeded");
    const live = (await store.list("taskboard")).find((r) => r.version === 1);
    expect(live!.status).toBe("live");
    expect(live!.evalRunId).toBe(finished!.evalRunId);
  });
});
