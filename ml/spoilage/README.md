# Spoilage / anomaly detection — dataset + model workflow

Goal: detect **spoiled fruit** (marker spots / bruises on the 3D-printed bananas)
robustly, two ways that share one dataset:

1. **Fresh-vs-spoiled classification** — the robust workhorse (Edge Impulse
   free-tier, or a local model).
2. **Unsupervised anomaly detection** — trained on *clean* fruit only, flags
   novel spoilage it was never shown. The better judge/demo story.

## Why we're not just thresholding color

We tried classical HSV/Lab spoilage first (see `robot/vision/spoilage.py`). It's
fragile here: the printed banana is a **pale** yellow ≈ the room/skin, so color
thresholds can't cleanly segment the banana body, and marker spots touch the
edge and get cut out. Measured on a real spotted banana: the spots aren't even
dark (min Value 97; `V<70` = 0 px) — they're *less-yellow/greyer* (Lab-b ~128 vs
healthy ~153). A trained detector sidesteps all of this by localizing the banana
regardless of background. The classical scorer stays as a zero-dependency
fallback, but the model is the real answer.

## Note on Edge Impulse plans

**FOMO-AD (visual anomaly detection) is Enterprise-only** — not on the free
hackathon tier. So:
- **Classification** (fresh/spoiled) and **FOMO object detection** → free tier. ✅
- **Anomaly story** → we build a **local** unsupervised model instead (below),
  no paywall, runs on-device in the existing pipeline.

## 1. Collect data — `capture.py`

Browser-based, reuses `robot/vision/.venv` (opencv-headless + numpy):

```bash
cd ml/spoilage
CAMERA_INDEX=0 ../../robot/vision/.venv/bin/python capture.py
# open http://localhost:8091 — click FRESH / SPOILED / apple / empty (or keys f/s/a/e)
```

Each click saves a **burst** (default 10 frames) into `dataset/<label>/`. The
green box is a framing guide only (not saved).

**What to collect (variety beats volume):**
- `fresh` — ~80–120 clean bananas: rotate, tilt, vary distance, lighting, hand
  position, and **background**. This set trains both the classifier and the
  anomaly model.
- `spoiled` — ~80–120 marker/bruised bananas: spots in different places, sizes,
  counts. Trains the classifier; is the *test/anomaly* set for the anomaly model.
- `apple` — ~30 (the pipeline also does apples).
- `empty` — ~20 background/no-fruit negatives.

Output layout (works for both Edge Impulse and the local model):

```
dataset/fresh/fresh.<ts>.jpg   dataset/spoiled/spoiled.<ts>.jpg   …
```

Filenames are label-prefixed **and** folder-separated, so either Edge Impulse
ingestion path works.

## 2a. Edge Impulse — classification (free tier)

Upload (CLI, one command per label; label inferred from folder/prefix):

```bash
npm i -g edge-impulse-cli
edge-impulse-uploader --category split --label fresh   dataset/fresh/*.jpg
edge-impulse-uploader --category split --label spoiled dataset/spoiled/*.jpg
# (apple/empty optional)
```

Or drag the folders into the Studio **Data acquisition** page.

In Studio: **Impulse** = Image (96×96 or 160×160) → **Transfer Learning
(Images)** classifier, 2+ classes. Train, check the confusion matrix, then
**Deployment → ONNX** (or EON/TFLite). Drop the model where the existing runtime
picks it up:

- ONNX classifier → wire into `robot/vision/` as a crop classifier after the
  banana detector, OR
- For end-to-end detection of `banana_spoiled`, train **FOMO object detection**
  with the 3 classes and export — it fits the existing `onnx_detector.py` path.

## 2b. Local anomaly model (no Edge Impulse account needed)

Train on `fresh/` crops only; score spoiled as anomalies. Plan (to build once
data exists): extract a compact feature per banana crop (Lab color histogram +
simple texture), fit a Gaussian / Mahalanobis (or k-NN) model on fresh, and
flag crops whose distance exceeds a percentile of the fresh set. Emits the same
`spoiled` + `spoil_score` fields already in the `detection` schema. This becomes
`ml/spoilage/anomaly.py` + a `robot/vision` detector hook.

## 3. Wire into the demo

Either path outputs to the existing contract — `detection.spoiled` +
`detection.spoil_score` (already in `web/server/schemas.js`) — so the dashboard
and MJPEG overlay light up with no further schema change.
