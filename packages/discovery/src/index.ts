import type { Source, WorkflowGraph } from "@protocolfoundry/core";

/**
 * Every ingestor (OpenAPI, GraphQL, Postman, HAR, walkthrough) implements this
 * interface and produces the shared WorkflowGraph IR. Phase 1 implements
 * `openapi` only — see docs/04-roadmap.md.
 */
export interface Ingestor {
  readonly kind: Source["kind"];
  ingest(source: Source, rawContent: string, projectId: string): Promise<WorkflowGraph>;
}

/** Phase 1: OpenAPI 3.x → WorkflowGraph. Not yet implemented. */
export function createOpenApiIngestor(): Ingestor {
  return {
    kind: "openapi",
    ingest() {
      throw new Error("Not implemented — Phase 1, see docs/04-roadmap.md");
    },
  };
}
