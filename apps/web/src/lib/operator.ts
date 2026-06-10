import { cookies } from "next/headers";
import type { AuditEvent } from "@protocolfoundry/core";
import { auditStore } from "./data";
import { SESSION_COOKIE, sessionSecret, verifySessionToken } from "./session";

/**
 * Shared write-path guards. NOT a "use server" module — these must never be
 * exposed as action endpoints themselves.
 */

export async function requireOperator(): Promise<string> {
  const secret = sessionSecret();
  if (!secret) {
    throw new Error(
      "Dashboard is in open mode (read-only). Set PF_DASHBOARD_PASSWORD to enable writes.",
    );
  }
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !(await verifySessionToken(token, secret))) {
    throw new Error("Not authenticated");
  }
  return "operator";
}

export async function appendAudit(
  kind: AuditEvent["kind"],
  projectId: string,
  detail: Record<string, unknown>,
  actorId: string,
): Promise<void> {
  await auditStore.record({
    projectId,
    kind,
    actor: { type: "user", id: actorId },
    detail,
  });
}
