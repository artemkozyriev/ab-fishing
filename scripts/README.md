# scripts/ — data & tooling

## fetch-regulations.mjs
Downloads the Alberta fishing-regulations database per waterbody.

**Requirements:** Node 18+ (built-in `fetch`, no dependencies).

### Run
```bash
node scripts/fetch-regulations.mjs                 # named waterbodies (~4k, ~1 min)
node scripts/fetch-regulations.mjs --all           # ALL ~145k (incl. UNNAMED, slow)
node scripts/fetch-regulations.mjs --limit 25      # quick test
node scripts/fetch-regulations.mjs --geometry      # + geometry as GeoJSON (rivers ~25 MB simplified)
node scripts/fetch-regulations.mjs --layers 1      # lakes only (0 = rivers)
node scripts/fetch-regulations.mjs --concurrency 6 # concurrency (default 8)
```

### How it works
1. **Step 1** — from ArcGIS REST (`fisheries_regulations/MapServer`, layers 0 River / 1 Lake) it
   pages through the waterbody list (WB_ID + name + FMZ). Fields are taken from the layer's
   metadata (rivers lack `WB_SEC_ID`/`FEATURE_TYPE`).
2. **Step 2** — for each unique `WB_ID` it calls the undocumented JSON API
   `GET /services/Fisheries/Regulation?waterbodyId=<WB_ID>` with bounded concurrency and retries.

### Resuming
Idempotent. Already-fetched `WB_ID`s are read from `data/regulations.ndjson` and skipped.
Just re-run the same command to continue an interrupted run.

### Output files (`../data/`)
| File | What |
|---|---|
| `waterbodies.json` | metadata for all objects (WB_ID, name, FMZ, type) |
| `lakes.geojson` / `rivers.geojson` | geometry WGS84 (with `--geometry`, simplified) |
| `regulations.ndjson` | raw API responses (for resuming) |
| `regulations.json` | merged regulations by section |
| `regulations-flat.csv` | flat table (Excel) |
| `summary.json` | run statistics |
| `errors.log` | real errors (204 is NOT logged here — it means "no specific rules") |

### Data facts (run of 2026-09-16)
- Objects in the layers: **144,950**, unique WB_ID: **144,872**.
- Of those ~**140,834 "UNNAMED"** (small unnamed creeks/ponds) → skipped by default.
- **Named waterbodies: ~5,067** (with Common_Name included) → the core for the app.
- Regulation sections: **5,210**, regulation rows: **36,565**, species: **21**.
- **HTTP 204** = the waterbody has no separate record (general zone rules apply) — not an error.
- One waterbody yields several rows: species × seasons (e.g. open-water / winter season).

### ⚠️ Legal status
- ArcGIS geodata — **OGL–Alberta** (attribution required).
- Regulation API — **no public licence** (internal backend). Get provincial permission before
  production (`PGC.Metadata@gov.ab.ca`). Don't hardcode it as the only source — the format/path
  may change when their app is updated. See `../DATA_SOURCES.md §1.4`.

## build-app-data.mjs
Builds the compact PWA dataset in `../app/data/` from the raw `../data/` files (search index with
coordinates, regulations by WB_ID, lake geometry, meta). Run: `node scripts/build-app-data.mjs`.

## serve.mjs
Lightweight static dev server for the PWA (no dependencies). `node scripts/serve.mjs` → http://localhost:5173.
