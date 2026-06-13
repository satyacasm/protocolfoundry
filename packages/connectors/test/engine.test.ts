import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ConnectorConfig } from "@protocolfoundry/core";
import { buildLoginUrl } from "../src/engine.js";
import { clearDiscoveryCache } from "../src/discovery.js";

function fakeFetch(body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
  ) as unknown as typeof fetch;
}

describe("buildLoginUrl", () => {
  it("builds a standard OIDC authorize URL with state, scopes and PKCE", async () => {
    clearDiscoveryCache();
    const cfg = ConnectorConfig.parse({
      id: "oauth2-generic",
      discovery: { issuer: "https://accounts.example.com" },
      appCredentials: [{ id: "client_id", label: "Client ID", valueFormat: "id" }],
      params: { scopes: ["read", "write"], pkce: true, callbackParam: "code" },
      produces: [{ vaultRowId: "T", from: "access_token" }],
    });
    const login = await buildLoginUrl(
      cfg,
      { client_id: "my-client" },
      "https://app.pf.dev/connect/callback",
      fakeFetch({
        authorization_endpoint: "https://accounts.example.com/authorize",
        token_endpoint: "https://accounts.example.com/token",
        code_challenge_methods_supported: ["S256"],
      }),
    );
    const u = new URL(login.url);
    expect(u.origin + u.pathname).toBe("https://accounts.example.com/authorize");
    expect(u.searchParams.get("client_id")).toBe("my-client");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.pf.dev/connect/callback");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("read write");
    expect(u.searchParams.get("state")).toBe(login.state);
    expect(login.state.length).toBeGreaterThan(16);
    expect(login.codeVerifier).toBeTruthy();
    const challenge = createHash("sha256").update(login.codeVerifier!).digest("base64url");
    expect(u.searchParams.get("code_challenge")).toBe(challenge);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("builds a Kite login URL (explicit endpoint, api_key, no PKCE)", async () => {
    const cfg = ConnectorConfig.parse({
      id: "zerodha-kite",
      authorizeUrl: "https://kite.zerodha.com/connect/login",
      tokenUrl: "https://api.kite.trade/session/token",
      appCredentials: [{ id: "api_key", label: "API key", valueFormat: "k" }],
      params: { callbackParam: "request_token" },
      produces: [{ vaultRowId: "KITE", from: "access_token" }],
    });
    const f = vi.fn() as unknown as typeof fetch;
    const login = await buildLoginUrl(cfg, { api_key: "kapikey" }, "http://127.0.0.1:9876/callback", f);
    const u = new URL(login.url);
    expect(u.origin + u.pathname).toBe("https://kite.zerodha.com/connect/login");
    expect(u.searchParams.get("api_key") ?? u.searchParams.get("client_id")).toBe("kapikey");
    expect(login.codeVerifier).toBeUndefined();
  });
});
