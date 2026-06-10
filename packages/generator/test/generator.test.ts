import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ingestOpenApi } from "@protocolfoundry/discovery";
import { generateManifest } from "../src/index.js";

const SPEC_PATH = join(import.meta.dirname, "../../../examples/taskboard/openapi.json");

async function taskboardGraph() {
  return ingestOpenApi(await readFile(SPEC_PATH, "utf8"), "taskboard", "src-1");
}

describe("generateManifest", () => {
  it("generates 1:1 tools with snake_case names and identity bindings", async () => {
    const graph = await taskboardGraph();
    const manifest = generateManifest(
      graph,
      { operationIds: graph.operations.map((op) => op.id), taskFlowIds: [] },
      { serverName: "taskboard" },
    );

    expect(manifest.serverName).toBe("taskboard");
    expect(manifest.tools.map((t) => t.name).sort()).toEqual([
      "complete_task",
      "create_task",
      "delete_task",
      "get_task",
      "list_tasks",
    ]);

    const createTool = manifest.tools.find((t) => t.name === "create_task")!;
    expect(createTool.plan).toEqual([
      {
        operationId: "createTask",
        inputBindings: { title: "$args.title", assignee: "$args.assignee" },
      },
    ]);

    // destructive operations get an approval gate by default
    expect(manifest.tools.find((t) => t.name === "delete_task")!.approval).toBe("perCall");
    expect(manifest.tools.find((t) => t.name === "list_tasks")!.approval).toBe("none");

    // manifest is self-contained: upstream ops + auth schemes + credentials
    expect(Object.keys(manifest.upstreamOperations)).toHaveLength(5);
    expect(manifest.authSchemes["ApiKeyAuth"]?.kind).toBe("apiKey");
    expect(manifest.credentialBindings).toEqual([
      { authRequirementId: "ApiKeyAuth", vaultCredentialId: "env:PF_CRED_APIKEYAUTH" },
    ]);
  });

  it("supports curation subsets and rejects unknown or empty selections", async () => {
    const graph = await taskboardGraph();
    const manifest = generateManifest(graph, {
      operationIds: ["listTasks", "createTask"],
      taskFlowIds: [],
    });
    expect(manifest.tools).toHaveLength(2);
    expect(Object.keys(manifest.upstreamOperations).sort()).toEqual([
      "createTask",
      "listTasks",
    ]);

    expect(() =>
      generateManifest(graph, { operationIds: ["nope"], taskFlowIds: [] }),
    ).toThrow(/Unknown operation ids/);
    expect(() => generateManifest(graph, { operationIds: [], taskFlowIds: [] })).toThrow(
      /Selection is empty/,
    );
  });
});
