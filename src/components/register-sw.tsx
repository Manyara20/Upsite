"use client";

import { useEffect } from "react";

/**
 * Registers the service worker that makes the status page installable and
 * readable offline. Deliberately after `load`: the worker is a progressive
 * enhancement and must not compete with the first paint for bandwidth.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const base = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
    const scope = new URL(`${base}/`, window.location.origin).toString();

    const register = () => {
      void navigator.serviceWorker
        .getRegistrations()
        .then((existing) =>
          // A worker left over from a build at a different basePath — a local
          // preview served from the root, say — keeps intercepting requests
          // long after it stops matching this deployment. Drop those first.
          Promise.all(
            existing
              .filter((r) => r.scope !== scope)
              .map((r) => r.unregister().catch(() => false)),
          ),
        )
        .then(() => navigator.serviceWorker.register(`${base}/sw.js`, { scope }))
        .catch((err) => console.warn("[upsite] service worker registration failed:", err));
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
