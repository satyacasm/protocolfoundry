# SP1 — Sanctioned-OAuth Connector Engine (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared, data-driven connector engine — a new `@protocolfoundry/connectors` package plus a declarative connector-config schema in `core` — that runs sanctioned OAuth2/OIDC authorization-code flows (with OIDC discovery and a fixed, safe exchange-transform vocabulary for non-standard providers like Kite), producing only `SealedSecret[]` for a caller to seal.

**Architecture:** Pure orchestration with injected I/O (an injected `fetch`; no vault, browser, or `process.env` access) so everything is unit-testable with scripted fakes and **no API key**, matching the `discovery`/`evals` convention. The engine's only output is `{ vaultRowId, secret }[]` written into vault rows the gateway *already* resolves — gateway resolution is untouched. SP1 delivers the engine + schema + ADR-0012 only; web/CLI surfaces (SP3), LLM config derivation + global model switch (SP2), and request intake (SP4) are out of scope.

**Tech Stack:** TypeScript (strict, ESM/NodeNext, `.js` import specifiers), zod 3, Node ≥22 `node:crypto`, vitest.

---

## File Structure

**Create:**
- `packages/core/src/connector.ts` — zod schemas: `ConnectorConfig`, `ConnectorParams`, `ExchangeStep`, `ExchangeRequest`. One responsibility: the declarative connector-config data model.
- `packages/connectors/package.json`, `packages/connectors/tsconfig.json` — package scaffold.
- `packages/connectors/src/index.ts` — public exports.
- `packages/connectors/src/types.ts` — engine I/O types (`SealedSecret`, `LoginRequest`, `ExchangeInput`, `ResolvedEndpoints`).
- `packages/connectors/src/discovery.ts` — OIDC `.well-known` endpoint resolution (injected fetch, cached).
- `packages/connectors/src/transforms.ts` — value-bag resolution + the `sha256`/`concat` transform vocabulary (pure).
- `packages/connectors/src/engine.ts` — `buildLoginUrl` + `exchange` orchestration.
- `packages/connectors/test/discovery.test.ts`, `transforms.test.ts`, `engine.test.ts`.
- `docs/decisions/ADR-0012-connector-engine.md`.

**Modify:**
- `packages/core/src/manifest.ts` — add optional `connectorConfigs` map to `McpServerManifest`.
- `packages/core/src/index.ts` — re-export `./connector.js`.
- `package.json` (root) — add `@protocolfoundry/connectors` to the `build` script chain.
- `docs/03-architecture.md`, `docs/WORKLOG.md` — keep docs in sync (final task).

---

### Task 1: Connector-config schema in `core`

**Files:**
- Create: `packages/core/src/connector.ts`
- Modify: `packages/core/src/manifest.ts:111` (after `credentialGuides`), `packages/core/src/index.ts`
- Test: `packages/core/test/connector.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/connector.test.ts
import { describe, expect, it } from "vitest";
import { ConnectorConfig, McpServerManifest } from "../src/index.js";

describe("ConnectorConfig", () => {
  it("accepts a standard OIDC connector with discovery", () => {
    const cfg = ConnectorConfig.parse({
      id: "oauth2-generic",
      discovery: { issuer: "https://accounts.example.com" },
      appCredentials: [
        { id: "client_id", label: "Client ID", valueFormat: "the OAuth app client id" },
        { id: "client_secret", label: "Client secret", valueFormat: "the OAuth app secret" },
      ],
      params: { scopes: ["read"], pkce: true, callbackParam: "code" },
      produces: [{ vaultRowId: "EXAMPLE_TOKEN", from: "access_token" }],
    });
    expect(cfg.params.grantType).toBe("authorization_code"); // default applied
    expect(cfg.exchange).toBeUndefined(); // standard path
  });

  it("accepts a Kite-style non-standard connector with derive + custom exchange", () => {
    const cfg = ConnectorConfig.parse({
      id: "zerodha-kite",
      authorizeUrl: "https://kite.zerodha.com/connect/login",
      tokenUrl: "https://api.kite.trade/session/token",
      appCredentials: [
        { id: "api_key", label: "API key", valueFormat: "Kite Connect api_key" },
        { id: "api_secret", label: "API secret", valueFormat: "Kite Connect api_secret" },
      ],
      params: { callbackParam: "request_token" },
      derive: [
        { op: "concat", inputs: ["api_key", "request_token", "api_secret"], as: "checksum_input" },
        { op: "sha256", input: "checksum_input", as: "checksum" },
      ],
      exchange: {
        method: "POST",
        body: { api_key: "api_key", request_token: "request_token", checksum: "checksum" },
      },
      produces: [{ vaultRowId: "KITE_ACCESS_TOKEN", from: "access_token" }],
      rotation: "Access token expires daily ~6am IST; reconnect to refresh.",
    });
    expect(cfg.derive).toHaveLength(2);
    expect(cfg.exchange?.urlRef).toBe("token"); // default applied
  });

  it("rejects a connector with neither discovery nor an explicit authorizeUrl", () => {
    expect(() =>
      ConnectorConfig.parse({
        id: "broken",
        appCredentials: [],
        produces: [{ vaultRowId: "X", from: "access_token" }],
      }),
    ).toThrow(/discovery.*or.*authorizeUrl/i);
  });

  it("old manifests with no connectorConfigs parse to an empty map", () => {
    const m = McpServerManifest.parse({
      manifestVersion: 1,
      projectId: "p",
      serverName: "s",
      serverDescription: "d",
      baseUrls: { default: "https://api.example.com" },
      upstreamOperations: {},
      tools: [
        {
          name: "ping",
          description: "ping",
          inputSchema: {},
          plan: [{ operationId: "op1" }],
        },
      ],
      credentialBindings: [],
      workflowGraphRef: "g-1",
      createdAt: "2026-06-13T00:00:00.000Z",
    });
    expect(m.connectorConfigs).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w @protocolfoundry/core && npx vitest run packages/core/test/connector.test.ts`
