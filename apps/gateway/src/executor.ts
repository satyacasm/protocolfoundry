import type {
  AuthRequirement,
  McpServerManifest,
  ToolDefinition,
  UpstreamOperation,
} from "@protocolfoundry/core";

export interface UpstreamCallRecord {
  operationId: string;
  method: string;
  url: string;
  status: number;
  durationMs: number;
}

export interface PlanResult {
  output: unknown;
  upstreamCalls: UpstreamCallRecord[];
}

/**
 * Resolves credential references (`env:VAR`, `vault:id`). May be async —
 * the gateway's resolver consults the encrypted vault.
 */
export type CredentialResolver = (
  vaultCredentialId: string,
) => string | undefined | Promise<string | undefined>;

export function envCredentialResolver(vaultCredentialId: string): string | undefined {
  if (!vaultCredentialId.startsWith("env:")) return undefined;
  return process.env[vaultCredentialId.slice(4)];
}

interface BindingContext {
  args: Record<string, unknown>;
  steps: Array<{ output: unknown }>;
}

function getPath(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** Resolve a binding expression: `$args.x.y`, `$steps[0].output.z`, or a literal. */
export function resolveBinding(expr: string, ctx: BindingContext): unknown {
  if (expr === "$args") return ctx.args;
  if (expr.startsWith("$args.")) return getPath(ctx.args, expr.slice(6).split("."));
  const stepMatch = /^\$steps\[(\d+)\]\.output(?:\.(.+))?$/.exec(expr);
  if (stepMatch) {
    const step = ctx.steps[Number(stepMatch[1])];
    if (!step) throw new Error(`Binding "${expr}" references a step that has not run`);
    return stepMatch[2] ? getPath(step.output, stepMatch[2].split(".")) : step.output;
  }
  if (expr.startsWith("$")) throw new Error(`Unsupported binding expression "${expr}"`);
  return expr; // literal
}

function applyAuth(
  scheme: AuthRequirement,
  secret: string,
  headers: Record<string, string>,
  query: URLSearchParams,
  secretQueryParams: string[],
): void {
  switch (scheme.kind) {
    case "apiKey": {
      const name = scheme.detail?.["name"] ?? "Authorization";
      if ((scheme.detail?.["in"] ?? "header") === "query") {
        query.set(name, secret);
        secretQueryParams.push(name);
      } else headers[name] = secret;
      break;
    }
    case "bearer":
    case "oauth2":
      // A secret containing a space already names its scheme (e.g. Kite
      // Connect's `token api_key:access_token`); send it verbatim. Real
      // bearer tokens never contain spaces.
      headers["Authorization"] = secret.includes(" ") ? secret : `Bearer ${secret}`;
      break;
    case "basic":
      headers["Authorization"] = `Basic ${Buffer.from(secret).toString("base64")}`;
      break;
    case "serviceAccount":
    case "none":
      break;
  }
}

async function buildRequest(
  manifest: McpServerManifest,
  op: UpstreamOperation,
  boundArgs: Record<string, unknown>,
  resolveCredential: CredentialResolver,
): Promise<{ url: string; loggableUrl: string; init: RequestInit }> {
  const baseUrl = manifest.baseUrls[op.baseUrlRef];
  if (!baseUrl) throw new Error(`Manifest has no base URL for ref "${op.baseUrlRef}"`);

  let path = op.pathTemplate;
  const query = new URLSearchParams();
  const headers: Record<string, string> = { Accept: "application/json" };
  let body: Record<string, unknown> | unknown | undefined;
  const hasBody = ["POST", "PUT", "PATCH"].includes(op.method);

  for (const [name, value] of Object.entries(boundArgs)) {
    if (value === undefined) continue;
    const loc =
      op.parameterLocations[name] ??
      (op.pathTemplate.includes(`{${name}}`) ? "path" : hasBody ? "body" : "query");
    switch (loc) {
      case "path":
        path = path.replace(`{${name}}`, encodeURIComponent(String(value)));
        break;
      case "query":
        query.set(name, String(value));
        break;
      case "header":
        headers[name] = String(value);
        break;
      case "body":
        if (name === "body") body = value;
        else body = { ...(typeof body === "object" && body !== null ? body : {}), [name]: value };
        break;
    }
  }

  const unresolved = path.match(/\{[^}]+\}/);
  if (unresolved) {
    throw new Error(`Missing required path parameter ${unresolved[0]} for ${op.pathTemplate}`);
  }

  const secretQueryParams: string[] = [];
  for (const authId of op.authRequirementIds) {
    const scheme = manifest.authSchemes[authId];
    if (!scheme) throw new Error(`Manifest has no auth scheme "${authId}"`);
    const binding = manifest.credentialBindings.find((b) => b.authRequirementId === authId);
    if (!binding) throw new Error(`No credential bound for auth scheme "${authId}"`);
    const secret = await resolveCredential(binding.vaultCredentialId);
    if (!secret) {
      throw new Error(
        `Credential "${binding.vaultCredentialId}" is not configured on the gateway`,
      );
    }
    applyAuth(scheme, secret, headers, query, secretQueryParams);
  }

  const base = `${baseUrl.replace(/\/+$/, "")}${path}`;
  const queryString = query.size > 0 ? `?${query.toString()}` : "";
  const url = `${base}${queryString}`;

  // Credentials must never enter logs or error messages (security model):
  // redact auth-carrying query params from the URL used for reporting.
  const loggableQuery = new URLSearchParams(query);
  for (const name of secretQueryParams) loggableQuery.set(name, "***");
  const loggableUrl = loggableQuery.size > 0 ? `${base}?${loggableQuery.toString()}` : base;

  const init: RequestInit = { method: op.method, headers };
  if (body !== undefined && hasBody) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  return { url, loggableUrl, init };
}

