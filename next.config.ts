import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The monitoring engine boots from instrumentation.ts and must run in Node,
  // never the edge runtime — it touches the filesystem and raw TCP sockets.
  // instrumentation.ts is stable in Next 15 — no experimental flag needed.
  serverExternalPackages: ["yaml"],
};

export default nextConfig;
