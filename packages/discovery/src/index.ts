import type { Source, WorkflowGraph } from "@protocolfoundry/core";
import { ingestOpenApi } from "./openapi.js";
import { ingestPostman, isPostmanCollection } from "./postman.js";

export { ingestOpenApi, parseOpenApiDocument } from "./openapi.js";
export { inferSchema, ingestPostman, isPostmanCollection } from "./postman.js";

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

/**
 * Every ingestor (OpenAPI, GraphQL, Postman, HAR, walkthrough) implements this
 * interface and produces the shared WorkflowGraph IR. Phase 1 implements
 * `openapi` only — see docs/04-roadmap.md.
 */
export interface Ingestor {
  readonly kind: Source["kind"];
  ingest(source: Source, rawContent: string, projectId: string): Promise<WorkflowGraph>;
}

/** OpenAPI 3.x → WorkflowGraph. */
export function createOpenApiIngestor(): Ingestor {
  return {
    kind: "openapi",
    async ingest(source, rawContent, projectId) {
      return ingestOpenApi(rawContent, projectId, source.id);
    },
  };
}
