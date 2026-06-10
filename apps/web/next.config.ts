import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Control-plane pages read the release store / audit log per request.
  // (No static generation — data lives on the filesystem and changes live.)
  experimental: {
    serverActions: {
      // Spec uploads in the Forge: real-world Postman collections easily
      // exceed Next's 1 MB default (Shiprocket's is 2.1 MB).
      bodySizeLimit: "20mb",
    },
  },
  // The in-process eval gateway (lib/eval-jobs.ts) runs express + the MCP SDK
  // inside the Next server — keep them (and the agent SDK) unbundled.
  serverExternalPackages: ["express", "@modelcontextprotocol/sdk", "@anthropic-ai/sdk"],
};

export default nextConfig;
