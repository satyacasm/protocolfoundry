import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import {
  ComposedToolProposal,
  CurationProposal,
  ExposureWarning,
  ToolRefinement,
  type WorkflowGraph,
} from "@protocolfoundry/core";

/**
 * The raw shape the LLM must return (structured output). Mirrors
 * CurationProposal minus the envelope fields we add ourselves.
 */
const RawProposal = z.object({
  refinements: z.array(ToolRefinement),
  composedTools: z.array(ComposedToolProposal),
  warnings: z.array(ExposureWarning),
});
export type RawProposal = z.infer<typeof RawProposal>;

/**
 * Pluggable LLM boundary so tests (and offline use) can inject a fake.
 * The real implementation is createAnthropicCurator below.
 */
export interface Curator {
  readonly model: string;
  propose(prompt: string): Promise<RawProposal>;
}

/** Compact, prompt-friendly view of the graph (full schemas are too noisy). */
export function summarizeGraphForPrompt(
  graph: WorkflowGraph,
  operationIds: string[],
): string {
  const selected = new Set(operationIds);
  const ops = graph.operations
    .filter((op) => selected.has(op.id))
    .map((op) => {
      const props =
        (op.inputSchema?.["properties"] as Record<string, { description?: string; type?: string }>) ?? {};
      const required = new Set(
        Array.isArray(op.inputSchema?.["required"]) ? (op.inputSchema["required"] as string[]) : [],
      );
      return {
        operationId: op.id,
        http: `${op.http.method} ${op.http.path}`,
        effect: op.effect,
        description: op.description ?? op.name,
        inputs: Object.entries(props).map(([name, schema]) => ({
          name,
          type: schema?.type ?? "unknown",
          required: required.has(name),
          ...(schema?.description ? { description: schema.description } : {}),
        })),
        outputFields: Object.keys(
          (op.outputSchema?.["properties"] as Record<string, unknown>) ??
            ((op.outputSchema?.["items"] as Record<string, unknown>)?.["properties"] as Record<string, unknown>) ??
            {},
        ),
      };
    });
  return JSON.stringify(ops, null, 2);
}

export function buildCurationPrompt(graph: WorkflowGraph, operationIds: string[]): string {
  return `You are curating an MCP (Model Context Protocol) server generated from an API so that AI agents can use it successfully. Naive one-tool-per-endpoint servers fail agents: vague names, doc-dump descriptions, and missing task-level operations cause wrong tool selection and incomplete tasks.

Here are the operations selected for exposure (JSON):

${summarizeGraphForPrompt(graph, operationIds)}

Produce:

1. "refinements" — for EVERY operation above: a snake_case toolName an agent will instantly understand (verb_noun, no API jargon like version prefixes), and a rewritten description that states what the tool does AND when an agent should call it, in one or two sentences. Do not copy marketing text.

2. "composedTools" — task-level tools for common multi-step business tasks a user would ask an agent to do that span 2+ operations (e.g. "create X and send it"). For each: snake_case name, description, the user-facing arguments, and sequential steps. Step bindings map an upstream argument to either "$args.<argName>" (a tool argument), "$steps[<n>].output.<field>" (a field from an earlier step's response, 0-indexed), or a literal string. Only compose flows that are genuinely useful; an empty list is acceptable.

3. "warnings" — operations whose exposure to agents deserves human scrutiny (destructive, bulk, billing, or auth-sensitive), with the reason.

Rules:
- Use ONLY operationIds from the list above.
- Binding expressions must reference output fields that actually exist in outputFields.
- Tool names must be unique across refinements and composedTools.`;
}

/** Real Claude-backed curator. Requires ANTHROPIC_API_KEY in the environment. */
export function createAnthropicCurator(model = "claude-opus-4-8"): Curator {
  const client = new Anthropic();
  return {
    model,
    async propose(prompt: string): Promise<RawProposal> {
      const response = await client.messages.parse({
        model,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        messages: [{ role: "user", content: prompt }],
        output_config: { format: zodOutputFormat(RawProposal) },
      });
      if (!response.parsed_output) {
        throw new Error("Curation model returned no parseable proposal");
      }
      return response.parsed_output;
    },
  };
}

/** Run the curation pass: graph + selection -> reviewed-by-human proposal artifact. */
export async function proposeCuration(
  graph: WorkflowGraph,
  operationIds: string[],
  curator: Curator,
): Promise<CurationProposal> {
  const known = new Set(graph.operations.map((op) => op.id));
  const unknown = operationIds.filter((id) => !known.has(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown operation ids: ${unknown.join(", ")}`);
  }

  const raw = await curator.propose(buildCurationPrompt(graph, operationIds));

  // Validate the model only referenced real operations; drop anything else.
  const selected = new Set(operationIds);
  const refinements = raw.refinements.filter((r) => selected.has(r.operationId));
  const composedTools = raw.composedTools.filter((tool) =>
    tool.steps.every((step) => selected.has(step.operationId)),
  );

  return CurationProposal.parse({
    proposalVersion: 1,
    projectId: graph.projectId,
    refinements,
    composedTools,
    warnings: raw.warnings.filter((w) => selected.has(w.operationId)),
    proposedBy: curator.model,
    createdAt: new Date().toISOString(),
  });
}
