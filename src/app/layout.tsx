import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Upsite — Real-time uptime intelligence",
  description:
    "A database-free uptime monitoring platform. Configured by one YAML file, driven by an in-process scheduler, streamed live over SSE.",
};

export const viewport: Viewport = {
  themeColor: "#05070d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {/* Ambient ground: a drifting grid under two soft light sources. It is
            fixed and inert so it never interferes with scrolling or hit-testing. */}
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="grid-field grid-mask animate-drift absolute inset-0" />
          <div className="absolute -top-40 left-1/2 h-[36rem] w-[64rem] -translate-x-1/2 rounded-full bg-signal/[0.07] blur-[120px]" />
          <div className="absolute bottom-0 right-0 h-[28rem] w-[28rem] translate-x-1/3 translate-y-1/3 rounded-full bg-up/[0.05] blur-[120px]" />
        </div>
        {children}
      </body>
    </html>
  );
}
