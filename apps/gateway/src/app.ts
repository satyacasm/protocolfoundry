import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { McpServerManifest } from "@protocolfoundry/core";
import {
  staticManifestSource,
  type ManifestSource,
} from "@protocolfoundry/releases";
import { createMcpServerForManifest, type AuthContext, type McpServerDeps } from "./mcp.js";
import { verifyToken } from "./tokens.js";

export interface GatewayOptions extends McpServerDeps {
  /**
   * Static inbound API key (full access, all scopes). Back-compat /
   * single-operator mode.
   */
  apiKey?: string;
  /**
   * Secret for verifying scoped `pft_` bearer tokens (pf token issue).
   * Tokens carry per-server scopes enforced against each tool's
   * requiredScopes. Either or both of apiKey/tokenSecret may be set;
   * with neither the gateway is OPEN (dev only, loud warning).
   */
  tokenSecret?: string;
  /** Advertised authorization servers for RFC 9728 metadata (ADR-0007). */
  authorizationServers?: string[];
}

function metadataUrl(req: Request, serverName: string): string {
  const host = req.headers.host ?? "localhost";
  const proto = req.headers["x-forwarded-proto"] ?? "http";
  return `${proto}://${host}/.well-known/oauth-protected-resource/mcp/${serverName}`;
}

function deny(req: Request, res: Response, serverName: string, message: string): void {
  res
    .status(401)
    .set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${metadataUrl(req, serverName)}", error="invalid_token"`,
    )
    .json({
      jsonrpc: "2.0",
      error: { code: -32001, message: `Unauthorized: ${message}` },
      id: null,
    });
}

/** Authenticate the request and attach the granted scopes to res.locals. */
function requireAuth(options: GatewayOptions) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const serverName = String(req.params.server ?? "");
    if (!options.apiKey && !options.tokenSecret) {
      res.locals["auth"] = { scopes: "all" } satisfies AuthContext;
      next();
      return;
    }
    const header = req.headers.authorization;
    const presented =
      (header?.startsWith("Bearer ") ? header.slice(7) : undefined) ??
      (typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"] : undefined);
    if (!presented) {
      deny(req, res, serverName, "bearer token or API key required");
      return;
    }
    if (options.apiKey && presented === options.apiKey) {
      res.locals["auth"] = { scopes: "all" } satisfies AuthContext;
      next();
      return;
    }
    if (options.tokenSecret) {
      const claims = verifyToken(options.tokenSecret, presented, serverName);
      if (claims) {
        res.locals["auth"] = { scopes: claims.scp } satisfies AuthContext;
        next();
        return;
      }
    }
    deny(req, res, serverName, "invalid, expired, or wrong-server credential");
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

  if (!options.apiKey && !options.tokenSecret) {
    console.warn(
      "[gateway] WARNING: neither PF_GATEWAY_API_KEY nor PF_GATEWAY_TOKEN_SECRET is set — endpoints are unauthenticated (dev mode only)",
    );
  }

  app.get("/healthz", async (_req, res) => {
    res.json({ ok: true, servers: await source.names() });
  });

  // RFC 9728 protected resource metadata (ADR-0007).
  app.get("/.well-known/oauth-protected-resource/mcp/:server", async (req, res) => {
    const serverName = String(req.params.server);
    const manifest = await source.get(serverName);
    if (!manifest) {
      res.status(404).json({ error: "unknown resource" });
      return;
    }
    const host = req.headers.host ?? "localhost";
    const proto = req.headers["x-forwarded-proto"] ?? "http";
    const scopes = [...new Set(manifest.tools.flatMap((t) => t.requiredScopes))].sort();
    res.json({
      resource: `${proto}://${host}/mcp/${serverName}`,
      authorization_servers: options.authorizationServers ?? [],
      scopes_supported: scopes,
      bearer_methods_supported: ["header"],
      resource_name: manifest.serverDescription,
    });
  });

  app.post("/mcp/:server", requireAuth(options), async (req, res) => {
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
      const auth = (res.locals["auth"] as AuthContext | undefined) ?? { scopes: "all" };
      const server = createMcpServerForManifest(manifest, options, auth);
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
