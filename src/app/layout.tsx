import type { Metadata, Viewport } from "next";
import { RegisterServiceWorker } from "@/components/register-sw";
import { getConfig } from "@/lib/config";
import "./globals.css";

const config = getConfig();

// `basePath` is not applied to metadata URLs, so the manifest and icon links
// have to carry it themselves or a project site requests them from the root.
const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const metadata: Metadata = {
  title: `${config.site.name} — status`,
  description:
    config.site.tagline ??
    "Uptime and response time for every monitored endpoint, checked every five minutes by GitHub Actions.",
  applicationName: config.site.name,
  manifest: `${base}/manifest.webmanifest`,
  icons: {
    icon: [
      { url: `${base}/icon.svg`, type: "image/svg+xml" },
      { url: `${base}/icon-192.png`, sizes: "192x192", type: "image/png" },
    ],
    apple: `${base}/apple-touch-icon.png`,
  },
  appleWebApp: {
    capable: true,
    title: config.site.name,
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: "#05070d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {/* Skip link first in the DOM: a keyboard user should not have to tab
            through the filter row to reach the monitors. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:border focus:border-signal/40 focus:bg-abyss focus:px-3 focus:py-2 focus:text-sm focus:text-signal"
        >
          Skip to content
        </a>

        {/* Ambient ground: a drifting grid under two soft light sources. It is
            fixed and inert so it never interferes with scrolling or hit-testing. */}
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="grid-field grid-mask animate-drift absolute inset-0" />
          <div className="absolute -top-40 left-1/2 h-[36rem] w-[64rem] -translate-x-1/2 rounded-full bg-signal/[0.07] blur-[120px]" />
          <div className="absolute bottom-0 right-0 h-[28rem] w-[28rem] translate-x-1/3 translate-y-1/3 rounded-full bg-up/[0.05] blur-[120px]" />
        </div>

        {children}
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
