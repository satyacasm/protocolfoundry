import type { ConnectorConfig } from "@protocolfoundry/core";
import type { ResolvedEndpoints } from "./types.js";

const cache = new Map<string, ResolvedEndpoints>();

interface OidcDoc {
  authorization_endpoint?: string;
  token_endpoint?: string;
  code_challenge_methods_supported?: string[];
}

/** Resolve authorize/token endpoints via OIDC discovery, or explicit config. */
export async function resolveEndpoints(
  config: ConnectorConfig,
  fetchImpl: typeof fetch,
): Promise<ResolvedEndpoints> {
  if (config.discovery) {
    const issuer = config.discovery.issuer.replace(/\/$/, "");
    const cached = cache.get(issuer);
    if (cached) return cached;

    const url = `${issuer}/.well-known/openid-configuration`;
    const res = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      throw new Error(`OIDC discovery failed for ${issuer}: HTTP ${res.status}`);
    }
    const doc = (await res.json()) as OidcDoc;
    if (!doc.authorization_endpoint || !doc.token_endpoint) {
      throw new Error(
        `OIDC document for ${issuer} is missing authorization_endpoint/token_endpoint`,
      );
    }
    const resolved: ResolvedEndpoints = {
      authorizeUrl: doc.authorization_endpoint,
      tokenUrl: doc.token_endpoint,
      pkceSupported: (doc.code_challenge_methods_supported ?? []).includes("S256"),
    };
    cache.set(issuer, resolved);
    return resolved;
  }

  if (!config.authorizeUrl || !config.tokenUrl) {
    throw new Error(
      `Connector "${config.id}" has no discovery issuer and is missing authorizeUrl/tokenUrl`,
    );
  }
  return { authorizeUrl: config.authorizeUrl, tokenUrl: config.tokenUrl, pkceSupported: false };
}

/** Test seam: clear the discovery cache. */
export function clearDiscoveryCache(): void {
  cache.clear();
}
