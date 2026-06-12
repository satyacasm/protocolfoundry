import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { McpServerManifest } from "@protocolfoundry/core";
import { FileVaultStore } from "@protocolfoundry/vault";
import {
  connectCredentialValue,
  listCredentialSlots,
  vaultRowId,
} from "../src/lib/credentials";

const KEY = Buffer.alloc(32, 7).toString("base64");

const manifest = McpServerManifest.parse({
  manifestVersion: 1,
  projectId: "demo",
  serverName: "demo",
  serverDescription: "Demo",
  baseUrls: { default: "https://api.example.com" },
  upstreamOperations: {
    listThings: {
      method: "GET",
      pathTemplate: "/things",
      baseUrlRef: "default",
      authRequirementIds: ["docs-auth"],
      parameterLocations: {},
    },
  },
  authSchemes: {
    "docs-auth": { id: "docs-auth", kind: "apiKey", detail: { name: "Authorization", in: "header" } },
  },
  tools: [
    {
      name: "list_things",
      description: "List",
      inputSchema: { type: "object", properties: {} },
      plan: [{ operationId: "listThings", inputBindings: {} }],
    },
  ],
  credentialBindings: [{ authRequirementId: "docs-auth", vaultCredentialId: "env:PF_CRED_DOCS_AUTH" }],
  credentialGuides: {
    "docs-auth": {
      title: "Kite access token",
      valueFormat: "token <api_key>:<access_token>",
      steps: ["Create an app", "Do the login flow"],
      rotation: "expires daily",
    },
  },
  workflowGraphRef: "demo@2026-01-01T00:00:00.000Z",
  createdAt: "2026-01-01T00:00:00.000Z",
});

function freshVault(): FileVaultStore {
  return new FileVaultStore(join(mkdtempSync(join(tmpdir(), "pf-cred-")), "vault.json"), KEY);
}

describe("credential slots", () => {
  it("maps env: and vault: refs to their vault row id", () => {
    expect(vaultRowId("env:PF_CRED_DOCS_AUTH")).toBe("PF_CRED_DOCS_AUTH");
    expect(vaultRowId("vault:kite-token")).toBe("kite-token");
  });

  it("lists slots with manifest guide and vault status", async () => {
    const vault = freshVault();
    const before = await listCredentialSlots(manifest, vault);
    expect(before).toHaveLength(1);
    expect(before[0]!.guide.title).toBe("Kite access token");
    expect(before[0]!.inVault).toBe(false);

    await connectCredentialValue(manifest, "env:PF_CRED_DOCS_AUTH", "token k:s", vault);
    const after = await listCredentialSlots(manifest, vault);
    expect(after[0]!.inVault).toBe(true);
    // the secret round-trips for the gateway resolver, under the env name
    expect(await vault.getSecret("PF_CRED_DOCS_AUTH")).toBe("token k:s");
  });

  it("falls back to a generic guide when the manifest has none", async () => {
    const bare = McpServerManifest.parse({
      ...manifest,
      credentialGuides: {},
      createdAt: manifest.createdAt,
    });
    const slots = await listCredentialSlots(bare, freshVault());
    expect(slots[0]!.guide.steps.length).toBeGreaterThan(0);
    expect(slots[0]!.guide.title.toLowerCase()).toContain("api key");
  });

  it("rejects writes for bindings the manifest does not declare", async () => {
    await expect(
      connectCredentialValue(manifest, "env:PF_CRED_OTHER", "x", freshVault()),
    ).rejects.toThrow(/not declared/i);
  });

  it("rejects empty secrets", async () => {
    await expect(
      connectCredentialValue(manifest, "env:PF_CRED_DOCS_AUTH", "  ", freshVault()),
    ).rejects.toThrow(/empty/i);
  });
});
