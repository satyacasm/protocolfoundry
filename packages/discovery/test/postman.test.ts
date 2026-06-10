import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ingestSource } from "../src/index.js";
import { inferSchema, ingestPostman } from "../src/postman.js";

const SHIPROCKET = join(import.meta.dirname, "../../../examples/shiprocket/postman-collection.json");

const FIXTURE = JSON.stringify({
  info: { _postman_id: "abc", name: "Fixture", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
  variable: [{ key: "version", value: "v2" }],
  item: [
    {
      name: "Widgets",
      item: [
        {
          name: "List Widgets",
          request: {
            method: "GET",
            auth: { type: "noauth" },
            url: {
              raw: "https://api.example.com/{{version}}/widgets?status=active",
              protocol: "https",
              host: ["api", "example", "com"],
              path: ["{{version}}", "widgets"],
              query: [
                { key: "status", value: "active", description: "Filter by status" },
                { key: "debug", value: "1", disabled: true },
              ],
            },
          },
          response: [{ code: 200, body: JSON.stringify([{ id: 1, name: "w" }]) }],
        },
        {
          name: "Get Widget",
          request: {
            method: "GET",
            url: {
              raw: "https://api.example.com/v2/widgets/:widget_id",
              host: ["api", "example", "com"],
              path: ["v2", "widgets", ":widget_id"],
              variable: [{ key: "widget_id", description: "The widget id" }],
            },
            header: [{ key: "Authorization", value: "Bearer {{token}}" }],
          },
        },
        {
          name: "Create Widget",
          request: {
            method: "POST",
            url: { raw: "https://other.example.com/v2/widgets", host: ["other", "example", "com"], path: ["v2", "widgets"] },
            body: { mode: "raw", raw: JSON.stringify({ name: "x", weight: 1.5, tags: ["a"], active: true }) },
          },
        },
        {
          name: "Upload Widget Image",
          request: {
            method: "POST",
            url: { raw: "https://api.example.com/v2/widgets/upload", host: ["api", "example", "com"], path: ["v2", "widgets", "upload"] },
            body: { mode: "formdata", formdata: [{ key: "file", type: "file" }, { key: "label", value: "front" }] },
          },
        },
      ],
    },
  ],
});

describe("ingestPostman", () => {
  it("maps folders, variables, path params, query, bodies, and multi-host", () => {
    const graph = ingestPostman(FIXTURE, "fixture", "src-1");
    expect(graph.operations.map((op) => op.id)).toEqual([
      "List_Widgets",
      "Get_Widget",
      "Create_Widget",
      "Upload_Widget_Image",
    ]);

    const list = graph.operations[0]!;
    // {{version}} collection variable resolved into the path
    expect(list.http.path).toBe("/v2/widgets");
    expect(list.parameterLocations).toEqual({ status: "query" });
    expect(list.inputSchema?.["required"]).toBeUndefined(); // disabled query dropped, none required
    expect(list.authRequirementIds).toEqual([]); // explicit noauth
    expect(list.outputSchema?.["type"]).toBe("array");
    expect(list.tags).toEqual(["Widgets"]);

    const get = graph.operations[1]!;
    expect(get.http.path).toBe("/v2/widgets/{widget_id}");
    expect(get.parameterLocations).toEqual({ widget_id: "path" });
    expect(get.inputSchema?.["required"]).toEqual(["widget_id"]);
    expect(get.authRequirementIds).toEqual(["bearer_token"]); // from Authorization header

    const create = graph.operations[2]!;
    const props = create.inputSchema?.["properties"] as Record<string, { type: string }>;
    expect(props["name"]?.type).toBe("string");
    expect(props["weight"]?.type).toBe("number");
    expect(props["tags"]?.type).toBe("array");
    expect(props["active"]?.type).toBe("boolean");
    expect(create.parameterLocations["name"]).toBe("body");
    // inherit + dominant-auth heuristic -> bearer
    expect(create.authRequirementIds).toEqual(["bearer_token"]);

    const upload = graph.operations[3]!;
    expect(upload.parameterLocations).toEqual({ file: "body", label: "body" });

    // multi-host: most common host is "default", the other gets a named ref
    expect(graph.baseUrls["default"]).toBe("https://api.example.com");
    expect(graph.baseUrls["other_example_com"]).toBe("https://other.example.com");
    expect(create.http.baseUrlRef).toBe("other_example_com");
  });

  it("inferSchema handles nesting with a depth cap", () => {
    const schema = inferSchema({ a: { b: { c: { d: 1 } } } });
    expect(JSON.stringify(schema)).toContain('"c":{"type":"object"}');
  });
});

describe("Shiprocket collection (real-world, 92 requests)", () => {
  it("ingests via auto-detection with bearer auth and both hosts", async () => {
    const raw = await readFile(SHIPROCKET, "utf8");
    const graph = ingestSource(raw, "shiprocket", "postman:shiprocket");

    expect(graph.operations.length).toBe(92);
    expect(graph.baseUrls["default"]).toBe("https://apiv2.shiprocket.in");
    expect(Object.values(graph.baseUrls)).toContain("https://serviceability.shiprocket.in");

    // dominant-auth heuristic: bearer everywhere except explicit noauth
    expect(graph.authRequirements.map((a) => a.kind)).toEqual(["bearer"]);
    const noauth = graph.operations.filter((op) => op.authRequirementIds.length === 0);
    expect(noauth.length).toBe(3);

    // body inference produced real argument schemas
    const create = graph.operations.find((op) => /create.*order/i.test(op.name) && op.effect === "create");
    expect(create).toBeDefined();
    const props = create!.inputSchema?.["properties"] as Record<string, unknown>;
    expect(Object.keys(props).length).toBeGreaterThan(3);

    // folder names became tags
    expect(graph.operations.some((op) => op.tags.includes("Couriers"))).toBe(true);
  });
});
