import type { NextConfig } from "next";
import { getConfig } from "./src/lib/config";

/**
 * The status site is a fully static export served by GitHub Pages. It has no
 * server, no API routes and no runtime environment — everything it knows at
 * build time is baked in, and everything after that it reads from the GitHub
 * API in the browser.
 */

/**
 * Where this particular deployment is served from.
 *
 * `site.basePath` describes the GitHub Pages *project* site, which lives under
 * /<repo>. Anywhere that serves from the root — Vercel, Netlify, `serve out`,
 * `next dev` — must not get that prefix, or every asset 404s while the
 * prerendered HTML still renders, which looks like a working page with dead
 * JavaScript rather than like a build error.
 */
function resolveBasePath(): string {
  // Set explicitly by the site workflow, from `actions/configure-pages`. It
  // wins over everything, so a custom domain needs no edit to the YAML.
  if (process.env.UPSITE_BASE_PATH !== undefined) return process.env.UPSITE_BASE_PATH;

  // Hosts that serve the export from the root and set their own build env.
  if (process.env.VERCEL || process.env.NETLIFY) return "";

  return getConfig().site.basePath;
}

// `configure-pages` reports "/" for a root-served site and Next rejects a
// basePath of "/", so normalise that away along with any trailing slash.
const basePath = resolveBasePath().replace(/\/+$/, "");

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
