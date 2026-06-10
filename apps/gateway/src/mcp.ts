import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { McpServerManifest } from "@protocolfoundry/core";
import { executePlan, envCredentialResolver, type CredentialResolver } from "./executor.js";
import type { AuditSink } from "./audit.js";

export interface McpServerDeps {
  audit: AuditSink;
  resolveCredential?: CredentialResolver;
  /** Per-call approval gates need a human channel (Phase 3); until then this flag. */
  approveAll?: boolean;
}

/** What the caller's credential grants. Static API key / open mode = "all". */
export interface AuthContext {
  scopes: string[] | "all";
}

/**
 * Build an MCP server for one manifest. Called once per request in stateless
 * Streamable HTTP mode, so instances must be cheap and hold no session state.
 */
export function createMcpServerForManifest(
  manifest: McpServerManifest,
  deps: McpServerDeps,
  auth: AuthContext = { scopes: "all" },
): Server {
  const resolveCredential = deps.resolveCredential ?? envCredentialResolver;
  const server = new Server(
    { name: manifest.serverName, version: "0.0.1" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: manifest.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as { type: "object"; [key: string]: unknown },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    const tool = manifest.tools.find((t) => t.name === toolName);

    const baseDetail = {
      serverName: manifest.serverName,
      tool: toolName,
      argsSha256: deps.audit.hashArgs(args),
    };
    const actor = { type: "agent" as const, id: "mcp-client" };

    if (!tool) {
      return {
        content: [{ type: "text", text: `Unknown tool "${toolName}"` }],
        isError: true,
      };
    }

    if (auth.scopes !== "all") {
      const missing = tool.requiredScopes.filter((s) => !(auth.scopes as string[]).includes(s));
      if (missing.length > 0) {
        await deps.audit.record({
          projectId: manifest.projectId,
          kind: "toolInvocation",
          actor,
          detail: { ...baseDetail, ok: false, error: `insufficient_scope: needs ${missing.join(", ")}` },
        });
        return {
          content: [
            {
              type: "text",
              text: `Insufficient scope: tool "${toolName}" requires [${tool.requiredScopes.join(", ")}] but this token grants [${(auth.scopes as string[]).join(", ")}]. The operation was NOT executed.`,
            },
          ],
          isError: true,
        };
      }
    }

    if (tool.approval === "perCall" && !deps.approveAll) {
      await deps.audit.record({
        projectId: manifest.projectId,
        kind: "approvalDenied",
        actor,
        detail: { ...baseDetail, reason: "per-call approval required" },
      });
      return {
        content: [
          {
            type: "text",
            text: `Tool "${toolName}" requires per-call human approval, which is not enabled on this gateway. The operation was NOT executed.`,
          },
        ],
        isError: true,
      };
    }

    const startedAt = Date.now();
    try {
      const { output, upstreamCalls } = await executePlan(
        manifest,
        tool,
        args,
        resolveCredential,
      );
      await deps.audit.record({
        projectId: manifest.projectId,
        kind: "toolInvocation",
        actor,
        detail: {
          ...baseDetail,
          ok: true,
          durationMs: Date.now() - startedAt,
          upstream: upstreamCalls.map(({ operationId, method, status, durationMs }) => ({
            operationId,
            method,
            status,
            durationMs,
          })),
        },
      });
      return {
        content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await deps.audit.record({
        projectId: manifest.projectId,
        kind: "toolInvocation",
        actor,
        detail: { ...baseDetail, ok: false, error: message },
      });
      return {
        content: [{ type: "text", text: `Tool execution failed: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}
