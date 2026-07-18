"""Browser-based dataset capture tool for fruit spoilage / anomaly training.

Serves a live webcam page with one-click labelled capture. Saves images into a
folder-per-label layout that works BOTH for Edge Impulse (folder upload, or the
`edge-impulse-uploader --label <name>` CLI) and for the local anomaly model.

    dataset/
      fresh/    fresh.<ts>.jpg      # clean bananas  -> classifier + anomaly TRAIN
      spoiled/  spoiled.<ts>.jpg    # marker/bruised -> classifier + anomaly TEST
      apple/    apple.<ts>.jpg      # (optional) the other fruit
      empty/    empty.<ts>.jpg      # (optional) no fruit / background negatives

Run (reuses robot/vision venv, which has opencv-headless + numpy):
    cd ml/spoilage
    CAMERA_INDEX=0 ../../robot/vision/.venv/bin/python capture.py
    # then open http://localhost:8091

Env: CAMERA_INDEX (0), PORT (8091), DATASET_DIR (./dataset), BURST (10).

Collection guidance (shown on the page too): for each label capture many short
bursts while slowly rotating / re-lighting / re-positioning the fruit and moving
the background around. Aim ~80-120 fresh and ~80-120 spoiled, plus a handful of
apple/empty. Variety beats volume.
"""

import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

import cv2

LABELS = ["fresh", "spoiled", "apple", "empty"]
CAMERA_INDEX = int(os.environ.get("CAMERA_INDEX", "0"))
PORT = int(os.environ.get("PORT", "8091"))
DATASET_DIR = os.environ.get("DATASET_DIR", os.path.join(os.path.dirname(__file__), "dataset"))
BURST = int(os.environ.get("BURST", "10"))

# Optional live detection box (framing guide only; never saved). Falls back
# gracefully if robot/vision isn't importable.
try:
    import sys
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "robot", "vision"))
    from hsv_detector import HSVDetector
    _DET = HSVDetector()
except Exception:
    _DET = None


class Camera:
    def __init__(self, index):
        self.cap = cv2.VideoCapture(index)
        self.lock = threading.Lock()
        self.frame = None
        self.ok = self.cap.isOpened()
        threading.Thread(target=self._loop, daemon=True).start()

    def _loop(self):
        while True:
            ok, f = self.cap.read()
            if ok:
                with self.lock:
                    self.frame = f
            else:
                time.sleep(0.05)

    def read(self):
        with self.lock:
            return None if self.frame is None else self.frame.copy()


def _counts():
    out = {}
    for lb in LABELS:
        d = os.path.join(DATASET_DIR, lb)
        out[lb] = len([f for f in os.listdir(d)]) if os.path.isdir(d) else 0
    return out


# fruit each label must contain to be worth saving (quality gate). "empty" is a
# deliberate negative, so it has no required fruit.
_REQUIRED_FRUIT = {"fresh": "banana", "spoiled": "banana", "apple": "apple"}
REQUIRE_FRUIT = int(os.environ.get("REQUIRE_FRUIT", "1"))


def _has_fruit(frame, fruit):
    if _DET is None or fruit is None:
        return True
    return any(d["fruit"] == fruit for d in _DET.detect(frame))


def _save_burst(cam, label, n):
    """Save up to n frames. With REQUIRE_FRUIT, skip frames where the label's
    fruit isn't actually detected (keeps empty/blurred frames out of the set)."""
    d = os.path.join(DATASET_DIR, label)
    os.makedirs(d, exist_ok=True)
    want = _REQUIRED_FRUIT.get(label) if REQUIRE_FRUIT else None
    saved = skipped = 0
    for _ in range(n):
        f = cam.read()
        if f is not None:
            if want is not None and not _has_fruit(f, want):
                skipped += 1
            else:
                # filename prefix == label -> Edge Impulse infers the label from it
                ts = f"{time.time():.3f}".replace(".", "")
                cv2.imwrite(os.path.join(d, f"{label}.{ts}.jpg"), f)
                saved += 1
        time.sleep(0.12)  # spread the burst so the fruit can be rotated slightly
    if skipped:
        print(f"[capture] {label}: saved {saved}, skipped {skipped} (no {want} detected)")
    return saved


