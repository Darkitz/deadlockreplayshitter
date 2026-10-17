// Offline support: after the first visit DLDI works without internet. Everything the site
// needs is cached here; demos never go through this (they are read straight from disk).
// Strategy: serve from cache, refresh the cache in the background (stale-while-revalidate),
// so a new version shows up on the next visit.
const CACHE = "dldi-v1";  // bump to force every visitor to refetch everything
const CORE = [
  "./", "index.html", "style.css", "icon.svg", "data/assets.json", "parser/dlparse.wasm",
  "js/analysis.js", "js/app.js", "js/data.js", "js/explain.js", "js/home.js", "js/lang.js",
  "js/local.js", "js/match.js", "js/minimap.js", "js/parse-worker.js", "js/timeline.js", "js/ui.js",
];

self.addEventListener("install", (ev) => {
  ev.waitUntil(caches.open(CACHE).then(async (cache) => {
    await cache.addAll(CORE);
    await cacheIcons(cache);
    await self.skipWaiting();
  }));
});

/** every hero / ability / item icon and the map from assets.json, so offline is really offline */
async function cacheIcons(cache) {
  try {
    const assets = await (await cache.match("data/assets.json")).json();
    const paths = new Set();
    for (const h of Object.values(assets.heroes || {})) for (const k of ["icon", "minimap"]) if (h[k]) paths.add(h[k]);
    for (const it of Object.values(assets.items || {})) if (it.image) paths.add(it.image);
    if (assets.map?.image) paths.add(assets.map.image);
    const todo = [...paths];
    const worker = async () => {
      for (let p = todo.pop(); p; p = todo.pop()) {
        try {
          if (await cache.match(p)) continue;
          // reuse the copy from an older version of this cache when there is one
          const res = (await caches.match(p)) || (await fetch(p));
          if (res.ok) await cache.put(p, res.clone());
        } catch { /* a missing icon must not break the install */ }
      }
    };
    await Promise.all(Array.from({ length: 8 }, worker));
  } catch { /* icons stay cached on demand */ }
}

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