Expected: FAIL — `ConnectorConfig` is not exported / `connectorConfigs` undefined.

- [ ] **Step 3: Create the schema**

```ts
// packages/core/src/connector.ts
import { z } from "zod";

/**
 * Declarative connector config (ADR-0012): data, never code. Carried in the
 * manifest keyed by authRequirementId, interpreted by @protocolfoundry/connectors.
 * Holds references and instructions only — secrets live in the vault.
 */

/** App-level credential the operator registers once (client id/secret, api_key/secret). */
export const ConnectorAppCredential = z.object({
  id: z.string(),
  label: z.string(),
  valueFormat: z.string(),
});
export type ConnectorAppCredential = z.infer<typeof ConnectorAppCredential>;

export const ConnectorParams = z.object({
  scopes: z.array(z.string()).default([]),
  pkce: z.boolean().default(false),
  /** The param the provider redirects back with, e.g. "code" or "request_token". */
  callbackParam: z.string().default("code"),
  responseType: z.string().default("code"),
  grantType: z.string().default("authorization_code"),
});
export type ConnectorParams = z.infer<typeof ConnectorParams>;

/** Fixed, safe transform vocabulary for the non-standard residue — NOT arbitrary code. */
export const ExchangeStep = z.discriminatedUnion("op", [
  z.object({ op: z.literal("concat"), inputs: z.array(z.string()).min(1), as: z.string() }),
  z.object({ op: z.literal("sha256"), input: z.string(), as: z.string() }),
]);
export type ExchangeStep = z.infer<typeof ExchangeStep>;

/** A custom token-exchange request (only needed for non-standard providers). */
export const ExchangeRequest = z.object({
  method: z.enum(["GET", "POST"]).default("POST"),
  /** Which resolved endpoint to call. Only the token endpoint for now. */
  urlRef: z.literal("token").default("token"),
  /** Form-body fields: field name -> value-bag key. */
  body: z.record(z.string()).default({}),
  /** Header name -> value-bag key. */
  headers: z.record(z.string()).default({}),
});
export type ExchangeRequest = z.infer<typeof ExchangeRequest>;

export const ConnectorConfig = z
  .object({
    id: z.string(),
    discovery: z.object({ issuer: z.string().url() }).optional(),
    authorizeUrl: z.string().url().optional(),
    tokenUrl: z.string().url().optional(),
    appCredentials: z.array(ConnectorAppCredential).default([]),
    params: ConnectorParams.default({}),
    /** Derived values computed before exchange (non-standard residue). */
    derive: z.array(ExchangeStep).default([]),
    /** Custom exchange request; omitted = standard authorization-code token POST. */
    exchange: ExchangeRequest.optional(),
    /** Produced secrets: which vault row gets which value-bag key. */
    produces: z
      .array(z.object({ vaultRowId: z.string(), from: z.string() }))
      .min(1),
    /** Expiry/rotation note surfaced to operators, e.g. "expires daily". */
    rotation: z.string().optional(),
  })
  .refine((c) => Boolean(c.discovery) || Boolean(c.authorizeUrl), {
    message: "connector needs discovery.issuer or an explicit authorizeUrl",
  });
export type ConnectorConfig = z.infer<typeof ConnectorConfig>;
```

- [ ] **Step 4: Wire into the manifest and exports**

In `packages/core/src/manifest.ts`, add the import at the top (next to the existing workflow-graph import):

```ts
import { ConnectorConfig } from "./connector.js";
```

In the `McpServerManifest` object, immediately after the `credentialGuides` line (`:111`), add:

```ts
  /** Sanctioned-connect configs keyed by authRequirementId (data, never secrets). */
  connectorConfigs: z.record(ConnectorConfig).default({}),
```

In `packages/core/src/index.ts`, add after the `./manifest.js` line:

```ts
export * from "./connector.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run build -w @protocolfoundry/core && npx vitest run packages/core/test/connector.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/connector.ts packages/core/src/manifest.ts packages/core/src/index.ts packages/core/test/connector.test.ts
git commit -m "feat(core): declarative connector-config schema (ADR-0012)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Scaffold `@protocolfoundry/connectors`

**Files:**
- Create: `packages/connectors/package.json`, `packages/connectors/tsconfig.json`, `packages/connectors/src/index.ts`, `packages/connectors/src/types.ts`
- Modify: `package.json` (root build script)
- Test: `packages/connectors/test/scaffold.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/connectors/test/scaffold.test.ts
import { describe, expect, it } from "vitest";
import { SEALED_SECRET_MARKER } from "../src/index.js";

