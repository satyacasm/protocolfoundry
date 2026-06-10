/**
 * HMAC-signed session tokens for the dashboard (ADR-0006). Single-operator
 * auth: a shared password (PF_DASHBOARD_PASSWORD) exchanges for a signed,
 * expiring cookie. Uses Web Crypto only, so it runs in both the middleware
 * (edge runtime) and route handlers. SSO/multi-user replaces this at the
 * customer-facing milestone.
 */

export const SESSION_COOKIE = "pf_session";
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12h

const encoder = new TextEncoder();

export function sessionSecret(): string | undefined {
  return process.env.PF_DASHBOARD_SECRET ?? process.env.PF_DASHBOARD_PASSWORD;
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Token format: `<expiryEpochMs>.<hmacHex(secret, expiry)>` */
export async function createSessionToken(secret: string, ttlMs = SESSION_TTL_MS): Promise<string> {
  const expiry = String(Date.now() + ttlMs);
  return `${expiry}.${await hmacHex(secret, expiry)}`;
}

export async function verifySessionToken(token: string, secret: string): Promise<boolean> {
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiry = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!/^\d+$/.test(expiry) || Number(expiry) < Date.now()) return false;
  const expected = await hmacHex(secret, expiry);
  // constant-time-ish compare of equal-length hex strings
  if (signature.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/** Compare the submitted password without short-circuiting on first mismatch. */
export async function passwordMatches(submitted: string, actual: string): Promise<boolean> {
  const [a, b] = await Promise.all([hmacHex(actual, submitted), hmacHex(actual, actual)]);
  return a === b;
}
