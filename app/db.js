// Data layer + geo utilities. Fully offline: data sits alongside the app and is cached
// by the service worker. Exposes the global DB object.
(function () {
  'use strict';

  let index = []; // [{id, nm, cn, fmz, l, hr, co}]
  let byId = new Map(); // id -> index entry
  let regs = {}; // id -> {ga, r:[...]}
  let meta = null;
  let lakes = null; // FeatureCollection (lazy-loaded for GPS)
  let lakeCentroids = null; // [{id, lat, lon, feat}]
  let rivers = null; // FeatureCollection (lazy-loaded for the map)
  let bathymetry = null; // depth contours FeatureCollection (lazy-loaded for the map)

  async function getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);
    return res.json();
  }

  async function load() {
    const [idx, r, m] = await Promise.all([
      getJson('data/search-index.json'),
      getJson('data/regulations-by-id.json'),
      getJson('data/meta.json'),
    ]);
    index = idx;
    regs = r;
    meta = m;
    byId = new Map(index.map((w) => [w.id, w]));
    return meta;
  }

  // Name search: word-start matches first, then substring matches.
  function search(query, limit = 40) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const starts = [];
    const contains = [];
    for (const w of index) {
      const nm = w.nm.toLowerCase();
      const pos = nm.indexOf(q);
      if (pos === 0 || nm.startsWith(q + ' ')) starts.push(w);
      else if (pos > 0) contains.push(w);
      if (starts.length >= limit) break;
    }
    return starts.concat(contains).slice(0, limit);
  }

  const getRegs = (id) => regs[id] || null;
  const getWaterbody = (id) => byId.get(id) || null;
  const getMeta = () => meta;
  const allWaterbodies = () => index;

  // Waterbodies where the species occurs. onlyKeepable = only where some season has bag limit > 0.
  function filterBySpecies(species, onlyKeepable) {
    if (!species) return index;
    const out = [];
    for (const w of index) {
      const r = regs[w.id];
      if (!r) continue;
      const hit = r.r.some((x) => x.sp === species && (!onlyKeepable || x.bl > 0));
      if (hit) out.push(w);
    }
    return out;
  }

  // ---------- Geo ----------
  function pointInRing(lon, lat, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0],
        yi = ring[i][1];
      const xj = ring[j][0],
        yj = ring[j][1];
      const intersect =
        yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  // polygon = [outerRing, hole1, hole2, ...]
  function pointInPolygon(lon, lat, polygon) {
    if (!pointInRing(lon, lat, polygon[0])) return false;
    for (let k = 1; k < polygon.length; k++) {
      if (pointInRing(lon, lat, polygon[k])) return false; // inside a hole
    }
    return true;
  }

  function pointInGeometry(lon, lat, geom) {
    if (geom.type === 'Polygon') return pointInPolygon(lon, lat, geom.coordinates);
    if (geom.type === 'MultiPolygon')
      return geom.coordinates.some((poly) => pointInPolygon(lon, lat, poly));
    return false;
  }

  function firstRing(geom) {
    if (geom.type === 'Polygon') return geom.coordinates[0];
    if (geom.type === 'MultiPolygon') return geom.coordinates[0][0];
    return [];
  }

  function centroidOf(geom) {
    const ring = firstRing(geom);
    let sx = 0,
      sy = 0;
    for (const [x, y] of ring) {
      sx += x;
      sy += y;
    }
    return ring.length ? [sx / ring.length, sy / ring.length] : [0, 0];
  }

  function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  async function loadLakes() {
    if (lakes) return lakes;
    lakes = await getJson('data/lakes.geojson');
    lakeCentroids = lakes.features.map((f) => {
      const [lon, lat] = centroidOf(f.geometry);
      return { id: f.properties.WB_ID, feat: f, lat, lon };
    });
    return lakes;
  }

  async function loadRivers() {
    if (rivers) return rivers;
    rivers = await getJson('data/rivers.geojson');
    return rivers;
  }

  async function loadBathymetry() {
    if (bathymetry) return bathymetry;
    bathymetry = await getJson('data/bathymetry.geojson');
    return bathymetry;
  }

  // Returns {containing:[...], nearest:[...]} with distances (km).
  async function findNearby(lat, lon, nNearest = 12) {
    await loadLakes();
    const containing = [];
    for (const f of lakes.features) {
      if (pointInGeometry(lon, lat, f.geometry)) {
        const w = getWaterbody(f.properties.WB_ID);
        if (w) containing.push({ ...w, dist: 0 });
      }
    }
    const nearest = lakeCentroids
      .map((c) => ({ id: c.id, dist: haversineKm(lat, lon, c.lat, c.lon) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, nNearest)
      .map((c) => ({ ...getWaterbody(c.id), dist: c.dist }))
      .filter((w) => w.id != null);
    return { containing, nearest };
  }

  window.DB = {
    load,
    search,
    getRegs,
    getWaterbody,
    getMeta,
    findNearby,
    allWaterbodies,
    filterBySpecies,
    loadLakes, // lake geometry (FeatureCollection), lazy-loaded — reused by the offline map layer
    loadRivers, // simplified river geometry for the map, lazy-loaded
    loadBathymetry, // lake depth contours for the map, lazy-loaded
  };
})();
