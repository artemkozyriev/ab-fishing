// UI logic. Runs on top of DB (db.js) and Leaflet.
(function () {
  'use strict';

  const LIST_CAP = 300; // max number of DOM items rendered in the list

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Species names come in UPPERCASE from the data — show them title-cased.
  const speciesLabel = (sp) => sp.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

  const state = { species: '', keepable: false, tab: 'search' };
  let searchTimer = null;
  let map = null;
  let cluster = null;
  let lakesLayer = null; // offline vector basemap drawn from our own lake geometry
  let riversLayer = null; // offline vector rivers drawn from our own geometry
  let mapDirty = true; // markers need to be rebuilt
  const MAX_DL_TILES = 1500; // cap so a download stays tens of MB, not gigabytes
  const TILE_DL_CACHE = 'ab-fishing-tiles-dl-v1'; // must match sw.js

  // ---------- Navigation ----------
  function showScreen(name) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    $('screen-' + name).classList.add('active');
    if (name !== 'detail') {
      state.tab = name;
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    }
    if (name === 'map') openMap();
    else window.scrollTo(0, 0);
  }

  // ---------- Species filter ----------
  function matchesSpecies(id) {
    if (!state.species) return true;
    const r = DB.getRegs(id);
    if (!r) return false;
    return r.r.some((x) => x.sp === state.species && (!state.keepable || x.bl > 0));
  }

  function onFilterChange() {
    state.species = $('species-filter').value;
    state.keepable = $('keepable-filter').checked;
    $('keepable-filter').closest('.keepable').style.opacity = state.species ? '1' : '0.5';
    mapDirty = true;
    if (state.tab === 'map') renderMarkers();
    renderList();
  }

  // ---------- List ----------
  function currentList() {
    const q = $('search-input').value.trim();
    if (q) return DB.search(q).filter((w) => matchesSpecies(w.id));
    if (state.species) return DB.filterBySpecies(state.species, state.keepable);
    return null; // no search and no filter — show the intro
  }

  function renderList() {
    const list = currentList();
    const ul = $('result-list');
    ul.innerHTML = '';
    if (list === null) {
      const s = DB.getMeta().stats;
      $('result-info').textContent = `Database: ${s.waterbodies} waterbodies (${s.lakes} lakes, ${s.rivers} rivers), ${s.species.length} species. Type a name, pick a species, or tap "Near me".`;
      return;
    }
    const total = list.length;
    const shown = list.slice(0, LIST_CAP);
    let info = `Found: ${total}`;
    if (state.species) info += ` · ${speciesLabel(state.species)}${state.keepable ? ' · harvest allowed' : ''}`;
    if (total > LIST_CAP) info += ` · showing first ${LIST_CAP}`;
    $('result-info').textContent = info;
    renderItems(ul, shown);
  }

  function renderItems(ul, list) {
    if (!list.length) {
      ul.appendChild(el('li', 'empty', 'Nothing found'));
      return;
    }
    for (const w of list) {
      const li = el('li', 'result-item');
      li.appendChild(el('span', 'wb-icon', w.l === 1 ? '🏞️' : '🌊'));
      const main = el('div', 'wb-main');
      main.appendChild(el('div', 'wb-name', esc(w.nm)));
      const subParts = [w.l === 1 ? 'Lake' : 'River', 'zone ' + esc(w.fmz)];
      if (!w.hr) subParts.push('<span class="badge-norule">no specific rules</span>');
      main.appendChild(el('div', 'wb-sub', subParts.join(' · ')));
      li.appendChild(main);
      if (w.dist != null) li.appendChild(el('span', 'wb-dist', w.dist === 0 ? 'you are here' : w.dist.toFixed(1) + ' km'));
      else li.appendChild(el('span', 'wb-chevron', '›'));
      li.addEventListener('click', () => openDetail(w.id));
      ul.appendChild(li);
    }
  }

  function onSearch() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(renderList, 120);
  }

  // ---------- Near me ----------
  function onNearMe() {
    if (!navigator.geolocation) return toast('Geolocation is unavailable');
    toast('Getting your location…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const { containing, nearest } = await DB.findNearby(latitude, longitude);
          $('search-input').value = '';
          const keep = (arr) => (state.species ? arr.filter((w) => matchesSpecies(w.id)) : arr);
          const ul = $('result-list');
          ul.innerHTML = '';
          if (containing.length) {
            const seen = new Set(containing.map((w) => w.id));
            const rest = nearest.filter((w) => !seen.has(w.id));
            $('result-info').textContent = 'You are on:';
            renderItems(ul, keep(containing).concat(keep(rest)));
          } else {
            $('result-info').textContent = 'Nearest lakes:';
            renderItems(ul, keep(nearest));
          }
        } catch (e) {
          toast('Data error: ' + e.message);
        }
      },
      (err) => toast("Couldn't get your location: " + err.message),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  // ---------- Map ----------
  async function openMap() {
    if (!window.L) {
      $('map-info').textContent = 'The map is unavailable offline on first run (Leaflet needs the internet to load). The list and "Near me" work offline.';
      return;
    }
    if (!map) {
      map = L.map('map', { zoomControl: true, preferCanvas: true }).setView([54.5, -114.5], 5);
      // OSM tiles — shown online; the service worker also caches viewed tiles for offline use.
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '© OpenStreetMap',
      }).addTo(map);
      cluster = L.markerClusterGroup({ chunkedLoading: true, maxClusterRadius: 50 });
      map.addLayer(cluster);
    }
    // Offline vector basemap: draw lake outlines from our own geometry, so waterbodies are
    // visible even where no tiles are cached. Reuses the lakes already loaded for GPS (no extra download).
    if (!lakesLayer) {
      try {
        const fc = await DB.loadLakes();
        lakesLayer = L.geoJSON(fc, {
          renderer: L.canvas(),
          interactive: false, // don't block marker clicks
          style: { color: '#3a7bd5', weight: 0.6, fillColor: '#8fc0f0', fillOpacity: 0.45 },
        }).addTo(map);
        lakesLayer.bringToBack();
      } catch {
        /* lakes optional — map still works with tiles/markers */
      }
    }
    // River lines from our simplified geometry — also visible offline.
    if (!riversLayer) {
      try {
        const fc = await DB.loadRivers();
        riversLayer = L.geoJSON(fc, {
          renderer: L.canvas(),
          interactive: false,
          style: { color: '#5b9bd5', weight: 0.8 },
        }).addTo(map);
        riversLayer.bringToBack();
        if (lakesLayer) lakesLayer.bringToBack(); // lakes below rivers
      } catch {
        /* rivers optional */
      }
    }
    setTimeout(() => map.invalidateSize(), 50); // Leaflet must recompute size after display:none
    if (mapDirty) renderMarkers();
  }

  // ---------- Offline area download (tiles) ----------
  // Web-Mercator tile math (standard OSM/XYZ scheme).
  function lonLatToTile(lon, lat, z) {
    const n = 2 ** z;
    const x = Math.floor(((lon + 180) / 360) * n);
    const latRad = (lat * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
    return [Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y))];
  }

  // Tiles covering the current viewport from the current zoom down to +extra levels (max z16).
  function tilesForView(bounds, z0, extra = 3) {
    const z1 = Math.min(z0 + extra, 16);
    const tiles = [];
    for (let z = z0; z <= z1; z++) {
      const [xNW, yNW] = lonLatToTile(bounds.getWest(), bounds.getNorth(), z);
      const [xSE, ySE] = lonLatToTile(bounds.getEast(), bounds.getSouth(), z);
      for (let x = Math.min(xNW, xSE); x <= Math.max(xNW, xSE); x++)
        for (let y = Math.min(yNW, ySE); y <= Math.max(yNW, ySE); y++) tiles.push([z, x, y]);
    }
    return tiles;
  }

  const tileUrl = ([z, x, y]) => {
    const s = 'abc'[Math.abs(x + y) % 3]; // same subdomain rule Leaflet uses → cache keys match
    return `https://${s}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
  };

  async function downloadArea() {
    if (!map || !('caches' in window)) return toast('Offline download not supported here');
    const tiles = tilesForView(map.getBounds(), map.getZoom(), 3);
    if (tiles.length > MAX_DL_TILES) {
      return toast(`Area too large (${tiles.length} tiles). Zoom in a bit and try again.`);
    }
    const btn = $('btn-download');
    const status = $('dl-status');
    btn.disabled = true;
    status.hidden = false;

    const cache = await caches.open(TILE_DL_CACHE);
    let done = 0;
    let failed = 0;
    const render = () => (status.textContent = `Downloading ${done}/${tiles.length}…`);
    render();

    // Fetch with modest concurrency (be gentle on the public OSM tile servers).
    let idx = 0;
    const worker = async () => {
      while (idx < tiles.length) {
        const t = tiles[idx++];
        const url = tileUrl(t);
        try {
          const res = await fetch(url, { mode: 'no-cors' }); // opaque, cacheable for <img>
          await cache.put(url, res);
        } catch {
          failed++;
        }
        done++;
        if (done % 10 === 0 || done === tiles.length) render();
      }
    };
    await Promise.all(Array.from({ length: 6 }, worker));

    status.hidden = true;
    btn.disabled = false;
    toast(failed ? `Saved ${done - failed}/${tiles.length} tiles (some failed)` : `Area saved offline (${done} tiles)`);
  }

  function renderMarkers() {
    if (!map || !cluster) return;
    cluster.clearLayers();
    const list = (state.species ? DB.filterBySpecies(state.species, state.keepable) : DB.allWaterbodies())
      .filter((w) => w.co);
    const markers = [];
    for (const w of list) {
      const m = L.marker([w.co[1], w.co[0]]);
      m.bindPopup(() => buildPopup(w));
      markers.push(m);
    }
    cluster.addLayers(markers);
    mapDirty = false;
    let info = `On map: ${list.length} waterbodies`;
    if (state.species) info += ` with ${speciesLabel(state.species)}${state.keepable ? ' (harvest allowed)' : ''}`;
    $('map-info').textContent = info;
  }

  function buildPopup(w) {
    const box = el('div');
    box.appendChild(el('div', 'popup-name', esc(w.nm)));
    box.appendChild(el('div', 'popup-sub', (w.l === 1 ? 'Lake' : 'River') + ' · zone ' + esc(w.fmz)));
    const btn = el('button', 'popup-btn', 'View regulations');
    btn.addEventListener('click', () => openDetail(w.id));
    box.appendChild(btn);
    return box;
  }

  // ---------- Waterbody detail ----------
  function fmtSize(lo, hi) {
    if (lo != null && hi != null) return `${lo}–${hi} cm`;
    if (lo != null) return `${lo} cm min`;
    if (hi != null) return `${hi} cm max`;
    return null;
  }

  function openDetail(id) {
    const w = DB.getWaterbody(id);
    const data = DB.getRegs(id);
    const c = $('detail-content');
    c.innerHTML = '';

    c.appendChild(el('h2', 'detail-title', esc(w.nm)));
    const metaBits = [w.l === 1 ? 'Lake' : 'River', 'management zone ' + esc(w.fmz)];
    if (data && data.ga) metaBits.push('district ' + esc(data.ga));
    c.appendChild(el('div', 'detail-meta', metaBits.join(' · ')));

    if (!data || !data.r.length) {
      c.appendChild(
        el('div', 'empty', 'This waterbody has no specific regulations — the general Zone ' + esc(w.fmz) + ' rules apply.<br>Check the official guide.'),
      );
      showScreen('detail');
      return;
    }

    // Group regulations by species (preserving first-seen order).
    const groups = new Map();
    for (const r of data.r) {
      if (!groups.has(r.sp)) groups.set(r.sp, []);
      groups.get(r.sp).push(r);
    }

    for (const [species, rows] of groups) {
      const card = el('div', 'species-card');
      // Highlight the species if it is selected in the filter.
      if (state.species && species === state.species) card.style.borderColor = 'var(--accent)';
      const head = el('div', 'species-head');
      head.appendChild(el('span', 'species-name', esc(speciesLabel(species))));
      card.appendChild(head);

      for (const r of rows) {
        const row = el('div', 'season-row');
        const open = (r.ss || '').toUpperCase() === 'OPEN';
        row.appendChild(el('span', 'tag ' + (open ? 'open' : 'closed'), open ? 'open' : 'closed'));
        if (r.se) row.appendChild(el('span', 'chip', esc(r.se)));
        const bagZero = r.bl === 0;
        row.appendChild(
          el('span', 'chip' + (bagZero ? ' zero' : ''), bagZero ? 'harvest: <b>0 (catch & release)</b>' : `limit: <b>${esc(r.bl)}</b>`),
        );
        const size = fmtSize(r.lo, r.hi);
        if (size) row.appendChild(el('span', 'chip', `size: <b>${esc(size)}</b>`));
        if (r.bt) row.appendChild(el('span', 'chip', esc(r.bt)));
        card.appendChild(row);
      }
      c.appendChild(card);
    }
    showScreen('detail');
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg) {
    let t = document.querySelector('.toast');
    if (!t) {
      t = el('div', 'toast');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- Network ----------
  const updateNet = () => $('net-status').classList.toggle('offline', !navigator.onLine);

  // ---------- Startup ----------
  async function init() {
    updateNet();
    window.addEventListener('online', updateNet);
    window.addEventListener('offline', updateNet);
    $('search-input').addEventListener('input', onSearch);
    $('btn-near').addEventListener('click', onNearMe);
    $('btn-back').addEventListener('click', () => showScreen(state.tab));
    $('species-filter').addEventListener('change', onFilterChange);
    $('keepable-filter').addEventListener('change', onFilterChange);
    document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showScreen(t.dataset.tab)));
    $('btn-download').addEventListener('click', downloadArea);

    try {
      const meta = await DB.load();
      // Populate the species dropdown.
      const sel = $('species-filter');
      for (const sp of meta.stats.species) {
        const o = document.createElement('option');
        o.value = sp;
        o.textContent = speciesLabel(sp);
        sel.appendChild(o);
      }
      $('keepable-filter').closest('.keepable').style.opacity = '0.5';
      const ver = meta.builtAt ? ` · data as of ${meta.builtAt}` : '';
      $('disclaimer').textContent = meta.disclaimer + ' ' + meta.attribution + '.' + ver;
      renderList();
    } catch (e) {
      $('result-info').textContent = 'Failed to load data: ' + e.message;
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
