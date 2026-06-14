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
