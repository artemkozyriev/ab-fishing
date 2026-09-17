# app/ — PWA (MVP)

Offline-first reference for Alberta fishing regulations by waterbody. Vanilla JS, no build/dependencies —
so it runs instantly. Later ported to React Native + Expo (see `../DECISIONS.md`).

## Run
```bash
node ../scripts/serve.mjs      # from the scripts folder: node scripts/serve.mjs
# open http://localhost:5173
```
> `file://` won't work — the service worker and fetch require an http origin. Use the dev server.

## MVP features
- 🔎 **Search** waterbody by name (offline, 5,063 lakes and rivers).
- 🐟 **Regulations by species**: seasons (open/closed), bag limit, min/max size, bait.
- 🗺️ **Map** (Leaflet + OSM, marker clustering): all waterbodies as points, tap → regulations.
- 🎯 **Filter by fish species** (shared by list and map): "where can I fish for walleye" + a
  "harvest allowed only" option (bag limit > 0).
- 📍 **Near me**: GPS → point-in-polygon over lake geometry → "you are on Lake X" + nearest lakes.
- 📴 **Offline**: the service worker caches the app, data and Leaflet (cache-first). Map tiles are online only.
- ⚠️ Disclaimer + data version.

> Filter sanity check: "LAKE STURGEON" → 106 waterbodies, but 0 with harvest allowed
> (Alberta lake sturgeon is catch-and-release only) — the data and filter reflect real rules.

## Files
| File | Purpose |
|---|---|
| `index.html` | markup, SW registration |
| `styles.css` | styles (mobile-first) |
| `db.js` | data layer + geo (search, point-in-polygon, nearest) |
| `app.js` | UI logic (screens, rendering, GPS, species filter) |
| `sw.js` | service worker (offline cache; version `ab-fishing-v3`) |
| `manifest.webmanifest` | PWA manifest |
| `data/` | built by `scripts/build-app-data.mjs` from `../data/` |

## App data (`data/`)
- `search-index.json` — lightweight search index with coordinates (~424 KB).
- `regulations-by-id.json` — regulations by WB_ID, compact keys (~5 MB).
- `lakes.geojson` — lake geometry for GPS (~6 MB).
- `meta.json` — version, attribution, disclaimer, statistics.

Rebuild the data: `node ../scripts/build-app-data.mjs`. When you change app files, bump the
`CACHE` version in `sw.js`, otherwise users keep the old cached version.

## Deliberate MVP simplifications (next TODOs)
- Map tiles are online only (caching thousands of tiles is impractical); markers/list/GPS work offline.
- Rivers are not used in "Near me" (lake polygons only; rivers are lines and need a buffer).
- Map markers use the waterbody centroid (not the outline); lake polygons can be drawn later.
- No bathymetry/depth maps (the next data source is AGS).
- ⚠️ Regulation data comes from an API without a public licence; get provincial permission
  before production (`PGC.Metadata@gov.ab.ca`), see `../DATA_SOURCES.md §1.4`.
