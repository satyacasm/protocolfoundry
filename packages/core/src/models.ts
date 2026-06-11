/**
 * Claude models operators can pick for the LLM-backed steps (curation, evals).
 * Friendly aliases map to the exact API model IDs; full `claude-*` IDs are
 * passed through untouched so power users can pin any model.
 */
export const CLAUDE_MODELS = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-4-6",
  opus: "claude-opus-4-8",
  fable: "claude-fable-5",
} as const;

export type ClaudeModelAlias = keyof typeof CLAUDE_MODELS;

export const CLAUDE_MODEL_ALIASES = Object.keys(CLAUDE_MODELS) as ClaudeModelAlias[];

export const DEFAULT_CLAUDE_MODEL = CLAUDE_MODELS.haiku;

export function isClaudeModelAlias(value: string): value is ClaudeModelAlias {
  return value in CLAUDE_MODELS;
}

/** Resolve an alias ("haiku" | "sonnet" | "opus" | "fable") or pass a full model ID through. */
export function resolveClaudeModel(model?: string): string {
  if (!model) return DEFAULT_CLAUDE_MODEL;
  return isClaudeModelAlias(model) ? CLAUDE_MODELS[model] : model;
}

/**
 * Whether `thinking: {type: "adaptive"}` is accepted by a model. Haiku models
 * reject it with a 400 ("adaptive thinking is not supported on this model") —
 * requests for those must omit the thinking parameter entirely.
 */
export function supportsAdaptiveThinking(model: string): boolean {
  return !/haiku/i.test(model);
}
