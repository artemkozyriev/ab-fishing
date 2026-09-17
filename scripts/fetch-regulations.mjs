#!/usr/bin/env node
// Prototype downloader for the Alberta sportfishing regulations database, per waterbody.
//
// Sources (see ../DATA_SOURCES.md):
//   1) Geometry + WB_ID   — ArcGIS REST (Open Government Licence – Alberta):
//      https://geospatial.alberta.ca/titan/rest/services/fisheries/fisheries_regulations/MapServer
//      layers: 0 River Regulations, 1 Lake Regulations
//   2) The regulations     — undocumented but public JSON API:
//      GET https://geospatial.alberta.ca/services/Fisheries/Regulation?waterbodyId=<WB_ID>
//
// ⚠️  The regulation API (2) has no public licence — it is the app's internal backend.
//     Get written permission from the province (PGC.Metadata@gov.ab.ca) before production.
//     This script hits the server politely (bounded concurrency + retries).
//
// Requirements: Node 18+ (uses the built-in global fetch). No dependencies.
//
// Usage:
//   node scripts/fetch-regulations.mjs                 # named waterbodies (~4k, ~1 min)
//   node scripts/fetch-regulations.mjs --all           # ALL ~145k (incl. UNNAMED, slow)
//   node scripts/fetch-regulations.mjs --limit 25      # quick test
//   node scripts/fetch-regulations.mjs --geometry      # + save geometry as GeoJSON (rivers heavy)
//   node scripts/fetch-regulations.mjs --layers 1      # lakes only (0 = rivers)
//   node scripts/fetch-regulations.mjs --concurrency 6 # concurrency (default 8)
//
// By default only NAMED waterbodies are fetched: of 144,872 objects ~140k are "UNNAMED"
// (small unnamed creeks/ponds). Anglers search named lakes/rivers (~4k); the unnamed ones
// still have regulations and can be pulled with --all. This is gentle on the government server.

import { mkdir, writeFile, readFile, appendFile } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------- Configuration ----------
const ARCGIS_BASE =
  'https://geospatial.alberta.ca/titan/rest/services/fisheries/fisheries_regulations/MapServer';
const REG_API = 'https://geospatial.alberta.ca/services/Fisheries/Regulation';

const LAYER_NAMES = { 0: 'River Regulations', 1: 'Lake Regulations' };
// Desired fields. Layers differ (e.g. rivers lack WB_SEC_ID/FEATURE_TYPE), so we only
// request fields that actually exist in the layer's metadata (see getLayerFields).
const WANTED_FIELDS = ['WB_ID', 'WB_SEC_ID', 'FMZ', 'FEATURE_TYPE', 'Official_Name', 'Common_Name'];

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');

// ---------- Argument parsing ----------
function parseArgs(argv) {
  // simplify = maxAllowableOffset in degrees (~111 km/degree). 0.0001 ≈ 11 m — map-accurate
  // but ~5x lighter than full geometry. --full-geometry = no simplification (heavy).
  const opts = {
    limit: 0,
    geometry: false,
    layers: [0, 1],
    concurrency: 8,
    namedOnly: true,
    simplify: 0.0001,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--geometry') opts.geometry = true;
    else if (a === '--all') opts.namedOnly = false;
    else if (a === '--full-geometry') opts.simplify = 0;
    else if (a === '--simplify') opts.simplify = parseFloat(argv[++i]) || 0;
    else if (a === '--limit') opts.limit = parseInt(argv[++i], 10) || 0;
    else if (a === '--concurrency') opts.concurrency = parseInt(argv[++i], 10) || 8;
    else if (a === '--layers') opts.layers = argv[++i].split(',').map((x) => parseInt(x, 10));
  }
  return opts;
}

// ---------- Utilities ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(url, { method = 'GET', headers = {}, retries = 4, timeoutMs = 45000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method, headers, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      // ArcGIS returns errors in the body with HTTP 200 — catch those separately.
      if (data && data.error) throw new Error(`ArcGIS error: ${JSON.stringify(data.error)}`);
      return data;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (attempt < retries) await sleep(600 * 2 ** attempt); // exponential backoff
    }
  }
  throw lastErr;
}

// Simple bounded-concurrency pool.
async function pool(items, worker, concurrency) {
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i], i);
    }
  });
  await Promise.all(runners);
}

