import { describe, expect, it } from "vitest";
import { McpServerManifest } from "../src/index.js";

const BASE = {
  manifestVersion: 1,
  projectId: "proj",
  serverName: "things",
  serverDescription: "test",
  baseUrls: { default: "https://api.example.com" },
  upstreamOperations: {
    listThings: {
      method: "GET",
      pathTemplate: "/things",
      baseUrlRef: "default",
      authRequirementIds: ["key"],
      parameterLocations: {},
    },
  },
  authSchemes: { key: { id: "key", kind: "apiKey", detail: { name: "X-Key", in: "header" } } },
  tools: [
    {
      name: "list_things",
      description: "List things",
      inputSchema: { type: "object", properties: {} },
      plan: [{ operationId: "listThings", inputBindings: {} }],
    },
  ],
  credentialBindings: [{ authRequirementId: "key", vaultCredentialId: "env:PF_CRED_KEY" }],
  workflowGraphRef: "proj@2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("McpServerManifest credentialGuides", () => {
  it("parses a manifest without guides (back-compat)", () => {
    const manifest = McpServerManifest.parse(BASE);
    expect(manifest.credentialGuides).toEqual({});
  });

  it("parses operator-authored setup guides keyed by auth requirement", () => {
    const manifest = McpServerManifest.parse({
      ...BASE,
      credentialGuides: {
        key: {
          title: "Example API key",
          valueFormat: "the raw key, e.g. ex_live_abc123",
          steps: [
            "Sign in at https://example.com/developers",
            "Create an API key under Settings -> Keys",
          ],
          helpUrl: "https://example.com/docs/auth",
          rotation: "Keys do not expire; rotate from the same page.",
        },
      },
    });
    expect(manifest.credentialGuides["key"]!.steps).toHaveLength(2);
    expect(manifest.credentialGuides["key"]!.title).toBe("Example API key");
  });

  it("rejects a guide with no steps", () => {
    expect(() =>
      McpServerManifest.parse({
        ...BASE,
        credentialGuides: { key: { title: "x", valueFormat: "y", steps: [] } },
      }),
    ).toThrow();
  });
});
