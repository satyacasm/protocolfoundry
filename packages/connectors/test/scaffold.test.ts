import { describe, expect, it } from "vitest";
import { SEALED_SECRET_MARKER } from "../src/index.js";

describe("connectors package", () => {
  it("is importable and exports its marker", () => {
    expect(SEALED_SECRET_MARKER).toBe("sealed-secret");
  });
});
