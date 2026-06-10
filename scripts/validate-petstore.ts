/**
 * Exercises a gateway-hosted Petstore MCP endpoint like an agent would:
 * list tools, run a realistic multi-step task, and probe the approval gate.
 *
 * Usage: npx tsx scripts/validate-petstore.ts <mcp-url> <gateway-api-key>
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [url, apiKey] = process.argv.slice(2);
if (!url || !apiKey) {
  console.error("Usage: npx tsx scripts/validate-petstore.ts <mcp-url> <gateway-api-key>");
  process.exit(1);
}

function text(result: { content?: unknown }): string {
  const content = result.content as Array<{ type: string; text?: string }>;
  return content?.[0]?.text ?? "";
}

const client = new Client({ name: "petstore-validation", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
  }),
);

const { tools } = await client.listTools();
console.log(`TOOLS (${tools.length}):`);
for (const t of tools) console.log(`  ${t.name} — ${t.description?.slice(0, 80)}`);

console.log("\n[1] find_pets_by_status(available)");
const found = await client.callTool({
  name: "find_pets_by_status",
  arguments: { status: "available" },
});
const pets = found.isError ? [] : (JSON.parse(text(found)) as Array<{ id: number }>);
console.log(found.isError ? `  ERROR: ${text(found)}` : `  ok — ${pets.length} pets returned`);

console.log("\n[2] add_pet(Rex)");
const created = await client.callTool({
  name: "add_pet",
  arguments: { name: "Rex-ProtocolFoundry", photoUrls: ["https://example.com/rex.jpg"], status: "available" },
});
let rexId: number | undefined;
if (created.isError) {
  console.log(`  ERROR: ${text(created)}`);
} else {
  rexId = (JSON.parse(text(created)) as { id: number }).id;
  console.log(`  ok — created pet id=${rexId}`);
}

if (rexId !== undefined) {
  console.log(`\n[3] get_pet_by_id(${rexId})`);
  const fetched = await client.callTool({ name: "get_pet_by_id", arguments: { petId: rexId } });
  console.log(
    fetched.isError
      ? `  ERROR: ${text(fetched)}`
      : `  ok — name=${(JSON.parse(text(fetched)) as { name: string }).name}`,
  );
}

console.log("\n[4] get_inventory()");
const inventory = await client.callTool({ name: "get_inventory", arguments: {} });
console.log(inventory.isError ? `  ERROR: ${text(inventory)}` : `  ok — ${text(inventory).slice(0, 120)}...`);

console.log("\n[5] delete_pet — expecting approval-gate refusal");
const deleted = await client.callTool({
  name: "delete_pet",
  arguments: { petId: rexId ?? 1 },
});
console.log(
  deleted.isError && text(deleted).includes("approval")
    ? "  ok — blocked by approval gate, NOT executed"
    : `  UNEXPECTED: isError=${deleted.isError} text=${text(deleted).slice(0, 200)}`,
);

await client.close();
console.log("\nValidation run complete.");
