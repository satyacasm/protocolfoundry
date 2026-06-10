import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { EvalRun, McpServerManifest } from "@protocolfoundry/core";
import { ingestOpenApi } from "@protocolfoundry/discovery";
import { generateManifest } from "@protocolfoundry/generator";
import { FileReleaseStore, ReleaseGateError } from "../src/store.js";

const SPEC_PATH = join(import.meta.dirname, "../../../examples/taskboard/openapi.json");

let rootDir: string;
let manifest: McpServerManifest;

function evalRun(completion: number, selection: number): EvalRun {
  return {
    id: randomUUID(),
    projectId: "taskboard",
    manifestRef: "test",
    agentModel: "scripted",
    results: [],
    taskCompletionRate: completion,
    toolSelectionAccuracy: selection,
    ranAt: new Date().toISOString(),
  };
}

const GATE = { minTaskCompletionRate: 0.8, minToolSelectionAccuracy: 0.8 };

beforeAll(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "pf-releases-"));
  const graph = ingestOpenApi(await readFile(SPEC_PATH, "utf8"), "taskboard", "src");
  manifest = generateManifest(
    graph,
    { operationIds: graph.operations.map((op) => op.id), taskFlowIds: [] },
    { serverName: "taskboard" },
  );
});

afterAll(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe("FileReleaseStore", () => {
  it("blocks releases that fail the eval gate, and ungated/unattributed forces", async () => {
    const store = new FileReleaseStore(join(rootDir, "gate"));
    await expect(
      store.createRelease(manifest, { evalRun: evalRun(0.5, 1), gate: GATE }),
    ).rejects.toThrow(ReleaseGateError);
    await expect(store.createRelease(manifest, { gate: GATE })).rejects.toThrow(
      /no eval run/,
    );
    await expect(
      store.createRelease(manifest, { gate: GATE, force: true }),
    ).rejects.toThrow(/approvedBy/);

    // force with attribution is allowed (human override)
    const forced = await store.createRelease(manifest, {
      gate: GATE,
      force: true,
      approvedBy: "satya",
    });
    expect(forced.status).toBe("staged");
    expect(forced.approvedBy).toBe("satya");
  });

  it("runs the full lifecycle: create -> promote -> new version -> rollback", async () => {
    const store = new FileReleaseStore(join(rootDir, "lifecycle"));

    const v1 = await store.createRelease(manifest, { evalRun: evalRun(1, 1), gate: GATE });
    expect(v1.version).toBe(1);
    expect(v1.status).toBe("staged");
    expect(await store.getLive("taskboard")).toBeUndefined();

    await store.promote("taskboard", 1);
    expect((await store.getLive("taskboard"))!.release.version).toBe(1);

    const v2 = await store.createRelease(manifest, { evalRun: evalRun(0.9, 0.9), gate: GATE });
    expect(v2.version).toBe(2);
    await store.promote("taskboard", 2);

    const releases = await store.list("taskboard");
    expect(releases.find((r) => r.version === 1)!.status).toBe("retired");
    expect(releases.find((r) => r.version === 2)!.status).toBe("live");

    // instant rollback: v2 rolledBack, v1 live again
    const restored = await store.rollback("taskboard");
    expect(restored.version).toBe(1);
    const after = await store.list("taskboard");
    expect(after.find((r) => r.version === 2)!.status).toBe("rolledBack");
    expect((await store.getLive("taskboard"))!.release.version).toBe(1);

    // only staged releases can be promoted
    await expect(store.promote("taskboard", 2)).rejects.toThrow(/only staged/);
  });

  it("keeps released manifests immutable on disk", async () => {
    const store = new FileReleaseStore(join(rootDir, "immutable"));
    const v1 = await store.createRelease(manifest, { evalRun: evalRun(1, 1), gate: GATE });
    const before = await readFile(
      join(rootDir, "immutable", "taskboard", v1.manifestRef),
      "utf8",
    );
    await store.promote("taskboard", 1);
    await store.createRelease(manifest, { evalRun: evalRun(1, 1), gate: GATE });
    const after = await readFile(
      join(rootDir, "immutable", "taskboard", v1.manifestRef),
      "utf8",
    );
    expect(after).toBe(before);
  });
});
