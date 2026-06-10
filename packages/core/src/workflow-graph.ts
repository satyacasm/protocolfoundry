import { z } from "zod";

/**
 * The Workflow Graph is the intermediate representation every ingestor
 * (OpenAPI, GraphQL, HAR, walkthrough recording) produces and the Generator
 * consumes. See docs/03-architecture.md.
 */

export const JsonSchemaObject = z.record(z.unknown());
export type JsonSchemaObject = z.infer<typeof JsonSchemaObject>;

export const AuthRequirement = z.object({
  id: z.string(),
  kind: z.enum(["apiKey", "oauth2", "basic", "bearer", "serviceAccount", "none"]),
  /** e.g. OAuth scopes or key header name */
  detail: z.record(z.string()).optional(),
});
export type AuthRequirement = z.infer<typeof AuthRequirement>;

/** A single callable operation discovered in the target application. */
export const Operation = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  http: z.object({
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]),
    /** Path template, e.g. /v1/invoices/{id} */
    path: z.string(),
    baseUrlRef: z.string().optional(),
  }),
  inputSchema: JsonSchemaObject.optional(),
  outputSchema: JsonSchemaObject.optional(),
  /** Where each input property is sent upstream (path/query/header/body). */
  parameterLocations: z.record(z.enum(["path", "query", "header", "body"])).default({}),
  authRequirementIds: z.array(z.string()).default([]),
  /** Side-effect class drives approval-gate defaults in curation. */
  effect: z.enum(["read", "create", "update", "delete", "execute"]),
  tags: z.array(z.string()).default([]),
  /** Which ingested Source this operation came from. */
  sourceId: z.string(),
});
export type Operation = z.infer<typeof Operation>;

/** Dependency between operations (data flow or required ordering). */
export const OperationEdge = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(["dataDependency", "sequence", "authPrecondition"]),
  /** For data deps: which output field feeds which input field. */
  mapping: z.record(z.string()).optional(),
});
export type OperationEdge = z.infer<typeof OperationEdge>;

/**
 * A candidate business task spanning multiple operations — the unit the
 * curation layer turns into a single task-level MCP tool.
 */
export const TaskFlow = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  operationIds: z.array(z.string()).min(1),
  /** Confidence from discovery (LLM-proposed flows are reviewed by humans). */
  confidence: z.number().min(0).max(1),
  proposedBy: z.enum(["llm", "human", "ingestor"]),
});
export type TaskFlow = z.infer<typeof TaskFlow>;

export const WorkflowGraph = z.object({
  graphVersion: z.literal(1),
  projectId: z.string(),
  /** Upstream base URLs keyed by the baseUrlRef used in Operations. */
  baseUrls: z.record(z.string()).default({}),
  operations: z.array(Operation),
  edges: z.array(OperationEdge),
  taskFlows: z.array(TaskFlow),
  authRequirements: z.array(AuthRequirement),
  createdAt: z.string().datetime(),
});
export type WorkflowGraph = z.infer<typeof WorkflowGraph>;
