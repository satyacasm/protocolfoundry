import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServerManifest } from "@protocolfoundry/core";
import {
  staticManifestSource,
  type ManifestSource,
} from "@protocolfoundry/releases";
import { createMcpServerForManifest, type McpServerDeps } from "./mcp.js";

export interface GatewayOptions extends McpServerDeps {
  /**
   * Inbound API key agents must present (Authorization: Bearer <key> or
   * x-api-key header). When unset the gateway is OPEN — dev only; it logs a
   * loud warning. OAuth 2.1 replaces this in Phase 3.
   */
  apiKey?: string;
}

function requireApiKey(apiKey: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!apiKey) {
      next();
      return;
    }
    const header = req.headers.authorization;
    const presented =
      (header?.startsWith("Bearer ") ? header.slice(7) : undefined) ??
      (typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : undefined);
    if (presented !== apiKey) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32001, message: "Unauthorized: valid API key required" },
        id: null,
      });
      return;
    }
    next();
  };
}

/**
 * Multi-tenant gateway: each manifest is served as a stateless Streamable
 * HTTP MCP endpoint at /mcp/<serverName>. A fresh Server+Transport pair is
 * created per request (the SDK's recommended stateless pattern).
 *
 * Accepts either a static manifest list (dev mode) or a ManifestSource —
 * e.g. the release store's live-release source, which makes promote/rollback
 * take effect without a restart.
 */
export function createGatewayApp(
  manifests: McpServerManifest[] | ManifestSource,
  options: GatewayOptions,
): Express {
  const source: ManifestSource = Array.isArray(manifests)
    ? staticManifestSource(manifests)
    : manifests;
  const app = express();
  app.use(express.json({ limit: "4mb" }));

  if (!options.apiKey) {
    console.warn(
      "[gateway] WARNING: PF_GATEWAY_API_KEY is not set — endpoints are unauthenticated (dev mode only)",
    );
  }

  app.get("/healthz", async (_req, res) => {
    res.json({ ok: true, servers: await source.names() });
  });

  app.post("/mcp/:server", requireApiKey(options.apiKey), async (req, res) => {
    const serverName = String(req.params.server);
    const manifest = await source.get(serverName);
    if (!manifest) {
      res.status(404).json({
        jsonrpc: "2.0",
        error: { code: -32004, message: `Unknown MCP server "${serverName}"` },
        id: null,
      });
      return;
    }
    try {
      const server = createMcpServerForManifest(manifest, options);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[gateway] request failed:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Stateless mode: no SSE streams or sessions to resume/terminate.
  const methodNotAllowed = (_req: Request, res: Response): void => {
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed in stateless mode" },
      id: null,
    });
  };
  app.get("/mcp/:server", methodNotAllowed);
  app.delete("/mcp/:server", methodNotAllowed);

  return app;
}
