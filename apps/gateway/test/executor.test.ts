import { describe, expect, it } from "vitest";
import { ingestOpenApi } from "@protocolfoundry/discovery";
import { generateManifest } from "@protocolfoundry/generator";
import { executePlan } from "../src/executor.js";

const SPEC = JSON.stringify({
  openapi: "3.0.0",
  info: { title: "Things API" },
  paths: {
    "/things": {
      get: { operationId: "listThings", summary: "List things", responses: { "200": { description: "ok" } } },
    },
  },
});

describe("executePlan network failures", () => {
  it("names the upstream URL and the network cause instead of bare 'fetch failed'", async () => {
    const graph = ingestOpenApi(SPEC, "proj", "src-test");
    // nothing listens on this port, so the connect is refused immediately
    const manifest = generateManifest(
      graph,
      { operationIds: ["listThings"], taskFlowIds: [] },
      { serverName: "things", baseUrls: { default: "http://127.0.0.1:59999" } },
    );
    const tool = manifest.tools[0]!;

    const failure = await executePlan(manifest, tool, {}).then(
      () => {
        throw new Error("expected executePlan to reject");
      },
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(failure).toContain("http://127.0.0.1:59999/things");
    // the undici cause (ECONNREFUSED) must surface, not just "fetch failed"
    expect(failure).toMatch(/ECONNREFUSED|connect/i);
  });
});
