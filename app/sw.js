// Service worker — offline cache. Cache-first for the app; tiles cached as you browse.
// Bump the CACHE version when app files change — the old cache is then deleted.
const CACHE = 'ab-fishing-v6';
const TILE_CACHE = 'ab-fishing-tiles-v1'; // size-capped cache for tiles seen while browsing
const TILE_DL_CACHE = 'ab-fishing-tiles-dl-v1'; // persistent cache for explicitly downloaded areas
const MAX_TILES = 2500; // browse cache cap; downloaded areas are not evicted

// Local assets (required — install fails if any are missing).
const CORE = [
  './',
  './index.html',
  './styles.css',
  './db.js',
  './app.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './data/search-index.json',
  './data/regulations-by-id.json',
  './data/meta.json',
  './data/lakes.geojson',
];

// External Leaflet assets (for the offline map). Cached "softly" — if the CDN is unreachable
// on first run, install still succeeds; the map will work offline later.
const VENDOR = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css',
  'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
  // Default marker icons (otherwise markers render broken offline).
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
];

const isTile = (url) => url.hostname.endsWith('tile.openstreetmap.org');

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then(async (c) => {
        await c.addAll(CORE);
        await Promise.allSettled(VENDOR.map((u) => c.add(u))); // don't fail install over the CDN
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k !== CACHE && k !== TILE_CACHE && k !== TILE_DL_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Store a tile and keep the tile cache under MAX_TILES (rough FIFO — Cache API keeps insertion order).
let tilePuts = 0;
async function cacheTile(req, res) {
  const c = await caches.open(TILE_CACHE);
  await c.put(req, res);
  if (++tilePuts % 50 === 0) {
    const keys = await c.keys();
    if (keys.length > MAX_TILES) {
      await Promise.all(keys.slice(0, keys.length - MAX_TILES).map((k) => c.delete(k)));
    }
  }
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Map tiles: cache-first (downloaded areas → browse cache → network). Saves data and works
  // offline. Tiles are cross-origin no-cors → opaque responses; those are cacheable for <img>.
  if (isTile(url)) {
    e.respondWith(
      (async () => {
        const dl = await caches.open(TILE_DL_CACHE);
        const hitDl = await dl.match(e.request);
        if (hitDl) return hitDl;
        const br = await caches.open(TILE_CACHE);
        const hitBr = await br.match(e.request);
        if (hitBr) return hitBr;
        try {
          const res = await fetch(e.request);
          cacheTile(e.request, res.clone()); // fire and forget
          return res;
        } catch {
          return Response.error();
        }
      })(),
    );
    return;
  }

  // App shell + data + vendor: cache-first.
  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request)
        .then((res) => {
          if (res.ok && (url.origin === location.origin || url.hostname === 'unpkg.com')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        })
        .catch(() => cached);
    }),
  );
});
