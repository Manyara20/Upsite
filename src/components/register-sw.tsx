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
    const register = () => {
      void navigator.serviceWorker
        .register(`${base}/sw.js`, { scope: `${base}/` })
        .catch((err) => console.warn("[upsite] service worker registration failed:", err));
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => window.removeEventListener("load", register);
  }, []);

  return null;
}
