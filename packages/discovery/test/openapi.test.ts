import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ingestOpenApi } from "../src/openapi.js";

const SPEC_PATH = join(import.meta.dirname, "../../../examples/taskboard/openapi.json");

describe("ingestOpenApi", () => {
  it("ingests the taskboard spec into a workflow graph", async () => {
    const raw = await readFile(SPEC_PATH, "utf8");
    const graph = ingestOpenApi(raw, "taskboard", "src-1");

    expect(graph.baseUrls).toEqual({ default: "http://localhost:4810" });
    expect(graph.operations.map((op) => op.id).sort()).toEqual([
      "completeTask",
      "createTask",
      "deleteTask",
      "getTask",
      "listTasks",
    ]);

    const createTask = graph.operations.find((op) => op.id === "createTask")!;
    expect(createTask.effect).toBe("create");
    expect(createTask.parameterLocations).toEqual({ title: "body", assignee: "body" });
    expect(createTask.inputSchema?.["required"]).toEqual(["title"]);
    expect(createTask.authRequirementIds).toEqual(["ApiKeyAuth"]);

    const getTask = graph.operations.find((op) => op.id === "getTask")!;
    expect(getTask.parameterLocations).toEqual({ id: "path" });
    expect(getTask.effect).toBe("read");

    const listTasks = graph.operations.find((op) => op.id === "listTasks")!;
    expect(listTasks.parameterLocations).toEqual({ done: "query" });
    // $ref to #/components/schemas/Task must be resolved, not left dangling
    expect(JSON.stringify(listTasks.outputSchema)).not.toContain("$ref");

    const deleteTask = graph.operations.find((op) => op.id === "deleteTask")!;
    expect(deleteTask.effect).toBe("delete");

    expect(graph.authRequirements).toEqual([
      { id: "ApiKeyAuth", kind: "apiKey", detail: { in: "header", name: "X-API-Key" } },
    ]);
  });

  it("parses YAML specs and rejects non-3.x versions", () => {
    const yamlSpec = [
      "openapi: 3.0.0",
      "info: {title: Mini, version: '1'}",
      "servers: [{url: 'https://api.example.com'}]",
      "paths:",
      "  /ping:",
      "    get:",
      "      operationId: ping",
      "      responses: {'200': {description: ok}}",
    ].join("\n");
    const graph = ingestOpenApi(yamlSpec, "mini", "src-1");
    expect(graph.operations).toHaveLength(1);
    expect(graph.operations[0]!.id).toBe("ping");

    expect(() => ingestOpenApi('{"swagger": "2.0"}', "p", "s")).toThrow(/only 3\.x/);
  });
});
