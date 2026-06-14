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
