import {
  AuthRequirement,
  JsonSchemaObject,
  Operation,
  WorkflowGraph,
} from "@protocolfoundry/core";
import { parse as parseYaml } from "yaml";

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head"] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

type ParamLocation = "path" | "query" | "header" | "body";

interface OpenApiDoc {
  openapi?: string;
  info?: { title?: string; description?: string };
  servers?: Array<{ url?: string }>;
  paths?: Record<string, Record<string, unknown>>;
  components?: { securitySchemes?: Record<string, Record<string, unknown>> };
  security?: Array<Record<string, unknown>>;
}

/** Parse a raw OpenAPI document (JSON or YAML). */
export function parseOpenApiDocument(raw: string): OpenApiDoc {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    doc = parseYaml(raw);
  }
  if (typeof doc !== "object" || doc === null) {
    throw new Error("Could not parse OpenAPI document as JSON or YAML");
  }
  const spec = doc as OpenApiDoc;
  if (!spec.openapi?.startsWith("3")) {
    throw new Error(
      `Unsupported OpenAPI version "${spec.openapi ?? "unknown"}" — only 3.x is supported`,
    );
  }
  return spec;
}

/** Resolve a local JSON pointer like #/components/schemas/Task. */
function resolvePointer(root: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) {
    throw new Error(`Only local $refs are supported, got "${ref}"`);
  }
  let node: unknown = root;
  for (const segment of ref.slice(2).split("/")) {
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (typeof node !== "object" || node === null || !(key in node)) {
      throw new Error(`Unresolvable $ref "${ref}"`);
    }
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** Deep-resolve local $refs with a cycle guard. */
function deref(root: unknown, node: unknown, seen: Set<string> = new Set()): unknown {
  if (Array.isArray(node)) return node.map((item) => deref(root, item, seen));
  if (typeof node !== "object" || node === null) return node;
  const obj = node as Record<string, unknown>;
  if (typeof obj["$ref"] === "string") {
    const ref = obj["$ref"];
    if (seen.has(ref)) {
      return { description: `Recursive reference to ${ref}` };
    }
    return deref(root, resolvePointer(root, ref), new Set(seen).add(ref));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = deref(root, v, seen);
  return out;
}

function slugify(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function effectFor(method: HttpMethod): Operation["effect"] {
  switch (method) {
    case "get":
    case "head":
      return "read";
    case "post":
      return "create";
    case "put":
    case "patch":
      return "update";
    case "delete":
      return "delete";
  }
}

function mapSecuritySchemes(spec: OpenApiDoc): AuthRequirement[] {
  const schemes = spec.components?.securitySchemes ?? {};
  return Object.entries(schemes).map(([id, scheme]) => {
    const type = String(scheme["type"] ?? "");
    let kind: AuthRequirement["kind"];
    const detail: Record<string, string> = {};
    if (type === "apiKey") {
      kind = "apiKey";
      detail["in"] = String(scheme["in"] ?? "header");
      detail["name"] = String(scheme["name"] ?? "Authorization");
    } else if (type === "http" && scheme["scheme"] === "basic") {
      kind = "basic";
    } else if (type === "http") {
      kind = "bearer";
    } else if (type === "oauth2" || type === "openIdConnect") {
      kind = "oauth2";
    } else {
      kind = "none";
    }
    return AuthRequirement.parse({ id, kind, detail });
  });
}

interface BuiltInput {
  inputSchema: JsonSchemaObject;
  parameterLocations: Record<string, ParamLocation>;
}

function buildInput(
  spec: OpenApiDoc,
  pathLevelParams: unknown[],
  rawOp: Record<string, unknown>,
): BuiltInput {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  const parameterLocations: Record<string, ParamLocation> = {};

  const params = [
    ...pathLevelParams,
    ...(Array.isArray(rawOp["parameters"]) ? rawOp["parameters"] : []),
  ].map((p) => deref(spec, p) as Record<string, unknown>);

  for (const p of params) {
    const name = String(p["name"] ?? "");
    const loc = String(p["in"] ?? "query");
    if (!name || loc === "cookie") continue;
    const schema = (p["schema"] as Record<string, unknown> | undefined) ?? { type: "string" };
    if (typeof p["description"] === "string" && !("description" in schema)) {
      schema["description"] = p["description"];
    }
    properties[name] = schema;
    parameterLocations[name] = loc as ParamLocation;
    if (p["required"] === true || loc === "path") required.push(name);
  }

  const requestBody = deref(spec, rawOp["requestBody"]) as
    | Record<string, unknown>
    | undefined;
  const content = requestBody?.["content"] as Record<string, unknown> | undefined;
  const jsonContent = content?.["application/json"] as Record<string, unknown> | undefined;
  const bodySchema = jsonContent?.["schema"] as Record<string, unknown> | undefined;

  if (bodySchema) {
    const bodyProps = bodySchema["properties"] as Record<string, unknown> | undefined;
    if (bodySchema["type"] === "object" && bodyProps) {
      const bodyRequired = Array.isArray(bodySchema["required"])
        ? (bodySchema["required"] as string[])
        : [];
      for (const [name, schema] of Object.entries(bodyProps)) {
        // Path/query params win name collisions; body property gets prefixed.
        const argName = name in properties ? `body_${name}` : name;
        properties[argName] = schema;
        parameterLocations[argName] = "body";
        if (bodyRequired.includes(name)) required.push(argName);
      }
    } else {
      properties["body"] = bodySchema;
      parameterLocations["body"] = "body";
      if (requestBody?.["required"] === true) required.push("body");
    }
  }

  const inputSchema: JsonSchemaObject = {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
  return { inputSchema, parameterLocations };
}

function extractOutputSchema(
  spec: OpenApiDoc,
  rawOp: Record<string, unknown>,
): JsonSchemaObject | undefined {
  const responses = rawOp["responses"] as Record<string, unknown> | undefined;
  if (!responses) return undefined;
  for (const code of ["200", "201", "2XX", "default"]) {
    const response = deref(spec, responses[code]) as Record<string, unknown> | undefined;
    const content = response?.["content"] as Record<string, unknown> | undefined;
    const jsonContent = content?.["application/json"] as Record<string, unknown> | undefined;
    const schema = jsonContent?.["schema"] as Record<string, unknown> | undefined;
    if (schema) return schema;
  }
  return undefined;
}

function securityIdsFor(
  spec: OpenApiDoc,
  rawOp: Record<string, unknown>,
  knownIds: Set<string>,
): string[] {
  const security = (rawOp["security"] ?? spec.security) as
    | Array<Record<string, unknown>>
    | undefined;
  if (!Array.isArray(security)) return [];
  const ids = new Set<string>();
  for (const requirement of security) {
    for (const id of Object.keys(requirement)) {
      if (knownIds.has(id)) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * Ingest an OpenAPI 3.x document (JSON or YAML) into the WorkflowGraph IR.
 * Phase 1: operations + auth requirements; edges and task flows arrive with
 * the LLM analysis pass in Phase 2 (docs/04-roadmap.md).
 */
export function ingestOpenApi(
  rawContent: string,
  projectId: string,
  sourceId: string,
): WorkflowGraph {
  const spec = parseOpenApiDocument(rawContent);
  const authRequirements = mapSecuritySchemes(spec);
  const knownAuthIds = new Set(authRequirements.map((a) => a.id));

  const serverUrl = spec.servers?.[0]?.url;
  const baseUrls: Record<string, string> = serverUrl ? { default: serverUrl } : {};

  const operations: Operation[] = [];
  const usedIds = new Set<string>();

  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    const resolvedPathItem = deref(spec, pathItem) as Record<string, unknown>;
    const pathLevelParams = Array.isArray(resolvedPathItem["parameters"])
      ? resolvedPathItem["parameters"]
      : [];

    for (const method of HTTP_METHODS) {
      const rawOp = resolvedPathItem[method] as Record<string, unknown> | undefined;
      if (!rawOp || typeof rawOp !== "object") continue;

      let id = slugify(String(rawOp["operationId"] ?? `${method}_${path}`));
      while (usedIds.has(id)) id = `${id}_2`;
      usedIds.add(id);

      const { inputSchema, parameterLocations } = buildInput(spec, pathLevelParams, rawOp);
      const outputSchema = extractOutputSchema(spec, rawOp);
      const description =
        (typeof rawOp["description"] === "string" && rawOp["description"]) ||
        (typeof rawOp["summary"] === "string" && rawOp["summary"]) ||
        undefined;

      operations.push(
        Operation.parse({
          id,
          name: String(rawOp["summary"] ?? id),
          ...(description ? { description } : {}),
          http: {
            method: method.toUpperCase(),
            path,
            baseUrlRef: "default",
          },
          inputSchema: deref(spec, inputSchema) as JsonSchemaObject,
          ...(outputSchema
            ? { outputSchema: deref(spec, outputSchema) as JsonSchemaObject }
            : {}),
          parameterLocations,
          authRequirementIds: securityIdsFor(spec, rawOp, knownAuthIds),
          effect: effectFor(method),
          tags: Array.isArray(rawOp["tags"]) ? (rawOp["tags"] as string[]) : [],
          sourceId,
        }),
      );
    }
  }

  return WorkflowGraph.parse({
    graphVersion: 1,
    projectId,
    baseUrls,
    operations,
    edges: [],
    taskFlows: [],
    authRequirements,
    createdAt: new Date().toISOString(),
  });
}
