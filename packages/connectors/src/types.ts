import type { ConnectorConfig } from "@protocolfoundry/core";

/** A secret to seal into an existing vault row — the engine's only output. */
export interface SealedSecret {
  vaultRowId: string;
  secret: string;
}

/** The provider login URL plus the CSRF/PKCE state the caller must round-trip. */
export interface LoginRequest {
  url: string;
  state: string;
  /** Present when params.pkce is true; the caller round-trips it to exchange(). */
  codeVerifier?: string;
}

/** Resolved authorize/token endpoints (from discovery or explicit config). */
export interface ResolvedEndpoints {
  authorizeUrl: string;
  tokenUrl: string;
  pkceSupported: boolean;
}

/** Everything exchange() needs; all I/O is injected for testability. */
export interface ExchangeInput {
  config: ConnectorConfig;
  /** App-level creds resolved by the caller from the vault, keyed by appCredential id. */
  appCreds: Record<string, string>;
  redirectUri: string;
  /** Params the provider redirected to our callback (incl. the captured token + state). */
  callbackParams: Record<string, string>;
  /** The state issued by buildLoginUrl; mismatch is rejected. */
  expectedState: string;
  codeVerifier?: string;
  fetch: typeof fetch;
}
