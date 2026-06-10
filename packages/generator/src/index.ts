import type { McpServerManifest, WorkflowGraph } from "@protocolfoundry/core";

/** What the customer selected for exposure during human-in-the-loop curation. */
export interface CurationSelection {
  /** Operation ids to expose as simple 1:1 tools. */
  operationIds: string[];
  /** TaskFlow ids to expose as composed task-level tools. */
  taskFlowIds: string[];
}

/**
 * Phase 1 baseline: naive 1:1 generation (each selected operation becomes one
 * tool). Phase 2 adds the LLM curation pass that makes this product worth
 * paying for — see docs/02-product-strategy.md § Differentiators.
 */
export function generateManifest(
  _graph: WorkflowGraph,
  _selection: CurationSelection,
): McpServerManifest {
  throw new Error("Not implemented — Phase 1, see docs/04-roadmap.md");
}
