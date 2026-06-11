import { describe, expect, it } from "vitest";
import { resolveClaudeModel, supportsAdaptiveThinking } from "../src/models.js";

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