PAGE = """<!doctype html><html><head><meta charset=utf-8><title>Spoilage capture</title>
<style>
 body{font:15px system-ui;margin:0;background:#11100d;color:#f4f0e6;display:flex;gap:20px;padding:20px}
 #cam{max-width:640px;border:2px solid #333;border-radius:8px}
 .col{display:flex;flex-direction:column;gap:12px;min-width:220px}
 button{font:600 15px system-ui;padding:14px;border:0;border-radius:8px;cursor:pointer;color:#11100d}
 .fresh{background:#46e068}.spoiled{background:#e5484d;color:#fff}.apple{background:#f5a524}.empty{background:#9aa0a6}
 .count{font:600 13px ui-monospace;color:#bdb8ab}
 kbd{background:#333;border-radius:4px;padding:1px 6px}
 small{color:#8f8a7d;line-height:1.5}
</style></head><body>
 <div><img id=cam src=/stream></div>
 <div class=col>
  <h3 style=margin:0>Capture — burst of <span id=b></span></h3>
  <button class=fresh onclick=cap('fresh')>FRESH banana &nbsp;<kbd>f</kbd></button>
  <button class=spoiled onclick=cap('spoiled')>SPOILED banana &nbsp;<kbd>s</kbd></button>
  <button class=apple onclick=cap('apple')>apple &nbsp;<kbd>a</kbd></button>
  <button class=empty onclick=cap('empty')>empty/bg &nbsp;<kbd>e</kbd></button>
  <div class=count id=counts>…</div>
  <small>Rotate / re-light / move the fruit and background between bursts.
   Target ~80–120 <b>fresh</b> + ~80–120 <b>spoiled</b>, a few apple/empty.
   The green box is a framing guide only (not saved).</small>
 </div>
<script>
 document.getElementById('b').textContent = BURSTN;
 async function refresh(){const c=await (await fetch('/counts')).json();
   document.getElementById('counts').innerHTML=Object.entries(c).map(([k,v])=>k+': '+v).join(' &nbsp; ');}
 async function cap(l){await fetch('/capture?label='+l+'&n='+BURSTN);refresh();}
 document.addEventListener('keydown',e=>{const m={f:'fresh',s:'spoiled',a:'apple',e:'empty'};if(m[e.key])cap(m[e.key]);});
 refresh();setInterval(refresh,1500);
</script></body></html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        u = urlparse(self.path)
        if u.path == "/":
            body = PAGE.replace("BURSTN", str(BURST)).encode()
            self.send_response(200); self.send_header("Content-Type", "text/html")
            self.send_header("Content-Length", str(len(body))); self.end_headers()
            self.wfile.write(body)
        elif u.path == "/counts":
            import json
            body = json.dumps(_counts()).encode()
            self.send_response(200); self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body))); self.end_headers()
            self.wfile.write(body)
        elif u.path == "/capture":
            q = parse_qs(u.query)
            label = q.get("label", ["fresh"])[0]
            n = int(q.get("n", [BURST])[0])
            saved = _save_burst(CAM, label, n) if label in LABELS else 0
            self.send_response(200); self.end_headers()
            self.wfile.write(str(saved).encode())
        elif u.path == "/stream":
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.end_headers()
            try:
                while True:
                    f = CAM.read()
                    if f is None:
                        time.sleep(0.03); continue
                    if _DET is not None:
                        for d in _DET.detect(f):
                            x, y, w, h = d["bbox"]
                            cv2.rectangle(f, (x, y), (x + w, y + h), (0, 220, 0), 2)
                    ok, jpg = cv2.imencode(".jpg", f)
                    if not ok:
                        continue
                    self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\n\r\n")
                    self.wfile.write(jpg.tobytes()); self.wfile.write(b"\r\n")
                    time.sleep(0.03)
            except (BrokenPipeError, ConnectionResetError):
                pass
        else:
            self.send_response(404); self.end_headers()


if __name__ == "__main__":
    CAM = Camera(CAMERA_INDEX)
    if not CAM.ok:
        raise SystemExit(f"could not open camera {CAMERA_INDEX}")
    os.makedirs(DATASET_DIR, exist_ok=True)
    print(f"[capture] camera {CAMERA_INDEX} -> {DATASET_DIR}")
    print(f"[capture] open http://localhost:{PORT}   (labels: {', '.join(LABELS)})")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
