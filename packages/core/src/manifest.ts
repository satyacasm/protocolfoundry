import { z } from "zod";
import { AuthRequirement, JsonSchemaObject } from "./workflow-graph.js";

/**
 * The McpServerManifest is the Generator's output artifact: a declarative,
 * versioned definition of one MCP server, interpreted at runtime by the
 * multi-tenant gateway (ADR-0003). It must stay fully serializable and
 * human-reviewable — it is the artifact customers approve.
 */

/**
 * Upstream HTTP operation embedded in the manifest so the gateway never needs
 * the workflow graph at runtime — the manifest is fully self-contained.
 */
export const UpstreamOperation = z.object({
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]),
  /** Path template, e.g. /v1/invoices/{id} */
  pathTemplate: z.string(),
  baseUrlRef: z.string().default("default"),
  authRequirementIds: z.array(z.string()).default([]),
  /** Where each bound input is sent (defaults: path params from template, rest query/body). */
  parameterLocations: z.record(z.enum(["path", "query", "header", "body"])).default({}),
});
export type UpstreamOperation = z.infer<typeof UpstreamOperation>;

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

/**
 * Operator-authored walkthrough for obtaining one upstream credential —
 * shown on the dashboard's connect form and referenced by gateway errors.
 * Instructions only; the secret itself always goes straight to the vault.
 */
export const CredentialGuide = z.object({
  /** Human name, e.g. "Kite Connect access token". */
  title: z.string().min(1),
  /** The exact shape of the value to paste, e.g. "token <api_key>:<access_token>". */
  valueFormat: z.string().min(1),
  /** Ordered steps for fetching the credential from the upstream provider. */
  steps: z.array(z.string().min(1)).min(1),
  helpUrl: z.string().url().optional(),
  /** Expiry/rotation behaviour the operator must know, e.g. "expires daily". */
  rotation: z.string().optional(),
});
export type CredentialGuide = z.infer<typeof CredentialGuide>;

export const McpServerManifest = z.object({
  manifestVersion: z.literal(1),
  projectId: z.string(),
  serverName: z.string(),
  serverDescription: z.string(),
  /** Upstream base URLs keyed by baseUrlRef used in Operations. */
  baseUrls: z.record(z.string().url()),
  /** Operations referenced by tool plans, keyed by operationId. */
  upstreamOperations: z.record(UpstreamOperation),
  /** Auth schemes referenced by operations, keyed by authRequirementId. */
  authSchemes: z.record(AuthRequirement).default({}),
  tools: z.array(ToolDefinition),
  resources: z.array(ResourceDefinition).default([]),
  prompts: z.array(PromptDefinition).default([]),
  credentialBindings: z.array(CredentialBinding),
  /** Setup walkthroughs keyed by authRequirementId (instructions, never secrets). */
  credentialGuides: z.record(CredentialGuide).default({}),
  /** Graph snapshot this manifest was generated from (provenance). */
  workflowGraphRef: z.string(),
  createdAt: z.string().datetime(),
});
export type McpServerManifest = z.infer<typeof McpServerManifest>;
