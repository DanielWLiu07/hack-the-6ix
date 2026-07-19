#!/usr/bin/env python3
"""mesh_receiver.py - receive the FarmHandCapture LiDAR mesh stream -> world.glb.

The native iOS app (robot/lidar/phone/ios/FarmHandCapture) streams ARKit
scene-reconstruction mesh anchors over TCP. ARKit re-meshes anchors constantly,
so "latest anchor mesh wins" is not stable enough for a live dashboard - later
updates can be sparser than earlier ones and make the world appear to collapse.

This receiver therefore fuses incoming colored vertices into a persistent
world-space voxel map on the laptop, then exports that fused map to
web/public/world.glb. The web view renders an additive accumulated LiDAR world
instead of transient anchor snapshots.

Wire format (little-endian), one frame per anchor update:
  'MSH2' | uint32 payloadLen | payload
  payload: uuid(16) | float32 x16 transform (column-major)
           | uint32 vCount | uint32 tCount
           | vCount*3 float32 (anchor-local verts) | tCount*3 uint32 indices
           | vCount*3 uint8 RGB

Camera pose frames, ~30 Hz (where the PHONE is in the same ARKit world space,
so egocentric math like "distance ahead of the phone" is possible - the mesh
alone cannot provide that because a long session's origin drifts far away):
  'POSE' | uint32 payloadLen (72) | payload
  payload: float64 unix epoch seconds | float32 x16 camera transform
           (column-major, camera-to-world)
The latest pose is served as JSON at GET :CONTROL_PORT/pose for any consumer
(fusion, phone_front, etc.): {ts, rx_ts, age_s, transform (4x4 row-major),
position [x,y,z], forward [x,y,z] (camera -Z in world)}.

Run (on the laptop, iPhone on the same WiFi / your hotspot):
    cd robot/lidar/phone && python3 mesh_receiver.py           # listens 0.0.0.0:9353
Then in the app enter this laptop's IP (printed at startup) and tap Start scan.
Env: PORT (9353), WORLD_OUT (default ../../web/public/world.glb), EXPORT_EVERY_S (2).
"""
import json
import os
import socket
import socketserver
import struct
import threading
import time
import tempfile
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

_HERE = os.path.dirname(os.path.abspath(__file__))
WORLD_OUT = os.environ.get("WORLD_OUT",
                           os.path.normpath(os.path.join(_HERE, "..", "..", "..", "web", "public", "world.glb")))
PORT = int(os.environ.get("PORT", "9353"))
EXPORT_EVERY_S = float(os.environ.get("EXPORT_EVERY_S", "2"))

# Persistent world = the REAL ARKit surface mesh, not voxels. ARKit partitions
# the scene into mesh anchors and continuously re-meshes each one in place, so
# keeping the latest mesh per anchor and concatenating them reconstructs the
# actual scanned surface (smooth triangles + per-vertex color the phone streams).
# uuid(bytes) -> (world_verts Nx3 float, faces Mx3 int, colors Nx3 uint8)
_anchors = {}
_lock = threading.Lock()
_dirty = False
_stats = {"frames": 0, "clients": 0, "poses": 0}
# Latest phone camera pose: {"ts": float, "rx_ts": float, "transform": 4x4 list}
_pose = None


def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80)); ip = s.getsockname()[0]; s.close(); return ip
    except Exception:
        return "127.0.0.1"


def _recv_exact(sock, n):
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            return None
        buf.extend(chunk)
    return bytes(buf)


