"""App Lab app — Linux/MPU side: perception -> decision -> Bridge -> MCU.

The dual-brain money shot (docs/QUALCOMM_PLAN.md): the QRB2210 Linux brain runs
the camera + HSV localization + spoilage classifier, decides PICK/REJECT, and
hands the command to the STM32 MCU over the Arduino Bridge (RPC). The MCU actuates
the arm/gripper in real time.

Runs on a laptop TODAY for dev: the Bridge falls back to printing decisions, so you
can see the perception + decision loop with no board. On the UNO Q, bind `Bridge`
to the real App Lab RPC (one spot, marked below) and point SPOILAGE_MODEL at the
Edge Impulse export.

Reuses the repo's vision code. Two deploy options (see README): deploy the whole
robot/ tree, or vendor hsv_detector.py + spoilage.py + spoilage_classifier.py into
this python/ folder.
"""

import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "vision"))

import cv2  # noqa: E402
from detector import load_detector  # noqa: E402
from spoilage_classifier import load_spoilage_classifier  # noqa: E402


class Bridge:
    """Seam over the App Lab Bridge (RPC over serial to the MCU sketch).

    On the UNO Q: bind `self._rpc` to the App Lab bridge client and call the MCU
    function that sketch.ino exposes via `Bridge.provide("actuate", ...)`. Until
    then it prints, so the loop is fully testable on a laptop."""

    def __init__(self):
        self._rpc = None
        # --- BIND ON BOARD -------------------------------------------------
        # from arduino.app_bridge import Bridge as AppBridge   # exact import: verify in App Lab
        # self._rpc = AppBridge()
        # -------------------------------------------------------------------

    def actuate(self, command, fruit, score):
        if self._rpc is not None:
            self._rpc.call("actuate", command, fruit, float(score))  # RPC -> MCU
        else:
            print(f"[bridge] -> MCU actuate({command}, {fruit}, score={score:.2f})", flush=True)


def decide(det):
    """Perception -> action policy. Spoiled is rejected regardless of ripeness."""
    if det.get("spoiled"):
        return "REJECT"
    if det.get("ripeness") == "ripe":
        return "PICK"
    return "SKIP"


def main():
    detector = load_detector()
    classifier = load_spoilage_classifier()  # SPOILAGE_BACKEND=onnx SPOILAGE_MODEL=... on board
    bridge = Bridge()
    cam = cv2.VideoCapture(int(os.environ.get("CAMERA_INDEX", "0")))
    print(f"[app] detector={detector.name} spoilage={classifier.name} — perception loop up",
          flush=True)

    last = None
    while True:
        ok, frame = cam.read()
        if not ok:
            time.sleep(0.05)
            continue
        dets = detector.detect(frame)
        # act on the most confident fruit this frame
        target = dets[0] if dets else None
        if target is not None:
            if target.get("fruit") == "banana":
                target.update(classifier.classify(frame, target))
            cmd = decide(target)
            key = (target["fruit"], cmd, target.get("spoiled"))
            if key != last:  # only signal the MCU on a change of decision
                bridge.actuate(cmd, target["fruit"], target.get("spoil_score", 0.0))
                last = key
        time.sleep(0.03)


if __name__ == "__main__":
    main()
