import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Control-plane pages read the release store / audit log per request.
  // (No static generation — data lives on the filesystem and changes live.)
  // The eval job runner hosts staged manifests on an in-process gateway;
  // keep express (CommonJS, dynamic requires) out of Next's server bundle.
  serverExternalPackages: [
    "@protocolfoundry/gateway",
    "express",
    "@modelcontextprotocol/sdk",
    "@anthropic-ai/sdk",
  ],
  experimental: {
    serverActions: {
      // Spec uploads in the Forge: real-world Postman collections easily
      // exceed Next's 1 MB default (Shiprocket's is 2.1 MB).
      bodySizeLimit: "20mb",
    },
  },
};

export default nextConfig;
