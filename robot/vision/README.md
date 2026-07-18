# robot/vision - camera pipeline & fruit detectors

Detects 3D-printed apples/bananas + ripeness. Two interchangeable detectors
behind one interface; everything runs with zero hardware (synthetic scenes).

## Files

| file | what |
|---|---|
| `detector.py` | `load_detector()` - the import surface for fw-linux. ONNX if `ml/ripeness/export/model.onnx` exists, else HSV fallback. |
| `hsv_detector.py` | Works-today OpenCV HSV blob detector (red->apple ripe, yellow->banana ripe, green split by elongation). |
| `onnx_detector.py` | YOLOv8 ONNX wrapper (onnxruntime CPU) for vision-train's export. |
| `pipeline.py` | capture -> detect -> annotated MJPEG `:8080/stream` + `/detections` + `/health`. |
| `bench.py` | FPS/latency benchmark (Qualcomm-track on-device numbers). |
| `synthetic.py` | Synthetic scene generator + `SyntheticCamera`. |
| `test_detector.py` | Precision/recall eval vs synthetic ground truth + schema checks. |

## Quick start

```bash
cd robot/vision
python3 test_detector.py --frames 200        # detector eval -> PASS
python3 pipeline.py --source synthetic       # MJPEG on http://localhost:8080/stream
python3 bench.py --detector auto             # FPS numbers (prints BENCH json line)
```

With a camera: `CAMERA_INDEX=0 python3 pipeline.py` (falls back to synthetic if
the camera won't open).

## Detection dict (root CLAUDE.md schema - do not drift)

```json
{"ts": 0, "fruit": "apple|banana", "ripeness": "ripe|unripe", "conf": 0.93, "bbox": [x, y, w, h]}
```

## fw-linux integration

```python
sys.path.insert(0, "<repo>/robot/vision")
from detector import load_detector
det = load_detector()            # .name == "hsv" | "onnx"
dets = det.detect(frame_bgr)     # list of detection dicts, conf-sorted
```

Env knobs: `DETECTOR=hsv|onnx|auto`, `MODEL_PATH`, `CLASSES_PATH`,
`CAMERA_INDEX`, `PORT`, `HSV_MIN_AREA`, `ONNX_CONF`, `ONNX_NMS`.

## Current numbers (laptop, arm64 mac - re-run on UNO Q for the writeup)

- HSV 640×480: ~473 fps, mean 2.1 ms
- HSV 320×320: ~1307 fps, mean 0.76 ms
- HSV 320×240: ~1693 fps, mean 0.59 ms
- Eval (synthetic, 200 frames): precision 0.965 / recall 0.891

## UNO Q deployment (Qualcomm track)

On the board's Linux side, from this dir:

```bash
./deploy_unoq.sh setup      # venv + pinned deps (opencv-headless + onnxruntime aarch64)
./deploy_unoq.sh verify     # detector eval + schema check
./deploy_unoq.sh bench      # on-device FPS -> bench_unoq.txt
./deploy_unoq.sh run        # MJPEG pipeline on :8080
```

Deps pinned in `requirements.txt`. Full MPU/MCU split + on-device-AI writeup:
`docs/QUALCOMM.md`.
