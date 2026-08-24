import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/optional Node deps must not be bundled by webpack, or `ws`'s
  // optional `bufferutil` require is shimmed into a broken `bufferUtil.mask`
  // and the Neon WebSocket pool dies with "Connection terminated unexpectedly".
  serverExternalPackages: [
    "@neondatabase/serverless",
    "ws",
    "bullmq",
    "ioredis",
  ],
};

export default nextConfig;
