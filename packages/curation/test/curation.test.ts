import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ingestOpenApi } from "@protocolfoundry/discovery";
import { applyCuration } from "../src/apply.js";
import { proposeCuration, type Curator, type RawProposal } from "../src/propose.js";

const SPEC_PATH = join(import.meta.dirname, "../../../examples/taskboard/openapi.json");

async function taskboardGraph() {
  return ingestOpenApi(await readFile(SPEC_PATH, "utf8"), "taskboard", "src-1");
}

const CANNED: RawProposal = {
  refinements: [
    {
      operationId: "createTask",
      toolName: "create_task",
      description: "Create a new task on the board. Call when the user wants to add work.",
    },
    {
      operationId: "completeTask",
      toolName: "mark_task_done",
      description: "Mark an existing task as done. Call with the task id.",
    },
    {
      operationId: "deleteTask",
      toolName: "delete_task",
      description: "Permanently delete a task.",
    },
    {
      // The model hallucinating an operation must be filtered out, not shipped.
      operationId: "notARealOperation",
      toolName: "bogus",
      description: "should be dropped",
    },
  ],
  composedTools: [
    {
      name: "create_and_complete_task",
      description: "Create a task and immediately mark it done. Use for logging already-finished work.",
      arguments: [
        { name: "title", type: "string", description: "Task title", required: true },
      ],
      steps: [
        { operationId: "createTask", bindings: [{ arg: "title", expression: "$args.title" }] },
        { operationId: "completeTask", bindings: [{ arg: "id", expression: "$steps[0].output.id" }] },
      ],
      rationale: "Users often log work that is already finished.",
    },
    {
      name: "uses_unknown_op",
      description: "must be dropped",
      arguments: [],
      steps: [{ operationId: "ghostOp", bindings: [] }],
      rationale: "hallucinated",
    },
  ],
  warnings: [{ operationId: "deleteTask", reason: "Irreversible deletion exposed to agents" }],
};

const fakeCurator: Curator = {
  model: "fake-curator",
  async propose() {
    return CANNED;
  },
};

describe("proposeCuration", () => {
  it("produces a validated proposal and drops hallucinated operations", async () => {
    const graph = await taskboardGraph();
    const proposal = await proposeCuration(
      graph,
      ["createTask", "completeTask", "deleteTask"],
      fakeCurator,
    );
    expect(proposal.refinements.map((r) => r.operationId)).toEqual([
      "createTask",
      "completeTask",
      "deleteTask",
    ]);
    expect(proposal.composedTools.map((t) => t.name)).toEqual(["create_and_complete_task"]);
    expect(proposal.proposedBy).toBe("fake-curator");
    expect(proposal.warnings).toHaveLength(1);
  });

  it("rejects selections referencing unknown operations", async () => {
    const graph = await taskboardGraph();
    await expect(proposeCuration(graph, ["nope"], fakeCurator)).rejects.toThrow(
      /Unknown operation ids/,
    );
  });
});

describe("applyCuration", () => {
  it("builds a curated manifest with refined names and composed multi-step tools", async () => {
    const graph = await taskboardGraph();
    const proposal = await proposeCuration(
      graph,
      ["createTask", "completeTask", "deleteTask"],
      fakeCurator,
    );
    const manifest = applyCuration(
      graph,
      proposal,
      { refinementOperationIds: "all", composedToolNames: "all" },
      { serverName: "taskboard-curated" },
    );

    expect(manifest.tools.map((t) => t.name).sort()).toEqual([
      "create_and_complete_task",
      "create_task",
      "delete_task",
      "mark_task_done",
    ]);

    const composedTool = manifest.tools.find((t) => t.name === "create_and_complete_task")!;
    expect(composedTool.plan).toEqual([
      { operationId: "createTask", inputBindings: { title: "$args.title" } },
      { operationId: "completeTask", inputBindings: { id: "$steps[0].output.id" } },
    ]);
    expect(composedTool.approval).toBe("none");

    // curated description replaced the naive one
    const done = manifest.tools.find((t) => t.name === "mark_task_done")!;
    expect(done.description).toContain("Call with the task id");

    // destructive 1:1 tool keeps its gate after curation
    expect(manifest.tools.find((t) => t.name === "delete_task")!.approval).toBe("perCall");
  });

  it("supports partial approval and gates compositions containing destructive steps", async () => {
    const graph = await taskboardGraph();
    const proposal = await proposeCuration(
      graph,
      ["createTask", "completeTask", "deleteTask"],
      fakeCurator,
    );
    const manifest = applyCuration(graph, proposal, {
      refinementOperationIds: ["createTask"],
      composedToolNames: [],
    });
    expect(manifest.tools.map((t) => t.name)).toEqual(["create_task"]);

    // a composition with a delete step inherits the approval gate
    const destructiveProposal = {
      ...proposal,
      composedTools: [
        {
          name: "purge_task",
          description: "delete by id",
          arguments: [{ name: "id", type: "string" as const, description: "id", required: true }],
          steps: [{ operationId: "deleteTask", bindings: [{ arg: "id", expression: "$args.id" }] }],
          rationale: "test",
        },
      ],
    };
    const gated = applyCuration(graph, destructiveProposal, {
      refinementOperationIds: ["createTask"],
      composedToolNames: "all",
    });
    expect(gated.tools.find((t) => t.name === "purge_task")!.approval).toBe("perCall");
    // and the manifest stayed self-contained: deleteTask op was pulled in
    expect(gated.upstreamOperations["deleteTask"]).toBeDefined();
  });
});
