/**
 * mdrone service worker.
 *
 * Hand-written, zero-dep. Cache strategy:
 *   - Navigations (HTML): network-first → cached app.html → offline.html
 *   - Same-origin /assets/ (Vite-hashed, immutable): cache-first
 *   - Same-origin other (favicon, icons, preset-icons, fonts, etc.):
 *       stale-while-revalidate
 *   - version.json + count.js + any cross-origin: bypass (network-only,
 *     never cached). version.json must stay fresh to drive the existing
 *     update banner in Layout.tsx.
 *
 * Version is substituted by scripts/post-build.cjs. A new version
 * produces a byte-different sw.js, which triggers the browser's
 * install/waiting flow; swRegister.ts then surfaces an update event
 * that flips the existing update banner.
 */

const APP_VERSION = "__MDRONE_VERSION__";
const CACHE = `mdrone-v${APP_VERSION}`;

// How long a navigation request may wait on the network before the SW
// answers from the cached shell instead. 3s keeps real updates flowing
// on healthy connections while bounding the blank-page window on lie-fi.
const NAV_NETWORK_TIMEOUT_MS = 3000;

// Shell files that are stable across a single deploy. Hashed Vite
// chunks (/assets/*) are intentionally not listed — they are filled
// into the cache on first fetch via the runtime strategy below.
const SHELL = [
  "./",
  "./app.html",
  "./offline.html",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Use individual adds so one missing file doesn't abort install.
      await Promise.all(
        SHELL.map((url) => cache.add(url).catch(() => { /* tolerate */ }))
      );
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Bypass cross-origin entirely — analytics, CDNs, anything external.
  if (url.origin !== self.location.origin) return;

  // Never cache: version.json (drives update banner) and count.js (analytics).
  const path = url.pathname;
  if (path.endsWith("/version.json") || path.endsWith("/count.js")) return;

  // Navigations: network-first so newly-deployed HTML reaches users
  // fast. Offline → cached app.html (SPA shell). No cache → offline.html.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        const cachedFallback = async () => {
          const shell = await caches.match("./app.html");
          if (shell) return shell;
          const offline = await caches.match("./offline.html");
          return offline || new Response("offline", { status: 503 });
        };
        try {
          // Lie-fi guard: a flaky connection can leave the fetch hanging
          // for tens of seconds while the user stares at a blank page.
          // Past this budget, serve the cached shell instead; the network
          // request keeps running but its result is discarded.
          let timer;
          const network = fetch(req);
          const fresh = await Promise.race([
            network,
            new Promise((resolve) => {
              timer = setTimeout(() => resolve(null), NAV_NETWORK_TIMEOUT_MS);
            }),
          ]);
          clearTimeout(timer);
          if (fresh) return fresh;
          // Timed out: swallow the eventual network failure so it doesn't
          // surface as an unhandled rejection.
          network.catch(() => { /* silent */ });
          return cachedFallback();
        } catch {
          return cachedFallback();
        }
      })()
    );
    return;
  }

  // /assets/ is Vite's hashed output — immutable per build. Cache-first.
  const isHashedAsset = path.includes("/assets/");

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req);
      if (cached && isHashedAsset) return cached;

      const networkPromise = fetch(req)
        .then((resp) => {
          if (resp && resp.status === 200 && resp.type === "basic") {
            cache.put(req, resp.clone()).catch(() => { /* quota, etc. */ });
          }
          return resp;
        })
        .catch(() => null);

      if (cached) {
        // Stale-while-revalidate for non-hashed same-origin assets.
        networkPromise.catch(() => { /* silent */ });
        return cached;
      }

      const fresh = await networkPromise;
      if (fresh) return fresh;
      return new Response("offline", { status: 503 });
    })()
  );
});
