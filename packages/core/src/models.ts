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
