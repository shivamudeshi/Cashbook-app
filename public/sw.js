// Bump CACHE whenever the build changes, or installed phones keep serving the
// stale cached bundle.
const CACHE = "cashbook-v24";
const SHELL = [
  ".",
  "index.html",
  "app.js",
  "pdf.worker.min.mjs",
  "manifest.json",
  "instruments.json",
  "prices.json",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-192.png",
  "icons/icon-maskable-512.png",
  "fonts/plus-jakarta-sans-latin-400-normal.woff2",
  "fonts/plus-jakarta-sans-latin-500-normal.woff2",
  "fonts/plus-jakarta-sans-latin-600-normal.woff2",
  "fonts/plus-jakarta-sans-latin-700-normal.woff2",
  "fonts/plus-jakarta-sans-latin-800-normal.woff2",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // Investment prices refresh daily (a GitHub Action commits a new
  // snapshot) — unlike the rest of the app shell, prefer the network so an
  // online phone always sees the latest prices, falling back to whatever
  // was last cached (or, failing that, an empty snapshot — the engine
  // already treats a missing price as "value at cost," never a crash).
  if (url.pathname.endsWith("/prices.json") || url.pathname.endsWith("/instruments.json")) {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() =>
          caches
            .match(e.request, { ignoreSearch: true })
            .then((hit) => hit || new Response("{}", { headers: { "Content-Type": "application/json" } }))
        )
    );
    return;
  }
  // OCR assets are big (~9MB) so they aren't precached; cache them the first
  // time they're fetched and OCR works offline from then on.
  if (url.pathname.includes("/ocr/")) {
    e.respondWith(
      caches.match(e.request).then(
        (hit) =>
          hit ||
          fetch(e.request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(e.request, copy));
            }
            return res;
          })
      )
    );
    return;
  }
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request))
  );
});
