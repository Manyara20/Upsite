import type { NextConfig } from "next";
import { getConfig } from "./src/lib/config";

/**
 * The status site is a fully static export served by GitHub Pages. It has no
 * server, no API routes and no runtime environment — everything it knows at
 * build time is baked in, and everything after that it reads from the GitHub
 * API in the browser.
 */

// A GitHub Pages *project* site lives under /<repo>. The workflow passes what
// `actions/configure-pages` worked out, which wins over the configured value so
// a custom domain needs no edit to the YAML.
//
// That action reports "/" for a root-served site, and Next rejects a basePath
// of "/" — normalise it away along with any trailing slash.
const configured = process.env.UPSITE_BASE_PATH ?? getConfig().site.basePath;
const basePath = configured.replace(/\/+$/, "");

const nextConfig: NextConfig = {
  output: "export",
  basePath: basePath || undefined,
  // Pages serves `/monitor/kfs/index.html` for `/monitor/kfs/`, but nothing
  // for `/monitor/kfs`. Trailing slashes are what make the links resolve.
  trailingSlash: true,
  // There is no image optimiser in a static export.
  images: { unoptimized: true },
  // Read by the layout and the service-worker registration, which have to
  // build absolute paths themselves — `basePath` is not applied to either.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  serverExternalPackages: ["yaml"],
};

export default nextConfig;
