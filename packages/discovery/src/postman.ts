import {
  AuthRequirement,
  JsonSchemaObject,
  Operation,
  WorkflowGraph,
} from "@protocolfoundry/core";

/**
 * Postman Collection v2.1 -> WorkflowGraph (Phase 4 ingestor).
 *
 * Real collections are messier than specs, so the mapping is deliberately
 * defensive:
 * - request bodies have no schema -> inferred from the example JSON values
 * - "required" is unknowable -> only path params are marked required
 * - auth is often left as "inherit" with no collection auth -> we fall back
 *   to the dominant explicit scheme in the collection (a collection where
 *   some requests carry `Authorization: Bearer {{token}}` almost certainly
 *   wants it everywhere except explicit noauth)
 * - multiple hosts become multiple baseUrls with per-operation refs
 */

interface PostmanUrl {
  raw?: string;
  protocol?: string;
  host?: string[];
  path?: Array<string | { value?: string }>;
  query?: Array<{ key?: string; value?: string; description?: string; disabled?: boolean }>;
  variable?: Array<{ key?: string; value?: string; description?: string }>;
}

interface PostmanRequest {
  method?: string;
  url?: PostmanUrl | string;
  description?: string | { content?: string };
  header?: Array<{ key?: string; value?: string }>;
  body?: {
    mode?: string;
    raw?: string;
    formdata?: Array<{ key?: string; value?: string; type?: string; disabled?: boolean }>;
    urlencoded?: Array<{ key?: string; value?: string; disabled?: boolean }>;
  };
  auth?: { type?: string };
}

interface PostmanItem {
  name?: string;
  item?: PostmanItem[];
  request?: PostmanRequest;
  response?: Array<{ code?: number; body?: string }>;
}

interface PostmanCollection {
  info?: { name?: string; schema?: string; _postman_id?: string; description?: string | { content?: string } };
  item?: PostmanItem[];
  auth?: { type?: string };
  variable?: Array<{ key?: string; value?: string }>;
}

export function isPostmanCollection(parsed: unknown): parsed is PostmanCollection {
  if (typeof parsed !== "object" || parsed === null) return false;
  const info = (parsed as PostmanCollection).info;
  return Boolean(
    info && (info._postman_id !== undefined || (info.schema ?? "").includes("getpostman.com")),
  );
}

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

function slugify(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "request";
}

function descriptionText(d: string | { content?: string } | undefined): string | undefined {
  if (typeof d === "string") return d.trim() || undefined;
  return d?.content?.trim() || undefined;
}

/** Infer a shallow JSON schema from a literal example value. */
export function inferSchema(value: unknown, depth = 3): Record<string, unknown> {
  if (value === null || value === undefined) return { type: "string" };
  if (Array.isArray(value)) {
    return depth <= 0 || value.length === 0
      ? { type: "array" }
      : { type: "array", items: inferSchema(value[0], depth - 1) };
  }
  switch (typeof value) {
    case "number":
      return { type: Number.isInteger(value) ? "integer" : "number" };
    case "boolean":
      return { type: "boolean" };
    case "object": {
      if (depth <= 0) return { type: "object" };
      const properties: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        properties[k] = inferSchema(v, depth - 1);
      }
      return { type: "object", properties };
    }
    default:
      return { type: "string" };
  }
}

function substituteVariables(text: string, variables: Map<string, string>): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (whole, name: string) => variables.get(name) ?? whole);
}

interface ParsedUrl {
  baseUrl: string | undefined;
  pathTemplate: string;
  pathParams: Array<{ name: string; description?: string }>;
  query: Array<{ key: string; value?: string; description?: string }>;
}

