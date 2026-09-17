// Service worker — offline cache. Cache-first: the app and its data work without a network.
// Bump the CACHE version when files change — the old cache is then deleted.
const CACHE = 'ab-fishing-v3';

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
];

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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Don't cache map tiles (there are thousands) — they load online only.
  if (url.hostname.endsWith('tile.openstreetmap.org')) return;

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
