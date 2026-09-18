#!/usr/bin/env node
// Downloads Alberta lake depth contours (bathymetry) as simplified GeoJSON.
//
// Source: Alberta Geological Survey (AER/AGS) public ArcGIS FeatureServer.
//   https://services2.arcgis.com/jQV6VMr2Loovu7GU/arcgis/rest/services/Alberta_Lake_Bathymetry/FeatureServer/0
//   Polylines = isobaths. Field CALC_DEP_M = depth below surface (m). LAKE_NAME = lake.
//   Licence: Open Government Licence – Alberta (attribution to AER/AGS required).
//
// Full-detail geometry is ~74 MB, so we request server-side simplification
// (maxAllowableOffset) + coordinate rounding (geometryPrecision) → ~1.5 MB.
//
// Run: node scripts/fetch-bathymetry.mjs

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAYER =
  'https://services2.arcgis.com/jQV6VMr2Loovu7GU/arcgis/rest/services/Alberta_Lake_Bathymetry/FeatureServer/0';
const OFFSET = 0.0005; // ~55 m simplification — plenty for depth contours
const PRECISION = 5; // coordinate decimals
const PAGE = 2000; // service maxRecordCount

const DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  if (j.error) throw new Error(`ArcGIS error: ${JSON.stringify(j.error)}`);
  return j;
}

async function main() {
  await mkdir(DATA_DIR, { recursive: true });
  const count = (await getJson(`${LAYER}/query?where=1%3D1&returnCountOnly=true&f=json`)).count;
  console.log(`Lake bathymetry contours: ${count}`);

  const features = [];
  for (let offset = 0; offset < count; offset += PAGE) {
    const params = new URLSearchParams({
      where: '1=1',
      outFields: 'LAKE_NAME,CALC_DEP_M',
      outSR: '4326',
      geometryPrecision: String(PRECISION),
      maxAllowableOffset: String(OFFSET),
      resultOffset: String(offset),
      resultRecordCount: String(PAGE),
      f: 'geojson',
    });
    const data = await getJson(`${LAYER}/query?${params}`);
    for (const f of data.features ?? []) {
      // Compact props: ln = lake name, d = depth (m, rounded).
      const d = f.properties.CALC_DEP_M;
      features.push({
        type: 'Feature',
        properties: { ln: (f.properties.LAKE_NAME || '').trim(), d: d == null ? null : Math.round(d * 10) / 10 },
        geometry: f.geometry,
      });
    }
    process.stdout.write(`  fetched ${features.length}/${count}\r`);
  }
  process.stdout.write('\n');

  const fc = { type: 'FeatureCollection', features };
  const out = path.join(DATA_DIR, 'bathymetry.geojson');
  await writeFile(out, JSON.stringify(fc));
  const lakes = new Set(features.map((f) => f.properties.ln)).size;
  console.log(`Saved ${out}: ${features.length} contours across ${lakes} lakes (${(JSON.stringify(fc).length / 1048576).toFixed(2)} MB)`);
  console.log('Licence: Open Government Licence – Alberta · Source: AER/Alberta Geological Survey');
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
