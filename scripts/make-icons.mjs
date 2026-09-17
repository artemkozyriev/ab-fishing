#!/usr/bin/env node
// Generates PNG icons for the PWA from the SVG source (for installability on Android/iOS).
// Renderer: @resvg/resvg-js (dev dependency). Run: node scripts/make-icons.mjs
import { Resvg } from '@resvg/resvg-js';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ICONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app', 'icons');

// Fish artwork (shared with icon.svg). Maskable/apple variants are full-bleed (no rounded
// corners, opaque) with the fish scaled into the safe zone, so platform masking looks right.
const FISH = `
  <g transform="translate(256 256) scale(0.72) translate(-256 -256)"
     fill="none" stroke="#f4a825" stroke-width="20" stroke-linecap="round" stroke-linejoin="round">
    <path d="M150 256c40-70 150-110 230-70 0 0-30 70-30 70s30 70 30 70c-80 40-190 0-230-70z" fill="#11543f"/>
    <path d="M150 256c-30-20-60-30-90-30 20 30 20 30 20 30s0 0-20 30c30 0 60-10 90-30z" fill="#11543f"/>
    <circle cx="330" cy="238" r="10" fill="#f4a825" stroke="none"/>
  </g>`;
const fullBleedSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <rect width="512" height="512" fill="#0b3d2e"/>${FISH}</svg>`;

async function render(svg, size, outName) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  await writeFile(path.join(ICONS, outName), png);
  console.log(`  ${outName} (${size}×${size}, ${(png.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  const base = await readFile(path.join(ICONS, 'icon.svg'), 'utf8'); // rounded, with transparency
  console.log('Generating icons in app/icons/ ...');
  await render(base, 192, 'icon-192.png'); // any
  await render(base, 512, 'icon-512.png'); // any
  await render(fullBleedSvg, 512, 'icon-maskable-512.png'); // maskable (full-bleed + safe zone)
  await render(fullBleedSvg, 180, 'apple-touch-icon-180.png'); // iOS (opaque, full-bleed)
  console.log('Done.');
}

main().catch((e) => {
  console.error('ERROR:', e);
  process.exit(1);
});
