import type { Source, WorkflowGraph } from "@protocolfoundry/core";
import { ingestOpenApi } from "./openapi.js";

export { ingestOpenApi, parseOpenApiDocument } from "./openapi.js";
export { inferSchema, ingestPostman, isPostmanCollection } from "./postman.js";
export { ingestSource } from "./source.js";
export {
  buildExtractionPrompt,
  createAnthropicDocsExtractor,
  findSpecCandidates,
  graphFromExtraction,
  htmlToText,
  ingestUrl,
  looksLikeHtml,
  RawDocsExtraction,
  type DocsExtractor,
  type IngestUrlOptions,
} from "./docs.js";

/**
 * Every ingestor (OpenAPI, GraphQL, Postman, HAR, walkthrough) implements this
 * interface and produces the shared WorkflowGraph IR. Implemented so far:
 * `openapi`, `postman`, `docsUrl` — see docs/04-roadmap.md.
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
