import { createHash, randomBytes } from "node:crypto";
import type { ConnectorConfig } from "@protocolfoundry/core";
import { resolveEndpoints } from "./discovery.js";
import type { LoginRequest } from "./types.js";

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** The client-id param: Kite calls it api_key, standard OAuth calls it client_id. */
function clientIdParam(config: ConnectorConfig, appCreds: Record<string, string>): [string, string] {
  if (appCreds.api_key !== undefined) return ["api_key", appCreds.api_key];
  if (appCreds.client_id !== undefined) return ["client_id", appCreds.client_id];
  throw new Error(`Connector "${config.id}" needs an api_key or client_id app credential`);
}

/** Build the provider login URL plus the state/PKCE verifier the caller round-trips. */
export async function buildLoginUrl(
  config: ConnectorConfig,
  appCreds: Record<string, string>,
  redirectUri: string,
  fetchImpl: typeof fetch,
): Promise<LoginRequest> {
  const endpoints = await resolveEndpoints(config, fetchImpl);
  const url = new URL(endpoints.authorizeUrl);
  const state = base64url(randomBytes(24));

  const [cidKey, cidVal] = clientIdParam(config, appCreds);
  url.searchParams.set(cidKey, cidVal);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", config.params.responseType);
  url.searchParams.set("state", state);
  if (config.params.scopes.length > 0) {
    url.searchParams.set("scope", config.params.scopes.join(" "));
  }

  let codeVerifier: string | undefined;
  if (config.params.pkce && endpoints.pkceSupported) {
    codeVerifier = base64url(randomBytes(32));
    const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
  }

  if (codeVerifier !== undefined) {
    return { url: url.toString(), state, codeVerifier };
  }
  return { url: url.toString(), state };
}
