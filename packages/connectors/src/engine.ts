import { createHash, randomBytes } from "node:crypto";
import type { ConnectorConfig } from "@protocolfoundry/core";
import { resolveEndpoints } from "./discovery.js";
import type { LoginRequest } from "./types.js";
import { applyDerive, resolveValue } from "./transforms.js";
import type { ExchangeInput, SealedSecret } from "./types.js";

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

/** Merge response JSON into the value bag: top-level fields + one level of `data`. */
function mergeResponse(bag: Record<string, string>, json: unknown): Record<string, string> {
  const out = { ...bag };
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    const nested = obj.data && typeof obj.data === "object" ? (obj.data as Record<string, unknown>) : {};
    for (const [k, v] of Object.entries({ ...obj, ...nested })) {
      if (typeof v === "string") out[k] = v;
    }
  }
  return out;
}

/** Capture the sanctioned redirect, run the token exchange, return secrets to seal. */
export async function exchange(input: ExchangeInput): Promise<SealedSecret[]> {
  const { config, appCreds, redirectUri, callbackParams, expectedState, codeVerifier, fetch: fetchImpl } = input;

  if (!expectedState || callbackParams.state !== expectedState) {
    throw new Error("OAuth state mismatch — refusing to exchange (possible CSRF)");
  }
  const token = callbackParams[config.params.callbackParam];
  if (!token) {
    throw new Error(`Callback is missing the "${config.params.callbackParam}" parameter`);
  }

  const endpoints = await resolveEndpoints(config, fetchImpl);

  const seed: Record<string, string> = { ...appCreds, [config.params.callbackParam]: token };
  const derived = applyDerive(seed, config.derive);

  const body = new URLSearchParams();
  if (config.exchange) {
    for (const [field, ref] of Object.entries(config.exchange.body)) {
      body.set(field, resolveValue(derived, ref));
    }
  } else {
    body.set("grant_type", config.params.grantType);
    body.set("code", token);
    body.set("redirect_uri", redirectUri);
    if (appCreds.client_id) body.set("client_id", appCreds.client_id);
    if (appCreds.client_secret) body.set("client_secret", appCreds.client_secret);
    if (codeVerifier) body.set("code_verifier", codeVerifier);
  }

  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (config.exchange) {
    for (const [h, ref] of Object.entries(config.exchange.headers)) {
      headers[h] = resolveValue(derived, ref);
    }
  }

  const res = await fetchImpl(endpoints.tokenUrl, {
    method: config.exchange?.method ?? "POST",
    headers,
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed for connector "${config.id}": HTTP ${res.status}`);
  }
  const json: unknown = await res.json();
  // Keep the response in its own namespace so a provider response can never
  // overwrite an app credential or derived value when resolving `produces`.
  const responseFields = mergeResponse({}, json);

  return config.produces.map((p) => {
    const secret = responseFields[p.from] ?? derived[p.from];
    if (secret === undefined) {
      throw new Error(`Connector "${config.id}" produced no value for "${p.from}"`);
    }
    return { vaultRowId: p.vaultRowId, secret };
  });
}
