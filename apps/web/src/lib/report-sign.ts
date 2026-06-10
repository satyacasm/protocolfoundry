import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed public links for per-release agent-readiness reports.
 *
 * The dashboard is operator-gated, but a vendor wants to link their eval
 * scores from docs/changelogs. A report URL carries an HMAC over the
 * project+version so it is shareable without a session and unforgeable for
 * releases the operator never shared. Signatures do not expire — a link
 * published in docs must keep working. In open mode (no dashboard password)
 * there is nothing to protect, so no signature is required.
 */

export function reportSecret(): string | undefined {
  return process.env.PF_DASHBOARD_SECRET ?? process.env.PF_DASHBOARD_PASSWORD;
}

export function signReport(projectId: string, version: number, secret: string): string {
  return createHmac("sha256", secret).update(`report:${projectId}:${version}`).digest("hex").slice(0, 32);
}

export function verifyReportSignature(
  projectId: string,
  version: number,
  signature: string | undefined,
): boolean {
  const secret = reportSecret();
  if (!secret) return true; // open mode: dashboard itself is unprotected
  if (!signature) return false;
  const expected = signReport(projectId, version, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Path (incl. query) of the public report for linking from operator pages. */
export function reportPath(projectId: string, version: number): string {
  const secret = reportSecret();
  const base = `/reports/${projectId}/${version}`;
  return secret ? `${base}?sig=${signReport(projectId, version, secret)}` : base;
}
