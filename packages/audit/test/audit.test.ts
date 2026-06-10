import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { newDb } from "pg-mem";
import { JsonlAuditStore } from "../src/jsonl.js";
import { PgAuditStore, type AuditPgPoolLike } from "../src/pg.js";
import type { AuditStore } from "../src/types.js";

const dir = mkdtempSync(join(tmpdir(), "pf-audit-"));

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function seed(store: AuditStore): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await store.record({
      projectId: "taskboard",
      kind: "toolInvocation",
      actor: { type: "agent", id: "mcp-client" },
      detail: { tool: `tool_${i}`, argsSha256: store.hashArgs({ i }), ok: true },
    });
  }
  await store.record({
    projectId: "taskboard",
    kind: "releasePromoted",
    actor: { type: "user", id: "operator" },
    detail: { version: 2 },
  });
  await store.record({
    projectId: "other",
    kind: "approvalDenied",
    actor: { type: "agent", id: "mcp-client" },
    detail: { tool: "delete_thing" },
  });
}

function behaviors(name: string, makeStore: () => AuditStore) {
  describe(name, () => {
    const store = makeStore();

    it("records and queries newest-first with filters and pagination", async () => {
      await seed(store);

      const all = await store.query();
      expect(all).toHaveLength(7);
      // newest first: last recorded (approvalDenied) comes first
      expect(all[0]!.kind).toBe("approvalDenied");
      expect(all[6]!.detail["tool"]).toBe("tool_0");

      const promoted = await store.query({ kind: "releasePromoted" });
      expect(promoted).toHaveLength(1);
      expect(promoted[0]!.actor).toEqual({ type: "user", id: "operator" });

      const byProject = await store.query({ projectId: "other" });
      expect(byProject).toHaveLength(1);

      const page1 = await store.query({ limit: 3 });
      const page2 = await store.query({ limit: 3, offset: 3 });
      expect(page1).toHaveLength(3);
      expect(page2).toHaveLength(3);
      const ids = new Set([...page1, ...page2].map((e) => e.id));
      expect(ids.size).toBe(6); // no overlap between pages
    });

    it("hashes args and never stores raw values in detail", async () => {
      const hash = store.hashArgs({ password: "hunter2" });
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      const events = await store.query({ kind: "toolInvocation", limit: 1 });
      expect(JSON.stringify(events)).not.toContain("hunter2");
    });
  });
}

behaviors("JsonlAuditStore", () => new JsonlAuditStore(join(dir, `log-${Date.now()}.jsonl`)));
behaviors("PgAuditStore", () => {
  const { Pool } = newDb().adapters.createPg();
  return new PgAuditStore(new Pool() as unknown as AuditPgPoolLike);
});
