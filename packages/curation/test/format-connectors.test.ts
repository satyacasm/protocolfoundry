import { describe, expect, it } from "vitest";
import { formatConnectorConfigs } from "../src/format-connectors.js";

describe("formatConnectorConfigs", () => {
  it("summarizes each connector's flow type, produced rows and rotation", () => {
    const out = formatConnectorConfigs({
      kite: {
        id: "zerodha-kite",
        authorizeUrl: "https://kite.zerodha.com/connect/login",
        tokenUrl: "https://api.kite.trade/session/token",
        appCredentials: [{ id: "api_key", label: "API key", valueFormat: "k" }],
        params: { callbackParam: "request_token", scopes: [], pkce: false, responseType: "code", grantType: "authorization_code" },
        derive: [],
        produces: [{ vaultRowId: "KITE_ACCESS_TOKEN", from: "access_token" }],
        rotation: "expires daily",
      },
    } as never);
    expect(out).toContain("kite");
    expect(out).toContain("zerodha-kite");
    expect(out).toContain("KITE_ACCESS_TOKEN");
    expect(out).toContain("expires daily");
    expect(out).toContain("explicit endpoints");
  });

  it("renders a friendly message for an empty map", () => {
    expect(formatConnectorConfigs({})).toMatch(/no .*connector/i);
  });
});
