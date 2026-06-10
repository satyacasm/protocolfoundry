import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Scoped gateway access tokens (`pft_<payload>.<sig>`): HMAC-SHA256-signed,
 * expiring, bound to one server name (or "*"). This is the bearer-token /
 * scope-enforcement half of the MCP authorization spec; minting via a full
 * OAuth 2.1 authorization-code flow is an external-AS integration (ADR-0007).
 */

export interface TokenClaims {
  v: 1;
  /** Server name the token is valid for, or "*" for all. */
  srv: string;
  /** Granted scopes, checked against each tool's requiredScopes. */
  scp: string[];
  /** Expiry, epoch ms. */
  exp: number;
}

const b64url = (buf: Buffer): string => buf.toString("base64url");

function sign(secret: string, payload: string): string {
  return b64url(createHmac("sha256", secret).update(payload).digest());
}

export function issueToken(
  secret: string,
  options: { server: string; scopes: string[]; ttlMs: number },
): string {
  const claims: TokenClaims = {
    v: 1,
    srv: options.server,
    scp: options.scopes,
    exp: Date.now() + options.ttlMs,
  };
  const payload = b64url(Buffer.from(JSON.stringify(claims), "utf8"));
  return `pft_${payload}.${sign(secret, payload)}`;
}

export function verifyToken(
  secret: string,
  token: string,
  serverName: string,
): TokenClaims | undefined {
  if (!token.startsWith("pft_")) return undefined;
  const dot = token.indexOf(".");
  if (dot < 0) return undefined;
  const payload = token.slice(4, dot);
  const signature = token.slice(dot + 1);
  const expected = sign(secret, payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;

  let claims: TokenClaims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as TokenClaims;
  } catch {
    return undefined;
  }
  if (claims.v !== 1 || !Array.isArray(claims.scp)) return undefined;
  if (claims.exp < Date.now()) return undefined;
  if (claims.srv !== "*" && claims.srv !== serverName) return undefined;
  return claims;
}
