// Caching: the core files (pages, scripts, the parser, game data) are kept so replay analysis
// keeps working without a connection. Icons are cached as they get loaded. Demos never go
// through this; they are read straight from disk.
// Strategy: serve from cache, refresh the cache in the background (stale-while-revalidate),
// so a new version shows up on the next visit.
const CACHE = "dldi-v2";  // bump to force every visitor to refetch everything
const CORE = [
  "./", "index.html", "style.css", "icon.svg", "data/assets.json", "parser/dlparse.wasm",
  "js/analysis.js", "js/app.js", "js/data.js", "js/explain.js", "js/home.js", "js/lang.js",
  "js/local.js", "js/match.js", "js/minimap.js", "js/parse-worker.js", "js/postgame.js", "js/timeline.js", "js/ui.js",
];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then(async (cache) => {
    await cache.addAll(CORE);
    await self.skipWaiting();
  }));
});

self.addEventListener("activate", (ev) => {
  ev.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (ev) => {
  const req = ev.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  ev.respondWith(caches.open(CACHE).then(async (cache) => {
    // ?query variants (cache busting) share one entry
    const key = req.url.split("?")[0];
    const cached = await cache.match(key);
    const fresh = fetch(req).then((res) => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    }).catch(() => null);
    return cached || (await fresh) || new Response("offline and not cached yet", { status: 503 });
  }));
});
