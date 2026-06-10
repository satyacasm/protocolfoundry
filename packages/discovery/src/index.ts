import type { Source, WorkflowGraph } from "@protocolfoundry/core";
import { ingestOpenApi } from "./openapi.js";

export { ingestOpenApi, parseOpenApiDocument } from "./openapi.js";

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
