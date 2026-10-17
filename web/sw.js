// Caching: the core files (pages, scripts, the parser, game data) are kept so replay analysis
// keeps working without a connection. Icons are cached as they get loaded. Demos never go
// through this; they are read straight from disk.
// Strategy: network first for the site itself (always the newest version when online),
// cache first for icons / fonts; everything falls back to the cache when offline.
const CACHE = "dldi-v4";  // bump to force every visitor to refetch everything
const CORE = [
  "./", "index.html", "style.css", "icon.svg", "data/assets.json", "data/tips.json", "parser/dlparse.wasm",
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
  const key = req.url.split("?")[0]; // ?query variants share one entry
  const isAsset = /\/assets\//.test(key);
  ev.respondWith(caches.open(CACHE).then(async (cache) => {
    // icons and fonts never change: cache first. Site code and data: network first, so a new
    // version shows up right away; the cache only answers when offline.
    if (isAsset) {
      const hit = await cache.match(key);
      if (hit) return hit;
    }
    try {
      const res = await fetch(req, { cache: "no-cache" });
      if (res.ok) cache.put(key, res.clone());
      return res;
    } catch {
      return (await cache.match(key)) || new Response("offline and not cached yet", { status: 503 });
    }
  }));
});
