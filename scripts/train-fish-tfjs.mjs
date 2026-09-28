// Train the offline fish-ID classifier — pure Node (no Python), using @tensorflow/tfjs-node.
//
// Transfer learning by feature extraction:
//   1. Run every dataset image through MobileNet v2 (vendored in app/vendor/mobilenet) to get a
//      1280-d embedding. The SAME vendored model + normalization ([0,1]) is used in the browser
//      (app/fishid.js), so embeddings match exactly between training and inference.
//   2. Train a small dense head (1280 → 128 → N classes) on those embeddings.
//   3. Save the head as a TF.js layers model to app/model/ and write labels.json.
//
// The browser then does: photo → mobilenet.infer(img, true) → head.predict → species.
//
// Usage:
//   node scripts/train-fish-tfjs.mjs                 # defaults
//   node scripts/train-fish-tfjs.mjs --epochs 40 --batch 32
//
// Requires: npm i -D @tensorflow/tfjs-node @tensorflow-models/mobilenet, and the dataset from
// scripts/fetch-fish-images.mjs (data/fish-images/<LABEL>/*.jpg).

import * as tf from '@tensorflow/tfjs-node';
import * as mobilenet from '@tensorflow-models/mobilenet';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve('data/fish-images');
const OUT_DIR = path.resolve('app/model');
const CACHE = path.resolve('data/fish-emb-cache'); // .bin (Float32) + .json (meta) — gitignored
const MOBILENET_URL = 'file://' + path.resolve('app/vendor/mobilenet/model.json').replace(/\\/g, '/');
const DIM = 1280; // MobileNet v2 embedding size

const args = process.argv.slice(2);
const argNum = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? Number(args[i + 1]) : def;
};
const EPOCHS = argNum('--epochs', 40);
const BATCH = argNum('--batch', 32);
const REFRESH = args.includes('--refresh'); // ignore the embedding cache and re-extract

const isImg = (f) => /\.(jpe?g|png)$/i.test(f);

// Extract embeddings for the whole dataset, including a horizontally-flipped copy of each image
// (cheap augmentation — fish in side view are ~bilaterally symmetric). Returns per-image original
// and flipped embeddings so the caller can split by image (no flip-leakage into validation).
async function extract() {
  const entries = await readdir(DATA_DIR, { withFileTypes: true });
  const labels = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  if (!labels.length) throw new Error(`No class folders in ${DATA_DIR}. Run: node scripts/fetch-fish-images.mjs`);
  console.log(`${labels.length} classes:`, labels.join(', '));

  console.log('\nLoading vendored MobileNet (app/vendor/mobilenet)…');
  const base = await mobilenet.load({ version: 2, alpha: 1.0, modelUrl: MOBILENET_URL, inputRange: [0, 1] });

  const orig = []; // Float32Array(DIM) per image
  const flip = []; // flipped counterpart, aligned by index
  const ys = [];
  for (let ci = 0; ci < labels.length; ci++) {
    const dir = path.join(DATA_DIR, labels[ci]);
    const files = (await readdir(dir)).filter(isImg);
    process.stdout.write(`\n[${ci + 1}/${labels.length}] ${labels[ci]} (${files.length}): `);
    let done = 0;
    for (const f of files) {
      try {
        const buf = await readFile(path.join(dir, f));
        const [vO, vF] = tf.tidy(() => {
          const img = tf.node.decodeImage(buf, 3);
          const eO = base.infer(img, true).squeeze(); // [DIM], normalized internally to [0,1]
          const eF = base.infer(tf.reverse(img, 1), true).squeeze(); // horizontal flip
          return [Float32Array.from(eO.dataSync()), Float32Array.from(eF.dataSync())];
        });
        if (vO.length !== DIM || vF.length !== DIM) { process.stdout.write(`[bad-dim] `); continue; }
        orig.push(vO);
        flip.push(vF);
        ys.push(ci);
        if (++done % 25 === 0) process.stdout.write(`${done} `);
      } catch {
        process.stdout.write(`[skip ${f}] `);
      }
    }
    process.stdout.write(`→ ${done}`);
  }
  const n = orig.length;
  const flat = new Float32Array(n * DIM);
  const flatF = new Float32Array(n * DIM);
  orig.forEach((c, i) => flat.set(c, i * DIM));
  flip.forEach((c, i) => flatF.set(c, i * DIM));
  return { labels, flat, flatF, y: Int32Array.from(ys), n };
}

async function loadCache() {
  const meta = JSON.parse(await readFile(CACHE + '.json', 'utf8'));
  const toF32 = (b) => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  return {
    labels: meta.labels,
    flat: toF32(await readFile(CACHE + '.bin')),
    flatF: toF32(await readFile(CACHE + '.flip.bin')),
    y: Int32Array.from(meta.y),
    n: meta.n,
  };
}

