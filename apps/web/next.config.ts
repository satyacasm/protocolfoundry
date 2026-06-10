import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Control-plane pages read the release store / audit log per request.
  // (No static generation — data lives on the filesystem and changes live.)
};

export default nextConfig;
