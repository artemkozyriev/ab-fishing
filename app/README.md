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
- 📊 **Depth maps (bathymetry)**: lake depths from AER/Alberta Geological Survey (166 lakes) shown
  as filled depth zones (light blue → dark blue), visible when zoomed in (≥ z10) with a legend.
  Tap any zone → exact depth in metres; each lake shows its max-depth label. Waterbodies with a
  depth map get a badge in the detail view. Licence: OGL–Alberta (attributed on the map).
- 🎯 **Filter by fish species** (shared by list and map): "where can I fish for walleye" + a
  "harvest allowed only" option (bag limit > 0).
- 📍 **Near me**: GPS → point-in-polygon over lake geometry → "you are on Lake X" + nearest lakes.
- 📴 **Offline**, including the map:
  - App, data and Leaflet are cached (cache-first).
  - Vector water layers (lake outlines + river lines) are drawn from our own geometry — visible
    offline everywhere.
  - OSM tiles (which include roads + place names) are cached as you browse, capped at ~2500 tiles.
  - **⬇️ Download area** button: pre-caches all tiles in the current view down a few zoom levels
    into a persistent cache (capped ~1500 tiles per download so it stays tens of MB, not GB) — so
    your fishing area works fully offline with roads and town names.
- ⚠️ Disclaimer + data version.

> Tiles come from the public OSM servers with required attribution. Their usage policy discourages
> bulk downloading, so "Download area" is deliberately gentle: low concurrency, a delay per tile,
> and a ~1000-tile cap per download. For heavier/production use, switch to a proper tile provider
> (MapTiler, Thunderforest) or self-hosted tiles.

## Icons
PWA icons are generated from `icons/icon.svg` by `scripts/make-icons.mjs` (uses `@resvg/resvg-js`):
`icon-192.png`, `icon-512.png` (any), `icon-maskable-512.png` (maskable, full-bleed + safe zone),
`apple-touch-icon-180.png` (iOS). Regenerate: `npm run icons`.

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
- `rivers.geojson` — simplified river lines for the map (~9 MB).
- `bathymetry.geojson` — lake depth contours, coloured by depth (~1.5 MB, AER/AGS).
- `meta.json` — version, attribution, disclaimer, statistics.

Regenerate depth data: `node scripts/fetch-bathymetry.mjs` then `npm run build-data`.

Rebuild the data: `node ../scripts/build-app-data.mjs`. When you change app files, bump the
`CACHE` version in `sw.js`, otherwise users keep the old cached version.

## Deliberate MVP simplifications (next TODOs)
- Rivers are not used in "Near me" (lake polygons only; rivers are lines and need a buffer).
- No "manage/clear downloaded areas" UI yet (downloads persist in the `ab-fishing-tiles-dl-v1` cache).
- Offline street detail is limited to areas browsed or downloaded (whole-province street tiles
  would be too large to bundle).
- Map markers use the waterbody centroid (not the outline); lake polygons can be drawn later.
- No bathymetry/depth maps (the next data source is AGS).
- ⚠️ Regulation data comes from an API without a public licence; get provincial permission
  before production (`PGC.Metadata@gov.ab.ca`), see `../DATA_SOURCES.md §1.4`.
