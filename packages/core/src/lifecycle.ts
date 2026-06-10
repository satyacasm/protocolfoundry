import { z } from "zod";

/**
 * Lifecycle entities: projects, sources, releases, eval runs, audit events.
 * See docs/03-architecture.md § Key entities.
 */

export const Project = z.object({
  id: z.string(),
  tenantId: z.string(),
  name: z.string(),
  targetAppUrl: z.string().url().optional(),
  createdAt: z.string().datetime(),
});
export type Project = z.infer<typeof Project>;

/** An ingested artifact describing the target application. */
export const Source = z.object({
  id: z.string(),
  projectId: z.string(),
  kind: z.enum(["openapi", "graphql", "postman", "har", "docsUrl", "walkthrough"]),
  /** Where the artifact lives (blob ref or URL); raw content is stored out of band. */
  locationRef: z.string(),
  ingestedAt: z.string().datetime().optional(),
});
export type Source = z.infer<typeof Source>;

/** An immutable, eval-gated, servable manifest version (ADR-0003). */
export const Release = z.object({
  id: z.string(),
  projectId: z.string(),
  manifestRef: z.string(),
  /** Monotonic per project. */
  version: z.number().int().positive(),
  status: z.enum(["staged", "live", "rolledBack", "retired"]),
  evalRunId: z.string().optional(),
  approvedBy: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type Release = z.infer<typeof Release>;

export const EvalTaskResult = z.object({
  taskId: z.string(),
  description: z.string(),
  completed: z.boolean(),
  toolSelectionCorrect: z.boolean(),
  steps: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  failureReason: z.string().optional(),
});
export type EvalTaskResult = z.infer<typeof EvalTaskResult>;

/** Agent-usability eval of one manifest version with one agent model. */
export const EvalRun = z.object({
  id: z.string(),
  projectId: z.string(),
  manifestRef: z.string(),
  agentModel: z.string(),
  results: z.array(EvalTaskResult),
  /** Derived scores cached for display/gating. */
  taskCompletionRate: z.number().min(0).max(1),
  toolSelectionAccuracy: z.number().min(0).max(1),
  ranAt: z.string().datetime(),
});
export type EvalRun = z.infer<typeof EvalRun>;

/** Immutable audit record for every tool call and control-plane mutation. */
export const AuditEvent = z.object({
  id: z.string(),
  tenantId: z.string(),
  projectId: z.string().optional(),
  kind: z.enum([
    "toolInvocation",
    "manifestChange",
    "releasePromoted",
    "releaseRolledBack",
    "credentialConnected",
    "credentialRevoked",
    "approvalGranted",
    "approvalDenied",
  ]),
  actor: z.object({
    type: z.enum(["agent", "user", "system"]),
    id: z.string(),
  }),
  /** For toolInvocation: tool name, args hash, upstream status — never raw secrets. */
  detail: z.record(z.unknown()).default({}),
  occurredAt: z.string().datetime(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;
