/**
 * Minimal service worker — an offline app shell for the installed PWA.
 *
 * Strategy: network-first for navigations (so updates land immediately when
 * online, with a cached fallback when offline); cache-first for same-origin
 * static assets (Vite emits content-hashed filenames, so they're safe to cache
 * forever). Online gameplay still needs the network — Supabase calls are never
 * cached.
 */
// The cache name carries a PER-BUILD tag (`__BUILD__` is replaced at build time
// by scripts/stamp-sw-cache.mjs with a hash of the built index.html). Each deploy
// therefore gets a fresh cache, and the `activate` handler below deletes every
// cache that isn't the current one — so old content-hashed assets don't
// accumulate forever across deploys. In a raw (unstamped) dev build the literal
// placeholder is used, which is harmless. Bumping the "v3" prefix additionally
// busts every client's cache when the caching LOGIC itself changes.
const CACHE = "parks31-v3-__BUILD__";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch Supabase/CDN calls

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/index.html", copy));
          return res;
        })
        .catch(() => caches.match("/index.html")),
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req).then((res) => {
          // Guard against caching a SPA-fallback page (index.html, served with
          // 200 for a missing asset) under a JS/CSS URL — that would poison the
          // cache so the asset is "broken" forever. Only cache real assets.
          const isHtml = (res.headers.get("content-type") || "").includes("text/html");
          if (res.ok && res.type === "basic" && !isHtml) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
