import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveClaudeModel, resolveGlobalModel, supportsAdaptiveThinking } from "../src/models.js";

describe("resolveClaudeModel", () => {
  it("maps aliases and passes full IDs through", () => {
    expect(resolveClaudeModel("haiku")).toBe("claude-haiku-4-5");
    expect(resolveClaudeModel("claude-opus-4-8")).toBe("claude-opus-4-8");
    expect(resolveClaudeModel()).toBe("claude-haiku-4-5");
  });
});

describe("supportsAdaptiveThinking", () => {
  it("is false for haiku models, true for sonnet/opus/fable", () => {
    expect(supportsAdaptiveThinking("claude-haiku-4-5")).toBe(false);
    expect(supportsAdaptiveThinking("claude-haiku-4-5-20251001")).toBe(false);
    expect(supportsAdaptiveThinking("claude-sonnet-4-6")).toBe(true);
    expect(supportsAdaptiveThinking("claude-opus-4-8")).toBe(true);
    expect(supportsAdaptiveThinking("claude-fable-5")).toBe(true);
  });
});

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
