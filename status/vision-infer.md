# vision-infer status

## [22:07] DONE — Task 1: hsv_detector.py + synthetic tuning harness
HSV blob detector for 3D-printed fruit in `robot/vision/hsv_detector.py` (red→apple_ripe, yellow→banana_ripe, green split apple/banana by elongation). Emits exact root-schema `detection` dicts (schema asserted in tests). Tuned on synthetic scenes (`synthetic.py`): precision 0.965 / recall 0.891 over 200 frames — misses are touching same-color fruit merging into one blob (known HSV limit, fine for eye-in-hand). Verify: `cd robot/vision && python3 test_detector.py --frames 200` → PASS.
Next: pipeline.py (camera→detector→MJPEG :8080) + ONNX loader + unified `detector.load_detector()` interface for fw-linux.
