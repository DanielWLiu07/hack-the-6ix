# vision-train status

## [22:05] WIP — kickoff, env verified, building training pipeline
Python 3.11 + ultralytics 8.3.232 + torch 2.9.1 (MPS GPU available) + onnx/onnxruntime/cv2 all installed.
NO Roboflow/Kaggle credentials found → public-dataset download will be scripted but key-blocked; bootstrapping with a synthetic dataset generator instead (solid-color 3D-printed props make synthetic data highly representative). Plan: classes.json + dataset config → synth generator → train.py/export.py → train v0 → export ONNX+int8.
Need from master (non-blocking): a free Roboflow API key as env ROBOFLOW_API_KEY to also pull real apple/banana photos.

## [22:09] DONE — pipeline scripts + synthetic bootstrap dataset (task 1 & 2)
All of ml/ripeness scaffolded: classes.json (contract w/ fw-linux: classes + fruit/ripeness class_map), dataset.yaml, data/make_synth.py (1200 train / 200 val synthetic 3D-print-look fruit, verified visually), train.py (YOLOv8n 320px, MPS, hue-aug disabled so ripeness colors don't collapse), export.py (ONNX + int8 static quant), infer_test.py (pure onnxruntime decode — the exact logic fw-linux should copy), capture.py (venue burst+HSV auto-label + --merge, 30-min finetune loop documented), data/download_public.py (Roboflow pull + ripeness-by-hue remap — BLOCKED on ROBOFLOW_API_KEY, optional), DATA.md.
Verify: `python3 data/make_synth.py --train 6 --val 2` then look at data/dataset.
Next: training v0 now (~40 epochs), then export + smoke-test; will post metrics.

## [22:14] WIP — export/inference path de-risked while v0 trains
v0 training running on MPS (Apple M4), ~38 batches/epoch, epoch-1 val already mAP50=0.35. To de-risk the deliverable I ran export.py + infer_test.py against an early checkpoint: ONNX export ✅ (model.onnx 12.1 MB), int8 static quant ✅ (model.int8.onnx 3.3 MB), and my pure-onnxruntime decoder in infer_test.py produces the EXACT same box/class/conf as ultralytics' own decoder (verified match). int8 runs ~8× faster than fp32 on laptop CPU (4.0 vs 0.5 FPS single-frame — real on-device UNO Q numbers are vision-infer's bench).
@fw-linux: the decode logic to copy is infer_test.py::detect() — output tensor is (1, 4+nc, 2100), transpose, argmax over class scores, undo letterbox, NMSBoxes. Emits root-schema detection dicts directly.
Added requirements.txt + .gitignore (ignores dataset/runs/weights, tracks export/ — the model IS the deliverable).
Next: wait for v0 to finish → real export to export/ → post final metrics.

## [restart] WIP — recovering after crash: training died at epoch 1/40, export/ missing
Crash killed the v0 training run (results.csv has only epoch 1, mAP50=0.35) and export/ does not exist on disk, so the deliverable (export/model.onnx + classes.json) is NOT satisfied. Dataset (1200/200) + all scripts + deps intact. Recovery: (1) export current best.pt→export/ now so firmware has a consumable model immediately, (2) restart full 40-epoch v0 run in background, (3) re-export final weights + post metrics.

## [restart+] WIP — deliverable restored, full v0 training relaunched
Recovered the deliverable immediately: exported epoch-1 best.pt → export/model.onnx (12.1 MB) + model.int8.onnx (3.3 MB) + classes.json. infer_test.py smoke-test passes end-to-end (17 ms/frame laptop CPU, pipeline valid) — but epoch-1 weights have low recall (0.10) so real detections are weak. Relaunched full 40-epoch v0 training on MPS (bg PID 25816, ~112s/epoch ≈ 75 min); log: runs/train_v0.log. On completion: re-export final weights → export/ and post final mAP. @fw-linux: export/ is populated NOW with a valid-but-undertrained model + classes.json + the decode logic in infer_test.py — safe to integrate the loader path; accuracy will improve when I re-export post-training.

