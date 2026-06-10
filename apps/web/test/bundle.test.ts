import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { McpServerManifest, Release, type EvalRun } from "@protocolfoundry/core";
import { buildConnectionBundle, extractSpecCandidates, looksLikeZip } from "../src/lib/bundle";

const manifest = McpServerManifest.parse({
  manifestVersion: 1,
  projectId: "demo",
  serverName: "demo",
  serverDescription: "Demo server for bundle tests.",
  baseUrls: { default: "https://api.example.com" },
  upstreamOperations: {
    listThings: { method: "GET", pathTemplate: "/things" },
    makeThing: { method: "POST", pathTemplate: "/things" },
  },
  tools: [
    {
      name: "list_things",
      description: "List things.",
      inputSchema: { type: "object", properties: {} },
      plan: [{ operationId: "listThings" }],
      requiredScopes: ["read"],
    },
    {
      name: "make_thing",
      description: "Create a thing.",
      inputSchema: { type: "object", properties: {} },
      plan: [{ operationId: "makeThing" }],
      requiredScopes: ["write"],
      approval: "perCall",
    },
  ],
  credentialBindings: [],
  workflowGraphRef: "graph:test",
  createdAt: new Date().toISOString(),
});

const release = Release.parse({
  id: "rel-1",
  projectId: "demo",
  manifestRef: "manifest:test",
  version: 3,
  status: "live",
  createdAt: new Date().toISOString(),
});

describe("buildConnectionBundle", () => {
  it("packs README, manifest, release, and client configs — and never secrets", async () => {
    const buffer = await buildConnectionBundle(release, manifest, undefined);
    const zip = await JSZip.loadAsync(buffer);
    const names = Object.values(zip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name)
      .sort();
    expect(names).toEqual([
      "README.md",
      "clients/claude-code.mcp.json",
      "clients/claude-desktop.json",
      "clients/cursor.mcp.json",
      "manifest.json",
      "release.json",
    ]);

    const readme = await zip.file("README.md")!.async("text");
    expect(readme).toContain("/mcp/demo");
    expect(readme).toContain("pf token issue --server demo --scopes read,write");
    expect(readme).toContain("without** an eval run");
    expect(readme).toContain("per-call approval");

    const claudeCode = JSON.parse(await zip.file("clients/claude-code.mcp.json")!.async("text"));
    expect(claudeCode.mcpServers.demo.type).toBe("http");
    expect(claudeCode.mcpServers.demo.url).toMatch(/\/mcp\/demo$/);

    const packedManifest = JSON.parse(await zip.file("manifest.json")!.async("text"));
    expect(McpServerManifest.parse(packedManifest).serverName).toBe("demo");
  });

  it("includes the eval report when the release has one", async () => {
    const evalRun: EvalRun = {
      id: "eval-1",
      projectId: "demo",
      manifestRef: "manifest:test",
      agentModel: "scripted-fake",
      taskCompletionRate: 1,
      toolSelectionAccuracy: 0.5,
      results: [],
      ranAt: new Date().toISOString(),
    };
    const zip = await JSZip.loadAsync(await buildConnectionBundle(release, manifest, evalRun));
    expect(zip.file("eval-report.json")).not.toBeNull();
    const readme = await zip.file("README.md")!.async("text");
    expect(readme).toContain("task completion 100%");
    expect(readme).toContain("tool-selection accuracy 50%");
  });
});

describe("zip spec upload helpers", () => {
  it("detects zips by extension or magic bytes", () => {
    expect(looksLikeZip("spec.zip", new Uint8Array([0, 0, 0, 0]))).toBe(true);
    expect(looksLikeZip("spec.json", new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe(true);
    expect(looksLikeZip("spec.json", new TextEncoder().encode('{"op'))).toBe(false);
  });

  it("extracts json/yaml candidates, root entries first, skipping junk", async () => {
    const zip = new JSZip();
    zip.file("nested/deeper/other.yaml", "openapi: 3.0.0");
    zip.file("openapi.json", '{"openapi":"3.0.0"}');
    zip.file("__MACOSX/openapi.json", "junk");
    zip.file(".hidden.json", "junk");
    zip.file("notes.txt", "not a spec");
    const data = await zip.generateAsync({ type: "arraybuffer" });

    const candidates = await extractSpecCandidates(data);
    expect(candidates.map((c) => c.name)).toEqual(["openapi.json", "nested/deeper/other.yaml"]);
    expect(candidates[0]?.text).toBe('{"openapi":"3.0.0"}');
  });
});
