import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ConnectorConfig } from "@protocolfoundry/core";
import { buildLoginUrl } from "../src/engine.js";
import { clearDiscoveryCache } from "../src/discovery.js";
import { exchange } from "../src/engine.js";

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

function fakeTokenFetch(captured: { body?: string; url?: string }, json: unknown): typeof fetch {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    captured.url = String(url);
    captured.body = init?.body as string;
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("exchange", () => {
  it("rejects a callback whose state does not match", async () => {
    const cfg = ConnectorConfig.parse({
      id: "oauth2-generic",
      authorizeUrl: "https://a.example.com/authorize",
      tokenUrl: "https://a.example.com/token",
      produces: [{ vaultRowId: "T", from: "access_token" }],
    });
    await expect(
      exchange({
        config: cfg,
        appCreds: { client_id: "c", client_secret: "s" },
        redirectUri: "https://app/cb",
        callbackParams: { code: "abc", state: "WRONG" },
        expectedState: "RIGHT",
        fetch: fakeTokenFetch({}, {}),
      }),
    ).rejects.toThrow(/state/i);
  });

  it("runs the standard authorization-code token POST and seals access_token", async () => {
    const cfg = ConnectorConfig.parse({
      id: "oauth2-generic",
      authorizeUrl: "https://a.example.com/authorize",
      tokenUrl: "https://a.example.com/token",
      params: { pkce: true, callbackParam: "code" },
      produces: [{ vaultRowId: "EXAMPLE_TOKEN", from: "access_token" }],
    });
    const captured: { body?: string; url?: string } = {};
    const sealed = await exchange({
      config: cfg,
      appCreds: { client_id: "cid", client_secret: "csecret" },
      redirectUri: "https://app/cb",
      callbackParams: { code: "auth-code-1", state: "S" },
      expectedState: "S",
      codeVerifier: "verifier-1",
      fetch: fakeTokenFetch(captured, { access_token: "at-xyz", token_type: "bearer" }),
    });
    expect(captured.url).toBe("https://a.example.com/token");
    const form = new URLSearchParams(captured.body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("auth-code-1");
    expect(form.get("redirect_uri")).toBe("https://app/cb");
    expect(form.get("client_id")).toBe("cid");
    expect(form.get("client_secret")).toBe("csecret");
    expect(form.get("code_verifier")).toBe("verifier-1");
    expect(sealed).toEqual([{ vaultRowId: "EXAMPLE_TOKEN", secret: "at-xyz" }]);
  });

  it("runs Kite's derive+custom-exchange and seals the access_token", async () => {
    const cfg = ConnectorConfig.parse({
      id: "zerodha-kite",
      authorizeUrl: "https://kite.zerodha.com/connect/login",
      tokenUrl: "https://api.kite.trade/session/token",
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
    });
    const captured: { body?: string; url?: string } = {};
    const sealed = await exchange({
      config: cfg,
      appCreds: { api_key: "abc123", api_secret: "shh-secret" },
      redirectUri: "http://127.0.0.1:9876/cb",
      callbackParams: { request_token: "rt-999", state: "S" },
      expectedState: "S",
      fetch: fakeTokenFetch(captured, { data: { access_token: "kite-at" }, status: "success" }),
    });
    expect(captured.url).toBe("https://api.kite.trade/session/token");
    const form = new URLSearchParams(captured.body);
    expect(form.get("api_key")).toBe("abc123");
    expect(form.get("request_token")).toBe("rt-999");
    const { createHash } = await import("node:crypto");
    expect(form.get("checksum")).toBe(
      createHash("sha256").update("abc123rt-999shh-secret").digest("hex"),
    );
    expect(sealed).toEqual([{ vaultRowId: "KITE_ACCESS_TOKEN", secret: "kite-at" }]);
  });
});