## [status] WIP — v0 training 23/40 epochs, ~20 min ETA, metrics already strong
Cumulative 1615s over 23 epochs ≈ 70s/epoch; 17 epochs left → ETA ~20 min. Epoch-23 val: precision 0.991, recall 0.968, mAP50 0.992, mAP50-95 0.899 — well converged on synthetic data (real-prop finetune via capture.py at venue is the remaining accuracy gap, as planned). Watcher tracks PID 25816; on exit I re-export final best.pt → export/ (overwriting the epoch-1 placeholder) and post final metrics.

## [DONE] real-prop intake ready — raw/ + photo README + --ingest path + finetune loop
Prints are done, so built the file-drop intake for real-prop photos:
- `ml/ripeness/raw/{apple_ripe,apple_unripe,banana_ripe,banana_unripe}/` — humans sort photos by class.
- `ml/ripeness/raw/README.md` — exact photo guide: ~60–80/class (240+ total), vary angle/distance, gripper's-eye + partial-occlusion shots, venue lighting, one fruit/frame, and CRUCIALLY a non-fruit-colored background (or HSV auto-label fails).
- `capture.py --ingest` (NEW) — auto-HSV-labels every raw/<class>/*.jpg → data/real/ + previews, and reports any photo where no fruit was found (nothing dropped silently). Smoke-tested: red-apple test image → correct class-0 box. Live `--label` burst path unchanged.
Ready to run the 30-min loop the MOMENT photos land: `--ingest` → review previews → `--merge` → `train.py --epochs 15 --weights runs/detect/v0/weights/best.pt --name v1` → `export.py --weights runs/detect/v1/weights/best.pt`.
v0 base training still running (25/40, mAP50 0.991) — its best.pt is the finetune starting point; watcher will re-export on completion.

## [audit] WIP — CORRECTION: v0 NOT done yet; export/ is still the epoch-1 de-risk artifact
Audit answer: training still RUNNING at 34/40 epochs (~7 min left). export/model.onnx + export/model.int8.onnx are timestamped 22:22 = the epoch-1 DE-RISK export, NOT finished v0. best.pt (23:01) is fresh but export has not re-run. Re-export is still pending on training exit (watcher bki2okhib waiting on PID 25816). Will post FINAL metrics + refreshed export mtimes once it lands — until then treat export/ as placeholder-quality. Live-best val (epoch 34): P0.988 R0.971 mAP50 0.988 mAP50-95 0.879.

## [DONE] v0 training complete (40/40) + FINAL export refreshed — deliverable is real now
Training finished all 40 epochs. FINAL val metrics (runs/detect/v0):
  overall  mAP50 0.993  mAP50-95 0.930  P 0.988  R 0.986
  apple_ripe   0.995/0.988 · apple_unripe 0.991/0.972 · banana_ripe 0.994/0.893 · banana_unripe 0.991/0.867
Re-exported final best.pt → export/model.onnx (12.1 MB) + model.int8.onnx (3.3 MB) + classes.json — ALL timestamped 23:15 (the stale 22:22 epoch-1 de-risk artifact is GONE). Smoke-test: fp32 detects 3/3 correctly (0 → real detections vs the epoch-1 export), 16 ms/frame (63 FPS single-frame laptop CPU), confs sane (0.93/0.90/0.89).

@fw-linux — IMPORTANT, load model.onnx (fp32), NOT model.int8.onnx yet:
  int8 has a confidence-saturation bug — boxes + fruit/ripeness CLASS are correct, but conf pins to a constant ~1.54 (>1.0), so you can't threshold/rank by conf. fp32 confs are correct and it already runs 63 FPS single-frame on laptop CPU. Per-channel int8 fix needs opset≥13 (we're opset-12 for UNO Q compat), so deferred. Real on-device speed is vision-infer's UNO Q bench (@vision-infer: bench BOTH; if int8 speed is needed on-device we can revisit the opset/quant scheme, else fp32 is the demo model). classes.json + infer_test.py::detect() decode logic unchanged.
Next: idle-ready; primed to run the 30-min real-prop finetune loop (raw/ intake) the moment photos land.
