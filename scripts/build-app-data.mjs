#!/usr/bin/env node
// Builds the compact PWA dataset from the raw files in ../data/ into ../app/data/.
// The raw files are large and redundant; the app needs:
//   1) search-index.json      — lightweight index for name search (all waterbodies)
//   2) regulations-by-id.json — regulations grouped by WB_ID (compact keys)
//   3) lakes.geojson          — lake geometry for GPS "which waterbody am I in" (copy)
//   4) meta.json              — data version, attribution, statistics
//
// Run: node scripts/build-app-data.mjs

import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(__dirname, '..', 'data');
const OUT = path.resolve(__dirname, '..', 'app', 'data');

const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));

async function main() {
  await mkdir(OUT, { recursive: true });

  const waterbodies = await readJson(path.join(DATA, 'waterbodies.json'));
  const sections = await readJson(path.join(DATA, 'regulations.json'));

  // --- Waterbody coordinates (for map markers) from geometry ---
  // Lakes — centroid of the outer ring; rivers — middle vertex of the line. Rounded to 5 decimals.
  const coords = new Map(); // WB_ID -> [lon, lat]
  const avgRing = (ring) => {
    let sx = 0, sy = 0;
    for (const [x, y] of ring) { sx += x; sy += y; }
    return ring.length ? [+(sx / ring.length).toFixed(5), +(sy / ring.length).toFixed(5)] : null;
  };
  const midOf = (line) => {
    const p = line[Math.floor(line.length / 2)];
    return p ? [+p[0].toFixed(5), +p[1].toFixed(5)] : null;
  };
  const pointOf = (g) => {
    if (!g) return null;
    if (g.type === 'Polygon') return avgRing(g.coordinates[0]);
    if (g.type === 'MultiPolygon') return avgRing(g.coordinates[0][0]);
    if (g.type === 'LineString') return midOf(g.coordinates);
    if (g.type === 'MultiLineString') return midOf(g.coordinates[0]);
    return null;
  };
  for (const fn of ['lakes.geojson', 'rivers.geojson']) {
    let fc;
    try { fc = await readJson(path.join(DATA, fn)); } catch { continue; }
    for (const f of fc.features) {
      const p = pointOf(f.geometry);
      if (p && !coords.has(f.properties.WB_ID)) coords.set(f.properties.WB_ID, p);
    }
  }

  // --- Bathymetry: copy to app + set of lake names that have depth contours ---
  const norm = (s) => (s || '').trim().toUpperCase().replace(/\s+/g, ' ');
  const bathyLakes = new Set();
  try {
    const bathy = await readJson(path.join(DATA, 'bathymetry.geojson'));
    for (const f of bathy.features) if (f.properties.ln) bathyLakes.add(norm(f.properties.ln));
    await copyFile(path.join(DATA, 'bathymetry.geojson'), path.join(OUT, 'bathymetry.geojson'));
  } catch {
    /* bathymetry optional */
  }

  // --- 2) Regulations by WB_ID (compact keys) ---
  // A single WB_ID may have several sections — merge all their regulations.
  const regsById = {};
  for (const s of sections) {
    const id = s.waterBodyId;
    if (!regsById[id]) regsById[id] = { ga: s.geoAdminName || null, r: [] };
    for (const reg of s.regulations ?? []) {
      regsById[id].r.push({
        sp: reg.species, // species
        se: reg.season, // season text
        ss: reg.seasonStatus, // OPEN/CLOSED
        bl: reg.bagLimit, // bag limit
        lo: reg.sizeLimitMin, // min size, cm
        hi: reg.sizeLimitMax, // max size, cm
        bt: reg.baitType, // bait
        cr: reg.catchRules, // human-readable rule
        cm: reg.comments || undefined,
      });
    }
  }

  // --- 1) Search index ---
  // l: 1=lake, 0=river ; co: [lon, lat] for the map
  const index = [];
  for (const w of waterbodies) {
    const a = w.attrs;
    const name = (a.Official_Name || '').trim();
    const common = (a.Common_Name || '').trim();
    const display = name && name.toUpperCase() !== 'UNNAMED' ? name : common;
    if (!display) continue;
    index.push({
      id: a.WB_ID,
      nm: display,
      cn: common && common !== display ? common : undefined,
      fmz: a.FMZ,
      l: w.layerId, // 0 river / 1 lake
      hr: regsById[a.WB_ID] ? 1 : 0, // has regulations
      co: coords.get(a.WB_ID) || undefined, // [lon, lat] for the map
      bt: bathyLakes.has(norm(display)) ? 1 : undefined, // has depth map (bathymetry)
    });
  }
  // Sort by name for stable output.
  index.sort((x, y) => x.nm.localeCompare(y.nm));

  // --- 3) Lake geometry (copy) + simplified river geometry (for the map) ---
  await copyFile(path.join(DATA, 'lakes.geojson'), path.join(OUT, 'lakes.geojson'));

  // Rivers are ~25 MB at full detail — too heavy to ship. Decimate points by distance
  // (keep a vertex only if it's far enough from the last kept one). Good enough for display.
  const MIN_DEG = 0.0015; // ~150 m between kept vertices (map-scale detail)
  const decimate = (line) => {
    if (line.length <= 2) return line;
    const out = [line[0]];
    let last = line[0];
    for (let i = 1; i < line.length - 1; i++) {
      const dx = line[i][0] - last[0], dy = line[i][1] - last[1];
      if (dx * dx + dy * dy >= MIN_DEG * MIN_DEG) { out.push(line[i]); last = line[i]; }
    }
    out.push(line[line.length - 1]);
    return out;
  };
  const simplifyGeom = (g) => {
    if (g.type === 'LineString') return { type: 'LineString', coordinates: decimate(g.coordinates) };
    if (g.type === 'MultiLineString')
      return { type: 'MultiLineString', coordinates: g.coordinates.map(decimate) };
    return g;
  };
  try {
    const rivers = await readJson(path.join(DATA, 'rivers.geojson'));
    const feats = rivers.features.map((f) => ({
      type: 'Feature',
      properties: { nm: (f.properties.Official_Name || f.properties.Common_Name || '').trim() },
      geometry: simplifyGeom(f.geometry),
    }));
    await writeFile(
      path.join(OUT, 'rivers.geojson'),
      JSON.stringify({ type: 'FeatureCollection', features: feats }),
    );
  } catch {
    /* rivers optional — the map still works with lakes only */
  }

  // --- 4) Meta ---
  const speciesSet = new Set();
  for (const id in regsById) for (const r of regsById[id].r) if (r.sp) speciesSet.add(r.sp);
  const meta = {
    builtAt: new Date().toISOString().slice(0, 10),
    source: 'Alberta Fish and Wildlife — Sportfishing Regulations (geospatial.alberta.ca)',
    attribution: 'Contains information licensed under the Open Government Licence – Alberta',
    disclaimer:
      'For reference only. The official source is the Alberta Guide to Sportfishing Regulations / My Wild Alberta. ' +
      'Regulations change; always confirm with the official source before you go.',
    stats: {
      waterbodies: index.length,
      withRegulations: index.filter((x) => x.hr).length,
      withCoords: index.filter((x) => x.co).length,
      withBathymetry: index.filter((x) => x.bt).length,
      lakes: index.filter((x) => x.l === 1).length,
      rivers: index.filter((x) => x.l === 0).length,
      species: [...speciesSet].sort(),
    },
  };

  await writeFile(path.join(OUT, 'search-index.json'), JSON.stringify(index));
  await writeFile(path.join(OUT, 'regulations-by-id.json'), JSON.stringify(regsById));
  await writeFile(path.join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));

  const kb = (o) => (Buffer.byteLength(JSON.stringify(o)) / 1024).toFixed(0);
  console.log('=== App data built into app/data/ ===');
  console.log(`search-index.json       ${index.length} entries  (${kb(index)} KB)`);
  console.log(`regulations-by-id.json  ${Object.keys(regsById).length} waterbodies  (${kb(regsById)} KB)`);
  console.log(`lakes.geojson           copied`);
  console.log(`meta.json               ${meta.stats.species.length} species`);
  console.log(`\nLakes: ${meta.stats.lakes} | Rivers: ${meta.stats.rivers} | With regulations: ${meta.stats.withRegulations}`);
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
