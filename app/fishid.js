// On-device fish identification (offline). Two-stage TF.js classifier that runs entirely in the
// browser — no network, no server, no API key:
//   1. MobileNet v2 (vendored in vendor/mobilenet/) turns the photo into a 1280-d embedding.
//   2. A small trained head (model/model.json) maps that embedding to one of the Alberta species.
// Both stages + the TF.js runtime are cached by the service worker, so ID works fully offline
// once installed. The exact same MobileNet + normalization is used at training time
// (scripts/train-fish-tfjs.mjs), so browser and training embeddings match.
//
// Result → maps to a species string in data/meta.json → hands off to the list filtered by that
// species (window.ABFishing.showSpecies), reusing the rules screen.
//
// If the head isn't installed yet (model/model.json missing), the screen explains how to build it.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const titleCase = (s) => (s || '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

  const CONFIDENT = 0.6; // top-1 shown as a confident match at/above this probability
  const MIN_SHOW = 0.02; // don't list classes below this — noise

  const HEAD_URL = 'model/model.json';
  const LABELS_URL = 'model/labels.json';
  const MOBILENET_URL = 'vendor/mobilenet/model.json';

  let base = null; // MobileNet (embeddings)
  let head = null; // trained classifier head
  let labels = [];
  let loadPromise = null; // de-dupes concurrent loads
  let lastObjectUrl = null; // revoke previous preview blob URL

  // Lazy-load a script once. Keeps app startup fast — TF.js (~1.4 MB) + MobileNet load only when
  // the user actually identifies a photo.
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('Failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  // ---------- Model loading (lazy) ----------
  async function ensureModel() {
    if (head && base) return;
    if (loadPromise) return loadPromise;
    loadPromise = (async () => {
      if (!window.tf) await loadScript('vendor/tf.min.js');
      if (!window.mobilenet) await loadScript('vendor/mobilenet.min.js');
      if (!window.tf || !window.mobilenet) throw new Error('TensorFlow.js failed to load');

      const lj = await fetch(LABELS_URL).then((r) => {
        if (!r.ok) throw Object.assign(new Error('labels missing'), { code: 'NOMODEL' });
        return r.json();
      });
      labels = lj.labels || [];

      // MobileNet base — vendored, so it loads offline. inputRange [0,1] matches training.
      base = await window.mobilenet.load({ version: 2, alpha: 1.0, modelUrl: MOBILENET_URL, inputRange: [0, 1] });

      // Probe the head so a missing model gives a clean message rather than a TF.js stack trace.
      const probe = await fetch(HEAD_URL);
      if (!probe.ok) throw Object.assign(new Error('head model missing'), { code: 'NOMODEL' });
      head = await window.tf.loadLayersModel(HEAD_URL);
      window.tf.tidy(() => head.predict(window.tf.zeros([1, 1280])).dataSync()); // warm up
    })();
    try {
      await loadPromise;
    } catch (e) {
      loadPromise = null; // allow retry
      base = head = null;
      throw e;
    }
  }

  // ---------- Inference ----------
  // Returns [{ label, p }] sorted desc. The head ends in a softmax, so outputs are probabilities.
  async function classify(imgEl) {
    await ensureModel();
    const tf = window.tf;
    const probs = tf.tidy(() => {
      const emb = base.infer(imgEl, true); // [1,1280], normalized internally to [0,1]
      return head.predict(emb).squeeze();
    });
    const data = Array.from(await probs.data());
    probs.dispose();
    return data
      .map((p, i) => ({ label: labels[i] || `class ${i}`, p }))
      .sort((a, b) => b.p - a.p);
  }

  // ---------- UI ----------
  function setStatus(html, cls) {
    const s = $('id-status');
    s.className = 'id-status' + (cls ? ' ' + cls : '');
    s.innerHTML = html;
  }

  function renderResults(ranked) {
    const box = $('id-results');
    box.innerHTML = '';
    const shown = ranked.filter((r) => r.p >= MIN_SHOW).slice(0, 3);
    if (!shown.length) {
      setStatus("Couldn't identify this photo. Try a clearer, side-on shot of the whole fish.", 'warn');
      return;
    }
    const confident = shown[0].p >= CONFIDENT;
    setStatus(
      confident
        ? `Best match — <b>${Math.round(shown[0].p * 100)}%</b> confident`
        : "Not confident — here are the closest matches. Confirm against the official guide.",
      confident ? 'ok' : 'warn',
    );

    shown.forEach((r, i) => {
      const card = el('div', 'id-result' + (i === 0 && confident ? ' primary' : ''));
      const left = el('div', 'id-result-main');
      left.appendChild(el('div', 'id-result-name', titleCase(r.label)));
      const bar = el('div', 'id-bar');
      const fill = el('span', 'id-bar-fill');
      fill.style.width = Math.round(r.p * 100) + '%';
      bar.appendChild(fill);
      left.appendChild(bar);
      card.appendChild(left);

      const pct = el('div', 'id-pct', Math.round(r.p * 100) + '%');
      card.appendChild(pct);

      // Jump to this species' regulations if the app knows it.
      if (window.ABFishing && window.ABFishing.hasSpecies(r.label)) {
        const btn = el('button', 'id-rules-btn', 'See rules →');
        btn.addEventListener('click', () => window.ABFishing.showSpecies(r.label));
        card.appendChild(btn);
      }
      box.appendChild(card);
    });
  }

  function showNoModel() {
    setStatus(
      'Identification model not installed yet. Build it with ' +
        '<code>npm run fetch-fish</code> then <code>npm run train-fish</code> ' +
        '(see app/model/README.md), then reload. The rest of the app works normally.',
      'warn',
    );
    $('id-results').innerHTML = '';
  }

  async function onPhoto(file) {
    if (!file) return;
    if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
    lastObjectUrl = URL.createObjectURL(file);
    const img = $('id-preview');
    $('id-preview-wrap').hidden = false;
    $('id-results').innerHTML = '';
    setStatus('<span class="id-spin"></span> Analyzing on your device…');

    img.onload = async () => {
      try {
        const ranked = await classify(img);
        renderResults(ranked);
      } catch (e) {
        if (e && e.code === 'NOMODEL') showNoModel();
        else setStatus('Identification failed: ' + (e.message || e), 'warn');
      }
    };
    img.onerror = () => setStatus("Couldn't read that image.", 'warn');
    img.src = lastObjectUrl;
  }

  function init() {
    const input = $('id-file');
    if (!input) return; // screen not present
    input.addEventListener('change', (e) => onPhoto(e.target.files && e.target.files[0]));
  }

  document.addEventListener('DOMContentLoaded', init);
})();
