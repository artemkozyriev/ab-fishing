# Fish-ID model (on-device, offline)

The **📷 ID** tab identifies a fish entirely in the browser — no network, no server, no API key.
It's a **two-stage TensorFlow.js classifier**:

1. **MobileNet v2** (vendored in `app/vendor/mobilenet/`) turns the photo into a 1280-d embedding.
2. A small trained **head** (`app/model/model.json`) maps that embedding to one of the 19 Alberta
   species.

Both stages + the TF.js runtime are cached by the service worker, so ID works fully offline once
installed. The **same** MobileNet + normalization ([0,1]) is used at training and inference, so
embeddings match exactly.

## Files

| File | Ships in repo? | Purpose |
|------|----------------|---------|
| `labels.json` | ✅ yes | Class order + input config. Written by the training script. |
| `model.json` | ✅ after training | Head topology + weight manifest. |
| `weights.bin` | ✅ after training | Head weights (tiny, ~0.7 MB). |
| `../vendor/mobilenet/` | ✅ yes | MobileNet v2 graph model (~14 MB) — the frozen feature extractor. |

Until `model.json` exists, the ID screen shows *"model not installed"* and the rest of the app
works normally.

**Label strings in `labels.json` must exactly match the species strings in `data/meta.json`**
(UPPERCASE) — that's what makes the "See rules →" hand-off work. The training script writes labels
from the dataset folder names, which are those exact strings, so they stay in sync.

## Build / retrain the model

```bash
# 1. Dataset — CC-licensed research-grade photos from iNaturalist
npm run fetch-fish                 # ~200 photos/species → data/fish-images/  (review CREDITS.csv)

# 2. Train (pure Node — no Python needed)
npm run train-fish                 # → app/model/{model.json,weights.bin,labels.json}
#    Feature extraction is cached in data/fish-emb-cache.* ; re-runs are instant.
#    Use `node scripts/train-fish-tfjs.mjs --refresh` to re-extract after changing the dataset,
#    or `--epochs N` to train longer.

# 3. Ship
#    ⚠ bump CACHE in app/sw.js (e.g. v11 → v12) so users get the new model, then:
git add app/model && git commit -m "Fish-ID: retrained head" && git push
```

Requires `@tensorflow/tfjs-node` and `@tensorflow-models/mobilenet` (already in devDependencies).

### Windows note (tfjs-node native binding)

If `require('@tensorflow/tfjs-node')` fails with *"The specified module could not be found"*, copy
the bundled TensorFlow DLL next to the native binding:

```bash
cp node_modules/@tensorflow/tfjs-node/deps/lib/tensorflow.dll \
   node_modules/@tensorflow/tfjs-node/lib/napi-v8/
```

## How inference works (`app/fishid.js`)

1. Photo → `<img>` → `mobilenet.load({modelUrl:'vendor/mobilenet/model.json', inputRange:[0,1]})`
   → `base.infer(img, true)` → 1280-d embedding (MobileNet normalizes to [0,1] internally).
2. `head.predict(embedding)` → 19-way softmax → top-3, with a confidence threshold.
3. Predicted class maps 1:1 to a `data/meta.json` species → **See rules →** jumps to its regulations.

## Accuracy notes

- "Fish in hand" photos are hard (angle, water, glare). The UI shows a **confidence threshold**
  and falls back to **top-3** when unsure — keep that; don't present a single guess as certain.
- Hard/confusable classes: walleye ↔ sauger; brook ↔ brown ↔ rainbow ↔ tiger trout;
  bull trout ↔ dolly varden; lake ↔ mountain whitefish ↔ cisco. More/better photos help most.
- Tiger trout is a hybrid (no single iNaturalist taxon) — the fetch script uses a text query;
  expect fewer, noisier images for it.

## Alternative: Python/Keras end-to-end pipeline

`scripts/train_fish_model.py` (`npm run train-fish-py`) trains a **single end-to-end** MobileNetV2
model (no separate embedding step) and exports it via `tensorflowjs`. It needs Python 3.10/3.11 +
`tensorflow` + `tensorflowjs`. Kept as an option; the Node pipeline above is what ships by default
because it needs no Python and no converter.
