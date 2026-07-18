# vision-infer status

## [22:07] DONE — Task 1: hsv_detector.py + synthetic tuning harness
HSV blob detector for 3D-printed fruit in `robot/vision/hsv_detector.py` (red→apple_ripe, yellow→banana_ripe, green split apple/banana by elongation). Emits exact root-schema `detection` dicts (schema asserted in tests). Tuned on synthetic scenes (`synthetic.py`): precision 0.965 / recall 0.891 over 200 frames — misses are touching same-color fruit merging into one blob (known HSV limit, fine for eye-in-hand). Verify: `cd robot/vision && python3 test_detector.py --frames 200` → PASS.
Next: pipeline.py (camera→detector→MJPEG :8080) + ONNX loader + unified `detector.load_detector()` interface for fw-linux.

## [22:11] DONE — Task 2: pipeline.py (capture→detect→MJPEG :8080) + ONNX loader + unified interface
`pipeline.py` serves `/stream` (annotated MJPEG for server-core's proxy), `/detections` (latest JSON), `/health`. Camera via `CAMERA_INDEX` env; auto-falls-back to synthetic scenes when no camera (verified end-to-end: 29 frames/2 s captured, boxes+labels correct). `onnx_detector.py` consumes ultralytics-YOLOv8 ONNX (`ml/ripeness/export/model.onnx` + `classes.json`, env-overridable) → same schema dicts. `detector.load_detector()` picks ONNX if the model file exists, else HSV — never raises in auto mode.
Verify: `cd robot/vision && python3 pipeline.py --source synthetic` then `curl localhost:8080/health`.
**@fw-linux — detector import interface (task 4 coordination):** add `robot/vision` to sys.path, then `from detector import load_detector; det = load_detector(); det.detect(frame_bgr) -> [detection dicts per root schema]`. `det.name` tells you hsv vs onnx. No constructor args needed; env `DETECTOR=hsv|onnx|auto`, `MODEL_PATH`, `CLASSES_PATH`.
**@vision-train:** I assume `classes.json` is a JSON array `["apple_ripe","apple_unripe","banana_ripe","banana_unripe"]`, index = class id, and ONNX output `(1, 4+nc, N)` cxcywh (plain ultralytics `model.export(format="onnx")`, imgsz 320). Flag in your status if different.
Next: bench.py FPS harness.

## [22:11] DONE — Task 3: bench.py FPS harness (+ ONNX path verified end-to-end)
`bench.py --detector hsv|onnx|auto --frames N --size WxH` → human summary + machine-readable `BENCH {json}` line. Laptop (arm64 mac) numbers: HSV 640×480 = 258 fps / 3.9 ms mean; 320×240 = 1176 fps. Re-run unchanged on UNO Q for Qualcomm-track on-device numbers.
Also verified the whole ONNX code path with a synthetic YOLOv8-shaped model (scratchpad, not in repo): auto-selection, letterbox coord inverse-mapping (exact), schema, NMS all correct — so when vision-train's real `model.onnx` lands it should drop in with zero code changes. README.md written with run/verify commands.

## [22:13] DONE — Task 4: fw-linux detector interface published & verified
Interface contract posted in my 22:11 entry (README.md "fw-linux integration" section has the same). Verified the exact consumption path fw-linux will use: from a foreign cwd, `sys.path.insert(0, "<repo>/robot/vision"); from detector import load_detector` works (detector.py self-inserts its dir, no package install needed; deps are only cv2/numpy, onnxruntime only if the ONNX path is taken). fw-linux hasn't hit their inference-loader task yet — nothing blocking on my side; will conform if they flag issues.
**All 4 vision-infer tasks complete.** Idle-ready: can assist on venue-day HSV retuning (thresholds are env-tunable), UNO Q bench runs, or ONNX integration when vision-train exports.

## [RESTART] WIP — crash recovery: verified all 4 tasks still function, starting phase-2
Restarted after crash. Re-ran verification on disk: `test_detector.py --frames 200` → PASS (precision 0.965 / recall 0.891); `bench.py` HSV re-benched on this arm64 mac — 640×480: 473 fps / 2.1 ms, 320×240: 1693 fps / 0.6 ms, 320×320: 1307 fps / 0.76 ms. No long-running procs I own (pipeline MJPEG :8080 is on-demand, nothing to restart). Phase-2 per BROADCAST [22:32]: UNO Q deployment prep (ARM packaging) + draft docs/QUALCOMM.md (MPU/MCU split + bench FPS). Starting now.

## [DONE] Phase-2: UNO Q deployment prep (ARM packaging) + docs/QUALCOMM.md
ARM packaging: `robot/vision/requirements.txt` (pinned — opencv-python-headless + onnxruntime, aarch64 wheels; onnxruntime only imported when model.onnx exists so HSV path installs standalone). `robot/vision/deploy_unoq.sh` (chmod +x, `bash -n` clean): `setup|verify|bench|run|all` — creates venv, installs deps, runs detector eval, records on-device bench to `bench_unoq.txt`, launches MJPEG pipeline. Warns if not aarch64.
`docs/QUALCOMM.md`: full judging brief — intentional MPU(QRB2210 Linux, ~5W vision)/MCU(STM32U585, real-time safety) split with the "safety is MCU-local, survives a hung Linux" argument, on-device-AI story (HSV + YOLOv8n ONNX via onnxruntime CPU on A53, inference never leaves board), bench FPS table (laptop ref filled: HSV 640×480=473fps/2.1ms, 320×320=1307fps, 320×240=1693fps; board YOLOv8n row marked TBD for on-board run), Green-AI frames-per-joule framing for Deloitte. Cross-linked firmware/BRIDGE.md as the split contract.
README updated (numbers + deployment section). Verify: `docs/QUALCOMM.md` reads standalone; `cd robot/vision && ./deploy_unoq.sh verify` on any arm64 box.
**Both phase-2 items complete.** Idle-ready: real on-board bench numbers when a UNO Q is in hand (drop into QUALCOMM.md TBD rows), ONNX drop-in when vision-train exports, venue-day HSV retune.

## [DONE] Phase-3: docs/DEVPOST.md Qualcomm + Deloitte sections
Appended both sections under llm-client's skeleton stubs (kept the `## Qualcomm UNO Q track — on-device AI` / `## Deloitte AI-for-Green — quantified impact` headers verbatim so the track-index anchors resolve; stub placeholders removed; verified no leftovers).
- **Qualcomm**: intentional QRB2210-Linux-MPU / STM32-MCU split (safety enforced MCU-local, survives a hung Linux), genuine on-device AI (HSV + YOLOv8n-int8 via onnxruntime CPU on A53, frames/model never leave board), on-device FPS table (laptop HSV ref 473/1307/1693 fps; YOLOv8n board row = TBD), accuracy 0.965/0.891. Sourced from docs/QUALCOMM.md.
- **Deloitte AI-for-Green**: quantified impact aligned EXACTLY with store.js/DATA.md constants — 8.4s cycle → ~400+ fruit/hr, apple 0.18/banana 0.12 kg (~0.15 avg) → ~60 kg/hr waste avoided, ×2.5 → ~150 kg CO₂e/hr (flagged conservative); live from /api/stats not slideware. 5W edge vs cloud GPU (70–300W + PUE + video transit) Green-AI framing; both track dimensions.
No numbers invented — all cross-checked against server-core's store.js, docs/DATA.md, docs/QUALCOMM.md. Verify: `grep '^## ' docs/DEVPOST.md` shows my two headers intact.
**Phase-3 complete.** Idle-ready: fill YOLOv8n on-board FPS into both QUALCOMM.md + DEVPOST.md when a UNO Q runs the bench.

## [DONE] Night-shift: final v0 bench → QUALCOMM.md + fixed loader for real classes.json
Benched the FINAL trained v0 (vision-train, 40-epoch export, 23:15). Laptop arm64 CPU, onnxruntime:
- fp32 `model.onnx`: 70 fps @320 / 68 @640 (14.4/14.8 ms) — confs correct 0.50–0.95
- int8 `model.int8.onnx`: 180 fps @320 / 153 @640 (5.5/6.5 ms) — ~2.6× faster BUT confs pin at 1.54 (CONFIRMED vision-train's saturation bug; boxes+class correct, unrankable)
- HSV fallback: 473 @640 / 1307 @320
Accuracy (vision-train val): overall mAP50 0.993 / mAP50-95 0.930, P0.988/R0.986, per-class all ≥0.991.
Published final FPS+accuracy tables into `docs/QUALCOMM.md` (replaced provisional/TBD) AND my `docs/DEVPOST.md` Qualcomm section (kept consistent). Documented: **fp32 is the demo model, int8 is the speed lever** (needs opset-13 per-channel requant; fp32's 70fps already ≫ 30fps camera so it's headroom not a blocker).

**FIXED a real integration break:** the final `classes.json` changed to a dict schema (`{"classes":[...],"imgsz":320,"class_map":{...}}`); my `onnx_detector.py` assumed a plain array and CRASHED in detect() (`ValueError: not enough values to unpack`). Patched to parse both the dict schema (uses `class_map` for fruit/ripeness + `imgsz` for dynamic-input fallback) and the legacy array. Now loads clean.

@fw-linux — **your loader consumes the final model cleanly NOW.** `load_detector()` auto-selects `model.onnx`, correct class_map [(apple,ripe)…], valid root-schema dicts, correct confs. Load **fp32 `model.onnx`, NOT int8** (per vision-train + my bench: int8 conf is broken). Verified end-to-end: `pipeline.py --source synthetic` → /health detector=onnx, /detections valid.
@vision-train — confirmed your int8 conf saturation (1.54) + fp32 correct (0.50–0.95). Agreed fp32 is demo model. If you re-quant int8 at opset-13, ping me and I'll re-bench.

Verify: `cd robot/vision && DETECTOR=hsv python3 test_detector.py` (PASS 0.965/0.891) + `MODEL_PATH=../../ml/ripeness/export/model.onnx python3 bench.py --detector onnx --size 320x320`.
**Night-shift task complete.** Idle-ready: on-board UNO Q bench fills the "pending board" column via `./deploy_unoq.sh bench`; primed for real-prop v1 model when vision-train finetunes.

## [DONE] Style sweep: no emojis / no em dashes across robot/ + ml/
Executed the mandatory style sweep for my assigned trees (BROADCAST line 16: @vision-infer -> robot/ + ml/).
- Em dashes: replaced U+2014 with "-" in 64 authored files (.py/.md/.sh/.yaml/.html/.txt/.gitignore/config), matching the linter's convention already applied to docs/. Left arrows (->, left/right), en dashes in numeric ranges (30-40 style stays as-is per rule wording), and math symbols untouched (rule targets emojis + em dashes only).
- Emojis: removed pictographs from 6 files (star, satellite, phone, apple, warning, white-check) with meaning-preserving swaps, e.g. demo_driver.py + DEMO_TRANSCRIPT.md check-marks -> "yes"; kept plain text marks (check/cross) and arrows.
- EXCLUDED from hand-editing (correctly): generated data (*.jsonl) and machine logs (*.log). I fixed the em dashes in the GENERATORS (generate_dataset.py, generate_prefs.py) at source. Verified end state: ml/freesolo-agent/data has ZERO em dashes now (data was regenerated/cleaned concurrently), so generator+data are consistent.
Verify: `grep -rl $'—' robot/ ml/ | grep -vE '.venv|__pycache__'` -> empty (ZERO em dashes). Emoji re-scan -> clean. py_compile all .py -> OK. Tests: robot/vision detector PASS (0.951/0.901), farmhand 23/23, slam 9/9, lidar-node 24/24; onnx loads+detects OK.
@llm-data: I swept the em dashes in your data/*.py generators (comments + system-prompt string). Your jsonl is already em-dash-free on disk. Please confirm a seeded re-run of generate_dataset.py still produces byte-identical output against the current jsonl (my source edit should match the cleaned data, but you own that check).
**Style sweep complete for robot/ + ml/.**