// ---------- Step 1: waterbody list from ArcGIS ----------
// Server-side "named only" filter — so we don't pull geometry for 140k unnamed objects.
// Covers both Official_Name and Common_Name.
const NAMED_WHERE =
  "(Official_Name IS NOT NULL AND UPPER(Official_Name) <> 'UNNAMED') OR " +
  "(Common_Name IS NOT NULL AND UPPER(Common_Name) <> 'UNNAMED')";

async function getLayerCount(layerId, where = '1=1') {
  const params = new URLSearchParams({ where, returnCountOnly: 'true', f: 'json' });
  const data = await httpJson(`${ARCGIS_BASE}/${layerId}/query?${params}`);
  return data.count ?? 0;
}

// The layer's actual field list (rivers and lakes differ) — intersect with the desired fields.
async function getLayerFields(layerId) {
  const meta = await httpJson(`${ARCGIS_BASE}/${layerId}?f=json`);
  const have = new Set((meta.fields ?? []).map((f) => f.name));
  return WANTED_FIELDS.filter((f) => have.has(f));
}

async function fetchLayerFeatures(layerId, { geometry, where = '1=1', simplify = 0 }) {
  const pageSize = 2000; // = the service's maxRecordCount
  const outFields = (await getLayerFields(layerId)).join(',');
  const features = [];
  let offset = 0;
  for (;;) {
    const params = new URLSearchParams({
      where,
      outFields,
      returnGeometry: String(geometry),
      orderByFields: 'OBJECTID',
      resultOffset: String(offset),
      resultRecordCount: String(pageSize),
      f: geometry ? 'geojson' : 'json',
    });
    if (geometry) {
      params.set('outSR', '4326'); // WGS84 for maps/GPS
      if (simplify > 0) params.set('maxAllowableOffset', String(simplify)); // server-side simplify
    }
    const url = `${ARCGIS_BASE}/${layerId}/query?${params}`;
    const data = await httpJson(url);

    // f=json -> features[].attributes ; f=geojson -> features[].properties/geometry
    const batch = data.features ?? [];
    if (batch.length === 0) break;

    for (const f of batch) {
      features.push({
        layerId,
        layerName: LAYER_NAMES[layerId] ?? String(layerId),
        attrs: geometry ? f.properties : f.attributes,
        geometry: geometry ? f.geometry : undefined,
      });
    }
    process.stdout.write(`  [layer ${layerId} ${LAYER_NAMES[layerId]}] fetched ${features.length}\r`);

    const exceeded = data.exceededTransferLimit || data.properties?.exceededTransferLimit;
    if (batch.length < pageSize && !exceeded) break;
    offset += pageSize;
  }
  process.stdout.write('\n');
  return features;
}

// ---------- Step 2: regulations per WB_ID ----------
// Some waterbodies return HTTP 204 (No Content) — they have no separate regulation record
// (the general zone rules apply). This is NOT an error: return [].
async function fetchRegulation(wbId) {
  const url = `${REG_API}?waterbodyId=${wbId}`;
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  let lastErr;
  for (let attempt = 0; attempt <= 4; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 45000);
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal });
      clearTimeout(t);
      if (res.status === 204) return { empty: true, data: [] };
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (!text.trim()) return { empty: true, data: [] }; // empty body = no specific rules
      return { empty: false, data: JSON.parse(text) };
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (attempt < 4) await sleep(600 * 2 ** attempt);
    }
  }
  throw lastErr;
}

