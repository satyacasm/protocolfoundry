import { describe, expect, it } from "vitest";
import { McpServerManifest } from "@protocolfoundry/core";
import { generateCoverageSuite } from "../src/coverage.js";
import { parseEvalSuite } from "../src/runner.js";

function tool(name: string, scopes: string[], approval: "none" | "perCall" = "none") {
  return {
    name,
    description: `${name} tool.`,
    inputSchema: { type: "object", properties: {} },
    plan: [{ operationId: name }],
    requiredScopes: scopes,
    approval,
  };
}

const manifest = McpServerManifest.parse({
  manifestVersion: 1,
  projectId: "cov",
  serverName: "cov",
  serverDescription: "Coverage test server",
  baseUrls: { default: "https://api.example.com" },
  upstreamOperations: Object.fromEntries(
    ["list_items", "get_item", "create_item", "delete_item"].map((n) => [
      n,
      { method: "GET", pathTemplate: `/${n}` },
    ]),
  ),
  tools: [
    tool("list_items", ["read"]),
    tool("get_item", ["read"]),
    tool("create_item", ["write"]),
    tool("delete_item", ["destructive"], "perCall"),
  ],
  credentialBindings: [],
  workflowGraphRef: "graph:test",
  createdAt: new Date().toISOString(),
});

describe("generateCoverageSuite", () => {
  it("creates one row per tool: live for reads, blocked probe for gated, skips writes", () => {
    const { suite, skippedWriteTools } = generateCoverageSuite(manifest);

    expect(suite.name).toBe("cov-coverage");
    expect(suite.tasks.map((t) => t.id)).toEqual([
      "cover_list_items",
      "cover_get_item",
      "cover_delete_item",
    ]);
    expect(skippedWriteTools).toEqual(["create_item"]);

    const read = suite.tasks.find((t) => t.id === "cover_list_items")!;
    expect(read.expectedTools).toEqual(["list_items"]);
    expect(read.successPattern).toMatch(/OK/);

    const gated = suite.tasks.find((t) => t.id === "cover_delete_item")!;
    expect(gated.successPattern).toMatch(/BLOCKED/);

    // output is a valid uploadable suite
    expect(parseEvalSuite(JSON.stringify(suite)).tasks).toHaveLength(3);
  });

  it("includes write tools only when explicitly asked", () => {
    const { suite, skippedWriteTools } = generateCoverageSuite(manifest, { includeWrites: true });
    expect(suite.tasks.map((t) => t.id)).toContain("cover_create_item");
    expect(skippedWriteTools).toEqual([]);
  });

  it("refuses to emit an empty suite", () => {
    const writesOnly = McpServerManifest.parse({
      ...manifest,
      tools: [tool("create_item", ["write"])],
    });
    expect(() => generateCoverageSuite(writesOnly)).toThrow(/includeWrites/);
  });
});
