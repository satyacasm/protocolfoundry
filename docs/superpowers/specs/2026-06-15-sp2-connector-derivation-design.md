# SP2 — LLM Connector Derivation + Global Model Switch — Design Spec

- **Date:** 2026-06-15
- **Status:** Draft for review
- **Parent design:** `docs/superpowers/specs/2026-06-13-sanctioned-oauth-connector-design.md` (SP2 of 4)
- **Builds on:** SP1 (`@protocolfoundry/connectors`, `ConnectorConfig` in core, manifest `connectorConfigs`).
- **Related:** ADR-0004 (curation + CurationProposal review gate), ADR-0010 (docs-page LLM ingestion), ADR-0012 (connector engine). New ADR-0013 to be written alongside this work.

## Problem

Two gaps from the parent design:

1. **No single global model control.** Every LLM boundary is a `createAnthropic*(modelOrAlias?)` factory, but the *default* is pinned per call site and inconsistently — `createAnthropicDocsExtractor()` defaults to **opus** (`packages/discovery/src/docs.ts:398`), `createAnthropicCurator()` to **haiku**, the eval form passes its own, the CLI passes per-command `--model`. The web `forge-actions` calls the factories with no model at all. There is no global default any boundary honors.
2. **No automated connector config.** SP1's `ConnectorConfig` must be hand-authored. We want the platform to *derive* a best-effort config from an ingested API so an operator usually just reviews and approves it.

## Decisions (settled during brainstorming)

1. **Global model switch, default haiku**, controlled by one env var, honored by every boundary; per-call overrides still win. Dashboard shows the active model **read-only** (a writable picker is deferred to SP3).
2. **Connector derivation is a separate `ConnectorDeriver` LLM boundary** (own prompt + structured-output schema + scripted fake), invoked during the curation pass.
3. **Derivation folds into the existing `CurationProposal`** and is applied via `applyCuration`, **reusing the human-approve-before-apply gate** (ADR-0004) — no new approval surface in SP2.

## Part A — Global model switch

### `packages/core/src/models.ts`

Add a boundary type and a global resolver. Core's `models.ts` is the single home of model resolution; reading `PF_*` env there is acceptable (config concern) and keeps one source of truth.

```ts
export type ModelBoundary = "curation" | "discovery" | "eval" | "connector";

/**
 * Resolve the model for an LLM boundary. Precedence (first defined wins):
 *   1. explicit arg (e.g. CLI --model, eval form field)
 *   2. per-boundary env  PF_ANTHROPIC_MODEL_<BOUNDARY>  (e.g. ..._CURATION)
 *   3. global env        PF_ANTHROPIC_MODEL
 *   4. DEFAULT_CLAUDE_MODEL (haiku)
 * Aliases (haiku/sonnet/opus/fable) and full IDs both resolve via resolveClaudeModel.
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

### Factory updates (drop hardcoded defaults; honor the global)

- `packages/discovery/src/docs.ts` `createAnthropicDocsExtractor(modelOrAlias?)` →
  `const model = resolveGlobalModel(modelOrAlias, "discovery");` (removes the `: "claude-opus-4-8"` default; update the JSDoc that says "defaults to opus").
- `packages/curation/src/propose.ts` `createAnthropicCurator(modelOrAlias?)` →
  `resolveGlobalModel(modelOrAlias, "curation")`.
- `packages/evals/src/runner.ts` `createAnthropicAgent(modelOrAlias?)` →
  `resolveGlobalModel(modelOrAlias, "eval")`.
- New `createAnthropicConnectorDeriver(modelOrAlias?)` (Part B) →
  `resolveGlobalModel(modelOrAlias, "connector")`.

Per-call paths are unchanged in behavior: CLI `--model` and the eval form pass `explicit`, which still wins. The web `forge-actions` factories (called with no arg) now resolve to the global default instead of their old per-site default — fixing the current inconsistency.

### Dashboard read-only display

A small server-read indicator showing the active resolved model (via `resolveGlobalModel(undefined, <boundary>)` or just the global `PF_ANTHROPIC_MODEL` / default) surfaced on the forge/curate area. Read-only; no persistence. The writable picker is SP3.

## Part B — `ConnectorDeriver` folded into curation

### Ingestion fix (prerequisite signal)

The OpenAPI ingestor currently maps `oauth2`/`openIdConnect` to `kind:"oauth2"` but **drops** the flow URLs / issuer (`packages/discovery/src/openapi.ts:109-110`, `detail` stays `{}`). Extend `mapSecuritySchemes` so `detail` captures what the spec states, without inventing values:

- `type === "oauth2"`: from `scheme.flows` (authorizationCode preferred, else the first present flow) capture `authorizationUrl`, `tokenUrl`, and space-joined `scopes` when present.
- `type === "openIdConnect"`: capture `openIdConnectUrl` as `issuer`.

Docs-page ingestion already captures `kind` + `detail.name`/`detail.in` for the auth param (`docs.ts`); the deriver works from whatever `detail` carries. No change needed there in SP2.

### `packages/curation/src/derive-connectors.ts` (new)

```ts
export interface RawConnectorDerivation {
  connectors: { authRequirementId: string; config: unknown }[]; // config validated against core ConnectorConfig
  warnings?: { authRequirementId: string; reason: string }[];
}