describe("connectors package", () => {
  it("is importable and exports its marker", () => {
    expect(SEALED_SECRET_MARKER).toBe("sealed-secret");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/connectors/test/scaffold.test.ts`
Expected: FAIL — cannot resolve `../src/index.js` (package does not exist yet).

- [ ] **Step 3: Create the package scaffold**

```json
// packages/connectors/package.json
{
  "name": "@protocolfoundry/connectors",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@protocolfoundry/core": "*",
    "zod": "^3.24.0"
  }
}
```

```json
// packages/connectors/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"]
}
```

```ts
// packages/connectors/src/types.ts
import type { ConnectorConfig } from "@protocolfoundry/core";

/** A secret to seal into an existing vault row — the engine's only output. */
export interface SealedSecret {
  vaultRowId: string;
  secret: string;
}

/** The provider login URL plus the CSRF/PKCE state the caller must round-trip. */
export interface LoginRequest {
  url: string;
  state: string;
  /** Present when params.pkce is true; the caller round-trips it to exchange(). */
  codeVerifier?: string;
}

/** Resolved authorize/token endpoints (from discovery or explicit config). */
export interface ResolvedEndpoints {
  authorizeUrl: string;
  tokenUrl: string;
  pkceSupported: boolean;
}

/** Everything exchange() needs; all I/O is injected for testability. */
export interface ExchangeInput {
  config: ConnectorConfig;
  /** App-level creds resolved by the caller from the vault, keyed by appCredential id. */
  appCreds: Record<string, string>;
  redirectUri: string;
  /** Params the provider redirected to our callback (incl. the captured token + state). */
  callbackParams: Record<string, string>;
  /** The state issued by buildLoginUrl; mismatch is rejected. */
  expectedState: string;
  codeVerifier?: string;
  fetch: typeof fetch;
}
```

```ts
// packages/connectors/src/index.ts
export const SEALED_SECRET_MARKER = "sealed-secret" as const;
export * from "./types.js";
```

In the root `package.json` `build` script, insert connectors right after core's build (it depends only on core):

```
"build": "npm run build -w @protocolfoundry/core && npm run build -w @protocolfoundry/connectors && npm run build -w @protocolfoundry/discovery && npm run build -w @protocolfoundry/generator && npm run build -w @protocolfoundry/curation && npm run build -w @protocolfoundry/evals && npm run build -w @protocolfoundry/releases && npm run build -w @protocolfoundry/audit && npm run build -w @protocolfoundry/vault && npm run build -w @protocolfoundry/gateway && npm run build -w @protocolfoundry/cli",
```

- [ ] **Step 4: Install the workspace + run test to verify it passes**

Run: `npm install && npm run build -w @protocolfoundry/core && npm run build -w @protocolfoundry/connectors && npx vitest run packages/connectors/test/scaffold.test.ts`
Expected: PASS (1 test). (`npm install` links the new workspace so `@protocolfoundry/core` resolves.)

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/package.json packages/connectors/tsconfig.json packages/connectors/src/index.ts packages/connectors/src/types.ts packages/connectors/test/scaffold.test.ts package.json package-lock.json
git commit -m "feat(connectors): scaffold @protocolfoundry/connectors package

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: OIDC discovery + endpoint resolution

**Files:**
- Create: `packages/connectors/src/discovery.ts`
- Modify: `packages/connectors/src/index.ts`
- Test: `packages/connectors/test/discovery.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/connectors/test/discovery.test.ts
import { describe, expect, it, vi } from "vitest";
import { ConnectorConfig } from "@protocolfoundry/core";
import { resolveEndpoints } from "../src/discovery.js";

function fakeFetch(body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
  ) as unknown as typeof fetch;
}

const PRODUCES = [{ vaultRowId: "T", from: "access_token" }];

describe("resolveEndpoints", () => {
  it("reads endpoints from the OIDC well-known document", async () => {
    const cfg = ConnectorConfig.parse({
      id: "oauth2-generic",
      discovery: { issuer: "https://accounts.example.com" },
      produces: PRODUCES,
    });
    const f = fakeFetch({
      authorization_endpoint: "https://accounts.example.com/authorize",
      token_endpoint: "https://accounts.example.com/token",
      code_challenge_methods_supported: ["S256"],
    });
    const ep = await resolveEndpoints(cfg, f);
    expect(f).toHaveBeenCalledWith(
      "https://accounts.example.com/.well-known/openid-configuration",
      expect.anything(),
    );
    expect(ep).toEqual({
      authorizeUrl: "https://accounts.example.com/authorize",
      tokenUrl: "https://accounts.example.com/token",
      pkceSupported: true,
    });
  });

  it("uses explicit endpoints without any fetch when discovery is absent", async () => {
    const cfg = ConnectorConfig.parse({
      id: "zerodha-kite",
      authorizeUrl: "https://kite.zerodha.com/connect/login",
      tokenUrl: "https://api.kite.trade/session/token",
      produces: PRODUCES,
    });
    const f = vi.fn() as unknown as typeof fetch;
    const ep = await resolveEndpoints(cfg, f);
    expect(f).not.toHaveBeenCalled();
    expect(ep.authorizeUrl).toBe("https://kite.zerodha.com/connect/login");
    expect(ep.tokenUrl).toBe("https://api.kite.trade/session/token");
    expect(ep.pkceSupported).toBe(false);
  });

  it("throws a clear error if the well-known doc lacks endpoints", async () => {
    const cfg = ConnectorConfig.parse({
      id: "oauth2-generic",
      discovery: { issuer: "https://broken.example.com" },
      produces: PRODUCES,
    });
    await expect(resolveEndpoints(cfg, fakeFetch({}))).rejects.toThrow(/authorization_endpoint/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/connectors/test/discovery.test.ts`
Expected: FAIL — cannot resolve `../src/discovery.js`.

- [ ] **Step 3: Implement discovery**

```ts
// packages/connectors/src/discovery.ts
import type { ConnectorConfig } from "@protocolfoundry/core";
import type { ResolvedEndpoints } from "./types.js";

const cache = new Map<string, ResolvedEndpoints>();

interface OidcDoc {
  authorization_endpoint?: string;
  token_endpoint?: string;
  code_challenge_methods_supported?: string[];
}

/** Resolve authorize/token endpoints via OIDC discovery, or explicit config. */
export async function resolveEndpoints(
  config: ConnectorConfig,
  fetchImpl: typeof fetch,
): Promise<ResolvedEndpoints> {
  if (config.discovery) {
    const issuer = config.discovery.issuer.replace(/\/$/, "");
    const cached = cache.get(issuer);
    if (cached) return cached;

    const url = `${issuer}/.well-known/openid-configuration`;
    const res = await fetchImpl(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      throw new Error(`OIDC discovery failed for ${issuer}: HTTP ${res.status}`);
    }
    const doc = (await res.json()) as OidcDoc;
    if (!doc.authorization_endpoint || !doc.token_endpoint) {
      throw new Error(
        `OIDC document for ${issuer} is missing authorization_endpoint/token_endpoint`,
      );
    }
    const resolved: ResolvedEndpoints = {
      authorizeUrl: doc.authorization_endpoint,
      tokenUrl: doc.token_endpoint,
      pkceSupported: (doc.code_challenge_methods_supported ?? []).includes("S256"),
    };
    cache.set(issuer, resolved);
    return resolved;
  }

  if (!config.authorizeUrl || !config.tokenUrl) {
    throw new Error(
      `Connector "${config.id}" has no discovery issuer and is missing authorizeUrl/tokenUrl`,
    );
  }
  return { authorizeUrl: config.authorizeUrl, tokenUrl: config.tokenUrl, pkceSupported: false };
}

/** Test seam: clear the discovery cache. */
export function clearDiscoveryCache(): void {
  cache.clear();
}
```

Add to `packages/connectors/src/index.ts`:

```ts
export * from "./discovery.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build -w @protocolfoundry/connectors && npx vitest run packages/connectors/test/discovery.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/src/discovery.ts packages/connectors/src/index.ts packages/connectors/test/discovery.test.ts
git commit -m "feat(connectors): OIDC discovery + endpoint resolution

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Value bag + transform vocabulary (`sha256` / `concat`)

**Files:**
- Create: `packages/connectors/src/transforms.ts`
- Modify: `packages/connectors/src/index.ts`
- Test: `packages/connectors/test/transforms.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/connectors/test/transforms.test.ts
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ExchangeStep } from "@protocolfoundry/core";
import { applyDerive } from "../src/transforms.js";

describe("applyDerive", () => {
  it("computes Kite's checksum = sha256(api_key + request_token + api_secret)", () => {
    const bag: Record<string, string> = {
      api_key: "abc123",
      request_token: "rt-999",
      api_secret: "shh-secret",
    };
    const steps: ExchangeStep[] = [
      { op: "concat", inputs: ["api_key", "request_token", "api_secret"], as: "checksum_input" },
      { op: "sha256", input: "checksum_input", as: "checksum" },
    ];
    const out = applyDerive(bag, steps);
    const expected = createHash("sha256").update("abc123rt-999shh-secret").digest("hex");
    expect(out.checksum_input).toBe("abc123rt-999shh-secret");
    expect(out.checksum).toBe(expected);
  });

  it("throws when a referenced value is missing from the bag", () => {
    expect(() =>
      applyDerive({ api_key: "x" }, [
        { op: "concat", inputs: ["api_key", "request_token"], as: "out" },
      ]),
    ).toThrow(/request_token/);
  });

  it("returns the bag unchanged when there are no steps", () => {
    const bag = { a: "1" };
    expect(applyDerive(bag, [])).toEqual({ a: "1" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/connectors/test/transforms.test.ts`
Expected: FAIL — cannot resolve `../src/transforms.js`.

- [ ] **Step 3: Implement the transforms**

```ts
// packages/connectors/src/transforms.ts
import { createHash } from "node:crypto";
import type { ExchangeStep } from "@protocolfoundry/core";

/** Look up a value-bag key, failing loudly if it is absent. */
export function resolveValue(bag: Record<string, string>, key: string): string {
  const v = bag[key];
  if (v === undefined) {
    throw new Error(`connector value "${key}" is not available`);
  }
  return v;
}

/**
 * Apply the fixed, safe transform vocabulary, returning a new bag with the
 * derived keys added. The only operations are concat and sha256 — never code.
 */
export function applyDerive(
  bag: Record<string, string>,
  steps: ExchangeStep[],
): Record<string, string> {
  const out: Record<string, string> = { ...bag };
  for (const step of steps) {
    if (step.op === "concat") {
      out[step.as] = step.inputs.map((k) => resolveValue(out, k)).join("");
    } else {
      out[step.as] = createHash("sha256").update(resolveValue(out, step.input)).digest("hex");
    }
  }
  return out;
}
```

Add to `packages/connectors/src/index.ts`:

```ts
export * from "./transforms.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build -w @protocolfoundry/connectors && npx vitest run packages/connectors/test/transforms.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/src/transforms.ts packages/connectors/src/index.ts packages/connectors/test/transforms.test.ts
git commit -m "feat(connectors): safe value-bag transform vocabulary (sha256/concat)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: `buildLoginUrl` (authorize URL + state + PKCE)

**Files:**
- Create: `packages/connectors/src/engine.ts`
- Modify: `packages/connectors/src/index.ts`
- Test: `packages/connectors/test/engine.test.ts` (login section)

- [ ] **Step 1: Write the failing test**

```ts
// packages/connectors/test/engine.test.ts
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ConnectorConfig } from "@protocolfoundry/core";
import { buildLoginUrl } from "../src/engine.js";
import { clearDiscoveryCache } from "../src/discovery.js";

function fakeFetch(body: unknown): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
  ) as unknown as typeof fetch;
}

describe("buildLoginUrl", () => {
  it("builds a standard OIDC authorize URL with state, scopes and PKCE", async () => {
    clearDiscoveryCache();
    const cfg = ConnectorConfig.parse({
      id: "oauth2-generic",
      discovery: { issuer: "https://accounts.example.com" },
      appCredentials: [{ id: "client_id", label: "Client ID", valueFormat: "id" }],
      params: { scopes: ["read", "write"], pkce: true, callbackParam: "code" },
      produces: [{ vaultRowId: "T", from: "access_token" }],
    });
    const login = await buildLoginUrl(
      cfg,
      { client_id: "my-client" },
      "https://app.pf.dev/connect/callback",
      fakeFetch({
        authorization_endpoint: "https://accounts.example.com/authorize",
        token_endpoint: "https://accounts.example.com/token",
        code_challenge_methods_supported: ["S256"],
      }),
    );
    const u = new URL(login.url);
    expect(u.origin + u.pathname).toBe("https://accounts.example.com/authorize");
    expect(u.searchParams.get("client_id")).toBe("my-client");
    expect(u.searchParams.get("redirect_uri")).toBe("https://app.pf.dev/connect/callback");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("read write");
    expect(u.searchParams.get("state")).toBe(login.state);
    expect(login.state.length).toBeGreaterThan(16);
    // PKCE: verifier returned, challenge is its S256 hash
    expect(login.codeVerifier).toBeTruthy();
    const challenge = createHash("sha256").update(login.codeVerifier!).digest("base64url");
    expect(u.searchParams.get("code_challenge")).toBe(challenge);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
  });

  it("builds a Kite login URL (explicit endpoint, api_key, no PKCE)", async () => {
    const cfg = ConnectorConfig.parse({
      id: "zerodha-kite",
      authorizeUrl: "https://kite.zerodha.com/connect/login",
      tokenUrl: "https://api.kite.trade/session/token",
      appCredentials: [{ id: "api_key", label: "API key", valueFormat: "k" }],
      params: { callbackParam: "request_token" },
      produces: [{ vaultRowId: "KITE", from: "access_token" }],
    });
    const f = vi.fn() as unknown as typeof fetch;
    const login = await buildLoginUrl(cfg, { api_key: "kapikey" }, "http://127.0.0.1:9876/callback", f);
    const u = new URL(login.url);
    expect(u.origin + u.pathname).toBe("https://kite.zerodha.com/connect/login");
    // Kite uses api_key as its client id param and ignores PKCE.
    expect(u.searchParams.get("api_key") ?? u.searchParams.get("client_id")).toBe("kapikey");
    expect(login.codeVerifier).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run packages/connectors/test/engine.test.ts`
Expected: FAIL — cannot resolve `../src/engine.js`.

- [ ] **Step 3: Implement `buildLoginUrl`**

```ts
// packages/connectors/src/engine.ts
import { createHash, randomBytes } from "node:crypto";
import type { ConnectorConfig } from "@protocolfoundry/core";
import { resolveEndpoints } from "./discovery.js";
import type { LoginRequest } from "./types.js";

function base64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/** The client-id param: Kite calls it api_key, standard OAuth calls it client_id. */
function clientIdParam(config: ConnectorConfig, appCreds: Record<string, string>): [string, string] {
  if (appCreds.api_key !== undefined) return ["api_key", appCreds.api_key];
  if (appCreds.client_id !== undefined) return ["client_id", appCreds.client_id];
  throw new Error(`Connector "${config.id}" needs an api_key or client_id app credential`);
}

/** Build the provider login URL plus the state/PKCE verifier the caller round-trips. */
export async function buildLoginUrl(
  config: ConnectorConfig,
  appCreds: Record<string, string>,
  redirectUri: string,
  fetchImpl: typeof fetch,
): Promise<LoginRequest> {
  const endpoints = await resolveEndpoints(config, fetchImpl);
  const url = new URL(endpoints.authorizeUrl);
  const state = base64url(randomBytes(24));

  const [cidKey, cidVal] = clientIdParam(config, appCreds);
  url.searchParams.set(cidKey, cidVal);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", config.params.responseType);
  url.searchParams.set("state", state);
  if (config.params.scopes.length > 0) {
    url.searchParams.set("scope", config.params.scopes.join(" "));
  }

  let codeVerifier: string | undefined;
  if (config.params.pkce && endpoints.pkceSupported) {
    codeVerifier = base64url(randomBytes(32));
    const challenge = createHash("sha256").update(codeVerifier).digest("base64url");
    url.searchParams.set("code_challenge", challenge);
    url.searchParams.set("code_challenge_method", "S256");
  }

  return { url: url.toString(), state, codeVerifier };
}
```

Add to `packages/connectors/src/index.ts`:

```ts
export * from "./engine.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build -w @protocolfoundry/connectors && npx vitest run packages/connectors/test/engine.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/connectors/src/engine.ts packages/connectors/src/index.ts packages/connectors/test/engine.test.ts
git commit -m "feat(connectors): buildLoginUrl with state + PKCE

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `exchange` (standard token POST + custom exchange → SealedSecret[])

**Files:**
- Modify: `packages/connectors/src/engine.ts`
- Test: `packages/connectors/test/engine.test.ts` (add an exchange section)

- [ ] **Step 1: Write the failing test (append to engine.test.ts)**

```ts
// append to packages/connectors/test/engine.test.ts
import { exchange } from "../src/engine.js";

function fakeTokenFetch(captured: { body?: string; url?: string }, json: unknown): typeof fetch {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    captured.url = String(url);
    captured.body = init?.body as string;
    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("exchange", () => {
  it("rejects a callback whose state does not match", async () => {
    const cfg = ConnectorConfig.parse({
      id: "oauth2-generic",
      authorizeUrl: "https://a.example.com/authorize",
      tokenUrl: "https://a.example.com/token",
      produces: [{ vaultRowId: "T", from: "access_token" }],
    });
    await expect(
      exchange({
        config: cfg,
        appCreds: { client_id: "c", client_secret: "s" },
        redirectUri: "https://app/cb",
        callbackParams: { code: "abc", state: "WRONG" },
        expectedState: "RIGHT",
        fetch: fakeTokenFetch({}, {}),
      }),
    ).rejects.toThrow(/state/i);
  });

  it("runs the standard authorization-code token POST and seals access_token", async () => {
    const cfg = ConnectorConfig.parse({
      id: "oauth2-generic",
      authorizeUrl: "https://a.example.com/authorize",
      tokenUrl: "https://a.example.com/token",
      params: { pkce: true, callbackParam: "code" },
      produces: [{ vaultRowId: "EXAMPLE_TOKEN", from: "access_token" }],
    });
    const captured: { body?: string; url?: string } = {};
    const sealed = await exchange({
      config: cfg,
      appCreds: { client_id: "cid", client_secret: "csecret" },
      redirectUri: "https://app/cb",
      callbackParams: { code: "auth-code-1", state: "S" },
      expectedState: "S",
      codeVerifier: "verifier-1",
      fetch: fakeTokenFetch(captured, { access_token: "at-xyz", token_type: "bearer" }),
    });
    expect(captured.url).toBe("https://a.example.com/token");
    const form = new URLSearchParams(captured.body);
    expect(form.get("grant_type")).toBe("authorization_code");
    expect(form.get("code")).toBe("auth-code-1");
    expect(form.get("redirect_uri")).toBe("https://app/cb");
    expect(form.get("client_id")).toBe("cid");
    expect(form.get("client_secret")).toBe("csecret");
    expect(form.get("code_verifier")).toBe("verifier-1");
    expect(sealed).toEqual([{ vaultRowId: "EXAMPLE_TOKEN", secret: "at-xyz" }]);
  });

  it("runs Kite's derive+custom-exchange and seals the access_token", async () => {
    const cfg = ConnectorConfig.parse({
      id: "zerodha-kite",
      authorizeUrl: "https://kite.zerodha.com/connect/login",
      tokenUrl: "https://api.kite.trade/session/token",
      params: { callbackParam: "request_token" },
      derive: [
        { op: "concat", inputs: ["api_key", "request_token", "api_secret"], as: "checksum_input" },
        { op: "sha256", input: "checksum_input", as: "checksum" },
      ],
      exchange: {
        method: "POST",
        body: { api_key: "api_key", request_token: "request_token", checksum: "checksum" },
      },
      produces: [{ vaultRowId: "KITE_ACCESS_TOKEN", from: "access_token" }],
    });
    const captured: { body?: string; url?: string } = {};
    const sealed = await exchange({
      config: cfg,
      appCreds: { api_key: "abc123", api_secret: "shh-secret" },
      redirectUri: "http://127.0.0.1:9876/cb",
      callbackParams: { request_token: "rt-999", state: "S" },
      expectedState: "S",
      fetch: fakeTokenFetch(captured, { data: { access_token: "kite-at" }, status: "success" }),
    });
    expect(captured.url).toBe("https://api.kite.trade/session/token");
    const form = new URLSearchParams(captured.body);
    expect(form.get("api_key")).toBe("abc123");
    expect(form.get("request_token")).toBe("rt-999");
    // checksum present and correctly derived (independent recomputation)
    const { createHash } = await import("node:crypto");
    expect(form.get("checksum")).toBe(
      createHash("sha256").update("abc123rt-999shh-secret").digest("hex"),
    );
    // Kite nests the token under data.access_token — produces.from uses dot paths.
    expect(sealed).toEqual([{ vaultRowId: "KITE_ACCESS_TOKEN", secret: "kite-at" }]);
  });
});
```

Note: the Kite `produces.from` is `access_token`, but Kite nests it under `data`. The implementation flattens the response one level: top-level fields plus, if present, the fields of a `data` object, into the value bag. Keep `produces.from: "access_token"` working for both shapes.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run build -w @protocolfoundry/connectors && npx vitest run packages/connectors/test/engine.test.ts`
Expected: FAIL — `exchange` is not exported.

- [ ] **Step 3: Implement `exchange` (append to engine.ts)**

```ts
// append to packages/connectors/src/engine.ts
import { applyDerive, resolveValue } from "./transforms.js";
import type { ExchangeInput, SealedSecret } from "./types.js";

/** Merge response JSON into the value bag: top-level fields + one level of `data`. */
function mergeResponse(bag: Record<string, string>, json: unknown): Record<string, string> {
  const out = { ...bag };
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    const nested = obj.data && typeof obj.data === "object" ? (obj.data as Record<string, unknown>) : {};
    for (const [k, v] of Object.entries({ ...obj, ...nested })) {
      if (typeof v === "string") out[k] = v;
    }
  }
  return out;
}

/** Capture the sanctioned redirect, run the token exchange, return secrets to seal. */
export async function exchange(input: ExchangeInput): Promise<SealedSecret[]> {
  const { config, appCreds, redirectUri, callbackParams, expectedState, codeVerifier, fetch: fetchImpl } = input;

  if (callbackParams.state !== expectedState) {
    throw new Error("OAuth state mismatch — refusing to exchange (possible CSRF)");
  }
  const token = callbackParams[config.params.callbackParam];
  if (!token) {
    throw new Error(`Callback is missing the "${config.params.callbackParam}" parameter`);
  }

  const endpoints = await resolveEndpoints(config, fetchImpl);

  // Seed the value bag with app creds + the captured token, then derive.
  const seed: Record<string, string> = { ...appCreds, [config.params.callbackParam]: token };
  const derived = applyDerive(seed, config.derive);

  // Build the request body: custom exchange (mapped from the bag) or the standard flow.
  const body = new URLSearchParams();
  if (config.exchange) {
    for (const [field, ref] of Object.entries(config.exchange.body)) {
      body.set(field, resolveValue(derived, ref));
    }
  } else {
    body.set("grant_type", config.params.grantType);
    body.set("code", token);
    body.set("redirect_uri", redirectUri);
    if (appCreds.client_id) body.set("client_id", appCreds.client_id);
    if (appCreds.client_secret) body.set("client_secret", appCreds.client_secret);
    if (codeVerifier) body.set("code_verifier", codeVerifier);
  }

  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (config.exchange) {
    for (const [h, ref] of Object.entries(config.exchange.headers)) {
      headers[h] = resolveValue(derived, ref);
    }
  }

  const res = await fetchImpl(endpoints.tokenUrl, {
    method: config.exchange?.method ?? "POST",
    headers,
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed for connector "${config.id}": HTTP ${res.status}`);
  }
  const json = await res.json();
  const finalBag = mergeResponse(derived, json);

  return config.produces.map((p) => ({
    vaultRowId: p.vaultRowId,
    secret: resolveValue(finalBag, p.from),
  }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run build -w @protocolfoundry/connectors && npx vitest run packages/connectors/test/engine.test.ts`
Expected: PASS (4 tests total in the file).

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm run typecheck && npm test`
Expected: PASS — all workspaces typecheck; full vitest run green.

- [ ] **Step 6: Commit**

```bash
git add packages/connectors/src/engine.ts packages/connectors/test/engine.test.ts
git commit -m "feat(connectors): token exchange (standard + custom) -> SealedSecret[]

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: ADR-0012 + doc sync

**Files:**
- Create: `docs/decisions/ADR-0012-connector-engine.md`
- Modify: `docs/03-architecture.md` (add `packages/connectors` to the package list), `docs/WORKLOG.md` (newest entry first)

- [ ] **Step 1: Write ADR-0012**

```markdown
# ADR-0012: Sanctioned-OAuth connector engine (data-driven, no codegen)

Status: Accepted (2026-06-13)

## Context

ADR-0011 made operators paste upstream credentials by hand. The biggest
friction is providers whose token acquisition is a multi-step dance (Kite
Connect: request_token -> SHA256 checksum -> access_token, rotating daily).
We want "sign in on the provider's own page, we capture the token" for as
many providers as possible without per-provider code.

## Decision

1. A single shared, data-driven **connector engine**
   (`@protocolfoundry/connectors`) runs the OAuth2/OIDC authorization-code
   flow. Standards-compliant providers need no tailoring — endpoints come
   from OIDC `.well-known/openid-configuration` discovery. The residue
   (non-standard handshakes) is expressed by a **declarative ConnectorConfig**
   (`packages/core`) with a fixed, safe transform vocabulary (`sha256`,
   `concat`) — enough for Kite's checksum, never arbitrary code.
2. We **capture only sanctioned redirect handoffs** — the params a provider
   deliberately redirects to our registered callback. No crawler/traffic
   interception (ADR-0002, security model principle 1).
3. We **evaluated and rejected** LLM-generated executable plugins: they would
   break ADR-0003 (per-customer codegen) and add an RCE surface. ConnectorConfig
   is data interpreted by the shared engine, so ADR-0003 holds.
4. The engine's only output is `SealedSecret[]` sealed into the **same vault
   rows the gateway already resolves** (ADR-0007) — gateway resolution is
   unchanged. Secrets never enter the config, prompts, or logs.

## Consequences

- A large slice of modern APIs connect with zero per-provider code; non-standard
  ones need a small, human-reviewed config blob (nothing ships without approval).
- "Sanctioned-only" means each provider still requires its own app registration
  (client id/secret or api_key/secret) — irreducible if we stay in-bounds.
- SP1 ships the engine + schema only. Connect/rotation surfaces (dashboard popup,
  `pf connect`, gateway expired-credential deep-link), LLM config derivation, the
  global model switch, and unsupported-API intake follow in SP2–SP4.
```

- [ ] **Step 2: Sync architecture + worklog docs**

In `docs/03-architecture.md`, add a bullet to the package list:

```markdown
- `packages/connectors` — shared, data-driven connector engine: OAuth2/OIDC
  authorization-code flow with OIDC discovery and a safe transform vocabulary
  (`sha256`/`concat`) for non-standard providers; emits `SealedSecret[]` into
  existing vault rows (ADR-0012).
```

In `docs/WORKLOG.md`, add a new entry at the top:

```markdown
## 2026-06-13 — SP1: connector engine core

- Added `@protocolfoundry/connectors` (engine, OIDC discovery, safe transform
  vocabulary) + declarative `ConnectorConfig` in core (ADR-0012).
- Captures only sanctioned redirect handoffs; standard OAuth2/OIDC needs no
  per-provider code, Kite expressed via declarative derive+exchange config.
- Output is `SealedSecret[]` for callers to seal — gateway resolution unchanged.
- Next: SP2 (LLM config derivation + global model switch), SP3 (connect/rotation
  surfaces), SP4 (unsupported-API intake).
```

- [ ] **Step 3: Commit**

```bash
git add docs/decisions/ADR-0012-connector-engine.md docs/03-architecture.md docs/WORKLOG.md
git commit -m "docs: ADR-0012 connector engine + architecture/worklog sync

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage (SP1 only):**
- Generic engine + OAuth2/OIDC authorization-code → Tasks 5, 6. ✓
- OIDC discovery → Task 3. ✓
- Declarative config (data, not code) → Task 1. ✓
- Safe exchange vocabulary (sha256/concat) sufficient for Kite → Tasks 4, 6. ✓
- Invariant: output is `SealedSecret[]` into existing vault rows; no gateway change → Task 6 (engine returns only `SealedSecret[]`; no vault/gateway code touched in SP1). ✓
- Back-compat (old manifests parse) → Task 1 Step 1 test. ✓
- Injected I/O, no API key in tests → all connector tests use fake `fetch`. ✓
- ADR-0012 recording the rejected alternatives → Task 7. ✓
- Out of scope (SP2–SP4 surfaces) → not included, by design. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; commands have expected output. ✓

**Type consistency:** `ConnectorConfig`/`ExchangeStep` (Task 1) are imported and used identically in Tasks 4–6. `SealedSecret`, `LoginRequest`, `ExchangeInput`, `ResolvedEndpoints` (Task 2 `types.ts`) are the exact shapes consumed by `discovery.ts` (Task 3), `engine.ts` (Tasks 5–6). `resolveValue`/`applyDerive` (Task 4) signatures match their use in `exchange` (Task 6). `resolveEndpoints` returns `ResolvedEndpoints` used by both `buildLoginUrl` and `exchange`. ✓
