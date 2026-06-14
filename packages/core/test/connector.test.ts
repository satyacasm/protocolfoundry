import { describe, expect, it } from "vitest";
import { ConnectorConfig, McpServerManifest } from "../src/index.js";

describe("ConnectorConfig", () => {
  it("accepts a standard OIDC connector with discovery", () => {
    const cfg = ConnectorConfig.parse({
      id: "oauth2-generic",
      discovery: { issuer: "https://accounts.example.com" },
      appCredentials: [
        { id: "client_id", label: "Client ID", valueFormat: "the OAuth app client id" },
        { id: "client_secret", label: "Client secret", valueFormat: "the OAuth app secret" },
      ],
      params: { scopes: ["read"], pkce: true, callbackParam: "code" },
      produces: [{ vaultRowId: "EXAMPLE_TOKEN", from: "access_token" }],
    });
    expect(cfg.params.grantType).toBe("authorization_code"); // default applied
    expect(cfg.exchange).toBeUndefined(); // standard path
  });

  it("accepts a Kite-style non-standard connector with derive + custom exchange", () => {
    const cfg = ConnectorConfig.parse({
      id: "zerodha-kite",
      authorizeUrl: "https://kite.zerodha.com/connect/login",
      tokenUrl: "https://api.kite.trade/session/token",
      appCredentials: [
        { id: "api_key", label: "API key", valueFormat: "Kite Connect api_key" },
        { id: "api_secret", label: "API secret", valueFormat: "Kite Connect api_secret" },
      ],
      params: { callbackParam: "request_token" },
      derive: [
        { op: "concat", inputs: ["api_key", "request_token", "api_secret"], as: "checksum_input" },
        { op: "sha256", input: "checksum_input", as: "checksum" },
      ],
      exchange: {
        method: "POST",
        body: { api_key: "api_key", request_token: "request_token", checksum: "checksum" },
      },
      produces: [{ vaultRowId: "KITE_ACCESS_TOKEN", from: "access_token" }],
      rotation: "Access token expires daily ~6am IST; reconnect to refresh.",
    });
    expect(cfg.derive).toHaveLength(2);
    expect(cfg.exchange?.urlRef).toBe("token"); // default applied
  });

  it("rejects a connector with neither discovery nor an explicit authorizeUrl", () => {
    expect(() =>
      ConnectorConfig.parse({
        id: "broken",
        appCredentials: [],
        produces: [{ vaultRowId: "X", from: "access_token" }],
      }),
    ).toThrow(/discovery.*or.*authorizeUrl/i);
  });

  it("rejects an explicit-endpoint connector that is missing tokenUrl", () => {
    expect(() =>
      ConnectorConfig.parse({
        id: "half-configured",
        authorizeUrl: "https://provider.example.com/authorize",
        produces: [{ vaultRowId: "X", from: "access_token" }],
      }),
    ).toThrow(/authorizeUrl AND tokenUrl/i);
  });

  it("old manifests with no connectorConfigs parse to an empty map", () => {
    const m = McpServerManifest.parse({
      manifestVersion: 1,
      projectId: "p",
      serverName: "s",
      serverDescription: "d",
      baseUrls: { default: "https://api.example.com" },
      upstreamOperations: {},
      tools: [
        {
          name: "ping",
          description: "ping",
          inputSchema: {},
          plan: [{ operationId: "op1" }],
        },
      ],
      credentialBindings: [],
      workflowGraphRef: "g-1",
      createdAt: "2026-06-13T00:00:00.000Z",
    });
    expect(m.connectorConfigs).toEqual({});
  });
});
