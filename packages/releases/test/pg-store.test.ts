import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import type { EvalRun, McpServerManifest } from "@protocolfoundry/core";
import { ingestOpenApi } from "@protocolfoundry/discovery";
import { generateManifest } from "@protocolfoundry/generator";
import { PgReleaseStore, type PgPoolLike } from "../src/pg-store.js";
import { releaseManifestSource } from "../src/source.js";
import { ReleaseGateError } from "../src/types.js";

const SPEC_PATH = join(import.meta.dirname, "../../../examples/taskboard/openapi.json");
const GATE = { minTaskCompletionRate: 0.8, minToolSelectionAccuracy: 0.8 };

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

function freshStore(): PgReleaseStore {
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  return new PgReleaseStore(new Pool() as unknown as PgPoolLike);
}

beforeAll(async () => {
  const graph = ingestOpenApi(await readFile(SPEC_PATH, "utf8"), "taskboard", "src");
  manifest = generateManifest(
    graph,
    { operationIds: graph.operations.map((op) => op.id), taskFlowIds: [] },
    { serverName: "taskboard" },
  );
});

describe("PgReleaseStore", () => {
  it("enforces the same eval gate semantics as the file store", async () => {
    const store = freshStore();
    await expect(
      store.createRelease(manifest, { evalRun: evalRun(0.5, 1), gate: GATE }),
    ).rejects.toThrow(ReleaseGateError);
    await expect(store.createRelease(manifest, { gate: GATE, force: true })).rejects.toThrow(
      /approvedBy/,
    );
    const forced = await store.createRelease(manifest, {
      gate: GATE,
      force: true,
      approvedBy: "satya",
    });
    expect(forced.status).toBe("staged");
    expect(forced.approvedBy).toBe("satya");
  });

  it("runs the full lifecycle with manifests and eval runs round-tripping", async () => {
    const store = freshStore();

    const v1 = await store.createRelease(manifest, { evalRun: evalRun(1, 1), gate: GATE });
    expect(v1.version).toBe(1);
    expect(await store.getLive("taskboard")).toBeUndefined();

    await store.promote("taskboard", 1);
    const live = await store.getLive("taskboard");
    expect(live!.release.version).toBe(1);
    expect(live!.manifest.serverName).toBe("taskboard");
    expect(live!.manifest.tools).toHaveLength(manifest.tools.length);

    const run = await store.getEvalRun("taskboard", 1);
    expect(run!.taskCompletionRate).toBe(1);

    const v2 = await store.createRelease(manifest, { evalRun: evalRun(0.9, 0.9), gate: GATE });
    await store.promote("taskboard", v2.version);
    expect((await store.getLive("taskboard"))!.release.version).toBe(2);

    const restored = await store.rollback("taskboard");
    expect(restored.version).toBe(1);
    const statuses = Object.fromEntries(
      (await store.list("taskboard")).map((r) => [r.version, r.status]),
    );
    expect(statuses).toEqual({ 1: "live", 2: "rolledBack" });

    await expect(store.promote("taskboard", 2)).rejects.toThrow(/only staged/);
    expect(await store.listProjects()).toEqual(["taskboard"]);
  });

  it("works as a gateway ManifestSource with hot promote/rollback", async () => {
    const store = freshStore();
    const source = releaseManifestSource(store, 0);

    expect(await source.names()).toEqual([]);
    await store.createRelease(manifest, { evalRun: evalRun(1, 1), gate: GATE });
    await store.promote("taskboard", 1);
    expect(await source.names()).toEqual(["taskboard"]);
    expect((await source.get("taskboard"))!.tools.length).toBe(manifest.tools.length);
  });
});
