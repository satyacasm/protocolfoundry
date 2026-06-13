import { describe, expect, it, vi } from "vitest";
import { ConnectorConfig } from "@protocolfoundry/core";
import { resolveEndpoints } from "../src/discovery.js";

function fakeFetch(body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
  ) as unknown as typeof fetch;
}

const PRODUCES = [{ vaultRowId: "T", from: "access_token" }];

describe("resolveEndpoints", () => {
  it("reads endpoints from the OIDC well-known document", async () => {
    const cfg = ConnectorConfig.parse({
      id: "oauth2-generic",
      discovery: { issuer: "https://accounts.example.com" },
      produces: PRODUCES,
    });
    const f = fakeFetch({
      authorization_endpoint: "https://accounts.example.com/authorize",
      token_endpoint: "https://accounts.example.com/token",
      code_challenge_methods_supported: ["S256"],
    });
    const ep = await resolveEndpoints(cfg, f);
    expect(f).toHaveBeenCalledWith(
      "https://accounts.example.com/.well-known/openid-configuration",
      expect.anything(),
    );
    expect(ep).toEqual({
      authorizeUrl: "https://accounts.example.com/authorize",
      tokenUrl: "https://accounts.example.com/token",
      pkceSupported: true,
    });
  });

  it("uses explicit endpoints without any fetch when discovery is absent", async () => {
    const cfg = ConnectorConfig.parse({
      id: "zerodha-kite",
      authorizeUrl: "https://kite.zerodha.com/connect/login",
      tokenUrl: "https://api.kite.trade/session/token",
      produces: PRODUCES,
    });
    const f = vi.fn() as unknown as typeof fetch;
    const ep = await resolveEndpoints(cfg, f);
    expect(f).not.toHaveBeenCalled();
    expect(ep.authorizeUrl).toBe("https://kite.zerodha.com/connect/login");
    expect(ep.tokenUrl).toBe("https://api.kite.trade/session/token");
    expect(ep.pkceSupported).toBe(false);
  });

  it("throws a clear error if the well-known doc lacks endpoints", async () => {
    const cfg = ConnectorConfig.parse({
      id: "oauth2-generic",
      discovery: { issuer: "https://broken.example.com" },
      produces: PRODUCES,
    });
    await expect(resolveEndpoints(cfg, fakeFetch({}))).rejects.toThrow(/authorization_endpoint/);
  });
});
