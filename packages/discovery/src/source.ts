import type { WorkflowGraph } from "@protocolfoundry/core";
import { ingestOpenApi } from "./openapi.js";
import { ingestPostman, isPostmanCollection } from "./postman.js";

/**
 * Format auto-detection: Postman Collection v2.1 JSON or OpenAPI 3.x
 * (JSON/YAML). Used by the CLI `pf ingest` and the dashboard Forge.
 */
export function ingestSource(
  rawContent: string,
  projectId: string,
  sourceId: string,
): WorkflowGraph {
  try {
    const parsed = JSON.parse(rawContent) as unknown;
    if (isPostmanCollection(parsed)) return ingestPostman(rawContent, projectId, sourceId);
  } catch {
    /* YAML or invalid JSON — let the OpenAPI parser handle/report it */
  }
  return ingestOpenApi(rawContent, projectId, sourceId);
}