/** Pluggable LLM boundary, mirroring Curator. Real impl: createAnthropicConnectorDeriver. */
export interface ConnectorDeriver {
  readonly model: string;
  derive(prompt: string): Promise<RawConnectorDerivation>;
}
```

- A prompt builder that summarizes, per auth requirement: `id`, `kind`, `detail` (incl. any issuer/authorize/token URLs/scopes), and the project's base URL(s) — and instructs Claude to emit a `ConnectorConfig` ONLY for OAuth-shaped auth (kind `oauth2`/`bearer` that is genuinely an OAuth flow), choosing discovery-by-issuer when an issuer/`.well-known` is known, explicit authorize/token URLs when the spec states them, and the `derive`+`exchange`+`produces`+`rotation` shape for non-standard handshakes (e.g. Kite checksum). Plain `apiKey`/`basic` → emit nothing (those keep the paste flow).
- `createAnthropicConnectorDeriver(modelOrAlias?)`: real impl using the Anthropic SDK with `output_config` structured outputs (same pattern as curator/extractor), `model = resolveGlobalModel(modelOrAlias, "connector")`.
- A pure `validateDerivedConnectors(raw): Record<string, ConnectorConfig>` that parses each `config` against core's `ConnectorConfig` zod, **dropping** invalid entries (never shipping a malformed config), keyed by `authRequirementId`. Invalid entries are surfaced as warnings, not thrown.

### Integration into the curation pass

- `packages/curation/src/propose.ts`: `proposeCuration(graph, operationIds, curator, deriver?)` gains an optional `deriver`. When present, it runs `deriver.derive(buildConnectorPrompt(graph))`, validates, and includes the result. (When absent — e.g. existing callers/tests — behavior is unchanged and `connectorConfigs` is `{}`.)
- `packages/core/src/curation.ts`: extend `CurationProposal` with
  `connectorConfigs: z.record(ConnectorConfig).default({})` (back-compat: old proposals parse to `{}`). Import `ConnectorConfig` from `./connector.js`.
- `packages/curation/src/apply.ts`: `applyCuration` writes `proposal.connectorConfigs` into the curated manifest's `connectorConfigs` (merging with any already present; proposal wins per `authRequirementId`).

### Surfacing the review (reused gate)

`CurationProposal` is already the approve-before-apply artifact. SP2 adds:
- **CLI** (`apps/cli/src/index.ts` `pf curate`): construct and pass the deriver; print the proposed `connectorConfigs` (id, flow type, produced vault rows, rotation) alongside refinements so the operator reviews them before `pf apply`. Document `PF_ANTHROPIC_MODEL` in the curate/ingest help text.
- **Web** (`apps/web/src/lib/forge-actions.ts`): pass a deriver into the curation action when `ANTHROPIC_API_KEY` is set (same guard as the extractor). The richer dashboard review/edit of derived configs is **SP3**; SP2 only ensures the proposal carries them and `applyCuration` applies them.

## Testing (scripted fakes, no API key)

- **Model switch:** `resolveGlobalModel` precedence (explicit > per-boundary env > global env > haiku); set/unset env in tests. Each factory falls back to the global when no arg (assert via the factory's `.model`).
- **Ingestion fix:** an OpenAPI fixture with an `oauth2` (authorizationCode flow) scheme and an `openIdConnect` scheme → `detail` carries authorize/token URLs / issuer; a scheme without flows → no invented fields.
- **ConnectorDeriver:** a scripted fake returning a Kite-shaped and a standard-OIDC `RawConnectorDerivation`; `validateDerivedConnectors` keeps valid, drops a deliberately malformed one (→ warning).
- **Curation integration:** `proposeCuration` with a fake curator + fake deriver yields a `CurationProposal` whose `connectorConfigs` validates; `applyCuration` writes them into `manifest.connectorConfigs`. `CurationProposal` back-compat (no field → `{}`).

## Decomposition / build order (tasks detailed in the plan)

1. Global model switch in core (`resolveGlobalModel`) + unit tests.
2. Wire factories (discovery/curation/evals) to the global; update the discovery opus default + JSDoc.
3. OpenAPI ingestion fix (preserve OAuth flow URLs / OIDC issuer in `detail`).
4. `ConnectorDeriver` interface + prompt + `validateDerivedConnectors` + `createAnthropicConnectorDeriver`.
5. `CurationProposal.connectorConfigs` (core) + `proposeCuration` deriver wiring + `applyCuration` apply.
6. CLI `pf curate` deriver wiring + proposal print + help text; web `forge-actions` deriver wiring + read-only model display.
7. ADR-0013 + doc sync (architecture, WORKLOG, local-quickstart env vars).

## Out of scope (SP2)

- Writable dashboard model picker / persistence (SP3).
- Rich dashboard review/edit UI for derived connector configs (SP3).
- The connect/rotation runtime surfaces — popup, `pf connect`, gateway expired-credential deep-link (SP3).
- Unsupported-API request intake (SP4).
- Any change to the connect-time engine behavior (SP1 is frozen).
- Deriving configs for non-OAuth auth (apiKey/basic) — intentionally left to the paste flow.
