# fruit-sorter — Arduino App Lab app for the UNO Q

The on-device demo for the Qualcomm track: the **QRB2210 Linux brain** runs the
camera + HSV localization + spoilage classifier and decides PICK/REJECT/SKIP; the
**STM32 MCU brain** actuates the arm over the **Bridge** (RPC). No cloud.

See [`docs/QUALCOMM_PLAN.md`](../../docs/QUALCOMM_PLAN.md) for the why/when.

## Layout (App Lab convention)
```
app.yaml            manifest (ties python + sketch)
python/main.py      MPU: camera -> detect -> classify -> decide -> Bridge -> MCU
python/requirements.txt
sketch/sketch.ino   MCU: Bridge.provide("actuate", ...) -> drive arm/gripper
sketch/sketch.yaml  MCU build (FQBN)
```

## Run it on a laptop TODAY (no board)
The Bridge falls back to printing decisions, so the full perception loop is testable now:
```bash
CAMERA_INDEX=0 ../vision/.venv/bin/python python/main.py
# point the webcam at fruit -> prints:  [bridge] -> MCU actuate(PICK, banana, score=0.03)
```
Swap in the Edge Impulse model the moment it exists (no code change):
```bash
SPOILAGE_BACKEND=onnx SPOILAGE_MODEL=/path/spoilage.onnx SPOILAGE_CLASSES=fresh,spoiled \
  CAMERA_INDEX=0 ../vision/.venv/bin/python python/main.py
```

## Deploy on the UNO Q (when it arrives)
1. **Bring the vision code with it.** Either deploy the `robot/` tree, or vendor
   `hsv_detector.py`, `spoilage.py`, `spoilage_classifier.py` (+ `detector.py`,
   `onnx_detector.py`, `synthetic.py`) into `python/`. Then drop the `sys.path` insert.
2. **Bind the Bridge** in `python/main.py` (`Bridge.__init__`) and in `sketch.ino`
   (`Bridge.provide("actuate", actuate)`) — the two `--- BIND ON BOARD ---` / TODO spots.
3. **Verify** `app.yaml` fields and the MCU **FQBN** in `sketch.yaml` against the App
   Lab version on the board (`docs.arduino.cc/software/app-lab`).
4. Place the Edge Impulse export where `SPOILAGE_MODEL` points (or wire it as an App
   Lab AI Brick per `app.yaml`), open the app in App Lab, and run.
5. Profile the model in **Qualcomm AI Hub**; record on-device latency/RAM/FPS.

## Status
Template + working laptop-dev loop. The `TODO`/`VERIFY` markers are the only things
that need the physical board — everything upstream (perception, decision, model
swap) is done and testable now.
