# SP2 — LLM Connector Derivation + Global Model Switch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every LLM boundary one global model default (`PF_ANTHROPIC_MODEL`, default haiku, with per-boundary + per-call overrides), and add an LLM `ConnectorDeriver` that proposes best-effort `ConnectorConfig`s during the curation pass, folded into the human-reviewed `CurationProposal` and applied via `applyCuration`.

**Architecture:** A single `resolveGlobalModel(explicit?, boundary?)` in `packages/core` becomes the fallback for the existing `createAnthropic*` factories. A new `ConnectorDeriver` boundary (own prompt + structured-output schema + scripted fake, mirroring `Curator`) runs alongside the curator; its validated output rides in `CurationProposal.connectorConfigs` and `applyCuration` writes it into the manifest's `connectorConfigs` (added in SP1). An OpenAPI ingestion fix preserves OAuth flow URLs / OIDC issuer so the deriver has real signal.

**Tech Stack:** TypeScript (strict, ESM/NodeNext, `.js` specifiers), zod 3, `@anthropic-ai/sdk` (structured outputs), vitest. All tests use scripted fakes — no API key.

---

## File Structure

**Create:**
- `packages/curation/src/derive-connectors.ts` — `ConnectorDeriver` interface, prompt builder, wire JSON schema, `RawConnectorDerivation` zod, `validateDerivedConnectors`, `createAnthropicConnectorDeriver`. One responsibility: the connector-derivation LLM boundary.
- `packages/curation/test/derive-connectors.test.ts`.
- `docs/decisions/ADR-0013-model-switch-and-derivation.md`.

**Modify:**
- `packages/core/src/models.ts` — add `ModelBoundary` + `resolveGlobalModel`.
- `packages/core/src/curation.ts` — add `connectorConfigs` to `CurationProposal`.
- `packages/discovery/src/openapi.ts` — `mapSecuritySchemes` preserves OAuth/OIDC detail.
- `packages/discovery/src/docs.ts` — `createAnthropicDocsExtractor` uses `resolveGlobalModel`.
- `packages/curation/src/propose.ts` — `createAnthropicCurator` uses `resolveGlobalModel`; `proposeCuration` gains `deriver?`.
- `packages/curation/src/apply.ts` — `applyCuration` writes `connectorConfigs`.
- `packages/evals/src/runner.ts` — `createAnthropicAgent` uses `resolveGlobalModel`.
- `apps/cli/src/index.ts` — `pf curate` wires the deriver + prints configs + help text.
- `apps/web/src/lib/forge-actions.ts` — wire the deriver; read-only active-model label.
- Tests: `packages/core/test/models.test.ts`, `packages/discovery/test/openapi.test.ts` (or the file that tests the ingestor), `packages/curation/test/curation.test.ts`.
- Docs: `docs/03-architecture.md`, `docs/WORKLOG.md`, `docs/guides/local-quickstart.md`.

---

### Task 1: `resolveGlobalModel` in core

**Files:**
- Modify: `packages/core/src/models.ts`
- Test: `packages/core/test/models.test.ts`

- [ ] **Step 1: Write the failing test** (append to `packages/core/test/models.test.ts`; it already imports from `../src/models.js` or `../src/index.js` — match the existing import style in that file)

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { resolveGlobalModel } from "../src/models.js";

