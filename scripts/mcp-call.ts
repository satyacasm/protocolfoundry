/**
 * Generic MCP endpoint exerciser for manual validation of hosted servers.
 *
 * Usage:
 *   npx tsx scripts/mcp-call.ts <mcp-url> <api-key> list
 *   npx tsx scripts/mcp-call.ts <mcp-url> <api-key> call <tool> [key=value ...]
 *
 * Values are JSON-parsed when possible (numbers, booleans, arrays), else strings.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [url, apiKey, command, toolName, ...pairs] = process.argv.slice(2);
if (!url || !apiKey || !command || (command === "call" && !toolName)) {
  console.error("Usage: mcp-call.ts <mcp-url> <api-key> list | call <tool> [key=value ...]");
  process.exit(1);
}

const client = new Client({ name: "pf-mcp-call", version: "1.0.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } },
  }),
);

if (command === "list") {
  const { tools } = await client.listTools();
  for (const tool of tools) {
    const schema = tool.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
    const props = Object.keys(schema.properties ?? {});
    console.log(`${tool.name}`);
    console.log(`  ${tool.description?.slice(0, 100)}`);
    console.log(`  args: ${props.join(", ") || "(none)"}`);
    if (schema.required?.length) console.log(`  required: ${schema.required.join(", ")}`);
  }
} else if (command === "call") {
  const args: Record<string, unknown> = {};
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    const key = pair.slice(0, eq);
    const raw = pair.slice(eq + 1);
    try {
      args[key] = JSON.parse(raw);
    } catch {
      args[key] = raw;
    }
  }
  const result = await client.callTool({ name: toolName!, arguments: args });
  const content = result.content as Array<{ type: string; text?: string }>;
  console.log(`isError: ${result.isError ?? false}`);
  console.log(content[0]?.text ?? "(no text content)");
} else {
  console.error(`Unknown command "${command}"`);
}

await client.close();
