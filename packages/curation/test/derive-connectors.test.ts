import { describe, expect, it } from "vitest";
import type { WorkflowGraph } from "@protocolfoundry/core";
import {
  buildConnectorPrompt,
  validateDerivedConnectors,
  type ConnectorDeriver,
  type RawConnectorDerivation,
} from "../src/derive-connectors.js";

const graph = {
  projectId: "proj",
  baseUrls: { default: "https://api.kite.trade" },
  authRequirements: [
    { id: "kite", kind: "oauth2", detail: {} },
    { id: "apikeyAuth", kind: "apiKey", detail: { in: "header", name: "X-Key" } },
  ],
  operations: [],
} as unknown as WorkflowGraph;

describe("buildConnectorPrompt", () => {
  it("includes each auth requirement's id, kind, detail and the base URLs", () => {
    const prompt = buildConnectorPrompt(graph);
    expect(prompt).toContain("kite");
    expect(prompt).toContain("oauth2");
    expect(prompt).toContain("https://api.kite.trade");
  });
});

describe("validateDerivedConnectors", () => {
  it("keeps valid configs (keyed by authRequirementId) and drops invalid ones", () => {
    const raw: RawConnectorDerivation = {
      connectors: [
        {
          authRequirementId: "kite",
          config: {
            id: "zerodha-kite",
            authorizeUrl: "https://kite.zerodha.com/connect/login",
            tokenUrl: "https://api.kite.trade/session/token",
            appCredentials: [{ id: "api_key", label: "API key", valueFormat: "k" }],
            params: { callbackParam: "request_token" },
            derive: [
              { op: "concat", inputs: ["api_key", "request_token", "api_secret"], as: "checksum_input" },
              { op: "sha256", input: "checksum_input", as: "checksum" },
            ],
            exchange: { body: { api_key: "api_key", request_token: "request_token", checksum: "checksum" } },
            produces: [{ vaultRowId: "KITE_ACCESS_TOKEN", from: "access_token" }],
          },
        },
        {
          authRequirementId: "broken",
          config: { id: "x", produces: [{ vaultRowId: "Y", from: "access_token" }] },
        },
      ],
    };
    const { configs, dropped } = validateDerivedConnectors(raw);
    expect(Object.keys(configs)).toEqual(["kite"]);
    expect(configs.kite.id).toBe("zerodha-kite");
    expect(dropped).toHaveLength(1);
    expect(dropped[0].authRequirementId).toBe("broken");
  });
});

describe("ConnectorDeriver (scripted fake)", () => {
  it("conforms to the interface", async () => {
    const fake: ConnectorDeriver = {
      model: "fake",
      async derive() {
        return { connectors: [] };
      },
    };
    expect((await fake.derive("x")).connectors).toEqual([]);
  });
});