/**
 * undici buries the actual network failure (ECONNREFUSED, ENOTFOUND, cert
 * errors) in a cause chain under a generic "fetch failed" TypeError; walk
 * it so the tool error tells the agent what actually went wrong.
 */
function describeFetchFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const parts: string[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    if (current instanceof AggregateError && current.errors.length > 0) {
      parts.push(
        current.errors
          .map((e) => (e instanceof Error ? e.message : String(e)))
          .join("; "),
      );
      break;
    }
    if (current.message && current.message !== "fetch failed") parts.push(current.message);
    current = current.cause;
  }
  return parts.length > 0 ? parts.join(" — ") : error.message;
}

/**
 * Execute a tool's plan: sequential upstream calls with binding resolution.
 * The output of the final step is the tool result.
 */
export async function executePlan(
  manifest: McpServerManifest,
  tool: ToolDefinition,
  args: Record<string, unknown>,
  resolveCredential: CredentialResolver = envCredentialResolver,
): Promise<PlanResult> {
  const required = Array.isArray(tool.inputSchema["required"])
    ? (tool.inputSchema["required"] as string[])
    : [];
  const missing = required.filter((name) => args[name] === undefined);
  if (missing.length > 0) {
    throw new Error(`Missing required argument(s): ${missing.join(", ")}`);
  }

  const steps: Array<{ output: unknown }> = [];
  const upstreamCalls: UpstreamCallRecord[] = [];

  for (const call of tool.plan) {
    const op = manifest.upstreamOperations[call.operationId];
    if (!op) throw new Error(`Manifest has no upstream operation "${call.operationId}"`);

    const boundArgs: Record<string, unknown> = {};
    for (const [name, expr] of Object.entries(call.inputBindings)) {
      boundArgs[name] = resolveBinding(expr, { args, steps });
    }

    const { url, loggableUrl, init } = await buildRequest(manifest, op, boundArgs, resolveCredential);
    const startedAt = Date.now();
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (error) {
      // Query string omitted entirely: it may carry credentials (apiKey in query).
      throw new Error(
        `Upstream ${op.method} ${url.split("?")[0]} unreachable: ${describeFetchFailure(error)}`,
      );
    }
    const text = await response.text();
    upstreamCalls.push({
      operationId: call.operationId,
      method: op.method,
      url: loggableUrl,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });

    let output: unknown;
    try {
      output = text ? JSON.parse(text) : null;
    } catch {
      output = text;
    }
    if (!response.ok) {
      throw new Error(
        `Upstream ${op.method} ${op.pathTemplate} failed with ${response.status}: ${text.slice(0, 500)}`,
      );
    }
    steps.push({ output });
  }

  return { output: steps[steps.length - 1]?.output ?? null, upstreamCalls };
}
