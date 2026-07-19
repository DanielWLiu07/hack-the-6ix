"""Camera -> detector -> annotated MJPEG pipeline.

Run:  python3 pipeline.py [--source camera|synthetic]

Serves on 0.0.0.0:PORT (default 8080):
    /stream       multipart MJPEG, annotated frames (the hub /stream proxies this)
    /detections   latest detections as JSON: {"ts":..., "detections":[...]}
    /health       {"ok":true,"detector":"hsv|onnx","fps":...,"source":...}

Env:
    CAMERA_INDEX  cv2.VideoCapture index (default 0)
    PORT          HTTP port (default 8080)
    DETECTOR      hsv | onnx | auto (default auto - see detector.py)
    FRAME_W/H     capture size request (default 640x480)
    JPEG_QUALITY  default 80

No camera attached (or --source synthetic): falls back to the synthetic scene
generator so the stream + detections work end-to-end today.

Detections are also printed to stdout as JSON lines (one per change) so a
parent process (the Linux node) can consume them without HTTP if it prefers -
though the supported interface is `detector.load_detector()` in-process.
"""

import argparse
import json
import os
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2

from detector import load_detector, annotate
from synthetic import SyntheticCamera

PORT = int(os.environ.get("PORT", "8080"))
CAMERA_INDEX = int(os.environ.get("CAMERA_INDEX", "0"))
FRAME_W = int(os.environ.get("FRAME_W", "640"))
FRAME_H = int(os.environ.get("FRAME_H", "480"))
JPEG_QUALITY = int(os.environ.get("JPEG_QUALITY", "80"))


class SharedState:
    def __init__(self):
        self.lock = threading.Condition()
        self.jpeg = None            # latest annotated frame, jpeg bytes
        self.detections = []
        self.ts = 0.0
        self.fps = 0.0
        self.seq = 0

    def publish(self, jpeg, detections, ts, fps):
        with self.lock:
            self.jpeg, self.detections, self.ts, self.fps = jpeg, detections, ts, fps
            self.seq += 1
            self.lock.notify_all()

    def wait_frame(self, last_seq, timeout=2.0):
        with self.lock:
            self.lock.wait_for(lambda: self.seq != last_seq, timeout=timeout)
            return self.jpeg, self.seq


STATE = SharedState()


def open_source(source):
    if source == "synthetic":
        return SyntheticCamera(FRAME_W, FRAME_H), "synthetic"
    cap = cv2.VideoCapture(CAMERA_INDEX)
    if cap.isOpened():
        cap.set(cv2.CAP_PROP_FRAME_WIDTH, FRAME_W)
        cap.set(cv2.CAP_PROP_FRAME_HEIGHT, FRAME_H)
        return cap, f"camera:{CAMERA_INDEX}"
    print(f"[pipeline] camera index {CAMERA_INDEX} not available -> synthetic source",
          file=sys.stderr)
    return SyntheticCamera(FRAME_W, FRAME_H), "synthetic"


def capture_loop(source, detector, emit_stdout=True):
    cap, src_name = open_source(source)
    STATE.source = src_name
    fps, alpha = 0.0, 0.1
    last_emit = ""
    while True:
        t0 = time.time()
        ok, frame = cap.read()
        if not ok:
            print("[pipeline] frame grab failed; retrying in 1s", file=sys.stderr)
            time.sleep(1)
            continue
        dets = detector.detect(frame, ts=t0)
        dt = time.time() - t0
        fps = (1 - alpha) * fps + alpha * (1.0 / max(dt, 1e-6)) if fps else 1.0 / max(dt, 1e-6)

        annotate(frame, dets, extra=f"{detector.name} {fps:.1f} fps {src_name}")
        ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        if ok:
            STATE.publish(buf.tobytes(), dets, t0, fps)

        if emit_stdout:
            line = json.dumps([{k: d[k] for k in ("fruit", "ripeness", "conf", "bbox")}
                               for d in dets])
            if line != last_emit:  # only print on change to keep stdout sane
                print(json.dumps({"ts": t0, "detections": dets}), flush=True)
                last_emit = line

        # cap synthetic source at ~15 fps so it doesn't burn CPU
        if src_name == "synthetic" and dt < 1 / 15:
            time.sleep(1 / 15 - dt)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # silence per-request spam
        pass

    def do_GET(self):
        if self.path.startswith("/stream"):
            self._stream()
        elif self.path.startswith("/detections"):
            self._json({"ts": STATE.ts, "detections": STATE.detections})
        elif self.path.startswith("/health"):
            self._json({"ok": STATE.jpeg is not None,
                        "detector": DETECTOR_NAME,
                        "source": getattr(STATE, "source", "?"),
                        "fps": round(STATE.fps, 1)})
        else:
            self.send_response(302)
            self.send_header("Location", "/stream")
            self.end_headers()

    def _json(self, obj):
        body = json.dumps(obj).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _stream(self):
        self.send_response(200)
        self.send_header("Age", "0")
        self.send_header("Cache-Control", "no-cache, private")
        self.send_header("Content-Type",
                         "multipart/x-mixed-replace; boundary=frame")
        self.end_headers()
        seq = -1
        try:
            while True:
                jpeg, seq = STATE.wait_frame(seq)
                if jpeg is None:
                    continue
                self.wfile.write(b"--frame\r\n")
                self.wfile.write(b"Content-Type: image/jpeg\r\n")
                self.wfile.write(f"Content-Length: {len(jpeg)}\r\n\r\n".encode())
                self.wfile.write(jpeg)
                self.wfile.write(b"\r\n")
        except (BrokenPipeError, ConnectionResetError):
            pass  # client went away


def main():
    global DETECTOR_NAME
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="camera", choices=["camera", "synthetic"])
    ap.add_argument("--port", type=int, default=PORT)
    args = ap.parse_args()

    detector = load_detector()
    DETECTOR_NAME = detector.name
    print(f"[pipeline] detector={detector.name} port={args.port} source={args.source}",
          file=sys.stderr)

    t = threading.Thread(target=capture_loop, args=(args.source, detector), daemon=True)
    t.start()

    server = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print(f"[pipeline] MJPEG on http://0.0.0.0:{args.port}/stream", file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


DETECTOR_NAME = "?"

if __name__ == "__main__":
    main()
