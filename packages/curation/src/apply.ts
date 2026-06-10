import {
  McpServerManifest,
  type CurationProposal,
  type ToolDefinition,
  type WorkflowGraph,
} from "@protocolfoundry/core";
import {
  generateManifest,
  sanitizeToolName,
  scopesForEffect,
  type GenerateOptions,
} from "@protocolfoundry/generator";

/**
 * The human-in-the-loop step: which parts of the proposal the reviewer
 * accepted. "all" is a convenience for CLI --accept-all after reading the
 * proposal; the gateway never sees unapproved tools either way.
 */
export interface CurationApproval {
  refinementOperationIds: string[] | "all";
  composedToolNames: string[] | "all";
}

function uniqueName(raw: string, used: Set<string>): string {
  let name = sanitizeToolName(raw);
  while (used.has(name)) name = `${name}_2`;
  used.add(name);
  return name;
}

/**
 * Apply an approved CurationProposal to produce the curated manifest:
 * refined 1:1 tools plus composed task-level tools with multi-step plans.
 */
export function applyCuration(
  graph: WorkflowGraph,
  proposal: CurationProposal,
  approval: CurationApproval,
  options: GenerateOptions = {},
): McpServerManifest {
  const refinements =
    approval.refinementOperationIds === "all"
      ? proposal.refinements
      : proposal.refinements.filter((r) =>
          approval.refinementOperationIds.includes(r.operationId),
        );
  const composed =
    approval.composedToolNames === "all"
      ? proposal.composedTools
      : proposal.composedTools.filter((t) => approval.composedToolNames.includes(t.name));

  if (refinements.length === 0) {
    throw new Error("Approve at least one refinement — the manifest needs base tools");
  }

  const manifest = generateManifest(
    graph,
    { operationIds: refinements.map((r) => r.operationId), taskFlowIds: [] },
    options,
  );

  const usedNames = new Set<string>();
  const opsById = new Map(graph.operations.map((op) => [op.id, op]));

  // 1. Refine the 1:1 tools: curated names + agent-facing descriptions.
  for (const refinement of refinements) {
    const tool = manifest.tools.find(
      (t) => t.plan.length === 1 && t.plan[0]!.operationId === refinement.operationId,
    );
    if (!tool) continue;
    tool.name = uniqueName(refinement.toolName, usedNames);
    tool.description = refinement.description;
  }

  // 2. Add composed task-level tools.
  for (const composedTool of composed) {
    const stepOps = composedTool.steps.map((step) => {
      const op = opsById.get(step.operationId);
      if (!op) throw new Error(`Composed tool "${composedTool.name}" references unknown operation "${step.operationId}"`);
      return op;
    });

    // Manifest must stay self-contained: pull in step operations (and their
    // auth) that aren't already present from the 1:1 selection.
    for (const op of stepOps) {
      if (manifest.upstreamOperations[op.id]) continue;
      manifest.upstreamOperations[op.id] = {
        method: op.http.method,
        pathTemplate: op.http.path,
        baseUrlRef: op.http.baseUrlRef ?? "default",
        authRequirementIds: op.authRequirementIds,
        parameterLocations: op.parameterLocations,
      };
      for (const authId of op.authRequirementIds) {
        if (!manifest.authSchemes[authId]) {
          const scheme = graph.authRequirements.find((a) => a.id === authId);
          if (scheme) manifest.authSchemes[authId] = scheme;
        }
        if (!manifest.credentialBindings.some((b) => b.authRequirementId === authId)) {
          manifest.credentialBindings.push({
            authRequirementId: authId,
            vaultCredentialId: `env:PF_CRED_${authId.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`,
          });
        }
      }
    }

    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const arg of composedTool.arguments) {
      properties[arg.name] = { type: arg.type, description: arg.description };
      if (arg.required) required.push(arg.name);
    }

    const tool: ToolDefinition = {
      name: uniqueName(composedTool.name, usedNames),
      description: composedTool.description,
      inputSchema: {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
      },
      plan: composedTool.steps.map((step) => ({
        operationId: step.operationId,
        inputBindings: Object.fromEntries(step.bindings.map((b) => [b.arg, b.expression])),
      })),
      // Composed tools need every scope their steps touch.
      requiredScopes: [...new Set(stepOps.flatMap((op) => scopesForEffect(op.effect)))],
      // Destructive steps keep their gate even inside compositions.
      approval: stepOps.some((op) => op.effect === "delete") ? "perCall" : "none",
    };
    manifest.tools.push(tool);
  }

  return McpServerManifest.parse(manifest);
}