def _parse_payload(p):
    """Return (uuid, world_verts Nx3, faces Mx3, colors Nx3 uint8)."""
    off = 0
    uuid = p[off:off + 16]; off += 16
    t = np.frombuffer(p, dtype="<f4", count=16, offset=off).reshape(4, 4).T  # column-major -> M
    off += 64
    vcount, tcount = struct.unpack_from("<II", p, off); off += 8
    verts = np.frombuffer(p, dtype="<f4", count=vcount * 3, offset=off).reshape(-1, 3).astype(np.float64)
    off += vcount * 12
    faces = np.frombuffer(p, dtype="<u4", count=tcount * 3, offset=off).reshape(-1, 3).astype(np.int64)
    off += tcount * 12
    colors = np.frombuffer(p, dtype="<u1", count=vcount * 3, offset=off).reshape(-1, 3)
    # anchor-local -> world
    h = np.hstack([verts, np.ones((len(verts), 1))])
    world = (h @ t.T)[:, :3]
    return uuid, world, faces, colors


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        global _dirty, _pose
        with _lock:
            _stats["clients"] += 1
        peer = self.client_address[0]
        print(f"[mesh] client connected: {peer}", flush=True)
        sock = self.request
        try:
            while True:
                try:
                    hdr = _recv_exact(sock, 8)
                except (ConnectionResetError, OSError):
                    break
                if not hdr:
                    break
                magic, length = hdr[:4], struct.unpack("<I", hdr[4:8])[0]
                if magic not in (b"MSH2", b"POSE") or length <= 0 or length > 50_000_000:
                    print(f"[mesh] bad frame magic={magic!r} len={length}", flush=True)
                    break
                payload = _recv_exact(sock, length)
                if payload is None:
                    break
                if magic == b"POSE":
                    # float64 epoch ts | float32 x16 camera transform (column-major)
                    try:
                        ts = struct.unpack_from("<d", payload, 0)[0]
                        t = np.frombuffer(payload, dtype="<f4", count=16, offset=8).reshape(4, 4).T
                    except Exception as e:
                        print(f"[mesh] pose parse error: {e}", flush=True)
                        continue
                    with _lock:
                        _pose = {"ts": ts, "rx_ts": time.time(), "transform": t.tolist()}
                        _stats["poses"] += 1
                    continue
                try:
                    uuid, verts, faces, colors = _parse_payload(payload)
                except Exception as e:
                    print(f"[mesh] parse error: {e}", flush=True)
                    continue
                with _lock:
                    # Latest mesh per anchor wins - that's ARKit's own model of
                    # the world (each anchor re-meshed in place as you scan).
                    if len(verts) > 0 and len(faces) > 0:
                        _anchors[bytes(uuid)] = (verts, faces, colors)
                        _dirty = True
                    _stats["frames"] += 1
        finally:
            print(f"[mesh] client disconnected: {peer}", flush=True)


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def export_loop():
    global _dirty
    import trimesh
    while True:
        time.sleep(EXPORT_EVERY_S)
        with _lock:
            if not _dirty or not _anchors:
                continue
            anchors = list(_anchors.values())
            frames = _stats["frames"]
            _dirty = False
        # Concatenate every anchor's latest mesh into one, offsetting face indices
        # into the shared vertex buffer. This is the real scanned surface.
        vparts, fparts, cparts = [], [], []
        base = 0
        for verts, faces, colors in anchors:
            n = len(verts)
            if n == 0 or len(faces) == 0:
                continue
            vparts.append(verts)
            fparts.append(faces + base)
            # per-vertex RGB -> RGBA (opaque) for glTF vertex colors
            cparts.append(np.hstack([colors, np.full((len(colors), 1), 255, np.uint8)]))
            base += n
        if not vparts:
            continue
        V = np.vstack(vparts)
        F = np.vstack(fparts)
        C = np.vstack(cparts).astype(np.uint8)
        try:
            mesh = trimesh.Trimesh(vertices=V, faces=F, vertex_colors=C, process=False)
            os.makedirs(os.path.dirname(os.path.abspath(WORLD_OUT)), exist_ok=True)
            out_dir = os.path.dirname(os.path.abspath(WORLD_OUT))
            fd, tmp_path = tempfile.mkstemp(prefix="world.", suffix=".glb", dir=out_dir)
            os.close(fd)
            try:
                mesh.export(tmp_path)
                os.replace(tmp_path, WORLD_OUT)
            finally:
                if os.path.exists(tmp_path):
                    os.unlink(tmp_path)
            mb = os.path.getsize(WORLD_OUT) / 1e6
            print(f"[mesh] world.glb updated: {len(anchors)} anchors, {len(V)} verts, "
                  f"{len(F)} faces, {mb:.1f} MB (frames rx: {frames})", flush=True)
        except Exception as e:
            print(f"[mesh] export failed: {e}", flush=True)


CONTROL_PORT = int(os.environ.get("CONTROL_PORT", "9355"))


class Control(BaseHTTPRequestHandler):
    """Tiny HTTP control endpoint. GET /clear resets the world to empty so a
    fresh scan visibly builds from nothing. GET /pose returns the phone's latest
    camera pose as JSON (404 until the first POSE frame arrives)."""

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")

    def do_OPTIONS(self):
        self.send_response(204); self._cors(); self.end_headers()

    def do_GET(self):
        global _dirty
        if self.path.startswith("/pose"):
            with _lock:
                pose = _pose
            if pose is None:
                self.send_response(404); self._cors()
                self.send_header("Content-Type", "application/json"); self.end_headers()
                self.wfile.write(b'{"error":"no pose received yet"}')
                return
            t = pose["transform"]
            body = json.dumps({
                "ts": pose["ts"],
                "rx_ts": pose["rx_ts"],
                "age_s": round(time.time() - pose["rx_ts"], 3),
                "transform": t,                             # 4x4 row-major, camera-to-world
                "position": [t[0][3], t[1][3], t[2][3]],    # phone location, ARKit world (m)
                "forward": [-t[0][2], -t[1][2], -t[2][2]],  # camera look direction (-Z column)
            }).encode()
            self.send_response(200); self._cors()
            self.send_header("Content-Type", "application/json"); self.end_headers()
            self.wfile.write(body)
        elif self.path.startswith("/clear"):
            with _lock:
                _anchors.clear()
                _dirty = False
            try:
                if os.path.exists(WORLD_OUT):
                    os.remove(WORLD_OUT)
            except Exception:
                pass
            print("[mesh] CLEARED - world reset to empty (fresh scan will rebuild)", flush=True)
            self.send_response(200); self._cors()
            self.send_header("Content-Type", "text/plain"); self.end_headers()
            self.wfile.write(b"cleared")
        else:
            self.send_response(404); self._cors(); self.end_headers()

    def log_message(self, *a):
        pass


def main():
    ip = lan_ip()
    print(f"[mesh] receiver listening on 0.0.0.0:{PORT}", flush=True)
    print(f"[mesh] in the iPhone app, set laptop IP = {ip}", flush=True)
    print(f"[mesh] world output: {WORLD_OUT}", flush=True)
    print(f"[mesh] control on 0.0.0.0:{CONTROL_PORT} (/clear, /pose)", flush=True)
    threading.Thread(target=export_loop, daemon=True).start()
    threading.Thread(
        target=lambda: ThreadingHTTPServer(("0.0.0.0", CONTROL_PORT), Control).serve_forever(),
        daemon=True).start()
    Server(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