function parseUrl(url: PostmanUrl | string | undefined, variables: Map<string, string>): ParsedUrl {
  const structured: PostmanUrl =
    typeof url === "string" ? { raw: url } : (url ?? {});

  let host: string | undefined;
  let protocol = structured.protocol ?? "https";
  let segments: string[];

  if (structured.host && structured.host.length > 0) {
    host = substituteVariables(structured.host.join("."), variables);
    segments = (structured.path ?? []).map((s) =>
      typeof s === "string" ? s : (s.value ?? ""),
    );
  } else {
    // fall back to parsing raw
    const raw = substituteVariables(structured.raw ?? "", variables);
    const match = /^(?:(https?):\/\/)?([^/?#]+)?(\/[^?#]*)?/.exec(raw) ?? [];
    protocol = match[1] ?? protocol;
    host = match[2];
    segments = (match[3] ?? "").split("/").filter(Boolean);
  }

  const pathParams: Array<{ name: string; description?: string }> = [];
  const varDescriptions = new Map(
    (structured.variable ?? []).map((v) => [v.key ?? "", v.description]),
  );
  const templateSegments = segments.map((segment) => {
    const colon = /^:(\w+)$/.exec(segment);
    const moustache = /^\{\{(\w+)\}\}$/.exec(segment);
    // Known collection variables resolve in place; only UNRESOLVED
    // moustaches (and :params) become path parameters.
    if (moustache && variables.has(moustache[1]!)) {
      return variables.get(moustache[1]!)!;
    }
    const name = colon?.[1] ?? moustache?.[1];
    if (!name) return substituteVariables(segment, variables);
    const description = varDescriptions.get(name);
    pathParams.push({ name, ...(description ? { description } : {}) });
    return `{${name}}`;
  });

  const hostResolved = host && !host.includes("{{") ? host : undefined;
  return {
    baseUrl: hostResolved ? `${protocol}://${hostResolved}` : undefined,
    pathTemplate: `/${templateSegments.join("/")}`,
    pathParams,
    query: (structured.query ?? [])
      .filter((q) => !q.disabled && q.key)
      .map((q) => ({
        key: q.key!,
        ...(q.value !== undefined ? { value: q.value } : {}),
        ...(q.description ? { description: q.description } : {}),
      })),
  };
}

/** Ingest a Postman Collection v2.1 (JSON) into the WorkflowGraph IR. */
export function ingestPostman(
  rawContent: string,
  projectId: string,
  sourceId: string,
): WorkflowGraph {
  let collection: PostmanCollection;
  try {
    collection = JSON.parse(rawContent) as PostmanCollection;
  } catch (error) {
    throw new Error(`Not valid JSON: ${error instanceof Error ? error.message : error}`);
  }
  if (!isPostmanCollection(collection)) {
    throw new Error("Not a Postman collection (missing info._postman_id / schema)");
  }

  const variables = new Map(
    (collection.variable ?? [])
      .filter((v) => v.key && v.value !== undefined)
      .map((v) => [v.key!, v.value!]),
  );

  // Flatten the folder tree.
  const leaves: Array<{ item: PostmanItem; folders: string[] }> = [];
  (function walk(items: PostmanItem[], folders: string[]): void {
    for (const item of items) {
      if (item.request) leaves.push({ item, folders });
      if (item.item) walk(item.item, [...folders, item.name ?? ""]);
    }
  })(collection.item ?? [], []);

  // Dominant-auth heuristic for "inherit" (see module docs).
  const explicitlyAuthed = leaves.some(({ item }) => {
    const t = item.request?.auth?.type;
    if (t && t !== "noauth") return true;
    return (item.request?.header ?? []).some((h) => h.key?.toLowerCase() === "authorization");
  });
  const collectionAuthType = collection.auth?.type;
  const defaultAuth: string | undefined =
    collectionAuthType && collectionAuthType !== "noauth"
      ? collectionAuthType
      : explicitlyAuthed
        ? "bearer"
        : undefined;

  const authRequirements: AuthRequirement[] = [];
  const ensureAuth = (kind: "bearer" | "apiKey" | "basic"): string => {
    const id = kind === "bearer" ? "bearer_token" : kind === "basic" ? "basic_auth" : "api_key";
    if (!authRequirements.some((a) => a.id === id)) {
      authRequirements.push(AuthRequirement.parse({ id, kind, detail: {} }));
    }
    return id;
  };
  const mapAuthType = (t: string | undefined): "bearer" | "apiKey" | "basic" | undefined => {
    if (t === "bearer" || t === "oauth2") return "bearer";
    if (t === "apikey") return "apiKey";
    if (t === "basic") return "basic";
    return undefined;
  };

  // Multi-host support: most frequent host becomes "default".
  const hostCounts = new Map<string, number>();
  const parsedUrls = leaves.map(({ item }) => parseUrl(item.request!.url, variables));
  for (const u of parsedUrls) {
    if (u.baseUrl) hostCounts.set(u.baseUrl, (hostCounts.get(u.baseUrl) ?? 0) + 1);
  }
  const rankedHosts = [...hostCounts.entries()].sort((a, b) => b[1] - a[1]).map(([h]) => h);
  const baseUrls: Record<string, string> = {};
  const refFor = new Map<string, string>();
  rankedHosts.forEach((hostUrl, i) => {
    const ref = i === 0 ? "default" : slugify(new URL(hostUrl).hostname).toLowerCase();
    baseUrls[ref] = hostUrl;
    refFor.set(hostUrl, ref);
  });

  const operations: Operation[] = [];
  const usedIds = new Set<string>();

  leaves.forEach(({ item, folders }, index) => {
    const request = item.request!;
    const method = (request.method ?? "GET").toUpperCase();
    if (!METHODS.has(method)) return;
    const url = parsedUrls[index]!;

    let id = slugify(item.name ?? `${method}_${url.pathTemplate}`);
    if (!/^[A-Za-z]/.test(id)) id = `op_${id}`;
    while (usedIds.has(id)) id = `${id}_2`;
    usedIds.add(id);

    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    const parameterLocations: Record<string, "path" | "query" | "header" | "body"> = {};

    for (const p of url.pathParams) {
      properties[p.name] = { type: "string", ...(p.description ? { description: p.description } : {}) };
      parameterLocations[p.name] = "path";
      required.push(p.name);
    }
    for (const q of url.query) {
      if (q.key in properties) continue;
      properties[q.key] = {
        type: "string",
        ...(q.description
          ? { description: q.description }
          : q.value
            ? { description: `e.g. ${q.value}` }
            : {}),
      };
      parameterLocations[q.key] = "query";
    }

    const body = request.body;
    if (body?.mode === "raw" && body.raw?.trim()) {
      try {
        const example = JSON.parse(body.raw) as unknown;
        const schema = inferSchema(example);
        const exampleProps = (schema["properties"] as Record<string, unknown> | undefined) ?? {};
        if (schema["type"] === "object") {
          for (const [key, propSchema] of Object.entries(exampleProps)) {
            const argName = key in properties ? `body_${key}` : key;
            properties[argName] = propSchema;
            parameterLocations[argName] = "body";
          }
        } else {
          properties["body"] = schema;
          parameterLocations["body"] = "body";
        }
      } catch {
        properties["body"] = { type: "string", description: "Raw request body" };
        parameterLocations["body"] = "body";
      }
    } else if (body?.mode === "formdata" || body?.mode === "urlencoded") {
      const fields = (body.mode === "formdata" ? body.formdata : body.urlencoded) ?? [];
      for (const field of fields) {
        if (!field.key || field.disabled) continue;
        const argName = field.key in properties ? `body_${field.key}` : field.key;
        properties[argName] = { type: "string" };
        parameterLocations[argName] = "body";
      }
    }

    // Auth: explicit request setting wins; "noauth" opts out; else default.
    const requestAuthType = request.auth?.type;
    const hasAuthHeader = (request.header ?? []).some(
      (h) => h.key?.toLowerCase() === "authorization",
    );
    let authKind: "bearer" | "apiKey" | "basic" | undefined;
    if (requestAuthType === "noauth") authKind = undefined;
    else authKind = mapAuthType(requestAuthType) ?? (hasAuthHeader ? "bearer" : mapAuthType(defaultAuth));
    const authRequirementIds = authKind ? [ensureAuth(authKind)] : [];

    // Output schema from the first 2xx example response.
    let outputSchema: JsonSchemaObject | undefined;
    const example = (item.response ?? []).find((r) => (r.code ?? 200) < 300 && r.body);
    if (example?.body) {
      try {
        outputSchema = inferSchema(JSON.parse(example.body)) as JsonSchemaObject;
      } catch {
        /* non-JSON example */
      }
    }

    const effect =
      method === "GET" || method === "HEAD"
        ? "read"
        : method === "DELETE"
          ? "delete"
          : method === "POST"
            ? "create"
            : "update";

    const description = descriptionText(request.description);
    operations.push(
      Operation.parse({
        id,
        name: item.name ?? id,
        ...(description ? { description } : {}),
        http: {
          method,
          path: url.pathTemplate,
          baseUrlRef: url.baseUrl ? (refFor.get(url.baseUrl) ?? "default") : "default",
        },
        inputSchema: {
          type: "object",
          properties,
          ...(required.length > 0 ? { required } : {}),
        },
        ...(outputSchema ? { outputSchema } : {}),
        parameterLocations,
        authRequirementIds,
        effect,
        tags: folders.filter(Boolean),
        sourceId,
      }),
    );
  });

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
