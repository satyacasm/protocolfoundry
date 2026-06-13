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