describe("resolveGlobalModel", () => {
  const ENV = ["PF_ANTHROPIC_MODEL", "PF_ANTHROPIC_MODEL_CURATION", "PF_ANTHROPIC_MODEL_DISCOVERY"];
  beforeEach(() => ENV.forEach((k) => delete process.env[k]));
  afterEach(() => ENV.forEach((k) => delete process.env[k]));

  it("defaults to haiku when nothing is set", () => {
    expect(resolveGlobalModel()).toBe("claude-haiku-4-5");
    expect(resolveGlobalModel(undefined, "discovery")).toBe("claude-haiku-4-5");
  });

  it("uses the global env when set (alias resolved)", () => {
    process.env.PF_ANTHROPIC_MODEL = "sonnet";
    expect(resolveGlobalModel(undefined, "curation")).toBe("claude-sonnet-4-6");
  });

  it("prefers a per-boundary env over the global env", () => {
    process.env.PF_ANTHROPIC_MODEL = "sonnet";
    process.env.PF_ANTHROPIC_MODEL_DISCOVERY = "opus";
    expect(resolveGlobalModel(undefined, "discovery")).toBe("claude-opus-4-8");
    expect(resolveGlobalModel(undefined, "curation")).toBe("claude-sonnet-4-6");
  });

  it("lets an explicit arg win over every env", () => {
    process.env.PF_ANTHROPIC_MODEL = "sonnet";
    process.env.PF_ANTHROPIC_MODEL_CURATION = "opus";
    expect(resolveGlobalModel("haiku", "curation")).toBe("claude-haiku-4-5");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w @protocolfoundry/core && npx vitest run packages/core/test/models.test.ts`
Expected: FAIL — `resolveGlobalModel` is not exported.

- [ ] **Step 3: Implement** (append to `packages/core/src/models.ts`, after `resolveClaudeModel`)

```ts
/** The LLM boundaries an operator can target with a per-boundary model override. */
export type ModelBoundary = "curation" | "discovery" | "eval" | "connector";

/**
 * Resolve the model for an LLM boundary. Precedence (first defined wins):
 *   1. explicit arg (e.g. CLI --model, eval form field)
 *   2. per-boundary env  PF_ANTHROPIC_MODEL_<BOUNDARY>  (e.g. ..._CURATION)
 *   3. global env        PF_ANTHROPIC_MODEL
 *   4. DEFAULT_CLAUDE_MODEL (haiku)
 * Aliases and full IDs both resolve via resolveClaudeModel.
 */
export function resolveGlobalModel(explicit?: string, boundary?: ModelBoundary): string {
  if (explicit) return resolveClaudeModel(explicit);
  if (boundary) {
    const perBoundary = process.env[`PF_ANTHROPIC_MODEL_${boundary.toUpperCase()}`];
    if (perBoundary) return resolveClaudeModel(perBoundary);
  }
  const global = process.env.PF_ANTHROPIC_MODEL;
  if (global) return resolveClaudeModel(global);
  return DEFAULT_CLAUDE_MODEL;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build -w @protocolfoundry/core && npx vitest run packages/core/test/models.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/models.ts packages/core/test/models.test.ts
git commit -m "feat(core): resolveGlobalModel — one global model default per boundary

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Wire factories to the global default

**Files:**
- Modify: `packages/discovery/src/docs.ts`, `packages/curation/src/propose.ts`, `packages/evals/src/runner.ts`
- Test: `packages/discovery/test/docs.test.ts` (add a fallback assertion)

- [ ] **Step 1: Write the failing test** (add inside the existing model-related `describe` in `packages/discovery/test/docs.test.ts`; it already imports `createAnthropicDocsExtractor`)

```ts
  it("falls back to the global model env when no model is passed", () => {
    delete process.env.PF_ANTHROPIC_MODEL_DISCOVERY;
    process.env.PF_ANTHROPIC_MODEL = "sonnet";
    expect(createAnthropicDocsExtractor().model).toBe("claude-sonnet-4-6");
    delete process.env.PF_ANTHROPIC_MODEL;
    // with nothing set it is now the haiku default, NOT the old opus default
    expect(createAnthropicDocsExtractor().model).toBe("claude-haiku-4-5");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w @protocolfoundry/core && npm run build -w @protocolfoundry/discovery && npx vitest run packages/discovery/test/docs.test.ts`
Expected: FAIL — `createAnthropicDocsExtractor()` currently returns `claude-opus-4-8`.

- [ ] **Step 3: Implement**

In `packages/discovery/src/docs.ts`, change the import line that brings in `resolveClaudeModel` to also import `resolveGlobalModel` from `@protocolfoundry/core`, then replace:
```ts
  const model = modelOrAlias ? resolveClaudeModel(modelOrAlias) : "claude-opus-4-8";
```
with:
```ts
  const model = resolveGlobalModel(modelOrAlias, "discovery");
```
Update the JSDoc above `createAnthropicDocsExtractor` that says "defaults to opus (extraction quality bounds everything downstream)" to: "defaults to the global model (`PF_ANTHROPIC_MODEL`, else haiku); set `PF_ANTHROPIC_MODEL_DISCOVERY` to raise just extraction." If `resolveClaudeModel` is now unused in the file, remove it from the import.

In `packages/curation/src/propose.ts`, in `createAnthropicCurator`, replace:
```ts
  const model = resolveClaudeModel(modelOrAlias);
```
with `resolveGlobalModel(modelOrAlias, "curation")` and add `resolveGlobalModel` to the `@protocolfoundry/core` import (keep `resolveClaudeModel` only if still used elsewhere in the file; if not, replace it).

In `packages/evals/src/runner.ts`, find `createAnthropicAgent`'s model resolution (it currently uses `resolveClaudeModel` or a literal). Replace it with `resolveGlobalModel(modelOrAlias, "eval")` and import `resolveGlobalModel`. If `createAnthropicAgent` does not currently take a `modelOrAlias` param in the same shape, keep its existing signature and only change how the default is computed (explicit arg still wins).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run build -w @protocolfoundry/core && npm run build -w @protocolfoundry/discovery && npm run build -w @protocolfoundry/curation && npm run build -w @protocolfoundry/evals && npx vitest run packages/discovery/test/docs.test.ts packages/curation packages/evals`
Expected: PASS. If any existing test asserted the old opus default for discovery, update it to the new global behavior (explicit-model assertions are unaffected).

- [ ] **Step 5: Commit**

```bash
git add packages/discovery/src/docs.ts packages/curation/src/propose.ts packages/evals/src/runner.ts packages/discovery/test/docs.test.ts
git commit -m "feat: LLM factories honor the global model default (drops per-site pins)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: OpenAPI ingestion preserves OAuth flow URLs / OIDC issuer

**Files:**
- Modify: `packages/discovery/src/openapi.ts` (`mapSecuritySchemes`, lines ~95-116)
- Test: `packages/discovery/test/openapi.test.ts` (or the existing OpenAPI ingestor test file — locate it; if none exists for auth, add the test to the main discovery test file that calls `ingestOpenApi`)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { ingestOpenApi } from "@protocolfoundry/discovery";

describe("OpenAPI auth scheme detail", () => {
  it("preserves oauth2 authorizationCode flow URLs and scopes", async () => {
    const spec = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      servers: [{ url: "https://api.example.com" }],
      paths: {
        "/ping": { get: { operationId: "ping", responses: { "200": { description: "ok" } } } },
      },
      components: {
        securitySchemes: {
          oauthScheme: {
            type: "oauth2",
            flows: {
              authorizationCode: {
                authorizationUrl: "https://example.com/authorize",
                tokenUrl: "https://example.com/token",
                scopes: { read: "Read", write: "Write" },
              },
            },
          },
          oidcScheme: {
            type: "openIdConnect",
            openIdConnectUrl: "https://example.com/.well-known/openid-configuration",
          },
        },
      },
    });
    const graph = await ingestOpenApi(spec, "proj", "src-1");
    const oauth = graph.authRequirements.find((a) => a.id === "oauthScheme")!;
    expect(oauth.kind).toBe("oauth2");
    expect(oauth.detail?.authorizationUrl).toBe("https://example.com/authorize");
    expect(oauth.detail?.tokenUrl).toBe("https://example.com/token");
    expect(oauth.detail?.scopes).toBe("read write");

    const oidc = graph.authRequirements.find((a) => a.id === "oidcScheme")!;
    expect(oidc.kind).toBe("oauth2");
    expect(oidc.detail?.issuer).toBe("https://example.com/.well-known/openid-configuration");
  });

  it("invents no detail fields for an oauth2 scheme with no flows", async () => {
    const spec = JSON.stringify({
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      servers: [{ url: "https://api.example.com" }],
      paths: { "/ping": { get: { operationId: "ping", responses: { "200": { description: "ok" } } } } },
      components: { securitySchemes: { bare: { type: "oauth2" } } },
    });
    const graph = await ingestOpenApi(spec, "proj", "src-1");
    const bare = graph.authRequirements.find((a) => a.id === "bare")!;
    expect(bare.detail).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w @protocolfoundry/discovery && npx vitest run packages/discovery/test/openapi.test.ts`
Expected: FAIL — `detail` is `{}` for oauth2 today (flow URLs dropped).

- [ ] **Step 3: Implement** — in `packages/discovery/src/openapi.ts`, replace the `oauth2 || openIdConnect` branch in `mapSecuritySchemes`:

```ts
    } else if (type === "oauth2" || type === "openIdConnect") {
      kind = "oauth2";
    }
```
with:
```ts
    } else if (type === "oauth2") {
      kind = "oauth2";
      const flows = (scheme["flows"] ?? {}) as Record<string, Record<string, unknown>>;
      const flow = flows["authorizationCode"] ?? Object.values(flows)[0];
      if (flow) {
        if (typeof flow["authorizationUrl"] === "string") detail["authorizationUrl"] = flow["authorizationUrl"];
        if (typeof flow["tokenUrl"] === "string") detail["tokenUrl"] = flow["tokenUrl"];
        const scopes = flow["scopes"];
        if (scopes && typeof scopes === "object") {
          const names = Object.keys(scopes as Record<string, unknown>);
          if (names.length > 0) detail["scopes"] = names.join(" ");
        }
      }
    } else if (type === "openIdConnect") {
      kind = "oauth2";
      if (typeof scheme["openIdConnectUrl"] === "string") detail["issuer"] = scheme["openIdConnectUrl"];
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build -w @protocolfoundry/discovery && npx vitest run packages/discovery/test/openapi.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/discovery/src/openapi.ts packages/discovery/test/openapi.test.ts
git commit -m "feat(discovery): preserve OAuth flow URLs / OIDC issuer in auth detail

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `ConnectorDeriver` boundary + validation

**Files:**
- Create: `packages/curation/src/derive-connectors.ts`
- Test: `packages/curation/test/derive-connectors.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { WorkflowGraph } from "@protocolfoundry/core";
import {
  buildConnectorPrompt,
  validateDerivedConnectors,
  type ConnectorDeriver,
  type RawConnectorDerivation,
} from "../src/derive-connectors.js";

const graph = {
  projectId: "proj",
  baseUrls: { default: "https://api.kite.trade" },
  authRequirements: [
    { id: "kite", kind: "oauth2", detail: {} },
    { id: "apikeyAuth", kind: "apiKey", detail: { in: "header", name: "X-Key" } },
  ],
  operations: [],
} as unknown as WorkflowGraph;

describe("buildConnectorPrompt", () => {
  it("includes each auth requirement's id, kind, detail and the base URLs", () => {
    const prompt = buildConnectorPrompt(graph);
    expect(prompt).toContain("kite");
    expect(prompt).toContain("oauth2");
    expect(prompt).toContain("https://api.kite.trade");
  });
});

describe("validateDerivedConnectors", () => {
  it("keeps valid configs (keyed by authRequirementId) and drops invalid ones", () => {
    const raw: RawConnectorDerivation = {
      connectors: [
        {
          authRequirementId: "kite",
          config: {
            id: "zerodha-kite",
            authorizeUrl: "https://kite.zerodha.com/connect/login",
            tokenUrl: "https://api.kite.trade/session/token",
            appCredentials: [{ id: "api_key", label: "API key", valueFormat: "k" }],
            params: { callbackParam: "request_token" },
            derive: [
              { op: "concat", inputs: ["api_key", "request_token", "api_secret"], as: "checksum_input" },
              { op: "sha256", input: "checksum_input", as: "checksum" },
            ],
            exchange: { body: { api_key: "api_key", request_token: "request_token", checksum: "checksum" } },
            produces: [{ vaultRowId: "KITE_ACCESS_TOKEN", from: "access_token" }],
          },
        },
        {
          // invalid: neither discovery nor explicit authorizeUrl+tokenUrl
          authRequirementId: "broken",
          config: { id: "x", produces: [{ vaultRowId: "Y", from: "access_token" }] },
        },
      ],
    };
    const { configs, dropped } = validateDerivedConnectors(raw);
    expect(Object.keys(configs)).toEqual(["kite"]);
    expect(configs.kite.id).toBe("zerodha-kite");
    expect(dropped).toHaveLength(1);
    expect(dropped[0].authRequirementId).toBe("broken");
  });
});

describe("ConnectorDeriver (scripted fake)", () => {
  it("conforms to the interface", async () => {
    const fake: ConnectorDeriver = {
      model: "fake",
      async derive() {
        return { connectors: [] };
      },
    };
    expect((await fake.derive("x")).connectors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/curation/test/derive-connectors.test.ts`
Expected: FAIL — cannot resolve `../src/derive-connectors.js`.

- [ ] **Step 3: Implement** `packages/curation/src/derive-connectors.ts`

```ts
import Anthropic from "@anthropic-ai/sdk";
import {
  ConnectorConfig,
  resolveGlobalModel,
  supportsAdaptiveThinking,
  type WorkflowGraph,
} from "@protocolfoundry/core";

/** The raw shape the LLM returns; each `config` is validated against ConnectorConfig. */
export interface RawConnectorDerivation {
  connectors: { authRequirementId: string; config: unknown }[];
  warnings?: { authRequirementId: string; reason: string }[];
}

/** Pluggable LLM boundary, mirroring Curator. Real impl: createAnthropicConnectorDeriver. */
export interface ConnectorDeriver {
  readonly model: string;
  derive(prompt: string): Promise<RawConnectorDerivation>;
}

/** Compact view of the graph's auth surface for the prompt. */
export function buildConnectorPrompt(graph: WorkflowGraph): string {
  const auth = graph.authRequirements.map((a) => ({ id: a.id, kind: a.kind, detail: a.detail ?? {} }));
  return `Here are an API's authentication requirements and base URLs (JSON):

${JSON.stringify({ baseUrls: graph.baseUrls, authRequirements: auth }, null, 2)}`;
}

/** Static instructions, cached as the system block. */
export const CONNECTOR_SYSTEM_PROMPT =
  `You produce sanctioned OAuth connector configs so a user can sign in on the provider's own page and we capture the redirect token. For EACH auth requirement that is a genuine OAuth/OIDC flow (kind "oauth2", or a "bearer" that the detail shows is OAuth), emit one connector config. For plain API keys or HTTP basic, emit nothing — those use manual paste.

For each config set:
- "id": a slug (e.g. the provider name).
- Endpoints: if an OIDC issuer / .well-known URL is known, set "discovery": { "issuer": "<url>" }. Otherwise set explicit "authorizeUrl" AND "tokenUrl" from the spec.
- "appCredentials": the app-level secrets the operator registers once (e.g. client_id/client_secret, or api_key/api_secret) — id, label, valueFormat. Never include secret VALUES.
- "params": { "callbackParam": "code" for standard OAuth, or "request_token" etc. for custom; "scopes", "pkce" when applicable }.
- For non-standard handshakes only (e.g. a SHA256 checksum): "derive" steps using ONLY { "op": "concat", "inputs": [...], "as": "..." } and { "op": "sha256", "input": "...", "as": "..." }, plus an "exchange": { "body": { field: valueKey } } mapping form fields to value keys.
- "produces": [{ "vaultRowId": "<UPPER_SNAKE>", "from": "access_token" }].
- "rotation": a note if the token expires (e.g. "expires daily ~6am IST").

Output ONLY data — never code, never secret values. If you are unsure, omit the connector rather than guess wrong.`;

const obj = (properties: Record<string, unknown>, required: string[]): Record<string, unknown> => ({
  type: "object",
  additionalProperties: false,
  properties,
  required,
});
const str = { type: "string" } as const;

const RAW_DERIVATION_JSON_SCHEMA = obj(
  {
    connectors: {
      type: "array",
      items: obj(
        {
          authRequirementId: str,
          config: { type: "object", additionalProperties: true },
        },
        ["authRequirementId", "config"],
      ),
    },
  },
  ["connectors"],
);

/** Parse each derived config against ConnectorConfig; drop (do not throw on) invalid ones. */
export function validateDerivedConnectors(raw: RawConnectorDerivation): {
  configs: Record<string, ConnectorConfig>;
  dropped: { authRequirementId: string; reason: string }[];
} {
  const configs: Record<string, ConnectorConfig> = {};
  const dropped: { authRequirementId: string; reason: string }[] = [];
  for (const entry of raw.connectors) {
    const parsed = ConnectorConfig.safeParse(entry.config);
    if (parsed.success) configs[entry.authRequirementId] = parsed.data;
    else dropped.push({ authRequirementId: entry.authRequirementId, reason: parsed.error.message });
  }
  return { configs, dropped };
}

/**
 * Real Claude-backed deriver. Requires ANTHROPIC_API_KEY. Defaults to the
 * global model (PF_ANTHROPIC_MODEL, else haiku); PF_ANTHROPIC_MODEL_CONNECTOR overrides.
 */
export function createAnthropicConnectorDeriver(modelOrAlias?: string): ConnectorDeriver {
  const model = resolveGlobalModel(modelOrAlias, "connector");
  const client = new Anthropic();
  return {
    model,
    async derive(prompt: string): Promise<RawConnectorDerivation> {
      const response = await client.messages.create({
        model,
        max_tokens: 8000,
        ...(supportsAdaptiveThinking(model) ? { thinking: { type: "adaptive" as const } } : {}),
        system: [{ type: "text", text: CONNECTOR_SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages: [{ role: "user", content: prompt }],
        output_config: { format: { type: "json_schema", schema: RAW_DERIVATION_JSON_SCHEMA } },
      });
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
      if (!text) {
        throw new Error(`Connector deriver returned no output (stop_reason: ${response.stop_reason})`);
      }
      return JSON.parse(text) as RawConnectorDerivation;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build -w @protocolfoundry/core && npm run build -w @protocolfoundry/curation && npx vitest run packages/curation/test/derive-connectors.test.ts`
Expected: PASS.

- [ ] **Step 5: Export + commit**

Add `export * from "./derive-connectors.js";` to `packages/curation/src/index.ts` (match the existing export style there).

```bash
git add packages/curation/src/derive-connectors.ts packages/curation/src/index.ts packages/curation/test/derive-connectors.test.ts
git commit -m "feat(curation): ConnectorDeriver boundary + validateDerivedConnectors

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Fold derivation into the proposal + apply it

**Files:**
- Modify: `packages/core/src/curation.ts`, `packages/curation/src/propose.ts`, `packages/curation/src/apply.ts`
- Test: `packages/curation/test/curation.test.ts`

- [ ] **Step 1: Write the failing test** (append to `packages/curation/test/curation.test.ts`)

```ts
import { type ConnectorDeriver } from "../src/derive-connectors.js";

const fakeDeriver: ConnectorDeriver = {
  model: "fake-deriver",
  async derive() {
    return {
      connectors: [
        {
          authRequirementId: "auth1",
          config: {
            id: "oauth2-generic",
            discovery: { issuer: "https://accounts.example.com" },
            appCredentials: [{ id: "client_id", label: "Client ID", valueFormat: "id" }],
            params: { callbackParam: "code" },
            produces: [{ vaultRowId: "EXAMPLE_TOKEN", from: "access_token" }],
          },
        },
      ],
    };
  },
};

describe("connector derivation in curation", () => {
  it("includes validated connectorConfigs in the proposal and applies them to the manifest", async () => {
    const graph = await taskboardGraph();
    const ids = graph.operations.map((o) => o.id);
    const curator = { model: "fake-curator", async propose() { return CANNED; } };
    const proposal = await proposeCuration(graph, ids, curator, fakeDeriver);
    expect(proposal.connectorConfigs.auth1.id).toBe("oauth2-generic");

    const manifest = applyCuration(graph, proposal, {
      refinementOperationIds: "all",
      composedToolNames: "all",
    });
    expect(manifest.connectorConfigs.auth1.discovery?.issuer).toBe("https://accounts.example.com");
  });

  it("defaults connectorConfigs to {} when no deriver is passed", async () => {
    const graph = await taskboardGraph();
    const ids = graph.operations.map((o) => o.id);
    const curator = { model: "fake-curator", async propose() { return CANNED; } };
    const proposal = await proposeCuration(graph, ids, curator);
    expect(proposal.connectorConfigs).toEqual({});
  });
});
```

(`taskboardGraph`, `CANNED`, `proposeCuration`, `applyCuration`, `CurationProposal` are already imported/defined at the top of this test file from the existing suite.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w @protocolfoundry/core && npx vitest run packages/curation/test/curation.test.ts`
Expected: FAIL — `proposeCuration` takes 3 args; `proposal.connectorConfigs` undefined.

- [ ] **Step 3: Implement**

In `packages/core/src/curation.ts`: add `import { ConnectorConfig } from "./connector.js";` near the top, and add to the `CurationProposal` object (after `warnings`):
```ts
  /** Derived sanctioned-connect configs keyed by authRequirementId (ADR-0013). */
  connectorConfigs: z.record(ConnectorConfig).default({}),
```

In `packages/curation/src/propose.ts`: import the deriver pieces and extend `proposeCuration`:
```ts
import { validateDerivedConnectors, type ConnectorDeriver } from "./derive-connectors.js";
import { buildConnectorPrompt } from "./derive-connectors.js";
```
Change the signature and body tail:
```ts
export async function proposeCuration(
  graph: WorkflowGraph,
  operationIds: string[],
  curator: Curator,
  deriver?: ConnectorDeriver,
): Promise<CurationProposal> {
  // ... existing validation + curator.propose unchanged ...

  let connectorConfigs = {};
  if (deriver) {
    const rawDerivation = await deriver.derive(buildConnectorPrompt(graph));
    connectorConfigs = validateDerivedConnectors(rawDerivation).configs;
  }

  return CurationProposal.parse({
    proposalVersion: 1,
    projectId: graph.projectId,
    refinements,
    composedTools,
    warnings: raw.warnings.filter((w) => selected.has(w.operationId)),
    connectorConfigs,
    proposedBy: curator.model,
    createdAt: new Date().toISOString(),
  });
}
```

In `packages/curation/src/apply.ts`: just before the final `return McpServerManifest.parse(manifest);`, add:
```ts
  // Carry derived connector configs through to the manifest (SP1 connectorConfigs).
  manifest.connectorConfigs = { ...manifest.connectorConfigs, ...proposal.connectorConfigs };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build -w @protocolfoundry/core && npm run build -w @protocolfoundry/curation && npx vitest run packages/curation/test/curation.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/curation.ts packages/curation/src/propose.ts packages/curation/src/apply.ts packages/curation/test/curation.test.ts
git commit -m "feat(curation): fold derived connectorConfigs into proposal + applyCuration

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: CLI + web wiring + read-only model label

**Files:**
- Create: `packages/curation/src/format-connectors.ts` (pure CLI/print helper) + test
- Modify: `apps/cli/src/index.ts` (`pf curate`), `apps/web/src/lib/forge-actions.ts`
- Test: `packages/curation/test/format-connectors.test.ts`

- [ ] **Step 1: Write the failing test** for the pure print helper

```ts
// packages/curation/test/format-connectors.test.ts
import { describe, expect, it } from "vitest";
import { formatConnectorConfigs } from "../src/format-connectors.js";

describe("formatConnectorConfigs", () => {
  it("summarizes each connector's flow type, produced rows and rotation", () => {
    const out = formatConnectorConfigs({
      kite: {
        id: "zerodha-kite",
        authorizeUrl: "https://kite.zerodha.com/connect/login",
        tokenUrl: "https://api.kite.trade/session/token",
        appCredentials: [{ id: "api_key", label: "API key", valueFormat: "k" }],
        params: { callbackParam: "request_token", scopes: [], pkce: false, responseType: "code", grantType: "authorization_code" },
        derive: [],
        produces: [{ vaultRowId: "KITE_ACCESS_TOKEN", from: "access_token" }],
        rotation: "expires daily",
      },
    } as never);
    expect(out).toContain("kite");
    expect(out).toContain("zerodha-kite");
    expect(out).toContain("KITE_ACCESS_TOKEN");
    expect(out).toContain("expires daily");
    expect(out).toContain("explicit endpoints");
  });

  it("renders a friendly message for an empty map", () => {
    expect(formatConnectorConfigs({})).toMatch(/no .*connector/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/curation/test/format-connectors.test.ts`
Expected: FAIL — cannot resolve `../src/format-connectors.js`.

- [ ] **Step 3: Implement** `packages/curation/src/format-connectors.ts`

```ts
import type { ConnectorConfig } from "@protocolfoundry/core";

/** Human-readable summary of derived connector configs for the curation review print. */
export function formatConnectorConfigs(configs: Record<string, ConnectorConfig>): string {
  const ids = Object.keys(configs);
  if (ids.length === 0) return "No sanctioned-connect configs derived (credentials use manual paste).";
  return ids
    .map((authId) => {
      const c = configs[authId]!;
      const where = c.discovery ? `OIDC discovery (${c.discovery.issuer})` : "explicit endpoints";
      const rows = c.produces.map((p) => p.vaultRowId).join(", ");
      const rotation = c.rotation ? ` · rotation: ${c.rotation}` : "";
      return `  ${authId} → ${c.id} [${where}] captures ${c.params.callbackParam} → ${rows}${rotation}`;
    })
    .join("\n");
}
```

Add `export * from "./format-connectors.js";` to `packages/curation/src/index.ts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build -w @protocolfoundry/curation && npx vitest run packages/curation/test/format-connectors.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the CLI** — in `apps/cli/src/index.ts`, in the `pf curate` command: add `createAnthropicConnectorDeriver` and `formatConnectorConfigs` to the `@protocolfoundry/curation` import; construct the deriver and pass it to `proposeCuration`; print the configs after the refinements:

```ts
    const deriver = createAnthropicConnectorDeriver(flags.get("--model") ?? undefined);
    const proposal = await proposeCuration(graph, selection, curator, deriver);
    // ...after printing refinements/composed tools...
    console.log("\nDerived sanctioned-connect configs (review before apply):");
    console.log(formatConnectorConfigs(proposal.connectorConfigs));
```

Update the `pf curate` / `pf ingest` help text block to mention: `Model defaults to PF_ANTHROPIC_MODEL (else haiku); --model overrides this run.` Keep the existing `--model` flag behavior.

- [ ] **Step 6: Wire the web action** — in `apps/web/src/lib/forge-actions.ts`: add `createAnthropicConnectorDeriver` to the `@protocolfoundry/curation` import; where it constructs the curator (`const curator = createAnthropicCurator();`), pass a deriver into `proposeCuration` guarded by the API key, mirroring the extractor guard at line ~85:

```ts
    const curator = createAnthropicCurator();
    const deriver = process.env.ANTHROPIC_API_KEY ? createAnthropicConnectorDeriver() : undefined;
    const proposal = await proposeCuration(graph, selection, curator, deriver);
```

(Use the actual variable names already in that function for `graph`/`selection`/the proposal — adapt to the existing code; if no API key, `deriver` is `undefined` and behavior is unchanged.)

- [ ] **Step 7: Add the read-only active-model label** — in `apps/web/src/lib/forge-actions.ts` (or the nearest server module the forge page already imports), export:

```ts
import { resolveGlobalModel } from "@protocolfoundry/core";

/** The active model the LLM steps will use, for read-only display on the dashboard. */
export function activeModelLabel(): string {
  return resolveGlobalModel(undefined, "curation");
}
```

Render it where the forge/curate page already shows status (a small `Model: {activeModelLabel()}` line). If the page is a server component, call it directly; do not add client state.

- [ ] **Step 8: Verify + commit**

Run: `npm run typecheck && npm test`
Expected: all workspaces typecheck; full suite green.

```bash
git add packages/curation/src/format-connectors.ts packages/curation/src/index.ts packages/curation/test/format-connectors.test.ts apps/cli/src/index.ts apps/web/src/lib/forge-actions.ts
git commit -m "feat: wire ConnectorDeriver into pf curate + web forge; read-only model label

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: ADR-0013 + doc sync

**Files:**
- Create: `docs/decisions/ADR-0013-model-switch-and-derivation.md`
- Modify: `docs/03-architecture.md`, `docs/WORKLOG.md`, `docs/guides/local-quickstart.md`

- [ ] **Step 1: Write ADR-0013**

```markdown
# ADR-0013: Global model switch + LLM connector derivation in curation

Status: Accepted (2026-06-15)

## Context

Every LLM boundary pinned its own model default (discovery defaulted to opus,
curation to haiku, the web forge to whatever the factory chose), so there was no
single global control. Separately, SP1's ConnectorConfig had to be hand-authored.

## Decision

1. One global default: `resolveGlobalModel(explicit?, boundary?)` in core with
   precedence explicit > `PF_ANTHROPIC_MODEL_<BOUNDARY>` > `PF_ANTHROPIC_MODEL` >
   haiku. Every `createAnthropic*` factory falls back to it; per-call overrides
   (CLI `--model`, eval form) still win. The dashboard shows the active model
   read-only; a writable picker is deferred to SP3.
2. A separate `ConnectorDeriver` LLM boundary derives best-effort ConnectorConfigs
   from the graph's auth requirements + base URLs during the curation pass.
   Output is validated against ConnectorConfig (invalid dropped, never shipped)
   and folded into the existing CurationProposal, applied by applyCuration —
   reusing the human-approve-before-apply gate (ADR-0004). No new approval surface.
3. The OpenAPI ingestor now preserves OAuth flow URLs / OIDC issuer in
   AuthRequirement.detail so derivation has real signal.

## Consequences

- Operators switch models in one place (`PF_ANTHROPIC_MODEL`); default is haiku,
  including for doc extraction — raise it per-boundary (`PF_ANTHROPIC_MODEL_DISCOVERY`).
- Most OAuth/OIDC providers get an auto-derived config the operator just approves;
  non-OAuth credentials keep the manual paste flow (ADR-0011).
- SP3 adds the connect-time surfaces (popup, `pf connect`, gateway re-auth deep-link),
  a writable model picker, and richer dashboard review of derived configs.
```

- [ ] **Step 2: Doc sync**

In `docs/03-architecture.md`, update the `packages/curation` bullet to note it now also derives connector configs, and add a line about the global model switch where models/LLM boundaries are described.

In `docs/WORKLOG.md`, add a new top entry:
```markdown
## 2026-06-15 — SP2: global model switch + connector derivation

- `resolveGlobalModel` (core): one global default (`PF_ANTHROPIC_MODEL`, else haiku)
  honored by all LLM factories; per-boundary + per-call overrides. Drops the old
  per-site pins (discovery no longer defaults to opus).
- `ConnectorDeriver` (curation) derives ConnectorConfigs into the reviewed
  CurationProposal; `applyCuration` writes them to the manifest. OpenAPI ingestor
  now preserves OAuth flow URLs / OIDC issuer (ADR-0013).
- Next: SP3 (connect/rotation surfaces + writable model picker), SP4 (unsupported-API intake).
```

In `docs/guides/local-quickstart.md`, add `PF_ANTHROPIC_MODEL` (and the `PF_ANTHROPIC_MODEL_<BOUNDARY>` overrides) to the environment-variables section with a one-line description and the haiku default.

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/ADR-0013-model-switch-and-derivation.md docs/03-architecture.md docs/WORKLOG.md docs/guides/local-quickstart.md
git commit -m "docs: ADR-0013 model switch + connector derivation; sync guides

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:**
- Global model switch (`resolveGlobalModel`, precedence, default haiku) → Task 1. ✓
- Factories honor the global; discovery opus default dropped → Task 2. ✓
- Dashboard read-only model display → Task 6 Step 7. ✓
- Ingestion fix (OAuth flow URLs / OIDC issuer) → Task 3. ✓
- `ConnectorDeriver` interface + prompt + `validateDerivedConnectors` + real impl → Task 4. ✓
- `CurationProposal.connectorConfigs` + `proposeCuration` deriver wiring + `applyCuration` apply → Task 5. ✓
- CLI deriver wiring + proposal print + help text → Task 6 (Steps 5, and help text). ✓
- Web `forge-actions` deriver wiring (API-key guarded) → Task 6 Step 6. ✓
- Reused review gate (no new approval surface) → Tasks 5–6 (proposal carries configs; applyCuration applies). ✓
- ADR-0013 + doc sync (incl. local-quickstart env vars) → Task 7. ✓
- Tests use scripted fakes, no API key → Tasks 1,3,4,5,6 all use fakes/env, no key. ✓

**Placeholder scan:** No TBD/TODO; each code step shows complete code; commands have expected output. Task 6 Steps 6–7 say "adapt to existing variable names" — this is deliberate (the surrounding web code's local names aren't reproduced here), not a missing implementation; the inserted code is fully specified.

**Type consistency:** `resolveGlobalModel(explicit?, boundary?)` + `ModelBoundary` (Task 1) are used identically in Tasks 2, 4, 6. `ConnectorDeriver`/`RawConnectorDerivation`/`validateDerivedConnectors`/`buildConnectorPrompt` (Task 4) match their use in Task 5. `CurationProposal.connectorConfigs` (Task 5) is `Record<string, ConnectorConfig>`, consumed by `formatConnectorConfigs` (Task 6) and `applyCuration` (Task 5) with the same shape. `connectorConfigs` on the manifest is the SP1 field. ✓
