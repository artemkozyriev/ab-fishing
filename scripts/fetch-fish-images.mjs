// Fetch a training dataset for the fish-ID model from iNaturalist.
//
// Downloads Creative-Commons-licensed research-grade photos for each of the 19 Alberta species
// into data/fish-images/<LABEL>/, plus a CREDITS.csv with per-photo attribution/licence.
// This folder is the input to scripts/train_fish_model.py.
//
// Usage:
//   node scripts/fetch-fish-images.mjs                 # ~200 photos/species
//   node scripts/fetch-fish-images.mjs --per 400       # more photos (slower)
//   node scripts/fetch-fish-images.mjs --only WALLEYE  # one species
//
// Notes
// - Only CC0/CC-BY/CC-BY-NC/CC-BY-SA photos are downloaded; "all rights reserved" is skipped.
//   Check each licence before any commercial use — CREDITS.csv records them.
// - iNaturalist asks API clients to be gentle: this throttles requests and pages politely.
// - Labels/folder names match data/meta.json species strings exactly, so the trained model's
//   classes line up with the app's species filter.

import { mkdir, writeFile, appendFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const OUT_DIR = path.resolve('data/fish-images');
const API = 'https://api.inaturalist.org/v1/observations';
const OK_LICENSES = new Set(['cc0', 'cc-by', 'cc-by-nc', 'cc-by-sa', 'cc-by-nc-sa', 'cc-by-nd', 'cc-by-nc-nd']);

// Label (== meta.json species) → iNaturalist taxon. Prefer scientific name (precise);
// tiger trout is a hybrid with no single taxon, so it falls back to a text query.
const SPECIES = [
  { label: 'ARCTIC GRAYLING', taxon: 'Thymallus arcticus' },
  { label: 'BROOK TROUT', taxon: 'Salvelinus fontinalis' },
  { label: 'BROWN TROUT', taxon: 'Salmo trutta' },
  { label: 'BULL TROUT', taxon: 'Salvelinus confluentus' },
  { label: 'BURBOT', taxon: 'Lota lota' },
  { label: 'CUTTHROAT TROUT', taxon: 'Oncorhynchus clarkii' },
  { label: 'DOLLY VARDEN', taxon: 'Salvelinus malma' },
  { label: 'GOLDEYE', taxon: 'Hiodon alosoides' },
  { label: 'LAKE STURGEON', taxon: 'Acipenser fulvescens' },
  { label: 'LAKE TROUT', taxon: 'Salvelinus namaycush' },
  { label: 'LAKE WHITEFISH', taxon: 'Coregonus clupeaformis' },
  { label: 'MOUNTAIN WHITEFISH', taxon: 'Prosopium williamsoni' },
  { label: 'NORTHERN PIKE', taxon: 'Esox lucius' },
  { label: 'RAINBOW TROUT', taxon: 'Oncorhynchus mykiss' },
  { label: 'SAUGER', taxon: 'Sander canadensis' },
  { label: 'TIGER TROUT', q: 'tiger trout' }, // hybrid — no single taxon
  { label: 'TULLIBEE (CISCO)', taxon: 'Coregonus artedi' },
  { label: 'WALLEYE', taxon: 'Sander vitreus' },
  { label: 'YELLOW PERCH', taxon: 'Perca flavescens' },
];

const args = process.argv.slice(2);
const getArg = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const PER = parseInt(getArg('--per', '200'), 10);
const ONLY = getArg('--only', null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Fetch one page of research-grade, licensed observations with photos.
async function fetchPage(spec, page) {
  const params = new URLSearchParams({
    quality_grade: 'research',
    photos: 'true',
    photo_license: 'cc0,cc-by,cc-by-nc,cc-by-sa,cc-by-nc-sa',
    per_page: '30',
    page: String(page),
    order_by: 'votes',
  });
  if (spec.taxon) params.set('taxon_name', spec.taxon);
  if (spec.q) params.set('q', spec.q);
  const res = await fetch(`${API}?${params}`, { headers: { 'User-Agent': 'ab-fishing/1.0 (dataset builder)' } });
  if (!res.ok) throw new Error(`iNaturalist ${res.status}`);
  return res.json();
}

// iNaturalist photo URLs are the "square" thumbnail; swap to a larger size for training.
const bigUrl = (u) => u.replace('/square.', '/medium.');

async function downloadSpecies(spec) {
  const dir = path.join(OUT_DIR, spec.label);
  await mkdir(dir, { recursive: true });
  const existing = existsSync(dir) ? (await readdir(dir)).filter((f) => f.endsWith('.jpg')).length : 0;
  let saved = existing;
  let page = 1;
  process.stdout.write(`\n${spec.label}: `);

  while (saved < PER && page <= 20) {
    let data;
    try {
      data = await fetchPage(spec, page);
    } catch (e) {
      process.stdout.write(`[api err: ${e.message}] `);
      break;
    }
    if (!data.results || !data.results.length) break;

    for (const obs of data.results) {
      if (saved >= PER) break;
      const photo = (obs.photos || [])[0];
      if (!photo || !photo.url) continue;
      const lic = (photo.license_code || '').toLowerCase();
      if (!OK_LICENSES.has(lic)) continue;
      const url = bigUrl(photo.url);
      try {
        const r = await fetch(url);
        if (!r.ok) continue;
        const buf = Buffer.from(await r.arrayBuffer());
        const file = `${obs.id}_${photo.id}.jpg`;
        await writeFile(path.join(dir, file), buf);
        const attribution = (photo.attribution || '').replace(/"/g, "'");
        await appendFile(
          path.join(OUT_DIR, 'CREDITS.csv'),
          `"${spec.label}","${file}","${lic}","${attribution}","https://www.inaturalist.org/observations/${obs.id}"\n`,
        );
        saved++;
        if (saved % 10 === 0) process.stdout.write(`${saved} `);
      } catch {
        /* skip a bad image */
      }
      await sleep(250); // be gentle with the photo CDN
    }
    page++;
    await sleep(800); // be gentle with the API
  }
  process.stdout.write(`→ ${saved} images`);
  return saved;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  if (!existsSync(path.join(OUT_DIR, 'CREDITS.csv'))) {
    await writeFile(path.join(OUT_DIR, 'CREDITS.csv'), 'label,file,license,attribution,source\n');
  }
  const list = ONLY ? SPECIES.filter((s) => s.label === ONLY) : SPECIES;
  if (!list.length) {
    console.error(`No species matches --only "${ONLY}". Valid: ${SPECIES.map((s) => s.label).join(', ')}`);
    process.exit(1);
  }
  console.log(`Fetching up to ${PER} images/species into ${OUT_DIR}`);
  const counts = {};
  for (const spec of list) counts[spec.label] = await downloadSpecies(spec);

  console.log('\n\nDone. Per-species counts:');
  for (const [k, v] of Object.entries(counts)) console.log(`  ${k.padEnd(20)} ${v}${v < 50 ? '  ⚠ low — model will struggle on this class' : ''}`);
  console.log('\nNext: python scripts/train_fish_model.py');
  console.log('Review data/fish-images/CREDITS.csv for photo licences/attribution before shipping.');
}

main().catch((e) => {
  console.error('\nFailed:', e);
  process.exit(1);
});
