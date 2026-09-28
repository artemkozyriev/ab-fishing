#!/usr/bin/env python3
"""Train the offline fish-ID model and export it for the app (TensorFlow.js layers model).

Transfer learning on MobileNetV2 (ImageNet) → a 19-class Alberta-fish classifier, exported to
app/model/ as an end-to-end model: input is a 224x224x3 image normalized to [-1, 1] (x/127.5-1),
output is a 19-way softmax. That exactly matches what app/fishid.js feeds in and reads out, so the
browser just does pixels → predict, fully offline.

Pipeline:
  1. node scripts/fetch-fish-images.mjs      # builds data/fish-images/<LABEL>/*.jpg
  2. python scripts/train_fish_model.py      # this script → app/model/{model.json,*.bin,labels.json}
  3. bump CACHE in app/sw.js, commit, deploy

Setup (Python 3.10/3.11 recommended):
  pip install "tensorflow==2.15.*" "tensorflowjs==4.*"

Options:
  --epochs 12 --fine-tune-epochs 6 --batch 32 --img 224
"""
import argparse
import json
import os
import sys

IMG_DEFAULT = 224
DATA_DIR = os.path.join("data", "fish-images")
OUT_DIR = os.path.join("app", "model")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--epochs", type=int, default=12, help="head-training epochs (base frozen)")
    ap.add_argument("--fine-tune-epochs", type=int, default=6, help="fine-tuning epochs (top of base unfrozen)")
    ap.add_argument("--batch", type=int, default=32)
    ap.add_argument("--img", type=int, default=IMG_DEFAULT)
    ap.add_argument("--data", default=DATA_DIR)
    ap.add_argument("--out", default=OUT_DIR)
    args = ap.parse_args()

    if not os.path.isdir(args.data):
        sys.exit(f"Dataset not found: {args.data}\nRun: node scripts/fetch-fish-images.mjs")

    import tensorflow as tf
    from tensorflow.keras import layers, models

    print(f"TensorFlow {tf.__version__}")
    img_size = (args.img, args.img)

    # ---- Data: 80/20 split, labels inferred from folder names (sorted alphabetically). ----
    train_ds = tf.keras.utils.image_dataset_from_directory(
        args.data, validation_split=0.2, subset="training", seed=42,
        image_size=img_size, batch_size=args.batch, label_mode="categorical",
    )
    val_ds = tf.keras.utils.image_dataset_from_directory(
        args.data, validation_split=0.2, subset="validation", seed=42,
        image_size=img_size, batch_size=args.batch, label_mode="categorical",
    )
    class_names = train_ds.class_names  # exact order the model's output indices use
    n_classes = len(class_names)
    print(f"{n_classes} classes: {class_names}")

    # MobileNetV2 preprocessing IS x/127.5-1 — same as app/fishid.js and labels.json.
    preprocess = tf.keras.applications.mobilenet_v2.preprocess_input
    AUTOTUNE = tf.data.AUTOTUNE
    train_ds = train_ds.map(lambda x, y: (preprocess(x), y)).cache().prefetch(AUTOTUNE)
    val_ds = val_ds.map(lambda x, y: (preprocess(x), y)).cache().prefetch(AUTOTUNE)

    # ---- Model: frozen MobileNetV2 base + light augmentation + classifier head. ----
    # Augmentation lives inside the model but is inactive at inference (browser), so it doesn't
    # affect exported predictions — it only regularizes training. Input is already normalized.
    data_aug = tf.keras.Sequential(
        [layers.RandomFlip("horizontal"), layers.RandomRotation(0.05), layers.RandomZoom(0.1)],
        name="augment",
    )
    base = tf.keras.applications.MobileNetV2(
        input_shape=img_size + (3,), include_top=False, weights="imagenet"
    )
    base.trainable = False

    inputs = tf.keras.Input(shape=img_size + (3,))
    x = data_aug(inputs)
    x = base(x, training=False)
    x = layers.GlobalAveragePooling2D()(x)
    x = layers.Dropout(0.2)(x)
    outputs = layers.Dense(n_classes, activation="softmax")(x)
    model = models.Model(inputs, outputs)

    model.compile(optimizer=tf.keras.optimizers.Adam(1e-3),
                  loss="categorical_crossentropy", metrics=["accuracy"])
    print("\nPhase 1 — training classifier head (base frozen):")
    model.fit(train_ds, validation_data=val_ds, epochs=args.epochs)

    # ---- Phase 2: fine-tune the top of the base at a low learning rate. ----
    if args.fine_tune_epochs > 0:
        base.trainable = True
        for layer in base.layers[:-30]:  # keep most of the base frozen
            layer.trainable = False
        model.compile(optimizer=tf.keras.optimizers.Adam(1e-5),
                      loss="categorical_crossentropy", metrics=["accuracy"])
        print("\nPhase 2 — fine-tuning top layers:")
        model.fit(train_ds, validation_data=val_ds, epochs=args.fine_tune_epochs)

    # ---- Export: TF.js layers model + labels.json (order == class_names == output indices). ----
    os.makedirs(args.out, exist_ok=True)
    try:
        import tensorflowjs as tfjs
    except ImportError:
        sys.exit("tensorflowjs not installed. Run: pip install tensorflowjs")
    tfjs.converters.save_keras_model(model, args.out)

    with open(os.path.join(args.out, "labels.json"), "w", encoding="utf-8") as f:
        json.dump(
            {
                "note": "Auto-generated by scripts/train_fish_model.py. Order == model output indices.",
                "input": {"size": args.img, "normalize": "x/127.5-1"},
                "labels": class_names,
            },
            f, indent=2, ensure_ascii=False,
        )

    print(f"\n✓ Exported to {args.out}/ (model.json, *.bin, labels.json)")
    print("Next: bump CACHE in app/sw.js, then commit & deploy.")
    # Sanity check: labels must match the app's species strings (data/meta.json).
    print("Verify each label matches a species in data/meta.json so 'See rules →' works.")


if __name__ == "__main__":
    main()
