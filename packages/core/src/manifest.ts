import { z } from "zod";
import { JsonSchemaObject } from "./workflow-graph.js";

/**
 * The McpServerManifest is the Generator's output artifact: a declarative,
 * versioned definition of one MCP server, interpreted at runtime by the
 * multi-tenant gateway (ADR-0003). It must stay fully serializable and
 * human-reviewable — it is the artifact customers approve.
 */

/** One upstream HTTP call inside a tool's execution plan. */
export const UpstreamCall = z.object({
  operationId: z.string(),
  /**
   * Bind upstream inputs from tool args or prior step outputs,
   * e.g. { "invoiceId": "$steps[0].output.id", "amount": "$args.amount" }.
   */
  inputBindings: z.record(z.string()).default({}),
});
export type UpstreamCall = z.infer<typeof UpstreamCall>;

export const ToolDefinition = z.object({
  name: z.string().regex(/^[a-z][a-z0-9_]*$/, "snake_case tool names"),
  /** Agent-facing description — curated, not copied from API docs. */
  description: z.string(),
  inputSchema: JsonSchemaObject,
  outputSchema: JsonSchemaObject.optional(),
  /** Sequential execution plan; one entry = simple tool, many = task-level tool. */
  plan: z.array(UpstreamCall).min(1),
  /** Scopes the caller's OAuth token must hold to invoke this tool. */
  requiredScopes: z.array(z.string()).default([]),
  /** Runtime safety controls (defaults derive from Operation.effect). */
  approval: z.enum(["none", "perCall"]).default("none"),
  rateLimitPerMinute: z.number().int().positive().optional(),
});
export type ToolDefinition = z.infer<typeof ToolDefinition>;

export const ResourceDefinition = z.object({
  uri: z.string(),
  name: z.string(),
  description: z.string().optional(),
  mimeType: z.string().default("application/json"),
  operationId: z.string(),
});
export type ResourceDefinition = z.infer<typeof ResourceDefinition>;

export const PromptDefinition = z.object({
  name: z.string(),
  description: z.string().optional(),
  template: z.string(),
  argumentNames: z.array(z.string()).default([]),
});
export type PromptDefinition = z.infer<typeof PromptDefinition>;

/** Reference to a credential in the vault — never the secret itself. */
export const CredentialBinding = z.object({
  authRequirementId: z.string(),
  vaultCredentialId: z.string(),
});
export type CredentialBinding = z.infer<typeof CredentialBinding>;

export const McpServerManifest = z.object({
  manifestVersion: z.literal(1),
  projectId: z.string(),
  serverName: z.string(),
  serverDescription: z.string(),
  /** Upstream base URLs keyed by baseUrlRef used in Operations. */
  baseUrls: z.record(z.string().url()),
  tools: z.array(ToolDefinition),
  resources: z.array(ResourceDefinition).default([]),
  prompts: z.array(PromptDefinition).default([]),
  credentialBindings: z.array(CredentialBinding),
  /** Graph snapshot this manifest was generated from (provenance). */
  workflowGraphRef: z.string(),
  createdAt: z.string().datetime(),
});
export type McpServerManifest = z.infer<typeof McpServerManifest>;