// Read already-fetched WB_IDs from the NDJSON (for resuming).
async function loadDoneIds(ndjsonPath) {
  const done = new Set();
  if (!existsSync(ndjsonPath)) return done;
  const rl = createInterface({ input: createReadStream(ndjsonPath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      done.add(JSON.parse(line).wbId);
    } catch {
      /* skip broken lines */
    }
  }
  return done;
}

// ---------- Output ----------
function toCsvRow(vals) {
  return vals
    .map((v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}

async function writeOutputs(waterbodies, ndjsonPath, opts) {
  // 1) Waterbody metadata (without geometry)
  await writeFile(
    path.join(DATA_DIR, 'waterbodies.json'),
    JSON.stringify(waterbodies.map((w) => ({ ...w, geometry: undefined })), null, 2),
  );
  // Geometry — split by layer (lake polygons and river lines), so files stay compact and
  // handy for the app (lakes are needed for point-in-polygon).
  const geoFiles = {};
  if (opts.geometry) {
    const OUT = { 0: 'rivers.geojson', 1: 'lakes.geojson' };
    const byLayer = new Map();
    for (const w of waterbodies) {
      if (!w.geometry) continue;
      if (!byLayer.has(w.layerId)) byLayer.set(w.layerId, []);
      byLayer.get(w.layerId).push({ type: 'Feature', properties: w.attrs, geometry: w.geometry });
    }
    for (const [layerId, feats] of byLayer) {
      const name = OUT[layerId] ?? `layer${layerId}.geojson`;
      await writeFile(
        path.join(DATA_DIR, name),
        JSON.stringify({ type: 'FeatureCollection', features: feats }),
      );
      geoFiles[name] = feats.length;
    }
  }

  // 2) Merge regulations from the NDJSON into one JSON + a flat CSV.
  const combined = [];
  const csvRows = [
    toCsvRow([
      'WB_ID',
      'waterbody',
      'section',
      'geoAdminName',
      'species',
      'season',
      'seasonStatus',
      'bagLimit',
      'sizeLimitMin',
      'sizeLimitMax',
      'baitType',
      'catchRules',
      'comments',
    ]),
  ];
  const speciesSet = new Set();
  let regCount = 0;
  let emptyWaterbodies = 0;

  const rl = createInterface({ input: createReadStream(ndjsonPath), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.error || !Array.isArray(rec.data)) continue;
    if (rec.data.length === 0) emptyWaterbodies++; // 204 / no specific rules
    for (const section of rec.data) {
      combined.push(section);
      for (const reg of section.regulations ?? []) {
        regCount++;
        if (reg.species) speciesSet.add(reg.species);
        csvRows.push(
          toCsvRow([
            section.waterBodyId,
            section.waterBodyOfficialName,
            section.waterBodySectionId,
            section.geoAdminName,
            reg.species,
            reg.season,
            reg.seasonStatus,
            reg.bagLimit,
            reg.sizeLimitMin,
            reg.sizeLimitMax,
            reg.baitType,
            reg.catchRules,
            reg.comments,
          ]),
        );
      }
    }
  }

  await writeFile(path.join(DATA_DIR, 'regulations.json'), JSON.stringify(combined, null, 2));
  await writeFile(path.join(DATA_DIR, 'regulations-flat.csv'), csvRows.join('\n'));

  return {
    sections: combined.length,
    regCount,
    emptyWaterbodies,
    geoFiles,
    species: [...speciesSet].sort(),
  };
}

// ---------- main ----------
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  await mkdir(DATA_DIR, { recursive: true });
  const ndjsonPath = path.join(DATA_DIR, 'regulations.ndjson');
  const errorsPath = path.join(DATA_DIR, 'errors.log');

  console.log('=== Fishing App — Alberta regulations download ===');
  console.log(`Layers: ${opts.layers.join(', ')} | concurrency: ${opts.concurrency}` +
    `${opts.limit ? ` | limit: ${opts.limit}` : ''}${opts.geometry ? ' | + geometry' : ''}\n`);

  // Step 1: waterbody list. In named-only mode we filter server-side (otherwise geometry
  // for 140k unnamed objects would bloat the GeoJSON to hundreds of MB).
  const where = opts.namedOnly ? NAMED_WHERE : '1=1';
  console.log('Step 1/2 — waterbody list from ArcGIS...');
  let waterbodies = [];
  for (const layerId of opts.layers) {
    const cnt = await getLayerCount(layerId, where).catch(() => '?');
    console.log(`  layer ${layerId} (${LAYER_NAMES[layerId]}): ${cnt} objects${opts.namedOnly ? ' (named)' : ''}`);
    const feats = await fetchLayerFeatures(layerId, {
      geometry: opts.geometry,
      where,
      simplify: opts.simplify,
    });
    waterbodies.push(...feats);
  }

  // Deduplicate by WB_ID (one waterbody can appear across layers/sections).
  const byId = new Map();
  for (const w of waterbodies) {
    const id = w.attrs.WB_ID;
    if (id != null && !byId.has(id)) byId.set(id, w);
  }
  let uniqueIds = [...byId.keys()];
  console.log(`\nTotal objects: ${waterbodies.length} | unique WB_ID: ${uniqueIds.length}`);
  waterbodies = [...byId.values()];

  // Named-waterbody filter (default): named if a real name exists in EITHER field.
  // Note: Official_Name may be "UNNAMED" while Common_Name is real, so check fields
  // independently (otherwise we lose ~1k waterbodies). Matches NAMED_WHERE.
  const isNamed = (id) => {
    const a = byId.get(id).attrs;
    const norm = (s) => (s || '').trim().toUpperCase();
    const off = norm(a.Official_Name);
    const com = norm(a.Common_Name);
    return (off && off !== 'UNNAMED') || (com && com !== 'UNNAMED');
  };
  if (opts.namedOnly) {
    const before = uniqueIds.length;
    uniqueIds = uniqueIds.filter(isNamed);
    console.log(
      `Mode: named only — ${uniqueIds.length} (unnamed filtered out: ${before - uniqueIds.length}). ` +
        `For a full pull: --all`,
    );
  } else {
    console.log('Mode: ALL waterbodies (--all), including UNNAMED');
  }

  if (opts.limit) uniqueIds = uniqueIds.slice(0, opts.limit);

  // Step 2: regulations per WB_ID (resumable)
  const done = await loadDoneIds(ndjsonPath);
  const todo = uniqueIds.filter((id) => !done.has(id));
  console.log(
    `\nStep 2/2 — regulations per waterbody: to fetch ${todo.length}` +
      `${done.size ? ` (already fetched, skipped: ${done.size})` : ''}\n`,
  );

  let ok = 0;
  let fail = 0;
  let emptyCount = 0;
  const started = Date.now();
  await pool(
    todo,
    async (wbId) => {
      try {
        const { data, empty } = await fetchRegulation(wbId);
        await appendFile(ndjsonPath, JSON.stringify({ wbId, data }) + '\n');
        if (empty) emptyCount++;
        ok++;
      } catch (e) {
        fail++;
        await appendFile(errorsPath, `${new Date().toISOString()}\tWB_ID ${wbId}\t${e.message}\n`);
      }
      const total = ok + fail;
      if (total % 25 === 0 || total === todo.length) {
        const rate = total / ((Date.now() - started) / 1000);
        process.stdout.write(
          `  progress ${total}/${todo.length}  ok=${ok} fail=${fail}  ~${rate.toFixed(1)}/s\r`,
        );
      }
    },
    opts.concurrency,
  );
  process.stdout.write('\n');

  // Build the output files
  console.log('\nBuilding output files...');
  const stats = await writeOutputs(waterbodies, ndjsonPath, opts);

  const summary = {
    generatedAt: new Date().toISOString(),
    source: { arcgis: ARCGIS_BASE, regulationApi: REG_API },
    licenseNote:
      'Geodata — Open Government Licence – Alberta (attribution required). ' +
      'The regulation API has no public licence — provincial permission required before production.',
    layers: opts.layers,
    totals: {
      uniqueWaterbodies: uniqueIds.length,
      fetchedOk: ok + done.size,
      failed: fail,
      waterbodiesWithoutSpecificRegs: stats.emptyWaterbodies,
      sections: stats.sections,
      regulationRows: stats.regCount,
      distinctSpecies: stats.species.length,
    },
    species: stats.species,
  };
  await writeFile(path.join(DATA_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log('\n=== Done ===');
  console.log(`Unique waterbodies:    ${summary.totals.uniqueWaterbodies}`);
  console.log(`Fetched OK:            ${summary.totals.fetchedOk}`);
  console.log(`Errors:               ${summary.totals.failed}${fail ? '  (see data/errors.log)' : ''}`);
  console.log(`No specific rules (204): ${summary.totals.waterbodiesWithoutSpecificRegs}`);
  console.log(`Regulation sections:   ${summary.totals.sections}`);
  console.log(`Regulation rows:       ${summary.totals.regulationRows}`);
  console.log(`Distinct species:      ${summary.totals.distinctSpecies}  ->  ${stats.species.join(', ')}`);
  console.log(`\nFiles in ${DATA_DIR}:`);
  console.log('  waterbodies.json        — waterbody metadata (WB_ID, name, FMZ, type)');
  for (const [name, n] of Object.entries(stats.geoFiles))
    console.log(`  ${name.padEnd(23)} — geometry WGS84 (${n} objects, simplify ${opts.simplify || 'none'})`);
  console.log('  regulations.ndjson      — raw API responses (for resuming)');
  console.log('  regulations.json        — merged regulations by section');
  console.log('  regulations-flat.csv    — flat table (open in Excel)');
  console.log('  summary.json            — run statistics');
}

main().catch((e) => {
  console.error('\nFATAL ERROR:', e);
  process.exit(1);
});
