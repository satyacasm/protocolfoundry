import {
  McpServerManifest,
  type AuthRequirement,
  type Operation,
  type ToolDefinition,
  type UpstreamOperation,
  type WorkflowGraph,
} from "@protocolfoundry/core";

/** What the customer selected for exposure during human-in-the-loop curation. */
export interface CurationSelection {
  /** Operation ids to expose as simple 1:1 tools. */
  operationIds: string[];
  /** TaskFlow ids to expose as composed task-level tools (Phase 2). */
  taskFlowIds: string[];
}

export interface GenerateOptions {
  serverName?: string;
  serverDescription?: string;
  /** Override/declare base URLs when the spec has no servers entry. */
  baseUrls?: Record<string, string>;
}

/** Normalize any identifier into a valid snake_case MCP tool name. */
export function sanitizeToolName(raw: string): string {
  let name = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/__+/g, "_");
  if (!/^[a-z]/.test(name)) name = `op_${name}`;
  return name;
}

function toToolName(operationId: string, used: Set<string>): string {
  let name = sanitizeToolName(operationId);
  while (used.has(name)) name = `${name}_2`;
  used.add(name);
  return name;
}

function toEnvCredentialId(authRequirementId: string): string {
  const suffix = authRequirementId.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  return `env:PF_CRED_${suffix}`;
}

function describe(op: Operation): string {
  const base = op.description ?? op.name;
  return `${base} (${op.http.method} ${op.http.path})`;
}

/**
 * Phase 1 baseline: naive 1:1 generation — each selected operation becomes one
 * tool whose plan is a single upstream call with identity argument bindings.
 * Destructive operations default to a per-call approval gate.
 *
 * Phase 2 adds the LLM curation pass (task-level tools from TaskFlows) that
 * makes this product worth paying for — see docs/02-product-strategy.md.
 */
export function generateManifest(
  graph: WorkflowGraph,
  selection: CurationSelection,
  options: GenerateOptions = {},
): McpServerManifest {
  if (selection.taskFlowIds.length > 0) {
    throw new Error("Task-flow tools are not supported until Phase 2 (docs/04-roadmap.md)");
  }

  const opsById = new Map(graph.operations.map((op) => [op.id, op]));
  const missing = selection.operationIds.filter((id) => !opsById.has(id));
  if (missing.length > 0) {
    throw new Error(`Unknown operation ids in selection: ${missing.join(", ")}`);
  }
  if (selection.operationIds.length === 0) {
    throw new Error("Selection is empty — choose at least one operation to expose");
  }

  const baseUrls = { ...graph.baseUrls, ...options.baseUrls };
  if (Object.keys(baseUrls).length === 0) {
    throw new Error(
      "No upstream base URL known — the spec has no servers entry; pass options.baseUrls",
    );
  }

  const usedToolNames = new Set<string>();
  const tools: ToolDefinition[] = [];
  const upstreamOperations: Record<string, UpstreamOperation> = {};
  const usedAuthIds = new Set<string>();

  for (const operationId of selection.operationIds) {
    const op = opsById.get(operationId)!;
    const inputSchema = op.inputSchema ?? { type: "object", properties: {} };
    const properties =
      (inputSchema["properties"] as Record<string, unknown> | undefined) ?? {};

    const inputBindings: Record<string, string> = {};
    for (const arg of Object.keys(properties)) inputBindings[arg] = `$args.${arg}`;

    tools.push({
      name: toToolName(op.id, usedToolNames),
      description: describe(op),
      inputSchema,
      ...(op.outputSchema ? { outputSchema: op.outputSchema } : {}),
      plan: [{ operationId: op.id, inputBindings }],
      requiredScopes: [],
      approval: op.effect === "delete" ? "perCall" : "none",
    });

    upstreamOperations[op.id] = {
      method: op.http.method,
      pathTemplate: op.http.path,
      baseUrlRef: op.http.baseUrlRef ?? "default",
      authRequirementIds: op.authRequirementIds,
      parameterLocations: op.parameterLocations,
    };
    for (const id of op.authRequirementIds) usedAuthIds.add(id);
  }

  const authSchemes: Record<string, AuthRequirement> = {};
  for (const auth of graph.authRequirements) {
    if (usedAuthIds.has(auth.id)) authSchemes[auth.id] = auth;
  }

  return McpServerManifest.parse({
    manifestVersion: 1,
    projectId: graph.projectId,
    serverName: options.serverName ?? `${graph.projectId}-mcp`,
    serverDescription:
      options.serverDescription ??
      `Generated MCP server exposing ${tools.length} approved operation(s)`,
    baseUrls,
    upstreamOperations,
    authSchemes,
    tools,
    resources: [],
    prompts: [],
    credentialBindings: [...usedAuthIds].map((authRequirementId) => ({
      authRequirementId,
      vaultCredentialId: toEnvCredentialId(authRequirementId),
    })),
    workflowGraphRef: `${graph.projectId}@${graph.createdAt}`,
    createdAt: new Date().toISOString(),
  });
}