async function main() {
  let data;
  if (!REFRESH && existsSync(CACHE + '.bin') && existsSync(CACHE + '.json')) {
    console.log('Using cached embeddings (data/fish-emb-cache). Use --refresh to re-extract.');
    data = await loadCache();
  } else {
    data = await extract();
    await mkdir(DATA_DIR, { recursive: true });
    await writeFile(CACHE + '.bin', Buffer.from(data.flat.buffer));
    await writeFile(CACHE + '.flip.bin', Buffer.from(data.flatF.buffer));
    await writeFile(CACHE + '.json', JSON.stringify({ labels: data.labels, y: Array.from(data.y), n: data.n, dim: DIM }));
    console.log('\nCached embeddings → data/fish-emb-cache.{bin,flip.bin,json}');
  }
  const { labels, flat, flatF, y, n } = data;
  console.log(`\n${n} images across ${labels.length} classes. Building head…`);

  // ---- Split by IMAGE (last 15% = holdout), so an image's flip never leaks into validation.
  // Train set = originals + flips of the training images (2× data); val = originals only. ----
  const perm = Array.from(tf.util.createShuffledIndices(n));
  const nVal = Math.round(n * 0.15);
  const nTrain = n - nVal;
  const trainIdx = perm.slice(0, nTrain);
  const valIdx = perm.slice(nTrain);

  const row = (src, j, dst, i) => dst.set(src.subarray(j * DIM, j * DIM + DIM), i * DIM);
  const xTrain = new Float32Array(nTrain * 2 * DIM);
  const yTrain = new Int32Array(nTrain * 2);
  trainIdx.forEach((j, i) => {
    row(flat, j, xTrain, i); // original
    row(flatF, j, xTrain, nTrain + i); // flipped
    yTrain[i] = y[j];
    yTrain[nTrain + i] = y[j];
  });
  const xVal = new Float32Array(nVal * DIM);
  const yValArr = [];
  valIdx.forEach((j, i) => {
    row(flat, j, xVal, i);
    yValArr.push(y[j]);
  });

  const xs = tf.tensor2d(xTrain, [nTrain * 2, DIM]);
  const ys1h = tf.oneHot(tf.tensor1d(yTrain, 'int32'), labels.length);
  const xsVal = tf.tensor2d(xVal, [nVal, DIM]);

  // ---- Head. On frozen MobileNet embeddings a heavily-regularized linear classifier
  // (input dropout + L2 softmax) generalizes far better than an MLP, which just memorizes the
  // ~3k training vectors. Early stopping on val_loss prevents over-training. ----
  const head = tf.sequential();
  head.add(tf.layers.dropout({ rate: 0.5, inputShape: [DIM] }));
  head.add(
    tf.layers.dense({
      units: labels.length,
      activation: 'softmax',
      kernelRegularizer: tf.regularizers.l2({ l2: 1e-3 }),
    }),
  );
  head.compile({ optimizer: tf.train.adam(1e-3), loss: 'categoricalCrossentropy', metrics: ['accuracy'] });

  // Manual early stopping on val_loss (patience 12) — mixing tf.callbacks.earlyStopping with a
  // custom logger in one array isn't supported, so we stop via head.stopTraining.
  let best = 0;
  let bestLoss = Infinity;
  let wait = 0;
  const yVal1h = tf.oneHot(tf.tensor1d(Int32Array.from(yValArr), 'int32'), labels.length);
  await head.fit(xs, ys1h, {
    epochs: EPOCHS,
    batchSize: BATCH,
    validationData: [xsVal, yVal1h],
    shuffle: true,
    callbacks: {
      onEpochEnd: (e, logs) => {
        best = Math.max(best, logs.val_acc);
        if (logs.val_loss < bestLoss - 1e-4) {
          bestLoss = logs.val_loss;
          wait = 0;
        } else if (++wait >= 12) {
          head.stopTraining = true;
        }
        if ((e + 1) % 5 === 0 || e === 0)
          console.log(
            `  epoch ${String(e + 1).padStart(3)}  loss ${logs.loss.toFixed(3)}  acc ${logs.acc.toFixed(3)}` +
              `  val_loss ${logs.val_loss.toFixed(3)}  val_acc ${logs.val_acc.toFixed(3)}  (best val_acc ${best.toFixed(3)})`,
          );
      },
    },
  });
  console.log(`\nBest val_acc during training: ${best.toFixed(3)}`);

  // ---- Honest holdout eval: top-1 and top-3 accuracy (top-3 is what the UI relies on). ----
  const predT = head.predict(xsVal);
  const preds = await predT.array();
  predT.dispose();
  let top1 = 0;
  let top3 = 0;
  for (let i = 0; i < preds.length; i++) {
    const order2 = preds[i].map((p, k) => [p, k]).sort((a, b) => b[0] - a[0]);
    if (order2[0][1] === yValArr[i]) top1++;
    if (order2.slice(0, 3).some(([, k]) => k === yValArr[i])) top3++;
  }
  console.log(`Holdout (${nVal} images): top-1 ${(top1 / nVal * 100).toFixed(1)}%  ·  top-3 ${(top3 / nVal * 100).toFixed(1)}%`);
  xsVal.dispose();
  yVal1h.dispose();

  // ---- Save head (layers model) + labels.json. ----
  await mkdir(OUT_DIR, { recursive: true });
  await head.save('file://' + OUT_DIR.replace(/\\/g, '/'));
  await writeFile(
    path.join(OUT_DIR, 'labels.json'),
    JSON.stringify(
      {
        note: 'Auto-generated by scripts/train-fish-tfjs.mjs. Order == head output indices. Two-stage model: MobileNet v2 embedding (app/vendor/mobilenet) → this head.',
        base: 'mobilenet-v2-1.0',
        input: { size: 224, normalize: '0..1' },
        labels,
      },
      null,
      2,
    ),
  );

  xs.dispose();
  ys1h.dispose();
  console.log(`\n✓ Saved head to ${OUT_DIR} (model.json, weights.bin, labels.json)`);
  console.log('Next: the browser (app/fishid.js) loads app/vendor/mobilenet + app/model. Bump CACHE in app/sw.js, then deploy.');
}

main().catch((e) => {
  console.error('\nFailed:', e);
  process.exit(1);
});
