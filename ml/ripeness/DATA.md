# ml/ripeness data pipeline

4 classes: `apple_ripe(0)`, `apple_unripe(1)`, `banana_ripe(2)`, `banana_unripe(3)`
(canonical list + fruit/ripeness mapping in `classes.json` — that file is the
contract with `firmware/linux`).

Dataset layout (YOLO format, referenced by `dataset.yaml`):

```
data/dataset/
  images/{train,val}/*.jpg
  labels/{train,val}/*.txt      # "<cls> <xc> <yc> <w> <h>" normalized
```

## Sources, in priority order

1. **Synthetic** (`data/make_synth.py`) — the bootstrap set that v0 is trained
   on. Procedurally rendered solid-color shiny apples/bananas (matching the
   3D-printed props: red/green apples, yellow/green bananas) on cluttered,
   noise/blur/gamma-augmented backgrounds with non-fruit distractor shapes.
   1200 train / 200 val, deterministic (seeded). Regenerate:
   `python3 data/make_synth.py --train 1200 --val 200`
2. **Real prop photos** (`capture.py`) — captured at the venue from the arm
   camera; HSV auto-labeled per burst. THE dataset that matters; see the
   30-min finetune loop in `capture.py`'s docstring. Files prefixed `real_`.
3. **Public Roboflow data** (`data/download_public.py`) — real apple/banana
   photos, ripeness auto-assigned by bbox hue, files prefixed `rf_`.
   ⚠️ BLOCKED on env `ROBOFLOW_API_KEY` (any free account). Optional — helps
   generalization but the props are the actual test distribution.

## Training / export

```
python3 train.py                 # YOLOv8n, 320px, 40 epochs → runs/detect/v0
python3 export.py                # → export/model.onnx + model.int8.onnx + classes.json
python3 infer_test.py            # smoke-test the ONNX on a val image
```

Venue finetune (~30 min): 4 capture bursts → review previews → `capture.py
--merge` → `train.py --epochs 15 --weights runs/detect/v0/weights/best.pt
--name v1` → `export.py --weights runs/detect/v1/weights/best.pt`.

## Augmentation note

`hsv_h` is nearly disabled in training (0.005): class identity is literally
hue (red vs green apple), so hue-shift augmentation would collapse ripe/unripe.
Brightness/saturation jitter stays high for venue-lighting robustness.
