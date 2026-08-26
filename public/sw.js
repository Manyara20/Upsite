/**
 * Upsite's service worker.
 *
 * The status page is the one page people load *because* something might be
 * broken, sometimes on a connection that is itself the thing that is broken.
 * So the shell is cached aggressively and the data is cached as a fallback:
 * offline, you get the last status you saw, clearly stamped with its age by
 * the page itself rather than presented as current.
 */

const VERSION = "upsite-v1";
const SHELL = `${VERSION}-shell`;
const DATA = `${VERSION}-data`;

/** Everything is relative to the registration scope, so /Upsite/ just works. */
const SCOPE = new URL(self.registration.scope);

const PRECACHE = ["", "manifest.webmanifest", "icon.svg"].map(
  (p) => new URL(p, SCOPE).toString(),
);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      // `reload` skips the HTTP cache: a stale index.html here would pin the
      // app to an old build for as long as the cache survives.
      .then((cache) => cache.addAll(PRECACHE.map((u) => new Request(u, { cache: "reload" }))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Next's hashed build output never changes under a given URL. */
function isImmutable(url) {
  return url.origin === SCOPE.origin && url.pathname.includes("/_next/static/");
}

function isData(url) {
  return (
    url.hostname === "api.github.com" ||
    url.hostname === "raw.githubusercontent.com" ||
    url.hostname === "img.shields.io"
  );
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;

  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    // Opaque cross-origin responses have no readable status; store them anyway
    // so an offline reload still paints something.
    if (response.ok || response.type === "opaque") cache.put(request, response.clone());
    return response;
  } catch (err) {
    const hit = await cache.match(request);
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Navigations: try the network so a redeploy is picked up immediately, and
  // fall back to the cached shell — including for a monitor page never
  // visited before, which the SPA can render client-side.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          const cache = await caches.open(SHELL);
          return (
            (await cache.match(request)) ??
            (await cache.match(new URL("", SCOPE).toString())) ??
            Response.error()
          );
        }),
    );
    return;
  }

  if (isImmutable(url)) {
    event.respondWith(cacheFirst(request, SHELL));
    return;
  }

  if (isData(url)) {
    event.respondWith(networkFirst(request, DATA));
    return;
  }

  if (url.origin === SCOPE.origin) {
    event.respondWith(networkFirst(request, SHELL));
  }
});
